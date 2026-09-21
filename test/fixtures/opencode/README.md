# OpenCode `models --verbose` fixtures (synthetic, dated 2026-09-10)
#
# These fixtures reproduce the *shape* observed from OpenCode 1.18.30 on
# Linux on 2026-09-10 (see docs/opencode-integration.md): one `provider/model`
# header line followed by a JSON metadata block carrying `id`, `providerID`,
# `name`, `family`, `cost { input, output, cache: { read, write } }`,
# `limit { context }`, and `variants`. They are hand-written representatives,
# not raw CLI captures: no credential material, no provider account data.
# `verbose-1.18.30.txt` is the known-good shape; `drifted.txt` is a
# hypothetical future shape (top-level JSON document, no header lines) that
# must fail closed with an actionable fingerprint instead of parsing to zero.
