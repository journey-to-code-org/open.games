# open.games

A reusable game engine and kit for card, board, table-sport and arcade games, with computer players.

- `packages/games`: the `TableGame` contract, the card, board and table-sport kits, and 55 games; and the `ArcadeGame` contract for games in real time, with its games: Shitstorm, Tower of Ryan and Chip Stack.
- `packages/rules` (spades, personas, the seeded random source), `packages/palace`, `packages/physics`, `packages/decks`.
- `docs/`: the documentation, published at https://journey-to-code-org.github.io/open.games/.
- `.agents/skills/`: `games-use`, `games-add`, `games-maintain`.

Commands: `npm run build` (the packages import each other's built output), `npm run typecheck`, `npm test` (Node 22.12 or later). All must pass before a change is done.

Rules: a game is pure and deterministic (no `Math.random`, `Date` or clock); `apply` never changes the state it is given; a view holds only what its seat may see; physics uses only exact operations. An arcade game is the one exception to the second: its `step` changes the state it is given (see `docs/arcade-games.md`), and keeps every number in its state whole. `games-maintain` has the rest, including releasing.
