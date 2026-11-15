---
order: 1
---

# Getting started

Play a whole game from code: no screen, no server.

## Install

```sh
npm install @journey-to-code/games @journey-to-code/rules
```

Node 22.12 or later. `@journey-to-code/rules` holds the computer players' personas and the seeded random source every game shares.

## Play a game

```ts
import { kitGame, GameError } from "@journey-to-code/games";
import { personaFor, mulberry32 } from "@journey-to-code/rules";

const game = kitGame("gofish")!;                   // any id from the list of games
const rules = game.normalize(undefined);           // anything missing comes from the first preset
const seats = game.seats.default;
let state = game.newGame(rules, seats, 1234);      // the same seed always deals the same game

const rand = mulberry32(99);                       // a seeded source, so a bot's choices replay too
const style = personaFor("Dot").style;             // how skilled and careless this player is

while (!game.summary(state).over) {
  let moved = false;
  for (let seat = 0; seat < seats; seat++) {
    const move = game.bot(state, seat, style, rand); // null when it isn't this seat's move
    if (move) { state = game.apply(state, seat, move); moved = true; break; }
  }
  if (!moved) break;
}

console.log(game.summary(state).scoreLine);
```

Nothing here keeps time, shuffles with `Math.random` or touches the state it was given: `apply` returns a new state. A move that is not allowed throws a `GameError`, whose message is written for a player ("It's not your turn.").

## What a seat sees

```ts
const view = game.view(state, 0); // only what seat 0 may see
```

The view is the one part that differs between kinds of game: a card game's is a `KitView` (hands, tricks, piles), a board game's is a `BoardView` (grids of cells and pieces), a table sport's is a `SportView` (a physics world and whose shot it is). A view never holds another seat's hidden cards, so it is safe to send to that seat's browser as it is. See [the game contract](game-contract.md).

## Check it works

- `game.summary(state).over` becomes true, and `winners` says who won.
- The same seed and the same moves give a deep-equal state on a second run.
- `game.apply(state, seat, nonsense)` throws a `GameError` and leaves `state` unchanged.

## Next

- Pick a game and its rules: [the games](games.md).
- Put tables on a server: [open.rooms](https://github.com/journey-to-code-org/open.rooms) takes a `TableGame` straight into a room.
- Write your own: [adding a game](adding-a-game.md).
