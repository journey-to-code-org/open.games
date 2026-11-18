---
order: 9
---

# For agents

A coding agent can use and maintain open.games with the skills in [`.agents/`](https://github.com/journey-to-code-org/open.games/tree/main/.agents). They are plain Markdown in the `SKILL.md` format, so any agent that reads `AGENTS.md` or skills can use them, and a person can read them too.

[`AGENTS.md`](https://github.com/journey-to-code-org/open.games/blob/main/AGENTS.md) at the root is the short version for anyone working in the repository.

| Skill | Use it to |
| --- | --- |
| `games-use` | Play a game from code: find it, set its rules, deal, apply moves, ask a bot, read a view. |
| `games-add` | Add a card game, a board game, a table sport or a field game to the kit, with the tests the kit expects. |
| `games-maintain` | Work on this repository: tests, the determinism rules, the physics version, the docs, and releasing. |

## Rules every skill repeats

- **A game is pure and deterministic.** No `Math.random`, no `Date`, no clock: randomness comes from the seed (`nextRandom(state)`) and time from `MoveTime`.
- **`apply` never changes the state it is given.** It returns a new one, or throws a `GameError`.
- **A view holds only what that seat may see.** `summary` is public.
- **Physics keeps to exact operations only.** See [the packages](packages.md#physics).

## Editing these docs

The docs are Markdown in `docs/`, read on GitHub or on the site, and built with [open.blog](https://github.com/journey-to-code-org/open.blog). Write a link to another page as its file (`[the games](games.md)`) so it works in both places. `games.md` is written from the built package; when games are added, regenerate it from `KIT_GAMES`.

To preview locally you need Rust and a checkout of open.blog (the build uses its themes):

```sh
git clone https://github.com/journey-to-code-org/open.blog .open.blog   # once; ignored by git
cargo build --release --manifest-path .open.blog/Cargo.toml -p openblog-cli
node scripts/build-docs-site.mjs                                      # copies docs/ into the site
.open.blog/target/release/openblog serve --root docs-site
```

Then open <http://localhost:8080/docs/>. `docs-pages.yml` builds the same way, pinned to one open.blog commit (the `OPENBLOG_REF` in that file), and publishes on every push to `main` that changes `docs/`.
