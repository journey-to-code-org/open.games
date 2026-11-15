# open.games

Reusable game engine and kit for card, board and table-sport games, with computer players.

open.games is the core of [open.parlor](https://github.com/journey-to-code-org/open.parlor), taken
out so it can be used on its own. It has no framework and no server in it: a game is a set of pure
functions over plain data, so it runs the same in a browser, on a server or in a worker thread.
Multiplayer rooms, lobbies and tournaments live in
[open.rooms](https://github.com/journey-to-code-org/open.rooms).

## Packages

| Package | What it is |
| --- | --- |
| [`@journey-to-code/games`](packages/games) | The game contract (`TableGame`), the card, board and table-sport kits, and the games built on them |
| [`@journey-to-code/rules`](packages/rules) | Spades: rules, scoring and bots, plus the computer players' personas and the seeded random source every game shares |
| [`@journey-to-code/palace`](packages/palace) | Palace (Shithead): rules and bots |
| [`@journey-to-code/physics`](packages/physics) | Deterministic 2D physics for the table sports, the same to the last bit on every JavaScript engine |
| [`@journey-to-code/decks`](packages/decks) | Card deck designs: faces, backs and the data a custom deck is made of |

Nothing is published to npm yet.

## Guides

- [Adding a game](docs/adding-a-game.md): the `TableGame` contract, and how a card game, a board game and a table sport are each built on it.
- [Clocks and deadlines](docs/clocks-and-deadlines.md): turn timers, a game's own clock, and how they replay.

## Working on it

Node 22.12 or later.

```sh
npm install
npm run build      # the packages import each other's built output
npm run typecheck
npm test
```

## History

The packages were moved here from open.parlor (formerly Card Room) with their history: `git log`
and `git blame` go back to their first commits. They were renamed from `@spades/rules` and
`@cardroom/*` when they moved.
