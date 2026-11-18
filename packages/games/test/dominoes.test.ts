import { describe, expect, it } from "vitest";
import { bestDominoPlay, blockDominoes, dominoEnds, dominoEndSum, dominoes, dominoName, drawDominoes, fivesDominoes, GameError, movesOffered, newDominoes, type Domino, type DominoesRules, type DominoesState, type LaidDomino } from "../src/index.js";

const g = dominoes;
const SHARP = { skill: 1, sloppy: 0 };
const start = (rules: Partial<DominoesRules> = {}, seats = 2, seed = 1) => newDominoes(g.normalize({ ...drawDominoes, ...rules }), seats, seed);
const t = (...pairs: number[][]): Domino[] => pairs.map(([a, b]) => [Math.min(a!, b!), Math.max(a!, b!)] as Domino);
const laid = (...pairs: number[][]): LaidDomino[] => pairs.map(([a, b]) => ({ a: a!, b: b! }));
/** The same game in the middle of a round: this line on the table, these hands (the mover's first), and this boneyard. */
function table(s: DominoesState, line: LaidDomino[], hands: Domino[][], boneyard: Domino[] = []): DominoesState {
  const next = structuredClone(s);
  next.line = line;
  next.opener = null;
  next.held = null;
  next.last = line.length ? line.length - 1 : null;
  hands.forEach((hand, i) => (next.hands[(s.turn + i) % s.seats] = hand));
  next.boneyard = boneyard;
  return next;
}
const play = (s: DominoesState, index: number) => g.apply(s, s.turn, { type: "play", cell: index, grid: "hand" });
const end = (s: DominoesState, which: "left" | "right") => g.apply(s, s.turn, { type: "end", end: which });
const refused = (fn: () => unknown, message?: RegExp) => {
  expect(fn).toThrow(GameError);
  if (message) expect(fn).toThrow(message);
};

describe("the deal", () => {
  it("gives seven tiles each to two, five each to more, and the rest to the boneyard", () => {
    for (const [seats, each] of [[2, 7], [3, 5], [4, 5]] as const) {
      const s = start({}, seats);
      expect(s.hands.map((h) => h.length)).toEqual(Array(seats).fill(each));
      expect(s.boneyard).toHaveLength(28 - seats * each);
      const all = [...s.hands.flat(), ...s.boneyard].map(([a, b]) => `${a}-${b}`);
      expect(new Set(all).size).toBe(28);
    }
  });

  it("is opened by the highest double dealt, and by nothing else", () => {
    for (let seed = 1; seed <= 30; seed++) {
      const s = start({}, 3, seed);
      const doubles = s.hands.flat().filter(([a, b]) => a === b);
      const opener = s.opener!;
      if (doubles.length) expect(opener).toEqual([Math.max(...doubles.map((d) => d[0])), Math.max(...doubles.map((d) => d[0]))]);
      else expect(opener[0] + opener[1]).toBe(Math.max(...s.hands.flat().map(([a, b]) => a + b)));
      expect(s.hands[s.turn]).toContainEqual(opener);
      const v = g.view(s, s.turn);
      const index = s.hands[s.turn]!.findIndex(([a, b]) => a === opener[0] && b === opener[1]);
      expect(v.grids[1]!.tap).toEqual({ type: "play", cells: [index] });
      expect(v.choices!.prompt).toBe(`Lead with the ${dominoName(opener)}`);
      const other = s.hands[s.turn]!.findIndex((_, i) => i !== index);
      refused(() => play(s, other), /first tile has to be/);
      const next = play(s, index);
      expect(next.line).toEqual([{ a: opener[0], b: opener[1] }]);
      expect(next.turn).toBe((s.turn + 1) % 3);
    }
  });
});

describe("laying a tile", () => {
  it("goes on the end it matches, turned to meet it", () => {
    const s = table(start(), laid([6, 6], [6, 3]), [t([3, 5], [6, 2], [1, 1]), t([0, 0])]);
    const right = play(s, 0);
    expect(right.line.at(-1)).toEqual({ a: 3, b: 5 });
    expect(dominoEnds(right.line)).toEqual([6, 5]);
    expect(right.narration).toBe(`{${s.turn}} plays the five and three`);
    expect(right.hands[s.turn]).toHaveLength(2);
    expect(right.turn).toBe(1 - s.turn);
    const left = play(s, 1);
    expect(left.line[0]).toEqual({ a: 2, b: 6 });
    expect(left.last).toBe(0);
    expect(g.view(left, 0).grids[0]!.marks).toEqual([{ cell: 0, mark: "last" }]);
    refused(() => play(s, 2), /doesn't match either end/);
    refused(() => play(s, 7), /not one of your tiles/);
    refused(() => g.apply(s, 1 - s.turn, { type: "play", cell: 0 }), /not your turn/);
  });

  it("asks which end when a tile fits both, and takes the answer", () => {
    const s = table(start(), laid([6, 6], [6, 3]), [t([3, 6], [1, 1]), t([0, 0])]);
    const held = play(s, 0);
    expect(held.held).toBe(0);
    expect(held.line).toHaveLength(2);
    const v = g.view(held, s.turn);
    expect(v.choices!.prompt).toBe("Which end for the six and three?");
    expect(v.choices!.options.map((o) => o.move)).toEqual([{ type: "end", end: "left" }, { type: "end", end: "right" }, { type: "back" }]);
    expect(v.grids[1]!.marks).toEqual([{ cell: 0, mark: "from" }]);
    // Nobody else sees that a tile is in hand.
    expect(JSON.stringify(g.view(held, 1 - s.turn))).toBe(JSON.stringify(g.view(s, 1 - s.turn)));
    expect(end(held, "left").line[0]).toEqual({ a: 3, b: 6 });
    expect(end(held, "right").line.at(-1)).toEqual({ a: 3, b: 6 });
    // Tapped again, or put back, it is back in the hand.
    expect(play(held, 0).held).toBeNull();
    expect(g.apply(held, s.turn, { type: "back" }).held).toBeNull();
    refused(() => end(s, "left"), /Pick a tile first/);
    refused(() => g.apply(held, s.turn, { type: "end", end: "middle" } as never), /Choose an end/);
  });

  it("doesn't ask when both ends show the same number", () => {
    const s = table(start(), laid([4, 6], [6, 6], [6, 4]), [t([4, 1], [2, 2]), t([0, 0])]);
    const next = play(s, 0);
    expect(next.held).toBeNull();
    expect(next.line).toHaveLength(4);
  });
});

describe("when you can't play", () => {
  it("draws from the boneyard until a tile fits, then passes when it is empty", () => {
    const s = table(start(), laid([6, 6]), [t([1, 2], [3, 4]), t([0, 0], [6, 5])], t([6, 1], [2, 3]));
    const seat = s.turn;
    expect(movesOffered(g.view(s, seat))).toEqual([{ type: "draw" }]);
    refused(() => g.apply(s, seat, { type: "pass" }), /Draw from the boneyard first/);
    const one = g.apply(s, seat, { type: "draw" });
    expect(one.hands[seat]).toHaveLength(3);
    expect(one.turn).toBe(seat);
    expect(one.narration).toBe(`{${seat}} draws a tile`);
    expect(g.view(one, 1 - seat).players[seat]).toMatchObject({ line: "3 tiles · 0 points", badge: "Drew" });
    const two = g.apply(one, seat, { type: "draw" });
    // The six and one came off the boneyard last: now there is a tile to play, and no more drawing.
    expect(two.boneyard).toHaveLength(0);
    refused(() => g.apply(two, seat, { type: "draw" }), /can be played/);
    const dry = table(s, laid([6, 6]), [t([1, 2]), t([0, 0], [6, 5])]);
    expect(movesOffered(g.view(dry, seat))).toEqual([{ type: "pass" }]);
    refused(() => g.apply(dry, seat, { type: "draw" }), /empty/);
    expect(g.apply(dry, seat, { type: "pass" }).turn).toBe(1 - seat);
  });

  it("passes without drawing in the block game", () => {
    const s = table(start(blockDominoes), laid([6, 6]), [t([1, 2]), t([0, 0], [6, 5])], t([6, 1]));
    expect(movesOffered(g.view(s, s.turn))).toEqual([{ type: "pass" }]);
    refused(() => g.apply(s, s.turn, { type: "draw" }), /no drawing/);
    refused(() => g.apply(table(s, laid([6, 6]), [t([6, 2]), t([0, 0])]), s.turn, { type: "pass" }), /can be played/);
  });
});

describe("a round", () => {
  it("is won by playing your last tile, for the pips everyone else holds", () => {
    const s = table(start(), laid([6, 6], [6, 3]), [t([3, 5]), t([4, 4], [0, 1])]);
    const seat = s.turn;
    const done = play(s, 0);
    expect(done.phase).toBe("scored");
    expect(done.scores[seat]).toBe(9);
    expect(done.scored).toEqual({ winner: seat, points: 9, pips: seat === 0 ? [0, 9] : [9, 0], blocked: false });
    expect(done.narration).toBe(`{${seat}} plays the five and three. {${seat}} is out and scores 9`);
    const v = g.view(done, 1 - seat);
    expect(v.turn).toBeNull();
    expect(v.result).toMatchObject({ title: `{${seat}} wins round 1` });
    expect(v.players[seat]).toMatchObject({ line: "out · 9 points", badge: "Won the round" });
    expect(v.players[1 - seat]!.line).toBe("left with 9 · 0 points");
    expect(movesOffered(v)).toEqual([{ type: "next" }]);
    // Everyone moves on, and the winner leads the next round with whatever they like.
    const next = g.apply(g.apply(done, 0, { type: "next" }), 1, { type: "next" });
    expect([next.round, next.phase, next.turn, next.opener]).toEqual([2, "playing", seat, null]);
    expect(next.hands.map((h) => h.length)).toEqual([7, 7]);
    expect(g.view(next, seat).grids[1]!.tap!.cells).toHaveLength(7);
  });

  it("still goes to whoever is out when someone else holds only the double blank", () => {
    const s = table(start(), laid([6, 6], [6, 3]), [t([3, 5]), t([0, 0])]);
    const done = play(s, 0);
    expect(done.scored).toMatchObject({ winner: s.turn, points: 0 });
  });

  it("is blocked when nobody can play: the lightest hand scores the others less its own", () => {
    const s = table(start(blockDominoes, 3), laid([6, 6]), [t([1, 2]), t([3, 4], [1, 1]), t([2, 2])]);
    const [a, b, c] = [s.turn, (s.turn + 1) % 3, (s.turn + 2) % 3];
    const done = [a, b, c].reduce((at, seat) => g.apply(at, seat, { type: "pass" }), s);
    expect(done.phase).toBe("scored");
    expect(done.scored).toMatchObject({ winner: a, points: 9 + 4 - 3, blocked: true });
    expect(done.scores[a]).toBe(10);
    expect(done.narration).toBe(`The line is blocked. {${a}} has the lightest hand and scores 10`);
    expect(g.view(done, b).players[b]!.line).toBe("left with 9 · 0 points");
  });

  it("is nobody's when the two lightest hands are level, and the lead moves on", () => {
    const s = table(start(blockDominoes), laid([6, 6]), [t([1, 2]), t([0, 3])]);
    const lead = s.lead;
    const done = g.apply(g.apply(s, s.turn, { type: "pass" }), 1 - s.turn, { type: "pass" });
    expect(done.scored).toMatchObject({ winner: null, points: 0 });
    expect(done.scores).toEqual([0, 0]);
    expect(g.view(done, 0).result!.title).toBe("Round 1 is blocked: nobody scores");
    const next = g.apply(g.apply(done, 0, { type: "next" }), 1, { type: "next" });
    expect(next.lead).toBe(1 - lead);
  });

  it("ends the game when someone reaches the target", () => {
    const s = table({ ...start({ target: 50 }), scores: [45, 45] }, laid([6, 6], [6, 3]), [t([3, 5]), t([4, 4], [0, 1])]);
    const seat = s.turn;
    const done = play(s, 0);
    expect(done.phase).toBe("finished");
    expect(g.summary(done)).toMatchObject({ over: true, winners: [seat], order: [seat, 1 - seat], scoreLine: done.scores.join(" · ") });
    expect(g.view(done, 0).over).toEqual({ winners: [seat], title: `{${seat}} wins with 54!` });
    for (const i of [0, 1]) expect(movesOffered(g.view(done, i))).toEqual([]);
    refused(() => g.apply(done, 0, { type: "next" }), /over/);
  });
});

describe("All Fives", () => {
  it("counts the ends, a double for both its halves", () => {
    expect(dominoEndSum([])).toBe(0);
    expect(dominoEndSum(laid([5, 5]))).toBe(10);
    expect(dominoEndSum(laid([6, 4]))).toBe(10);
    expect(dominoEndSum(laid([5, 5], [5, 0]))).toBe(10);
    expect(dominoEndSum(laid([4, 6], [6, 6]))).toBe(16);
    expect(dominoEndSum(laid([3, 3], [3, 6], [6, 4]))).toBe(10);
  });

  it("scores ends that make a multiple of five, at once, and rounds a round to the nearest five", () => {
    const s = table(start(fivesDominoes), laid([4, 6], [6, 3]), [t([3, 1], [2, 2]), t([6, 6], [0, 1])]);
    const seat = s.turn;
    const five = play(s, 0);
    expect(five.scores[seat]).toBe(5);
    expect(five.narration).toBe(`{${seat}} plays the three and one: the ends make 5, and {${seat}} scores 5`);
    expect(g.view(five, 0).info).toContain("Ends: 4 and 1, making 5");
    // The same play scores nothing at a table that isn't playing fives.
    expect(play(table(start(), laid([4, 6], [6, 3]), [t([3, 1], [2, 2]), t([6, 6])]), 0).scores).toEqual([0, 0]);
    // Going out: 13 pips left across the table is 15.
    const out = play(table(start(fivesDominoes), laid([4, 6], [6, 3]), [t([3, 2]), t([6, 6], [0, 1])]), 0);
    expect(out.scores[seat]).toBe(15);
  });

  it("wins there and then when a score reaches the target", () => {
    const s = table({ ...start(fivesDominoes), scores: [145, 145] }, laid([4, 6], [6, 3]), [t([3, 1], [2, 2]), t([6, 6])]);
    const done = play(s, 0);
    expect(done.phase).toBe("finished");
    expect(g.summary(done).winners).toEqual([s.turn]);
  });
});

describe("what is hidden", () => {
  it("shows a seat its own tiles and nobody else's, whatever they are", () => {
    const s = table(start({}, 3), laid([6, 6], [6, 3]), [t([3, 5], [1, 1]), t([4, 4], [0, 1]), t([2, 2], [5, 5])], t([0, 0]));
    const seat = s.turn;
    const other = table(s, laid([6, 6], [6, 3]), [t([3, 5], [1, 1]), t([6, 5], [0, 2]), t([1, 2], [3, 3])], t([4, 5]));
    expect(JSON.stringify(g.view(other, seat))).toBe(JSON.stringify(g.view(s, seat)));
    expect(JSON.stringify(g.summary(other))).toBe(JSON.stringify(g.summary(s)));
    const v = g.view(s, seat);
    expect(v.grids.map((x) => [x.id, x.owner])).toEqual([["line", undefined], ["hand", seat]]);
    expect(v.grids[1]!.cells.map((p) => p!.glyph)).toEqual(["3|5", "1|1"]);
    expect(v.grids[0]!.cells.map((p) => p!.glyph)).toEqual(["6|6", "6|3"]);
    expect(v.grids[0]!.cells[1]).toMatchObject({ kind: "domino", label: "six and three", id: "domino-3-6" });
    expect(v.players.map((p) => p.line)).toEqual(Array(3).fill("2 tiles · 0 points"));
    expect(v.info).toContain("Boneyard: 1 tile");
  });
});

describe("the computer player", () => {
  it("sheds heavy tiles and doubles, keeps something to follow with, and goes out when it can", () => {
    const s = table(start(), laid([6, 6], [6, 3]), [t([3, 0], [3, 5], [5, 5]), t([0, 0])]);
    // The five and three leaves a five for the double five to follow.
    expect(bestDominoPlay(s, s.turn)).toEqual({ index: 1, end: "right" });
    expect(g.bot(s, s.turn, SHARP)).toEqual({ type: "play", cell: 1, grid: "hand" });
    expect(g.bot(s, 1 - s.turn, SHARP)).toBeNull();
    const last = table(start(), laid([6, 6], [6, 3]), [t([3, 0]), t([0, 0])]);
    expect(g.bot(last, last.turn, SHARP)).toEqual({ type: "play", cell: 0, grid: "hand" });
  });

  it("takes the fives when they are there, chooses an end for a tile in hand, and draws or passes when stuck", () => {
    // Ends of 4 and 3. The three and one would make 5; the six and three makes 10.
    const fives = table(start(fivesDominoes), laid([4, 6], [6, 3]), [t([3, 6], [3, 1], [0, 2]), t([0, 0])]);
    expect(bestDominoPlay(fives, fives.turn)).toEqual({ index: 0, end: "right" });
    // Ends of 3 and 5, and the five and three fits both: on the left it leaves two fives showing, ten.
    const held = play(table(start(fivesDominoes), laid([3, 6], [6, 5]), [t([3, 5], [0, 2]), t([0, 0])]), 0);
    expect(held.held).toBe(0);
    expect(g.bot(held, held.turn, SHARP)).toEqual({ type: "end", end: "left" });
    const stuck = table(start(), laid([6, 6]), [t([1, 2]), t([0, 0])], t([6, 1]));
    expect(g.bot(stuck, stuck.turn, SHARP)).toEqual({ type: "draw" });
    expect(g.bot(table(stuck, laid([6, 6]), [t([1, 2]), t([0, 0])]), stuck.turn, SHARP)).toEqual({ type: "pass" });
  });

  it("beats players who lay whatever comes first", () => {
    let wins = 0;
    for (let seed = 1; seed <= 40; seed++) {
      let s = start({ target: 100 }, 2, seed);
      for (let moves = 0; s.phase !== "finished" && moves < 4000; moves++) {
        const seat = [0, 1].find((i) => g.bot(s, i, SHARP) !== null)!;
        const offered = movesOffered(g.view(s, seat));
        // The other player presses the first button there is, or else lays the first tile that fits.
        s = g.apply(s, seat, (seat === 0 ? g.bot(s, seat, SHARP)! : (g.view(s, seat).choices?.options[0]?.move ?? offered[0])) as never);
      }
      if (g.summary(s).winners![0] === 0) wins++;
    }
    expect(wins).toBeGreaterThan(22);
  });
});

describe("rules", () => {
  it("come out whole from anything", () => {
    expect(g.normalize({ target: 77 })).toMatchObject({ target: 100, draw: true, fives: false });
    expect(g.normalize({ id: "dominoes-fives" })).toEqual(fivesDominoes);
    expect(g.describe(blockDominoes).join(" ")).toMatch(/there is no drawing/);
    expect(g.describe(fivesDominoes).join(" ")).toMatch(/to the nearest five/);
  });
});
