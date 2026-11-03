---
id: PROP-0005
type: proposal
status: accepted
owners: [operator]
created: 2026-10-17
related-requirements: [REQ-ACC-5, REQ-TEAM-4, REQ-PRV-1]
related-decisions: [ADR-0016, ADR-0017, ADR-0027, ADR-0029, ADR-0030]
implementation: []
---

# Proposal: Session-bound website accounts run their turns in their own login profile

## Problem

Every website turn runs in a fresh browser context built from the account's portable state
(cookies, local storage and IndexedDB). The login profile is used only to sign in
([ADR-0016](../decisions/adr/0016-invisible-headed-browser-and-portable-accounts.md),
[browser runtime](../design/browser-runtime.md): "Automated turns never use it"). That worked for
ChatGPT for six days, until its copy was signed out (see Evidence and research). It does not work
for the Gemini account. Live, on 2026-10-16:

- A copy of the state worked for one turn, and the next fresh context was signed out. A copy saved
  from the signed-in login profile was signed out a minute later. Repeated loads then drew Google's
  unusual-traffic check (a reCAPTCHA), in turns and in the login profile alike.
- Throughout, the login profile itself stayed signed in, and Save worked.

So Gemini, and with it the second provider family that teams and research are built for
([ADR-0027](../decisions/adr/0027-provider-diversity-in-routing.md)), cannot serve work. Teams now
run on one family by opt-in ([ADR-0029](../decisions/adr/0029-opt-in-same-family-fallback.md)),
which is weaker evidence.

## Goals

1. An account whose site binds its session to the browser that signed in serves turns reliably,
   for hours, without new sign-outs or challenges caused by the way `system` drives it.
2. Nothing changes for an account whose driver does not declare the capability.
3. No provider is named outside its driver (INV-11): the binding is a driver capability.
4. Several sessions of one account still run side by side, each in its own conversation (ADR-0015).

## Non-goals

- Solving or avoiding a challenge automatically: a challenge stays the operator's
  ([ADR-0016](../decisions/adr/0016-invisible-headed-browser-and-portable-accounts.md)).
- An official API Worker for the same provider: a separate Worker source with its own quota class.
  It does not fix the website account.
- Portable copies for moving an account between hosts: a session-bound account is signed in on
  the host that uses it.

## Evidence and research

- Precedent: codex-chatgpt-web, one of the projects ADR-0016 learned from, ran one persistent
  partition per account rather than fresh contexts.
- **ChatGPT signed out too, on 2026-10-17.** chatgpt-main had worked on portable state since
  2026-10-11. At about 00:46 UTC on 2026-10-17 it was served its logged-out home, which the UI map
  did not yet read as signed out (outline `sha256:83e6431746c7645c40e69f8cbc9068982ea094751e7a3607be5d6792f8f102dd`,
  in `system evidence`). The operator's login profile was still signed in; they pressed Save, and
  the next turn worked (`run_ebb1c54e07df48d6`). So the copy died, not the account's session: the
  same pattern as Gemini, after six days rather than a minute. chatgpt-main signs in with email and
  password, so Google ending flagged sessions is not a common cause.
- **Research `run_c34e9ed099c2254b`** (one provider family). It weighed four mechanisms that fit
  "the profile stays signed in, the copy dies". None is established as the cause:
  - **H1, device-bound session credentials.** Real, but shipped on Windows and macOS. On Linux it
    exists only as experimental software keys. Nothing shows that Gemini or ChatGPT use it.
  - **H2, provider risk controls** on a session cookie seen in a browser other than the one it was
    issued to. Real in general; not established for either failure.
  - **H3, an incomplete copy.** The portable state leaves out sessionStorage, service-worker and
    Cache storage, partitioned cookies, and other domains' state. Real; not established as the cause.
  - **H4, refresh-token rotation with reuse detection.** Replaying an already-rotated token revokes
    the whole token family. Real and documented; not established from the run alone.
  - Each is avoided by running in the original persistent profile rather than replaying copies. That
    does not guarantee indefinite sign-in, but it removes a documented class of portability failures.
- **Two writers per account.** chatgpt-main logged repeated `account.write-back-skipped`. With
  `maxConcurrentTurnsPerAccount: 2`, two fresh contexts started from the same saved revision, and
  both refreshed the session. The fenced write-back keeps only one. Under H4 that pattern revokes a
  session. One persistent context has a single cookie jar, so it cannot do this.
- Whether a login profile is signed in to Chrome itself (a Google-only mechanism) is not needed to
  decide this proposal: the ChatGPT failure rules it out as a common cause.

## Proposed design

- **A driver capability.** A driver declares `sessionBound: true` when its site ties a session to
  the browser profile that signed in. The Gemini driver declares it first, since Gemini is blocked
  without it. The ChatGPT driver declares it once Gemini's validation passes: its copies died too,
  so it should get the same fix. Nothing else names a provider.
- **Turns in the login profile.** For a session-bound account, the browser runtime opens one
  persistent context on the account's login profile (headed, on the invisible display, as Save
  does today) and keeps it open while the account works. Each turn is a new page (tab) in that
  context, closed when the turn ends. Portable state is neither loaded nor written back for it.
- **One context per account.** Chrome allows one process per profile directory, so the runtime
  holds the profile while turns run. The operator's remote login waits for it, or closes it when
  idle; a sign-in never runs beside a turn.
- **Sessions stay apart.** Each session is its own conversation in its own tab, so several team
  members can still share the account (ADR-0015, ADR-0029).
- **Every operation on the account, not only turns.** For a session-bound account, each one opens
  a tab in the profile context and never a fresh context from the portable state:
  - turns (temporary and persistent), and their reconciliation snapshots;
  - `account verify`, `account probe`, and the background sign-in check;
  - the conversation ledger's `inspectConversation` and `deleteConversation` (PROP-0004 Phase 5);
  - Save, which captures from the profile and verifies identity there; the portable state is kept
    only as the identity record.
- **Lifecycle.** The profile context opens lazily, on the account's first operation, within a bound
  (a failed open fails that operation and is never retried in a loop). It closes after a validated
  idle time (`Config`), so the profile is not held when no work runs and a remote login can start.
  If its browser dies, every in-flight turn of the account fails with the browser's error and
  reconciles as today, by its receipt (a submitted prompt is never resent). The next operation
  reopens the context.
- **Pacing.** A session-bound account's turns are spaced by a minimum gap between page loads, a
  validated driver `Config` field. An unknown page fails once and is never retried.
- **Challenge.** As today: the account is marked `challenge`, and no Worker of it is admitted until
  the operator passes the check in the login profile and saves.

## Alternatives considered

1. **Re-capture from the profile before every turn.** Disproved live: a copy captured from the
   signed-in profile was signed out a minute later in a fresh context.
2. **Keep fresh contexts, slow down.** Spacing does not fix a copy that is signed out on its first
   reuse. It would only lower the challenge rate.
3. **Write back after every turn.** The signed-out turn came right after a write-back, so the
   written-back copy is no better.
4. **An official API Worker.** Real, but another product (metered, its own quota class). It does not
   make the subscription account usable.
5. **Drop the second family.** Teams stay single-family (ADR-0029), with weaker evidence.
6. **A profile not signed in to Chrome**, only to Google on the web page. It addresses a
   Google-only mechanism, which the ChatGPT failure rules out as the common cause.
7. **One context per account, with fresh copies (interim).** Set `maxConcurrentTurnsPerAccount: 1`,
   so one context at a time holds and refreshes the copy. A configuration change: cheap, reversible, no code. It does nothing for H1 to H3. Team members on one account then
   answer in turn rather than together, so a round is slower.

Ranked:

1. **This proposal** (the login profile, for both drivers, Gemini first). It avoids all four
   mechanisms, including the two-writer pattern.
2. **Alternative 7** as an interim, right away and independently of the decision on 1. It is the
   only measure available before 1 is built, and it is undone by restoring the setting. It does not
   unblock Gemini, whose copies died on their first reuse.
3. Alternative 4 (an API Worker), as a separate product, if a subscription account cannot be kept
   signed in at all.
4. Alternatives 1, 2, 3, 5 and 6 do not address the evidence.

## Validation plan

- Fake site: a fake provider that accepts a session only in the context that signed in (its cookie
  is rejected in another context), so a fresh-context turn fails and a profile turn works; two
  sessions in two tabs answer independently; a remote login waits for, or ends, the turns.
- Crash: a host killed mid-turn restarts with the profile lock released (`releaseStaleProfileLock`)
  and reconciles the turn as today.
- Live, only once the operator has cleared Google's check in the login profile, and never before.
  Short work first, in this order, each step only after the one before passes:
  1. one short single-turn check that lands on Gemini (or the Gemini member of the brainstorm, if
     routing will not send a single turn there);
  2. a short two-member brainstorm, Gemini and ChatGPT;
  3. a short review on a small focus.

  No `research`, no Deep research, and nothing long-running until those pass. Then turns spaced over
  hours. No sign-out and no challenge at any step. A stall is read from its `provider.stall` outline
  before the next attempt. During validation the Gemini account loads at most a fixed number of pages
  per hour, and the first challenge or sign-out ends the validation for the operator to look at.
  Check what the site shares between tabs of one profile (localStorage or BroadcastChannel state,
  such as the mode picker or Temporary chat): two members in two tabs must not change each other's
  mode or chat. Check that the sign-in survives a restart of the held context: after the idle close,
  the next turn is still signed in. Gemini's two-tab check on its next two-member run is still open.

## Rollout and rollback

- The capability ships with the Gemini driver; the browser runtime gains the profile path.
- Rollback: the driver drops `sessionBound`, and its turns return to fresh contexts.
- Once two families serve work again, `allowSameFamily` may stay on: it only acts when no second
  family is admitted.

## Observability and operations

- An event when a profile context opens and closes, and health shows an account whose profile is
  held by a remote login.
- Runbook: a session-bound account is signed in on its host; moving it means signing in again.

## Security and privacy

- The login profile already holds the account's full browser state. This uses it for turns too, on
  the same host, with the same file permissions. No state leaves the host.
- A page of a turn shares the profile with the account's other tabs. Sessions are separated by
  conversation, not by browser context, so one account's sessions are one trust domain .

## Compatibility and migration

- ADR-0016 and the browser runtime rule "automated turns never use the login profile" are
  superseded in part, for session-bound accounts only. An ADR records it.
- Existing portable state stays valid for the accounts that use it.

## Decision

Accepted on 2026-10-17 by the operator, in Researcher's session: both ranked options.

- **Option 1, this proposal**, recorded as
  [ADR-0030](../decisions/adr/0030-session-bound-accounts-use-their-login-profile.md). Gemini goes
  first and ChatGPT follows after Gemini's validation. Fake-site tests come first. The live
  validation waits until the operator has cleared Google's challenge, and it runs under the
  page-load cap.
- **Option 2, the interim.** Applied the same day: `maxConcurrentTurnsPerAccount: 1`. Team members on
  one account answered one after another.

## Implementation

The mechanisms are described in [browser runtime](../design/browser-runtime.md#context-lifecycle).
The open live check is Gemini's two-tab check (see Validation plan).

## Amendment (2026-10-17): keep a session's tab between its turns

Status: accepted 2026-10-17. It changes the design above, not ADR-0030's decision: the work still runs in pages of the account's profile, never from a copy.

**Why.** Live, repeated loads drew Google's check. Each turn opened a new tab and loaded its
conversation again. A two-member brainstorm (proposal, ballot, debate) loaded six pages where two
would do.

**Design.**

- **A kept tab per session.** A persistent session's turn opens its profile page with a key (the
  session id). When the turn completes, the page stays open, idle, as the session's tab, and the
  session's next turn gets it back. A tab is kept only after a completed turn whose page is idle: no
  answer or Deep research still running, and no dialog or menu open. After any failure, abort or
  closed page, the tab is closed for good. A reconciliation after a restart always opens a fresh page.
- **Checked again, never assumed.** On hand-back the page is brought to the front, since Chrome
  throttles background tabs. The driver checks the sign-in on the page as it is, with no navigation,
  with the same outcomes as an open: a challenge is `challenge`, signed out is `reauth_required`, an
  unknown page is `ui_drift` once. The tab is then discarded.
- **No navigation when already there.** Before going to a bound conversation, a driver checks whether
  the page already shows it (its URL is the conversation's, and its turns are rendered). If so, it
  does not navigate. Both drivers get this check.
- **Bounded.** At most 4 kept tabs per account (`MAX_KEPT_TABS`, INV-9), covering two team members
  and the research thread. Opening a fifth closes the least recently used. A tab idle for more than
  10 minutes (`MAX_KEPT_IDLE_MS`) is not handed back.
- **What a kept tab cannot see.** A conversation the site has dropped is found out only by loading it,
  which a kept tab skips. A re-login's reservation closes every kept tab, so that case is still caught.
  A chat deleted elsewhere while its tab is kept is caught within the 10-minute bound, or by the
  session's next fresh page.
- **Closes with its context and session.** Kept tabs close on the idle close (they count as idle, so
  the context still closes after `closeAfterMs` with no turn running), on a reservation, or when the
  display is lost. A reservation is refused only by pages in use, never by kept tabs. When a session
  is released or reset, its kept tab is closed.
- **One user at a time.** One session's turns run strictly in order, so a kept tab is never in two
  turns at once.
- **Pacing.** Page opens stay spaced by `pageGapMs`. A kept tab handed back opens no page and is not
  paced. If its driver must navigate after all (it no longer shows its conversation), that one load is
  not paced; that happens rarely.
- **Temporary turns are unchanged.** Each needs a fresh Temporary chat, reached by navigation, so
  reuse would save no load. An in-app "New chat" could, but it needs map entries verified live: later,
  if the loads still matter.
- **Scope.** Session-bound accounts only (profile contexts). The ChatGPT account, on fresh contexts, is
  unchanged until it declares `sessionBound`.

**Observability.** `profileStates` reports each account's kept tabs, so health shows them. No event
per kept or discarded tab.

**Seam.**

- `openTurn(account, { profile: { dir, gapMs, keep } })`: `keep` is the session id.
- `BrowserTurn.discard()` closes a kept tab for good, where `close()` would keep it.
- `ctx.browser.discardTab(account, keep)` closes a session's kept tab when the session ends.

**Expected savings, in page loads.**

| Work | Now | Kept tabs |
|---|---|---|
| A two-member brainstorm (proposal, ballot, debate) | 6 | 2 |
| Research's synthesis thread (frame, evidence, conclusion) | 3 | 1 |
| A one-shot `ask` (Temporary chat) | 1 | 1 |

**Live validation**, added to the plan above, in its short two-member brainstorm (step 2):

- count its page loads; they should match the table;
- check that the two members' kept tabs leave each other alone: each keeps its own mode and its own
  conversation.
