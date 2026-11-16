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

Everyone in it goes by a nickname. Still to come: the crew's hazards and mini-games, relics, the store move, the breakroom grid, and other stores.
