---
order: 2
---

# The packages

Five packages, one repository. Each is published on its own and has its own version. They import each other's built output, so `npm run build` comes before anything else.

## games

`@journey-to-code/games`: the game contract (`TableGame`), the card (`CardGame`), board (`BoardGame`) and table-sport (`SportGame`) kits, and the games built on them: [55 of them](games.md). `kitGame(id)` finds one, and `KIT_GAMES`, `CARD_GAMES`, `BOARD_GAMES` and `SPORT_GAMES` list them. `isKitGame`, `isCardGame`, `isBoardGame` and `isSportGame` check an id.

The [arcade kit](arcade-games.md) is here too: `ArcadeGame`, for games played in real time, with `recorder`, `replay` and `verifyScore` for logs of a run. `ARCADE_GAMES` lists them (one so far, Skyfire), `arcadeGame(id)` finds one and `isArcadeGame` checks an id. `ALL_GAMES` is every game on either, as a picker needs them, and `gamesIn(category)` is one shelf of it.

Also here: `offers.ts` (resigning, draw offers and taking a move back, built once for any two-sided game to opt into), and the computer players' table talk for the other games.

## rules (spades)

`@journey-to-code/rules`: a spades rules engine driven by rule presets, plus things every game shares.

```ts
import { newGame, applyAction, viewFor, brokennilsTable } from "@journey-to-code/rules";

let game = newGame(brokennilsTable, seed);
game = applyAction(game, { type: "bid", seat: game.turn, bid: { kind: "blind-nil" } });
const whatSeat2Sees = viewFor(game, 2); // other hands are hidden
```

- Every house rule is a field on a `RulePreset`. Built in: `classic`, `jokersAndDeuces`, `quick250`, and `brokennilsTable` (Classic with blind nil on). The preset is copied onto the game, so editing a saved preset never changes a game in progress.
- `applyAction` throws `RuleError` with a message for the player for anything illegal. Shuffles are seeded, so any game can be replayed from its seed and action log.
- **Bots:** `botAction` (quick rules of thumb) and `smartAction` (the thinking bot: from what its seat can see, it deals out the cards it cannot see many ways that fit the bids and the play, plays each option to the end of the hand, and picks the best for its team).
- **Personas and table talk** (`talk.ts`): `PERSONAS`, `pickPersonas(n, rand, exclude)` and `personaFor(name)`. A persona has a voice, lines, a pace and a `style` (`skill`, `sloppy`, `bold`, `nilLove`) that every game's `bot` takes.
- **The seeded random source** `mulberry32(seed)` that every game shares.

## palace

`@journey-to-code/palace`: Palace (Shithead / Castle): rules and bots, with house rules as presets (`familyPalace`, `classicPalace`, `quickPalace`). `newPalace(rules, seats, seed)`, `applyPalace(state, action)` (throws `PalaceError`), `viewPalace(state, seat)`, `options(state, seat)`, plus `normalizePalaceRules`, `validatePalaceRules` and `describePalace`. Two to six seats.

## physics

`@journey-to-code/physics`: a small deterministic 2D physics core for turn-based ball games (mini golf, bowling). No dependencies. A move is a shot `{ body, angle, power }` in whole numbers; the server plays the shot to rest, every browser plays the same shot from the same table to animate it, and a restarted room replays its shots. That only works if **the same world and shot give bit-identical results on every JavaScript engine**, so the package keeps to a strict rule:

- It may use `+ - * /`, comparisons, `Math.sqrt`, `Math.abs` and `Math.round`.
- It may not use `Math.sin`, `cos`, `tan`, `atan2`, `pow`, `exp`, `log`, `hypot`, the `**` operator, `Math.random`, `Date` or `performance`. Engines may approximate them differently in the last digit. Angles are whole hundredths of a degree, turned into a direction by a fixed polynomial (`direction(angle)`).
- The step is fixed by the world (`tickRate`), and bodies, walls, pockets, tunnels and regions are visited in the order the world lists them.
- **`PHYSICS_VERSION`** must be raised by any change that could move where something comes to rest. Recorded shots are compared exactly in the tests, and the source is scanned for forbidden functions.

`simulate(world, shot)` plays a shot to rest, `start`, `step` and `result` run it a step at a time, `frames` is a generator of frames for animating it, and `validateWorld` lists what is wrong with a world in plain words. A world is plain data: bounds, friction, bodies (discs), walls, pockets, regions and tunnels. The package's own README has the full list.

## decks

`@journey-to-code/decks`: what a deck of cards looks like, as plain data (a back pattern, paper, inks, lettering, corners), never CSS or markup from a page, so one person's design is safe to show to everyone. `normalizeDesign` and `validateDesign` check a design (inks must keep a minimum contrast, `MIN_INK_CONTRAST`), `deckVars(design)` turns it into the CSS variables a `<playing-card>` reads, `CLASSIC` and `STARTERS` are the ready-made ones, and `savedDeck`, `saveDeck`, `prefersOwnDeck`, `setPrefersOwnDeck` and `deckAtTable` keep and choose a deck in the browser's storage.
