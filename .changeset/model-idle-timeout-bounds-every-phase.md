---
"@tsuuanmi/system-models": patch
---

A model call whose stream never opens or never yields is now stopped by `idleTimeoutMs` and fails as `TIMEOUT`, then is re-attempted as the route's retry policy allows. The timer only aborted a signal, so a stream that ignored it held the call `running` indefinitely (a Gemini API ballot hung 10 minutes); every await of an attempt now races the bound.
