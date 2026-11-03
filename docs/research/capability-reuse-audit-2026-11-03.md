# System capability reuse audit (2026-11-03)

Non-normative research. This is a source-and-manifest inventory and external-candidate
screen, **not** an implementation decision, tested integration, or confirmation that
any package can be removed. It extends the [2026-10-11 DSH community plugin review](dsh-community-plugins-review.md)
and supports [PROP-0023](../proposals/0023-capability-reuse-and-deletion.md).
The controlling policy remains [ADR-0010: reuse or adapt before building](../decisions/adr/0010-reuse-before-build.md).
The system guarantees remain those in [ADR-0036](../decisions/adr/0036-guarantee-core-and-capability-plugins.md)
and [invariants](../architecture/invariants.md).

## Questions and scope

Could existing Hermes Agent, first-party DSH, community DSH, protocol SDK, or small
standalone-library implementations supply System capabilities so that System maintains
**less** code, fewer services, and fewer state owners? Which portions already use
external implementations, which are genuinely System-specific, and what must be
proven before adopting or deleting anything?

- **System baseline:** [tsuuanmi/system](https://github.com/tsuuanmi/system/tree/dev),
  branch dev, commit **737ca1ad161a74b65e844927576caf01d07addc9**.
  Do not substitute main: it differs materially. The record was inspected on 2026-11-03.
- **External sources:** Hermes Agent (NousResearch), DeepSeek Harness first-party
  packages, FuncWei/dsh-kanban, THEWOLFWALKER/dsh-notifier, OpenViking, and
  GM-HZ/agent-dag-workflow, plus candidates already assessed in the older reviews.
  Their mutable main branches and published package metadata were inspected on
  2026-11-03; **no external commit or package version is pinned for adoption**.
- **Method:** checked the recursive Git tree, package names and sizes, relevant
  package READMEs, the shipped bundle and declared dependency versions; read
  published upstream README/manifest/API documentation for shortlisted candidates.
  No npm package was installed, no candidate was executed, no source dependency
  graph or coverage analysis was run, and no conformance test was performed.
- **Counts:** 1,759 tracked blobs in System dev; 58 package.json files under
  packages/ (including the preset); **43 plugin directories** under packages/plugins/.
  These are **file counts, not LOC or runtime footprint**.
- **Source sizing:** Git tree byte sizes under packages/plugins/*/src/ total
  **4,160,892 bytes**. Workflow contributes 1,345,524 and agent-workers 872,007
  bytes (**53.3% combined**). This excludes client UI, tests, generated files,
  scripts, and other workspace packages. web-ui/client/ is 241,729 bytes and
  web-ui/client/board.ts is 23,487 bytes (about 9.7% of that client directory).
  Byte size neither establishes complexity nor predicts removable LOC.

## Findings

1. **System is already built on reusable components.** It mounts the allow-listed
   DSH/Cordis core, SDKs for Claude/Codex/ACP/MCP, patchright, noVNC, Secretlint,
   Xvfb and SQLite. The [dependency register](../engineering/dependencies.md)
   documents previous adopt/adapt/build comparisons. Replacing these adapters
   with a larger framework is not automatically an improvement.
2. **Overlap is not interchangeable semantics.** System's board, approvals,
   leases, receipts, resource reservations, review acceptance and landing
   contain guarantees beyond corresponding Hermes/DSH user-facing features.
   Retain **one authoritative writer, state machine, scheduler and ledger per
   subject**. Candidate UIs and transports must not create competing owners.
3. **Hermes should be treated as a source of capability implementations,
   not as an additional Worker or control plane.** Do not add the Hermes agent
   loop, dispatcher, autonomous subagents, or self-modifying skills merely
   to obtain Kanban, memory, scheduling, or skill discovery.
4. **Kanban is a capability/UX opportunity, not yet a code-reduction win.**
   Hermes ships a bundled dashboard extension with API and WebSocket.
   The System board client is relatively small; an adapter, sidecar and SDK
   shim might exceed the code removed. Do not replace the System board DB.
5. **Skills and knowledge are stronger reuse-before-build opportunities.**
   System's knowledge seam is not a complete memory backend. First-party
   DSH skill registry/filesystem and existing memory backends should be
   compared before System builds equivalent infrastructure.
6. **Notifications are a transport opportunity.** Existing provider
   dsh-notifier exposes many channels, but its DSH session/client dependencies
   and inbound remote-control permissions do not match System by default.
   Preserve System's event selection, deduplication, scope and delivery records.
7. **Most potential LOC is in workflow and agent-workers, not Kanban.**
   These are the priority for dead-path, duplicated orchestration,
   library-capability and data-flow analysis, **not** blanket engine replacement.
8. **The lean-core parking decision is already in effect.** Per
   [components: Parked](../architecture/components.md#parked), frozen components
   are not automatically removable; the existing policy says deletion may be
   separately decided after **2026-12-01** if there has been 30 days of no use,
   verified through the event log. This audit does not accelerate that date.

## All 43 installed System plugin packages

Verdicts are **screening recommendations**, not authorization to change
composition. Keep = no equivalent proven for System guarantees; existing reuse =
already wraps an external component; adapt = investigate only; park = retain the
current off/frozen state until the existing deletion policy is satisfied.

### Guarantees, scheduling and state (15)

| System plugin | Relevant prior art or reuse | Screen verdict | Why / what to prove |
|---|---|---|---|
| store | SQLite, DSH storage | Keep | Relational transactions and same-commit decisions |
| artifacts | Content-addressed stores, DSH attachment | Keep | Immutable provenance, typed decision artifacts |
| event-log | DSH event/telemetry services | Keep | Atomic append with authoritative transaction |
| leases | GM-HZ run leases, lock libraries | Keep | Monotonic generations and stale-write fences |
| credentials-vault | DSH credentials, keychain plugins | Keep | Encrypted at rest, scoped grants, durable file hygiene |
| turn-receipts | DSH sessions/receipts | Keep | Receipt before send, never-blind-retry reconciliation |
| approvals | DSH approval service, Hermes approvals | Keep | Exact-subject decisions, expiry, policy changes |
| egress | Secretlint | Existing reuse | Retain classification and actual-payload gate |
| resources | LiteLLM usage/budget tools | Keep | Holds, reservations, authoritative accounting |
| workers | DSH routing/subagents | Keep | Fail-closed capability admission and records |
| workflow | GM-HZ agent-dag-workflow; DSH workflow | Deep comparison only | Node fencing, deterministic resume, exact-tree checks |
| board | Hermes Kanban state engine | Keep | Revision checks, claims, acceptance and funding |
| agent-workers | Claude/Codex SDK, DSH agent teams | Simplify internally | Worktree ownership, sandbox, liveness, recovery |
| landing-local | Git, GitHub integration tools | Keep | Exact-subject merge, serialized safe landing |
| plugin-host | Cordis lifecycle, DSH plugin manager | Keep thin | Host records checks/decisions distinct from loader |

### Workers, browsers, accounts and interfaces (15)

| System plugin | External implementation | Screen verdict | Why / what to prove |
|---|---|---|---|
| agent-runtimes | Cordis registry, bubblewrap | Keep thin | Shared confinement and runtime capability proof |
| runtime-claude-agent-sdk | Official Claude Agent SDK | Existing reuse | Do not duplicate SDK sandbox/hook behavior |
| runtime-codex-sdk | Official Codex SDK | Existing reuse | Existing pinned hook and sandbox semantics |
| runtime-acp | Official ACP SDK | Park | Already off/frozen; no observed run in prior audit |
| runtime-antigravity-cli | Antigravity CLI | Park | Already off/frozen and version-gated |
| models | DSH llm and pi-ai | Existing reuse | System still owns durable, metered Worker view |
| turns | DSH sessions and providers | Keep | Receipted and recoverable website turns |
| accounts | DSH credentials | Keep | Tier/account grants, browser auth state |
| login | noVNC, VNC, otpauth | Existing reuse | Keep browser-profile security checks |
| providers | Cordis lifecycle registry | Keep thin | One registration per provider |
| provider-chatgpt-web | Community DSH ChatGPT drivers | Keep/reference | Existing alternatives lacked required durability/security |
| provider-gemini-web | Community Gemini drivers | Keep/reference | Private API and raw-cookie mismatches |
| browser-patchright | Patchright/Playwright | Existing reuse | Isolation, bounded browser lifecycle, IndexedDB |
| display-virtual | Xvfb | Existing reuse | Xauthority and hidden display confinement |
| mcp-server | Official MCP SDK | Existing reuse | Auth, Host/Origin guards, stateless MCP |

### Optional capabilities and surfaces (13)

| System plugin | Candidate | Screen verdict | Gap / constraint |
|---|---|---|---|
| web-ui | Hermes Kanban UI, dsh-kanban | Adapt UI only | Reuse board visualization; retain other operator pages |
| report | DSH usage dashboards | Reference UI only | System ledger remains metric source |
| notify | dsh-notifier, ntfy/webhook | Transport spike | Do not adopt inbound remote command/approval path |
| lead-inbox | dsh-notifier outbound channels | Keep event logic; adapt sink | Per-project notice semantics and delivery |
| decisions | DSH plan/todo/ADR tools | Keep off | Durable numbered operator answers have different semantics |
| worker-sessions | DSH Agent Teams | Keep | Cross-runtime peer messaging, durable barriers |
| profile-software-development | DSH skills, Agent Skills standard | Adapt instructions/format | Templates are not a skill registry |
| profile-scientific-research | DSH skills | Adapt instructions/format | Typed evidence and structured contracts remain |
| digest | Hermes/context summarizers | Keep | Quote checking and exact artifact references |
| digest-extractive | Summarization libraries | Park | Existing frozen alternate provider |
| gateway-responses | LiteLLM and API bridges | Park | API proxy does not reproduce receipted web turns |
| gateway-anthropic | Claude routers and LiteLLM | Park | Same protocol vs web-turn semantics mismatch |
| workers-fake | DSH testing tools | Keep | Cheap deterministic conformance fixture |

Do not replace a plugin just because another tool has the same feature name.
The tables do not include the non-plugin libraries (for example ui-ops,
provider-core, board-core, gateway-turns, ledger-core, feedback-core);
their relevant contracts still apply to any migration.

## Shortlisted upstream implementations

| Candidate and evidence | Surface to evaluate | Direct-install status / blocker | Recommended next step |
|---|---|---|---|
| [Hermes Kanban](https://github.com/NousResearch/hermes-agent/blob/main/website/docs/user-guide/features/kanban.md) and [plugin manifest](https://github.com/NousResearch/hermes-agent/blob/main/plugins/kanban/dashboard/manifest.json) | Bundled dashboard JS/CSS and REST/WebSocket UI | Not proved compatible with System's DSH web UI; API depends on Hermes DB and settings | Read-only compatibility adapter against System board snapshot |
| [FuncWei/dsh-kanban](https://github.com/FuncWei/dsh-kanban) | DSH web proxy and frontend shim to Hermes UI | Local Python sidecar, independent SQLite and dispatcher, DSH client deps; **not** drop-in | Reference shim only; prohibit secondary dispatch and DB |
| [DSH skill](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/skill/skill/README.md) and [skill-filesystem](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/skill/skill-filesystem/README.md) | Skill registry, discovery, lazy loading and file watching | Host composition omits these rows; model-facing tool assumes DSH agent loop | Verify registry can serve Worker briefs without agent loop |
| [OpenViking DSH memory plugin](https://github.com/volcengine/OpenViking/tree/main/examples/dsh-memory-plugin) | Recall, capture, skill search and MCP | Requires OpenViking server, dsh-llm, dsh-mcp-client and dsh-skill-filesystem; its hooks target DSH agent sessions, not System Worker sessions | Isolated backend/API trial with redacted seeded artifacts |
| [Hindsight](https://github.com/vectorize-io/hindsight) | Standalone memory/retrieval alternative | System-specific integration and license/deployment compatibility unverified | Compare a **direct backend adapter**, not assumed native plugin parity |
| [dsh-notifier](https://github.com/THEWOLFWALKER/dsh-notifier) | Outbound transport channels | Observed 0.13.1 manifest has dsh-session 0.1.7 alpha/rc peer range; System pins DSH host 0.2.1-alpha.2; client layer mismatch | Outbound-only isolated POC; no inbound approval or steering |
| [GM-HZ/agent-dag-workflow](https://github.com/GM-HZ/agent-dag-workflow) | Durable DAG journal, checkpoint, unknown-side-effect handling | Observed 1.0.1 manifest requires Cordis ~4.0.4 and DSH client/React dependencies; System pins Cordis 4.0.5-alpha.1 | Contract gap and cost comparison before any rewrite |
| [dsh-skill-manager](https://github.com/sulfide2085/dsh-skill-manager) | DSH/Claude/Codex skill management UI | Requires DSH client/runtime APIs not mounted by System | UI reference only if skills actually needed |

**Observed pins (not compatibility claims):** System uses
@deepseek-ai/cordis **4.0.5-alpha.1**, @deepseek-ai/dsh-host-webserver
**0.2.1-alpha.2**, Node **^24.18.1 or >=26.5.1**, pnpm **12.9.1**.
Some third-party peer ranges exclude alpha prereleases under semver.
Inspect a candidate's exact lockfile, transitive dependencies, init/teardown,
untrusted API routes and executable hooks, then test an isolated composition
before declaring support. Do not install by copying a candidate README command.

**Security warning:** Hermes's Kanban documentation says its dashboard
authentication middleware exempts /api/plugins/ routes on loopback, whereas
its WebSocket requires a token. The HTTP routes therefore must not be exposed
as System operator mutations without System's own auth, scope and revision
checks. dsh-kanban additionally owns a separate dispatcher and DB; never
mount those as a second source of truth. OpenViking's session-capture hooks
could export local/private content without System's egress policy; disable
auto-capture until provenance and classification are proven.

## Prior analysis not to discard

The [October 11 community review](dsh-community-plugins-review.md)
already rejected or retained as references alternatives for MCP servers,
ChatGPT Web providers, credentials, browser runtimes and agent teams. It called
GM-HZ's DAG package the best candidate but identified gaps in input-hash reuse,
node leases and dependency costs. Re-evaluate **if changed**, not by assuming
a newer package fixes earlier findings.

The [dependency register](../engineering/dependencies.md) already names
DSH/Cordis core, official SDKs, Patchright, noVNC, Secretlint, SQLite, Git,
bubblewrap and other reused code. Do not count these as unexploited opportunities.

The [Lean Core proposal](../proposals/0022-lean-core.md) has higher priority
for reducing lead time and approval-induced run termination. Reuse spikes must
not interrupt its control-plane correctness work.

## Comparison rubric and evidence ledger

For **each** candidate the implementer must record:

1. Exact System revision and candidate commit/package tarball SHA + SPDX license;
   provenance and whether source was inspected or only README/manifest.
2. Required semantics: which seam contract and test scenarios cover it, and
   which behaviors are absent or weaker.
3. Host fit: exact Cordis/DSH peer versions, Node, build artifacts, unload
   behavior, offline install, subprocesses/ports and credential requirements.
4. Trust boundaries: ingress/egress, filesystem, network, operator auth,
   project scope, permissions, prompt injection, data retention and remote control.
5. Operational ownership: canonical state, persistence, migrations,
   idempotency, process death/restart, observability, upgrade and rollback.
6. Cost of reuse: **added + deleted production LOC**, tests removed/added,
   dependencies, services, resident memory and latency. Keep counts reproducible
   and separate source bytes, LOC and actual measured runtime resource usage.
7. A **Go / No-go** verdict with dated test evidence. A README, version match,
   UI demo or “similar feature” alone does not prove conformance.

Decision labels: **use as-is**, **reuse library**, **adapter**, **selective port**,
**keep**, **park**, **delete after evidence**, **reject**. A replacement is worthwhile
only if it preserves every applicable invariant and reduces net maintenance
cost or supplies a specifically requested capability. “Add plugin and keep the
old implementation indefinitely” is a failed migration.

## Recommended bounded experiments (not approved integrations)

1. **Source simplification first:** break down workflow/src and
   agent-workers/src by responsibilities, exported consumers, call paths and
   measurements. Identify unreachable code and overlapping dispatch,
   recovery, worktree/check and state orchestration. Propose *deletion-only*
   slices with unchanged conformance.
2. **Skills without second agent loop:** mount registry/filesystem in an
   isolated profile and verify catalog, lazy load, project roots, unload,
   policy and brief translation to Claude/Codex. Do not permit a skill to
   change System policy or executor permissions.
3. **Knowledge provider:** compare OpenViking's direct API to Hindsight with
   identical scrubbed fixtures and citations; opt-in indexing only, no
   ambient transcript capture or cross-project recall.
4. **Notification transport:** one outbound channel, System-controlled
   event-to-notice conversion and recorded delivery results; remote control
   disabled.
5. **Kanban read-only UI:** map System projects/tasks/runs into Hermes's
   presentation schema without Hermes SQLite or dispatch. Include empty,
   stale, waiting-approval, blocked and done cases. Proceed to mutations only
   with approval/revision and auth cases and positive net-maintenance evidence.
6. **Durable DAG replacement:** comparative analysis only unless core
   conformance suite passes the candidate and an operator approves an
   explicit architectural ADR.

## Adopted / not adopted

**Adopted as research priorities:** source-level duplication audit,
first-party DSH skill comparison, direct memory-provider comparison,
outbound notification transport, conditional Hermes Kanban read-only spike,
retention of existing safety guarantees.

**Not adopted:** Hermes as a coding Worker/control plane; two authoritative
boards/schedulers; direct unreviewed plugin installation; autonomous skill
self-modification; replacing approval, resource, lease or landing guarantees;
deleting parked features before the existing 30-day policy; declaring any
candidate production-ready from this static review.

## References

- [ADR-0010 reuse ladder](../decisions/adr/0010-reuse-before-build.md)
- [ADR-0036 guarantee vs capability seams](../decisions/adr/0036-guarantee-core-and-capability-plugins.md)
- [System current package map](../architecture/packages.md) (generated)
- [System bundle composition](../../packages/system-bundle/cordis.patch.yml)
- [System dependency register](../engineering/dependencies.md)
- [System parked-components policy](../architecture/components.md#parked)
- [DSH skill provider](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/skill/skill/README.md)
- [DSH filesystem skills](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/skill/skill-filesystem/README.md)
- [Hermes Kanban docs](https://github.com/NousResearch/hermes-agent/blob/main/website/docs/user-guide/features/kanban.md)
- [dsh-kanban README](https://github.com/FuncWei/dsh-kanban)
- [OpenViking memory bundle](https://github.com/volcengine/OpenViking/blob/main/examples/dsh-memory-plugin/README.md)
- [dsh-notifier](https://github.com/THEWOLFWALKER/dsh-notifier)
- [agent-dag-workflow](https://github.com/GM-HZ/agent-dag-workflow)
