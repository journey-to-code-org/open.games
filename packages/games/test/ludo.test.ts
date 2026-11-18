import { describe, expect, it } from "vitest";
import { classicLudo, easyLudo, GameError, ludo, LUDO_HOME, LUDO_SIDE, ludoMoves, movesOffered, newLudo, openLudo, quickLudo, type LudoRules, type LudoState } from "../src/index.js";

const g = ludo;
const SHARP = { skill: 1, sloppy: 0 };
const start = (rules: Partial<LudoRules> = {}, seats = 2, seed = 1) => newLudo(g.normalize({ ...classicLudo, ...rules }), seats, seed);
const at = (row: number, col: number) => row * LUDO_SIDE + col;
/** The same game with the mover holding this roll, and these tokens: the mover's first, then the others round the table. */
function rolled(s: LudoState, die: number, ...tokens: number[][]): LudoState {
  const next = structuredClone(s);
  next.die = die;
  next.rolled = true;
  tokens.forEach((list, i) => (next.tokens[(s.turn + i) % s.seats] = list));
  return next;
}
/** Roll until the die shows what the test is after. */
function roll(s: LudoState, want: number): LudoState {
  for (let seed = 1; seed < 500; seed++) {
    const next = g.apply({ ...s, rng: seed }, s.turn, { type: "roll" });
    if (next.die === want) return next;
  }
  throw new Error(`never rolled ${want}`);
}
/** Move the mover's token that is `steps` along (-1: in the yard). */
function move(s: LudoState, steps: number): LudoState {
  const v = g.view(s, s.turn);
  const token = s.tokens[s.turn]!.indexOf(steps);
  for (const cell of v.grids[0]!.tap?.cells ?? []) {
    const next = g.apply(s, s.turn, { type: "move", cell });
    if (next.tokens[s.turn]![token] !== steps) return next;
  }
  throw new Error(`the token at ${steps} can't move`);
}
const refused = (fn: () => unknown, message?: RegExp) => {
  expect(fn).toThrow(GameError);
  if (message) expect(fn).toThrow(message);
};

describe("the board", () => {
  it("is a cross of 52 squares, four home columns and the yards of whoever is playing", () => {
    const v = g.view(start({}, 4), 0);
    const grid = v.grids[0]!;
    expect([grid.rows, grid.cols, grid.cells.length]).toEqual([15, 15, 225]);
    const shade = grid.shade as string[];
    // Track 52, home columns 4 × 6, yards 4 × 36; the middle's five other cells and nothing else are left out.
    expect(shade.filter((x) => x !== "none")).toHaveLength(52 + 24 + 144);
    expect(shade.filter((x) => x === "spot")).toHaveLength(4);
    // Each yard is a dark panel with a light place for each of its four tokens.
    expect(shade.filter((x) => x === "dark")).toHaveLength(4 * 32);
    expect(shade.filter((x) => x === "light")).toHaveLength(16);
    expect(shade[at(2, 2)]).toBe("light");
    expect(shade[at(7, 7)]).toBe("none");
    expect(grid.names![at(6, 1)]).toBe("red's start");
    expect(grid.names![at(2, 6)]).toBe("star, square 9");
    expect(grid.marks).toContainEqual({ cell: at(7, 3), mark: "claimed", owner: 0 });
    // Sixteen tokens in the yards.
    expect(grid.cells.filter(Boolean)).toHaveLength(16);
    expect(grid.cells[at(2, 2)]).toMatchObject({ owner: 0, kind: "token", tone: "red", id: "ludo-0-0" });
    // Two players sit in opposite corners, and the other two yards aren't there.
    const two = g.view(start(), 0).grids[0]!;
    expect((two.shade as string[])[at(2, 11)]).toBe("none");
    expect(two.cells[at(11, 11)]).toMatchObject({ owner: 1, tone: "green" });
    expect(g.view(start(openLudo), 0).grids[0]!.shade).not.toContain("spot");
  });
});

describe("rolling", () => {
  it("needs a six to bring a token out, and passes the turn without one", () => {
    const s = start();
    const seat = s.turn;
    expect(movesOffered(g.view(s, seat))).toEqual([{ type: "roll" }]);
    expect(movesOffered(g.view(s, 1 - seat))).toEqual([]);
    const three = roll(s, 3);
    expect(three.turn).toBe(1 - seat);
    expect(three.narration).toBe(`{${seat}} rolls a 3 and can't move`);
    const six = roll(s, 6);
    expect([six.turn, six.rolled]).toEqual([seat, true]);
    expect(ludoMoves(six, seat)).toEqual([0, 1, 2, 3]);
    expect(g.view(six, seat).grids[0]!.tap).toEqual({ type: "move", cells: seat === 0 ? [at(2, 2), at(2, 3), at(3, 2), at(3, 3)] : [at(11, 11), at(11, 12), at(12, 11), at(12, 12)] });
    refused(() => g.apply(six, seat, { type: "roll" }), /Move a token 6 first/);
    const out = move(six, -1);
    expect(out.tokens[seat]).toEqual([0, -1, -1, -1]);
    expect(out.narration).toBe(`{${seat}} brings a token out, and rolls again`);
    // A six goes again.
    expect([out.turn, out.rolled]).toEqual([seat, false]);
    expect(out.last).toEqual(seat === 0 ? { from: at(2, 2), to: at(6, 1) } : { from: at(11, 11), to: at(8, 13) });
  });

  it("lets a one bring a token out where the table says so", () => {
    expect(roll(start(easyLudo), 1).rolled).toBe(true);
    expect(roll(start(), 1).rolled).toBe(false);
  });

  it("passes the turn on a third six in a row", () => {
    const s = { ...start(), sixes: 2 };
    const third = roll(s, 6);
    expect(third.turn).toBe(1 - s.turn);
    expect(third.rolled).toBe(false);
    expect(third.narration).toMatch(/third six in a row/);
    expect(third.sixes).toBe(0);
  });

  it("rolls again on a six with nothing to move", () => {
    const s = structuredClone(start());
    s.tokens[s.turn] = [53, LUDO_HOME, LUDO_HOME, LUDO_HOME];
    const six = roll(s, 6);
    expect([six.turn, six.rolled]).toEqual([s.turn, false]);
    expect(six.narration).toMatch(/nothing to move, and rolls again/);
  });
});

describe("moving", () => {
  it("goes clockwise round the track, and the turn passes", () => {
    const s = rolled(start(), 4, [10, -1, -1, -1]);
    const next = move(s, 10);
    expect(next.tokens[s.turn]![0]).toBe(14);
    expect(next.turn).toBe(1 - s.turn);
    expect(next.narration).toBe(`{${s.turn}} moves 4`);
    refused(() => g.apply(s, s.turn, { type: "move", cell: at(7, 7) }), /don't have a token there/);
    // A token still in the yard (the mover's second) can't come out on a four.
    refused(() => g.apply(s, s.turn, { type: "move", cell: s.turn === 0 ? at(2, 3) : at(11, 12) }), /needs a six/);
    refused(() => g.apply(s, 1 - s.turn, { type: "move", cell: 0 }), /not your turn/);
    refused(() => g.apply({ ...s, rolled: false }, s.turn, { type: "move", cell: 0 }), /Roll the die first/);
  });

  it("turns up the home column after a lap, and needs the exact roll to get home", () => {
    const s = rolled(start({}, 2, 3), 3, [49, 54, -1, -1]);
    const seat = s.turn;
    const up = move(s, 49);
    expect(up.tokens[seat]![0]).toBe(52);
    // The home column is the mover's own: for the first corner, the middle row from the left.
    if (seat === 0) expect(up.last!.to).toBe(at(7, 2));
    // 54 and a three is one too many; a two is home.
    expect(ludoMoves(s, seat)).toEqual([0]);
    const home = move(rolled(s, 2, [49, 54, -1, -1]), 54);
    expect(home.tokens[seat]![1]).toBe(LUDO_HOME);
    expect(home.narration).toBe(`{${seat}} gets a token home`);
    expect(g.view(home, 0).players[seat]!.line).toBe("1 home · 2 in the yard");
  });

  it("stacks your own tokens on a square as one piece, and moves one of them", () => {
    const s = rolled(start(), 2, [10, 10, -1, -1]);
    const v = g.view(s, s.turn);
    const cell = v.grids[0]!.tap!.cells[0]!;
    expect(v.grids[0]!.tap!.cells).toHaveLength(1);
    expect(v.grids[0]!.cells[cell]).toMatchObject({ glyph: "2", count: 2, ids: [`ludo-${s.turn}-0`, `ludo-${s.turn}-1`] });
    const next = g.apply(s, s.turn, { type: "move", cell });
    expect([...next.tokens[s.turn]!].sort((a, b) => a - b)).toEqual([-1, -1, 10, 12]);
  });
});

describe("capturing", () => {
  // Two players are in opposite corners: 26 squares apart, so the first's 30 is the second's 4.
  it("sends a token you land on back to its yard", () => {
    const s = rolled(start(), 3, [27, -1, -1, -1], [4, -1, -1, -1]);
    const seat = s.turn;
    const next = move(s, 27);
    expect(next.tokens[1 - seat]).toEqual([-1, -1, -1, -1]);
    expect(next.tokens[seat]![0]).toBe(30);
    expect(next.narration).toBe(`{${seat}} moves 3 and sends {${1 - seat}}'s token back to the yard`);
  });

  it("can't be done on a star, or on someone's own start square", () => {
    // Their 8 is a star: the first's 34.
    const star = rolled(start(), 3, [31, -1, -1, -1], [8, -1, -1, -1]);
    expect(ludoMoves(star, star.turn)).toEqual([]);
    expect(ludoMoves(rolled(start(openLudo), 3, [31, -1, -1, -1], [8, -1, -1, -1]), star.turn)).toEqual([0]);
    // Their start square is the first's 26.
    expect(ludoMoves(rolled(start(openLudo), 3, [23, -1, -1, -1], [0, -1, -1, -1]), star.turn)).toEqual([]);
  });

  it("takes whoever is standing on your start square when you come out", () => {
    // The other player's token has come 26 squares: it is on the mover's start.
    const s = rolled(start(), 6, [-1, -1, -1, -1], [26, -1, -1, -1]);
    const next = move(s, -1);
    expect(next.tokens[1 - s.turn]![0]).toBe(-1);
    expect(next.narration).toMatch(/brings a token out and sends .* back to the yard, and rolls again/);
  });
});

describe("the end", () => {
  it("comes when one player has every token home", () => {
    const s = rolled(start({}, 3), 1, [55, LUDO_HOME, LUDO_HOME, LUDO_HOME], [20, 30, -1, -1], [5, -1, -1, -1]);
    const seat = s.turn;
    const done = move(s, 55);
    expect(done.phase).toBe("finished");
    expect(g.summary(done)).toMatchObject({ over: true, winners: [seat], order: [seat, (seat + 1) % 3, (seat + 2) % 3] });
    expect(g.view(done, 0).over).toEqual({ winners: [seat], title: `{${seat}} wins!` });
    for (const i of [0, 1, 2]) expect(movesOffered(g.view(done, i))).toEqual([]);
    refused(() => g.apply(done, seat, { type: "roll" }), /over/);
  });

  it("is two tokens each in the quick game", () => {
    const s = start(quickLudo, 4);
    expect(s.tokens.map((t) => t.length)).toEqual([2, 2, 2, 2]);
    expect(g.view(s, 0).info[0]).toBe("First to get both tokens home");
  });
});

describe("the computer player", () => {
  it("rolls, then captures, gets home or comes out before it just moves on", () => {
    const s = start();
    expect(g.bot(s, s.turn, SHARP)).toEqual({ type: "roll" });
    expect(g.bot(s, 1 - s.turn, SHARP)).toBeNull();
    const pick = (state: LudoState) => {
      const before = state.tokens[state.turn]!;
      const after = g.apply(state, state.turn, g.bot(state, state.turn, SHARP)!).tokens[state.turn]!;
      return before.findIndex((steps, i) => steps !== after[i]);
    };
    expect(pick(rolled(s, 3, [27, 40, -1, -1], [4, -1, -1, -1]))).toBe(0);
    expect(pick(rolled(s, 2, [10, 54, -1, -1], [-1, -1, -1, -1]))).toBe(1);
    expect(pick(rolled(s, 6, [10, -1, -1, -1], [-1, -1, -1, -1]))).toBe(1);
    // Someone is three squares behind the token at 30 (their 1 is the first's 27): it runs.
    expect(pick(rolled(s, 5, [30, 10, -1, -1], [1, -1, -1, -1]))).toBe(0);
  });

  it("beats players who move whatever comes first", () => {
    let wins = 0;
    for (let seed = 1; seed <= 40; seed++) {
      let s = start({}, 2, seed);
      for (let moves = 0; s.phase !== "finished" && moves < 5000; moves++) s = g.apply(s, s.turn, s.turn === 0 ? g.bot(s, 0, SHARP)! : movesOffered(g.view(s, 1))[0]!);
      if (g.summary(s).winners![0] === 0) wins++;
    }
    expect(wins).toBeGreaterThan(24);
  });
});

describe("rules", () => {
  it("come out whole from anything", () => {
    expect(g.normalize({ tokens: 3, enter: "two" })).toMatchObject({ tokens: 4, enter: "six", safe: true });
    expect(g.normalize({ id: "ludo-quick" })).toEqual(quickLudo);
    expect(g.describe(openLudo).join(" ")).not.toMatch(/on a star/);
  });
});
