---
order: 7
---

# Clocks and deadlines

Nothing happens in a room unless a seat or a computer player moves, except by a **deadline**: a
room definition may say what the server does if nobody moves in time
([`packages/rooms`](https://github.com/journey-to-code-org/open.rooms/tree/main/packages/rooms#deadlines) has the whole contract).

```ts
deadline: (state, { settings, seats }) => ({
  after: 30_000,                 // ms after the last move (or `at`: a server time)
  seat: state.turn,              // whose clock: pages count down on this seat
  move: () => ({ type: "pass" }) // made as that seat when time runs out; null for nothing
}),
```

The timeout move goes through `act` and into the move log like any other, so a replay gives the
same game, and a move that arrives as the timer fires is never applied on top of it. `act` gets a
fourth argument, `{ at, elapsed }` (when the server decided the move, and how long since the one
before); a game with real clocks keeps them in its state from that alone, never from `Date.now()`,
which is what makes a chess clock replay: `after: state.bank[state.turn]`, and `act` takes
`elapsed` off the mover's bank and adds the increment
([`packages/rooms/test/deadlines.test.ts`](https://github.com/journey-to-code-org/open.rooms/blob/main/packages/rooms/test/deadlines.test.ts) has one in forty lines).

Every game in the card room already has one deadline, the turn timer
(`packages/server/src/timer.ts`). A game on the kit gets it for nothing: it needs `view().turn` to
say whose move it is and `bot()` to give a move for any seat that owes one.

A room counts `after` from the last move of any kind, and an offer and its answer are moves. So
that asking for a draw never buys time, a kit game's `apply` is handed the move's `{ elapsed }`,
the offers wrapper adds up what has gone by since the last move on the board, and that is taken
off both clocks: the game's own (`deadline`) and the turn timer (`TableGame.spent`). When the turn
timer runs out it plays `TableGame.play`, the computer player's move on the board, which is never
an answer to an offer.

## A game's own clock

A game on the kit can also have a clock that is part of its rules: a shot clock, a chess clock, a
window for claiming a discard. It says so from its state, with the optional `deadline` of
`TableGame` (`packages/games/src/table.ts`):

```ts
deadline(state) {
  // Drop Four in drinking mode: three seconds, once the other player's disc has landed.
  return state.clock ? { after: 3000, seat: state.turn, move: { type: "timeout" } } : null;
},
```

`after` counts from the last move anyone made, `seat` is whose clock it is, and `move` is made as
that seat when time runs out. It's a move like any other: `apply` decides what it does (in Drop
Four, a drink and a lost turn) and refuses it when no clock is running, and it goes into the move
log. `deadline` must be worked out from the state alone, never from the time of day.

- **Wired once.** `kitRoom.deadline` (`packages/server/src/kit.ts`) turns it into the room's
  deadline for every game, and `tableRoom.deadline` (`games.ts`) weighs it against the turn timer
  with `sooner` (`timer.ts`): whichever runs out first is the room's one deadline, and the game's
  own wins a tie. With no clock of its own running, the turn timer is all there is.
- **A little grace.** The clock is meant to run from when you can see the other player's move, and
  both that and your answer take a moment to travel. So the server waits `GAME_CLOCK_GRACE_MS`
  (400 ms, in `kit.ts`) past a game's own clock before it makes the timeout move, using the room
  deadline's `grace`. Pages count down to the time without it, and a move that arrives inside the
  grace is taken like any other. The turn timer has no grace: its shortest setting is 15 seconds.
- **Computer players** aren't held to a game's own clock (no deadline is armed on a bot's seat), and
  `botDelay` keeps them inside six tenths of it whatever the table's pace, so a person is never
  waiting longer for a bot than they'd be allowed themselves.
- **Replays and restarts.** A timeout is in the move log, so a replay gives the same game with the
  missed turn in it. After a restart a clock that was running is armed again from the last move's
  logged time, but never with less than the room's `deadlineGrace` (five seconds) from the restart:
  for a three-second clock that means a restart gives the seat five seconds, not a lost turn.
  Changing the table's settings mid-clock never puts off a clock that's already running.
- **Practice.** `LocalKit` runs the same `deadline` in the browser, on your own seat, with no grace
  (there's no trip to make), and shows the same countdown.
- **A clock that banks time** (Chess) keeps each side's time in its state: `apply` is handed how
  long the move took (`{ elapsed }`, with any time spent on offers added) and takes it off the
  mover's bank, and `deadline` is the bank of the side to move. Such a deadline says `strict`:
  it is armed on a computer player's seat as well, since the time is part of the game. A seat's
  view carries `clock` (what it had at the last move, and whether it is running) and the room
  publishes when that move was made (`moved`), so pages count the running clock down by the
  server's time.
