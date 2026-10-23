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

The npm package is `@mikuhello/pi-cue`; the GitHub repository remains `MikuHello/pi-cue`. The first npm version has been published. The release workflow remains a draft until a trusted publisher is configured. The unscoped npm name `pi-cue` belongs to another publisher. Never publish this project under that name or reuse a published version.

For the first publication, the maintainer registers or signs in to npm, enables account 2FA, and completes `npm login` and any publication challenge interactively. A personal npm username provides its own `@username` scope; no organization is required. Confirm the scoped name and an unused version, update both package manifests, set `private: false`, and review the package archive before an authorized public publish. Never put account credentials or npm tokens in this repository.

For subsequent releases, configure an npm trusted publisher for GitHub owner `MikuHello`, repository `pi-cue`, and workflow filename `npm-publish.yml`, allowing direct `npm publish`. The package must already exist and the maintainer must have write access. Configure it close to the first automated release and check npm's current expiry policy. The workflow does not use a deployment environment; if one is added later, its name must match the npm trusted publisher configuration.

Set the GitHub repository variable `NPM_PACKAGE_NAME` to `@mikuhello/pi-cue`. After tests and README review, update `package.json` and the lockfile to an unused stable version, commit those changes, and publish a GitHub Release with tag `v<version>` at that commit. The workflow checks the tag, package identity and file list, runs type checks and tests, and then publishes through OIDC. Prereleases, mismatched tags, missing package configuration and existing npm versions are rejected. No npm token secret is needed.

The workflow uses GitHub-hosted runners, Node.js 24, npm 11.5.1 or newer, and no package-manager cache. Only its publishing job can request an OIDC token. A GitHub Release triggers npm publication; creating a release is not a replacement for passing the checks or configuring npm permissions.

Sources: [npm personal scopes](https://docs.npmjs.com/about-scopes/), [public scoped packages](https://docs.npmjs.com/creating-and-publishing-scoped-public-packages/), [trusted publishing](https://docs.npmjs.com/trusted-publishers/), [trusted publisher prerequisites](https://docs.npmjs.com/cli/v11/commands/npm-trust/), and [GitHub Release events](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#release).
