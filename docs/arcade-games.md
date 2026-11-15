---
order: 6
---

# Arcade games

The arcade kit is for games of reflexes, played in real time against the game itself by one pilot or several at once: a shoot-'em-up, a tower defence, an idle clicker. They are `ArcadeGame`s (`packages/games/src/arcade.ts`), and they sit beside the `TableGame`s, in `ARCADE_GAMES`. They are not in `KIT_GAMES`: a room that takes turns cannot run them.

## A tick where a table game has a move

A `TableGame` waits for a seat to move. An arcade game has a clock: it runs `rate` ticks a second, and each tick the engine is handed what every seat's controls are doing and moves the whole world on one step.

```ts
import { skyfire } from "@journey-to-code/games";

const state = skyfire.newGame(skyfire.normalize(null), 2, seed);   // two pilots
skyfire.step(state, [{ dx: 72, dy: 0, fire: true, bomb: false }, skyfire.idle]);
const view = skyfire.view(state);   // what everyone sees
```

| Member | Is |
| --- | --- |
| `id`, `name`, `emoji`, `category`, `blurb`, `tagline`, `seats`, `presets`, `fields`, `normalize`, `validate`, `describe` | As on a `TableGame`. `teams` is always `false`: everyone on the field is on the same side. |
| `controls` | How to play, a line per control, for a setup screen. |
| `rate` | Ticks a second. |
| `newGame(rules, seats, seed)` | A deterministic start. |
| `idle` | The controls at rest. |
| `input(given)` | Controls from outside (a browser, a room, a log), made safe: whatever is given, what comes back is an input `step` will take. |
| `step(state, inputs)` | One tick. **Changes the state it is given**, and does nothing once the game is over. |
| `view(state)` | An `ArcadeView`. Nothing is hidden: every seat sees the same one. |
| `bot(state, seat, style, rand?)` | A computer pilot's controls for this tick. |
| `summary(state)` | `over`, `score` (what a leaderboard ranks by), each seat's `scores`, `scoreLine`, `order`, `ticks`. |

`step` changing its state is the one place the arcade kit parts from the rest. A world of hundreds of bullets is stepped sixty times a second, and copying it every time would cost more than the game. `snapshot(state)` keeps a copy from before.

## Still deterministic, and why it matters more here

The same rules, seats, seed and inputs give the same game to the bit, on every machine. Three things are built on that:

- **A score can be checked.** `recorder(game, seats)` writes an `ArcadeLog` as a game is played: every time a seat's controls changed, and on which tick. Controls stay as they are until they change, so a log is short. `replay(game, rules, seats, seed, log)` plays it again, and `verifyScore(…, claimed)` says whether a claimed score is what the log earns. A leaderboard can refuse a score that was not played.
- **People can play together live.** A room hands every browser the same inputs for the same tick (lockstep). Each one steps its own copy of the game, and they cannot drift apart.
- **A game can be watched, or shown again later,** from its seed and its log alone.

So an engine's step keeps to these:

- **Whole numbers** for everything that feeds back into the game: positions, speeds, timers, health. `test/arcade.test.ts` walks every state and fails on a number that is not whole.
- **Randomness from `nextRandom(state)`**, never `Math.random`. No `Date`, no clock.
- **Exact operations only.** Addition, multiplication, division, `Math.sqrt` and `Math.round` are exactly specified. `Math.sin`, `Math.cos` and `Math.atan2` are not: use `direction(angle)` from `@journey-to-code/physics` for a whole-number angle, and `toward(fromX, fromY, toX, toY, length)` to aim.
- **Plain data.** A state survives `JSON.stringify`, so it has no `Infinity`, no `-0`, no `undefined` that matters.
- **`input` trusts nothing.** A step is only ever handed what `input` returned.

A bot is not part of the step. Its answer is an input like anyone's, so it may use floating point and `Math.random` freely.

## What everyone sees

An `ArcadeView` is one shape for every arcade game, the way a `KitView` is for cards: a `field`, the `things` on it (each a circle with an `id`, a `kind` such as `"ship"`, `"bullet"` or `"foe:drone"`, a `tone`, and sometimes a smaller `core` that is the part that can be hit, a `health`, an `angle`, a `seat`), every pilot's numbers (`score`, `lives`, and a row of named `stats`), the crew's `score`, the `stage`, a `boss` bar, a `banner`, and the `events` of this tick ("boom", "graze", "medal") for sounds and flashes. A view says what things are and where. It never says a colour value or a pixel: one screen draws every arcade game and decides what a `"foe:drone"` looks like.

`events` last one tick. A screen that steps several ticks before it draws collects them after each step.

## Shitstorm

The first arcade game, `skyfire` in code (its first name, which its id, file and exports keep): a shoot-'em-up for one to four pilots (`packages/games/src/skyfire.ts`). Waves come down a field 6000 units wide and 8000 tall, a boss every fifth, harder every wave, with no end. The score is what you play for: kills in a chain raise a multiplier up to ×16; grazing a bullet scores and keeps the chain alive; each medal picked up is worth more than the last until one is dropped; a wave with nothing left and nothing escaped pays a bonus. An input is `{ dx, dy, fire, bomb }`: how far to move this tick (up to `SKYFIRE_SPEED`), whether the guns are firing, and a bomb on the tick `bomb` turns true. Presets: Arcade, Cadet, Ace and One ship.

## Tower of Ryan

The second, `bulwark` in code (its first name, kept the same way): a tower defence for one to four players (`packages/games/src/bulwark.ts`). A road winds down a grid of 12 by 16 cells, a different one for every seed. Waves walk it on a clock, tougher each time, with a boss every tenth, and whatever reaches the bottom costs a life. Five towers (Dart, Mortar, Frost, Tesla, Sniper), each with two upgrades, are built beside the road from one bank that everyone shares. Sending the next wave early pays gold and points; gold left in the bank earns interest. Presets: Standard, Gentle, Grim and Last gate.

Its input is a command, not a held control: `{ n, cmd, col, row, kind }`, where `cmd` is `build`, `upgrade`, `sell`, `send` or `none`. **A command is carried out on the tick its `n` is first seen, and not again**, so an input can be held, logged and replayed like any other without building anything twice. Give each command a new `n` (one more than the last will do). This is the pattern for any arcade game whose seats give orders instead of steering.

A game that builds on a grid adds `build` to its view (an `ArcadeBuild`): the grid, the `road` as points, the cells that are `closed`, the `bank` and `lives`, the `shop`, what is `built` (with each one's upgrade cost and sale value), and the wave that is `next` (when it comes, what sending it now pays, and what is in it). Shots are events with a `to`: where they went.

## Adding one

1. Write `packages/games/src/<game>.ts` as an `ArcadeGame<Rules, State, Input>`, starting from `skyfire.ts`.
2. Add its id to `ArcadeGameId` in `arcade.ts`, add it to `ARCADE_GAMES` in `registry.ts`, and export it from `index.ts`.
3. Write `packages/games/test/<game>.test.ts` for its own rules. `test/arcade.test.ts` already flies every registered arcade game: computer pilots play every preset at every crew size, the same seed and inputs give the same state, a log replays to the same score, a stored game carries on exactly, every number is whole, an untouched game ends, and junk controls change nothing they should not.
