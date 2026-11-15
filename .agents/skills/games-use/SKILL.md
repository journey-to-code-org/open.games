---
name: games-use
description: Play or embed a game from open.games in code. Use when finding a game by id, choosing or editing its rules, dealing, applying moves, asking a computer player for a move, reading a seat's view, or running a game headless in a test or a worker.
---

Every game is a `TableGame`: pure functions over plain data. `@journey-to-code/games` has 55; `@journey-to-code/rules` supplies the personas and the seeded random source.

## Ask first

- Which game, and for how many seats? The list is in `docs/games.md`, or `KIT_GAMES` in code.
- Is it for a screen (it needs `view`), a server (open.rooms takes a `TableGame` as it is), or a test (headless, bots against bots)?
- Spades and Palace are not on the kit; they have `@journey-to-code/rules` and `@journey-to-code/palace` with their own functions.

## Steps

1. `npm install @journey-to-code/games @journey-to-code/rules` (Node 22.12 or later).
2. Play:

   ```ts
   import { kitGame, GameError } from "@journey-to-code/games";
   import { personaFor, mulberry32 } from "@journey-to-code/rules";

   const game = kitGame("gofish")!;
   const rules = game.normalize(undefined);        // first preset; or a saved rule set, or a preset from game.presets
   const seats = game.seats.default;
   let state = game.newGame(rules, seats, seed);   // same seed, same deal
   const move = game.bot(state, seat, personaFor("Dot").style, mulberry32(7)); // null when it isn't that seat's move
   if (move) state = game.apply(state, seat, move); // returns a NEW state; throws GameError if illegal
   const view = game.view(state, seat);             // only what that seat may see
   const over = game.summary(state).over;
   ```

3. Check: the game reaches `summary(state).over`; a second run with the same seed and the same moves gives a deep-equal state.

## Rules

- **Pass your own seeded random to `bot`.** Its default is `Math.random`, which is fine for play and wrong for a test or a replay.
- **Never mutate a state.** `apply` returns a new one; keep the old one if you need to compare.
- **Catch `GameError`, and show its message as it is.** It is written for the player.
- **Send each seat only its own `view`.** Never send the state itself, or `summary` to anyone it is not meant for (it is public, so it is fine for lobbies).
- **`bot` returns `null` when it has nothing to do.** In a game where everyone moves at once or a bot answers an offer, loop over seats as the example does.
- **A slow think:** if `game.heavy?.(state, seat)` is true, run `bot` off the main thread.
- **A game's own clock** is `game.deadline?.(state)`: if it returns `{ after, seat, move }`, make `move` as `seat` when `after` ms pass since the last move. Pass `{ elapsed }` as the fourth argument to `apply` for a game that keeps time in its state.

## Reference

`docs/getting-started.md`, `docs/game-contract.md`, `docs/games.md`, `docs/clocks-and-deadlines.md`.
