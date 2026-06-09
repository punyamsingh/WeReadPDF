# CLAUDE.md

Guidance for Claude Code (and other agents) working in this repository.

## Project

**WeReadPDF** — a local-first, Kindle-style PDF reader. PDFs are parsed and
stored entirely in the browser (IndexedDB); there is no backend.

- **Stack:** Vite + React 19 + TypeScript, TanStack Start / Router, Tailwind v4,
  Radix UI, `pdfjs-dist`.
- **Package manager:** **pnpm** (pinned via `packageManager` in `package.json`).
  Use pnpm, not npm/yarn/bun.

## Commands

```bash
pnpm install        # install deps
pnpm dev            # dev server on http://localhost:8080
pnpm build          # production build
pnpm lint           # eslint
pnpm format         # prettier --write .
pnpm format:check   # prettier --check . (CI uses this; fails on unformatted files)
```

There is **no test framework** configured. "Testing" in CI means lint + format
check + build. Don't invent a test runner unless asked.

## Conventions & gotchas

- **Prettier** (`.prettierrc`): printWidth 100, semicolons, double quotes,
  trailing commas `all`. Run `pnpm format` before committing.
- **ESLint** forbids importing `server-only` — TanStack Start uses `*.server.ts`
  modules or `@tanstack/react-start/server-only` instead.
- `routeTree.gen.ts` is generated — don't hand-edit; it's prettier-ignored.

## CI & release model (IMPORTANT — this is the part that's easy to break)

### Conventional Commits are mandatory

Versioning is fully automated and **driven by commit messages**, so every commit
that reaches `main` must follow [Conventional Commits](https://www.conventionalcommits.org):

| Commit type                       | Release      |
| --------------------------------- | ------------ |
| `fix:` / `perf:`                  | patch (x.y.**z**) |
| `feat:`                           | minor (x.**y**.0) |
| `feat!:` / `BREAKING CHANGE:`     | major (**x**.0.0) |
| `chore:`, `docs:`, `ci:`, `style:`, `refactor:`, etc. | no release |

A non-conventional commit silently produces **no version bump**. The
`Commitlint` workflow (`.github/workflows/commitlint.yml`,
`commitlint.config.js`) enforces this on every PR.

### Versioning (semantic-release)

- On every merge to `main`, `.github/workflows/release.yml` runs
  [semantic-release](https://semantic-release.gitbook.io). It reads the
  Conventional Commits since the **latest git tag**, computes the next SemVer,
  updates `package.json` + `CHANGELOG.md`, tags the commit, opens a GitHub
  Release, and pushes a `chore(release): x.y.z` commit as **semantic-release-bot**.
- **Baseline:** the project's first version is established by the **`v1.0.0`
  git tag** (semantic-release derives everything from the latest tag, not from
  the `version` field in `package.json`). Do not delete this tag.
- **Plugins** (`.releaserc.json`): commit-analyzer, release-notes-generator,
  changelog, npm (`npmPublish: false` — the package is private), git, github.

### The `main` ruleset requires a token that can bypass it

`main` has a ruleset requiring all changes via PR. The built-in `GITHUB_TOKEN`
**cannot** bypass it, so the release commit push fails with `GH013: Repository
rule violations`. The workflow therefore pushes with a **`GH_PAT`** secret.

For releases to land, the repo must have:
1. A **`GH_PAT`** Actions secret — a token (fine-grained PAT or GitHub App) with
   `Contents: Read and write`.
2. That token's owner/app on the **`main` ruleset → Bypass list** (mode: Always).

If `GH_PAT`/bypass are missing, semantic-release still computes the version
correctly but fails at the push step. (Alternative design, if the bypass is ever
unwanted: drop `@semantic-release/git` to publish tags + GitHub Releases only,
with no commit back to `main`.)

### Quality gate (Jenkins)

`Jenkinsfile` defines the "decency" pipeline: install with pinned pnpm, then
**lint → format check → build**. It runs on a Jenkins server pointed at this
repo (separate from GitHub Actions).

## Working agreements

- Develop on a feature branch and open a PR — direct pushes to `main` are
  blocked by the ruleset.
- Keep commit messages Conventional so the autobump stays correct.
- Run `pnpm lint` and `pnpm format:check` before pushing; CI will fail otherwise.
