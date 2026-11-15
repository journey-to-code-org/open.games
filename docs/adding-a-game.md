---
order: 5
---

# Adding a game

> Paths such as `packages/web/...` and `packages/server/...` belong to the app that draws and serves the tables, not to this repository. Everything under `packages/games`, `packages/rules`, `packages/palace`, `packages/physics` and `packages/decks` is here.

Most games belong on the kit, which gives them a table, the setup screen, house rules, computer
players at the table, houses, challenges and tournaments for free. Every kit game is a
`TableGame` (`packages/games/src/table.ts`): presets and rule fields, `newGame` (a deterministic
start from a seed), `apply` (never changes the state it's given, and throws a `GameError` for a
move the rules don't allow), `view` (what one seat may see and do), `bot`, `thinkingTime` and
`summary`. The only thing that differs between a card game, a board game and a table sport is
what `view` returns.

If the bot's think is more than a millisecond or two (it searches, or simulates), give the game a
`heavy(state, seat)` that says when, so the think is done off the main thread, and if it thinks by
the clock, keep inside the `budget` that `bot` is handed (see
How computer players think). Without `heavy` a bot thinks on the
main thread, which is right for anything quick.

## A card game

1. **The engine:** `packages/games/src/<game>.ts`, a `CardGame<Rules, State, Move>` (see
   `packages/games/src/kit.ts`), whose `view` returns a `KitView`: the hand and which cards a tap
   plays, the middle of the table, melds, buttons, scores. Go Fish, Golf and Whist are short
   worked examples; `poker.ts` is the shared core for the poker games.
2. **Register it:** add its id to `CardGameId` in `table.ts`, add it to `CARD_GAMES` in
   `registry.ts`, and export it from `index.ts`.
3. **Tests:** `packages/games/test/<game>.test.ts` for its rules. The shared kit tests
   (`test/kit.test.ts`) play every registered card game automatically: computer players finish
   whole games at the smallest, usual and largest table with every preset, the same seed always
   deals the same game, views match the state, and refused moves change nothing.
4. **Its tile on the front page:** a fan of three cards in `packages/web/src/home/Home.tsx`.

## A board game

1. **The engine:** `packages/games/src/<game>.ts`, a `BoardGame<Rules, State, Move>` (see
   `packages/games/src/board.ts`), whose `view` returns a `BoardView`: one or more grids of cells
   with at most one piece each (optional shading, coordinates, blocks of cells, highlights for the
   last move and a winning line), pieces off the board in reserves, buttons, scores. A grid says
   what you can do on it in one of two ways: `tap` lists cells that send `{ type, cell }` when
   tapped (or `{ type, col }` for a drop game), and `select` lists pieces you can pick up (a cell,
   or a kind of piece in your reserve) with where each can go, sending `{ type, from, to }`. List
   exactly the legal moves: the table offers nothing else, and `apply` still refuses the rest.
   `tictactoe.ts` is the worked example, with three computer players: a solved 3×3, a scored
   search for bigger boards, and a look-ahead for Ultimate. `dropfour.ts` is the drop game (column
   taps, a rack with `gravity`), and the example of a game with a clock of its own (`deadline`).
   `combat.ts` is the worked example for everything Tic-Tac-Toe doesn't need:
   - **Hidden information.** A seat's view must hold nothing that seat shouldn't know, in cells,
     labels, marks or narration. Combat builds the view and the computer player's move from one
     function (`seen`) that is the only code to read the other seat's ships, and its tests move
     the hidden ships about and check the view doesn't change by a character. `summary` is public:
     keep secrets out of it too.
   - **A second, private grid** (`owner` is the seat it belongs to). The first grid is the main
     one; the second is drawn smaller beside it (on a phone, beside the notes and buttons). With
     two grids every board move carries `grid`.
   - **Everyone moving at once** (placing ships): `turn` is null and each seat's view offers its
     own moves. The turn timer goes on whoever the computer player would still move for.
   - **Reserves you place from:** a `select` source whose `from` is the `kind` of a piece in your
     reserve. `select.suggest` names a source the table picks up for you while you hold nothing
     else, so placing is one tap a piece. A button (`choices`) pressed while something is picked
     up leaves it in your hand, which is how a ship is turned before it's put down.
   - **Pieces longer than a cell:** give every cell of one the same `span`. The table joins them
     into one shape, and a tap on any of its cells picks up the whole piece (list it once in
     `select`, by any one of its cells).

   `checkers.ts` is the worked example for pieces that move (`select`). The table lets a piece be
   tapped and then its destination, dragged there, or played from the keyboard, and slides any
   piece that has an `id` to where it went. Three things in the kit came with it and are there
   for the next game: `flip` on a grid draws the board from the far side for the seat that sits
   there (cells keep their numbers and names; only the drawing turns); `held` in `select` names a
   piece that is already in hand, for a move made in several taps (a run of jumps is one hop per
   move, the seat keeps the turn, and the capture in progress lives in the engine's state); and
   the `must` mark rings a piece that has to move. A piece with `faded` set is drawn faintly: a
   piece jumped but not yet taken off.

   `go.ts` is the worked example for a board of crossings: `points` on a grid puts the pieces
   where the lines cross (the table draws the lines and any `"spot"` cells as star points, and
   on a touch screen with small crossings asks for two taps to put a piece down), the `barred`
   mark is an empty cell that can't be played this turn, and `claimed` marks (with an `owner`)
   are cells counted as a side's own. A button with `confirm` asks its question before it is
   sent. It is also the example of a computer player that uses its `budget`, and of a phase in
   which both players act at once on the same board (agreeing the count: `turn` is null).
   `chess.ts` added three more. `select.choose` lists moves that need one more thing said (what a
   pawn becomes): the table asks on the square and sends the answer with the move. `record` in
   the view is the game so far in its own notation, with what each move changed, so the table can
   list the moves and step back through them (`cellsAfter`). And `clock` on a seat is a clock of
   the game's own (see [Clocks and deadlines](clocks-and-deadlines.md)). A game whose pieces should
   be drawn rather than typed adds a set to `packages/web/src/board/pieces.tsx`, keyed by `kind`.
   `backgammon.ts` is the worked example for a board that isn't squares. Three more things in
   the kit came with it:
   - **A track** (`track` on a grid, a `BoardTrack`): the cells are places pieces travel along,
     `path` lists them in the order the first seat travels them (the second goes the other way),
     and `bar` and `home` name a cell per seat for pieces knocked off and pieces that have
     finished. `kind` says what the places are ("points"); nothing says how they are drawn.
     They are still cells, so `tap` and `select` work unchanged, and `rows` × `cols` still gives
     a plain picture of the board for a table that doesn't know the kind. The table numbers the
     points from the viewer's own end, lays the board on its side on a phone, and puts the dice
     and the cube on it.
   - **Stacks:** a piece with `count` is that many identical pieces on one cell, and `ids` names
     each of them from the bottom up, so the table can slide the one that moved (a checker that
     is hit keeps its id on the way to the bar).
   - **`flip: "rows"`** turns the board over instead of round: the last row is drawn at the top
     but left stays left, so both players run the same way and have their home on the same hand.
   - **`cube`** on the view (`BoardCube`): the doubling cube's `value`, its `owner` (null in the
     middle), who has `offered` a double that is waiting for an answer, and `dead` when it is
     out of play. Offering, taking and dropping are ordinary buttons (`choices`).
   - **`quick`** in `select`: a piece with one place to go is played by tapping it. It is a table
     rule in Backgammon; the engine only passes it on.
   - A turn of several steps that can be **taken back** keeps its steps in the state until the
     turn is over (`undo` is a move like any other, offered as a button). It is safe there
     because the dice are already on the table: never offer it where a step shows the player
     something new. The legal steps come from a generator of whole turns, so a rule about the
     whole turn ("play both dice if you can") holds at every step; and the computer player
     picks a whole turn and plays its first step each time it is asked.

   A view can also have **dice** and a **score sheet**, beside its grids or instead of them
   (`grids: []` is a fine view). `yacht.ts` is the worked example of both, with no board at all:
   - **`dice`** (`BoardDice`): the dice on the table, each `{ id, value }` with `value` null
     before it has been rolled, `held` for a die kept back from the next throw, `used` for one
     that has been played or is left over (drawn dimmed), and `owner` when the dice aren't all
     one player's. A die keeps its id from throw to throw. The engine throws them, from its
     seeded random source (`nextRandom`), like a deal: a view only says what each die shows, and
     the table only animates towards that. `roll` goes up by one with every throw, which is how
     the table knows to tumble the dice that aren't held (and to make the sound). `tap` lists
     the dice a seat can tap now, each sending `{ type, die }`. Dice that belong to one seat
     alone (everyone rolling at once) say so with the `owner` of the whole `dice`, exactly like
     a private grid: they are only in that seat's view, and a watcher is shown none.
   - **`sheet`** (`ScoreSheet`, in `table.ts`; Mini Golf's scorecard is the same type): a
     column per thing scored and a row per player, all strings. A column nobody fills in (a
     bonus) has `kind: "sum"`. `pick` lists the cells of the seat's own row it can choose now
     and what each `would` score; choosing one sends `{ type, cell }` with the column's `id`.
     `last` is the cell filled in last. The board table draws a sheet with the boxes down the
     page and a column a player, your own first; on a phone it shows your own sheet folded in two.
   - Nothing about how a die or the sheet looks belongs in a view: a die is an `id` and a
     `value`, and the table (`Dice.tsx`, `Sheet.tsx` in `packages/web/src/board/`) decides the rest.
   - A turn of several steps (roll, keep, roll, score) is a move a step, as a run of jumps is in
     Checkers. The computer player has to give the same answer each time it's asked between two
     steps: Yacht's decides whether it is having a careless moment from the dice, not from
     `Math.random()`.
2. **Offers, for a game with two sides:** resigning, draw offers and taking a move back are built
   once (`packages/games/src/offers.ts`) and a game opts in by wrapping itself. Its own `apply`,
   `view` and computer player don't change:

   ```ts
   const rules: BoardGame<ChessRules, ChessState, ChessMove> = { /* the game */ };

   export const chess = withOffers<ChessRules, ChessState, ChessMove>(rules, {
     // End the game on the board: `winner` takes it, or nobody (a draw). `s` is a copy to change.
     // `settleMatch` does it for a state shaped like the other board games' (wins, draws, round…).
     settle: settleMatch,
     // Moves can be taken back. Leave it out (the default) if any seat can't see everything, or a
     // move decides anything by chance; a function can rule out some tables: (s) => !s.rules.blitz.
     takeBack: true,
     // For a computer player answering a draw offer: above zero is better than level for `seat`.
     standing: (s, seat) => material(s, seat) - material(s, 1 - seat),
   });
   ```

   The wrapper adds the moves (`{ type: "resign" }`, `{ type: "offer", offer: "draw" | "takeback" }`,
   `{ type: "accept" }`, `{ type: "decline" }`), a house rule (`offers`: all, no take-backs,
   none), and `offers` in the view (what is open, who made it, what this seat may do), which the
   board table draws. What it needs to remember lives in the state under `offers`, so it is in
   the move log's replay like everything else; that includes the last four positions for taking
   back (`history`), which never reach a view. Nothing is kept across a move that changed the
   state's `rng`, after a game ends, or in a game that didn't say `takeBack`. A game whose state
   isn't shaped like the others writes its own `settle` (and `live`, if "a game is being played"
   isn't `phase === "playing"`: Combat's placing and shooting are both). Other options:
   `drawGap`, `backGap`, `levelAfter`.
3. **Register it:** add its id to `BoardGameId` in `table.ts`, add it to `BOARD_GAMES` in
   `registry.ts`, and export it from `index.ts`.
4. **Tests:** `packages/games/test/<game>.test.ts` for its rules. The shared board tests
   (`test/board.test.ts`) play every registered board game automatically: computer players finish
   whole games with every preset at every table size, a game can be played from nothing but what
   its views offer, every move a view offers is accepted (offers included: made, answered and
   taken back along the way), the same seed always starts the same game, and refused moves change
   nothing. `test/offers.test.ts` checks every game with offers can be resigned and drawn, in one
   game and in a match; add a take-back case there for a game with a move made in several taps.
   Dice and a sheet are checked too: dice have ids of their own and show faces they have, a die
   that can be tapped is on the table, a cell that can be chosen is an empty one in the seat's own
   row. So are stacks (a whole number of pieces, each named once), a track (its places are cells of
   the grid, each once) and the cube.
5. **Its tile on the front page:** a little board position in `BOARDS` in
   `packages/web/src/home/Home.tsx`, or for a dice game a few dice in `DICE`. (Backgammon's is a
   board with `shade: "points"`.)

## A table sport

A game played by striking a ball: mini golf, and next billiards, Carrom and bowling. These stay
turn-based. A move is a shot in the whole numbers of [`packages/physics`](../packages/physics)
(`{ type: "shot", body, angle, power }`: hundredths of a degree, and 0 to 1000); `apply` plays it
to rest with `simulate` and keeps where everything stopped; every browser steps the same
simulation to animate it and lands on the same table, because the physics is deterministic to the
bit.

1. **The engine:** `packages/games/src/<game>.ts`, a `SportGame<Rules, State, Move>` (see
   `packages/games/src/sport.ts`), whose `view` returns a `SportView`: the physics world at rest
   (walls, pockets, regions, tunnels, any number of bodies of any size), a `look` that says what
   each part is (see **Renderers** below), `ghosts` (things drawn that this world's physics
   doesn't know: the other players' balls when mini golf is played all at once, or a ball lifted
   off the tee), `shoot` (the body this seat may strike and the range of power,
   or null), `last` (the shot just taken, the bodies it started from and where the physics came
   to rest, so the table can replay it), a score `card`, buttons and scores. `minigolf.ts` is the
   worked example, with a computer player that tries a few hundred putts in its head and then
   hits the best one about as well as its persona can.
2. **Register it:** add its id to `SportGameId` in `table.ts`, add it to `SPORT_GAMES` in
   `registry.ts`, and export it from `index.ts`.
3. **Tests:** `packages/games/test/<game>.test.ts` for its rules. The shared sport tests
   (`test/sport.test.ts`) play every registered table sport automatically: computer players finish
   whole games with every preset at every table size, the shot every view carries really does end
   where the view says it did, a seat is offered a shot exactly when the engine will take one,
   the same seed and dice give the same game, and refused shots change nothing.
4. **Its tile on the front page:** a little table seen from above in `TABLES` in
   `packages/web/src/home/Home.tsx`.

The table screen (`packages/web/src/sport/`) needs nothing: it fits any `SportView` to the screen
(turned on its side only if that shows the table a good deal bigger), aims (pull back and let go, or the arrow
keys, or the buttons), and plays each shot with its sounds. Keep the state safe to replay: the room rebuilds a table after a restart by running its
logged shots through `apply` again, which gives the same table under the same `PHYSICS_VERSION`
and the same table data (the header of `minigolf.ts` says what that does and doesn't promise).

**Renderers.** A view describes what is on the table and never how it looks: everything is in the
world's own units and named by kind. `SportLook` says a wall is a timber rail so wide and so high
standing to one side of its line, a closed wall is a rock or a flowerpot of some height, a
one-way wall is a step with a drop, a patch of ground is grass, sand, water or paving and how far
above the garden it stands, a slope rises so far, a tunnel is a pipe, a hose or a burrow, and the
scenery is a gnome here and a wheelbarrow there, facing this way. There are no colours, pixels or drawing decisions in an
engine, in course data or in `SportView` (the shared sport test checks), heights are kept even
though the physics is flat, every body, wall and tunnel keeps a stable id, and the physics'
events say what happened to which of them and on which step. All drawing is behind one function,
`drawScene(ctx, width, height, dpr, fit, scene)` in `packages/web/src/sport/draw.ts`: the table
screen builds a `Scene` (the view's table, where each ball is this instant, the aim, what has just
splashed) and calls it.

Today that draws a model looked down on from an angle, on a 2D canvas, with textures painted in
code (`paint/`): no 3D library, no WebGL and no picture files.

- **The projection** is one small file, `projection.ts`: world x, y and height to the screen, and
  back again on the ground. It is a camera tipped back about 40° from overhead with no
  perspective, looking up the screen: the plan is not rotated (left is left, up is away), depth
  is foreshortened, and height goes straight up the screen, so everything shows its top and the
  face towards you. Drawing and the pointer both go through it, which is why a pull of the thumb
  sends the ball exactly the opposite way along the ground (`test/projection.test.ts` in the web
  package sweeps that). A table that fits the screen better on its side is turned before it is
  looked at, so the camera never looks sideways.
- **Heights are the view's.** Rails, blocks and bumpers carry a height, a patch of ground a
  `level`, a ledge a `drop`, a slope a `rise`, scenery an optional `height` (left out: what such
  a thing usually is). The renderer only adds what a view leaves open: water and sand lie a
  little below what they are set in (`paint/terrain.ts`). Ground that a ball plays on should not
  lie below the garden round it, or its near edge hides the ball: raise the rest instead (the
  last hole is a raised bed with a step down to the lawn).
- **What is in front hides what is behind.** The still part of a hole is painted once for a hole
  and a screen size and kept: the ground at its heights, then everything that stands up, the
  furthest first (`paint/course.ts`, `paint/order.ts`). Each frame copies that painting and draws
  what moves from the back of the table to the front; whatever stands in front of a ball is drawn
  again over it, and a ball that ends up mostly hidden is shown through as a ring.
- **From straight above** is the same drawing with no tilt: a choice in the ⚙︎ sheet at a table
  sport, kept on the device.

A renderer in three dimensions would take the same `Scene` and replace that one function; nothing in the
engines, the views, the server or the table screen's playback would change (its pointer maths
would use the new renderer's own way from the screen to the ground).

**Adding a mini golf hole** is adding data: a `hole({ … })` in
`packages/games/src/minigolfcourse.ts` with a name, a par, a tip, the tee, the cup, the patches of
green, and any rails (left out: one round each patch), blocks (each a kind: rock, pot, castle…),
ledges, bumpers, tunnels, slopes, sand, water, scenery and decorations, appended to a course's
`holes` (or a new course added to `COURSES`). Use whole numbers, make water at least 1000 units
thick so a hard shot can't jump it, and run the tests: `test/minigolfcourse.test.ts` checks every
hole of every course without being told about it (the world validates, everything described is
there, the tee and cup are on the green and clear of walls, sand and water, a ball can never get
anywhere that isn't grass, sand or water, tunnels let a ball out somewhere safe, and a search
over shots holes out within par + 2).

**Balls that collide.** Played in turn, every ball that is out on a mini golf hole is in the
world for every shot, and every seat (and anyone watching) is sent the same table. A ball that is
knocked stays where it stops; knocked into the cup it is holed for its owner with no extra stroke
(a house rule, on by default); knocked into the water or off the course it goes back where it
lay at no cost. A ball still lying on the tee is lifted while the next player tees off. Played
all at once there is no one table (each player is on their own shot of the hole), so each shot
has only the striker's ball in it and the other balls are drawn faintly as ghosts. The header of
`minigolf.ts` has the reasoning.

Nothing else needs touching: `KIT_GAMES` is all three lists together, and the room on the server,
the setup screen, the rules editor, houses, challenges, leaderboards, tournaments and practice all
go by it. The web app's `GameTable` picks the card table, the board table or the sport table from
the game.

A game the kit can't express (Spades and Palace predate it) gets its own engine package, a room
definition in `packages/server/src/games.ts` and a table in the
web app; Palace is the worked example (`packages/palace`, `packages/server/src/palace.ts`,
`packages/web/src/palace/`).
