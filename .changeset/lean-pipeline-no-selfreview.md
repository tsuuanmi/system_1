---
"@tsuuanmi/system-profile-software-development": minor
---

`profile-software-development.pipeline: full | lean` (ADR-0082, PROP-0022 change 3, part 1): `full` (the default) is `algorithm-development`'s graph unchanged; `lean` has no `selfreview:1` and none of its grown steps, and its playbook version carries `+lean`, so each step's brief records the pipeline. A run keeps the spec it started with.
