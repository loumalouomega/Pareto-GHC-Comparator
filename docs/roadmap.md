# Roadmap

Candidate features for future Pareto-GHC-Comaprator releases, prioritized by value versus effort given what the extension already ships.

This page is aspirational, not a commitment — items may be re-ordered, re-scoped, or dropped. Effort is a rough order of magnitude: **S** (a day or two), **M** (roughly a week), **L** (multi-week).

Everything previously shipped is tracked in `CHANGELOG.md`, and `AGENTS.md` has a per-feature section with the verified implementation details for anything currently in the codebase — this page is for what's **not** built yet, plus the Non-goals that record why a direction was rejected so it isn't re-proposed.

## How this file works

- **Tiers are ordered, and the order is the recommendation.** Each tier states an *admission criterion*; an item that doesn't meet it belongs in a different tier or in Non-goals, not at the top because it sounds exciting. An empty tier is removed from the file entirely rather than kept as a placeholder.
- **A closed item is removed from this list entirely**, not struck through — its write-up moves to `AGENTS.md` (a per-feature section with the verified implementation details) and its history stays in git. **Numbering is not stable across closes**, so never reference an item by number from code or another document — reference it by name.
- **Non-goals are not one thing.** They are split into three groups below because each has a different revival rule, and each group says plainly **what would change our mind**. A rejection nobody re-checks is how a capability stays "permanently out of reach" long after it stopped being — four entries in this file were found stale exactly that way.
- **An item that corresponds to a GitHub issue names it inline** (e.g. *issue #35*). The issue is the request and the discussion thread; this file is the scoping — what already exists, what the real blocker is, and what the phasing should be. Where the two disagree, this file is the one that was checked against the code.

## Open items

### Tier 0 — Add AGENTS.md and CHANGELOG.mg

TODO: Define

### Tier 1 — Also work with OpenCode

TODO: Define

## Non-goals / known constraints

TODO