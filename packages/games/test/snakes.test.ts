import { describe, expect, it } from "vitest";
import { classicSnakes, GameError, gentleSnakes, movesOffered, quickSnakes, snakes, SNAKES_COLS, SNAKES_HOME, SNAKES_LADDERS, SNAKES_SNAKES, snakesCell, type SnakesRules, type SnakesState } from "../src/index.js";

const g = snakes;
const SHARP = { skill: 1, sloppy: 0 };
const start = (rules: Partial<SnakesRules> = {}, seats = 2, seed = 1): SnakesState => g.newGame(g.normalize({ ...classicSnakes, ...rules, first: "seat1" }), seats, seed);
/** The same game with the first seat holding these dice, and these pieces: the first seat's, then the others' round the table. */
function rolled(s: SnakesState, dice: [number, number], ...pieces: number[][]): SnakesState {
  const next = structuredClone(s);
  next.turn = 0;
  next.phase = "move";
  next.dice = [...dice];
  next.spent = [false, false];
  pieces.forEach((at, seat) => (next.pieces[seat] = [...at]));
  return next;
}
/** Move the first seat's piece from one place on the track to another. */
const go = (s: SnakesState, from: number, to: number, seat = 0) => g.apply(s, seat, { type: "move", from: snakesCell(seat, from), to: snakesCell(seat, to) });
const offered = (s: SnakesState, seat = 0) => movesOffered(g.view(s, seat));

describe("the board", () => {
  it("snakes up from the bottom left to the top left, with a yard below and a home above for each seat", () => {
    const place = (cell: number) => [Math.floor(cell / SNAKES_COLS), cell % SNAKES_COLS];
    expect(place(snakesCell(0, 1))).toEqual([6, 0]);
    expect(place(snakesCell(0, 6))).toEqual([6, 5]);
    expect(place(snakesCell(0, 7))).toEqual([5, 5]);
    expect(place(snakesCell(0, 35))).toEqual([1, 1]);
    // Square 36 is top left; a piece that gets there is drawn in its owner's home, in the row above.
    expect(place(snakesCell(1, 0))).toEqual([7, 1]);
    expect(place(snakesCell(1, SNAKES_HOME))).toEqual([0, 1]);
    // Every square has a cell of its own.
    expect(new Set(Array.from({ length: 35 }, (_, i) => snakesCell(0, i + 1))).size).toBe(35);
  });

  it("has ladders that go up and snakes that go down, none starting where another starts or ends", () => {
    for (const [foot, top] of SNAKES_LADDERS) expect(top).toBeGreaterThan(foot);
    for (const [head, tail] of SNAKES_SNAKES) expect(tail).toBeLessThan(head);
    const starts = [...SNAKES_LADDERS, ...SNAKES_SNAKES].map(([from]) => from);
    const ends = [...SNAKES_LADDERS, ...SNAKES_SNAKES].map(([, to]) => to);
    expect(new Set(starts).size).toBe(starts.length);
    for (const end of ends) expect(starts).not.toContain(end);
    for (const square of [...starts, ...ends]) expect(square > 0 && square < SNAKES_HOME).toBe(true);
  });

  it("never sends two different dice to the same place, so where a piece is put says which die moved it", () => {
    const land = new Map([...SNAKES_LADDERS, ...SNAKES_SNAKES]);
    for (let from = 0; from < SNAKES_HOME; from++) {
      const ends = [1, 2, 3, 4, 5, 6].filter((die) => from + die <= SNAKES_HOME).map((die) => land.get(from + die) ?? from + die);
      expect(new Set(ends).size, `from ${from}`).toBe(ends.length);
    }
  });

  it("shows the ladders and snakes as nobody's pieces that say where they lead, and leaves the snakes off a gentle board", () => {
    const board = g.view(start(), 0).grids[0]!;
    expect(board.cells[snakesCell(0, 3)]).toMatchObject({ owner: null, kind: "ladder", glyph: "↑12" });
    expect(board.cells[snakesCell(0, 17)]).toMatchObject({ owner: null, kind: "snake", glyph: "↓5" });
    expect(board.names![snakesCell(0, 12)]).toBe("square 12, the top of the ladder from 3");
    // The squares are numbered, and a table that can draws each ladder and snake from end to end.
    expect(board.tags![snakesCell(0, 35)]).toBe("35");
    expect(board.tags!.filter(Boolean)).toHaveLength(36);
    expect(board.tags![snakesCell(0, 0)]).toBe("");
    expect(board.links).toHaveLength(8);
    expect(board.links).toContainEqual({ from: snakesCell(0, 17), to: snakesCell(0, 5), kind: "snake", label: "snake from square 17 down to 5" });
    const gentle = g.view(start(gentleSnakes), 0).grids[0]!;
    expect(gentle.links!.map((l) => l.kind)).toEqual(["ladder", "ladder", "ladder", "ladder"]);
    expect(gentle.cells[snakesCell(0, 17)]).toBeNull();
    expect(gentle.cells[snakesCell(0, 3)]).toMatchObject({ kind: "ladder" });
  });
});

describe("a turn", () => {
  it("starts with everything in the yard and a roll to make", () => {
    const s = start();
    expect(s.pieces).toEqual([[0, 0], [0, 0]]);
    expect(offered(s)).toEqual([{ type: "roll" }]);
    expect(offered(s, 1)).toEqual([]);
    expect(g.view(s, 0).grids[0]!.cells[snakesCell(0, 0)]).toMatchObject({ owner: 0, count: 2, ids: ["snakes-0-0", "snakes-0-1"] });
  });

  it("lets any seat go first when it is the luck of the draw", () => {
    const first = new Set(Array.from({ length: 60 }, (_, seed) => g.newGame(classicSnakes, 4, seed + 1).turn));
    expect([...first].sort()).toEqual([0, 1, 2, 3]);
  });

  it("offers each piece a place for each die, and pieces that share a square once", () => {
    expect(offered(rolled(start(), [2, 5], [0, 0]))).toEqual([
      { type: "move", from: snakesCell(0, 0), to: snakesCell(0, 2) },
      { type: "move", from: snakesCell(0, 0), to: snakesCell(0, 5) },
    ]);
    // A double is one place to go for each piece, not two.
    expect(offered(rolled(start(), [4, 4], [0, 9]))).toHaveLength(2);
  });

  it("spends a die on each move and passes when both are spent, leaving the dice on the table", () => {
    let s = go(rolled(start(), [2, 4], [0, 0]), 0, 2);
    expect(s.pieces[0]).toEqual([2, 0]);
    expect([s.turn, s.phase, s.spent]).toEqual([0, "move", [true, false]]);
    // Only the four is left, for either piece.
    expect(offered(s).map((m) => m.to)).toEqual([snakesCell(0, 6), snakesCell(0, 4)]);
    s = go(s, 2, 6);
    expect(s.pieces[0]).toEqual([6, 0]);
    expect([s.turn, s.phase]).toEqual([1, "roll"]);
    expect(g.view(s, 1).dice!.dice).toEqual([{ id: 0, value: 2, used: true }, { id: 1, value: 4, used: true }]);
    expect(g.view(s, 0).grids[0]!.marks).toContainEqual({ cell: snakesCell(0, 6), mark: "last" });
  });

  it("needs the exact count to get home, and loses a die nothing can use", () => {
    const s = rolled(start(quickSnakes), [6, 2], [33]);
    expect(() => go(s, 33, SNAKES_HOME)).toThrow("That piece can't go there with a 6 or a 2.");
    // 33 and 2 is 35, the head of the snake down to 20.
    expect(offered(s)).toEqual([{ type: "move", from: snakesCell(0, 33), to: snakesCell(0, 20) }]);
    const after = go(rolled(start({ ...quickSnakes, snakes: false }), [6, 2], [33]), 33, 35);
    expect(after.narration).toBe("{0} moves 2 to square 35. Nothing can move 6");
    expect([after.turn, after.phase]).toEqual([1, "roll"]);
    // A roll nothing can use at all passes the turn by itself.
    let passed = 0;
    for (let seed = 1; seed <= 20; seed++) {
      const stuck = start({ ...quickSnakes, snakes: false }, 2, seed);
      stuck.pieces[0] = [35];
      const thrown = g.apply(stuck, 0, { type: "roll" });
      if (thrown.dice.includes(1)) continue;
      passed++;
      expect([thrown.turn, thrown.phase, thrown.narration]).toEqual([1, "roll", `{0} rolls ${thrown.dice[0]} and ${thrown.dice[1]} and can't move`]);
    }
    expect(passed).toBeGreaterThan(0);
  });

  it("climbs a ladder and slides down a snake at once", () => {
    const up = go(rolled(start(), [3, 6], [0, 0]), 0, 12);
    expect(up.pieces[0]).toEqual([12, 0]);
    expect(up.narration).toBe("{0} moves 3 and climbs the ladder to square 12");
    const down = go(rolled(start(), [6, 1], [11, 0]), 11, 5);
    expect(down.pieces[0]).toEqual([5, 0]);
    expect(down.narration).toBe("{0} moves 6 and slides down the snake to square 5");
    // Without snakes the piece stays where it counted to.
    expect(go(rolled(start(gentleSnakes), [6, 1], [11, 0]), 11, 17).pieces[0]).toEqual([17, 0]);
  });

  it("sends everything it lands on back to the yard, but never anything of its own", () => {
    const s = go(rolled(start({}, 3), [4, 1], [0, 0], [4, 4], [4, 20]), 0, 4);
    expect(s.pieces).toEqual([[4, 0], [0, 0], [0, 20]]);
    expect(s.narration).toBe("{0} brings a piece out to square 4 and sends {1}'s 2 pieces and {2}'s piece back to the yard");
    const own = go(rolled(start(), [4, 1], [4, 0]), 0, 4);
    expect(own.pieces[0]).toEqual([4, 4]);
    expect(g.view(own, 0).grids[0]!.cells[snakesCell(0, 4)]).toMatchObject({ owner: 0, count: 2, glyph: "2" });
  });

  it("is won by getting every piece home, and places the rest by how far they got", () => {
    const s = go(rolled(start({}, 3), [6, 1], [30, 36], [5, 9], [20, 36]), 30, SNAKES_HOME);
    expect(s.phase).toBe("finished");
    expect(s.narration).toBe("{0} gets a piece home. {0} wins!");
    const seen = g.view(s, 1);
    expect(seen.over).toEqual({ winners: [0], title: "{0} wins!" });
    expect(seen.grids[0]!.cells[snakesCell(0, SNAKES_HOME)]).toMatchObject({ owner: 0, count: 2 });
    expect(g.summary(s)).toMatchObject({ over: true, winners: [0], order: [0, 2, 1] });
    expect(g.bot(s, 1, SHARP)).toBeNull();
    expect(() => g.apply(s, 1, { type: "roll" })).toThrow(GameError);
  });
});

describe("what isn't allowed", () => {
  it("is refused in words, and changes nothing", () => {
    const s = rolled(start(), [2, 5], [0, 10], [7, 0]);
    const before = structuredClone(s);
    expect(() => g.apply(s, 1, { type: "roll" })).toThrow("It's not your turn.");
    expect(() => g.apply(s, 0, { type: "roll" })).toThrow("Move a piece first.");
    expect(() => g.apply(start(), 0, { type: "move", from: snakesCell(0, 0), to: snakesCell(0, 2) })).toThrow("Roll the dice first.");
    expect(() => go(s, 7, 9)).toThrow("You don't have a piece there.");
    expect(() => g.apply(s, 0, { type: "move", from: snakesCell(1, 0), to: snakesCell(0, 2) })).toThrow("You don't have a piece there.");
    expect(() => go(s, 10, 14)).toThrow("That piece can't go there with a 2 or a 5.");
    expect(() => g.apply(s, 0, { type: "move", from: 999, to: 0 })).toThrow("That's not a square on the board.");
    expect(() => g.apply(s, 0, { type: "pass" } as never)).toThrow("That's not a move in Snakes & Ladders.");
    expect(() => g.apply(s, 7, { type: "roll" })).toThrow("You're not at this table.");
    expect(s).toEqual(before);
  });

  it("rolls the same dice from the same seed, and never changes the state it is given", () => {
    const s = start({}, 2, 7);
    const before = structuredClone(s);
    const a = g.apply(s, 0, { type: "roll" });
    expect(s).toEqual(before);
    expect(g.apply(start({}, 2, 7), 0, { type: "roll" })).toEqual(a);
    expect(a.dice.every((d) => Number.isInteger(d) && d >= 1 && d <= 6)).toBe(true);
  });
});

describe("the computer player", () => {
  const level = () => 0.5;
  /** The first seat's whole turn, played by the computer. */
  function turn(s: SnakesState): SnakesState {
    while (s.turn === 0 && s.phase === "move") s = g.apply(s, 0, g.bot(s, 0, SHARP, level)!);
    return s;
  }

  it("catches a piece that is far along rather than making ground elsewhere", () => {
    const s = turn(rolled(start(), [2, 1], [28, 0], [30, 0]));
    expect(s.pieces[1]).toEqual([0, 0]);
  });

  it("plans both dice together: the five and then the three to a ladder, not the three first to a snake", () => {
    // 3 first climbs to 12, and the 5 from there is the snake on 17 down to 5. 5 first, then 3, is square 8 and up to 19.
    expect(turn(rolled(start(quickSnakes), [3, 5], [0], [30])).pieces[0]).toEqual([19]);
  });

  it("only ever plays what its view offers, and finishes whole games at every table size", () => {
    for (const preset of g.presets) {
      for (const seats of [2, 3, 4]) {
        let s = g.newGame(preset, seats, 11 + seats);
        let rng = 1;
        const rand = () => ((rng = (rng * 16807) % 2147483647) - 1) / 2147483646;
        let moves = 0;
        for (; moves < 3000 && !g.summary(s).over; moves++) {
          const move = g.bot(s, s.turn, moves % 5 ? SHARP : { skill: 0, sloppy: 1 }, rand)!;
          expect(offered(s, s.turn)).toContainEqual(move);
          s = g.apply(s, s.turn, move);
        }
        expect(g.summary(s).over, `${preset.id} with ${seats}`).toBe(true);
      }
    }
  });
});
