# Releasing JOT packages

The seven public packages start from the monorepo's `0.0.0` development version. The initial major Changeset produces their first release candidate, `1.0.0`, in the version pull request. `@jot/testing` stays private and is never included in the publish workflow.

## Automated flow

1. Merge a change with a Changeset into `master`. The Changesets workflow creates or updates a package version pull request.
2. Review the version pull request and its CI checks. Because the pull request is created with `GITHUB_TOKEN`, a maintainer with write access may need to approve its Actions workflows before checks run; GitHub can mark them `approval-required` ([GitHub's workflow approval behavior](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/trigger-a-workflow)). Then merge it. The publish workflow compares the full push range from `github.event.before` to the pushed commit and keeps the OIDC job disabled until `NPM_TRUSTED_PUBLISHING_READY=true` is set.
3. For the first release, run the workflow manually with `bootstrap=true` on `master`. Its unprotected preflight fails unless all seven public package manifests are exactly `1.0.0`; the protected checks then run against that same commit SHA. Approve the `npm-publish` environment and wait for typecheck, tests, lint, and package-content checks. The bootstrap job never publishes.
4. A maintainer interactively publishes the seven reviewed `1.0.0` packages with npm two-factor authentication in dependency order. This one-time step is necessary because npm requires a package to exist before a Trusted Publisher can be configured. The registry returned `E404` for the seven package names during preparation. After the protected bootstrap checks pass, copy the SHA printed by the successful job's `Record the approved bootstrap source SHA` step, check out exactly that commit (`git checkout <SHA>`), and confirm `git rev-parse HEAD` prints the same SHA before running the commands below from the repository root. Do not publish from a different versioned commit. npm will prompt for the configured second factor when required.
5. Configure the Trusted Publisher for each package and set the repository Actions variable `NPM_TRUSTED_PUBLISHING_READY` to `true`. The publish workflow skips an exact version that was already published during bootstrap.
6. For later versions, approve the `npm-publish` deployment. The OIDC job reruns typecheck, tests, lint, and package-content checks before publishing only packages whose versions changed.

After bootstrap, the publish job uses GitHub Actions OIDC with npm Trusted Publishing and requires npm CLI 11.5.1 or newer. No npm token is stored in GitHub Actions. Ordinary CI and the Changesets workflow do not publish packages.

## One-time maintainer setup

Before enabling automated OIDC releases:

1. Confirm the npm account can publish `jot-framework`, `create-jot`, and the `@jot` scope packages. If any name is already claimed, resolve ownership before release.
2. In **Settings → Actions → General → Workflow permissions**, enable **Allow GitHub Actions to create and approve pull requests** so the Changesets Action can create or update its version pull request ([Changesets Action requirements](https://github.com/changesets/action#requirements), [GitHub setting](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/enabling-features-for-your-repository/managing-github-actions-settings-for-a-repository#allowing-github-actions-to-create-and-approve-pull-requests)).
3. In GitHub repository settings, create the `npm-publish` environment and add the required maintainers as required reviewers.
4. After the initial interactive publish creates the package entries, add a GitHub Actions trusted publisher for owner `Bruno-BRG`, repository `js_on_tracks`, workflow filename `publish.yml`, and environment `npm-publish` on each package.
5. Set the repository Actions variable `NPM_TRUSTED_PUBLISHING_READY` to `true` only after all seven publisher records are configured.
6. Confirm Node.js 24 and npm 11.5.1 or newer are available to the publish job.

The first interactive publish and these registry/GitHub settings are external to this repository and must be completed by a maintainer. Do not add `NPM_TOKEN` to repository secrets.

## First publish commands

After the `bootstrap=true` workflow run passes and its `npm-publish` environment is approved, copy the exact SHA printed by its successful `Record the approved bootstrap source SHA` step. Check out that SHA and verify it before publishing:

```sh
git checkout <SHA>
git rev-parse HEAD
```

The `git rev-parse HEAD` output must match the SHA recorded by the protected workflow. Authenticate as an authorized publisher and confirm the account, then publish:

```sh
npm login
npm whoami
npm run check:packs
npm publish --workspace=@jot/db --access=public
npm publish --workspace=@jot/views --access=public
npm publish --workspace=@jot/orm --access=public
npm publish --workspace=@jot/core --access=public
npm publish --workspace=@jot/cli --access=public
npm publish --workspace=jot-framework --access=public
npm publish --workspace=create-jot --access=public
```

Stop if any command fails; do not continue to dependent packages until the failure is resolved. These commands create only the reviewed `1.0.0` versions from the versioned commit, never the monorepo's `0.0.0` preparation manifests.

## Public package list

- `jot-framework`
- `create-jot`
- `@jot/cli`
- `@jot/core`
- `@jot/db`
- `@jot/orm`
- `@jot/views`
