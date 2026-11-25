import { describe, expect, it } from "vitest";
import { classicSnakes, GameError, gentleSnakes, movesOffered, parlorSnakes, shuffledLayout, shuffledSnakes, snakes, SNAKES_COLS, SNAKES_END, SNAKES_LADDERS, SNAKES_SNAKES, snakesCell, snakesOptions, type SnakesRules, type SnakesState } from "../src/index.js";

const g = snakes;
const SHARP = { skill: 1, sloppy: 0 };
const start = (rules: Partial<SnakesRules> = {}, seats = 2, seed = 1): SnakesState => g.newGame(g.normalize({ ...parlorSnakes, ...rules, first: "seat1" }), seats, seed);
/** The same game with the first seat holding these dice and everyone on these squares. */
function rolled(s: SnakesState, dice: number[], ...at: number[]): SnakesState {
  const next = structuredClone(s);
  next.turn = 0;
  next.phase = "move";
  next.dice = [...dice];
  at.forEach((square, seat) => (next.at[seat] = square));
  return next;
}
/** Seeded random numbers, for a bot. */
function seeded(seed: number) {
  let x = seed >>> 0;
  return () => {
    x = (x + 0x6d2b79f5) >>> 0;
    let t = x;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe("the board", () => {
  it("snakes up from the bottom left to the top left, with a start for each seat below", () => {
    const place = (cell: number) => [Math.floor(cell / SNAKES_COLS), cell % SNAKES_COLS];
    expect(place(snakesCell(0, 1))).toEqual([9, 0]);
    expect(place(snakesCell(0, 10))).toEqual([9, 9]);
    expect(place(snakesCell(0, 11))).toEqual([8, 9]);
    expect(place(snakesCell(0, SNAKES_END))).toEqual([0, 0]);
    expect(place(snakesCell(2, 0))).toEqual([10, 2]);
    expect(new Set(Array.from({ length: SNAKES_END }, (_, i) => snakesCell(0, i + 1))).size).toBe(SNAKES_END);
  });

  it("has ladders that go up and snakes that go down, each across a row, none touching another", () => {
    for (const layout of [{ ladders: SNAKES_LADDERS, snakes: SNAKES_SNAKES }, ...Array.from({ length: 200 }, (_, i) => shuffledLayout(seeded(i)))]) {
      for (const [foot, top] of layout.ladders) expect(top).toBeGreaterThan(foot);
      for (const [head, tail] of layout.snakes) expect(tail).toBeLessThan(head);
      const all = [...layout.ladders, ...layout.snakes];
      for (const [a, b] of all) expect(Math.floor((a - 1) / 10)).not.toBe(Math.floor((b - 1) / 10));
      // None crosses another, so every one can be seen.
      for (const [a, b] of all) for (const [c, d] of all) if (a !== c) expect(crosses([a, b], [c, d]), `${a}-${b} and ${c}-${d}`).toBe(false);
      const squares = all.flat();
      expect(new Set(squares).size).toBe(squares.length);
      for (const square of squares) expect(square > 1 && square < SNAKES_END).toBe(true);
      expect(layout.snakes.filter(([head]) => head >= 94).length).toBeLessThanOrEqual(2);
    }
  });

  it("deals a shuffled board from the seed: the same seed the same board", () => {
    const a = start(shuffledSnakes, 2, 7);
    expect(start(shuffledSnakes, 2, 7).layout).toEqual(a.layout);
    expect(start(shuffledSnakes, 2, 8).layout).not.toEqual(a.layout);
    expect(a.layout.ladders.length).toBeGreaterThanOrEqual(6);
    expect(a.layout.snakes.length).toBeGreaterThanOrEqual(6);
  });

  it("numbers the squares, links the ladders and snakes, and leaves the snakes off a gentle board", () => {
    const board = g.view(start(), 0).grids[0]!;
    expect(board.rows).toBe(11);
    expect(board.tags![snakesCell(0, 37)]).toBe("37");
    expect(board.tags!.filter(Boolean)).toHaveLength(SNAKES_END);
    expect(board.links).toHaveLength(18);
    expect(board.links).toContainEqual({ from: snakesCell(0, 17), to: snakesCell(0, 4), kind: "snake", label: "snake from square 17 down to 4" });
    expect(board.cells[snakesCell(0, 3)]).toMatchObject({ owner: null, kind: "ladder", glyph: "↑39" });
    const gentle = g.view(start(gentleSnakes), 0).grids[0]!;
    expect(gentle.links!.every((l) => l.kind === "ladder")).toBe(true);
    expect(gentle.cells[snakesCell(0, 17)]).toBeNull();
  });
});

describe("a turn", () => {
  it("starts with everyone at the start and a roll to make", () => {
    const s = start({}, 3);
    expect(s.at).toEqual([0, 0, 0]);
    expect(offered(s)).toEqual([{ type: "roll" }]);
    expect(offered(s, 1)).toEqual([]);
    expect(g.view(s, 0).grids[0]!.cells[snakesCell(1, 0)]).toMatchObject({ owner: 1, id: "snakes-1" });
  });

  it("offers one die, the other, or both", () => {
    const s = rolled(start(), [3, 5], 52, 0);
    expect(snakesOptions(s, 0).map((o) => [o.by, o.to])).toEqual([[3, 55], [5, 57], [8, 60]]);
    const v = g.view(s, 0);
    expect(v.choices!.options.map((o) => o.move)).toEqual([{ type: "move", by: 3 }, { type: "move", by: 5 }, { type: "move", by: 8 }]);
    // On the board: pick the counter up and put it on the square the count comes to.
    expect(v.grids[0]!.select!.sources).toEqual([{ from: snakesCell(0, 52), to: [55, 57, 60].map((sq) => snakesCell(0, sq)) }]);
    const moved = g.apply(s, 0, { type: "move", from: snakesCell(0, 52), to: snakesCell(0, 57) });
    expect(moved.at[0]).toBe(57);
    expect(moved.turn).toBe(1);
  });

  it("takes a ladder up and a snake down, and says so", () => {
    const up = g.apply(rolled(start(), [1, 6], 19, 0), 0, { type: "move", by: 1 });
    expect(up.at[0]).toBe(41);
    expect(up.narration).toBe("{0} moves 1 and climbs the ladder from 20 to 41");
    const down = g.apply(rolled(start(), [3, 6], 14, 0), 0, { type: "move", by: 3 });
    expect(down.at[0]).toBe(4);
    expect(down.narration).toContain("slides down the snake from 17 to 4");
  });

  it("walks the trail square by square, then up the ladder", () => {
    const s = g.apply(rolled(start(), [1, 2], 17, 0), 0, { type: "move", by: 3 });
    expect(s.at[0]).toBe(41);
    const trail = g.view(s, 1).grids[0]!.trail!;
    expect(trail.key).toBe(1);
    expect(trail.paths).toEqual([{ id: "snakes-0", cells: [17, 18, 19, 20, 41].map((sq) => snakesCell(0, sq)), by: ["step", "step", "step", "ladder"] }]);
  });

  it("bounces back off 100, or with the exact count makes a roll too big no move", () => {
    const s = g.apply(rolled(start(), [5, 1], 96, 0), 0, { type: "move", by: 5 });
    expect(s.at[0]).toBe(62); // 96 + 5 = 101, back to 99: a snake's head.
    expect(g.view(s, 1).grids[0]!.trail!.paths[0]!.cells).toEqual([96, 97, 98, 99, 100, 99, 62].map((sq) => snakesCell(0, sq)));
    // Two counts that come to the same square are one way to go.
    expect(snakesOptions(rolled(start(), [4, 6], 95, 0), 0).map((o) => o.by)).toEqual([4, 10]);
    expect(snakesOptions(rolled(start({ finish: "exact" }), [4, 6], 96, 0), 0).map((o) => o.by)).toEqual([4]);
    // Nothing fits: the turn passes on the roll.
    let exact = start({ finish: "exact" });
    exact = { ...exact, at: [98, 0] };
    for (let seed = 0; seed < 200; seed++) {
      const r = g.apply({ ...exact, rng: seed }, 0, { type: "roll" });
      if (Math.min(...r.dice) > 2) {
        expect(r.at[0]).toBe(98);
        expect(r.turn).toBe(1);
        expect(r.narration).toContain("can't move");
        return;
      }
    }
    throw new Error("no roll too big found");
  });

  it("swaps places with anyone landed on", () => {
    const s = g.apply(rolled(start({}, 3), [2, 3], 10, 15, 15), 0, { type: "move", by: 5 });
    expect(s.at).toEqual([15, 10, 10]);
    expect(s.narration).toBe("{0} moves 5 to square 15 and swaps places with {1} and {2}");
    expect(g.view(s, 0).grids[0]!.trail!.paths.slice(1)).toEqual([
      { id: "snakes-1", cells: [snakesCell(0, 15), snakesCell(0, 10)], by: ["swap"] },
      { id: "snakes-2", cells: [snakesCell(0, 15), snakesCell(0, 10)], by: ["swap"] },
    ]);
    // Without swaps the counters share the square.
    const shared = g.apply(rolled(start({ bump: false }), [2, 3], 10, 15), 0, { type: "move", by: 5 });
    expect(shared.at).toEqual([15, 15]);
    expect(g.view(shared, 0).grids[0]!.cells[snakesCell(0, 15)]).toMatchObject({ count: 2, ids: ["snakes-0", "snakes-1"] });
  });

  it("rolls again on doubles, at most twice in a row", () => {
    let s = g.apply(rolled(start(), [3, 3], 40, 0), 0, { type: "move", by: 3 });
    expect([s.turn, s.phase, s.streak]).toEqual([0, "roll", 1]);
    expect(s.narration).toContain("Doubles: {0} rolls again");
    expect(g.view(s, 0).choices!.options[0]!.label).toBe("Roll again");
    s = g.apply({ ...s, phase: "move", dice: [2, 2] }, 0, { type: "move", by: 2 });
    expect([s.turn, s.streak]).toEqual([0, 2]);
    s = g.apply({ ...s, phase: "move", dice: [1, 1] }, 0, { type: "move", by: 1 });
    expect([s.turn, s.streak]).toEqual([1, 0]);
    // Not when the table says no.
    expect(g.apply(rolled(start({ again: false }), [3, 3], 40, 0), 0, { type: "move", by: 3 }).turn).toBe(1);
  });

  it("moves at once with one die, the classic way", () => {
    let s = start(classicSnakes);
    s = { ...s, at: [40, 0] };
    const r = g.apply(s, 0, { type: "roll" });
    expect(r.dice).toHaveLength(1);
    expect(r.at[0]).not.toBe(40);
    expect(r.moves).toBe(1);
    expect(g.view(r, 0).dice!.dice).toHaveLength(1);
  });

  it("ends when someone reaches 100", () => {
    const s = g.apply(rolled(start(), [2, 3], 95, 50), 0, { type: "move", by: 5 });
    expect(s.phase).toBe("finished");
    expect(g.view(s, 1).over).toEqual({ winners: [0], title: "{0} wins!" });
    expect(g.summary(s).winners).toEqual([0]);
    expect(() => g.apply(s, 1, { type: "roll" })).toThrow(GameError);
  });

  it("refuses moves out of turn, out of order, or not on offer", () => {
    const s = start();
    expect(() => g.apply(s, 1, { type: "roll" })).toThrow("It's not your turn.");
    expect(() => g.apply(s, 0, { type: "move", by: 3 })).toThrow("Roll the dice first.");
    expect(() => g.apply(rolled(s, [3, 5], 40, 0), 0, { type: "move", by: 4 })).toThrow("Move 3, 5 or 8.");
    expect(() => g.apply(rolled(s, [3, 5], 40, 0), 0, { type: "roll" })).toThrow(GameError);
  });

  it("never changes the state it is given", () => {
    const s = rolled(start(), [3, 5], 40, 0);
    const before = structuredClone(s);
    g.apply(s, 0, { type: "move", by: 8 });
    expect(s).toEqual(before);
  });
});

describe("the computer player", () => {
  it("takes the ladder over a plain square, and steps round a snake", () => {
    expect(g.bot(rolled(start(), [3, 5], 8, 0), 0, SHARP, () => 0.5)).toEqual({ type: "move", by: 3 });
    expect(g.bot(rolled(start(), [3, 4], 14, 0), 0, SHARP, () => 0.5)).not.toEqual({ type: "move", by: 3 });
  });

  it("plays whole games to an end, and plays the dice better than chance", () => {
    let wins = 0;
    const games = 400;
    for (let i = 0; i < games; i++) {
      let s = g.newGame(parlorSnakes, 2, i);
      const rand = seeded(i);
      for (let n = 0; n < 2000 && s.phase !== "finished"; n++) {
        const seat = s.turn;
        const move = seat === 0 ? g.bot(s, seat, SHARP, rand) : g.bot(s, seat, { skill: 0, sloppy: 1 }, rand);
        s = g.apply(s, seat, move!);
      }
      expect(s.phase).toBe("finished");
      if (g.summary(s).winners![0] === 0) wins += 1;
    }
    expect(wins / games).toBeGreaterThan(0.58);
  });

  it("is the same game every time from the same seed and moves", () => {
    const play = () => {
      let s = g.newGame(shuffledSnakes, 3, 99);
      const rand = seeded(5);
      for (let n = 0; n < 300 && s.phase !== "finished"; n++) s = g.apply(s, s.turn, g.bot(s, s.turn, SHARP, rand)!);
      return s;
    };
    expect(play()).toEqual(play());
  });
});

describe("rules", () => {
  it("normalizes old and partial rules to the parlor's", () => {
    expect(g.normalize({ id: "snakes-quick", pieces: 1 })).toMatchObject({ dice: "choice", board: "classic", bump: true });
    expect(g.normalize({ id: "snakes-classic" })).toMatchObject({ dice: "one", bump: false });
    expect(g.normalize(null)).toEqual(parlorSnakes);
  });
});

function offered(s: SnakesState, seat = 0) {
  return movesOffered(g.view(s, seat));
}

/** Whether two links, drawn straight from square to square, cross. */
function crosses([a, b]: readonly number[], [c, d]: readonly number[]): boolean {
  const at = (sq: number) => {
    const row = Math.floor((sq - 1) / 10);
    return [row % 2 === 0 ? (sq - 1) % 10 : 9 - ((sq - 1) % 10), row];
  };
  const [p1, p2, q1, q2] = [at(a!), at(b!), at(c!), at(d!)];
  const cross = (o: number[], x: number[], y: number[]) => (x[0]! - o[0]!) * (y[1]! - o[1]!) - (x[1]! - o[1]!) * (y[0]! - o[0]!);
  return cross(p1!, p2!, q1!) * cross(p1!, p2!, q2!) < 0 && cross(q1!, q2!, p1!) * cross(q1!, q2!, p2!) < 0;
}
