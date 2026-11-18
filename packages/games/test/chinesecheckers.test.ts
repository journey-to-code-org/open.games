import { describe, expect, it } from "vitest";
import { bestChineseCheckersMove, chineseCheckers, chineseCheckersMoves, classicChineseCheckers, GameError, movesOffered, newChineseCheckers, quickChineseCheckers, STAR_COLS, starDistance, type ChineseCheckersRules, type ChineseCheckersState } from "../src/index.js";

const g = chineseCheckers;
const SHARP = { skill: 1, sloppy: 0 };
const start = (rules: Partial<ChineseCheckersRules> = {}, seats = 2, seed = 1) => newChineseCheckers(g.normalize({ ...classicChineseCheckers, ...rules }), seats, seed);
const at = (row: number, col: number) => row * STAR_COLS + col;
/** The same game with the pegs here: the mover's first, then the others round the table. */
function withPegs(s: ChineseCheckersState, ...pegs: number[][]): ChineseCheckersState {
  const next = structuredClone(s);
  pegs.forEach((list, i) => (next.pegs[(s.turn + i) % s.seats] = list));
  return next;
}
const go = (s: ChineseCheckersState, from: number, to: number) => g.apply(s, s.turn, { type: "move", from, to });
const targets = (s: ChineseCheckersState, from: number) => chineseCheckersMoves(s, s.turn).find((m) => m.from === from)?.to ?? [];
const refused = (fn: () => unknown, message?: RegExp) => {
  expect(fn).toThrow(GameError);
  if (message) expect(fn).toThrow(message);
};

describe("the star", () => {
  it("has 121 holes on a grid of 17 by 25, and nothing where there is no hole", () => {
    const grid = g.view(start({}, 6), 0).grids[0]!;
    expect([grid.rows, grid.cols, grid.cells.length]).toEqual([17, 25, 425]);
    const shade = grid.shade as string[];
    expect(shade.filter((x) => x === "plain")).toHaveLength(121);
    expect(shade.filter((x) => x === "none")).toHaveLength(425 - 121);
    // The tips of the six points, and the middle.
    for (const cell of [at(0, 12), at(4, 0), at(4, 24), at(12, 0), at(12, 24), at(16, 12), at(8, 12)]) expect(shade[cell]).toBe("plain");
    expect(shade[at(0, 11)]).toBe("none");
    expect(shade[at(8, 3)]).toBe("none");
    // Six players: sixty pegs, every one in a point, and the middle empty.
    expect(grid.cells.filter(Boolean)).toHaveLength(60);
    expect(grid.cells[at(8, 12)]).toBeNull();
    expect(grid.marks!.filter((m) => m.mark === "claimed")).toHaveLength(60);
  });

  it("measures the steps between two holes", () => {
    expect(starDistance(at(8, 12), at(8, 16))).toBe(2);
    expect(starDistance(at(8, 12), at(7, 13))).toBe(1);
    expect(starDistance(at(0, 12), at(16, 12))).toBe(16);
    expect(starDistance(at(4, 0), at(12, 24))).toBe(16);
    expect(starDistance(at(4, 0), at(4, 24))).toBe(12);
  });

  it("seats everyone across from the point they are going to", () => {
    for (const seats of [2, 3, 4, 5, 6]) {
      const s = start({}, seats);
      expect(s.pegs.map((p) => p.length)).toEqual(Array(seats).fill(10));
      expect(new Set(s.pegs.flat()).size).toBe(seats * 10);
    }
    const two = start();
    // The first seat starts at the bottom and the second at the top, whose board is drawn turned round.
    expect(two.pegs[0]).toContain(at(16, 12));
    expect(two.pegs[1]).toContain(at(0, 12));
    expect(g.view(two, 0).grids[0]!.flip).toBe(false);
    expect(g.view(two, 1).grids[0]!.flip).toBe(true);
  });
});

describe("moving a peg", () => {
  it("steps one hole to an empty neighbour", () => {
    const s = withPegs(start(), [at(8, 12)], [at(0, 12)]);
    expect(targets(s, at(8, 12))).toEqual([at(7, 11), at(7, 13), at(8, 10), at(8, 14), at(9, 11), at(9, 13)]);
    const next = go(s, at(8, 12), at(7, 13));
    expect(next.pegs[s.turn]).toEqual([at(7, 13)]);
    expect(next.turn).toBe(1 - s.turn);
    expect(next.narration).toBe(`{${s.turn}} moves`);
    expect(next.last).toEqual({ from: at(8, 12), to: at(7, 13), via: [] });
  });

  it("jumps over one peg into the empty hole beyond, and goes on jumping", () => {
    // A peg to jump on the row, and another diagonally on from where that lands.
    const s = withPegs(start(), [at(8, 8), at(8, 10)], [at(7, 13), at(0, 12)]);
    expect(targets(s, at(8, 8))).toContain(at(8, 12));
    expect(targets(s, at(8, 8))).toContain(at(6, 14));
    const one = go(s, at(8, 8), at(8, 12));
    expect(one.narration).toBe(`{${s.turn}} jumps`);
    const two = go(s, at(8, 8), at(6, 14));
    expect(two.narration).toBe(`{${s.turn}} jumps 2 times`);
    expect(two.last).toEqual({ from: at(8, 8), to: at(6, 14), via: [at(8, 12)] });
    // Nothing is taken: every peg is still there.
    expect(two.pegs.flat()).toHaveLength(4);
    // It can't jump two pegs at once, or land on one.
    const blocked = withPegs(start(), [at(8, 8), at(8, 10), at(8, 12)], [at(0, 12)]);
    expect(targets(blocked, at(8, 8))).not.toContain(at(8, 12));
    expect(targets(blocked, at(8, 8))).not.toContain(at(8, 14));
  });

  it("can pass through another point but not stop there", () => {
    // Two players use the top and bottom points. A hole in the left-hand point is next door, and is no place to stop.
    const s = withPegs(start(), [at(8, 8)], [at(0, 12)]);
    const seat = s.turn;
    const near = withPegs(s, [at(7, 3)], [at(seat === 0 ? 0 : 16, 12)]);
    expect(targets(near, at(7, 3))).not.toContain(at(7, 1));
    expect(targets(near, at(7, 3))).toContain(at(7, 5));
    refused(() => go(near, at(7, 3), at(7, 1)), /can't get there/);
  });

  it("is refused out of turn, from a hole that isn't yours, or to nowhere", () => {
    const s = start();
    const mine = s.pegs[s.turn]![0]!;
    refused(() => g.apply(s, 1 - s.turn, { type: "move", from: s.pegs[1 - s.turn]![0]!, to: at(8, 12) }), /not your turn/);
    refused(() => go(s, at(8, 12), at(8, 14)), /don't have a peg there/);
    refused(() => go(s, mine, at(8, 12)), /can't get there/);
    refused(() => go(s, mine, 9999), /can't get there/);
    // Each player opens with fourteen moves: six steps and eight jumps out of the point.
    expect(movesOffered(g.view(s, s.turn))).toHaveLength(14);
    expect(movesOffered(g.view(s, 1 - s.turn))).toEqual([]);
  });
});

describe("the end", () => {
  const top = [at(0, 12), at(1, 11), at(1, 13), at(2, 10), at(2, 12), at(2, 14), at(3, 9), at(3, 11), at(3, 13), at(3, 15)];
  const bottom = top.map((cell) => at(16 - Math.floor(cell / STAR_COLS), cell % STAR_COLS));

  it("comes when the point across is full of your pegs", () => {
    const s = start();
    const seat = s.turn;
    const goal = seat === 0 ? top : bottom;
    const row = seat === 0 ? 4 : 12;
    // Nine home, and the tenth one step away.
    const nearly = withPegs(s, [...goal.slice(0, 9), at(row, 14)], [at(8, 4)]);
    expect(g.view(nearly, 0).players[seat]!.line).toBe("9 of 10 home");
    const done = go(nearly, at(row, 14), goal[9]!);
    expect(done.phase).toBe("finished");
    expect(g.summary(done)).toMatchObject({ over: true, winners: [seat], order: [seat, 1 - seat] });
    expect(g.view(done, 0).over).toEqual({ winners: [seat], title: `{${seat}} is home, and wins!` });
    for (const i of [0, 1]) expect(movesOffered(g.view(done, i))).toEqual([]);
    refused(() => go(done, goal[0]!, at(8, 12)), /over/);
  });

  it("can't be stopped by a peg that never left home: a full point with one of yours in it is enough", () => {
    const s = start();
    const seat = s.turn;
    const goal = seat === 0 ? top : bottom;
    const row = seat === 0 ? 4 : 12;
    const squat = withPegs(s, [...goal.slice(1, 9), at(row, 14), at(8, 20)], [goal[0]!, at(8, 4)]);
    const done = go(squat, at(row, 14), goal[9]!);
    expect(done.phase).toBe("finished");
    expect(g.summary(done).winners).toEqual([seat]);
  });

  it("is called when the turns run out, for whoever has most home and then is nearest", () => {
    const s = start(quickChineseCheckers);
    const seat = s.turn;
    const goal = seat === 0 ? top : bottom;
    const last = { ...withPegs(s, [...goal.slice(0, 3), at(8, 12)], [at(8, 4), at(8, 6)]), moves: 99, turn: 1 - seat };
    const done = g.apply(last, 1 - seat, { type: "move", from: at(8, 6), to: at(8, 8) });
    expect(done.phase).toBe("finished");
    expect(done.ended).toBe("turns");
    expect(done.narration).toMatch(/That's 50 turns each$/);
    expect(g.summary(done)).toMatchObject({ over: true, winners: [seat], scoreLine: seat === 0 ? "3 · 0" : "0 · 3" });
    expect(g.view(done, 0).over!.title).toBe(`{${seat}} wins with 3 home!`);
    expect(g.view({ ...last, moves: 82 }, 0).info).toContain("9 turns each left");
  });
});

describe("the computer player", () => {
  it("takes the longest run towards the point across, and doesn't leave it once in", () => {
    const s = withPegs(start(), [at(8, 8), at(8, 10)], [at(0, 12)]);
    const seat = s.turn;
    const best = bestChineseCheckersMove(s, seat)!;
    const tip = seat === 0 ? at(0, 12) : at(16, 12);
    // Whatever it picks gets a peg nearer the far tip.
    expect(starDistance(best.to, tip)).toBeLessThan(starDistance(best.from, tip));
    expect(g.bot(s, 1 - seat, SHARP)).toBeNull();
    expect(g.bot(s, seat, SHARP)).toMatchObject({ type: "move" });
    // A peg already home stays; the one outside comes on.
    const goal = seat === 0 ? at(1, 11) : at(15, 11);
    const outside = at(8, 12);
    expect(bestChineseCheckersMove(withPegs(s, [goal, outside], [at(8, 4)]), seat)!.from).toBe(outside);
  });

  it("gets across the board against a player who moves at random", () => {
    let wins = 0;
    for (let seed = 1; seed <= 6; seed++) {
      let s = start({}, 2, seed);
      let n = seed;
      const rand = () => ((n = (n * 1103515245 + 12345) >>> 0) / 2 ** 32);
      while (s.phase !== "finished") {
        const offered = movesOffered(g.view(s, s.turn));
        s = g.apply(s, s.turn, (s.turn === 0 ? g.bot(s, 0, SHARP)! : offered[Math.floor(rand() * offered.length)]) as never);
      }
      if (g.summary(s).winners![0] === 0 && s.ended === "home") wins++;
    }
    expect(wins).toBe(6);
  });
});

describe("rules", () => {
  it("come out whole from anything", () => {
    expect(g.normalize({ turns: 7 })).toMatchObject({ turns: 100 });
    expect(g.normalize({ id: "chinesecheckers-quick" })).toEqual(quickChineseCheckers);
    expect(g.describe(quickChineseCheckers).join(" ")).toMatch(/after 50 turns each/);
  });
});
