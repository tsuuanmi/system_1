# @tsuuanmi/system-web-ui

The **operator's web UI**, on the DSH webserver under `/ui` (loopback only). Its design rules
(what needs you first as cards, a button's effect as its tooltip, the word bound on the first
screen, one spacing and one type scale, light and dark, a 360 px phone; and the operator's iPhone:
its safe areas, 44 px touch targets, tooltips on a tap, no zoom on focus, a detail page's primary
action in a bar at the bottom, tables as cards below 600 px) and its screenshots are in
[the web UI at a glance](../../../docs/design/web-ui.md) (T239, T240). Every page is built from the
same few blocks (T172), one implementation each: the **status chip**, the **number with its unit**,
the **relative time**, the **fold**, the **copy button**, and the **decision button** (T191), labelled
by its concept's one wording (**Approve** / **Deny**, **Accept** / **Send back**, **Confirm** /
**Cancel**, **Stop run**, **Retry failed step**, **Show change**, **Propose**) and described by what it
does (`aria-describedby`, shown as its tooltip). Production states: a *Loading…* skeleton, *updated
12 s ago* in the header, a **stale** banner when a refresh fails over a page already shown, an error
with **Try again** when a page never loaded, a confirmation only before a destructive move, and
**Skip to content** first in the keyboard order.

- **Every project in one UI** (T253, D88): Home's *Needs your attention* and its cards are grouped
  by project, each group headed by the project's name and its own count tiles, the most urgent
  first (what expires within the hour, then the most that waits, then the earliest deadline), what
  is in no project under *Other*, a batch whole in its first request's project; a project's name
  filters Home to it, its recent runs too (`/ui/?project=<id>`, until **All projects**); each project's
  weekly report and its metrics have a small page of their own (T256, `/ui/?view=reports&project=<id>`,
  linked as **Reports** beside its group's name), a table of the commands that print them (`system report
  --project <id>`, `system metrics --project <id>`) with copy buttons. The Board shows one project
  at a time, or **All projects** as each project's counts only; the Workers page stays shared, each
  step a Worker runs naming its run's project.
- **Round 2** (T256): every page full width, Home, a run, and Workers on a responsive grid (a side
  column from 900 px, a third column on Home from 1600 px, one column below 900 px), prose capped at
  75 characters; each step's run time and when it ended (a running step's ticking), a run's total
  and a timeline bar, from `timings` in `GET runs/<id>` (each step's latest start and end in the
  event log, `{unknown}` with why without one) and each decision's `at`; one line per decision, its
  reasons on a click, a deferred call's wait and verdict one line; *Started by itself* a table at
  the bottom of Home, one row per task; long hashes, ids, and paths shortened behind copy buttons;
  every colour, space, type size, and radius a CSS variable written once (`tests/round2.spec.ts`).
- **Home**, a dashboard: what needs the operator's attention and they can act on (open approval
  requests, reviews held for them, runs that wait for their own move or failed outside the board
  since they last looked, each a tile with its label and its count, *Approvals · 3*, linked, then named one by one
  under its count, folded (up to 5 a group, each linked to its card, with when it expires), beside the
  Workers' availability as chips (T239), and counted in
  the window's title on every page from one route, `GET waiting`: *(3) system — Home*), what happened since the
  operator last looked (5 lines, then **Show all N**, as for the runs needing attention, T186;
  kept in the browser only, until **Mark as seen**; `GET activity`; a failed
  run led by the run page's own plain-words reason, by one function, its raw text folded, T160), the
  Workers at a glance (each account's capacity and **Right now**, the Workers page's own section, so
  both name the same Workers; their counts said once, in the chips at the top), after those
  decisions, and the recent runs (5 rows, then **Show all N**) by their tasks' titles, each step
  with its Worker's name; a running run's page and Board card say where it is now (its step, Worker,
  last event, and a stall; `GET runs/live`), and a start names who would likely take each step.
  Both reads are bounded per request and read the newest first: the runs by state and by when
  their state changed (`ctx.workflow.usage` with a filter), however long ago they started, and the
  event log newest first (`ctx.eventLog`, contract 1.1), each part with `more` past its bound and
  `{unknown}` with why when it cannot be read (T127); and *Starts awaiting approval* (ADR-0064): each
  start the dispatch pass proposes, with its task, attempt, Worker, each window of its account
  (`5 h · used 12 % · reserve 20 % · resets 14:20`), and, folded, why that Worker, approved or
  denied there by the queue's own verdict on the request's exact subject; whether automatic starts
  are off or paused (the reason in sight, how to resume folded); the approved starts waiting for
  their Worker; and, folded, why each ready task did not start at the last look (`GET dispatch`,
  [the page](../../../docs/reference/web-ui.md#dispatch));

- **Help** (`?view=help`): how System works in plain words, each answer folded under its question
  (Workers, the task lifecycle as a flow of states, your decisions, autonomy, troubleshooting), with
  links into the pages, and a searchable glossary whose definitions are folded (a link to a term
  opens and focuses it); a **?** beside each such word on the pages opens its sentence in place by
  keyboard or touch, linked to its entry; every empty state is one short line, with a link where
  there is a next step ([help](../../../docs/reference/web-ui.md#help));
- a run's page: headed by its task's title (else its template), its project and attempt below and
  its id behind **Copy run ID** under **Technical details**, a status chip with where it is (its step
  and Worker, or a failure's reason in plain words; what it waits on is the card below it), when it
  started, and **Stop run** or **Retry failed step** beside them; a long answer's first lines and
  **Show all**; **What happened** in a line each (*Continued from
  attempt 1*, or *Started over — why*,
  [ADR-0061](../../../docs/decisions/adr/0061-a-tasks-next-attempt-starts-from-the-work-its-previous-attempt-left.md);
  *Team member 1's answer: retried once after a service error*,
  [ADR-0062](../../../docs/decisions/adr/0062-a-team-members-first-step-is-resent-once-after-a-sites-own-error.md);
  where its accepted result stands, ADR-0060; the mechanics folded), what the operator can do, the
  answer, and its steps as a timeline in words (a team's steps by member, a failure's kind in words,
  an earlier attempt's error under *Attempt history*), ids, decisions, and spec folded;
- runs, each with its state as a chip and its progress (*1/2 steps · waiting: …*) and current
  Worker in one line, every step's Worker, its template, and its id folded, and when it started; the
  run's page has every step;
- each step's Worker, tier, quota class, and decision chain (egress, tier,
  route, acceptance, recovery);
- the answer;
- the operator's **Approve / Deny** on a plan, **Vote** on a team's tie, **Stop run** (after a
  confirmation), and **Retry failed step**;
  a remediation fix whose plan is on the approval queue shows its request instead of the plan
  buttons, and is decided in the queue;
- when `ctx.approvals` is present, the **approval queue**
  ([approvals](../../../docs/design/approvals.md)) above the runs, its count Home's tile and its
  next expiry in sight within the hour: open requests by batch (*2 related requests*, **Approve all
  2**, its note for all and its id folded), each a card: what is asked as its title, an irreversible
  verdict as its chip, *Expires in 12 min*, and two buttons, **Approve** and **Deny**, each described by its
  effect (*merges the change*, T191), with, on a `policy-change` request, **Show change** beside
  them (the effective modes it moves and the record's diff, and, for a change the queue proposed
  itself, that it did and why; never folded); everything else under the card's one closed
  **Details** (T186), kept open through the refresh once opened: the request
  in plain words (for which task, *No response: denied*, what is asked, who asked by a readable name,
  what approving and denying change, the exact subject behind **Exact subject**, and what a
  verdict does in words, its long hashes folded behind **details**; an accepted result's merge
  names its task and *not pushed*, asked by the run of that task, says what approving and denying
  do in words, and folds the branch, both heads, and the requester's own text with its paths and
  hashes; the request id, its exact expiry, and the requester's run, session, step, and change ids),
  and an optional note for the verdict; a batch's **Approve all N** / **Deny all N** have a note
  for all. What a verdict did (what happens next,
  or not recorded and why, its record ids folded) stays above the page until dismissed
  ([the page](../../../docs/reference/web-ui.md#approval-queue)). Without it the page shows the runs alone and the queue routes answer `503`;
- when `ctx.approvals` is present, the **autonomy policy** page (`?view=policy`): the set in force
  (*Active policy · Configuration* or *Active policy · Approved change*, the change id and hash
  folded), the modes as chips (*Automatic*, *Notify*, *Ask approval*, *Blocked*; what each means
  and the stored values folded under *About modes*), the effective mode of every action type for
  the studio and each project, the policies, the latest changes (policy and version, a state chip,
  when, *3 actions changed* folded, its id behind a copy button) with their diffs, and **Propose a
  change**: the operator edits one policy record (the next version, or a new project's policy) as
  a form (a mode per action type, the types that always ask fixed at *Approval required* with why
  folded, a row saying only its required checks and expiry, the commands as lines, the expiry and
  batch numbers; the JSON folded under **Advanced**), sees the change, and proposes it. The proposal is asked
  in the queue as a `policy-change` request on the exact hash of the set it makes, and applies only
  when the operator approves it there ([a policy change](../../../docs/design/approvals.md#a-policy-change)).
  An asked change's card, with its **Approve** and **Deny**, is at the top of the page, and its
  history row links to it; every other pending decision (a charter or a task's approval on the
  Board, a run's fix) links to its card on Home (`?request=<id>`).
  A queue at contract 1.0 takes no proposal (`501`);
- when `ctx.board` is present, the **reviews**: every board task in review, those the board
  holds for the operator first ([board](../../../docs/design/board.md#required-checks-bind-at-acceptance)),
  each with its project, exact subject, result artifacts, each required check with its state (passed
  or failed with its exit code only on the run's record at acceptance, not run and why, or pending;
  [ADR-0063](../../../docs/decisions/adr/0063-a-runs-required-checks-run-on-its-exact-result.md), T160),
  the checks still pending, its run, and
  until when it waits; what it changed (each file of its worktree's change, folded, read through
  `ctx.workers.changes`), what its reviewers said, and what its checks measured (the run's report),
  with the checks still pending in warning (those recorded as failed apart from those not run); and the operator's **Accept / Send back**,
  each described by what it does. The card (T186) leads with one line, then the change (*3 files +19 −1*), each required check, and
  each reviewer's verdict as chips, the warnings, and the two buttons; every long text (the diff,
  the findings, the report, why a check has no result, the exact result) is under its closed
  **Details**; then, once accepted,
  where the result stands on its way into the repository, until it is merged or refused
  ([what a review shows](../../../docs/reference/web-ui.md#what-a-review-shows)); above them, and on Home's waiting
  line, when the first review held for the operator expires (marked within the hour), since an
  unanswered one expires and its task waits for input that only a re-opening revives (T99 D6, T286). Without it
  the reviews routes answer `503`;
- when `ctx.board` is present, the **board** page (`?view=board`), a Kanban of one project at a
  time: a project switcher (kept in the address as `&project=<id>`; the one project by default, or,
  with several, **All projects**, `&project=all`: each project's header card only, its counts, what
  of it needs you, and its moves, its name opening its board, T253); the project's header with its state as a
  chip and its open tasks (its id and charter version folded), its state as counts (*Needs you 3 ·
  Working 1 · Ready 1 · Proposed 0*, what needs you by kind folded), what of it needs the operator
  (*Charter approval needed*, *2 task approvals*, linked), and the moves, all under one **Projects**
  fold below the columns whose summary says what of them needs you (T239); free Workers and ready
  tasks (how a ready task starts behind the Ready column's **?**); then a column per task state
  (Proposed, Ready, Working, Review, Needs your attention, which comes first on a narrow screen, each
  empty one a short line; Done and Cancelled folded), one card per task with its title, its project
  when the cards come from several, when it changed, who works on it (the Worker's name, since
  when), what it needs as a chip (*Approval needed*, *Input needed — why*) with its expiry, its
  primary action (**Start…**, **Approve** / **Deny**, **Review**) and **Open run**, and under its
  **Details** its action type, its template, and who its first step would likely go to on a ready
  card (*Likely Worker: …*, the others folded); a
  request a card waits on (a task's approval, an accepted result's merge) has its own **Approve**
  and **Deny** on the card, on the request's exact subject, as on Home; a done task's card says
  where its accepted result is on its way into the repository (*Merge approval needed · into main*,
  with those buttons, under Needs your attention; merged, with the commit; or not merged, and why;
  [landing](../../../docs/design/workflow-engine.md#landing-an-accepted-result)).
  A ready task's **Start…** starts its run as the lead does (MCP `run` with `task`): a
  confirmation says what runs (*solo template · attempt 1 of 3 · 1 step*, each step with a short
  requirement, *standard+ · reason*, and its likely Worker, from `ctx.workflow.templateSteps`; what
  a start does folded), the start is bound to the task revision and template shown, and a
  task that names no template is refused with why
  ([starting a ready task](../../../docs/reference/web-ui.md#starting-a-ready-task)).
  The operator's **Pause**, **Resume**, and **Close** (achieved or stopped)
  ([the operator's project moves](../../../docs/design/board.md#the-operators-project-moves)).
  Each opens a confirmation that says what the move does to this project (what goes on, what is
  cancelled and released, which approval requests are withdrawn, or why a close is refused), and
  moves nothing until **Confirm**; **Cancel** closes it. The page does not refresh while a
  confirmation is open. Without the board the projects routes answer `503`;
- the **Workers** tab (`?view=workers`, next to Board; REQ-HOST-8), read through `readRoster` in
  [`gateway-core`](../../gateway-core/README.md#the-roster) from the services mounted (`workers`,
  `accounts`, `agentWorkers`, `resources`, `eventLog`, the engine, `board`): the counts as Home's
  chips (free, and working, resting, unavailable when there are any); **Right now** (folded, its
  summary the rows that need a look as chips, open while someone is stalled or cannot work), rendered from the roster's
  `now` as the server made it (`readCapacity`, T152; the page computes none of it), by name: who is
  free, the quota lost soonest unused first, with what each has left, one excluded from teams said
  free for other steps, not team work (D58, T160) (and how many tasks are ready,
  linked to the Board), whose quota is unknown (never counted free), who is stalled, which accounts
  have no quota left and until when, who cannot work, and each ready task's likely Worker, each a
  count first (*No quota left: 1 — …*), past three names the rest folded; then the Workers by account, each
  account once as a card headed by its name and how many Workers (`Claude Code · science · 3
  Workers`, [display names](../../../docs/design/roster.md#display-names); its roles under its
  details), what stops it (its rest as a chip, *Resting until 14:20 (in 2 h)*; signed out,
  quarantined, one person on two accounts), its shortest window as a small bar and a line
  (`5 h used 42 %, resets 14:20`), what of its Workers blocks work or needs a look (a line each,
  never folded), its Workers' cards under one fold, and, under its **Details**, its quota, each
  window of its pools as `5 h · used 42 % · resets 14:20` beside a small bar
  ([ADR-0059](../../../docs/decisions/adr/0059-quota-readings-from-each-accounts-own-usage-report.md):
  the window by its length, its share, and its reset, on the clock with the day when not today,
  when it was read under the account's details; `at its limit` first, and listed first, while it
  is limited; `5 h · no reading yet: <why>` before any reading, windows of one reason on one
  line); a Worker source not yet read or failed as *<source> loading — counts incomplete* (or
  *unavailable*, with its reason); the Workers of no account last. Each Worker's card is calm: its
  work (role or tier), what it is for, its status in the cross-page words (*Free*, *Working · 1/2
  slots · 1 slot free*, *Resting until 02:16*, *Unavailable — why*, *Quarantined — what its reading
  found*), what it does now (its task by title and for how long, or a team member's answer, the
  project its run is for, T253, and each run whose liveness needs a look, each a link to its run),
  the capabilities held off, and an
  **Excluded from teams** chip when the engine's `teams.excludeWorkers` leaves it out of teams
  (D58, the roster's `teams`); an account with no quota tracked says *Quota not tracked*; every unknown (`unknown (why)`),
  derived, or technical fact (its id, its derived line, its account's id, kind, and state, what it
  serves, its load) is folded under its **Details**, and a reason that blocks work never is
  ([roster](../../../docs/design/roster.md)). Home's Workers box shows each account's capacity in
  one line, its 5 h bar beside it. A Worker source that did not answer is named above the cards.

When the roster was read is under *Right now* (else folded under *Roster read*); the header's *updated 12 s ago* says when
the page was.

The routes are in the [web UI API](../../../docs/reference/web-ui.md).

## Use

`system ui` prints the link: `http://127.0.0.1:<port>/ui/#token=…`, with the
operator token in the fragment. Open it on
the host, or over `ssh -L <port>:127.0.0.1:<port> host` like the login desktop.

## The client

The page is TypeScript only: the shell is `renderShell` in `src/ui/shell.ts` (scripts' hashes and CSP nonces
as typed inputs), the stylesheet is built by `src/ui/styles/` (typed design tokens, a `css` helper), and the
script is `client/`: a classic entry `app.ts` that runs `import('./boot.js')`, and typed ES modules by page and
concern (the DOM lib; `client/tsconfig.json`, which refuses unused locals), each under 600 lines and none with
an `any` (`tests/client-source.spec.ts`). The API's response types are one declaration file, `src/api.d.ts`,
imported by the server and the client with `import type`. `pnpm build` compiles the script with `tsc`
to `lib/client/`; the plugin renders the shell and the stylesheet at start, reads `app.js` from that
directory (config `clientDir`, default `lib/client/`), and serves it and every other compiled `.js` file there,
each one's bytes with its sha256 as the `ETag`. `pnpm typecheck` and `pnpm lint` cover it. Tests build the script into a temporary directory
([`tests/client-build.ts`](tests/client-build.ts)); none writes into the package. See [the page's files](../../../docs/design/web-ui.md#the-pages-files).

## Security

- **Shell:** the page, script, and styles carry no data. They are served
  `no-store`, `no-referrer`, and `nosniff` under a strict content security
  policy: scripts and styles from `self` only, no frames, no forms.
- **Token:**
  - it travels in the URL **fragment**, which a browser never sends to a
    server;
  - the script moves it to session storage and removes it from the address bar;
  - it then sends it as `Authorization: Bearer` to `/ui/api`.
- **API guard**, the one every client endpoint shares
  ([`gateway-core`](../../gateway-core/README.md#the-request-guard)), in order:
  - a loopback `Host` (against DNS rebinding);
  - no `Origin` other than the UI's own (`sameOrigin`);
  - the operator token (`operator.token` under `tokenDir`), compared in
    constant time. A client or model token gets `401`.

  A page on another site cannot read the token and gets no CORS answer.
- **Bind:** on plain HTTP on a non-loopback host, `/ui` is not registered
  (`assertSafeBind`).
- **Actions** take a JSON body only (a form post cannot reach them) and go to
  the workflow engine as operator decisions. A plan's Approve and Deny send the plan
  the page shows (`plan`, a `sha256:` id), so the engine decides only that plan
  (INV-5). A vote sends the tie decision the page shows, an option or
  `inconclusive`, and a rationale; it is recorded as the operator's.
- **Policy proposals** go to `ctx.approvals.proposePolicy` from this channel and MCP
  `approvals_policy_propose` (operator scope) only (INV-6); a proposal is never applied by its
  route, only by the operator's verdict on its request in the queue.
- **Queue verdicts** go to `ctx.approvals.decide` as the operator's (INV-6), at
  the server's clock, each with the exact subject of the request the page
  shows (INV-5); a batch verdict names its batch, and a request outside it
  refuses the whole call. This is the operator's human channel for verdicts:
  MCP clients get no new path (`approvals_decide` stays operator scope).
- **Review verdicts** are `acceptance` decisions made by the operator (decider and producer
  `operator`), naming the task, the exact subject of the result the page shows (a result on
  another subject is refused, INV-5), and every result artifact, then applied with
  `ctx.board.accept`. Like the queue's, this is the operator's human channel: no MCP tool
  accepts a review.
- **Project moves** go to `ctx.board.pause`, `resume`, and `close` from this channel and the
  operator-scope MCP tools `board_pause`, `board_resume`, and `board_close` only (INV-6), at the
  server's clock. Each sends the project revision the page showed: a project changed since is
  refused (`409`) and nothing moves. The board records each move's `board` decision (INV-13).
- **Rendering:** the page is built with DOM methods and `textContent` only.
  Model output is never parsed as HTML.
- **Scope:** only the operator scope reaches `/ui`
  ([scopes](../mcp-server/README.md#scopes)).

**Injects:** `webServer`, `workflow`; `approvals`, `board`, and `artifacts` are optional
(`ctx.get`), so the UI works without the queue or the board; for the roster it reads `workers`,
`accounts`, `agentWorkers`, `resources`, and `eventLog` when present.

**Tests** run in process, without a browser: the routes over the store-backed composition
([`tests/store-backed.ts`](tests/store-backed.ts), the board, approval queue, and engine under the
bundle's default studio policy), each answered to the operator only where it should be, a client
token refused, and the page's served files (its scale, light and dark, a script that loads nothing
from another origin): [`tests/web-ui.spec.ts`](tests/web-ui.spec.ts),
[`tests/layout.spec.ts`](tests/layout.spec.ts), [`tests/policy.spec.ts`](tests/policy.spec.ts),
[`tests/reviews.spec.ts`](tests/reviews.spec.ts), [`tests/live.spec.ts`](tests/live.spec.ts),
[`tests/dispatch.spec.ts`](tests/dispatch.spec.ts), and [`tests/projects.spec.ts`](tests/projects.spec.ts).
What a page shows in a browser (layout, touch targets, keyboard, the phone's safe areas) is checked
by hand on the [release checklist](../../../docs/validation/release-checklist.md).
