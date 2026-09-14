# Billing estimates

How AI-credit, legacy premium-request, and OpenCode USD costs are estimated for an illustrative token workload. Cost units never mix: Copilot models compare in AI credits or legacy billing, OpenCode models in USD. There is no cross-unit frontier.

**AI credits** estimates usage from GitHub's per-million-token USD rates, with 1 credit equal to $0.01. The default example has 1,000 uncached input and 1,000 output tokens, with no caching. Input buckets are disjoint: count each input token once as uncached, cache-read, or cache-write. Output includes reasoning tokens.

```
credits = (uncached × input_rate + cache_read × cached_rate
           + cache_write × write_rate + output × output_rate) / 10,000
```

Where no separate cache-write rate is listed, cache-write tokens use the normal input rate. Long-context thresholds apply to the sum of all three input buckets. Exactly reaching a threshold keeps the default tier; exceeding it uses the long-context rates for the complete workload. Workloads exceeding a model's reported input capacity are excluded. Expired promotional prices are excluded until the catalog is updated.

**Legacy premium requests** uses the published multiplier per manually selected model interaction for eligible annual Copilot Pro or Pro+ plans. The catalog currently has the same documented multipliers for both. Models without documented legacy multipliers remain unavailable in that mode. Auto-selection discounts, subscription charges, remaining allowances, code-review charges, and GitHub Actions costs are not included.

**OpenCode USD** uses the per-million-token rates reported live by `opencode models --verbose` on every discovery, so prices cannot go stale between extension releases:

```
usd = (uncached × input_rate + cache_read × cached_rate
       + cache_write × write_rate + output × output_rate) / 1,000,000
```

The same disjoint-bucket, cache-write fallback, and whole-workload long-context rules apply. Zen-gateway free-tier models (`opencode`, `opencode-go` providers with all-zero rates) compare at cost 0 with a **Free tier** label. Models billed directly by their provider (e.g. `openai/*`) report zero rates that mean *unpriced*, not free: they stay unresolved with a "Billed by provider; no verified rate" reason unless you supply explicit per-model BYOK rates in the webview table, or apply one of the unverified same-identifier registry suggestions described below. BYOK entries use the same USD formula with a visible **BYOK** tier label, never override free-tier models, and never mix with other billing modes. Unrecognized pricing tiers fall back to base rates with a visible note.

**BYOK provenance and registry suggestions.** Every BYOK entry records where its rate came from: `manual` (typed into the webview form) or `registry` (applied from a static-registry suggestion, with the registry name, exact matched identifier, and registry date). Only the extension host can create registry provenance, via the **Apply rate to this model** / **Apply to all N variants** actions in model details, from a verified `registryRateFor` match — never from the webview form message, which is always treated as manual regardless of what it sends. Saving the BYOK form again without changing a registry-applied entry's rates keeps its provenance rather than downgrading it to manual.

A suggestion requires the OpenCode provider (e.g. `openai`) to be in an explicit, verified provider → registry table (currently `openai` → the Codex static registry, both sourced from `openai.com/api/pricing`) and an exact identifier match: the registry entry's id, with dots turned to dashes, must equal the OpenCode model's own id (the `#variant` suffix, if any, is stripped first — a suggestion for a base model's rate applies per variant, not automatically to all of them). No other normalization or fuzzy matching is used. If the registry entry the BYOK rate was applied from later changes rates or disappears, the applied rate keeps working as before, but model details show a visible staleness warning ("registry rate has changed" / "registry entry is no longer available") instead of silently updating or removing it.

**Cost per task** (the default chart view) reuses the formula above with a fixed illustrative mix of 1,000 input and 1,000 output tokens instead of the editable workload, so models stay comparable without depending on workload inputs. It is a documented proxy for the Artificial Analysis "Cost per Intelligence Index Task" concept, not the official evaluation weights. Context-limit exclusion does not apply to the fixed mix; legacy billing shows the same per-interaction multiplier in both views.

These figures describe estimated usage, not your account bill or measured task cost. No inference request is sent by this extension.
