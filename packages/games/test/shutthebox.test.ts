import { describe, expect, it } from "vitest";
import { classicShutTheBox, drinkingShutTheBox, GameError, movesOffered, newShutTheBox, shutTheBox, shutTheBoxOpen, shutTheBoxPlan, threeShutTheBox, twelveShutTheBox, type ShutTheBoxRules, type ShutTheBoxState } from "../src/index.js";

const g = shutTheBox;
const SHARP = { skill: 1, sloppy: 0 };
const CARELESS = { skill: 0, sloppy: 1 };
const start = (rules: Partial<ShutTheBoxRules> = {}, seats = 2, seed = 1) => newShutTheBox(g.normalize({ ...classicShutTheBox, ...rules }), seats, seed);
const roll = (s: ShutTheBoxState, dice?: number) => g.apply(s, s.turn, dice ? { type: "roll", dice } : { type: "roll" });
const shut = (s: ShutTheBoxState, ...tiles: number[]) => tiles.reduce((at, tile) => g.apply(at, at.turn, { type: "shut", cell: tile - 1 }), s);
/** The same game with the mover part way through a turn: these tiles open, and (with `rolled`) that roll to make. */
function withBox(s: ShutTheBoxState, open: number[], rolled = 0): ShutTheBoxState {
  return { ...structuredClone(s), open: s.open.map((_, i) => open.includes(i + 1)), rolls: 1, need: rolled, chosen: [], dice: rolled ? [Math.ceil(rolled / 2), Math.floor(rolled / 2)] : [1, 1] };
}
/** A roll from this box that comes to `total` (trying seeds until one does). */
function rolling(s: ShutTheBoxState, total: number, dice?: number): ShutTheBoxState {
  for (let seed = 1; seed < 2000; seed++) {
    const next = roll({ ...s, rng: seed }, dice);
    if (next.dice[0]! + next.dice[1]! === total) return next;
  }
  throw new Error(`never rolled ${total}`);
}
const tappable = (s: ShutTheBoxState) => (g.view(s, s.turn).grids[0]!.tap?.cells ?? []).map((c) => c + 1);
const refused = (fn: () => unknown, message?: RegExp) => {
  expect(fn).toThrow(GameError);
  if (message) expect(fn).toThrow(message);
};

describe("a roll", () => {
  it("has to be made from open tiles that add up to it", () => {
    const s = rolling(start(), 9);
    expect(s.need).toBe(9);
    // Any tile that is part of some way to make nine: 9, 8+1, 7+2, 6+3, 5+4, 6+2+1, 5+3+1, 4+3+2.
    expect(tappable(s)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    const one = shut(s, 4);
    expect(one.need).toBe(5);
    // Five more, without the 4: the 5, or 3 and 2 (4 and 1 is gone). The 4 can be opened again.
    expect(tappable(one)).toEqual([2, 3, 4, 5]);
    refused(() => shut(one, 1), /can't be part of 5/);
    refused(() => roll(one), /add up to 9 first/);
    const done = shut(one, 3, 2);
    expect(done.need).toBe(0);
    expect(done.open).toEqual([true, false, false, false, true, true, true, true, true]);
    expect(done.narration).toBe(`{${s.turn}} shuts 2, 3 and 4`);
    expect(done.turn).toBe(s.turn);
    expect(movesOffered(g.view(done, done.turn))).toEqual([{ type: "roll" }]);
  });

  it("lets a tile shut for this roll be opened again, and no other", () => {
    const one = shut(rolling(withBox(start(), [1, 2, 3, 4, 5, 6, 9]), 7), 4);
    expect(g.view(one, one.turn).grids[0]!.marks).toEqual([{ cell: 3, mark: "last" }]);
    const back = shut(one, 4);
    expect([back.need, back.open[3], back.chosen]).toEqual([7, true, []]);
    refused(() => shut(back, 8), /already shut/);
    refused(() => g.apply(back, back.turn, { type: "shut", cell: 12 }), /not a tile/);
  });

  it("only ever offers tiles that leave the roll makeable", () => {
    // 7 with 1, 2, 3, 6, 9 open: 6 and 1 only (3 and 2 would leave two more that nothing makes).
    const s = withBox(start(), [1, 2, 3, 6, 9], 7);
    expect(tappable(s)).toEqual([1, 6]);
    expect(tappable(shut(s, 1))).toEqual([1, 6]);
  });

  it("ends the turn when it can't be made, for what is left open", () => {
    const s = withBox(start(), [1, 2, 9]);
    const seat = s.turn;
    const over = rolling(s, 7);
    expect(over.turn).toBe(1 - seat);
    expect(over.played[seat]).toBe(12);
    expect(over.left[seat]).toBe(12);
    expect(over.narration).toBe(`{${seat}} rolls 7 and can't make it: 12 left`);
    // The box stays as it was left until the next player rolls, and then every tile is open again.
    expect(over.open.filter(Boolean)).toHaveLength(3);
    expect(g.view(over, 0).players[seat]!.line).toBe("left 12");
    expect(roll(over).open.filter(Boolean).length).toBeGreaterThanOrEqual(7);
  });

  it("can be one die once the open tiles add up to six or less", () => {
    const s = withBox(start(), [1, 2, 3]);
    expect(movesOffered(g.view(s, s.turn))).toEqual([{ type: "roll" }, { type: "roll", dice: 1 }]);
    const one = roll(s, 1);
    expect(one.dice[1]).toBe(0);
    expect(g.view(one, 0).dice!.dice).toHaveLength(1);
    refused(() => roll(withBox(start(), [3, 4]), 1), /6 or less/);
    refused(() => roll(start(), 1), /6 or less/);
    refused(() => roll(s, 3), /one die or two/);
  });

  it("shuts the box when the last tile goes down", () => {
    const s = withBox(start(), [3, 4], 7);
    const seat = s.turn;
    const done = shut(s, 3, 4);
    expect(done.played[seat]).toBe(0);
    expect(done.boxes[seat]).toBe(1);
    expect(done.narration).toBe(`{${seat}} shuts the box!`);
    expect(done.turn).toBe(1 - seat);
    expect(g.view(done, 0).players[seat]!.line).toBe("shut the box");
  });

  it("can't be made out of turn, or before rolling", () => {
    const s = start();
    refused(() => g.apply(s, 1 - s.turn, { type: "roll" }), /not your turn/);
    refused(() => shut(s, 3), /Roll the dice first/);
    expect(movesOffered(g.view(s, 1 - s.turn))).toEqual([]);
  });
});

describe("the game", () => {
  /** A whole turn for the mover that leaves these tiles open (the next roll can't be made). */
  const turnLeaving = (s: ShutTheBoxState, open: number[]) => {
    const box = withBox(s, open);
    const total = shutTheBoxOpen(box);
    // A roll bigger than everything open can never be made.
    for (let seed = 1; seed < 500; seed++) {
      const next = roll({ ...box, rng: seed });
      if (next.turn !== box.turn || next.round !== box.round || next.phase === "finished") return next;
    }
    throw new Error(`a box of ${total} was always made`);
  };

  it("goes to the lowest score after a turn each", () => {
    const s = start();
    const first = s.turn;
    const done = turnLeaving(turnLeaving(s, [1, 2]), [1]);
    expect(done.phase).toBe("finished");
    expect(done.left[first]).toBe(3);
    expect(done.left[1 - first]).toBe(1);
    expect(g.summary(done)).toMatchObject({ over: true, winners: [1 - first], order: [1 - first, first], hand: 1 });
    expect(g.view(done, 0).over).toEqual({ winners: [1 - first], title: `{${1 - first}} wins with 1 left!` });
    for (const i of [0, 1]) expect(movesOffered(g.view(done, i))).toEqual([]);
    refused(() => roll(done), /over/);
  });

  it("adds the rounds up, and the next round starts with the next player", () => {
    const s = start(threeShutTheBox);
    const first = s.turn;
    const one = turnLeaving(turnLeaving(s, [1, 2]), [1]);
    expect([one.phase, one.round, one.turn]).toEqual(["playing", 2, 1 - first]);
    expect(one.played).toEqual([null, null]);
    expect(g.view(one, 0).info).toContain("Round 2 of 3");
    const two = turnLeaving(turnLeaving(one, [1]), [1]);
    const three = turnLeaving(turnLeaving(two, [1]), [1]);
    expect(three.phase).toBe("finished");
    expect(three.left[first]).toBe(5);
    expect(three.left[1 - first]).toBe(3);
    expect(g.summary(three).scoreLine).toBe(three.left.join(" · "));
  });

  it("can be played alone, for a score", () => {
    const done = turnLeaving(start({}, 1), [1, 2]);
    expect(done.phase).toBe("finished");
    expect(g.view(done, 0).over).toEqual({ winners: [0], title: "{0} is left with 3" });
    expect(g.summary(done).scoreLine).toBe("3 left");
  });

  it("has twelve tiles in two rows when the table says so", () => {
    const v = g.view(start(twelveShutTheBox), 0);
    expect([v.grids[0]!.rows, v.grids[0]!.cols, v.grids[0]!.cells.length]).toEqual([2, 6, 12]);
    expect(tappable(rolling(start(twelveShutTheBox), 12))).toContain(12);
  });
});

describe("the computer player", () => {
  it("keeps its small tiles: the one tile that makes the roll, not several", () => {
    const s = withBox(start(), [1, 2, 3, 4, 5, 6, 7, 8, 9], 9);
    expect(shutTheBoxPlan(s)).toEqual({ shut: [9] });
    expect(g.bot(s, s.turn, SHARP)).toEqual({ type: "shut", cell: 8 });
    // Someone not thinking starts from the bottom.
    expect(g.bot(s, s.turn, CARELESS)).toEqual({ type: "shut", cell: 0 });
    expect(g.bot(s, 1 - s.turn, SHARP)).toBeNull();
  });

  it("finishes the set it started, a tile a move", () => {
    const s = withBox(start(), [1, 2, 3, 4], 7);
    const plan = shutTheBoxPlan(s) as { shut: number[] };
    expect(plan.shut.reduce((a, b) => a + b, 0)).toBe(7);
    let at = s;
    while (at.need > 0) at = g.apply(at, at.turn, g.bot(at, at.turn, SHARP)!);
    expect(at.open.filter(Boolean)).toHaveLength(4 - plan.shut.length);
  });

  it("rolls one die when that is the better chance", () => {
    // Only the 1 open: one die makes it one time in six, two dice never.
    expect(g.bot(withBox(start(), [1]), start().turn, SHARP)).toEqual({ type: "roll", dice: 1 });
    expect(shutTheBoxPlan(withBox(start(), [1, 2, 3, 4, 5, 6]))).toEqual({ dice: 2 });
    expect(g.bot(start(), start().turn, SHARP)).toEqual({ type: "roll" });
  });

  it("is left with less than someone who uses up the small tiles", () => {
    const average = (style: typeof SHARP) => {
      let total = 0;
      for (let seed = 1; seed <= 300; seed++) {
        let s = start({}, 1, seed);
        while (s.phase !== "finished") s = g.apply(s, 0, g.bot(s, 0, style)!);
        total += s.left[0]!;
      }
      return total / 300;
    };
    const sharp = average(SHARP);
    expect(sharp).toBeLessThan(average(CARELESS) - 5);
    expect(sharp).toBeLessThan(14);
  });
});

describe("drinking mode and rules", () => {
  it("costs a drink for being left with the most", () => {
    const s = withBox(start(drinkingShutTheBox), [1, 2]);
    const first = s.turn;
    let one: ShutTheBoxState | null = null;
    for (let seed = 1; seed < 500 && !one; seed++) {
      const next = roll({ ...s, rng: seed });
      if (next.turn !== first) one = next;
    }
    let two: ShutTheBoxState | null = null;
    for (let seed = 1; seed < 500 && !two; seed++) {
      const next = roll({ ...withBox(one!, [8, 9]), rng: seed });
      if (next.round === 2) two = next;
    }
    expect(two!.tally.drank[1 - first]).toBe(1);
    expect(two!.tally.drank[first]).toBe(0);
    expect(two!.narration).toContain("🍺");
  });

  it("come out whole from anything", () => {
    expect(g.normalize({ tiles: 10, rounds: 2 })).toMatchObject({ tiles: 9, rounds: 1, drinking: false });
    expect(g.normalize({ id: "shutthebox-twelve" })).toEqual(twelveShutTheBox);
    expect(g.describe(threeShutTheBox).join(" ")).toMatch(/3 turns/);
  });
});
