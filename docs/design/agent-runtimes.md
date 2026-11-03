# Agent runtimes (Claude Code, Codex, ACP agents, the Antigravity CLI as Workers)

> Target state. Seam: `ctx.agentRuntimes` ([plugin model](../architecture/plugin-model.md#seam-catalog)).
> Requirements: REQ-WRK-5, REQ-WRK-6. Decision: [ADR-0009](../decisions/adr/0009-claude-and-codex-first-class.md).
>
> Implemented in [`agent-runtime-core`](../../packages/agent-runtime-core/README.md),
> [`agent-workers`](../../packages/plugins/agent-workers/README.md), and the four runtime plugins
> below. Differs from target: `persistent-conversation` rests on the probe's `resume` flag, not on a
> resume conformance test (for a review member's steps on a runtime without `resume`, on the
> source's exact replay); a started run is never reconciled from the agent's own records: it fails
> as `reconciliation_failed` once a liveness verdict finds it gone ([restart and liveness](#restart-and-liveness)),
> except a run the host's own stop cut, which resumes ([turn semantics](#turn-semantics)); only Claude
> Code reports its agent process, so other runtimes' started runs show as `unknown`; usage is not
> reconciled from the agent's session transcript; ACP agents cannot ask a [tool gate](#tool-gate), so
> the `agents` source admits none of their Workers; the Antigravity CLI gates only on an agy version
> verified live (1.4.6), offers no sandbox on any other, and has no [identity reader](#identity-readers);
> the Codex and Claude Code readers rest on fields seen on this host and on fixtures, not on a
> supervised check on the operator's real accounts; and until the operator applies the
> [move from hand-named rows](#migration-from-hand-named-rows), hand-named Workers run in their
> runtime's own home, also while its account is `unverified` (REQ-ACC-11 holds for derived Workers).

An **agent runtime** is an external coding agent that `system` drives as a Worker; the counterpart
of the [gateways](gateways.md), where the same agents act as clients. The `agent-runtimes`,
`runtime-claude-agent-sdk`, and `agent-workers` rows are on by default, with no Worker until the
operator names a repository ([runbook](../operations/runbooks.md#agent-workers)). The Codex, ACP,
and Antigravity CLI rows are off ([turn one on](../operations/runbooks.md#turn-an-off-row-back-on));
the `api-first` preset turns them on.

## Providers

| Provider plugin | Kind | Backed by | Policy holder |
|---|---|---|---|
| [`runtime-claude-agent-sdk`](../../packages/plugins/runtime-claude-agent-sdk/README.md) | `claude-agent-sdk` | Claude Agent SDK, on the installed `claude` | exact built-in tools; file tools pre-approved inside the workspace; `Bash` in `workspace-write` only, inside the SDK's sandbox ([confined commands](#confined-commands)); own home; no settings files, disk hooks, or MCP servers; the run's tool gate as its one PreToolUse hook |
| [`runtime-codex-sdk`](../../packages/plugins/runtime-codex-sdk/README.md) | `codex-sdk` | Codex SDK, on the installed `codex` | Codex's sandbox (read-only or workspace-write); approvals `never`; network, web search, and features that add unhooked tools off; no terminal; own Codex home, no MCP server of its own; System's [workspace reads server](#the-workspace-reads-server) on every run; the run's tool gate as its one PreToolUse hook, via a private channel ([Codex's gate](#codexs-gate)) |
| [`runtime-acp`](../../packages/plugins/runtime-acp/README.md) | `acp:<name>` | ACP SDK, with an agent subprocess | client side: permission requests refused, reads confined to the workspace, no writes or terminals advertised; no tool gate (refused) |
| [`runtime-antigravity-cli`](../../packages/plugins/runtime-antigravity-cli/README.md) | `antigravity-cli` | installed `agy`, print mode (stream-json); no SDK | its PreToolUse hook bridged to the run: the runtime's own rules (reading and file-editing tools only, no command; every location inside the workspace), then the run's gate; own home (`HOME`), no MCP server, plugin, or other hook; a sandbox only on an agy version verified live ([ADR-0043](../decisions/adr/0043-antigravity-cli-workers-gated-on-a-version-verified-live.md)) |

ACP is the generic path for any ACP-speaking agent, not the primary path for Claude or Codex.

Each provider adapts **behavior** to the seam. SDK objects such as sessions, threads, and events stay
native; only their handles cross the seam ([INV-7](../architecture/invariants.md#inv-7-no-mirrored-protocol-objects)).

## Seam contract

```ts
abstract class AgentRuntimes extends Service {     // ctx.agentRuntimes
  abstract register(provider: AgentRuntimeProvider): void;  // for the plugin's lifetime
  abstract get(kind: string): AgentRuntimeProvider | undefined;
  abstract list(): string[];
  abstract confinement(bind?: { readOnly?: string[]; writable?: string[] }): Confinement;
}

interface AgentRuntimeProvider {
  readonly kind: string;                    // "claude-agent-sdk", "codex-sdk", "acp:<name>", "antigravity-cli"
  readonly title?: string;                  // product name for people, shown only (below)
  readonly home?: string;                   // its own configured home, adopted as slot 1 (below)
  probe(options?: { home?: string }): Promise<RuntimeEvidence>;  // a named home: through probeIn only
  run(spec: RunSpec, signal: AbortSignal,
      onHandle?: (nativeHandle: string) => void,
      observer?: RunObserver): Promise<RunResult>;
  identity?(home: string, key: Uint8Array): Promise<IdentityReading>;  // who is signed in (below)
  loginCommand?(home: string): { command: string; args: string[]; env: Record<string, string> };
  limits?(options: { home?: string }, signal: AbortSignal): Promise<LimitReport>;  // usage report (below)
}

type LimitReport = { limits: LimitObservation[] } | { unreadable: string };  // never a throw

interface RuntimeEvidence {
  available: boolean;
  detail: string;                           // the version found, or what is missing
  version?: string;
  sandboxes: ("read-only" | "workspace-write")[];  // policies it can enforce exactly
  resume: boolean;                          // a finished run can be continued by its handle
  executes: boolean;                        // runs commands confined to the workspace
  readsConfined: boolean;                   // host state unreadable to the agent, proven now
  gatesToolCalls: boolean;                  // asks RunSpec.toolGate before every tool call
  cleanShells?: boolean;                    // starts every call's shell with no startup code
  workspaceReads?: boolean;                 // its agent gets the workspace reads server, proven to start
  readTools?: string[];                     // its own reading tools (Claude Code: Read, Grep, Glob)
  homes?: boolean;                          // runs in the home a run or probe names (ADR-0051)
}

interface RunSpec {
  prompt: string;
  workspace: string;                        // absolute root
  sandbox: "read-only" | "workspace-write";
  tools?: string[];                         // allow-list; empty: the minimal set for the sandbox
  model?: string;                           // operator configuration, never a routing input
  maxTurns?: number;
  resume?: string;                          // native handle of a conversation to continue
  toolGate?: ToolGate;                      // asked before every tool call (below)
  home?: string;                            // one account's home; refused unless `homes` (ADR-0051)
  workspaceReads?: Partial<WorkspaceReadBounds>;
}

type ToolGate = (call: { tool: string; input: unknown; callId?: string }, signal: AbortSignal) =>
  Promise<{ decision: "allow" } | { decision: "deny"; reason: string }
        | { decision: "defer"; reason: string; requestId: string }>;

interface RunObserver {                     // optional; a callback that throws changes nothing
  onProcess?(process: { pid: number }): void; // the outermost confined agent process, once
  onActivity?(at: number): void;            // the agent did something (a stream event)
}

interface RunResult extends RunMetering { text: string; nativeHandle?: string }

interface RunMetering {                     // every field optional: a missing number stays missing
  resultId?: string;                        // the runtime's identity of its result (deduplication)
  model?: string;                           // the main loop's model
  usage?: TokenUsage;                       // the whole run; inputTokens includes cached input
  models?: { model: string; usage: TokenUsage; costUsd?: number }[];  // usage is their sum
  turns?: number;
  costUsd?: number;                         // the runtime's own estimate
  limits?: LimitObservation[];              // rate-limit observations seen during the run
}

interface LimitObservation {
  window: string;                           // the runtime's own window name, opaque (INV-11)
  status: "allowed" | "warning" | "rejected";
  resetsAt?: string;                        // ISO time
  usedPercentage?: number;
  observedAt: string;
}
```

A provider's `title` (optional, plain text on one line, at most 64 characters, `titleOf`) is the only
place a runtime's product name is written. It shows in the roster's display names and the account
listing ([display names](roster.md#display-names)); nothing routes on it
([INV-11](../architecture/invariants.md#inv-11-no-tool-lock-in)). An ACP agent gives none and is shown
by its kind.

Workers are not providers. The `agents` Worker source ([`agent-workers`](../../packages/plugins/agent-workers/README.md)) turns each configured Worker into
a capability descriptor, a durable run, and a `report` artifact (`agent-result@1.2` with token usage, `@1.1` otherwise). The provider only drives the agent.

The workspace, sandbox, tool allow-list, model, and turn limit come only from operator configuration
([INV-6](../architecture/invariants.md#inv-6-authority-comes-from-trusted-envelopes)). Each provider maps
them onto the agent's own permission or sandbox modes. A policy that cannot be expressed exactly refuses
the run (`config_error`); it never loosens. Codex, for example, refuses a tool allow-list or a turn limit.

## Tool gate

The `agents` source gives every run a gate built from the autonomy policy (`ctx.approvals`), and the runtime asks it before each tool call
([approvals](approvals.md#a-workers-tool-calls): classification, verdicts, deferred calls). The gate comes from the source, never the agent (INV-6). Its
verdict narrows, never widens, the runtime's own policy: `allow` passes the call on, `deny` refuses it with a reason the agent is told, and `defer` stops
the run at the call until the operator answers. A deferred run fails as `config_error`, naming the request; a later run of its session makes the call once
approved. For a board task's step, a call not approved (rejected, expired, or a `command` unanswered within the workflow's `deferredCommandMinutes`,
default 10) is denied in a later run of its session, returned to the agent as the call's result, and stays denied even under a newer policy
([a deferred tool call](workflow-engine.md#a-deferred-tool-call)). A Worker whose sandbox writes its workspace is told, after its prompt, which calls its
gate lets run unasked ([asking less](approvals.md#a-deferred-call)).

A runtime that can ask the gate before every tool call reports `gatesToolCalls`; one that cannot refuses a run that carries a gate (`config_error`), and
its Workers are not admitted. Gating runtimes ask with `askToolGate` (agent-runtime-core): bounded at 30 s; a gate that throws, answers an undefined verdict,
or answers late is a deny. Claude Code compiles the gate to one PreToolUse hook, an in-process SDK callback. Codex runs its hook as a command, so it goes
through a bridge ([below](#codexs-gate)). The Antigravity CLI runs a command hook before each tool call, bridged to the run (a socket in an owner-only
directory, a per-run token, any failure a deny; [its README](../../packages/plugins/runtime-antigravity-cli/README.md)): it asks its own rules, then the gate,
and a `defer` is denied and ends the run. agy runs a tool when its hook exits 0 printing nothing, so the `hooks.json` command prints a deny itself whenever
the run's hook gives no answer. The runtime reports `gatesToolCalls` (and offers a sandbox) only on an agy version a supervised live check verified
(`VERIFIED_HOOK_VERSIONS`: 1.4.6), whose tool names (`read_file`, `write_file`, `edit_file`) the `agents` source classifies; on any other version it refuses
every run ([ADR-0043](../decisions/adr/0043-antigravity-cli-workers-gated-on-a-version-verified-live.md)). An ACP agent asks the client only for what it
chooses to, so it does not gate.

### Codex's gate

Codex 0.164 runs PreToolUse hooks as commands before each tool call, with the call as JSON on stdin
([ADR-0042](../decisions/adr/0042-codex-workers-ask-the-gate-through-a-hook-bridge.md)). The bridge is
built around how Codex treats a hook, as observed on the host:

| Codex 0.164 | So the runtime |
|---|---|
| a hook from configuration runs only when trusted (the sha256 of its definition's sorted-key JSON is recorded under its key); an untrusted hook is skipped silently | passes the hook and its trust per run as `--config` overrides (`hooks.PreToolUse`, `hooks.state`), never in a file; no other hook is trusted |
| a hook that exits non-zero (other than 2), prints unreadable output, or times out lets the tool run | ships `gate-hook.js` (Node built-ins only), which blocks on every failure (exit 2, the reason on stderr) and answers within 90 s, under Codex's 120 s timeout |
| `permissionDecision: allow` and `ask` are refused; a block is the only decision | maps `allow` to no output, so Codex's own sandbox decides; `deny` to a block with the reason; `defer` to a block with the reason and the request, then ends the run |
| `exec_command` is reported as `Bash` with `command` only; `apply_patch` with the patch as `command`; `view_image` with `path` | classifies them by these names ([approvals](approvals.md#how-a-call-is-classified)) |
| `write_stdin` writes to a running command's terminal without asking a hook | hides `/dev/ptmx` and `/dev/pts`, so no session gets a terminal |
| hosted tools (web search, image generation) run at the model's provider; apps, plugins, and subagents add tools outside the run | turns web search off and keeps those features off (`FEATURES_OFF`); a configuration that turns one on, or holds `hooks`, is refused |

- **The channel.** Per gated run, a unix socket in a fresh owner-only directory under
  `<DSH_HOME>/system/run`, bound read-only into the run's confinement with the hook script, `node`, and a
  256-bit key (`SYSTEM_CODEX_GATE_SOCKET`, `SYSTEM_CODEX_GATE_KEY`). Codex's own commands never get them
  (`shell_environment_policy.exclude`). The hook sends the key and its input on one connection and reads
  one answer. The bridge denies a wrong key, a non-PreToolUse input, a call from another directory than
  the run's workspace, and any call after a defer. It bounds the input (16 MiB), the connections at once
  (16), and each connection's time. The directory, socket, and launcher are removed when the run ends.
- **Reading through its shell.** Codex has no file-reading tool: it reads with `exec_command` (`cat`, `sed -n`, `rg`), reported as `Bash`. The gate
  classifies a read-only inspection command inside the workspace as `read`, as it does Claude Code's `Read` and `Grep`, so under a policy where reads run,
  a Codex Worker reads without asking. Every other command stays `command`, by its exact argv. The forms are fixed and matched word for word, after the
  metacharacter and empty-word refusals: `cat`, `head`, `tail`, `wc`, `ls`, `stat`, `file` with a few options each; `sed -n <a>[,<b>]p <path>`; `rg` and
  `grep` with allowed options (never `--pre`, `-f`, `-z`, `-L`); and `find` with only `-name`, `-iname`, `-path`, `-type`, `-maxdepth`, `-mindepth`. Every
  path word is absolute, holds no `..`, and is inside the workspace on disk, symlinks followed; at least one is named. The hook reports `command` but not
  `workdir`, so a relative path, or a form with no path (`ls`, `rg foo`, `find`), stays `command`. So does `git`, except its history reads (`git log` by ref
  or range, `git show <rev>[:<path>]`, `git diff <a> <b>`, `git branch --list system/run/<runId>`), which are judged as a listed command is judged
  ([approvals](approvals.md#how-a-call-is-classified)). They are reads only under a runtime that enforces clean shells
  ([below](#an-agents-shells-read-no-startup-code)). Codex is not one: `exec_command` takes a `shell` and a `login` argument the hook does not see, so under
  Codex every `Bash` call is a `command` (but for one test file, below). Its Workers read through the
  [workspace reads server](#the-workspace-reads-server). No tool may write git's own data (`.git` anywhere in the path, as written or on disk): that changes
  only by a command the operator approved, or by the operator.
- **One test file, with readable output.** The whole-suite command (`corepack pnpm test:affected`) prints
  more than a Worker's tool result keeps, so a Worker could not see which test failed. Under any runtime, the
  gate classifies exactly `corepack pnpm vitest run <path>`, its path a test file (`*.spec.ts`, `*.test.mjs`, …),
  as a `workspace-write` when the path is absolute, holds no `..`, and is inside the run's worktree on disk
  (links followed). It runs unasked wherever the policy lets a workspace write run, with no line on the
  commands list. A path outside the worktree, or a relative one, is refused (`outside-workspace`: the gate
  does not see the directory a command runs in). Any other word, option, or a second path leaves it a
  `command`. A writing Worker's brief tells it to name several test files in one command.
- **A command is carried whole.** A Bash command of at most 1,500 characters (`COMMAND_MAX`) is put whole in
  its approval request's `consequences` (the record's bound is 2,000), beside a summary cut at 500, so the
  approvals API and /ui show what would run. A longer command is refused at once (`invalid-input`), never cut.
  The operator's note on a rejection is the denial's tool result, after its words.
- **A tool that ran past the gate.** Codex reports each tool's work as an item (a command, a file change, an
  MCP call, a web search). Each item must be accounted for by a call the gate allowed; one that is not (a hook
  that failed and let the tool run) stops the run as `config_error`. That is detection after one call, not
  prevention: the proof below is the prevention.
- **A deferred call.** Codex's hooks cannot end a turn, so the runtime ends the run once the gate defers: the
  call is blocked, its reason naming the request is the call's output, every later call is denied, and the Codex
  process is stopped. A later run of the same thread makes the call again; the gate finds the approval for that
  exact input.
- **The proof.** The probe reports `gatesToolCalls` only after one turn on this host, with the run's configuration, hook, and confinement, against a scripted
  model served on loopback (no account or provider reached; `--ephemeral`). The first request offers only tools Codex runs itself; a command the probe's gate
  denies comes back as the hook's block and does not run; a terminal command the gate allows starts no terminal session; the turn ends with the scripted
  answer. Otherwise `gatesToolCalls: false`, the reason in `detail`, and no Codex Worker is admitted. A Codex upgrade that changes any of this fails the proof.

## Workspaces

A run works in its Worker's configured workspace, unless the Worker is configured with `worktreePerRun`.
Then each run belonging to a workflow run (the engine names it in `WorkerStart.runId`) works in that run's
own git worktree, on the branch `system/run/<runId>`, never in the repository's main working tree
([INV-15](../architecture/invariants.md#inv-15-one-writer-per-subject)). There is one worktree per repository
and workflow run. The first agent run creates it from the repository's HEAD (or, for a board task's next
attempt, from the work its previous attempt left: [carrying](#carrying-an-earlier-runs-work)); every later run
of that workflow run on that repository works in it, reviewers included. So exact-subject review and
remediation ([workflow engine](workflow-engine.md#exact-subject-gates)) bind to the tree the writer changed.
A worktree under the DSH home is bound back like any workspace: writable for `workspace-write`, read-only for
`read-only`. A brief's files (`brief@1.2` `files`, such as a board task's `TASKS.md`) are written into the
worktree before the agent starts, under a git-ignored `.system/`, read-only and never read back
([TASKS.md in a run's workspace](workflow-engine.md#tasksmd-in-a-runs-workspace)). A run with no worktree gets none.

### A worktree's setup

> Decision: [ADR-0058](../decisions/adr/0058-a-run-worktree-is-set-up-offline-before-its-agent-starts.md).
> Code: [`agent-workers`](../../packages/plugins/agent-workers/README.md) (`src/setup.ts`).

A new worktree is a checkout with no dependencies, and a Worker's commands have no network
([confined commands](#confined-commands)). So the operator may declare, per repository, a **setup**
(`worktreeSetup`): commands the `agents` source runs in a workflow run's worktree before any agent works
in it, so the repository's checks can run there offline.

```yaml
worktreeSetup:
  - repository: /home/me/src/project      # a worktreePerRun Worker's workspace
    commands:                             # words split on single spaces; no shell
      - corepack pnpm install --frozen-lockfile --offline --store-dir=/home/me/.local/share/pnpm/store/v11 --package-import-method=copy
    views:
      - { path: /home/me/.local/share/pnpm/store/v11, copy: [index.db, index.db-wal], readOnly: [files] }
    timeoutSeconds: 600
```

- **When.** Before an agent run that works in a workflow run's worktree starts, after the worktree is
  acquired and before the brief's files are written, unless the worktree's setup already ran under the
  definition loaded now (its hash, stored on the worktree). So it runs once per worktree and definition;
  later runs, reviewers included, work in the worktree as it is. A changed definition runs it again, and a
  worktree added again from its branch is set up again. One setup at a time per worktree. A run of no
  workflow run works in the configured workspace and gets none.
- **The policy allows each command** by its exact argv, as for a Worker's `Bash` call
  ([approvals](approvals.md#a-worktrees-setup)): `forbid` refuses the setup; `auto` and `notify` run it; `ask`
  waits on one request per command, bound to the worktree and the setup's hash, used once. With no queue loaded,
  nothing runs.
- **Confined.** Each command runs under the read confinement with more: the host's file system read-only
  except the worktree (`confinedCommand`'s `readOnly`), no network but its own loopback (`network: false`), the
  worktree as its directory, a private `/tmp` as `TMPDIR`, its own PID namespace and session, the daemon's scrubbed
  environment (`childEnvironment`), and the setup's deadline (SIGKILL). The confinement is proven on the host
  (`proveConfinement`) before each setup.
- **Views.** A host directory the setup must write, whose content must stay the host's (a package store whose
  index is a database opened for writing), is a view. The setup sees, at its path, a fresh private directory under
  `<worktreeRoot>/.setup`, with the files `copy` names copied in (never through a link, at most 1 GiB each; a file
  the host lacks is not copied) and the `readOnly` paths bound back read-only. It is removed when the setup ends. A
  view of, or holding, a path hidden from agents, one reached through a link, or one overlapping the worktree is
  refused. The installer copies into the worktree and never links, so a Worker cannot change the host's store.
- **Fails closed** ([INV-2](../architecture/invariants.md#inv-2-fail-closed)). A setup not allowed, waiting for an
  approval, or failing (exit code or signal, deadline, a view or the confinement refused) fails the run as
  `config_error`, unsent, its message naming the command and the last part of its output. It is never skipped: the
  next run of the workflow run tries again.
- **Recorded** ([INV-13](../architecture/invariants.md#inv-13-every-decision-is-an-artifact)): a `gate` decision of
  rule `agent-workers.worktree-setup` (`start`, or `refuse` with why; its inputs the policy's decisions and the
  approvals used; its detail the worktree, the setup's hash, and the failed command), and an
  `agent-workers.worktree.setup` event (`ran`, `refused`, or `waits`).
- **Checked at load** (`config_error`): a setup for a repository no `worktreePerRun` Worker works in, or two for one
  repository; a command the policy could not list (empty word, shell metacharacter, over 200 characters) or more than
  16 commands; a view with a relative path, a name that is not plain, or a climbing path. A `generated` declaration
  with no path or more than 32; a path `globProblem` refuses (absolute, climbing, a character outside letters, digits,
  `. _ @ + -` and `*`, `**`, or a trailing `/`), or starting at `.git`, `.system`, or `*`, or named twice; 0 or more
  than 16 commands; a command the policy could not list.
- **Generated files** (`generated: { paths, commands }`, optional): the files the repository generates and the commands
  that make them. A landing whose merge conflicts only in them runs those commands in the run's worktree, in this
  confinement and views, instead of refusing ([landing a worktree](#landing-a-worktree)). Not part of the setup's hash.

What the setup writes stays in the worktree. Ignored files (`node_modules/`) are not in the run's subject and go
with the worktree at its retention. A carried worktree is set up as a new one, on the tree it holds
([carrying](#carrying-an-earlier-runs-work)).

Worktrees are bounded ([INV-9](../architecture/invariants.md#inv-9-everything-is-bounded)): once every agent run of a workflow run has finished and the
retention has passed, a `retention` decision ([INV-13](../architecture/invariants.md#inv-13-every-decision-is-an-artifact)) retires the worktree. Its changes are
committed on its branch and it is removed. A branch is never deleted, nothing is forced, and a worktree that cannot be committed or removed stays for the next
sweep. The retention reads agent runs only, never the board: a task's worktree retires `worktreeRetentionHours` after its last agent run ended, whatever the
attempt's outcome. The [`agent-workers` README](../../packages/plugins/agent-workers/README.md) has every rule.

### The operator's removal of run worktrees

`agent_worktrees` (operator scope, `mcp-agent-runs@1.1`; `system worktrees`) lists every worktree not removed: its
workflow run, branch, state (`in-use` while an agent run of its workflow run is queued or running, `held` while one
ended without being known to be gone, `finished` otherwise), what it holds (`clean`, `uncommitted`, `gone`, or
`not-intact`), and when the retention removes it. At most 100, oldest first, with the count of all
([INV-9](../architecture/invariants.md#inv-9-everything-is-bounded)).

`agent_worktrees_remove` (`system worktrees remove`) removes the finished ones now, all or one workflow run's:

- **Never discarding a change.** Only `finished` worktrees holding nothing uncommitted are removed, or, with
  `commitChanges`, once their changes are committed on their branch as the retention commits them. An in-use or held
  one stays (a held run is freed first, [freeing what a run holds](#freeing-what-a-run-holds)), and so does one not
  intact (git is not run there). The branch always stays; nothing is forced.
- **Recorded first** ([INV-13](../architecture/invariants.md#inv-13-every-decision-is-an-artifact)): one `retention`
  decision of the operator's (decider `operator.worktrees`, not deterministic, the note as rationale) names every
  worktree planned for removal and is stored on each one removed. With none to remove, nothing is decided. Each is
  looked at again alone before removal, so one an agent run took meanwhile stays.
- **Bounded:** at most 50 worktrees a call; the output says how many it did not look at. An output its schema refuses
  (a defect) decides and removes nothing.

### Landing a worktree

> Decision: [ADR-0060](../decisions/adr/0060-an-accepted-result-lands-on-the-operators-merge-approval.md)
> (amended by [ADR-0068](../decisions/adr/0068-an-accepted-result-is-rebased-onto-its-target-and-checked-again-before-it-lands.md):
> a moved base is rebased and re-verified). Code: [`agent-workers`](../../packages/plugins/agent-workers/README.md)
> (`src/worktrees.ts`); the engine asks ([landing an accepted result](workflow-engine.md#landing-an-accepted-result)).

The `agents` source answers `land(step)` on the `workers` seam for the worktrees it holds, one change at a time per repository:

- **`commit`**: only while no agent run of the workflow run is unfinished or not known to be gone (else it waits: INV-15), the worktree is intact and on its branch,
  and it is still the accepted subject (`git:<HEAD>:<hash of every change on top>`, captured again after `.system/` is removed). Then `git add --all` and one commit
  by `system <system@localhost>`, with the engine's message and a `System-Subject` trailer. A moved tree is refused, and nothing is committed. A clean worktree whose
  HEAD is that commit, on top of the accepted HEAD, is found committed (a restart). The answer names the branch head, the base, whether the base already holds the
  head, and the `git diff --stat` against it.
- **`merge`**: only while the branch is at the approved head, the repository has the approved base checked out at the
  approved base, and its tracked files are clean. Then `git merge --no-ff` of the branch, authored by the system, hooks off.
  A base that already holds the head is found merged (a restart). A conflict is aborted (`git merge --abort`) and the
  repository checked to be as it was. Nothing is forced, reset, deleted, or pushed.
- **A conflict only in generated files**: when the setup declares generated files (`worktreeSetup[].generated`: path patterns and the commands that make them)
  and every conflicted path is one of them, the merge is made again in the run's worktree, where the setup installed what the commands need. This is done only
  while the worktree is intact, no agent run of its workflow run is unfinished or not known to be gone (INV-15), and it is clean, on its branch, at the approved
  head. Detached at the approved base, the branch is merged with `--no-commit`; a conflict outside the declared paths refuses. Each conflicted file is taken from
  either side (the run's, else the base's) and staged. The commands then run in order, each judged by the autonomy policy as a `command` with its exact argv, and
  run only when allowed unasked, in the setup's confinement (no network) within its deadline, with pnpm offline and verify-deps-before-run off. They must exit 0,
  change no file but declared ones, and leave the index as it was. The changed files are staged and the merge committed by the system, its parents checked to be
  the base and the head. The commands then run again and must change nothing. The base, checked again to be the approved branch at the approved commit with clean
  tracked files, is fast-forwarded (`git merge --ff-only`) to that commit, so there is one merge commit, as without a conflict. The answer is `merged` with
  `regenerated` (the files, the commands, and the autonomy decisions they ran on), named in the engine's merge decision (INV-13). The worktree is put back on its
  branch in every case (`git merge --abort`, then `git checkout --force <branch>`). A file a refused command made outside the declared paths stays there, untracked,
  named in the refusal. A conflict elsewhere, a command not allowed, failing, or changing another file (ignored files included: they are listed with size, inode,
  and times before the commands), a repeat that changes anything, or a moved base refuses, leaving the repository as it was (INV-2). A restart that finds the
  worktree off its branch puts it back first only when it is this landing's own merge and nothing outside the declared paths is uncommitted there but files the
  merge took whole from the head; otherwise it refuses and leaves the worktree as it is. If the base has not moved, the merge is made again.
- **`commit`'s `fork`** ([ADR-0068](../decisions/adr/0068-an-accepted-result-is-rebased-onto-its-target-and-checked-again-before-it-lands.md)):
  the answer also names where the head forked from the base (`git merge-base`); the engine rebases when that is not the
  base's head. A clean worktree whose HEAD is the system's rebase commit of the landing commit (followed back through
  `System-Rebased-From` trailers, at most 8) is found committed too.
- **`rebase`** (ADR-0068), only while no agent run of the workflow run is unfinished or not known to be gone, and the worktree is intact and on its branch. It
  stays on its branch throughout, so a writing step can work in it. `start`, from a clean worktree at the head with the base where the step says: the head is
  kept as `refs/system/rebase/<runId>/<head>`; the branch moves to the base (`git update-ref`, only from the head); tracked files become the base's
  (`git read-tree -u --reset HEAD`); the change is replayed (`git merge --squash` of the kept head). A conflict only in declared generated files takes a side.
  Then every change is staged, the declared generated files are made again as for a merge (which may change no other file, no ignored file, nor `.git`), and
  the system makes one commit: the head's message, the engine's line, and `System-Rebased-From: <head>` and `System-Rebased-Onto: <base>` after them. A
  conflict in another file is left uncommitted in the worktree, its files marked `conflicted`, with the base's commits since the fork (`git log --format='%h %s'
  <fork>..<base>`, at most 20). `resolved` commits it the same way only when no file the replay or its resolution changed holds a `<<<<<<<` or `>>>>>>>` line.
  `abandon` moves the branch back to the head and makes the tracked files the head's; untracked files stay, named. Asked again, each call finds its own work: a
  branch at the base with the head kept is a rebase begun; one at the system's rebase commit of the head is one done, answered only from a clean worktree (else
  refused as `moved`, left as it is). So the subject `rebased` names, which the landing checks again, is the committed tree that lands. A failed regeneration
  puts the branch back at the head and refuses. The retention never commits a worktree with unmerged paths: it stays.

So the repository's main working tree is written only by a merge the operator approved, or the policy allowed, at the
exact SHAs it was asked on. The worktree stays until the retention removes it, clean, and its branch always stays. The
run's own branch is the one ref the source moves other than by a commit on top: a rebase replays it onto the base, its
earlier head kept.

### A run's change, for the operator's review

`changes(runId)` on the `workers` seam reads each worktree of that workflow run, read only, so the operator sees what a result changed before the verdict
([web UI API](../reference/web-ui.md#reviews)). The change is read against the merge base with the repository's checked-out branch (so a base merged into
the branch is not counted), committed and uncommitted. Once the branch is in the base (a landed run), it is read against the commit the worktree was cut at,
recorded when the worktree is made. A worktree made before that was recorded, whose head the base has moved past, cannot tell its change from what was
merged, and throws. Each file's status, lines added and removed, and unified diff are given (`-M`, no colour, no external diff or textconv, `a/` and `b/`
prefixes), each diff by its own `diff --git` line. Untracked files the repository does not ignore show as added lines. git runs with `--no-optional-locks`,
no hooks, through the worktree's own administrative directory, after the same check as a landing. An untracked file is opened one directory at a time from
the worktree's own descriptor, never through a link (`O_NOFOLLOW`); a link or special file is named, not read. A retired worktree's change is read from its
branch. Bounded (`CHANGE_BOUNDS`, INV-9): 200 files, 64,000 characters of one file's diff, 512,000 in all. Every changed file is counted, only the first 200
are kept, and a diff past its bound is passed over unkept, so a patch of any size reads as cut, never as unreadable. A worktree that cannot be read throws,
and the registry names its source as unread, never as no change (INV-2).

### Carrying an earlier run's work

> Decision: [ADR-0061](../decisions/adr/0061-a-tasks-next-attempt-starts-from-the-work-its-previous-attempt-left.md).
> Code: [`agent-workers`](../../packages/plugins/agent-workers/README.md) (`src/worktrees.ts`); the engine decides and asks
> ([starting from the previous attempt's work](workflow-engine.md#starting-from-the-previous-attempts-work)).

`carry(step)` on the `workers` seam starts a board task's next attempt from the tree its previous attempt's writing step
left. One change at a time per repository:

- **Checked first; nothing changes on a refusal:** the new run has no worktree or branch yet (`exists`); the earlier worktree is still there (`gone`); no agent
  run of its workflow run is unfinished or not known to be gone (`busy`, INV-15); it is intact and on its branch (`failed`); the repository's HEAD is still the
  commit the tree is on (`base-moved`); it is still exactly the subject its writing step left (`moved`); and it holds a change (`empty`).
- **The earlier tree is committed on its own branch**, as the retention would commit it: `git add --all` and one commit by
  `system <system@localhost>` with the engine's message and `System-Subject` and `System-Carried-To` trailers.
- **The new worktree is cut at the same base and given the tree:** added on `system/run/<runId>` at that commit without a
  checkout, then given the commit's tree, index and files (`git read-tree -u --reset`). Its HEAD is the base and the earlier
  change is staged on it, so its subject is the base with the change on top, and a review binds to the whole change. The
  answer names the commit, its branch, the base, the new branch, and the worktree.
- **Restart:** the worktree's row records the run it was cut for (`carried_from`) before it is given the tree, and the commit
  (`carried_commit`) once it is. A carry asked again finds its work done (`carried: false`). A worktree cut but not given the
  tree is never run in (its first agent run fails unsent as `config_error`). A carry asked again gives it the tree, or, when
  the tree can no longer be given, puts it back to its base, a fresh worktree a run may use. Such a worktree holds no run's
  work (a crash between cut and reading leaves its index empty, every base file staged as deleted), so the retention and the
  operator's removal put it back to its base before retiring it, and nothing of it is committed. Put back means its index and
  files are its HEAD, and it holds nothing else. One that is not intact, or still holds files its base does not (what a
  reading cut short wrote), stays, marked, for the operator. A branch that an earlier retention committed such a tree on
  (its tip the system's `system: keep the uncommitted work of workflow run <runId>` commit, the row still marked) is never
  added again: the run's agent fails `config_error`, and the branch is left for the operator. The crash suite kills the
  daemon between cut and reading ([carry.crash.ts](../../packages/system-bundle/tests/crash/carry.crash.ts)).

Never a force, a reset of a branch, a deletion, or a push. The earlier worktree is clean afterwards and the retention removes
it as any other; its branch keeps the carry commit, which is never merged.

### A lockfile's verification

> Code: [`agent-workers`](../../packages/plugins/agent-workers/README.md)
> (`src/verification.ts`, `src/setup.ts` `refresh`, `src/dependencies.ts`); switch: the `lockfile-verification` mechanism.

pnpm 12 verifies each new lockfile against its supply-chain policy, which reads the registry's full metadata. A setup run again for a result's checks has no network,
so a result that changes `pnpm-lock.yaml` fails with `ERR_PNPM_NO_OFFLINE_META` and its checks never run. Once a lockfile has been verified online on the
host, the same offline install passes. A setup refused `dependency_unavailable` for **only that** (its output holds `ERR_PNPM_NO_OFFLINE_META`, no missing
tarball, and no unreachable registry) is not the end when the repository declares `worktreeSetup[].lockfileVerification`: `registry` (an `https://` URL) and
`cacheDir` (pnpm's metadata cache, an absolute path outside every path hidden from agents). **Every setup run of that repository sees `cacheDir` read-only**,
so the offline install finds what the verification wrote. Only the verification writes it.

- **One request per lockfile digest.** The digest is the hash of the worktree's `pnpm-lock.yaml`; the ledger
  (`agent_lockfile_verifications`, migration 24) is keyed by repository and digest. The request is class `command`, judged
  by the policy as the verification's exact argv: the setup's failed install, which must be pnpm's own frozen install (the
  host's `pnpm` or `corepack pnpm` by name, never a path; `install` or `i` with `--frozen-lockfile`; and no other word but
  `--offline`, `--prefer-offline`, `--store-dir=<absolute path>`, `--package-import-method=<word>`, `--reporter=<word>`,
  `--silent`, and the two below). Any other command, a worktree script among them, whatever its flags, is said so in the
  refusal and never run online. The verification is that install without `--offline`, with `--ignore-scripts` and
  `--ignore-pnpmfile` added, so none of the result's own code runs while the network is open. The offline setup after it
  runs them, with no network. The subject is the exact execution (`lockfile-verification:<repository key>/<digest>`, version
  the digest's content id, the argv, the registry, the cache directory, and the deadline, INV-5). An approval runs only the
  execution it names; a reloaded setup giving the same digest is asked about anew, never run on it. The worktree is not part
  of it: every held result with this lockfile, in any run worktree of the repository, waits on the one request of its digest,
  and the first checked after approval runs it; the others find the digest verified and set up again offline. The summary and
  consequences name the argv, the registry, that the host's network is shared while it runs, the one host path it writes,
  and what rejection means (INV-12). The policy decides as for any command: `ask` opens the request, `forbid` refuses, a
  listed line (`auto`) runs unasked.
- **Nothing the result configures reaches past the registry.** Before asking, and again before running, the source reads the result's `.npmrc`,
  `pnpm-workspace.yaml`, and lockfiles against allowlists, never a list of what to refuse, so an unknown spelling refuses the verification (INV-2). An
  `.npmrc` may set only layout settings (`save-exact`, `node-linker`, …) and `registry` equal to the verification's. A `pnpm-workspace.yaml` may hold only plain
  top-level keys of a fixed list (`packages`, `catalog`, `overrides`, `allowBuilds`, …), with no flow mapping, document marker, complex key, or other top-level
  shape. A lockfile may name no URL off the registry and no git host, hold no anchor, alias, tag, escaped string, or complex key (except pnpm's own for a long
  package id), and each resolution must be pnpm's one-line `{…}` of a registry package or a local directory. A bare carriage return in any of the three
  refuses too. Anything else refuses, naming each finding; nothing is asked, and the checks stay not run.
- **Approved, the host runs it on the host's network**: in the setup's confinement (the host read-only but the worktree, the
  setup's views, and `cacheDir`, writable), the network shared for this one command, its environment naming the registry
  (`pnpm_config_registry`), scripts and pnpmfile off (`pnpm_config_ignore_scripts`, `pnpm_config_ignore_pnpmfile`), `offline`
  off, verify-deps-before-run off, and corepack forbidden to download a package manager (`COREPACK_ENABLE_NETWORK=0`), within
  the setup's deadline. A bubblewrap confinement has the host's network or none and cannot filter by host. What keeps the
  command to the registry is that it runs none of the result's code, its environment names the registry, and the result
  configures no other. The host's own pnpm configuration is the operator's; the operator filters the host's egress if that is
  not enough. The outcome is a `gate` decision of rule `agent-workers.lockfile-verification` (`verify`, `fail`, `deny`, or
  `warn`), citing the policy's verdict and the approval (INV-13). The approval is used once: the ledger row moves from `asked`
  to `running` in one statement, and only while it still holds that request for that execution.
- **Then:** on `verify`, the setup runs again offline on the result's tree and its checks run (the
  `agent-workers.worktree-setup-again` decision names the verification's). The held result's landing watch asks the checks
  again once none of the requests the refusal named (`Checked.requests`, `held.requests`) is open or batched
  ([the workflow's side](workflow-engine.md#a-result-that-changes-its-dependencies)).
- **Denied or expired:** the checks stay not run, with a reason naming the request and how it ended. A rejection is final for that digest. An expiry or
  withdrawal is reported once, and the next check on that lockfile asks anew. A verification that exited non-zero is `failed`, final for the digest.
- **Never again:** a digest `verified` is never asked about again, from any worktree or run. A setup that still fails offline
  after it says so (`verified online, now or before`) and is refused as before. Any other failure (a missing tarball, an
  unreachable registry) is `dependency_unavailable` or `failed`, and nothing runs online.
- **The switch** (`enforce.lockfileVerification`; live override `system enforce set lockfile-verification <mode>`,
  ADR-0078): `on` as above; `warn` records, once per digest, the request it would open (`option: warn`) and opens none, so the
  refusal stands; `off` does not look. How to run it: [a lockfile change](../operations/runbooks.md#a-lockfile-change).

### A run's checks

> Decision: [ADR-0063](../decisions/adr/0063-a-runs-required-checks-run-on-its-exact-result.md).
> Code: [`agent-workers`](../../packages/plugins/agent-workers/README.md) (`src/checks.ts`); the engine asks ([a run's required checks](workflow-engine.md#a-runs-required-checks)).

`check(step, signal)` on the `workers` seam runs, before a written result's acceptance, the checks the policy requires of the
result, on that run's worktree. The operator names each check's command beside the repository's setup:

```yaml
worktreeSetup:
  - repository: /home/me/src/project
    commands: [...]                       # the setup, as above
    checks:                               # tests, typecheck, lint; words split on single spaces
      tests: corepack pnpm test:affected
      lint: corepack pnpm lint
    checkTimeoutSeconds: 1800             # each check's deadline (1 to 3600)
    checkStallSeconds: 300                # no output this long: told as stalled
    checkScratch: [node_modules/.vite, node_modules/.vite-temp]    # git-ignored paths a check may write: fresh, private, discarded
    dependencyFiles: [package.json, pnpm-lock.yaml]   # a result changing one sets the worktree up again (default: pnpm's)
```

- **Set up again for the result's dependencies** ([the workflow's side](workflow-engine.md#a-result-that-changes-its-dependencies)): when the result's
  `dependencyFiles` differ from those the setup decision recorded, the setup runs again on the result's tree first (commands allowed unasked, confined as the
  setup, offline), under a `gate` decision of rule `agent-workers.worktree-setup-again`. An install lacking a package refuses the checks as
  `dependency_unavailable`, naming it. A check runs with pnpm's verify-deps-before-run off (`pnpm_config_verify_deps_before_run=false`, and its `npm_config_`
  name), offline, so it never installs. A check quiet for `checkStallSeconds` is told by an `agent-workers.check` event.
- **Only on the result's tree:** the worktree is still there (`gone`), no agent run of its workflow run is unfinished or not
  known to be gone (`busy`, INV-15), it is intact and on its branch (`failed`), and it is exactly the subject the result is on
  (`moved`). Otherwise nothing runs.
- **Each check is an `error`, never run,** when the repository names no command for it, the worktree was not set up under the
  setup loaded now, no queue is loaded, or the policy does not let its exact argv run unasked (`auto` or `notify`, as for a line
  on the studio commands list). An `ask` opens no request.
- **Confined as the setup is, but on a read-only result** (`confineIn`, its `check` mode): the host read-only, **the worktree
  too**, the setup's private views, no network, a private `/tmp`, the daemon's scrubbed environment, the confinement proven
  first. Each check runs within `checkTimeoutSeconds` (default 1800), in order. A check cannot change what it checks, not even
  for a while: a write to the worktree fails it. Its only writable places are the `checkScratch` paths, each a fresh private
  directory mounted over its path for that check alone, discarded when the check ends. Each must be ignored by git and hold
  nothing tracked (else the check is an `error`, not run), so it is never part of the subject.
- **Executed, positively:** each command starts through a fixed launcher, System's own Node (bound back read-only). It spawns
  the command with its argv as given (never parsed by a shell), and says on fd 3 `started` once the exec succeeded, or
  `exec-failed <code>`; the command gets fd 3 as `/dev/null`. The exec tells (libuv's close-on-exec handshake), never a `PATH`
  lookup: an executable whose `#!` interpreter is missing is not started, while a command that runs and exits 127 is `failed`.
  A launcher that said nothing (bubblewrap refused, launcher not run) or said `exec-failed` is an `error`, an infrastructure
  failure, never a failed check; nothing is kept, so the next ask runs it.
- **A nested confinement refused, as the command reports it:** the command is given a report file of its own, `SYSTEM_CHECK_REPORT_PATH`: a fresh, empty,
  owner-only file in the check's private directory, bound writable at the same path (a mount point, so it can be written but never replaced), read once the
  command ended (its first 4096 bytes). It is a file, not a descriptor, because every process the command starts inherits the name through any runner between
  them. A report file that cannot be read makes the check an `error`. A test suite whose nested bubblewrap is refused fails for the host, not the code: it appends
  `nested-confinement-refused: <detail>`, and its nonzero exit is an `error` (exit 0 is still `passed`), so the result is held for the operator. Nothing else makes a
  nonzero exit an `error`: a check failing on defective code is `failed`. A false report can hold a failure, never pass it.
- **Tests that did not run, as the command reports them:** a line `browser-tests-not-run: <detail>` in the same file says its
  browser tests were skipped (no usable browser in the confinement). The check keeps its outcome (`passed` or `failed`). Its
  reason says what did not run, its answer carries it as `notRun`, and the engine adds to the acceptance's reasons that the
  outcome says nothing of those tests, so a review never reads their absence as a pass. The repository's suite writes the
  line from its reporter and fails the run when it cannot
  ([testing](../engineering/testing.md#real-browser-tests-in-a-workers-confinement)).
- **What counts:** exit 0 is `passed` and any other code `failed`, only when the command said it started and the tree, captured
  again after the command, is still the subject (the read-only view makes this the proof, not the guard). A tree that changed
  anyway is an `error`, and later checks are not run. A timeout or a signal is an `error`.
- **Stored per check, reused, never re-run** (INV-4): each check that ran is kept in `agent_check_runs`, keyed by the workflow run, worktree, subject, check,
  argv, and setup hash. It is `started` before its command starts (marked with the daemon, an id per start, and the cuts so far) and `done` with its record
  after. Asked again on that key, the stored record of an ended check is the answer, byte for byte. A stop of the run loses nothing: a command that ended
  before it is judged and stored as it ended. One the stop killed before its end is stored as an `error`, which this daemon never runs again. Only a command
  the confinement never started is forgotten.
- **A check the host cut runs again**: one left `started` by an earlier daemon, or killed before its end by the host's own stop
  (the engine's stop reason, or this source stopping; never an operator's stop or a lost lease), came to nothing. At the next ask
  it runs again on the same subject, under a `gate` decision of rule `agent-workers.check-cut-rerun` (the check, its command,
  the subject, the cuts) among the `check-run@1.0` evidence's inputs, told by an `agent-workers.check.rerun` event. Bounded
  (INV-9): one the host cut three times on that subject stays an `error` stored in its place. The cut count is never in the
  evidence or the answer.
- **Recorded:** one `check-run@1.0` `evidence` artifact at the run's classification, its inputs the commands' `autonomy`
  decisions; per check, the argv, exit code or signal, duration, and the last 4000 characters of output with the length and
  SHA-256 of all of it. The answer carries it.
- The checks and their scratch paths are not part of the setup's hash: changing them neither sets worktrees up again nor asks
  again about the setup's commands.
- The subject binds every untracked file's whole content, hashed in chunks whatever its size (the display bound decides only
  what a reviewer is shown). A file that changes while read, or untracked files past 8 GiB in all, leave the subject unknown, and
  nothing is accepted on it (INV-2, INV-5).

## Credentials and egress

- **Environment** ([INV-8](../architecture/invariants.md#inv-8-credentials-never-cross-upward)). An agent process starts
  without the daemon's credentials. Each provider builds its child environment with `childEnvironment` (agent-runtime-core):
  DSH's scrub of the daemon environment (credential-shaped and `DSH_*` names removed; `PATH`, `HOME`, locale, and proxy kept),
  then the variables the operator forwards **by name** (`forwardEnv`), then explicit values (`env`, never a secret). A
  credential reaches an agent only when the operator names it, and its value never sits in configuration.
- **No MCP servers.** An agent's MCP servers can run outside its sandbox, and the operator's client configuration holds the
  `system` MCP server. So a Worker attaches none. Claude Code takes no settings files and a strict, empty MCP configuration.
  Codex runs in its own home and fails closed if that home configures any MCP server, with plugins and apps off; it attaches
  only System's [workspace reads server](#the-workspace-reads-server). The Antigravity CLI fails closed if its home, or the
  workspace's customization roots, configure any server, plugin, or hook.
- **Reads** ([ADR-0024](../decisions/adr/0024-agent-workers-confined-for-reads.md)). Host state is never readable to an agent.
  `ctx.agentRuntimes.confinement()` names what to hide (the DSH home, the session's runtime directory, temporary directories,
  credential stores, every path registered with `registerSecretPath`, and operator paths) and what to bind back read-only
  (`$DSH_HOME/system/tools` and `$DSH_HOME/system/browsers`; the Worker's own home and workspace as its sandbox allows; never a
  bind that holds a hidden path). Every runtime starts its agent under bubblewrap with that confinement (`confinedCommand`: own
  PID namespace and session, `--die-with-parent`): Codex through an owner-only launcher (`writeLauncher`), ACP agents and the
  Antigravity CLI directly, Claude Code through the SDK's `spawnClaudeCodeProcess`
  ([ADR-0038](../decisions/adr/0038-confined-commands-for-claude-code-workers.md)).
- **Temporary directory.** Each confined command has a fresh tmpfs at `/tmp`, never the host's. `TMPDIR`, `TMP`, and `TEMP` name
  it, so temporary files and unix sockets (a test runner's IPC pipe) stay in it.
- **Agent homes.** Each agent runs in its own home (Codex's `CODEX_HOME`, Claude Code's `CLAUDE_CONFIG_DIR`, the Antigravity
  CLI's `HOME`, each under `<DSH_HOME>/system`), never the operator's login, which is hidden. The operator signs in there once.
  A probe that finds no one signed in, or cannot tell (a status it cannot read is no sign-in), reports the Worker unavailable
  ([runbook](../operations/runbooks.md#agent-workers)). Each account gets a home of its own (an enrollment slot), and a run binds
  back only its own account's home ([agent accounts](#agent-accounts)). Codex runs with the terminal devices hidden
  ([Codex's gate](#codexs-gate)). Each probe reports `readsConfined`, proven on the host by `proveConfinement`, and the
  `agents` source checks it again before each run.
- **A browser inside the confinement.** A Worker's browser tests run on the host's Chrome: a system Chrome or the developer cache (left readable), or the managed
  build, bound back read-only and named by `SYSTEM_BROWSERS_DIR` (set with `--setenv`, since a child's `DSH_HOME` is scrubbed). Chrome starts without its own
  setuid or user-namespace sandbox (Patchright's `--no-sandbox`), because the confinement isolates it already. `/dev/shm` is a private tmpfs, and the tests give
  Chrome its own XDG directories in the private `/tmp`. Where no Chrome can run, the tests are skipped, never silently: each skip names why, and a check reports
  it ([a run's checks](#a-runs-checks); [testing](../engineering/testing.md#real-browser-tests-in-a-workers-confinement)).
- **A browser in a Worker's own tool call.** A writing run's commands run inside a second layer, the runtime's command sandbox,
  which the read confinement does not open: Claude Code writes only its `allowWrite` paths, Codex its writable roots.
  `toolSandboxAllowances` (agent-runtime-core) gives that layer what the confinement holds for a browser test: the managed Chrome
  readable (`allowRead`), the private `/dev/shm` writable, and the run's report file writable (below). Fonts stay on the read-only
  host; vite's `node_modules/.vite` and `.vite-temp` are in the workspace, writable already.
- **Unix sockets.** Claude Code's sandbox refuses every unix socket on Linux (a seccomp filter), which Chrome needs. The runtime's `unixSockets` (default on)
  lets a writing run's commands make them (`allowAllUnixSockets`), but only after its confinement masks every unix socket the account could connect to
  (`writableUnixSockets`): every socket a host process has bound (from `/proc/net/unix`), and every socket on disk under `/run`, `/var/run`, the home two levels
  down, and container engines' directories, including any path the confinement binds back. Each is masked by the null device after every other mount. The
  directories where host daemons make sockets (`socketDirectories`) are denied to the run's commands for its whole run (`denyRead`). A directory absent at start
  is made then, empty and owner-only; one that cannot be made leaves unix sockets refused for the run. Claude Code keeps `/run` (it needs it for DNS), denied to
  its commands only. A socket made later elsewhere in the visible home is not covered. A list that cannot be read, or a scan reaching its bound (50,000 entries),
  leaves unix sockets refused for that run. Where bubblewrap cannot mount over a socket (bubblewrap 0.4), the socket's own directory is hidden instead
  (`socketCovers`), unless that directory is `/`, the home or above, or a path the confinement binds back; failing that, the run is proven without them and its
  browser tests are skipped and reported. `unixSockets: false` refuses them always. Host daemons listen in the host's namespace, so the kernel's list covers them.
  Codex's sandbox gets `/dev/shm` and the report file's directory as writable roots (`sandbox_workspace_write.writable_roots`, after the operator's own).
- **A writing run's report file.** Each `workspace-write` run gets a fresh, empty, owner-only file outside its worktree
  (`RunSpec.reportFile`, in `<worktreeRoot>/.setup`), bound writable and named in `SYSTEM_CHECK_REPORT_PATH`, as a check's is. When
  a test run skipped browser tests, the suite's reporter appends `browser-tests-not-run: <why>`; the source reads it once the run
  ended, and the result says so (`agent-result@1.5` `notRun`: `its browser tests (<why>)`). The review is told before the subject
  that the author's word that the tests pass says nothing of those. A report file that could not be made, or cannot be read after
  the run, is said on the result too (`reportUnread`), and the review is told that whether its browser tests ran is not known.
- **A sandbox's placeholders are no change.** Claude Code's command sandbox denies writes to shell startup files, git and editor configuration, and its own
  settings in the start directory, and mounts an empty placeholder where one is missing (`.bashrc`, `.gitconfig`, `.mcp.json`, `.claude/settings.json`, …);
  git lists them as untracked inside the sandbox. An untracked one that holds nothing (empty, the null device, a link to it) is left out of a run's subject and
  diff (`sandboxPlaceholder`), of `test:affected`'s changed files, and is removed before a landing commits. One with content counts.
- **Egress** ([INV-12](../architecture/invariants.md#inv-12-data-egress-is-explicit)). The agent runs here, but its model is remote.
  The `agents` source checks each prompt with `ctx.egress` (Worker class `agent`) before the agent starts, keeps the decision id on
  the run, and fails a denied run as `egress_denied`, never submitted. By default the `agent` class receives `public` and
  `operator-shared` work only, although routing admits `local-private` work to a local Worker
  ([routing](routing.md#data-locality-policy)).

## Agent accounts

> Decision: [ADR-0051](../decisions/adr/0051-agent-accounts-are-enrolled-slots-identified-by-their-login.md).
> Until the operator applies the [move from hand-named rows](#migration-from-hand-named-rows), hand-named Workers
> keep running in their runtime's own home, also while its account is `unverified` (REQ-ACC-11 holds for derived Workers).

Several sign-ins per runtime are told apart by who is signed in, never by a name:

- **Slots are homes.** An enrollment slot is an owner-only home, `<DSH_HOME>/system/agent-homes/<provider>/<n>`, hidden from
  every agent child. Slot 1 adopts the runtime's own home where it is ([below](#enrollment-and-quarantine)). A run binds back only
  its own account's home. The slot's number never names, orders, or identifies an account.
- **`RunSpec.home` and `probe({ home })`.** A provider that runs in a named home reports `homes`. One that does not refuses a run
  naming a home (`config_error`) before anything runs; it never runs in its own home instead. `probeIn(provider, home)` asks a
  named home only of a provider whose probe reports `homes`; otherwise the evidence is unavailable. Codex and Claude Code report
  `homes`. A named home must already be an owner-only directory of this user (`homeProblem`; no run or probe makes it), and it
  then stands for the runtime's own home everywhere (environment variable, bind back, MCP and sign-in checks). The ACP runtime and
  the Antigravity CLI run in their own home only. A provider may name its own configured home (`home`, optional), which a Worker
  source adopts as slot 1.
- **`identity(home, key)`** reads who is signed in to that home, under the same confinement as a run, and returns:

  | Status | When | Carries |
  |---|---|---|
  | `verified` | the runtime's sign-in check passes and the reader reads the principal whole, on a CLI version a supervised check verified | `hmac` (`identityHmac`: HMAC-SHA256 keyed by the per-install key, over the provider and the principal's parts in canonical order), `reader`, `runtimeVersion`, a masked `hint` (`maskEmail`) |
  | `missing` | no sign-in in the home | why |
  | `ambiguous` | the principal cannot be read whole | why |
  | `unverified` | no reader is verified for this runtime or version | why, the version |

  No token and no raw principal leaves the provider ([INV-8](../architecture/invariants.md#inv-8-credentials-never-cross-upward));
  a home it cannot read is a reading, never a throw. The account id is `accountIdOf(provider, hmac)`, `<provider>:<first 16 hex
  characters>`; the full HMAC is what is compared ([`agent-account`](../reference/schemas.md#agent-account)).
- **`loginCommand(home)`** is the runtime's own sign-in command for that home (for example `CODEX_HOME=<home> codex login`), which
  the operator runs in their own terminal. It names the home and sets no session bus, so the sign-in lands in the home's files,
  where a run (which starts without D-Bus) reads it. The daemon runs no interactive sign-in.
- **Conformance** (`agentRuntimeIdentityConformance`, for a provider that reads identity): one login gives one HMAC across reads, a restart, and a
  re-login; two logins two; one login in two homes one (a duplicate the caller quarantines); a signed-out, never signed-in, or absent home is never
  `verified`; the reading holds no principal; the sign-in command names the home and no session bus. A run in a named home runs, and a relative one is
  refused. `FakeAgentRuntime` passes this suite.
- **One account, every role.** The Workers of one account are its `siblings` ([below](#workers--account--role)). Hand-named Workers all share the runtime's
  one home, so they are one account, whose `account.id` is the runtime. A cooldown or closed pool of any of them holds them all, a failover leaves them all
  out, and a team counts them as one account ([distinct accounts](teams.md#distinct-accounts)). A session stays on its one Worker.

### Identity readers

Each reader reads only the fields it names, from files of the home it is given, opened without following a link (a run can write
its own home) and bounded in size (`readHomeJson`). It runs after the runtime's own sign-in check in that home, under the read
confinement and with none of the operator's forwarded variables. Only the keyed hash, and a masked email, leave the runtime.

| Runtime | Reader | Pinned to | Sign-in check | Principal (hashed) | Hint |
|---|---|---|---|---|---|
| `codex-sdk` | `codex-auth-json` | Codex 0.164.0 | `codex login status` says `Logged in using ChatGPT` (an API-key sign-in names no person: `ambiguous`) | `tokens.account_id` of `auth.json` | none (the email is only in the id token, which is never read) |
| `claude-agent-sdk` | `claude-state-file` | Claude Code 2.1.308, 2.1.309, 2.1.310 | `claude auth status` says `loggedIn`, and the home keeps that sign-in in its own `.credentials.json` (existence only; elsewhere is `unverified`) | `oauthAccount.accountUuid` and `oauthAccount.organizationUuid` of `.claude.json`, both whole (never the email alone) | `oauthAccount.emailAddress`, masked |
| `antigravity-cli` | none | — | — | no file or command was shown to name the signed-in Google account, so no account of it can be enrolled | — |

- **Version-pinned**, as agy's hook is ([ADR-0043](../decisions/adr/0043-antigravity-cli-workers-gated-on-a-version-verified-live.md)):
  `VERIFIED_IDENTITY_VERSIONS` in each runtime. On any other version a reading is `unverified`, naming the version found and the versions admitted. A pinned
  executable that is gone (Claude Code's updater prunes old versions) is named as such; keep a checked copy at `~/.dsh/system/tools/claude/<version>/`, bound
  back read-only ([runbook](../operations/runbooks.md#keep-claude-codes-pinned-version)).
- **The Antigravity CLI has no reader.** agy 1.4.6 keeps its sign-in under `~/.gemini/antigravity-cli` in its own `HOME`, and no file
  or command was shown to name the signed-in Google account without reading its token. Finding one needs a supervised check on a
  signed-in throwaway home, field names only, as agy's hook was checked. Until then no account of it can be enrolled
  ([below](#enrollment-and-quarantine)).
- **Evidence.** The file and field names were seen on this host (two Codex homes signed in as two accounts showed two `tokens.account_id`; values were
  never read into any record), and each reader passes the identity suite on redacted fixtures of that shape. **No supervised check on the operator's real
  accounts has been run**: that each id stays equal across a restart, a token refresh, and a re-login, and differs for two accounts, on the pinned
  versions. Until it is run, the pins rest on the shapes seen.
- **A Codex workspace plan** shares its ChatGPT account id among its members. Two such homes read as one principal, which enrollment
  quarantines as `duplicate`, the safe side.

### Enrollment and quarantine

The `agents` source ([`agent-workers`](../../packages/plugins/agent-workers/README.md)) keeps each slot as an `agent-account@1.x`
record, and every change of what a slot holds as an `enrollment` decision, recorded before the record changes, in one transaction
with it. The decision's inputs are the slot's earlier decision, never the principal
([INV-13](../architecture/invariants.md#inv-13-every-decision-is-an-artifact)). A quarantine says what its reading found
(`quarantine.detail`, `agent-account@1.1`: the reason, and for `unverified` the version found and the ones admitted), so health,
`system account list`, the roster, and a refused run name it.

- **Slots.** A runtime has `slots` (on its `agent-workers` `providers` entry, default 1, at most 64). Slot 1 is the runtime's own home, adopted where it is;
  slot `n` is `<accountHomes>/<runtime>/<n>` (default `<DSH_HOME>/system/agent-homes`), owner-only when taken. Both are hidden from every agent child.
- **The key** of the ids is 32 random bytes, made once in the credential vault (record `system-agent-workers/identity-key`) under its
  lock, and never made again. With no vault, or a key of another length, nothing is read. Losing it changes every id, so back it up
  with the vault.
- **`system account login <runtime>`** (MCP `account_enroll`, step `begin`) takes the lowest free slot (or the one named), records it `enrolled`, and returns
  the runtime's `loginCommand` for its home, which the CLI runs in the operator's terminal without D-Bus. A runtime with no `identity` takes no free slot
  (`config_error`, nothing made or recorded): its account could only be `unverified`, and adopting its home would hold the hand-named Workers running there while
  the slot is `enrolled` (fail closed, [INV-2](../architecture/invariants.md#inv-2-fail-closed)). A slot taken in an earlier release can still be signed in again
  and verified. Step `verify` then reads the identity and records the status:

  | Reading | Status |
  |---|---|
  | `verified`, equal to the pinned principal (or none pinned), held by no other slot of the runtime | `ready` |
  | `missing` | `signed-out` |
  | `verified`, another principal than the pinned one | `quarantined`, `changed` (the pinned account stays on the record; `--accept` takes the new one as a new account) |
  | `verified`, the same full hash as another slot | both `quarantined`, `duplicate` |
  | `verified`, another slot's short id under a different full hash | both `quarantined`, `ambiguous` |
  | `ambiguous` | `quarantined`, `ambiguous` |
  | `unverified`, or a runtime with no `identity` (a slot taken before) | `quarantined`, `unverified` |

- **Output checked before it commits.** The account tools check the output of any call that changes something against `mcp-agent-accounts@1.2`
  before the change commits. An output its schema refuses is a defect: the call is refused with nothing changed.
- **Read again** at each probe (every `ready` account, or an account home's own; in the background every half `probeTtlMs`, [admission evidence](#admission-evidence)),
  and before each run (the account in the run's home). A re-read only takes away: a changed principal is quarantined and a missing one signed out, each recorded
  first. It never lifts a quarantine or a sign-out, and never quarantines a peer. Only the operator's `verify` (or `login`) does.
- **Who takes work.** A derived Worker takes work only while its account is `ready` ([below](#workers--account--role)). Hand-named Workers run in slot 1's home
  until the move ([below](#migration-from-hand-named-rows)). They take work while no slot holds that home, while its account is `ready`, or while it is
  `unverified` (never beyond slot 1). Enrolled and not verified, signed out, or quarantined `changed`, `ambiguous`, or `duplicate`, they read `unavailable`
  with the reason, and a queued run fails before anything is sent (`config_error`).
- **Removal** (`account_remove`) records `removed` and frees the slot; its home and sign-in are kept. **Health** (`agent-accounts`) names every account that is
  not `ready`, with its status and why; `system account list` (MCP `account_agents`) lists each slot beside the website accounts, with its Workers.
- **An event** for a slot newly quarantined, or quarantined for another reason: `agent-workers.account.quarantined` names the provider, slot, account id, reason,
  and the Workers that take no work, never the principal or its hint. A [notification](notifications.md) reads it. A failed append is logged; the change stands.

### Workers = account × role

Accounts are identified by their login ([ADR-0051](../decisions/adr/0051-agent-accounts-are-enrolled-slots-identified-by-their-login.md)).
The `agent-workers` row names no Worker by hand. It defines **roles** once, and **assigns** each enrolled account its roles, by the id
its login was verified as. The assignment is configuration, the trusted envelope of account choice
([INV-6](../architecture/invariants.md#inv-6-authority-comes-from-trusted-envelopes)).

```yaml
- id: agent-workers
  config:
    providers:
      - { provider: claude-agent-sdk, slots: 2, maxConcurrentRunsPerAccount: 1, pool: claude-plan, windows: { five_hour: five-hour } }
      - { provider: codex-sdk, slots: 2 }
    roles:
      - id: review
        workspace: /home/me/src/project
        sandbox: read-only
        tier: standard
        runtimes: { claude-agent-sdk: { maxTurns: 4 } }
    assignments:
      - { account: "claude-agent-sdk:1f0c2b7e9a5d3c41", roles: [review], label: science }
      - { account: "codex-sdk:04aa5c1e9b7d3f20", roles: [review] }
```

- **A role** holds what the work needs: workspace, sandbox, tier, quota class, `worktreePerRun`, `reviewMember`, `research` ([a research role](#a-research-role)),
  and the `kinds` of work its Workers take ([work kinds](routing.md#work-kinds)). Under `runtimes.<runtime>` it holds what differs per runtime (`tools`, `model`,
  `maxTurns`, `family`, `tiers`), never a routing input. Which runtime takes a kind of work is the assignments' decision: a role `code` given `kinds: [code]` and
  assigned to one runtime's accounts keeps source-code steps on them (ADR-0057). Capability is the role's, so a Worker is chosen by capability first, then by tier
  ([tiers per role](#tiers-per-role)).
- **The Worker** of an account in a role is `agent:<accountId>/<role>`, derived as a pure function of the configuration. Its runtime
  is the account's provider, its family the role's `family` for that runtime (or the runtime), and its capabilities what the probe
  proves in its account's home. An account with no assignment has no Worker. An assignment naming an account that is not `ready`
  (no slot holds it, not verified, signed out, or quarantined, `unverified` included) derives a Worker that reads `unavailable` with
  the account's reason and probes nothing.
- **An account's label** (`assignments[].label`, optional, plain text on one line, at most 64 characters) is the operator's name for
  the account, for people only: the roster's display name (`Claude Code · science · review`,
  [display names](roster.md#display-names)), the Workers tab, and `system account list`. It is never a routing input, never part of a
  Worker id, and never kept on the account's record. Changing it changes no id.
- **Its account's home.** Runs and probes name the account's home (`RunSpec.home`, `probeIn`), none when it is the runtime's own
  (slot 1). The account is read again before each run, as the sandbox proof is.
- **Per account** (the `agents` source does for agent accounts what `turns` does for website accounts): one scheduler per account runs
  `maxConcurrentRunsPerAccount` (on the provider, default 1, at most 16) of its runs at once across its roles, on top of one run at a time per Worker, in-process
  ([INV-1](../architecture/invariants.md#inv-1-one-authoritative-runtime)). Each Worker reports the account's `load` (`running`, `queued`, `pending` admissions,
  and `slots`) and reads `busy` while `running` reaches `slots`, so least-busy routing ([ADR-0033](../decisions/adr/0033-least-busy-routing.md)) prefers a less
  busy account. `siblings` are the account's Workers; a limit's cooldown and a closed pool hold the account.
- **Pools per account.** The provider's `pool` names a template of the resources row ([pool templates](resources.md#pool-templates)):
  each account's Workers draw on `<pool>/<accountId>`, with the provider's `windows` (once per provider) and `limitCooldownSeconds`.
  The source declares its ready assigned accounts of metered providers to the ledger (`declare`). Without that pool its Workers are
  `unavailable`. A limit on one account never closes another's.

Hand-named Workers (`workers`) are the shape before the move; one row holds one shape or the other.

### Tiers per role

> Decision: [ADR-0073](../decisions/adr/0073-agent-workers-offer-tiers-per-role-with-quota-per-model.md).
> A task's risk sets a step's minimum tier ([ADR-0071](../decisions/adr/0071-a-changes-risk-tier-comes-from-the-policys-path-map.md)).
> Code: [`agent-workers`](../../packages/plugins/agent-workers/README.md) (`src/roles.ts`), the router ([routing](routing.md#intelligence-tiers)), and the Claude Code runtime's usage report reader.

A vendor's plan serves several models, and so does each account on it. A role may give its Workers one model per tier on a runtime,
instead of one `tier`:

```yaml
providers:
  - provider: claude-agent-sdk
    pool: claude-plan                           # the account's own pool: its five-hour window
    windows: { five_hour: five-hour }
    modelPools:                                 # one more pool per account for a model with a window of its own
      - { model: "<frontier model>", pool: claude-frontier, windows: { "model_scoped:<frontier family>": weekly } }
roles:
  - id: develop
    workspace: /home/me/src/project
    sandbox: workspace-write
    worktreePerRun: true
    runtimes:
      claude-agent-sdk:
        tiers:
          economy:  { model: "<economy model>" }
          standard: { model: "<standard model>" }
          frontier: { model: "<frontier model>", maxTurns: 40 }
```

- **What a tier sets.** `runtimes.<runtime>.tiers.<tier>` is `{ model, tools?, maxTurns? }`: the model, and the options that differ at
  that tier (else the runtime's own). It replaces the role's `tier` on that runtime. A role may leave `tier` out when every runtime it
  is assigned on declares tiers; a role giving an assigned runtime neither is refused at load. Model names are the operator's
  configuration (the live profile) only, never in code, docs, tests, or examples; these docs write `<frontier model>` for one.
- **One Worker offers them all.** The Worker `agent:<accountId>/<role>` describes every tier it offers (`capability-descriptor@1.10`
  `tiers`), its lowest as its `tier`. Capability stays the role's, so it proves the same capabilities at every tier. Routing serves it
  at the lowest offered tier within a step's bounds whose model's pool is open ([routing](routing.md#intelligence-tiers)). A session that
  escalates stays on it, at the next tier's model.
- **A run runs its tier's model.** The engine passes the routed tier (`WorkerStart.tier`), recorded on the run (`agent_runs.tier`) with the model that tier
  gave it (`agent_runs.configured_model`). A tier the Worker does not offer refuses the start. When a run comes up after the configuration changed and its
  Worker no longer offers its tier, or that tier now runs another model or none of its own, the run fails unsent as `worker_changed`, naming the tier it was
  started at and the tiers offered now. Its disposition is `IMMEDIATE`, so the engine routes the work again at once
  ([recovery](workflow-engine.md#recovery)). A run never takes another tier's model, nor its tier another model, in silence. With no tier given, the lowest
  offered at or above the requirement's minimum.
- **Recorded.** The result is `agent-result@1.4`, with `tier` and `configuredModel` (the model asked for; `model` stays the one the
  runtime answered with). The brief carries the routed `tier` and the model the source runs there (`brief@1.4` `tier`; `@1.5` adds
  `model`, from `WorkerSource.model`). `system explain`, the usage report, and the run's `/ui` page show the tier and model.
- **Quota per model.** `modelPools` on the provider entry gives a model one more pool per account, `<pool>/<accountId>` of a template of the runtime's group.
  A run on that model reserves on both pools, and either closed refuses it unsent. An observation a model pool's `windows` maps is a reading of that pool
  alone; any other is the account's, and a limit the account's pool cannot place still closes it whole. So the frontier model's weekly window at its limit
  closes the frontier tier only: the Worker describes it `closed` with when it is back, and standard work is still admitted. A model pool with no reading
  yet closes its tier (INV-2). A tier is ranked by its own pools' headroom ([quota in every route](routing.md#quota-in-every-route)). Only a limit recorded on
  a pool the run drew on counts as the run's own limit. Per-model admission applies only where the provider reports a window per model: Codex's usage report
  gives windows by length (300 and 10080 minutes), so a Codex role's tiers name no `modelPools`, every tier of the account shares its windows, and the route
  decision says so (`its tiers share its account's windows`).
- **A one-tier role** runs its runtime's `model`, its Worker describes no `tiers`, and it records `agent-result@1.2` or `@1.1`.

### Migration from hand-named rows

`system account migrate` (MCP `account_migrate`, operator scope; [runbook](../operations/runbooks.md#migrate-agent-workers-to-accounts--roles))
moves the hand-named Workers to derived ones. It plans by default and changes nothing. `--apply` applies the plan; `--rollback` undoes it.

- **The plan** (rule `agent-workers.migration` version 3, pure): each runtime's configured home is slot 1, adopted where it is. Rows that agree on the work's
  settings (their `kinds` included) become one role: `review` when read-only, `develop` when writing, `review-2`, … for another of a kind. The role carries what
  each runtime set under `runtimes`, the rows' `kinds`, and a `description` when every row gives the same one. The slot-1 account is assigned the roles of its
  runtime's rows, by its verified id. An old `pool` becomes the provider's pool template, with its windows and cooldown. `maxConcurrentRunsPerAccount` is the
  number of the runtime's rows. The live patch's `claude-research`, `codex-review`, and `agy-review` become one role `review`, with `maxTurns: 4` for Claude Code
  and the model for the Antigravity CLI.
- **What stops it** (each named, with what to do): a runtime not registered; no account in slot 1 (enroll it first); slot 1 not the
  runtime's own home; an account not `ready`; rows of one runtime drawing on different pools, windows, or cooldowns; a pool the ledger does
  not configure. A runtime with no identity reader (the Antigravity CLI), and an `unverified` account (a slot taken before), wait: the
  cutover waits for the reader, unless the operator stops that runtime's Workers at the cutover (`--stop <runtime>`). A stopped runtime's
  role keeps what it set, for the assignment the operator adds once its account can be verified.
- **Its output is checked first.** The tool's output (`mcp-agent-accounts@1.2`) is checked inside the apply's or rollback's transaction,
  after every write and before the commit. An output its schema refuses is a defect: the call is refused with nothing decided or moved.
- **Apply**, refused while a run of a hand-named Worker is queued or running (drain first), in one transaction: an `enrollment` decision per
  hand-named Worker (`migrated` to its new id, its input the account's latest enrollment decision, or `stopped`); each of its agent sessions
  and runs moved to its new id, so a continued session stays on its account and home; and the cutover's own `enrollment` decision
  (`applied`, its inputs the moves'). Applying again changes nothing.
- **The cutover.** Until the move is applied, both shapes load, and hand-named Workers route and run exactly as before: no load, the runtime
  as the account, one run at a time per Worker, no pool declared. Once applied, hand-named Workers still loaded take no work and start
  nothing, and a row that names any is refused at load with the path, the decision, and the way back (`config_error`, REQ-HOST-2). The
  operator puts the printed row in the profile patch and restarts.
- **Rollback**, refused while a run of a Worker it moved to is queued or running: each session and run moved goes back to its hand-named
  Worker (one moved again since stays), the refusal is lifted, and a `rolled-back` decision is recorded, its input the cutover's. Then the
  old row loads again. Results, usage records, and decisions keep the Worker ids they were written with and still explain. The
  `workerSessions` records of team members are not moved.

## Confined commands

A Worker proves `validate` only when its runtime runs commands confined to the workspace with no network (`executes`). Codex
runs its commands in its own sandbox, nested in the read confinement. Claude Code runs them under two confinements
([ADR-0038](../decisions/adr/0038-confined-commands-for-claude-code-workers.md)):

- **Reads, by the host:** the read confinement above, around the whole Claude Code process.
- **Commands, by the SDK's sandbox:** a `workspace-write` run offers `Bash` and enables the SDK's sandbox (bubblewrap and a network proxy on Linux) with
  `enabled` and `failIfUnavailable` (a run whose sandbox cannot start fails; it never runs unconfined), `allowUnsandboxedCommands: false`,
  `filesystem.allowWrite` the run's workspace only, and `network.allowedDomains: []` with `strictAllowlist`, so the sandbox refuses every host. A `read-only` run
  has no `Bash` and no sandbox. A network allow list (a package registry) would be an egress decision ([INV-12](../architecture/invariants.md#inv-12-data-egress-is-explicit)),
  not a runtime default.
- **The proof:** the probe reports `executes: true`, and offers `workspace-write`, only when both layers hold on this host:
  `proveConfinement`, then a nested sandbox start inside the confinement (a namespaced `true` with its own network and PID namespaces
  over a read-only root). Otherwise `executes: false` and `read-only` only, the reason in `detail` (INV-2): its Workers review but never
  `develop` or `validate` on this host. A `workspace-write` run repeats the nested start before Claude Code starts and is refused
  (`config_error`) if it fails; inside the run, `failIfUnavailable` guards the sandbox.
- **The policy still decides.** The sandbox bounds where a command acts; the run's [tool gate](#tool-gate) decides whether it runs at
  all, by its exact argv ([approvals](approvals.md#a-workers-tool-calls)). A word with a shell metacharacter is forbidden. With the default
  studio policy any other command asks the operator unless a rule lists it.

### An agent's shells read no startup code

The gate takes a few `Bash` calls for reads (the probes `echo`, `pwd`, `true`, `false`, and the fixed inspection commands,
[Codex's gate](#codexs-gate)) on the word that names their program. Startup code can make that word name something else: a function or
alias called `echo` or `cat` in `~/.bashrc`, `~/.bash_profile`, `~/.profile`, the file `BASH_ENV` or `ENV` names, or an exported function
(`BASH_FUNC_echo%%`) would run instead on a later call the gate passed as a read.

A read is a read only where startup code is kept out of the shell that runs the call: a non-login, non-interactive shell that reads no
startup file and no startup variable (`bash --norc --noprofile`, no `BASH_ENV` or `ENV`), started by the runtime on every call, in a shell
the agent cannot choose or change. A runtime that enforces that reports `cleanShells`, and only for its runs does the gate take a `Bash`
call for a read. Every other call is the `command` it is, judged by its exact argv (INV-2). A check run once beside the agent proves
nothing about the shells the agent starts later, so none is taken as a substitute. Neither runtime here pins its shell:

- **Codex** runs `exec_command` in the user's shell, as a login shell by default. Each call may name its own `shell` and `login`, which
  its hook does not show, and may run any executable the Worker names, a workspace script it just changed among them.
- **Claude Code** starts its Bash tool's shells its own way and runs each command after sourcing a shell snapshot it keeps in its home
  (`CLAUDE_CONFIG_DIR`).

So neither reports `cleanShells`, and under both every `Bash` call is a `command`. Both enforce, whatever shell and mode a call runs in,
that no startup code the agent wrote, nor the worktree's or the operator's, runs before a command. The regression in
`agent-runtime-core/tests/shells.spec.ts` plants `echo` and `cat` functions in every startup file a call can reach, under the real
confinement, and checks that the next call's `echo` and `cat` are the real ones:

- **No startup variable.** `childEnvironment` drops every variable a shell runs code from (`SHELL_STARTUP_VARIABLES`: `BASH_ENV`, `ENV`,
  `ZDOTDIR`, `PROMPT_COMMAND`, `PS0`, `PS4`, `SHELLOPTS`, `BASHOPTS`, `INPUTRC`, and every exported function), whether from the daemon's
  environment, a forwarded name, or an explicit value. `agentShellEnvironment` also drops the variables that move a shell's startup files
  (`SHELL_CONFIG_DIRECTORIES`: `XDG_CONFIG_HOME`, `XDG_CONFIG_DIRS`). Codex refuses a `shell_environment_policy.set` that names one, or
  that sets `HOME`.
- **A private home, read-only but for a tool's own state.** Each run's `HOME` is a fresh owner-only directory (`agentHome`) under the
  run directory (`<DSH_HOME>/system/run`), never in the worktree; the real `HOME` is never mounted. It holds no file, only empty
  directories: the places a tool keeps its state (`HOME_STATE_DIRECTORIES`: `~/.local/share`, `~/.local/state`, `~/.cache`, `~/.config`)
  and, inside them, the only places a shell reads startup code (`HOME_STARTUP_DIRECTORIES`: fish's `~/.config/fish` and
  `~/.local/share/fish`). Both runtimes bind the home back **read-only**, each state directory **writable** over it, and each startup
  directory **read-only** over the state directory it lies in. So a tool's first run writes quietly instead of printing `EROFS`, while a
  login or interactive shell finds no `~/.bash_profile`, `~/.profile`, `~/.bashrc`, `~/.zshenv`, `~/.config/fish/config.fish`, or fish
  `conf.d`/`vendor_conf.d` file, and no tool call can write one for a later call's shell. The home's top, `~/.local` itself, and fish's
  directories stay read-only. Tool state lasts for the run only: the home is removed with it. The only startup files left are the
  system's (`/etc/profile`, `/etc/bash.bashrc`), which no agent writes. `XDG_CACHE_HOME` names the operator's cache, where tools find
  downloads. Claude Code's and Codex's own state stay in their homes (`CLAUDE_CONFIG_DIR`, `CODEX_HOME`).
- **No write where a shell reads startup code.** Claude Code's command sandbox (`commandSandbox`) allows writes to the workspace, a browser
  test's output, and the shells' state directories (`withHomeState`) only. It denies writes to its home, which holds the shell snapshot, and
  to fish's startup directories (`filesystem.denyWrite`, which wins over `allowWrite`; so the shells' `HOME` itself is not named, which
  would deny its state directories too). Its file tools reach the workspace only. Codex's sandbox (`workspace-write`, with
  `sandbox_workspace_write.writable_roots` naming the workspace, a browser test's output, and the state directories) leaves its home with
  no shell startup code. Either sandbox runs inside the run's confinement, whose read-only binds of fish's directories no inner sandbox
  can make writable.

### The workspace reads server

> Code: [`agent-runtime-core`](../../packages/agent-runtime-core/README.md) (`src/workspace-reads.ts`) and
> [`runtime-codex-sdk`](../../packages/plugins/runtime-codex-sdk/README.md).

No `Bash` call is a read under Codex or Claude Code ([above](#an-agents-shells-read-no-startup-code)). Codex has no file-reading tool
of its own, so its Workers would read only through commands the operator approves. Instead they read through System's own MCP server:
minimal, in Node, with no third-party server. (The reference filesystem server always registers write tools and lets MCP Roots widen
its directories; the others run language servers, caches, or repository plugins.)

| Tool | Input | Returns, bounded |
|---|---|---|
| `read_file` | `path`; `startLine`, `endLine` (1-based, inclusive) | numbered lines (`<n>\t<line>`), at most `maxReadBytes`, reading through at most `maxScanBytes`; where it stopped; a binary file (a NUL in its first 8000 bytes) named, not shown |
| `list_dir` | `path` (default the workspace) | entries by name, at most `maxEntries`: `name/` for a directory, `name@` for a symlink (not followed), a file with its size; the count, or "at least" that many when it read no further |
| `search` | `pattern`; `regex` (default a fixed string); `ignoreCase`; `path` | `<path>:<line>: <text>`, at most `maxMatches`, lines cut at `maxLineChars`; at most `maxSearchFiles` files opened, none over `maxScanBytes`, within `searchTimeoutMs`; a pattern of at most `maxPatternChars`; never a symlink, a binary file, a file with more than one hard link, or a `node_modules` directory below the path |
| `git_log` | `count` (default 20); `skip`; `commit` (hex id; default HEAD); `paths`; `fields` (of `hash`, `parents`, `date`, `author`, `email`, `committer`, `committed`, `subject`, `body`) | one line per commit, fields tab-separated, body indented; at most `maxLogCount` commits and `maxGitBytes` |
| `git_show` | `commit` (hex id); `stat`, `patch` (each default true); `paths` | id, parents, author, committer, whole message, then stat and patch; at most `maxGitBytes` |
| `git_diff` | `cached`, or `from` and `to` (hex ids); `stat` (default the patch); `paths` | the patch or stat, submodules not entered; at most `maxGitBytes` |
| `git_status` | `paths` | the branch line, then `XY path` per changed or untracked path (porcelain v1, no rename detection); at most `maxGitBytes` |

- **Bound to one workspace.** The root is an argument at start, kept. The server declares no capability but tools, asks the client nothing (no `roots/list`),
  and ignores every notification. It answers `initialize`, `ping`, `tools/list`, and `tools/call` over newline-delimited JSON-RPC on stdio, one request at a
  time. A message over 1 MiB is refused, and past 32 waiting lines a further one is refused at once. Calls wait for the calls before them, and Codex's tool
  timeout counts that wait. The server does not answer concurrently, which would multiply its memory.
- **Every path inside it, really.** A path is relative to the workspace or absolute inside it. Refused: a `..` segment anywhere; an absolute path outside; any
  path whose `realpath` is outside the workspace (a symlink out, a file or directory); git's own data (`.git` in any letter case, as written or resolved, and
  a bare repository named `*.git`); and files named as secrets, by name whether or not the repository ignores them (`SECRET_NAMES`: `.env` and `.env.*` but
  `.example`, `.sample`, `.template`, `.dist`, and `.envrc`; `*.pem`, `*.key`, `*.p12`, `*.pfx`, `*.jks`, `*.keystore`, `*.kdbx`; SSH private keys; `.netrc`,
  `.npmrc`, `.pypirc`, `.git-credentials`, `.htpasswd`, `.pgpass`; `credentials` and `secrets` files; a `.secrets` directory; `*.tfvars`, `*.tfstate`;
  `kubeconfig`; and by path, `SECRET_PATHS`: `.kube/config`, `.docker/config.json`, `.aws/config`, `.aws/credentials`). `list_dir` leaves these out and counts
  them. Each file or directory is opened without following a link at its end, and checked again by the path its descriptor names (`/proc/self/fd`): one
  swapped after the check is refused.
- **Ignored files named like secrets.** A file or directory git ignores is refused too when its path holds, in any segment, a word of a
  secret's (`SECRET_LIKE`: secret, token, password, passwd, credential, private, API key): `deploy-token.txt` under a `*-token.txt` ignore
  line, anything under an ignored `private/`, and an ignored `private/config.txt` though `private/` itself is not ignored. The path is checked
  as written and as resolved. Ignore rules are read from the workspace's `.gitignore` files (nested, negated, anchored, `**`, bracket sets, and
  POSIX classes as git's wildmatch reads them; a class it does not know fails closed) and `.git/info/exclude`, by the server itself, with no
  git run. The last matching pattern wins, and nothing below an ignored directory is re-included. Neither condition alone refuses a file:
  `tokenizer.ts` is read, and so is an ignored `dist/index.js`. Patterns are matched by an automaton, never a backtracking regular expression,
  so a hostile pattern cannot stall the server. Matching fails closed: an ignore file over 256 KiB is incomplete, so every secret-like name at or
  below its directory counts as ignored, and so does every one asked about once a call has spent its matching budget (`MAX_IGNORE_STEPS`).
- **No hard link.** A hard link is the file it links under another name, and no path check sees it. So a regular file with more than one link
  (`st_nlink > 1`) is not read, and a search skips it. The exception is `node_modules`, where pnpm hard-links its store (package files, outside the
  workspace by design); the run's read confinement bounds what those reads reach.
- **Not covered by name** (the residual gap). The names are a list, not a scan of contents: a secret in a file named like no secret, tracked or not ignored, is
  read, as is one under an ignore pattern from git's global excludes. The run's read confinement, which hides the operator's home and credentials, keeps the
  host's secrets out; these names keep the common repository-local ones out of what a read returns.
- **No program but git, run read-only.** Node built-ins only. A search runs in a worker thread, terminated a second past its deadline whatever its regular
  expression does. No shell. The only subprocess is git, for the git views.
- **Git views.** Each view runs git (`spawn`, never a shell) with an argv the server builds (`gitArgv`): a commit only as a hex id of 4 to 64 digits, never a
  ref name, option, or expression. Each path gets the `realpath` checks of `read_file`, then goes after `--` as a literal pathspec (`:(literal)`). Every way a
  read command can run a program, from git-config(1), gitattributes(5), and githooks(5), is turned off by `GIT_CONFIG_PINS` (given as `-c`, which no repository
  file overrides): the fsmonitor, the pager, external diff and textconv drivers, global attributes, every filter driver the repository names (given an empty
  `clean`, `smudge`, and `process`), hooks, `gpg.program`, the partial-clone lazy fetch and transport programs, and git in a submodule. A repository whose
  `.git/config` names any of these runs them under plain git and none of them through the views (`tests/workspace-reads.spec.ts`). Its environment is its own
  (`gitEnvironment`): only `PATH` from the server, `GIT_CONFIG_NOSYSTEM=1`, `GIT_CONFIG_GLOBAL=/dev/null`, `GIT_TERMINAL_PROMPT=0`, `GIT_OPTIONAL_LOCKS=0`, the C
  locale, the repository found only at the workspace root (`GIT_CEILING_DIRECTORIES`), and `GIT_WORK_TREE` the workspace. Git runs in its own process group,
  killed at `gitTimeoutMs` or once its output passes `maxGitBytes`. Files named as secrets are left out: `git_show` and `git_diff` exclude each
  (`:(exclude,literal)`) and say how many; `git_status` counts them. A linked worktree whose git directory lies under a path the run's read confinement hides
  is unreadable there: the views answer that git failed.
- **Bounded in memory.** `list_dir` and `search` read a directory's entries one by one (`opendir`), at most 10 x `maxEntries` of them.
  `list_dir` then says "at least N entries"; `search` says it read that directory only so far. A search thread runs with `resourceLimits`
  derived from `maxScanBytes` (`searchResourceLimits`), holds one file and one line at a time, and an answer from a thread bounded more loosely
  is not used. Past its limit the thread is ended and the search refused.
- **Bounded by configuration** (INV-9): the `agents` source's `workspaceReads` (each bound within `WORKSPACE_READ_BOUNDS`) goes with every run as
  `RunSpec.workspaceReads`; out-of-range bounds refuse the run (`config_error`).
- **Confined twice.** Codex registers the server for every run, the read-only sandbox's included, as a `--config` override (`mcp_servers.workspace`, its only
  MCP server; the operator's own are refused), with a 30 s start and a tool timeout of the longer of the search and git deadlines. The server runs as `node`
  under its own bubblewrap inside the run's read confinement (host read-only, workspace bound back read-only, no network), since Codex starts MCP servers
  outside its own sandbox. The path checks above are a second layer. The probe proves it starts there before it reports `workspaceReads`; on a host that
  refuses, no Codex Worker is admitted.
- **Gated as reads, where the runtime gives it.** Codex's hook reports the tools as `mcp__workspace__read_file`, `…list_dir`, `…search`, and the
  git views `…git_log`, `…git_show`, `…git_diff`, `…git_status`. For a run whose runtime reports `workspaceReads` (passed to the gate as
  `cleanShells` is), the gate classifies exactly these as `read` (inside the workspace, no `..`, not git's data; for a git view, every `paths`
  entry so, and every commit a hex id) and refuses any other tool name of the server. Under any other runtime it refuses every
  `mcp__workspace__…` tool, since no server of System's started there (`unclassified-tool`;
  [approvals](approvals.md#how-a-call-is-classified)). Each allowed call accounts for one `mcp_tool_call` item; one no allowed call accounts
  for stops the run.
- **Told to use it.** The Tools section of every Worker whose runtime reports `workspaceReads` (whatever its sandbox; never a review member,
  [approvals](approvals.md#a-deferred-call)) says to read with these tools and never with a shell, whose every command may wait for the
  operator, and names them as its reading tools. It names no `Bash` inspection command where shells are not clean.
- **Claude Code** gives no such server: it keeps its own `Read`, `Grep`, and `Glob`, which the gate classifies as reads.

Differs from target: the probe's turn calls no MCP tool, so Codex's PreToolUse hook before an `mcp__workspace__<tool>` call is not shown by
the probe. A hook that did not run stops the run at the first such call, after it ran, as for any tool.

The Antigravity CLI offers no command tool (`run_command` is denied), so its Workers never `validate`: agy's own terminal sandbox (`--sandbox`)
has no model-free proof.

Commands that need the network (installing packages) fail inside a Worker. Dependencies are prepared before the run, in a worktree by its
repository's [setup](#a-worktrees-setup), offline from what the host holds.

Commands that listen on a unix socket fail inside a Worker: both command sandboxes refuse them on Linux by a seccomp filter (`EPERM`). Allowing
them would let a command reach any socket the confinement leaves visible, a loosening of ADR-0038 that needs its own decision, so none is made. The
`tsx` CLI opens an IPC pipe for every script, so a check started through it fails as `listen EPERM`; `node --import tsx <script>` opens no socket and
is the form the repository uses. (A worktree's setup runs under the read confinement alone, so its commands can listen on one.) The sandbox runtime
does not claim to stop a kernel escape ([threat model](../security/threat-model.md#threats-and-controls)).

### Reading tools and shell inspection

No runtime here has a `Bash` call that is a `read`. So a Worker's `cat`, `ls`, `wc -l`, `head`, `tail`, `grep`, `rg`, `find`, or `sed -n` is a
`command` that opens an approval request and waits for the operator. Where the run's agent has a reading tool for it, the gate instead denies
such a command at once, never asking (`use-read-tool`; [approvals](approvals.md#how-a-call-is-classified)), and the reason names the tool:

| Shell inspection | Claude Code | Codex (workspace reads server) |
|---|---|---|
| `cat`, `head`, `tail`, `sed -n` | `Read` | `read_file` |
| `wc` | `Read` (its lines are numbered, so the last number is the count) | `read_file` |
| `grep`, `rg` | `Grep` | `search` |
| `ls`, `find` | `Glob` | `list_dir` |

- **Which reading tools the agent has** comes from the runtime's evidence, never its name (INV-11): `readTools` (Claude Code reports `Read`,
  `Grep`, `Glob`), kept as far as the Worker's `tools` list names them (an absent or empty list keeps every one), plus the workspace reads
  server's three where the runtime reports `workspaceReads`. A Claude Code Worker whose list names `Read` alone has no `Grep`, so its `grep`
  stays a `command`.
- **Recognised by its first word**, after the gate's split on single spaces and its metacharacter and empty-word refusals, whatever its other
  words. A `sed` counts only as `sed -n <a>[,<b>]p <path>…` (not an in-place edit, a `-e` or `-f` script, or a script that writes or runs). A
  `find` counts only without an action (`-exec`, `-delete`, …). `stat`, `file`, and `git` are not served by a reading tool and stay `command`s.
- **Under a runtime that gives its agent no reading tool** for the form, it stays a `command`. Under one that enforces clean shells, an
  inspection command the gate takes for a read (every path absolute, inside the workspace) still runs unasked.
- **Told before the work.** The Worker's Tools section says that a shell inspection command one of its reading tools serves is denied at once,
  never asked, and names the tool for each form.

### Host tools: a run's own tools, answered by System

A Worker source can give one run tools of System's that are bound to that run (`RunSpec.hostTools`, `HostTool` in agent-runtime-core;
[ADR-0070](../decisions/adr/0070-workers-that-share-no-session-work-through-a-tasks-dossier.md)). The source fixes what the tool acts for from
its own record, so the agent names only what the tool takes. The first are a board task's [dossier](task-dossier.md) tools, `dossier_read` and
`dossier_append`, bound to the workflow run, the step, and the execution the run serves (`src/dossier.ts`), for a board task's step that is no
review member's.

- **Offered only by a runtime that reports `RuntimeEvidence.hostTools`**, as the MCP server `system` (`mcp__system__<name>`). Claude Code offers
  them as an in-process server of its SDK (`hostToolsServer`, no program started), each pre-approved by its exact name and no other MCP server
  attached. Codex, ACP, and the Antigravity CLI offer none; their steps are recorded by the engine.
- **Checked twice.** Every call passes the run's tool gate first, which classifies only the host tools the run was given, each with only its own
  fields (`dossier_read` a `read`; `dossier_append` a `workspace-write` of System's own record, no file). Then the server checks the input against
  the tool's closed schema (a string, an integer, or a list of strings, each bounded). A name, a schema outside that subset, or a repeated name
  refuses the run (`config_error`).
- **Answered in System's process**, so a tool reaches what it is bound to and nothing the agent names. The dossier refuses an append unless the
  bound execution is the one its step runs now.

## Metering

What a run consumed comes from the runtime's own objective numbers, never from the model's text ([resources](resources.md)).
A provider reports them in provider-neutral names (`RunMetering`). A failed run attaches them to its error (`withMetering`), so
failed and aborted runs are metered too. The provider conformance suite checks that input includes its cached part and that
per-model counts sum to the totals. The Claude Agent SDK provider reports usage (the result's `modelUsage`) and rate-limit
observations ([its README](../../packages/plugins/runtime-claude-agent-sdk/README.md)). The Antigravity CLI reports turns, usage
from agy's own result, and the main model when an event names it ([its README](../../packages/plugins/runtime-antigravity-cli/README.md)).
The Codex provider reports turns and usage ([below](#codex-metering)). The ACP provider reports no usage.

### Codex metering

The Codex provider counts each `turn.completed` as a turn and sums its `usage`. Two of Codex's five counts are parts of another,
and a part is never added to its whole:

| Codex count | Is | Reported as |
|---|---|---|
| `input_tokens` | every input token of the turn, cached ones included | `inputTokens` |
| `cached_input_tokens` | a part of `input_tokens`: read from the prompt cache | `cacheReadInputTokens` |
| `cache_write_input_tokens` | a part of `input_tokens`: written to the prompt cache | `cacheCreationInputTokens` |
| `output_tokens` | every output token, reasoning included | `outputTokens` |
| `reasoning_output_tokens` | a part of `output_tokens` | not reported apart: `outputTokens` already counts it |

A turn whose counts are not counts, or whose parts exceed their whole, is not read: the run reports its turns and no tokens, never
a sum that silently leaves a turn out. Codex reports no charge, so a Codex run has no `costUsd`. A Codex subscription's capacity is
judged by its windows ([an account's usage report](#an-accounts-usage-report)). The token totals are still recorded in the run's
`usage-record`.

A run that ends early (stopped, past its timeout, drained at the host's stop, or at a deferred call) reports what the agent did report, marked `partial`
with why in words (at most 300 characters), never an invented figure: the Claude Agent SDK sums the streamed `assistant` messages (each message id once, at its
largest counts, subagents included), and the Codex provider sums its completed turns. None completed is no number, never 0. A partial report names no result
(`resultId`), and the `agents` source records it as a lower bound ([usage the ledger cannot count](resources.md#usage-the-ledger-cannot-count)).

The `agents` source meters a Worker that draws on a pool through `ctx.resources`: a hand-named Worker with a `pool` (and its
`account`), or a derived Worker of a provider that names a pool template ([above](#workers--account--role)). It follows
[a run's budget](resources.md#a-runs-budget):

1. The Worker is `quota-exhausted` while its pool is unavailable, so routing skips it. With no ledger, or a pool the ledger does not
   configure, it is `unavailable`.
2. Before the agent starts, the run reserves one run on the pool (the `budget` decision joins its decisions). A refused reservation
   fails the run unsubmitted.
3. After the run, completed or not, one `usage-record` (source `runtime-result`) carries the runtime's numbers. Each limit observation
   becomes a `limit-state` reading of the pool window that `windows` maps the runtime's window name to; an unmapped window is skipped.
   A derived Worker's account usage report is read once before the record, and its observations are recorded after the run's
   ([an account's usage report](#an-accounts-usage-report)). Then the reservation is released. The record names the board task and
   project the brief serves, if any ([a task's budget](workflow-engine.md#a-tasks-budget)).
4. A run that fails `quota_exhausted` and left no `limited` reading (neither its runtime nor the account's usage report gave a reset,
   or the ledger could not place one) closes every window of the pool: a `limited` reading (source `limit-notice`) for
   `limitCooldownSeconds`, until a later reading says otherwise. A limit is never retried on the same pool unseen
   ([fail-closed rules](resources.md#fail-closed-rules)).

A run the host's stop drains records what its runtime reported by then, as a lower bound. A run started before a restart has no result message, so nothing more
is recorded, and its usage is not reconciled from the agent's session transcript. A Worker with no pool is not metered, but its limits still hold: a
`quota_exhausted` run on it (or on a metered Worker whose ledger did not take the reading) cools down every Worker of its account (for hand-named Workers, every
Worker of the runtime). They stay `quota-exhausted` until the reset the runtime named (in the run, or in the account's usage report read after it), else for
`limitCooldownSeconds`, at most seven days, across a restart (event `agent-workers.cooldown`).

A metered run whose usage the ledger could not count (no tokens or turns reported, the host stopped mid-run, or the ledger refused or
failed its record) is recorded as one `usage.unknown` event. A cap counts it as 0 until a record of it is counted
([usage the ledger cannot count](resources.md#usage-the-ledger-cannot-count)). A record refused as `invalid` with a per-model split is
first offered again with its totals alone.

### Limit readings

A limit is waited out until the reset its runtime names. Each runtime reads that reset from what the installed agent reports, never
from the model's text, and only on a version whose format was checked ([fail-closed rules](resources.md#fail-closed-rules)). A reading
that cannot be read is no reading: the limit closes the pool for `limitCooldownSeconds` and never opens it. On an unchecked version the
format is not read, and the result says so (Codex's run error `its reset time is not read: …`, or an account's usage report
`unreadable`, naming the version).

| Runtime | What the installed version exposes | What is read | Versions |
|---|---|---|---|
| Claude Code | a `rate_limit_event` per limit check in the SDK's stream: `rateLimitType`, `status`, `resetsAt` (Unix seconds), `utilization` | every event, as an observation of its window | any (the SDK's own types) |
| Codex | no rate-limit event from `codex exec --experimental-json`. A turn that hits the limit fails (`turn.failed`) with a message naming when to retry, to the minute, in local time: `… try again at 3:04 PM.`, `… at Oct 25th, 2026 3:04 PM.`, or `… try again later.` | the reset as a `rejected` observation of window `*` (the message names no window, so the pool closes whole), one minute late (the minute is truncated). The zone is the child's: its `env.TZ`, else the daemon's `TZ`, else the host's zone; the runtime never sets `TZ`. A time without a date is on the child's date (late past midnight, never early). A wall-clock time that a DST change shows twice, or never, is read as the later instant. A `TZ` that is no IANA zone name as the child reads it gives no reading, and the error says so | `VERIFIED_LIMIT_VERSIONS`: 0.164.0 |
| Antigravity CLI | the run's stream and quota errors name no reset. Print mode answers `/usage` without an agent turn; `--output-format json` gives groups of buckets with `id`, `window`, `disabled`, `remaining_fraction`, `remaining_amount`, and `reset_time` (RFC 3339, UTC) | nothing in the run. After a run that hit a quota, the account's usage report is read (`agy --print=/usage --output-format json`, [below](#an-accounts-usage-report)); its rejected bucket gives the reset | `VERIFIED_LIMIT_VERSIONS`: 1.4.6 |

Window names (a Claude `rateLimitType`, a Codex window's length, an Antigravity bucket `id`) are opaque. The Worker's `windows` maps
them to the pool's windows. `*`, or an unmapped rejection, closes every window of the pool ([metering](#metering), step 3).

Fixtures: `runtime-codex-sdk/tests/fixtures/codex-0.164.0-limit-messages.json`, `runtime-antigravity-cli/tests/fixtures/agy-1.4.6-usage.json`. No live account has been used; each format is also a [release check](../validation/release-checklist.md).

Not read in a run: a Codex run's usage percentages (`codex exec` reports none) and agy's credits. An account's shares between runs come
from its usage report (below).

### An account's usage report

> Decision: [ADR-0059](../decisions/adr/0059-quota-readings-from-each-accounts-own-usage-report.md).
> Code: the three runtimes' `limits` and [`agent-workers`](../../packages/plugins/agent-workers/README.md) (`src/reports.ts`).
> Differs from target: each reader rests on the installed binaries and on fixtures, not yet on a live account
> ([release checklist](../validation/release-checklist.md)); the Codex reader's exchange rests on `codex app-server generate-ts` on 0.164.0.

A run's own events give a window's share only near or at a limit, and nothing is read between runs. Each runtime can also report every
window of the signed-in account on request, without a model turn: the optional `limits({ home }, signal)`, recorded in the account's pool
([resources: readings from an account's usage report](resources.md#readings-from-an-accounts-usage-report)).

- **The seam.** `limits` reads the account signed in to `home` (its own home when absent; a provider without `homes` answers a named home
  `unreadable`), under the probe's confinement and environment. It starts no model turn, spends no quota a run would, and leaves no
  conversation behind; a runtime that cannot promise that does not implement it. It reads a format only on a checked version, else answers
  `unreadable`, naming the version. It never throws. A Worker source asks through `readLimits` (30 s, aborted with its caller, fail-closed
  on anything the seam does not define). `agentRuntimeLimitsConformance` checks it.
- **The readers** convert their own units: shares used 0 to 100, ISO times, a reset more than 400 days away dropped, and a window with
  nothing left `rejected`. A report in any other shape is `unreadable` as a whole.

  | Runtime | Report | Windows | Versions |
  |---|---|---|---|
  | Claude Code | the SDK's `get_usage` control request (`usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET({ skipBehaviors: true })`) in a session that sends no message, with no tool, settings, MCP server, or hook, and writes no session (`persistSession: false`) | each window of `rate_limits` (when `rate_limits_available`) whose `utilization` is a number, under the name a `rate_limit_event` uses (`five_hour`, `seven_day`, `seven_day_oauth_apps`, per-model weekly windows). A window is told by its shape, so new entries need no new Claude Code version. Each `model_scoped` entry is a window `model_scoped:<display name>`, lower-cased, which `modelPools` can map ([tiers per role](#tiers-per-role)). Other entries and `extra_usage` are skipped; a wrong-typed field is `unreadable`. `rate_limits_available: false` (an API key) is `unreadable` | `VERIFIED_LIMIT_VERSIONS`: 2.1.308, 2.1.309, 2.1.310 |
  | Codex | `codex app-server` in the account's `CODEX_HOME` (no MCP server, the runtime's `--config` overrides): `initialize`, `initialized`, `account/rateLimits/read`, then ended. No thread, no turn | `primary` and `secondary`, each named by its length, `<windowDurationMins>m` (`300m`, `10080m`); a window of no stated length only when used up, as `*` | `VERIFIED_RATE_LIMITS_VERSIONS`: 0.164.0 |
  | Antigravity CLI | `agy --print=/usage --output-format json` in its own home only | each enabled bucket that says what is left, by `id` | `VERIFIED_LIMIT_VERSIONS`: 1.4.6 |

- **When the `agents` source reads** (for a runtime that implements `limits`): after each run of a derived Worker on a declared pool, and after
  any run that hit a limit, so a reset read there wins over the cooldown fallback. The read happens in the run's home, before the usage is
  recorded and the reservation released. It also happens every `limitReadSeconds` (provider entry; default 600, 60 to 86400, `0` off, with
  `pool` only) for each ready, assigned account with a declared pool, skipped while a read of it is less than that old. At most one periodic
  read is in flight per runtime. A stop aborts a read in flight.
- **Fail-closed.** A report's observations become readings as a run's do (`source: runtime-result`), except that **a report never opens a
  window a `limited` reading closed** before the later of that reading's `resetsAt` and `cooldownUntil`; that `ok` reading is not recorded,
  and is logged. An `unreadable` report, a timeout, or a failure records nothing and is logged; the window keeps its last reading and
  `observedAt`. The reason and time of the last failed read are kept per account in memory (`agentAccounts.unreadReport`), and the roster
  shows them on each window with no reading yet (`used unknown (no reading yet: its account's usage report could not be read at <time>: <why>)`).
- **Fixtures:** `runtime-claude-agent-sdk/tests/fixtures/claude-get-usage.json` and `claude-get-usage-live.json`, `runtime-codex-sdk/tests/fixtures/codex-0.164.0-rate-limits.json`, `runtime-antigravity-cli/tests/fixtures/agy-1.4.6-usage.json`. The read writes no transcript and sends no model request.
- **What stays unknown:** absolute amounts (each report gives shares); windows a runtime does not report; an account on an API key; the
  Antigravity CLI beyond its one home (no identity reader, so its accounts are never `ready` and no derived Worker of it is read
  periodically); website accounts and the Gemini API.

## Admission evidence

The Worker registry admits an agent-runtime Worker only on evidence from `probe()`, never because of its name. A Worker whose runtime is
missing, cannot enforce the configured sandbox, or does not report `readsConfined` and `gatesToolCalls` is `unavailable`. So is a
`worktreePerRun` Worker whose workspace cannot hold a worktree per run (`config_error`).

A probe can take longer than the 5 s the router gives a Worker source to describe its Workers
([sources that do not answer](routing.md#sources-that-do-not-answer)), so the `agents` source never waits for a re-probe in a describe:

- **Per home.** A runtime is probed in its own home, and apart from it in each account home a derived Worker runs in
  ([its account's home](#workers--account--role)). A derived Worker whose account is not `ready` probes nothing.
- **Bounded staleness.** A probe result stands for `probeTtlMs` (5 min) from when its probe started, never longer. Past it the result admits
  nothing and the Worker is `unavailable` until the next probe finishes. A describe waits only for the first probe of a runtime in a home.
- **Refreshed in the background.** Once a result is half that old, the next probe starts, one at a time per runtime and home, whether or not
  anything reads. An account home is probed in the background only while a `ready` account's Worker runs in it; otherwise it is forgotten, and
  a later read probes it first.
- **Accounts read again.** Each probe, background ones included, re-reads the runtime's `ready` accounts (an account home's alone) before its
  result stands ([enrollment](#enrollment-and-quarantine)).
- **The latest result wins.** A probe that throws, or proves less, replaces an older success at once (INV-2).
- **A run's own check** before the agent starts waits for a result within `probeTtlMs`.
- **Each probe is bounded.** A probe not settled within `probeTtlMs` of its start (5 min with `probeTtlMs: 0`), re-reads included, is refused
  as `probe timed out`: it admits nothing, its late answer is dropped, and the next probe starts.

| Capability | Offered when |
|---|---|
| `local-data` | the Worker is ready (it runs on this machine, in its workspace) |
| `review` | the sandbox is `read-only`: a review is independent of the change ([INV-15](../architecture/invariants.md#inv-15-one-writer-per-subject)) |
| `develop` | the sandbox is `workspace-write` |
| `validate` | the sandbox is `workspace-write` and the probe reports `executes` ([confined commands](#confined-commands)) |
| `persistent-conversation` | the probe reports `resume`. Target: a resume conformance test passes. This is what qualifies a runtime as a long-lived [team member](teams.md#membership-model-a) |
| `reason`, for a review member's steps only | the Worker is under the [review-member profile](#review-members), granted while it is enforced: ready, so its runtime enforces the read-only sandbox, `readsConfined`, and `gatesToolCalls` |
| `persistent-conversation`, for a review member's steps only | the Worker is under the profile and the probe does not report `resume`: the member's conversation is kept by an exact, recorded replay (evidence `conformance`) |
| `reason`, for research work only | the Worker is a [research role's](#a-research-role) (`research`, read-only): ready, and its probe reports `webTools`. Taken by work of kind `research` only |
| `web-search`, for a research role | the role's [web probe](#a-research-role) made one real search the gate let run, within 24 h (evidence: the decision `agent-workers.web-probe`) |

An agent Worker never offers plain `reason`, so ordinary asks never spend agent-plan quota ([P1](../requirements/purpose.md)). The offers a
review member adds are scoped to its steps ([scoped offers](routing.md#scoped-offers)).

### Review members

The operator may place a read-only agent Worker under the **review-member profile** (`reviewMember: true`;
[ADR-0049](../decisions/adr/0049-read-only-agent-workers-as-review-members.md)), making it a member of a [`review` team](teams.md#review)
beside a website Worker or another runtime, by configuration only. Load refuses the configuration unless the sandbox is `read-only`, the
Worker names its provider `family` (so two members of one vendor stay apart; [provider diversity](routing.md#provider-diversity)), and
`worktreePerRun` is off.

- **The profile grants `reason`, never the Worker.** The offer exists only while the profile is enforced: the probe proves now that the
  runtime enforces the read-only sandbox, keeps host state unreadable, and asks the gate before every tool call.
- **Every member step runs under the profile**, or not at all (`config_error`, nothing run):
  - the Worker is under the profile (a Worker that is not never runs one, not even its first);
  - its workspace is an empty directory outside any git work tree, checked before anything is sent, so nothing a runtime reads on its own
    (an instruction file, the repository above) reaches the member. Its material is its prompt alone, the source the engine read at the pinned commit;
  - its gate denies every tool call, each a recorded `gate` decision: no write, no read;
  - after the step the workspace must still be empty, or the run fails as `reconciliation_failed`, its answer not trusted;
  - its record is `agent-result@1.3`, `profile: review-member`.
- **Why a member needs a conversation.** Each member is asked at least twice: its proposal, its sealed ballot, and a debate turn after a split. The ballot and
  debate prompts quote findings and ballots only ([teams](teams.md#ballots)).
- **On a runtime that resumes** (Claude Code, Codex), it continues natively. A member step whose session has earlier turns but no native
  conversation is refused (`invalid_input`, unsent): a member is never given a fresh conversation for a continuation.
- **On a runtime that cannot** (the Antigravity CLI), the `agents` source **replays** it. This is a replay, not a resume: each later step starts a new agent
  conversation whose message holds the session's earlier completed turns of its generation, in order, each as recorded, between fence lines derived from its
  own text, then the new message. Every earlier turn ran under the profile, so no tool ran in it. Failed turns are no part of it, and the session keeps no
  native handle. A reset starts a new replay.
  - **Recorded.** The replayed runs are fixed when the step is first prepared. Its `agent-result@1.3` names them (`replay.runs`), their answers (`replay.answers`,
    also the artifact's `inputs`), and the hash of everything sent (`replay.promptHash`).
  - **Fails closed**, unsent: an earlier turn still open, one not run under the profile, one whose answer is no longer stored (`invalid_input`), or more than
    `maxReplayChars` (default 200,000) characters of earlier turns. A history is never cut (INV-9). Egress checks the replay at the strictest classification of
    its turns (INV-12).
- **Outside a member's steps**, a session that a runtime without `resume` is asked to continue is refused (`config_error`, unsent).

### A research role

A role (or a worker) with `research: true` is a **research role** ([ADR-0074](../decisions/adr/0074-a-research-roles-web-calls-run-under-a-bounded-egress-checked-grant.md)):
it reads the workspace and searches the web, and nothing else. It lets research's second literature review run on a Claude Worker, a
different family from the first.

- **Read-only, no shell.** Load refuses the configuration unless the sandbox is `read-only`, and it is no review member. Its tools (the role's,
  and each tier's, [tiers](#tiers-per-role)) are `Read`, `Grep`, `Glob`, `WebSearch`, `WebFetch`, all five by default. Its run asks for web tools
  (`RunSpec.web`), which only a runtime reporting `webTools` takes (Claude Code; Codex, the Antigravity CLI, and ACP refuse it). The tool list
  must hold no writing tool or shell, or the run is refused before it starts. The gate denies a write or command call of such a run
  (`research-role`), and the brief's Tools section says so.
- **Standard tier by default**: with no `tier` and no `runtimes.<runtime>.tiers`, it is on the standard tier there. Its Worker takes research work only
  (`kinds: ['research']`), so an ordinary ask never reaches it ([P1](../requirements/purpose.md)).
- **Proves `reason` and `web-search` by a probe.** The first offer follows a probe run (read-only, `WebSearch` its one tool) that makes one real
  search of the fixed query `Wikipedia main page`, which the gate lets run, answered with a URL. The probe is recorded as the decision
  `agent-workers.web-probe` (the query, the worker, `searched`), valid 24 h, retried after 1 h. Until then, and whenever the probe cannot search
  (the [web access grant](approvals.md#a-research-roles-web-calls) is not in force, so the search would ask), it offers no `web-search`. A runtime
  reporting no `webTools` admits no research Worker.
- **Its web calls** are judged by the gate's web access rule: unasked within the grant's bound and egress check, asked otherwise, each recorded
  (`system explain` and `/ui` list them).
- **Routing.** A research step that needs `reason` and prefers `web-search` goes to a Worker that proves both before one that only reasons
  ([routing](routing.md#researchs-second-review)).
- **Turning it on** is configuration plus the operator's approval of the grant ([runbook](../operations/runbooks.md#turn-on-the-research-worker)).

## Turn semantics

- **Idempotency.** Every run is keyed by a logical request id. Target: where the agent writes a local session or rollout record, reconciliation reads it before restarting a run. Today a run that started before a crash is never run again: once a
  [liveness verdict](#restart-and-liveness) finds it gone, it fails as `reconciliation_failed` and names its native session. The exception is a run the host's
  own stop cut (a drain, shutdown, or update, marked `host_stopped_at`). After the restart it continues its native conversation when its runtime can resume and
  its handle was recorded; otherwise its prompt is sent again in the same worktree, under a `reconciliation` decision of rule `agent-workers.resume-cut`, with no
  attempt spent. An agent process still present, or a run cut more than five times, is taken by the verdict as before. A run whose lease another process holds
  is looked at again when that lease would expire.
- **Completion.** The SDK's terminal event means *provider terminal*, not acceptance. Only the routing layer accepts a Worker's result
  ([INV-3](../architecture/invariants.md#inv-3-completion-boundaries-are-distinct)).
- **Cancellation.** The abort signal is passed to the SDK, and the outcome (cancelled, or completed before cancel) is reported. An agent subprocess
  that ignores the cancel is ended: SIGTERM after a grace period, then SIGKILL.
- **Evidence.** The result artifact carries the final message, the prompt hash, the sandbox, the workspace the run worked in (its [worktree](#workspaces), with
  `worktreePerRun`), and, for a git working tree, its exact subject after the run, which a review binds to. A tree git cannot read fails the run as
  `reconciliation_failed`. With `@1.2`, the main model and token usage are recorded, in total and per model. Target: diffs, commands run, and test results stored as artifacts with their hashes.

## Restart and liveness

A started run is gone only on a [liveness verdict](scheduling-and-leases.md#liveness-verdict) of `dead`, never on its lease alone
([ADR-0056](../decisions/adr/0056-a-failed-lease-renewal-is-not-a-lost-lease-and-death-needs-a-verdict.md), L1 and L2).

- **What is recorded.** At submission the `agents` source records the run's holder (host, boot, pid, start time) and the submission as its first activity. A runtime
  that reports its agent process (`RunObserver.onProcess`; Claude Code reports the outermost process of its confinement) has it recorded once. Its activity
  (`onActivity`) is written at most once per heartbeat, a third of the run lease, fenced by the run's lease. Codex, ACP, and the Antigravity CLI report neither, so
  those signals stay `unknown`.
- **A heartbeat that fails** does not stop a run. The lease is lost only when a renewal finds it expired, taken over, or invalidated, or when its expiry
  passes unrenewed ([lease generations](scheduling-and-leases.md#lease-generations)).
- **A started run whose holder no longer holds it** (a restart, a lost lease retaken) gets a verdict before anything is reconciled:
  - `dead`: it fails as `reconciliation_failed` (`USER_ACTION`), never run again, with a `reconciliation` decision (rule `agent-workers.reconcile` version 2)
    recording the verdict and every signal. Its session and worktree are free again.
  - every signal gone but activity within `deadAfterSeconds` (default 120, twice the run lease): looked at again once the bound has passed, uncounted.
  - anything else (`unknown`, or `stalled` with an agent process present): looked at again with a bounded backoff (a minute, doubling, at most 15 minutes).
    After `maxUnknownVerdicts` (default 3) verdicts in a row it goes to the operator: it fails as `reconciliation_failed`, the decision saying it is not declared
    dead, and `agent-workers.run.unknown` is appended.
- **The operator cancels a started run that no process holds.** Its agent cannot be stopped from here, so it gets a verdict first, recorded as a
  `reconciliation` decision (`cause: cancel`). `dead` ends it `aborted` as gone; any other verdict ends it `aborted` not known to be gone, held as below,
  with `agent-workers.run.unknown` appended. Its reservation is released and its usage recorded as unknown (`interrupted`). A run its holder runs here
  is aborted in place; a queued one never starts.
- **A run that ended without being known to be gone** holds its session and worktree (INV-15) until the operator [frees it](#freeing-what-a-run-holds).
  The source runs nothing more in either (`config_error`, unsent), the retention keeps the worktree, and [`held`](#held-sessions) says so.
- **A stall.** While a run is held, a run whose agent process is present and quiet for `stallSeconds` (default 300) is `stalled`, reported once per stall
  (event `agent-workers.run.stalled`, and a log line). Nothing is sent to the session and nothing is stopped: the run's own deadline and turn limit end it.

### Held sessions

`held(sessionId)` on the `workers` seam says why a session takes no input now. It is derived from durable facts when asked, never stored. A session is
held when:

- its latest run has not finished;
- any of its runs ended without being known to be gone;
- its latest run stopped on a deferred tool call whose approval request is still open. The run records the request; for an older run, the gate's
  `agent-workers.tool.deferred` event names it. The queue is asked for its state. With no queue loaded, or a request it cannot read or does not hold,
  the session cannot be shown free.

An answered request (approved, rejected, expired, or withdrawn) frees it. On approval, the engine's one continuation of the deferred call is the
session's input ([a deferred tool call](workflow-engine.md#a-deferred-tool-call)). A run the operator freed no longer holds it.

### What the operator sees

`liveness()` on the `workers` seam (optional, additive) lists the runs whose liveness needs the operator's look, read from durable facts when asked:
at most 64, the latest first, with the counts of all:

| State | Which runs | What it tells |
|---|---|---|
| `stalled` | running, a stall reported and not yet over | the agent process as this host shows it, the latest activity; nothing is sent to it, its own deadline ends it |
| `looking` | started, its holder gone, verdicts being taken | the latest verdict, its looks of `maxUnknownVerdicts`, each signal as this host shows it now |
| `unknown` | ended without being known to be gone, not freed | the verdict and looks, the signals its `reconciliation` decision recorded, what it holds, and `system free` |

Each names its session, its workflow run's worktrees, and what the operator can do. Surfaces read it through the seam: MCP `status` and `system health`
(a `liveness` check, degraded while an `unknown` run holds what it ran in or a source cannot tell), `explain`, the roster's **Doing now**
([roster](roster.md)), and the report's attention section ([reports](reports.md#what-it-counts)).

### Freeing what a run holds

A run that ended `unknown` holds its session and worktree until the operator judges its agent gone (ADR-0056). The operator gives that with
`agent_run_free` (operator scope, `mcp-agent-runs@1.0`; `system free <run> --agent-gone`):

- **On the operator's word only.** `agentGone` must be true: the operator's statement that no process of the agent runs. It is recorded first as their
  `reconciliation` decision (decider `operator.free`, not deterministic, the note as rationale), with the signals as this host shows them and what
  happens to each worktree (INV-13). The run keeps it (`liveness_freed`), and `agent-workers.run.freed` is appended. From then on `held`, a later run's
  check, and the retention sweep no longer count it.
- **Refused, changing nothing** (INV-2): a run that holds nothing (completed, found `dead`, or ended with its agent stopped by its holder); while its liveness
  is still being looked at, or another started run of its session or worktree has not finished; while its lease or its holder or agent process is held on this host.
- **Its worktree** (a Worker with `worktreePerRun`): removed only while no other agent run of its workflow run is unfinished or not known to be gone,
  and only when it holds nothing uncommitted, or, with `commitWorktree`, once its changes are committed on its branch as the retention commits them.
  The branch always stays, nothing is forced, and a worktree that stays is the retention's. The decision is stored on the worktree's record. A freed
  run may be freed again for its worktree only, each time with its own decision; with no worktree of it left, that is refused.
