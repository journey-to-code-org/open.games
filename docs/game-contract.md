---
order: 4
---

# The game contract

Every game on the kit is a `TableGame<Rules, State, Move, View>` (`packages/games/src/table.ts`). Everything else (a room on a server, the setup screen, the rules editor, houses, challenges, tournaments, practice) needs only this.

## What a game says about itself

| Member | Is |
| --- | --- |
| `id`, `name`, `emoji`, `blurb`, `tagline` | Identity and words for a game picker and a setup screen. |
| `category` | The shelf it sits on in a picker: `cards`, `board`, `dice`, `sports` or `arcade`. `GAME_CATEGORIES` lists them in order with a name and an emoji for a heading, and `gamesIn(category)` gives a shelf's games, [arcade games](arcade-games.md) included. It is what the game is to someone choosing one, not the kit it is built on: Yacht is a `BoardGame` and a `dice` game. |
| `seats` | `{ min, max, default }`. |
| `teams` | Partners across the table (needs four seats). |
| `presets` | Named rule sets. |
| `fields` | Every house rule, described (`toggle`, `choice`, `number`) so a rules editor can draw it. |
| `normalize(rules)` | Rules from storage or a page: anything missing comes from the first preset. |
| `validate(rules)` | Problems with a rule set, in plain words. |
| `describe(rules)` | The rules in plain sentences. |

## What a game does

| Member | Does |
| --- | --- |
| `newGame(rules, seats, seed)` | A deterministic start. |
| `apply(state, seat, move, time?)` | The next state. **Never changes the state it is given.** Throws `GameError` for a move the rules do not allow. |
| `view(state, seat)` | What that seat may see, and what it may do. |
| `bot(state, seat, style, rand?, budget?)` | The move a computer player makes now, or `null` when it has nothing to do. |
| `summary(state)` | A few words and numbers for lobbies and leaderboards: `over`, `scoreLine`, `winners`, `order`. |
| `thinkingTime(state, seat)` | How long a person would think here, in ms. |

Optional:

| Member | Does |
| --- | --- |
| `heavy(state, seat)` | Whether the bot's think is slow enough (a few ms or more) to run off the main thread. Must answer at once from the state alone. |
| `play(state, seat, style, rand?, budget?)` | The bot's move on the board alone, when `bot` may do something else first, such as answer an offer. |
| `reactionTime(state, seat, style)` | For a race (a slap in Slapjack): how long this computer player takes to react. |
| `deadline(state)` | The game's own clock: `{ after, seat, move, strict? }`. See [clocks and deadlines](clocks-and-deadlines.md). |
| `spent(state)` | Ms of the wait that have already gone by over moves that are not board moves. |

## The rules every game keeps

- **Deterministic.** The same rules, seats, seed and moves always give the same state. A game gets its randomness from `nextRandom(state)` (a seeded source whose position lives in the state), never `Math.random`, and its time from `MoveTime`, never the clock.
- **Pure.** `apply` returns a new state. `clone` (a `structuredClone`) is there for the copy.
- **No secrets in a view.** A seat's view holds nothing that seat should not know, in cells, labels, marks or text, and `summary` is public, so secrets stay out of it too.
- **A bot decides from what its seat can see**, and whether it has a move at all must not depend on the style.
- **A think may be handed a budget.** `budget` is how long it may take. A game that uses the time must keep to it: a think that runs far past is abandoned and the seat is asked again with `QUICK_STYLE` and `QUICK_BUDGET`, on the table's own thread, so that answer has to come at once.

## Helpers for engines

`GameError`, `shuffled(items, rand)`, `nextRandom(state)`, `clone`, `rankSeats`, `teamOfSeat`, `teamSeats`, `nextHandChoices` and `markReady` (a "Next hand" button for each person who has not moved on), `thinkFor`, `careless(style, rand)` and `pickRandom`.
