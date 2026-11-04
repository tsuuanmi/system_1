# The operator's web UI at a glance

> Target state. Boundary: [gateways](../architecture/components.md#gateways), plugin family
> *surface*. Implemented in [`web-ui`](../../packages/plugins/web-ui/README.md) (T239, `6a555d90`;
> T240, `9f0b245f`; T253, `20fe4c45`; T256, `be23958e`; T274b, `4aa5da45`; who decided, T273, `ef6a62f3`);
> differs from target: the phone is checked in Chromium's emulation of it (its size, scale, touch,
> and safe areas), not in Safari itself.

Every page of the operator's web UI follows these rules. The operator checks it from a phone as often as
from a desk, so each page says what needs them in few words and keeps every other fact one press away (a fold,
a tooltip, a **?**, or the item's own page). Each rule names its test.

## Hierarchy

- **What needs you comes first, as cards.** A card has the item's own title, one status chip, at most one
  short line of context, and its one primary action (**Approve**, **Accept**, **Start…**). Everything else
  (which task, who asked, what no response does, mechanism, decisions, ids, hashes, raw reasons) sits under
  the card's one **Details** fold or on the item's own page. Facts are folded, never dropped.
- **Home** leads with the counts that need action as tiles (*Approvals · 3*, *Reviews · 1*, *Runs needing
  attention · 1*), each linked to its cards, its names folded under it. When the first review expires within
  the hour, the tile shows when; otherwise the time sits beside each name. Beside them, the Workers' availability as chips (*● 1 free*, *◆ 1 working*, *▲ 1 resting*; free always, the others when there are any).
  Then the cards (approvals, reviews, runs needing attention, starts awaiting approval), then what happened since
  you last looked, the Workers' capacity, and the recent runs (5 rows, then **Show all N**). The Workers' counts are said once.
- **Held for you** is the first section of Home's reviews: every result the operator holds (one project's, when
  Home is filtered), the soonest to expire on top. A row gives the task (linked to its card below), why it is
  held (the hold decision's words: heavy with its risk reason, checks pending or not run, or the auto-accept
  rule's checks passed without their browser tests), its checks, each reviewer's verdict with its Worker's
  provider family, the digest's first lines, and its change size. Select rows, then **Accept N selected** or
  **Send back N selected**. Each is its own decision on the exact result shown (INV-5), sent in turn with the
  same *Note for all*. An accept of a row with a check not run asks in its row for why, and is not sent without
  it; the other rows go. A refusal's reason shows on its row, which stays selected. A recorded row and its card leave at once; Home's counts follow on refresh. Logic: `client/heldbatch.ts`; section: `client/held.ts` (`tests/held.spec.ts`).
  An expired review (its task waits for input as `review-expired`) is listed after the held ones, marked
  *Review expired*, with when it expired and until when it can be reopened: the wait for input, 7 days by
  default. Past that, the board's sweep cancels the task and the row goes. `GET reviews` carries them as
  `expired` (`heldFor: expired`, `expiredAt`), not among `reviews`, so Home's counts cover only reviews held now; a lead's token gets none.
  **Accept N selected** on an expired row first reopens it (`POST reviews/<taskId>/reopen`, bound to the exact
  result shown: the board's `reopenReview`, which needs the run's worktree, recorded as the operator's board
  decision), then sends the acceptance as a second recorded decision. If the reopened hold still asks why a check
  did not run and none was given, the row is reopened but not accepted, and asks in its row as a held row. An
  expired row is not sent back. Only the operator reopens or accepts a heavy result (ADR-0071): a lead's token
  gets 403 on reopening, and its acceptance stays held to its listed dev branches (ADR-0076)
  (`tests/expired.spec.ts`).
- **Started by itself** (dispatch's own starts) is the last section of Home: a table with the columns *Task ·
  State · Worker · Run time · Started*. Each task has one row, its newest attempt's run state as a chip.
  Its attempts fold into the row (*2 attempts*), each with how it was let start. The newest 5 tasks show, then
  **Show all N**.
- **Home across projects.** Each project has its own lead; the operator sees every project in one UI.
  *Needs your attention* groups by project, each group headed by the project's name and its count tiles; what is
  in no project forms *Other*. The most urgent group comes first: what expires within the hour, then the most
  that waits, then the earliest deadline. Cards follow the same groups and order; a batch of requests stays whole,
  in its first request's project. A project's name filters Home to it, its recent runs too (`/ui/?project=<id>`,
  kept through reload and Back, until **All projects**). Its weekly report and maturity metrics have their own
  page (`/ui/?view=reports&project=<id>`), reached by the **Reports** link beside its group's name and from
  its Details on the Board: a table of the commands that print them (`system report --project <id>`,
  `system metrics --project <id>`), each with a copy button (`tests/portfolio.spec.ts`). Inside a group a card does
  not repeat the project: a review card's line shows only when it expires, and its project is under **Details**.
- **The Board** shows one project at a time, chosen by its switcher (*Show*) and kept in the address
  (`&project=<id>`). It leads with its columns (*Needs your attention* first on a phone). The project's state,
  counts, and moves sit under one fold below them, its summary saying what needs you (*▲ 1 charter approval*). **All projects** (`&project=all`, the default when there are several) shows
  each project's counts only: a card with its state, *Needs you · Working · Ready · Proposed*, what needs you, and
  its moves; its name opens its board.
- **Workers** serve every project, so the page stays shared. Each step a Worker runs names its run's project
  (*no project* outside the board).
- **A run's page** leads with its state as a chip, when it started, how long it took once it ended, and **Stop
  run** or **Retry failed step**. Then what it waits on as a card; its answer, first lines and **Show all**; its
  steps, each a line; its id under **Technical details**. Where it is now and what happened sit beside them.
- **Each step's timing.** A step that ended says how long it ran and when it ended (*develop:1 · 14 min · done
  07:42*); a running step's elapsed time ticks each second (*review:1 · 3 min · running*). The exact start and end
  show on hover, keyboard focus, and under the step's **Details**. A step not yet started says only its state.
  A timeline bar above the steps has a segment per step placed by when it ran; its accessible name gives each step's
  time and the run's total. The times come from the event log (each step's latest `workflow.node.started`,
  and its `completed` or `failed`). Without a log, or when it fails, the Steps section says *Times unknown*, why
  under that fold, and each step only its state (`tests/round2.spec.ts`).
- **How a step was decided** (under its **Details**) has one line per decision: *type · outcome · time*. Its reasons and
  id open on a click, or Enter. A deferred tool call's decisions (its *wait*, then its
  *continue* or *deny*) are one line per call, naming its verdict and how long it waited (*1 tool call approved by
  you · 2 min*), with each decision inside.
- **A Board card's line** has only who works on it and when it last changed. Its project, kind of work, template, and attempt are the line's tooltip and sit under its **Details**.
- **Workers** lead with the availability chips and *Right now* (folded, its summary the rows that need a look as
  chips; open while someone is stalled or cannot work). Each account is a card: its name, its rest as a chip, its
  shortest window as a bar and a line. Its other windows and facts sit under its **Details**, and its Workers' cards
  under one fold. What blocks a Worker (unavailable, quarantined, a capability held off) and each run whose liveness
  needs a look are a line on the account's card, never folded.

## Words

- A button is labelled by its concept's one wording (**Approve** / **Deny**, **Accept** / **Send back**, **Confirm**
  / **Cancel**). What it does is its accessible description (`aria-describedby`), a tooltip on hover and keyboard
  focus, never text beside it. Escape hides the tooltip; it stays on screen (`tests/layout.spec.ts`).
- Help is one **?** per section heading, plus Help's own page. A page header is its title, and one short sentence only
  where the title does not say what the page is for (the autonomy policy, Help).
- A relative time is short (*<1 min ago*, *2 h ago*); its exact time shows on hover, and on focus as a small label under it that never moves the line.
- No text walls. A hash, id, commit, branch, or long path is shortened wherever it shows (*read it in
  …/runs/run_ab12cd34…*): each run of 12 or more hex digits to its first 8 (a content id's `sha256:` dropped), a path
  past 32 characters to its last two parts, anything still past 32 characters to its start. The whole value is the tooltip, behind a copy button (*Copy run ID*) that shows a check once copied. The one exception is an
  approval's or a review's **Exact subject**, under its **Details**, shown whole. A list of facts is a table with
  aligned columns, not prose.
- **The bound:** on its first screen at 1280×800, Home, the Board, a run's page, and Workers each show at most the
  words in the table below. Each test run measures today's (`tests/web-ui.spec.ts`: Home, a run waiting on its plan,
  Workers; `tests/layout.spec.ts`: the Board). Where no browser can run, they are reported as not run, with why, never as passed.

| First screen at 1280×800 | Bound (words) |
|---|---|
| Home | 84 |
| Board | 83 |
| A run's page | 49 |
| Workers | 73 |
| Home, two projects | 84 |
| Board's All projects, two projects | 83 |
| Workers, two projects | 73 |

- **With two projects**, Home, the Board (*All projects* and one project's), and Workers hold the same bound over a
  store-backed composition of two active projects, each with work that needs the operator and a run on a Worker
  (`tests/portfolio.spec.ts`).
- Every section of a page has a heading (`tests/layout.spec.ts`).

## Layout

- **Full width.** No page has a maximum width. Prose alone (a paragraph, a list item, a definition) is capped at 75
  characters (`--measure`).
- **A page's grid.** Home, a run's page, and Workers put their list in a main column, with a summary or detail beside it
  from 900 px (`--main` 3 : `--side` 1). Home's side column holds the Workers' availability, kept in sight as the cards
  scroll; the Workers' capacity, the starts awaiting approval, what happened since you last looked, and the recent runs
  follow the cards. A run's side column holds where it is now; from 1600 px it also holds its *Summary* (steps counted by
  state, each decided step a link to it, so steps and decisions are never said twice), and what happened to it. Workers
  hold *Right now*.
  From 1600 px Home has three columns (5 : 4 : 3): the cards; the starts awaiting approval, what happened since you last
  looked, and the recent runs; the Workers' availability and capacity. Unreadable parts of *Since you last looked* are one
  quiet line, the reasons in its tooltip. The Board's All projects cards are at most 420 px wide. On a phone the navigation's
  *policy* is capitalised like the other labels (CSS only; wide, it reads *Autonomy policy*), and a word's "?" stays on its
  word's line (a no-break space joins them).
  Below 900 px every page is one column, in the order main, side, more. The Board keeps its columns at full width.
  `tests/round2.spec.ts` checks the columns at 1920, 1280, and 899 px, and that main is the screen's width.

## The page's files

No HTML, CSS, or JS file is hand-written. `src/ui/shell.ts` (`renderShell`: the shell as a
function whose scripts and stylesheets are typed inputs, each with an optional subresource-integrity hash and CSP nonce).
`src/ui/styles/`: design tokens as typed constants in `tokens.ts`, a `css` template helper, and the rules in `base.ts`
and `pages.ts`, joined by `stylesheet` into `APP_CSS`. `client/` is the script, typed ES modules that the linter, type checker,
and dead-code check read.

The server renders the shell and stylesheet at start (same input, same bytes). It reads the script the build compiles with `tsc` (no bundler) into `lib/client/` (`clientDir`'s default), refuses to start when `app.js`
is missing, and serves each file as its bytes, with its sha256 content hash as its `ETag`, `no-store`, and the same strict
content security policy. `app.ts` is a classic script of a few lines (the shell's `<script src="/ui/app.js">` is unchanged)
that runs `import('./boot.js')`; the server serves every compiled `.js` file of `clientDir` beside it.

Modules are split by page and concern, each under 600 lines and none with an `any` (`tests/client-source.spec.ts`):
`dom.ts` (shared blocks: element, chip, fold, copy button, table, decision button, times), `state.ts`
(token, API client, address state, `show`, `report`), `router.ts`, `boot.ts`, `glossary.ts`, `help.ts`, `describe.ts`,
`queue.ts` (approval cards), `evidence.ts`, `reviews.ts` (with `held.ts` and `heldbatch.ts`), `runwords.ts`, `runpage.ts`,
`home.ts`, `since.ts`, `dispatch.ts`, `board.ts` (with the lead panel), `roster.ts`, `workers.ts`, `policy.ts`,
`changeview.ts`, and `reports.ts`. The API's response types are one declaration file, `src/api.d.ts`, used with `import type`
by the server (which checks what it sends against them) and by the client (emitting nothing). Tests build the client into a
temporary directory and pass it as `clientDir`; they never write into the package.

## Visual system

In the spirit of Anthropic's and Google Material 3's product UIs: calm neutral surfaces, one accent colour, thin borders, no
shadows. Every colour, space, type size, and radius is one of the tokens below, written once as CSS variables
(`src/ui/styles/tokens.ts`) and used by nothing else in the stylesheet. `tests/layout.spec.ts` checks every
margin, padding, gap, and font size.

| Tokens | Light | Dark | For |
|---|---|---|---|
| `--page`, `--bg`, `--sunk` | #f8f9fa, #fff, #f0f2f4 | #131314, #1e1f20, #282a2c | the page, a surface (card, table), a sunk surface (tile, column) |
| `--fg`, `--muted` | #1f1f1f, #5f6368 | #e3e3e3, #a8abaf | text, quiet text |
| `--line`, `--edge` | #e3e3e3, #c4c7c5 | #333537, #5f6368 | a hairline border, a control's edge |
| `--accent`, `--on-accent` | #0b57d0, #fff | #a8c7fa, #062e6f | the one accent: links, focus, a primary button, a running step |
| `--ok`, `--wait`, `--bad` | #146c2e, #7a5900, #b3261e | #6dd58c, #f0c75e, #f2b8b5 | status only, always with its shape and word |
| `--s1` … `--s4` | 4, 8, 16, 24 px | | the 8 px grid (`--s1` its half step); safe areas use it; a panel's padding is `--s3`, `--s4` from 900 px |
| `--small`, `--body`, `--large` | 12, 14, 18 px | 13, 16, 20 px on touch | three type sizes, in the system's own font |
| `--r1`, `--r2`, `--radius`, `--round` | 4, 8, 12 px, pill | | a tag, a control or small card, a panel, a chip or button |

- Cards sit on a quiet page background, with a 1 px border and no shadow. A section's heading is small and quiet; a card's
  title is bold at the body size.
- A **primary** button is filled with the accent colour, and a card has at most one. A **secondary** button is outlined.
  Buttons and chips are pills.
- Columns, tiles, cards, and tables sit in aligned grids. One status chip style: symbol, colour, and word (● ok, ▲ waiting,
  ■ failed, ◆ info, ○ idle), never colour alone.
- Light and dark follow the system's preference (`prefers-color-scheme`, `color-scheme: light dark`).
- **A phone, 360 px wide:** one column, the navigation on one row under the name, no horizontal scroll, every button within
  the screen, a card's buttons sharing its width, and buttons 40 px high (44 px on touch, [below](#the-operators-iphone)).
  `tests/layout.spec.ts` checks every page at 360 px.

## The operator's iPhone

The operator's phone is an iPhone 16 Pro: 402×874 CSS px at 3 device pixels each, Safari, portrait, with the Dynamic Island
above and the home indicator below.

- **Safe areas.** The page lays itself under both (`viewport-fit=cover`) and keeps its content clear: a safe-area token is a
  spacing-scale step, or the screen's own inset where that is larger (`--safe-top: max(var(--s2), env(safe-area-inset-top))`,
  and so for each side). The header (sticky on a phone), the sides of every page, the bottom bar, and the page's last row use them.
- **Touch targets** where a finger points (`pointer: coarse`): every button, fold, field, navigation link, and action link is at
  least 44 by 44 px; a word's **?** is a 44 px target. A link inside a sentence is not a target of its own.
- **Tooltips on a tap.** Nothing hovers on a phone, so each row of buttons whose effect is a tooltip has one **?** (shown only
  where nothing hovers) that shows what each button does, under the row (*Accept: marks it done*); a second tap, a tap outside,
  or Escape hides it. A tap on a button does what it says at once. A word's **?** opens its sentence the same way.
- **No zoom on focus.** On touch the type scale is 13, 16, and 20 px (still three sizes), and every field is 16 px, so Safari
  never zooms into a field.
- **One thumb.** A card's buttons share its width at its bottom, above its **Details**. On a run's page, the primary action is a
  bar above the home indicator: the plan's **Approve** and **Deny** while it waits on one, else **Stop run** or **Retry failed
  step**. The page's last row stays above the bar.
- **Tables** below 600 px are a card per row, each cell named by its column.
- **Light and dark** follow the phone, Safari's own bars too (`theme-color`). No page scrolls sideways at 402 or 360 px.

`tests/layout.spec.ts` checks each on every page at 402 and 360 px with touch and the safe areas (62 px and 34 px) emulated;
`tests/web-ui.spec.ts` the run page's bar; `tests/portfolio.spec.ts` no sideways scroll and the touch targets (a project's name
too) at 402 px with two projects: Home, Home filtered to one, the Board's All projects and one project's, and Workers.

## Kept

One implementation per block (the chip, the count, the relative time, the fold, the copy button, the decision button), the
decision wording, **Skip to content** first in the keyboard order, a visible focus, no motion under reduced motion, the stale
banner, the loading and error states, and no runtime dependency, external font, or CDN: the UI serves itself on loopback and
works offline (`tests/layout.spec.ts` checks the assets).

## Screenshots

Each page's first screen at 1920×1080, 1280×800, and 402 px (touch and safe areas), and the pages at 360 px
(`<page>-360.png`), are in [web-ui-screenshots/](web-ui-screenshots/README.md). Home, a run waiting on its plan, and
Workers are `tests/web-ui.spec.ts`'s fixtures at a fixed clock; the Board and Reviews (Home scrolled to its reviews) are
`tests/layout.spec.ts`'s store-backed composition; the run with step times and *Started by itself* are `tests/round2.spec.ts`'s.
The tests write the images, and print the words each first screen holds, when `SYSTEM_UI_SHOTS` names a directory:

```sh
SYSTEM_UI_SHOTS=docs/design/web-ui-screenshots corepack pnpm exec vitest run packages/plugins/web-ui/tests/web-ui.spec.ts packages/plugins/web-ui/tests/layout.spec.ts packages/plugins/web-ui/tests/portfolio.spec.ts packages/plugins/web-ui/tests/round2.spec.ts -t "first screen|T240|word bound|full-width grid|dispatch started|on the phone at 402"
```

| Page | 1920 px | 1280 px | iPhone, 402 px |
|---|---|---|---|
| Home | [current](web-ui-screenshots/home-1920.png) · [dark](web-ui-screenshots/home-1920-dark.png) | [current](web-ui-screenshots/home-1280.png) | [current](web-ui-screenshots/home-402.png) |
| Board | [current](web-ui-screenshots/board-1920.png) | [current](web-ui-screenshots/board-1280.png) | [current](web-ui-screenshots/board-402.png) |
| A run | [current](web-ui-screenshots/run-1920.png) | [current](web-ui-screenshots/run-1280.png) | [current](web-ui-screenshots/run-402.png) |
| A run with step times | [current](web-ui-screenshots/run-timed-1920.png) · [dark](web-ui-screenshots/run-timed-1920-dark.png) | [current](web-ui-screenshots/run-timed-1280.png) | [current](web-ui-screenshots/run-timed-402.png) |
| Workers | [current](web-ui-screenshots/workers-1920.png) | [current](web-ui-screenshots/workers-1280.png) | [current](web-ui-screenshots/workers-402.png) |
| Reviews | [current](web-ui-screenshots/reviews-1920.png) | [current](web-ui-screenshots/reviews-1280.png) | [current](web-ui-screenshots/reviews-402.png) |
| Started by itself | | [current](web-ui-screenshots/started-1280.png) | [current](web-ui-screenshots/started-402.png) |

With two projects, `tests/portfolio.spec.ts` writes `portfolio-<page>-1280.png` and `portfolio-<page>-402.png` for Home, the
Board's All projects, and Workers (Workers unfolded; on the phone, scrolled to the working Worker).

| With two projects | 1280 px | iPhone, 402 px |
|---|---|---|
| Home | [current](web-ui-screenshots/portfolio-home-1280.png) | [current](web-ui-screenshots/portfolio-home-402.png) |
| Board, All projects | [current](web-ui-screenshots/portfolio-board-1280.png) | [current](web-ui-screenshots/portfolio-board-402.png) |
| Workers | [current](web-ui-screenshots/portfolio-workers-1280.png) | [current](web-ui-screenshots/portfolio-workers-402.png) |
