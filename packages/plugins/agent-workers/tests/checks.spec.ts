// A workflow run's checks (src/checks.ts, T151, ADR-0063): the source that holds the run's worktree
// runs each check the run asks for with the command the operator configured for the repository, on
// the exact tree the result is on, confined as the setup is, only when the policy lets the command run
// unasked. A check passes on exit 0 and fails on any other code, only while the tree is unchanged
// after it; anything else is an error, neither passed nor failed. What ran is one check-run@1.0.
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import AgentRuntimeRegistry, { type AgentRuntimeProvider, type RunSpec } from '@tsuuanmi/system-agent-runtimes'
import StoreApprovals from '@tsuuanmi/system-approvals'
import type { AutonomyPolicy } from '@tsuuanmi/system-approvals-core'
import Artifacts from '@tsuuanmi/system-artifacts'
import Egress from '@tsuuanmi/system-egress'
import EventLog from '@tsuuanmi/system-event-log'
import Leases from '@tsuuanmi/system-leases'
import { captureGitSubject } from '@tsuuanmi/system-libs'
import Store from '@tsuuanmi/system-store'
import WorkerRouter, { type RunCheck, type WorkRequirement } from '@tsuuanmi/system-workers'
import { afterEach, describe, expect, it } from 'vitest'
import { RunChecks, type RunChecksOptions } from '../src/checks.ts'
import { missingPackages } from '../src/dependencies.ts'
import AgentWorkers, { type Config } from '../src/index.ts'
import { loadSetups, noInstallEnvironment, setupEnvironment } from '../src/setup.ts'
import { Worktrees } from '../src/worktrees.ts'

const cleanups: Array<() => unknown> = []
afterEach(async () => {
  while (cleanups.length) await cleanups.pop()!()
})

const temp = (prefix: string): string => {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  cleanups.push(() => rmSync(dir, { recursive: true, force: true }))
  return dir
}
const git = (dir: string, ...args: string[]): string => execFileSync('git', ['-C', dir, '-c', 'user.name=t', '-c', 'user.email=t@example.test', ...args], { encoding: 'utf8' }).trim()

/** A repository whose tests need what its setup installs, and whose lint fails on a file the agent writes. */
function repository(): string {
  const dir = temp('system-checks-repo-')
  git(dir, 'init', '-q', '-b', 'main')
  writeFileSync(join(dir, '.gitignore'), 'node_modules/\n')
  writeFileSync(join(dir, 'test.mjs'), "import { ok } from './node_modules/dep/index.js'\nconsole.log(`tests: ${ok}`)\n")
  writeFileSync(join(dir, 'lint.mjs'), [
    "import { existsSync } from 'node:fs'",
    "if (existsSync('unused.js')) { console.error('lint: unused.js declares a variable it never uses'); process.exit(3) }",
    "console.log('lint: clean')",
    '',
  ].join('\n'))
  git(dir, 'add', '.')
  git(dir, 'commit', '-q', '-m', 'init')
  return dir
}

/** A writing agent: it writes `unused.js` when its prompt says so, as a change the lint check judges. */
class WritingAgent implements AgentRuntimeProvider {
  readonly kind = 'scripted'
  readonly runs: RunSpec[] = []
  async probe() {
    return { available: true, detail: 'scripted 1.0', sandboxes: ['read-only', 'workspace-write'] as Array<'read-only' | 'workspace-write'>, resume: true, executes: true, readsConfined: true, gatesToolCalls: true }
  }
  async run(spec: RunSpec, _signal: AbortSignal, onHandle?: (handle: string) => void) {
    this.runs.push(spec)
    onHandle?.(`h-${this.runs.length}`)
    // `files {…}`: it writes exactly these files (a change to the repository's dependencies, say). The
    // JSON is the prompt's first line: what the source appends to a turn (the note of the calls that
    // run unasked) follows it.
    if (spec.prompt.startsWith('files ')) {
      for (const [path, text] of Object.entries(JSON.parse(spec.prompt.slice(6).split('\n', 1)[0]!) as Record<string, string>)) {
        mkdirSync(dirname(join(spec.workspace, path)), { recursive: true })
        writeFileSync(join(spec.workspace, path), text)
      }
    } else writeFileSync(join(spec.workspace, spec.prompt.includes('unused') ? 'unused.js' : 'used.js'), 'const kept = 1\n')
    return { text: 'done', nativeHandle: `h-${this.runs.length}`, turns: 1 }
  }
}






const SETUP = ['mkdir -p node_modules/dep', 'cp dep.js node_modules/dep/index.js']

/** The studio policy: listed commands run as workspace-write (tests and lint pending); others ask. */
const policy = (commands: string[]): AutonomyPolicy => ({
  schema: 'autonomy-policy@1.0', id: 'studio-test', version: 1, scope: 'studio',
  rules: [
    { actionClass: 'read', mode: 'auto' }, { actionClass: 'workspace-write', mode: 'auto', requires: ['tests', 'lint'] }, { actionClass: 'command', mode: 'ask' },
    ...(['merge', 'external-send', 'deploy', 'delete-data', 'spend', 'charter', 'funding', 'remediation', 'policy-change'] as const).map((actionClass) => ({ actionClass, mode: 'ask' as const })),
  ],
  default: 'ask', commands, expiry: { defaultSeconds: 3600, maxSeconds: 86_400 },
})

const requirement: WorkRequirement = {
  schema: 'work-requirement@1.0', objective: 'change the code', capabilities: ['develop', 'local-data'],
  data: { classification: 'operator-shared', refs: [] }, egressPolicy: 'egress.classification-and-secrets',
  tier: { min: 'economy', source: 'caller' }, acceptance: { contract: 'acceptance.answer' },
}

const writer = (workspace: string): Config['workers'][number] => ({ id: 'dev', runtime: 'scripted', workspace, sandbox: 'workspace-write', tier: 'standard', tools: [], worktreePerRun: true })

type Setup = NonNullable<Config['worktreeSetup']>[number]

/** Where a booted daemon keeps its store and worktrees: a second boot on the same ones is its restart. */
type Home = { db: string; root: string }

async function boot(repo: string, setup: Partial<Setup>, listed: string[] | null, restartOf?: Home, extra: Partial<Config> = {}) {
  if (!restartOf) {
    // The setup copies the dependency from the repository's own untracked file, so no view is needed.
    writeFileSync(join(repo, 'dep.js'), "export const ok = 'dep ok'\n")
    git(repo, 'add', 'dep.js')
    git(repo, 'commit', '-q', '-m', 'dep')
  }
  const home: Home = restartOf ?? { db: join(temp('system-checks-'), 'system.db'), root: temp('system-worktrees-') }
  const ctx = new Context()
  const agent = new WritingAgent()
  const config: Config = { workers: [writer(repo)], worktreeRoot: home.root, worktreeSetup: [{ repository: repo, commands: SETUP, ...setup }], ...extra }
  const fibers = [
    ctx.plugin(Store, { path: home.db }), ctx.plugin(Artifacts, {}), ctx.plugin(EventLog, {}), ctx.plugin(Leases, {}), ctx.plugin(Egress, {}),
    ...(listed ? [ctx.plugin(StoreApprovals, { policies: [policy(listed)] })] : []),
    ctx.plugin(WorkerRouter, {}), ctx.plugin(AgentRuntimeRegistry), ctx.plugin(AgentWorkers, config),
  ]
  await Promise.all(fibers)
  ctx.agentRuntimes.register(agent)
  let stopped = false
  /** Stop the daemon (its store kept): what a restart starts from. */
  const stop = async (): Promise<void> => {
    if (stopped) return
    stopped = true
    for (const fiber of [...fibers].reverse()) await fiber.dispose()
  }
  cleanups.push(stop)
  /** One writing run of `agent:dev` in workflow run `runId`; its worktree and the exact tree it left. */
  const write = async (runId: string, prompt = 'write'): Promise<{ workspace: string; subject: { ref: string; version: string } }> => {
    const source = ctx.workers.source('agents')!
    const started = source.start({ key: `${runId}-${Math.random()}`, worker: 'agent:dev', prompt, sessionId: `ses_${runId}`, runId, requirement, decisions: { tier: 'sha256:0', route: 'sha256:0' } as never })
    const done = await source.wait(started.id, 30_000)
    expect(done, JSON.stringify(done.error)).toMatchObject({ status: 'completed' })
    const workspace = agent.runs.at(-1)!.workspace
    const { subject } = captureGitSubject(workspace)!
    return { workspace, subject: { ref: subject.ref, version: subject.version! } }
  }
  const check = (runId: string, at: { workspace: string; subject: { ref: string; version: string } }, checks: RunCheck[] = ['tests', 'lint']) =>
    ctx.workers.check!({ runId, workspace: at.workspace, subject: at.subject, checks, classification: 'operator-shared' })
  /** The checks as this source runs them, with `options` (the test's view of the moment a command ended). */
  const checksWith = (options: RunChecksOptions) => new RunChecks(ctx, new Worktrees(ctx, home.root), loadSetups(config.worktreeSetup, [repo]), join(home.root, '.setup'), options)
  return { ctx, write, check, stop, home, checksWith, setupHash: loadSetups(config.worktreeSetup, [repo]).get(repo)!.hash }
}




const TESTS = 'node test.mjs'

describe('a workflow run\'s checks (worktreeSetup checks, T151)', { timeout: 60_000 }, () => {

  it('answers nothing for a worktree it does not hold, so another source may (ADR-0063)', async () => {
    const repo = repository()
    const { check } = await boot(repo, { checks: { tests: TESTS } }, null)
    expect(await check('run_none', { workspace: '/nowhere', subject: { ref: 'a'.repeat(40), version: 'b'.repeat(64) } })).toBeUndefined()
  })

  it('refuses at load a check no policy can require, a command the policy cannot match word for word, and a deadline out of bounds', () => {
    const repo = repository()
    mkdirSync(join(repo, 'x'), { recursive: true })
    const load = (setup: Record<string, unknown>) => () => new AgentWorkers(new Context(), { workers: [writer(repo)], worktreeSetup: [{ repository: repo, commands: ['true'], ...setup } as never] })
    expect(load({ checks: { review: 'true' } })).toThrow(/checks names review; a check is one of tests, typecheck, lint/)
    expect(load({ checks: { tests: 'pnpm test && rm -rf /' } })).toThrow(/the tests check's command has a shell metacharacter/)
    expect(load({ checks: { lint: 'pnpm  lint' } })).toThrow(/the lint check's command has an empty word 2/)
    expect(load({ checks: ['pnpm test'] })).toThrow(/checks maps a check name to its command/)
    expect(load({ checkTimeoutSeconds: 0 })).toThrow(/checkTimeoutSeconds/)
    expect(load({ checkScratch: ['../outside'] })).toThrow(/checkScratch names up to 32 relative paths inside the worktree/)
    expect(load({ checkScratch: ['.git/hooks'] })).toThrow(/none in \.git/)
    expect(load({ checkScratch: ['node_modules', 'node_modules/.cache'] })).toThrow(/checkScratch names node_modules\/\.cache and another that holds it/)
    expect(loadSetups([{ repository: repo, commands: ['true'], checkScratch: ['node_modules/.vite'] }], [repo]).get(repo)).toMatchObject({ checkScratch: ['node_modules/.vite'] })
    // Loaded: each command as argv, and none of it in the setup's hash, so a setup's approvals stand when its checks change.
    const plain = loadSetups([{ repository: repo, commands: ['true'] }], [repo]).get(repo)!
    const checked = loadSetups([{ repository: repo, commands: ['true'], checks: { tests: 'corepack pnpm test:affected' }, checkTimeoutSeconds: 3600 }], [repo]).get(repo)!
    expect(checked).toMatchObject({ checks: { tests: { line: 'corepack pnpm test:affected', argv: ['corepack', 'pnpm', 'test:affected'] } }, checkTimeoutSeconds: 3600, hash: plain.hash })
    expect(plain).toMatchObject({ checks: {}, checkTimeoutSeconds: 1800, checkScratch: [] })
    // T235: the stall bound and the dependency files, neither in the hash.
    expect(load({ checkStallSeconds: 0 })).toThrow(/checkStallSeconds is 1 to 3600/)
    expect(load({ dependencyFiles: ['packages/package.json'] })).toThrow(/dependencyFiles names up to 32 file names, each a plain name/)
    expect(load({ dependencyFiles: ['package.json', 'package.json'] })).toThrow(/dependencyFiles names a file twice/)
    expect(plain).toMatchObject({ checkStallSeconds: 300, dependencyFiles: ['package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml', '.npmrc', '.pnpmfile.cjs'] })
    const watched = loadSetups([{ repository: repo, commands: ['true'], checkStallSeconds: 60, dependencyFiles: ['Cargo.toml', 'Cargo.lock'] }], [repo]).get(repo)!
    expect(watched).toMatchObject({ checkStallSeconds: 60, dependencyFiles: ['Cargo.toml', 'Cargo.lock'], hash: plain.hash })
  })

  it('runs a check with pnpm\'s verify-deps-before-run off and offline, and a setup offline, so neither starts an install or waits on a network (T235)', () => {
    // pnpm 11 and later read only the pnpm_config_ names; npm and earlier pnpm the npm_config_ ones.
    expect(noInstallEnvironment()).toMatchObject({ pnpm_config_verify_deps_before_run: 'false', pnpm_config_offline: 'true', npm_config_verify_deps_before_run: 'false', npm_config_offline: 'true' })
    expect(setupEnvironment()).toMatchObject({ pnpm_config_offline: 'true', npm_config_offline: 'true' })
  })

  // The pnpm that runs this suite (`pnpm test`), when one does: it reads the check environment as
  // verify-deps-before-run off and offline (an npm_config_ name alone, pnpm 12 ignores).
  const pnpm = process.env.npm_execpath && basename(process.env.npm_execpath).startsWith('pnpm') ? process.env.npm_execpath : undefined
  it.skipIf(!pnpm)('a check\'s environment is read by the pnpm that runs this suite as verify-deps-before-run off and offline (T235)', () => {
    const get = (key: string): string => execFileSync(pnpm!, ['config', 'get', key], { env: noInstallEnvironment(), encoding: 'utf8', timeout: 30_000 }).trim()
    expect(get('verify-deps-before-run')).toBe('false')
    expect(get('offline')).toBe('true')
  })

  it('reads the packages an offline install lacked from what pnpm said, and tells another failure apart (T235)', () => {
    expect(missingPackages(' ERR_PNPM_NO_OFFLINE_TARBALL  A package is missing from the store but cannot download it in offline mode. The missing package may be downloaded from https://registry.npmjs.org/@scope/is-2-odd/-/is-2-odd-3.0.1.tgz.')).toEqual(['@scope/is-2-odd@3.0.1'])
    expect(missingPackages(' ERR_PNPM_NO_OFFLINE_META  Failed to resolve left-pad@^1.3.0 in package mirror /store/metadata/registry.npmjs.org/left-pad.json')).toEqual(['left-pad@^1.3.0'])
    expect(missingPackages(' ERR_PNPM_META_FETCH_FAIL  GET https://registry.npmjs.org/@types%2Fnode: request to https://registry.npmjs.org/@types%2Fnode failed, reason: getaddrinfo EAI_AGAIN registry.npmjs.org')).toEqual(['@types/node'])
    expect(missingPackages('request to https://registry.npmjs.org failed, reason: getaddrinfo ENOTFOUND registry.npmjs.org')).toEqual([])
    expect(missingPackages(' ERR_PNPM_OUTDATED_LOCKFILE  Cannot install with "frozen-lockfile" because pnpm-lock.yaml is not up to date with packages/greet/package.json')).toBeUndefined()
  })
})
