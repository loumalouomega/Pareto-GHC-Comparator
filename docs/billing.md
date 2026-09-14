# Billing estimates

How AI-credit, legacy premium-request, and OpenCode USD costs are estimated for an illustrative token workload. Cost units never mix: Copilot models compare in AI credits or legacy billing, OpenCode models in USD. There is no cross-unit frontier; comparison mode can optionally show a USD equivalent alongside the native cost (see below).

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

## Monthly spending scenarios

The **Monthly spending scenario** card is a separate, optional what-if projection: fee + expected usage against a plan's documented allowance and overage rate. It is independent of the estimates above — it never sets a price or a benchmark mapping, and its output is a projection, never a bill.

**Plan registry**, verified 2026-09-14 against GitHub's documentation ([plans](https://docs.github.com/en/copilot/get-started/plans), [individual billing](https://docs.github.com/en/copilot/concepts/billing-and-usage/individuals/billing), [models and pricing](https://docs.github.com/en/copilot/reference/copilot-billing/models-and-pricing), [flex allotments](https://github.blog/news-insights/company-news/github-copilot-individual-plans-introducing-flex-allotments-in-pro-and-pro-and-a-new-max-plan/), [legacy premium requests](https://docs.github.com/en/copilot/reference/copilot-billing/request-based-billing-legacy/copilot-requests)):

| Plan | Fee | Base credits/mo | Flex credits/mo |
| --- | --- | --- | --- |
| Copilot Pro | $10 | 1,000 | 500 |
| Copilot Pro+ | $39 | 3,900 | 3,100 |
| Copilot Max | $100 | 10,000 | 10,000 |
| Copilot Business | $19/seat | 1,900 per user (pooled) | — |
| Copilot Enterprise | $39/seat | 3,900 per user (pooled) | — |
| Legacy annual Pro / Pro+ | not documented | 300 / 1,500 premium requests | — |

Base credits are used first, then flex; flex is documented as variable, base as fixed. Credits reset 00:00 UTC on the 1st of each month and do not roll over. Usage beyond the allowance is billed only when a budget for additional usage is set (AI credits at $0.01 each, legacy premium requests at $0.04 each); without a budget, that usage is unavailable rather than billed. Code completions and next edit suggestions never consume AI credits. **Copilot Free, Copilot Student, and OpenCode Go stay unavailable**: their allowances (Free/Student) or their per-model 5-hour/weekly/monthly dollar limits (OpenCode Go) are not a monthly-allowance shape this projection models. Every other source is unavailable with "no verified billing rules" rather than approximated from Copilot's rules. A **Custom plan** lets you enter your own fee, allowance, and overage rate for AI credits or legacy billing; those values are always labelled as your own input, never verified.

**Arithmetic**, per plan and per month:

```
usage        = requests × per-request cost (the model's displayed cost — task, workload, or legacy basis)
allowance    = [base, base + flex]                     (flex-less plans: base = base)
overage_low  = max(0, usage_low  − (base + flex))       (best case: full allowance available)
overage_high = max(0, usage_high − base)                (worst case: only base is guaranteed, since flex may change)
overage_usd  = overage_units × overage rate             (only if the plan documents one)
total_usd    = fee + overage_usd                        (fee counted once, never scaled by requests; null if the fee is undocumented)
```

Every quantity is rounded to 1e-6 before a boundary comparison, so floating-point noise never flips a boundary; landing exactly on a boundary counts as within it. Because `overage_high` is computed against base only, it can be nonzero even while the boundary reads "within flex" — that is the pessimistic figure assuming flex isn't available, shown alongside the boundary rather than instead of it.

**Row and requests.** The projection uses the model row you have selected; with none selected it falls back to the recommended row, then the first comparable row, and says which it used. Requests/month are either typed directly (low/high) or filled from local usage history via **Use my request history** — a window in `days` from your last scan, spread over active days (high) or the full calendar span (low), and always labelled "observed history" with its window; editing the fields by hand afterward returns to "your input". History requests span every discovered Copilot model but are priced as if they all used the selected row — a deliberate simplification, noted in the card.

**Comparison mode**: each A/B option keeps its own plan and requests, so switching one option's source or billing can make its scenario unavailable (never silently converted). The delta between options is a separate sentence from the selected-row cost delta, comparing only the range ends (low−low, high−high) and only when both options project the same unit with a documented fee — otherwise it names the reason (off, unavailable, different units, or an undocumented fee) instead of a number. Scenarios are saved with workload profiles like every other workload setting.

**Exports.** CSV and snapshot exports include the plan registry date and a `scenario` block labelled "Estimated monthly spending scenario (projection, not a bill)", with the same field-by-field provenance shown in the UI (provider-verified with its date and sources, your own input, observed history with its window, or a displayed estimate).

## USD equivalents (comparison mode)

Compare options has an optional **Show USD equivalents** toggle (off by default) that converts AI-credit costs to USD alongside the native value, so a cost delta is still shown — as a labelled equivalent, never a silent universal exchange rate — when the two options bill in different units.

- **Rate**: AI credits convert at the documented pay-as-you-go/overage rate of **$0.01 per credit** (GitHub's models-and-pricing documentation, dated with the plan registry). USD passes through unchanged (shown as "native"). **Legacy premium requests are never converted**: a per-interaction multiplier isn't a token-workload cost, so there's no meaningful per-unit USD rate for it.
- **Allowance treatment**: the conversion is a flat pay-as-you-go rate. It does not count a plan's included allowance or monthly fee — those depend on the plan and are already modeled separately by the monthly spending scenario. A converted figure and a scenario total can legitimately disagree; each is labelled with what it does and doesn't include.
- **Rounding**: values are rounded to $0.000001; the original value keeps full precision.
- **Cost basis**: a converted value only appears for a row with a valid cost (finite, non-negative); zero (e.g. a free-tier row) converts to $0.
- **The comparison delta**: a USD-equivalent B − A delta appears only when the toggle is on, both sides convert (neither legacy nor an unpriced selection), and the same cost basis and workload apply — the same requirements the native cost delta already uses. Otherwise the delta names why (which side didn't convert, or which basis/workload mismatch), never a silent number.
- **Scope**: this only affects comparison-mode panels, the delta sentence, and exports. It never changes single-view costs, charts, frontiers, or the recommendation — cost units still never mix within a chart or frontier.
- **Exports**: CSV rows gain `usd_equivalent` and `usd_conversion` columns per row (status `native`, `converted`, `unavailable`, or `off` when the toggle isn't set), alongside the existing `cost`/`cost_unit` columns; the pair snapshot's `options[]` entries gain `costNormalization` (the selected row's conversion) and the top level gains `usdCostDelta`.
