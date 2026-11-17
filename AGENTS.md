# open.games

A reusable game engine and kit for card, board, table-sport and arcade games, with computer players.

- `packages/games`: the `TableGame` contract, the card, board, word and table-sport kits, and 70 games (the word games play with the word list in `words.ts`, whose data `scripts/build-words.mjs` writes: see `packages/games/words/README.md`); and the `ArcadeGame` contract for games in real time, with its games: Shitstorm, Tower of Ryan, Chip Stack, Road to the Shootout (a drag race, with its cars and garage in `pinkslipscars.ts` and `pinkslipsgarage.ts`, and The Mountain Road, its drive down a road, which is exported but kept out of the catalogue), Air Hockey and Zubra Quest (an adventure seen from above, whose land `zubraquestworld.ts` makes from the seed); and the `IdleGame` contract for games that carry on while nobody is looking, with Delbie's Daycare & Geriatrics.
- `packages/rules` (spades, personas, the seeded random source), `packages/palace`, `packages/physics`, `packages/decks`.
- `docs/`: the documentation, published at https://journey-to-code-org.github.io/open.games/.
- `.agents/skills/`: `games-use`, `games-add`, `games-maintain`.

Commands: `npm run build` (the packages import each other's built output), `npm run typecheck`, `npm test` (Node 22.12 or later). All must pass before a change is done.

Rules: a game is pure and deterministic (no `Math.random`, `Date` or clock); `apply` never changes the state it is given; a view holds only what its seat may see; physics uses only exact operations. An arcade game is the one exception to the second: its `step` changes the state it is given (see `docs/arcade-games.md`), and keeps every number in its state whole. An idle game is handed the time (see `docs/idle-games.md`): `advance` must leave the same state whether seconds are played one at a time or all at once. `games-maintain` has the rest, including releasing.
