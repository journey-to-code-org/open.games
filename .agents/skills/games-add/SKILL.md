---
name: games-add
description: Add a new game to open.games. Use when writing a card game, board game or table sport engine, registering it, giving it rules presets and a computer player, or making it pass the shared kit tests.
---

Most games belong on the kit, which gives them a table, setup, house rules, computer players, rooms, challenges and tournaments for free. Read `docs/adding-a-game.md` first: it is long, and it has a worked example for each kind.

## Ask first

- Cards, a board, or a ball struck across a table? That decides the type: `CardGame`, `BoardGame` or `SportGame`. The only thing that differs between them is what `view` returns.
- How many seats, and are there partners? Are there hidden hands or boards (then views need care)?
- Does the bot search or simulate? If its think is more than a millisecond or two, add `heavy`.

## Steps

1. Write `packages/games/src/<game>.ts`: its `category` (the shelf it sits on in a picker), rules presets and `fields`, `newGame` (deterministic from the seed), `apply`, `view`, `bot`, `thinkingTime`, `summary`. Start from a worked example: Go Fish, Golf or Whist (cards); `tictactoe.ts` (boards), with `dropfour.ts`, `combat.ts`, `checkers.ts`, `go.ts`, `chess.ts`, `backgammon.ts` and `yacht.ts` for what it does not cover; `minigolf.ts` (sports).
2. Register it: add its id to `CardGameId`, `BoardGameId` or `SportGameId` in `table.ts`, add it to `CARD_GAMES`, `BOARD_GAMES` or `SPORT_GAMES` in `registry.ts`, and export it from `index.ts`.
3. Write `packages/games/test/<game>.test.ts` for its own rules.
4. Run `npm run build`, `npm run typecheck`, `npm test`. The shared tests (`test/kit.test.ts`, `board.test.ts`, `sport.test.ts`) play every registered game of that kind: bots finish whole games with every preset at every table size, the same seed deals the same game, views match the state, and refused moves change nothing.
5. Regenerate `docs/games.md` from `KIT_GAMES` (it is written from the built package).

## Rules

- **Deterministic and pure.** Randomness comes from `nextRandom(state)` (position kept in the state), time from `MoveTime`. Never `Math.random`, `Date` or the clock in `newGame`, `apply`, `view` or `deadline`. A bot may use the `rand` it is handed.
- **`apply` never changes the state it is given** (`clone` is a `structuredClone`) and throws `GameError` for a move the rules do not allow, with words for the player.
- **No secrets in a view or in `summary`.** Test it: move the hidden pieces about and check the view does not change by a character (Combat's tests do this).
- **A view offers exactly the legal moves.** The table offers nothing else, and `apply` still refuses the rest.
- **A bot decides from what its seat can see**, and whether it has a move must not depend on the style.
- **A think that uses its `budget` must keep to it.** A think far past it is abandoned, and the seat is asked again with `QUICK_STYLE` and `QUICK_BUDGET`, which must answer at once.
- **A two-sided board game gets resigning, draws and take-backs** by wrapping itself with `withOffers`.
- **A table sport's moves are whole numbers** (`angle` in hundredths of a degree, `power` 0 to 1000), and only `@journey-to-code/physics`' exact operations may run in a shot.

## Reference

`docs/adding-a-game.md`, `docs/game-contract.md`, `docs/clocks-and-deadlines.md`.
