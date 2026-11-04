---
---

Tests and CI (operator's decisions of 2026-11-04; ADR-0084, ADR-0085). The unit suite holds no test that needs a real browser or Xvfb, and of those that need real bubblewrap only the sandbox's own (257 → 27 such tests): the website drivers, the web UI in a browser, the browser and login plugins, and workflow scenarios over website Workers are release checks now. CI runs once per merge into dev, on Node 24 only, as parallel jobs (check, four test shards, e2e, crash) behind one required `ci gate`. Only tests, docs, and CI change; no package.
