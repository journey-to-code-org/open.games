---
order: 7
---

# Idle games

The idle kit is for games that carry on while nobody is looking: a shop that sells while you are away and tells you what happened when you come back. They are `IdleGame`s (`packages/games/src/idle.ts`), listed in `IDLE_GAMES`. One player each; no room and no table.

## The clock on the wall

An arcade game is driven by ticks and is over in minutes. An idle game is driven by the time of day and is never over. Its state remembers the second it was last brought up to date, and everything else follows from one rule:

**`advance(state, clock)` plays every second between then and now, in order.** It makes no difference whether those seconds are played one at a time with the page open or eight hours at once when the player comes back: the same seconds give the same state. That is all "offline progress" is. `test/idle.test.ts` plays three hours both ways, and in uneven chunks, and requires the same state from each.

```ts
import { delbies } from "@journey-to-code/games";

const clock = { now: 1800000000, minute: 9 * 60, day: 2 };   // 9:00 on a Tuesday, where the player is
const state = delbies.newGame(seed, clock);
delbies.act(state, { cmd: "hustle" }, clock);
const report = delbies.advance(state, laterClock);            // what happened in between
const view = delbies.view(state, laterClock);
```

| Member | Is |
| --- | --- |
| `id`, `name`, `emoji`, `category`, `blurb`, `tagline` | As on any game. `seats` is always one and `teams` false. |
| `version` | What a saved state is marked with. `load` refuses any other. |
| `awayCap` | The longest time away that is played, in seconds. The rest is skipped. |
| `newGame(seed, clock)` | A new game, begun at the clock's second. |
| `advance(state, clock)` | Plays up to `clock.now`. **Changes the state.** Returns an `IdleReport`: `seconds` played, `skipped`, what was `earned`, and `lines` telling what happened when it was long enough to be worth telling. A clock behind the state changes nothing. |
| `command(given)` | A command from outside, made safe. |
| `act(state, command, clock)` | Brings the state up to date, then carries the command out, or says why not (`{ ok, message }`). **Changes the state.** |
| `view(state, clock)` | What the player sees. Does not change the state. |
| `load(saved)` | A state from storage, checked field by field: null when it is not one of this game's. |
| `score(state)` | The number a leaderboard would rank by. |

An `IdleClock` is `{ now, minute, day }`: seconds since 1970, minutes since midnight where the player is, and their day of the week. It is handed in, never read: an engine has no `Date` and no `Math.random`, and takes its chances from `nextRandom(state)`. The time of day is there because a game may care about it. `clockAt(clock, second)` works a past second's time of day back from now's, which is how `advance` gives each second it plays its own clock.

A state is plain data and every number in it is whole (money in cents, meters in ten-thousandths), like every other state in the package.

## Delbie's Daycare & Geriatrics

The first (`packages/games/src/delbies.ts`, `delbies` in code). You are Delbie, who owns a parts store, works harder than everyone in it put together, and cannot say no. The counter crew is the Daycare; the delivery drivers are the Geriatrics.

- **Hustle.** A click is Delbie doing it himself: money in, a quieter counter, and a little more wound up. Wound up all the way he is Living That Dream: thirty seconds of triple hustle.
- **The crew.** Twelve hires, each bringing in money every second and each with a habit: one follows Delbie about, one is in the restroom nearly half the time, one takes extra days off, one keeps the counter chill, one costs double on payday.
- **Tabs.** Customers ask for parts on account. Yes builds the store's name and the money is owed, not lost; a hundredth comes back each minute by itself, and far more while the billing desk is staffed, which is 6:30 to 2:30 by the player's own clock. At the ceiling, payroll panic halves everything.
- **Chaos.** The counter gets rowdier every second Delbie is not on it. Past halfway it eats into the takings.
- **Payroll** every ten minutes, **returns** every minute until someone is hired to stare them down, and a **back room** that fills up.
- **Away.** Up to twelve hours are played, and the report says what they got up to.

The second phase is what the crew does to you:

- **The breakroom.** B-Rice runs on leftover pasta: unfed for two hours he stops keeping the counter calm. What is in the fridge changes every ten minutes, and anything but pasta shocks Pluto into half his work. A cinnamon roll turns up now and then, and one of the counter crew stays away until it is thrown out.
- **An afternoon off.** Two minutes without Delbie: half as much again comes in and the counter holds. One of the drivers always takes the same days.
- **The radio.** The fastest driver radios in and nobody can tell what he said. Guess which of three garages he was at for two minutes of takings, or let the goody-two-shoes answer it for you once every fifteen minutes.
- **Lost & Found.** Four relics, each found by doing its deed often enough, each making one of the crew better for good.
- **The Store Move.** When the building has taken in enough, move down the road. The till, the crew and the tabs start again; everything brings in half as much again per move, the veteran gets an Old Timer badge, and the new building has a new department. Relics come too.
- **The Parts Network.** What one store can do with another. `hotshot` sends a driver out for five minutes: gas now, a fee and a little name when he is back, and fifteen minutes before the truck goes again. `list` takes everything owed on account off the books and puts it up for sale (`unlist` takes it back). `buy` pays for another store's tabs and collects twice the price over ten minutes. `receive` is for what arrives from another store: `hotshot` (a part off their truck: five minutes of takings, a bit of name, a calmer counter) or `sold` (seven tenths of the listed tabs, in the till). Amounts are always in the receiving store's own terms, so a small store and a big one can trade. The engine does not know who the other stores are: whoever runs the game joins them up, and `view().network` says what this store can do and what each thing costs.
- **The inspector.** He comes by every 25 to 50 minutes once two people have been taken on (the first time a quarter of an hour in). His car is seen a minute out, he is on the floor for twenty seconds, and what counts is how four things stand as he leaves: the counter (chaos under half), the back room (under seven tenths full), the breakroom (no cinnamon roll, and the microwave not next to the bathroom) and the books (not in payroll panic). Nothing wrong is a clean sheet: thirty to the store's name and a sticker in the window, a tenth more on everything for ten minutes. One thing wrong he lets go. Two or more is a fine of a minute's takings for each, and a rowdier counter. `view().inspector` is null until he is about, then says whether he is in yet, the seconds left, and each check with what would put it right. There is no command for him: what helps is what already quietens the counter, clears the back room and tidies the breakroom. A Store Move gives the new building a quarter of an hour's grace.

The third phase is the floor plan, and the store is a bar: eight squares by two. The front row is the counter, with the front door at its right-hand end and a terminal for each of the counter crew and the warranty desk to put in any order; the back row is the wall behind them, with the bathroom, the microwave and the drivers' bench to move along it and Delbie's office, which stays put. A new store has the crew in the order they really sit. `place` moves a piece to a square in its own row (nothing changes rows), swapping with whatever stood there. Two things on squares that share a side put a rule in effect, once whoever it is about has been hired. `DELBIES_FLOOR_RULES` is the whole list, one line each:

| Rule | When | What it does |
| --- | --- | --- |
| Shoving distance | The veteran next to the tech wizard | Three times the shoving, and a fifth less from each. |
| Good company | The veteran next to the heavy hitter or the drivers' bench | Half as much again from him. |
| Nobody walks out | The VW whisperer next to the front door | Returns are halved. |
| Pasta within reach | The heavy hitter next to the microwave | Half as long again between meals. |
| A short walk | The phantom tech next to the bathroom | Restroom trips take half as long. |
| First thing they see | The warranty desk next to the front door | 25% on everything instead of 15%. |
| Right behind him | The goody-two-shoes next to the office | Another half on every click. |
| Looking busy | The tech wizard next to the office | A quarter more from him. |
| Nobody wants that | The microwave next to the bathroom | The counter gets rowdier, faster. |

A new store's layout sets none of them off, and the layout goes with the store when it moves.

A store saved in an earlier phase (`v: 1` or `v: 2`) is opened and brought up to date by `load`.

Everyone in it goes by a nickname. Still to come: other stores.
