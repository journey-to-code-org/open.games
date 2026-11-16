---
order: 6
---

# Arcade games

The arcade kit is for games of reflexes, played in real time by one pilot or several at once: a shoot-'em-up, a tower defence, an idle clicker, a drag race. They are `ArcadeGame`s (`packages/games/src/arcade.ts`), and they sit beside the `TableGame`s, in `ARCADE_GAMES`. They are not in `KIT_GAMES`: a room that takes turns cannot run them.

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

## Chip Stack

The third: an idle clicker against the clock, for one to four players (`packages/games/src/chipstack.ts`, `chipstack` in code). Tap the chip, buy earners that bring chips in by themselves (each costs 15% more than the last), boost them, and see how many chips the run earned when the time is up. Fast tapping builds heat; a golden chip turns up now and then for a frenzy or a windfall; cashing out sells everything for stars worth a tenth more each. Presets: Classic (8 minutes), Sprint (3), Marathon (20) and Purist (no golden chips, no heat).

Its input is a command carried out once, like Tower of Ryan's: `{ n, cmd, item }`, where `cmd` is `tap`, `buy`, `boost`, `power`, `catch`, `cashout` or `none`. The bank is kept in sixtieths of a chip, so "chips a second" is a whole number of sixtieths a tick and nothing is rounded.

A game with things to buy that are not built anywhere adds `market` to its view (an `ArcadeMarket`): the `bank`, what comes in `perSecond` and `perTap`, the `items` on offer (each with a `key`, a `group`, a cost and whether the bank covers it), the `ticksLeft` and a row of `badges` for what is running. `shortly(n)` writes a big number short: 12.4K, 3.21M.

## Road to the Shootout

The fourth, `pinkslips` in code (its first name, kept the same way), and the first where the seats are against each other: a drag race for one to four cars (`packages/games/src/pinkslips.ts`). What a seat races is what it built. Presets: Strip night (a quarter mile, three ambers half a second apart), Eighth mile, Pro tree (all three ambers at once), Flashlight drags (no lights, a flashlight that drops when it drops, and a fifth less grip), Roll race and Index 15.00.

- **A roll race** (`tree: "roll"`) starts side by side at `roll` miles an hour, each car in a gear that suits the speed. Nobody can leave early, there is no launch, and the distance is measured from where the signal came. Neutral on the shifter means "leave it where it is".
- **Index racing** (`index`, in hundredths of a second, 0 for none) is a race to a time. Run quicker than the index and you have broken out, and a breakout loses to any clean run. Between two breakouts, whoever broke out by less wins.

An input is held controls, like Shitstorm's: `{ gas, gear, stage, build }`. `gas` is the throttle, 0 to 100. `gear` is the gear asked for, 0 for neutral; in an automatic anything above neutral is drive. `stage: true` rolls the seat up to the line with `build`, and once staged a seat stays staged with that car. A seat that has not staged in twenty seconds is rolled up in a tired econobox.

A run is won or lost in three places:

- **The light.** A car that moves before the green has red-lit and loses, whatever it runs. Until the tree starts the car is held on the line, so the revs can be brought up in neutral.
- **The launch.** First gear on the green. Too few revs and it bogs. More push than the tyres will take and they spin, and a spinning tyre puts down less.
- **The shifts.** A change takes time with nothing driving the car. Past the redline the engine gets hot, and hot enough it lets go: the car coasts to a stop and goes home needing a rebuild.

First to the line with a clean run wins, so a slower car that leaves well can beat a quicker one that sleeps at the light. Times to the line are kept in millionths of a second, so two cars that cross in the same tick are still split. A score is sixty thousand less a point for each thousandth of a second from the green to the line, and nothing for a red light or a car that never got there. `pinkSlipsResults(state)` is each seat's run for whoever settles up: place, reaction, time, speed at the line, and what the run cost the engine and the tyres.

A game that is a race in lanes adds `race` to its view (an `ArcadeRace`): the `phase`, the `tree` (which ambers are lit, and whether it is green), and each lane's dashboard: revs and redline, gear, speed, boost, how hot the engine is, whether the tyres are spinning, and its reaction, time and place once it has them.

Everyone holds the whole state in a lockstep room, and that includes the tick an arm will drop. Where money or a car is riding on a race, run it where the players cannot look: the server steps the game and sends out views.

### The cars

`pinkslipscars.ts` has every model, the parts, and the drivetrain. A car at the line is a `Build`: fourteen whole numbers (`[model, intake, exhaust, cam, boost, tyres, weight, trans, final, engine, rubber, oil, fuel, plugs]`), where the parts are levels from 0, `final` is a taller, stock or shorter final drive, and `engine`, `rubber`, `oil` and `plugs` are how good each is in thousandths. `fuel` is where the mixture is set, from 0 to `FUEL_MAX`. A build that stops after `rubber` is a car with fresh oil, new plugs and the fuel set right. `safeBuild` makes one out of anything, `specOf(build)` works out the car (mass, torque curve, gearing, grip), `driveCar` moves it one tick, and `timeslip(build)` is what it runs when it is driven well.

`CAR_MODELS` is twelve cars of our own, from about 1990, in three tiers: five shitboxes (an econobox, a teacher's sedan, a wagon, a mini pickup, a minivan), four sleepers, and three that everybody wants. Front, rear and all-wheel drive put different shares of the car's weight on the driven tyres, which is why the all-wheel-drive turbo leaves hardest. A turbo takes time to spool and sighs on every shift.

Two things kill an engine besides the redline, and both show on a gauge (`oil` and `afr` in a lane's or a driver's dashboard):

- **Oil pressure.** `oilPressure(spec, rpm)` rises with the revs and is lower for old oil and a worn engine. An engine wants about a pound for every 140 revs (`oilStarved(psi, rpm)` says when it has less). With less than that it heats up and does not cool, so a tired engine on old oil has to be shifted early or it lets go.
- **The mixture.** Every part that helps an engine breathe (intake, exhaust, cam, boost) makes it want more fuel: `idealFuel(build)` is what it wants. Set `fuel` below that and it is lean: 1.5% more torque a step, and heat that builds whenever it is worked hard past its torque peak. Set it above and it is rich: 3% less torque a step, and plugs that foul. Fouled plugs cost up to a fifth of the torque.

### The garage

`pinkslipsgarage.ts` is one player's money and cars: plain data, whole numbers, no clock. It is not an `ArcadeGame`; it is what a race's builds come from and what its results go back to.

```ts
import { newGarage, garageAct, garageView, buildOf, afterRace, pinkSlips, pinkSlipsResults } from "@journey-to-code/games";

const garage = newGarage(seed);                                  // $1,200 and today's classifieds
garageAct(garage, { cmd: "buy", listing: garage.listings[0].id });
garageAct(garage, { cmd: "fit", car: garage.cars[0].id, slot: "exhaust", level: 1 });
const build = buildOf(garage.cars[0]);                           // what the race wants
// ...the race is run...
afterRace(garage, garage.cars[0].id, pinkSlipsResults(state)[seat]);
```

- `garageAct(garage, command)` carries out a command or says why not (`{ ok, message }`): `buy`, `sell`, `tool`, `fit`, `engine` (a rebuild), `tyres`, `oil`, `plugs`, `fuel`, `body`, `scrap`, `salvage`, `final` and `name`.
- **Tools.** A garage starts with none (`TOOLS`: a floor jack, a wrench set, a body hammer), and a job needs its tool: the jack for tyres, the wrenches for parts, oil, plugs and rebuilds, the hammer for bodywork. A garage saved before there were tools is given all three.
- **The tune.** Fitting a part that helps the engine breathe leaves the fuel where it was, which is now lean. `fuel` sets it, for nothing and with no tool. `dyno` sets it right for `DYNO_COST`, and `remote` for `REMOTE_TUNE_COST`: the second is for when a Remote tune run came back `tuned`, which is the caller's to check. The view gives the air-fuel ratio and whether it is lean, right or rich.
- **Bodywork.** `afterRace` takes a `damage` as well as the wear. A car bent to `UNDRIVABLE` (300) stays home until `body` straightens it. At `TOTALED` (1000) nothing straightens it: `scrap` gives an eighth of the model's worth, and `salvage` pulls the parts first for half of what they cost.
- **Sellers.** A listing's engine and tyres are the seller's word for them. Three in ten are describing a better engine than the one in the car, and you find out when it is in your garage.
- **Rix Racing.** `garage.rix` is six used parts, changed with the day, each for one tier of car and for 45% to 65% of new. `fit` with `rix: id` fits one. The view marks a part's next level with the Rix price when the shelf has it.
- `newDay(garage, day)` brings new classifieds and a new shelf at Rix when the day is later than the garage knew. Seven listings in ten are shitboxes. The cars everybody wants turn up about one time in twenty-five, and only ever with a blown or nearly blown engine: the way to a good one is to build it or to win it.
- `garageView(garage)` is what the player sees: each car's spec sheet (with the quarter mile it would run), what it is worth, what each repair and the next level of each part costs, and the classifieds.
- `settleUp(garage, amount)`, `takeCar(garage, id)` and `giveCar(garage, car)` are for what passes between players: a wager, and a pink slip. The engine does not know who the other players are. Whoever runs the game joins two garages up, and a car won arrives exactly as it left, parts and wear and all.
- `loadGarage(saved)` checks a garage from storage piece by piece, and is null when it is not one.

### The Mountain Road

The other half of Road to the Shootout (`packages/games/src/mountainroad.ts`, `mountainRoad`): a run down a two-lane road in the same cars, with the same drivetrain, for one driver or two on the same road. It is an `ArcadeGame` like the rest, but it is **not in `ARCADE_GAMES`**: it is reached from the garage with a car, not from a list of games, so import it by name. Presets: Sunday drive, The run, Rush hour, Heat and Remote tune.

An input is `{ gas, brake, steer, gear, stage, build }`. `steer` is -100 (toward the drop) to 100 (toward the rock face). The rest are the drag race's.

- **Bends.** Each piece of road has a curve. A car at speed is pushed to the outside of it by the square of its speed, and steering pushes back with as much as the tyres will take and no more. Too fast for the bend and no amount of wheel holds it.
- **Traffic.** Slow cars on your side and cars coming the other way on theirs, laid down from the seed as the drivers come to them. They look where they are going: one coming at a driver in its lane brakes and takes to its verge, and one behind a slower driver waits. Hitting one costs damage by how fast you closed on it.
- **The law.** Patrol cars sit at places the seed chose, parked on the verge by the rock. Hit one and the run is over: `arrested`, and $1,000. A driver's `radar` goes from 0 to 3 as one comes near. Pass it at more than ten over the limit and it comes after you. Stop on your own side of the road and it is a ticket: $150 and twenty seconds. Stay ahead by 550 metres, or for 45 seconds, and it gives up. Let it sit on your bumper for eight seconds and you are run down: $400 and 45 seconds.
- **Deer.** `deer` to a leg stand on a verge. When a car at speed is within 110 metres, one crosses. Hitting it costs damage by your speed.
- **Pulls.** Five seconds with the throttle on the floor, in gear, without lifting, is a pull (`PULL_TICKS`). A driver's `pulls` and `pull` (thousandths of the way through the next) are in the view, and a result is `tuned` after three (`PULLS_FOR_A_TUNE`). The Remote tune preset is an empty road at night with six deer on it: a tuner on a laptop wants those three pulls.
- **Gas stations.** The road is in legs. At the end of each the car is stopped and filled, the clock waits, and the leg's time is kept. A tank lasts a little over two minutes flat out. Run dry and the run is over when the car stops rolling.
- **Damage.** In thousandths. It takes power off the car, and past 400 the car pulls to one side. At 1000 it is a wreck. The rock face scrapes; the drop ends the run at once.

First to the end wins, with tickets added to the clock. `mountainRoadResults(state)` is each driver's run for whoever settles up: how it ended (`finished`, `wrecked`, `edge`, `fuel`, `arrested`), the time, each leg, the fines, the damage, and the wear for `afterRace`.

A game that is a drive down a road adds `road` to its view (an `ArcadeRoad`): the road in pieces (where each starts, its curve and its grade), the stations, where the rock and the drop are, each driver's place on the road and dashboard (speed, revs, gear, fuel, damage, radar, the patrol car behind, the clock), the traffic, and the patrol cars that can be seen. A parked patrol car is in the view only from 180 metres.

## Adding one

1. Write `packages/games/src/<game>.ts` as an `ArcadeGame<Rules, State, Input>`, starting from `skyfire.ts`.
2. Add its id to `ArcadeGameId` in `arcade.ts`, add it to `ARCADE_GAMES` in `registry.ts`, and export it from `index.ts`.
3. Write `packages/games/test/<game>.test.ts` for its own rules. `test/arcade.test.ts` already flies every registered arcade game: computer pilots play every preset at every crew size, the same seed and inputs give the same state, a log replays to the same score, a stored game carries on exactly, every number is whole, an untouched game ends, and junk controls change nothing they should not.
