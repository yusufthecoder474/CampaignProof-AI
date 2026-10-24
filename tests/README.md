# Verification evidence

- `npm test`: 38 Vitest tests, including strict output guards, 256 scoring references, deterministic sampling, adapter switching, injected failures, actual abort-timer behavior and retry limits.
- `python -m pytest tests/test_data.py -q`: 12 checks of genuine parsing, chronological split, allowlist, export scoring and SQLite schema integrity.
- `npm run test:integration`: starts local Wrangler and executes 21 HTTP assertions against actual local D1 and Workflows. Migrate/seed first; stop an existing dev server on port 8787.

Live-provider transport is stubbed in Vitest. Its tests validate request/response handling and never count as a live model benchmark. The integration script uses genuine historical labels and offline adapters, with a dedicated queued-run fixture solely to test premature scoring. Python SQLite tests are complemented by the actual Wrangler D1 integration.

Logs and measured JSON reports are in artifacts/. No remote CI success or public deployment is claimed.
