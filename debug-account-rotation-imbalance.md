# Debug Session: account-rotation-imbalance

Status: [OPEN]

## Symptom
- User has total 56 accounts added.
- Account #0 was attempted 244 times.
- Account #57 was attempted 17 times.
- Expected: account usage/attempt distribution should not be extremely skewed without a clear reason.

## Constraints
- No business logic modification before runtime evidence.
- First codebase change must be instrumentation only if code modification is needed.
- Speak to user in Bengali.

## Hypotheses
1. Account indices are not contiguous: 56 accounts can include index #57 if some lower index is missing/duplicate, so "56 accounts" does not mean accounts #0-#55 only.
2. Usage stats count total historical attempts, not current-session rotation attempts; account #0 may have older accumulated records.
3. Rotation list/order is biased because `INITIAL_AUTH_INDEX`, duplicate-email deduplication, or `rotationIndex` starts from #0.
4. Some accounts are temporarily unavailable or fail auth/browser init, so the load balancer repeatedly falls back to account #0.
5. Request selection uses active context pool rather than all auth files; if only #0 is active and #57 occasionally active, attempts become skewed.

## Evidence Plan
- Inspect auth file count and exact indices.
- Inspect usage stats/log files if present.
- Run safe diagnostics commands only, no business logic change.
- If runtime logs are insufficient, add instrumentation-only debug logs before any fix.

## Findings
- Local `AIStudioToAPI/configs/auth` folder is absent in this workspace, so the 56 live accounts are not stored in this checked folder.
- Local `AIStudioToAPI/data/usage-stats.jsonl` is also absent, so the 244/17 numbers cannot be verified from local persisted stats.
- No listener was found on ports 7860 or 9998; running node processes are GitHub MCP only, not AIStudioToAPI.
- Code evidence: `RequestHandler._selectNextAuthIndex()` selects only from `browserManager.contexts.keys()`, meaning only currently loaded context pool is used, not all 56 auth accounts.
- Code evidence: default `MAX_CONTEXTS` is 1 in `ConfigLoader`, and `BrowserManager.preloadContextPool()` skips background preload when pool size is 1.
- Code evidence: usage-based switch is global (`AuthSwitcher.usageCount`) and only triggers after request completion; default threshold is 40.
- Code evidence: `AuthSource` keeps `availableIndices` separately from `rotationIndices`; duplicate email auth files and expired files are excluded from rotation. Thus 56 files/accounts can result in fewer usable rotation accounts, and index #57 can still be valid if numbering has gaps.

## Current Conclusion
The most likely cause is context-pool/rotation behavior, not a simple equal round-robin across 56 accounts. With default `MAX_CONTEXTS=1`, requests mostly use the currently loaded account. Rotation happens only after threshold/failure and can fall back to earlier accounts if others are expired, duplicate, unavailable, or fail browser init.
