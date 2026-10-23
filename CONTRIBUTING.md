# Contributing to pi-cue

Keep changes small, explain the behavior they improve, and preserve the separation between notification delivery, independent sound and the terminal UI. Development commands require the complete source workspace; the installed extension does not include tests or development tooling.

## Local checks

```sh
npm ci --ignore-scripts --cache .dev/npm-cache --no-audit --no-fund
node node_modules/typescript/bin/tsc --noEmit
node --test tests/*.test.ts
```

Use isolated `.dev` configuration and sessions for manual checks. Do not reuse another running Pi process or copy authentication into test fixtures. Describe which OS and terminal were actually checked; a successful API submission is not proof of a visible notification.

## Commit messages

This project combines [Conventional Commits 1.0.0](https://www.conventionalcommits.org/en/v1.0.0/) structure with [Gitmoji](https://gitmoji.dev/) meaning:

```text
type(scope)!: <emoji> summary
```

The scope and `!` are optional. Put the type first so Conventional Commit parsers can read it. Gitmoji’s [original syntax](https://gitmoji.dev/specification) is emoji-first; this repository deliberately uses a type-first combination.

- Types: `feat`, `fix`, `docs`, `style`, `refactor`, `perf`, `test`, `build`, `ci`, `chore`, `revert`.
- Use a lowercase scope when it helps, such as `panel`, `config`, `sound`, `readme` or `build`.
- Use one Unicode Gitmoji, followed by a short, concrete summary. Prefer an English imperative verb for a consistent public history.
- Breaking changes need `!` before the colon or a `BREAKING CHANGE:` footer. The 💥 emoji alone does not mark a machine-readable breaking change.
- Keep the subject within 100 Unicode code points. Add the reason or validation in the body after a blank line when useful.

| Change | Common Gitmoji | Example |
|---|---|---|
| Feature | ✨ | `feat(panel): ✨ add sound previews` |
| Bug fix | 🐛 | `fix(config): 🐛 preserve pending saves on reload` |
| Documentation | 📝 | `docs(readme): 📝 clarify the first-run path` |
| Refactor | ♻️ | `refactor(engine): ♻️ separate ticket cancellation` |
| Tests | ✅ | `test(focus): ✅ cover split focus reports` |
| Configuration | 🔧 | `chore(build): 🔧 limit package contents` |
| Breaking change | 💥 | `feat(config)!: 💥 require a versioned envelope` |

Invalid subjects include `✨ feat: add a cue` (wrong order), `feat: add a cue` (missing Gitmoji), and `fix(cue): 🐛` (missing summary). A commit can use another official Gitmoji when it more accurately describes the change; the checker validates syntax, not the truth of the summary.

## Optional message check

```sh
node scripts/check-commit-message.ts /path/to/commit-message.txt
```

The script uses Node’s built-in modules and a pinned list of Unicode Gitmoji. It does not initialize Git, install hooks, modify Git configuration or send anything. No hook is enabled in this workspace. If a hook is wanted later, agree on that separately after the repository exists.

## README workflow

Preview README changes locally at wide and narrow widths; keep commands copyable, images relative, and platform claims tied to evidence.

Authoring skills are optional local tools. Keep them, their local configuration, and preview artifacts out of both Git and the npm package.

## Releases

This project distributes TypeScript source, so it has no compile-to-JavaScript build step. `npm run check` checks types, `npm test` checks behavior, and `npm pack` creates the distributable archive from the explicit package file list.

The npm package is `@mikuhello/pi-cue`; the GitHub repository remains `MikuHello/pi-cue`. Version `0.1.0` has been published. Subsequent releases use staged publishing: GitHub Actions uploads a candidate, and a maintainer approves it on npm before it becomes public. The unscoped npm name `pi-cue` belongs to another publisher. Never publish this project under that name or reuse a published version.

The maintainer must have npm write access and account 2FA enabled. Never put account credentials or npm tokens in this repository.

Configure an npm trusted publisher for GitHub owner `MikuHello`, repository `pi-cue`, and workflow filename `npm-publish.yml`. Keep **Allow npm publish** and **Allow npm dist-tag** unchecked; `npm stage publish` is allowed by default. The workflow does not use a deployment environment, so leave **Environment name** empty. If an environment is added later, its name must match the npm configuration. Save and verify the npm configuration before triggering a release. Configure it close to the first automated release: npm currently requires the first successful publish within two days of creating the trust relationship. Check the current expiry policy and do not assume saving the settings or uploading a pending stage validates the relationship.

Set the GitHub repository variable `NPM_PACKAGE_NAME` to `@mikuhello/pi-cue`. After tests and README review, update `package.json` and the lockfile to an unused stable version, commit those changes, and publish a GitHub Release with tag `v<version>` at that commit. The workflow checks the tag, package identity and file list, runs type checks and tests, and submits the exact package archive with `npm stage publish` through OIDC. Prereleases, mismatched tags, missing package configuration and existing public npm versions are rejected. The npm registry also rejects a version already staged; inspect the pending stage before retrying a workflow. No npm token secret is needed.

The workflow prints the stage ID in its log and adds approval instructions to the run summary. On [npmjs.com](https://www.npmjs.com/), open **Staged Packages**, verify the package, version, stage ID and contents, then choose **Approve** and complete 2FA. The CLI alternative is `npm stage view <stage-id>` followed by `npm stage approve <stage-id>` with interactive 2FA. The workflow never approves a stage. A successful GitHub run means the upload is awaiting approval; verify npm shows the intended version after approving it.

The workflow uses GitHub-hosted runners and Node.js 24, explicitly installs npm 12.2.1 in both jobs, and disables the package-manager cache. Staged publishing requires npm 11.15.0 or newer. Only the staging job can request an OIDC token. A GitHub Release triggers staging, and a maintainer's npm approval makes the version public. npm's **Publishing access** settings for traditional tokens are separate from trusted publishing; requiring 2FA and disallowing tokens remains compatible with OIDC.

Sources: [trusted publishing](https://docs.npmjs.com/trusted-publishers/), [staged publishing and approval](https://docs.npmjs.com/staged-publishing/), [npm stage commands](https://docs.npmjs.com/cli/v12/commands/npm-stage/), [package publishing access](https://docs.npmjs.com/requiring-2fa-for-package-publishing-and-settings-modification/), and [GitHub Release events](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#release).
