---
name: games-maintain
description: Work on the open.games repository itself. Use when changing a package, running tests, touching physics or a game's determinism, editing docs/, or cutting a release.
---

Five packages in `packages/`: `games`, `rules`, `palace`, `physics`, `decks`. They import each other's built output. Node 22.12 or later.

## Commands

- `npm run build` first (the packages need each other's `dist`), then `npm run typecheck` and `npm test`.

Finish a change only when all three pass.

## Rules that are easy to break

- **Determinism.** The same rules, seats, seed and moves must give the same state. Changing a shuffle, a bot's use of `rand`, or the order anything is visited changes old games, which a room replays from its log. Say so in the PR.
- **Physics keeps to exact operations** (`+ - * /`, comparisons, `Math.sqrt`, `Math.abs`, `Math.round`; no `sin`, `cos`, `atan2`, `pow`, `**`, `Math.random`, `Date`). Its tests scan the source and compare recorded shots exactly. **Raise `PHYSICS_VERSION` for any change that could move where something comes to rest**, and expect the fixtures to fail when it does.
- **A view holds only what its seat may see.** `summary` is public.
- **Names are the app's, not the engine's**: a seat is `{0}`, `{1}` in engine text (`who(seat)`), and the table puts in the players' names.
- **Docs match the code.** `docs/games.md` is written from `KIT_GAMES`: regenerate it when games change. Link pages as `file.md`. Do not link docs or skills to open.parlor (it is going private); paths like `packages/web/...` belong to the app that draws the tables.

## Releasing

Each package has its own version. Bump the ones that changed in a PR (`npm version patch -w @journey-to-code/games --no-git-tag-version`), raise a dependent's range if it needs the new one, and merge. `.github/workflows/release.yml` publishes versions not on npm yet, with provenance, then tags (`games-v<version>`) and creates GitHub releases. `node scripts/publish.mjs --dry-run` shows what would go out. A failed run is safe to re-run from the Actions tab. Details: `docs/releasing.md`.

## Docs

`docs/` is Markdown with `order` in the front matter, built to GitHub Pages by `.github/workflows/docs-pages.yml`, pinned to one open.blog commit (`OPENBLOG_REF`). A pull request builds the site; only `main` publishes. Pages needs Settings, Pages, Source: GitHub Actions, once. The social image is `docs-site/static/og.png`, drawn from `og.svg`.
