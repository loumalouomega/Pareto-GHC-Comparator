# CI and Marketplace releases

`.github/workflows/extension.yml` runs on branch pushes, pull requests, version-tag pushes, and manual dispatch. It installs locked dependencies with Node.js 22, type-checks, runs the unit and host tests, builds, runs Chromium UI tests, and packages the VSIX. Successful runs upload a **pareto-ghc-comparator-<commit SHA>** artifact, retained for 30 days. Failed runs upload any browser diagnostics for 7 days.

Only a **push of a stable version tag** creates a GitHub Release and publishes to the VS Code Marketplace. The tag must exactly match `v` plus the manifest version, and the lockfile version must match too. The release job uploads the tested `pareto-ghc-comparator-<version>.vsix` to the tag's GitHub Release; the Marketplace job downloads the VSIX from that same run and publishes those exact packaged bytes. Branch pushes, pull requests, and manual dispatch only build artifacts.

As a first approach, install from the tag's GitHub Release (`Extensions: Install from VSIX…`) if the Marketplace job fails; the release job uploads the same tested bytes independently of Marketplace credentials. `vsce show kratos-multiphysics.pareto-ghc-comparator` currently lists version 0.5.1, so a 401 on a newer tag means the update upload was rejected, not that the pipeline built the wrong bytes.

One-time setup:

1. Register or select your publisher in [Marketplace publisher management](https://marketplace.visualstudio.com/manage/publishers/kratos-multiphysics). Set `publisher` in `package.json` to its exact ID. The current value is `kratos-multiphysics`; it must belong to an account you control.
2. Create the GitHub Actions environment **marketplace**. Add `VSCE_PAT` as an environment secret (a repository secret also works): an Azure DevOps PAT with organization **All accessible organizations**, scope **Marketplace → Manage**, a future expiration date, and an identity holding **Owner or Contributor** on that publisher. Reader access passes `vsce verify-pat` but publish then fails with 401. Do not put the token in source files. See the [official publishing guide](https://code.visualstudio.com/api/working-with-extensions/publishing-extension) for token creation and publisher membership.
3. Push this workflow to GitHub. No Artificial Analysis API key is needed in CI; automated tests use fixtures.

To release, start with a clean checkout, run `npm version patch` (or `minor` / `major`) to update both manifests and create a version commit and tag, then push the commit and **that specific tag**. For example, if the next version is `0.7.1`:

```sh
git push origin HEAD
git push origin v0.7.1
```

The repository manifest and lockfile are at version 0.7.0, with a corresponding git tag; `vsce show` lists 0.5.1 on the Marketplace, so the 0.7.0 Marketplace update is still pending a credential with write access. `npm run release:check -- v0.7.0` validates that tag string against both manifests; it does not verify git tag existence or publication. Use a new version for subsequent Marketplace releases. The workflow uses `--skip-duplicate` and does not overwrite an existing version; a failed publication can be rerun after fixing authentication.

Authentication maintenance: Microsoft's publishing guide states that global Azure DevOps PATs retire on December 1, 2026. This workflow verifies publisher access using `VSCE_PAT` when present and otherwise attempts `--azure-credential`. The fallback alone does not provision an Entra identity; configure and validate Microsoft Entra authentication before retiring PAT-based publication. The build and artifact jobs do not depend on publishing credentials.
