import { describe, expect, it } from "vitest";
import { classicSnakes, gentleSnakes, GameError, movesOffered, snakes, type SnakesRules, type SnakesState } from "../src/index.js";

const g = snakes;
const SHARP = { skill: 1, sloppy: 0 };

const start = (rules: Partial<SnakesRules> = {}, seats = 2, seed = 1): SnakesState => g.newGame(g.normalize({ ...classicSnakes, ...rules }), seats, seed);

/** The same game with seat `turn` holding these dice, and seats' pieces where given (pieces[seat] = squares). */
function holding(s: SnakesState, dice: [number, number], pieces: Record<number, number[]> = {}): SnakesState {
  const next = structuredClone(s);
  next.turn = 0;
  next.phase = "move";
  next.dice = [...dice];
  next.spent = [false, false];
  for (const [seat, squares] of Object.entries(pieces)) next.pieces[Number(seat)] = [...squares];
  return next;
}

describe("snakes & ladders", () => {
  it("starts with every piece in the yard, and a roll to make", () => {
    const s = start();
    expect(s.pieces).toEqual([[0, 0], [0, 0]]);
    expect(s.phase).toBe("roll");
    expect(g.view(s, s.turn).choices?.options.map((o) => o.move)).toEqual([{ type: "roll" }]);
  });

  it("lets each die go on any piece, and offers one move for pieces on the same square", () => {
    const s = holding(start(), [2, 5], { 0: [0, 0], 1: [9] });
    const moves = g.view(s, 0).choices?.options.map((o) => o.move) ?? [];
    // Both yard pieces are one choice for each die: they are interchangeable.
    expect(moves).toEqual([
      { type: "move", from: 0, die: 0 },
      { type: "move", from: 0, die: 1 },
    ]);
  });

  it("moves a piece by the die, then the turn passes once both dice are spent", () => {
    let s = holding(start(), [2, 4], { 0: [0, 0] });
    s = g.apply(s, 0, { type: "move", from: 0, die: 0 });
    expect(s.pieces[0]).toEqual([2, 0]);
    expect(s.turn).toBe(0);
    s = g.apply(s, 0, { type: "move", from: 0, die: 1 });
    expect(s.pieces[0]).toEqual([2, 4]);
    expect(s.turn).toBe(1);
    expect(s.phase).toBe("roll");
  });

  it("refuses a move that would pass square 36, and lets the other die be used", () => {
    const s = holding(start(), [6, 2], { 0: [34, 0] });
    expect(() => g.apply(s, 0, { type: "move", from: 34, die: 0 })).toThrow(GameError);
    expect(movesOffered(g.view(s, 0)).filter((m) => m.from === 34)).toEqual([{ type: "move", from: 34, die: 1 }]);
  });

  it("takes a piece up a ladder and down a snake when it lands on one", () => {
    // Square 3 is the foot of a ladder to 12.
    let s = holding(start(), [3, 6], { 0: [0, 0] });
    s = g.apply(s, 0, { type: "move", from: 0, die: 0 });
    expect(s.pieces[0]).toEqual([12, 0]);
    // Square 17 is a snake's head down to 5.
    s = holding(start(), [6, 6], { 0: [11, 0] });
    s = g.apply(s, 0, { type: "move", from: 11, die: 0 });
    expect(s.pieces[0]![0]).toBe(5);
  });

  it("plays a gentle game with no snakes", () => {
    const s = holding(g.newGame(g.normalize(gentleSnakes), 2, 1), [6, 6], { 0: [11, 0] });
    const moved = g.apply(s, 0, { type: "move", from: 11, die: 0 });
    expect(moved.pieces[0]![0]).toBe(17);
  });

  it("sends a piece back to the yard when it lands on another player's piece", () => {
    let s = holding(start(), [4, 1], { 0: [0, 0], 1: [4, 0] });
    s = g.apply(s, 0, { type: "move", from: 0, die: 0 });
    expect(s.pieces[1]).toEqual([0, 0]);
    expect(s.narration).toMatch(/back to the yard/);
  });

  it("finishes the game when every piece is home", () => {
    const s = holding(start({ pieces: 1 }), [6, 1], { 0: [30] });
    const done = g.apply(s, 0, { type: "move", from: 30, die: 0 });
    expect(done.pieces[0]).toEqual([36]);
    expect(done.phase).toBe("finished");
    expect(g.view(done, 0).over?.winners).toEqual([0]);
  });

  it("throws the dice from the seeded random source, so the same seed gives the same game", () => {
    const a = g.apply(start({}, 2, 7), 0, { type: "roll" });
    const b = g.apply(start({}, 2, 7), 0, { type: "roll" });
    expect(a).toEqual(b);
    expect(a.dice).toHaveLength(2);
    expect(a.dice.every((d) => d >= 1 && d <= 6)).toBe(true);
  });

  it("never changes the state it is given", () => {
    const s = start({}, 2, 3);
    const before = structuredClone(s);
    g.apply(s, s.turn, { type: "roll" });
    expect(s).toEqual(before);
  });

  it("refuses a move from the wrong seat or before the dice are thrown", () => {
    const s = start({}, 2, 3);
    expect(() => g.apply(s, 1 - s.turn, { type: "roll" })).toThrow(GameError);
    expect(() => g.apply(s, s.turn, { type: "move", from: 0, die: 0 })).toThrow(GameError);
  });

  it("plays whole games with computer players to the end, for every preset", () => {
    for (const preset of g.presets) {
      for (const seats of [2, 3, 4]) {
        let s = g.newGame(preset, seats, 11);
        for (let i = 0; i < 4000 && !g.summary(s).over; i++) {
          const seat = s.turn;
          const move = g.bot(s, seat, SHARP);
          expect(move, `${preset.id} seat ${seat} has a move`).not.toBeNull();
          s = g.apply(s, seat, move!);
        }
        expect(g.summary(s).over, `${preset.id} with ${seats} seats finishes`).toBe(true);
      }
    }
  });
});
