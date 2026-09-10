# Data, refresh, and privacy

Where benchmark and pricing data come from, how caching and refresh behave, and what stays private.

- Benchmark source: [Artificial Analysis Free API documentation](https://artificialanalysis.ai/data-api/docs), `GET /api/v2/language/models/free`. All pages are fetched in the extension host, with a 20-second timeout per request.
- Pricing sources: [GitHub models and pricing](https://docs.github.com/en/copilot/reference/copilot-billing/models-and-pricing) and [legacy annual-plan multipliers](https://docs.github.com/en/copilot/reference/copilot-billing/request-based-billing-legacy/model-multipliers-for-annual-plans). Catalog date: **2026-09-10**. OpenCode USD rates are not catalogued: they arrive live from `opencode models --verbose` on every discovery.
- Benchmark snapshots are cached in the extension's global storage for 24 hours. **Refresh data** forces a refresh unless an API quota reset is pending. Cache replacement happens only after every page validates successfully.
- Offline, invalid-response, authentication, and rate-limit failures retain the last successful snapshot. The UI shows the retrieval date and identifies stale results. There is at most one automatic download attempt per extension session; manual refresh retries explicitly.
- The Free API documentation currently lists 100 requests per 24-hour window. Limits may change: the client observes `Retry-After`, `X-RateLimit-Remaining`, and `X-RateLimit-Reset`, and persists the next permitted request time.
- **Pareto GHC: Remove Artificial Analysis API Key** deletes the saved credential; it leaves the local benchmark cache available.
- No backend, telemetry, project-file reading, task uploads, or automatic model switching. Network access is limited to the benchmark API; Copilot discovery uses the existing editor integration, and OpenCode discovery spawns the local `opencode models --verbose` command (no `--refresh`, no inference, no model switching). The adapter never reads OpenCode config or credential files; only provider/model identifiers, pricing, limits, and variant names cross into extension state. The chart library and styling are bundled locally.
