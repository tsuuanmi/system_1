---
"@tsuuanmi/system-bundle": patch
"@tsuuanmi/system-feedback-core": patch
"@tsuuanmi/system-gateway-anthropic": patch
"@tsuuanmi/system-gateway-responses": patch
"@tsuuanmi/system-runtime-antigravity-cli": patch
"@tsuuanmi/system-runtime-acp": patch
"@tsuuanmi/system-digest-extractive": patch
---

Park what is not used (PROP-0022 change 6a and 6b, T370, 2026-11-01); docs and configuration only, no code removed:
- The shipped bundle mounts none of the parked rows. Already off, so unchanged: `gateway-anthropic`, `gateway-responses`, `runtime-antigravity-cli`, `runtime-acp`, `digest-extractive`. Already off by their own keys, so unchanged: the scheduled review (`workflow.scheduledReview.enabled`, off unless set) and the dispatch advisor (`dispatch.advisor.provider`, `none` by default). The bundle's removability test now holds the five rows to `disabled: true`.
- `docs/architecture/components.md` gains a "Parked" section: each part, why, the date, what turns it back on, and that a separate decided change may delete it after 30 days with no use; and the parts kept though rarely used.
- Each parked package's README opens with a line saying it is parked and frozen (security fixes only).
