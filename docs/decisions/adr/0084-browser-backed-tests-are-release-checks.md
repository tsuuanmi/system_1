# ADR-0084: Tests that need a real browser are release checks, not CI tests

- **Status:** Accepted
- **Date:** 2026-11-04
- **Related:** [INV-11](../../architecture/invariants.md#inv-11-no-tool-lock-in),
  [ADR-0008](0008-tool-agnostic.md), [ADR-0024](0024-agent-workers-confined-for-reads.md),
  [ADR-0037](0037-schema-and-protocol-first.md),
  [release checklist](../../validation/release-checklist.md), [testing](../../engineering/testing.md)

## Context

CI took 25 to 27 minutes on each merge. About 42 % of the unit suite's time (1,355 of 3,210
test-seconds, 257 tests) was tests that start a real headed Chrome on Xvfb or a real bubblewrap
sandbox: the website drivers against their fake sites, the web UI in a browser, the browser and
login plugins, workflow scenarios over website Workers, and the acceptance checks run confined.
Among them were the `ctx.browser` seam's conformance suite and the delete flow every website
driver shares (`provider-core/conformance/deletion.ts`). INV-11 says every seam's conformance suite
runs against a fake. The operator asked for the suite to test the core logic only.

## Decision

1. The unit suite holds no test that needs a real browser (Chrome, Xvfb). Those tests are
   deleted, the browser seam's suite and the shared delete flow among them.
2. Tests that need real bubblewrap are deleted too, except the sandbox's own: the read and command
   confinement of agent runs in `agent-runtime-core` and each agent runtime provider's confinement
   (about 27 tests, 29 s). They hold ADR-0024 (an agent run cannot read the host's secrets), which
   no fake can stand for. CI still installs bubblewrap for them.
3. INV-11's conformance clause applies to seams whose provider runs without a real browser. What a
   browser-backed seam or driver does is checked by hand on the
   [release checklist](../../validation/release-checklist.md) (the web UI in a browser; a released
   website conversation deleted, and only that one) and in live use.
4. The e2e and crash suites keep booting the shipped profile, which mounts the browser rows; they
   run in CI as before.

## Consequences

- The unit suite runs in about 1,900 test-seconds instead of 3,210, and CI needs no Chrome for it.
- A website driver's change, a web UI layout change, or a browser plugin change is no longer
  caught by CI. A provider site's UI drift was already caught only live, by `ui-drift` health.
- A driver that deletes the wrong conversation is caught only by the release check and live use;
  the release check is a blocking item.
- Browser tests can come back for one change, run by hand, without changing CI: the gating in
  `browser-patchright/tests/support.ts` (`canRunBrowser`, `headlessIt`) stays.
