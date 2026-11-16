---
title: open.games
order: 0
---

# open.games

A reusable game engine and kit for card, board, table-sport and arcade games, with computer players.

A game here is a set of pure functions over plain data: no framework, no server, no clock, no `Math.random`. The same seed and the same moves always give the same game, so it runs the same in a browser, on a server or in a worker thread, and a room can be rebuilt by replaying its moves. Multiplayer rooms, lobbies and tournaments live in [open.rooms](https://github.com/journey-to-code-org/open.rooms).

## Pages

- [Getting started](getting-started.md): play a whole game from code, with computer players.
- [The games](games.md): all 59, with seats and rule presets.
- [The packages](packages.md): what each of the five packages holds.
- [The game contract](game-contract.md): `TableGame`, what a view is, and what the bots are handed.
- [Adding a game](adding-a-game.md): how a card game, a board game and a table sport are each built.
- [Arcade games](arcade-games.md): games in real time, the tick that drives them, and scores that can be replayed.
- [Idle games](idle-games.md): games that go by the clock on the wall and carry on while nobody is looking.
- [Clocks and deadlines](clocks-and-deadlines.md): turn timers, a game's own clock, and how they replay.
- [Releasing](releasing.md): how a version reaches npm.
- [For agents](agents.md): the skills in `.agents/` that let a coding agent use and maintain this.

## Status

Version 0.1, with the API still settling. [MIT](https://github.com/journey-to-code-org/open.games/blob/main/LICENSE).
