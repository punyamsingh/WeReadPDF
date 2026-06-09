# WeReadPDF

> **May the words be ever in your favor.**
> A local-first PDF reader that reaps print-bound PDFs into clean, flowing,
> Kindle-style text you can actually read on a phone — every page processed in
> your own browser, nothing uploaded, no account, no trace.

**Live:** [wereadpdf.vercel.app](https://wereadpdf.vercel.app)

---

## Why

PDFs were built for paper. Open one on a phone and you get pinch-zoom, tiny
columns, and lines that run off the edge. WeReadPDF extracts the _text_ from a
PDF and reflows it into a real ebook — screen-sized pages you turn with a tap,
with the typography, theme, and spacing all under your control.

Because everything runs client-side, your books never leave your device. No
upload, no server, no tracking — just you and the page, sealed in your own
district.

## Features

- **Reflowed, Kindle-style reading.** The whole book is laid out into
  viewport-width CSS columns, so each "page" is exactly one screen. Turn pages
  by **tapping the edges**, **swiping**, the **keyboard** (`←` / `→` / `Space`),
  or the on-screen controls — no scrolling, no pinch-zoom.
- **Smart text extraction.** Paragraphs are reconstructed from raw PDF text
  using line geometry (soft-wrap vs. real breaks, hyphenation stitching),
  running headers/footers and page-number folios are stripped, and a table of
  contents is recovered from the embedded outline — or sniffed from chapter
  headings when there isn't one.
- **Chapter title pages.** Detected chapters start on a fresh page with a
  centered title card, just like a printed book.
- **A real library.** Imported books are cached locally in **IndexedDB**, so a
  few-hundred-page PDF survives a reload. Rename, remove, see your reading
  progress per book, and jump back into whatever you were reading.
- **Deep typography controls.** Font (Cormorant Garamond, Literata, Inter, or
  **OpenDyslexic**), size, line height, line width (measure), brightness, side
  margins, letter spacing, paragraph spacing, justify toggle, hyphenation
  toggle, and indented-vs-spaced paragraphs — all persisted between sessions.
- **Four reading surfaces.** Paper (Kindle-white), Sepia, Charcoal, and
  Midnight, hand-tuned in the OKLCH color space for comfortable contrast.
- **Resume where you left off.** Reading position is anchored to the source
  page, so it stays put even when you change the font size and the book
  re-paginates.
- **Respects your system.** Honors `prefers-reduced-motion` (no slide
  animation) and keeps text selectable while reading.
- **Local-first & private.** Files are parsed in-browser with
  [pdf.js](https://mozilla.github.io/pdf.js/). Nothing is ever uploaded.

## Tech stack

| Area        | Choice                                                                                           |
| ----------- | ------------------------------------------------------------------------------------------------ |
| Framework   | [TanStack Start](https://tanstack.com/start) (file-based routing, SSR)                           |
| UI          | React 19, [Tailwind CSS v4](https://tailwindcss.com), [shadcn/ui](https://ui.shadcn.com) (Radix) |
| PDF parsing | [pdf.js](https://mozilla.github.io/pdf.js/) (`pdfjs-dist`) in a web worker                       |
| Storage     | IndexedDB (book bodies) + localStorage (settings & progress)                                     |
| Build / dev | [Vite](https://vitejs.dev) + [Nitro](https://nitro.build)                                        |
| Deploy      | [Vercel](https://vercel.com) (Nitro `vercel` preset)                                             |
| Language    | TypeScript                                                                                       |

## Getting started

Requires **Node 18+** and **[pnpm](https://pnpm.io)** (`packageManager` is
pinned in `package.json`).

```bash
pnpm install      # install dependencies
pnpm dev          # start the dev server on http://localhost:8080
pnpm build        # production build (.vercel/output)
pnpm preview      # preview the production build
pnpm lint         # eslint
pnpm format       # prettier --write
pnpm format:check # prettier --check (used by CI, fails on unformatted files)
```

Then open the app, drop in a PDF, and start reading.

## Project structure

```
src/
├── components/
│   ├── App.tsx          # top-level state: library ↔ reader
│   ├── Library.tsx      # the shelf / landing hero + book cards
│   ├── DropZone.tsx     # drag-and-drop / file-picker import
│   ├── Reader.tsx       # reader chrome: top/bottom bars, settings, TOC
│   ├── BookView.tsx     # the page-turn engine (CSS multi-column reflow)
│   ├── Mockingjay.tsx   # logo mark
│   └── ui/              # shadcn/ui primitives
├── lib/
│   ├── pdf-extract.ts   # pdf.js text extraction + paragraph reconstruction
│   └── reader-store.ts  # settings, progress, IndexedDB document store
├── routes/              # TanStack Start file-based routes
└── styles.css           # theme tokens, fonts, animations
```

A short note on routing conventions lives in
[`src/routes/README.md`](src/routes/README.md).

## How it works

1. **Import** — a dropped PDF is read entirely in the browser. pdf.js (running
   in a web worker) yields positioned text items per page.
2. **Reflow** — `pdf-extract.ts` groups items into lines by baseline, then
   stitches lines into paragraphs using indentation and gap heuristics,
   un-hyphenating soft wraps and dropping folios/running heads.
3. **Cache** — the extracted book is stored in IndexedDB, keyed by file name +
   size, and appears on your shelf.
4. **Read** — `BookView` flows the text into screen-width CSS columns; turning a
   page just slides the column strip. Position maps back to the source PDF page
   for progress, resume, and table-of-contents jumps.

## Privacy

WeReadPDF is local-first by design. PDFs are parsed and stored entirely on your
device — there is no backend that receives your files, no account system, and no
analytics on your reading. Clearing your browser storage removes your library.

## CI & releases

**Quality gate (Jenkins).** [`Jenkinsfile`](Jenkinsfile) defines the "decency"
pipeline that runs on changes: it installs dependencies with the pinned pnpm
version and runs **lint → format check → build**. Any failing stage fails the
build. Point a Jenkins Pipeline job at this repo to use it.

**Versioning (semantic-release).** On every merge to `main`, the
[`Release`](.github/workflows/release.yml) GitHub Actions workflow runs
[semantic-release](https://semantic-release.gitbook.io). It reads the
[Conventional Commits](https://www.conventionalcommits.org) since the last
release, computes the next [SemVer](https://semver.org) version, updates
`package.json` + `CHANGELOG.md`, tags the commit, opens a GitHub Release, and
pushes a `chore(release): x.y.z` commit back to `main` as **semantic-release-bot**.

Commit messages drive the version bump:

| Commit type                                | Release           |
| ------------------------------------------ | ----------------- |
| `fix: …`                                   | patch (x.y.**z**) |
| `feat: …`                                  | minor (x.**y**.0) |
| `feat!: …` / `BREAKING CHANGE:`            | major (**x**.0.0) |
| `chore: …`, `docs: …`, `refactor: …`, etc. | no release        |

**Commit linting.** A [`Commitlint`](.github/workflows/commitlint.yml) workflow
checks every commit in a pull request against the Conventional Commits spec
([`commitlint.config.js`](commitlint.config.js)), so a merged PR always produces
a valid release. Add it as a required status check to block non-conforming
commits from landing on `main`.

**One-time setup — `GH_PAT` + ruleset bypass.** `main` has a ruleset requiring
all changes to go through a PR, and the built-in `GITHUB_TOKEN` **cannot** bypass
it — so the release's commit push is rejected (`GH013: Repository rule
violations`). To let semantic-release push the `chore(release)` commit:

1. **Create a token** with push rights — a fine-grained PAT (repo access:
   `Contents: Read and write`) or a GitHub App installation token.
2. **Add it as a repo secret** named `GH_PAT` (Settings → Secrets and variables
   → Actions). The workflow uses `GH_PAT` and falls back to `GITHUB_TOKEN`.
3. **Add the token's owner/app to the ruleset bypass list** (Settings → Rules →
   the `main` ruleset → _Bypass list_), so its pushes skip the PR requirement.

Without these, the release computes the version correctly but fails at the push
step. (Alternative: drop `@semantic-release/git` to publish tags + GitHub
Releases only, with no commit back to `main`.)

## License

Released under the [MIT License](LICENSE).
