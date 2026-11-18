import { describe, expect, it } from "vitest";
import { bestMancalaMove, classicMancala, GameError, gentleMancala, mancala, mancalaCell, mancalaMoves, movesOffered, newMancala, type MancalaRules, type MancalaState } from "../src/index.js";

const g = mancala;
const SHARP = { skill: 1, sloppy: 0 };
type State = ReturnType<typeof g.newGame>;
const start = (rules: Partial<MancalaRules> = {}, seed = 1): State => g.newGame(g.normalize({ ...classicMancala, ...rules, first: rules.first === "random" && rules.id === undefined ? "random" : "seat1" }), 2, seed);
/** The same game with these seeds on the board: `mine` and `theirs` are the mover's row and the other's, each from the pit farthest from its store. */
function withBoard(s: State, mine: number[], theirs: number[], stores: [number, number] = [0, 0]): State {
  const next = structuredClone(s);
  next.pits[s.turn] = mine;
  next.pits[1 - s.turn] = theirs;
  next.stores[s.turn] = stores[0];
  next.stores[1 - s.turn] = stores[1];
  return next;
}
const sow = (s: State, pit: number) => g.apply(s, s.turn, { type: "sow", cell: mancalaCell(s.turn, pit - 1) });
const refused = (fn: () => unknown, message?: RegExp) => {
  expect(fn).toThrow(GameError);
  if (message) expect(fn).toThrow(message);
};

describe("sowing", () => {
  it("puts one seed in each pit to the right, and passes the turn", () => {
    const s = start();
    const next = sow(s, 1);
    expect(next.pits[0]).toEqual([0, 5, 5, 5, 5, 4]);
    expect(next.stores).toEqual([0, 0]);
    expect(next.turn).toBe(1);
    expect(next.narration).toBe("{0} sows 4 from pit 1");
    expect(next.last).toEqual({ seat: 0, pit: 0, end: { seat: 0, pit: 4 }, took: 0 });
  });

  it("goes through your store and on round the other row", () => {
    const next = sow(start(), 5);
    expect(next.pits[0]).toEqual([4, 4, 4, 4, 0, 5]);
    expect(next.stores).toEqual([1, 0]);
    expect(next.pits[1]).toEqual([5, 5, 4, 4, 4, 4]);
  });

  it("gives another turn for a last seed in your store, as often as it happens", () => {
    const one = sow(start(), 3);
    expect(one.stores).toEqual([1, 0]);
    expect(one.turn).toBe(0);
    expect(one.narration).toBe("{0} sows 4 from pit 3 and ends in the store. {0} goes again");
    expect(g.view(one, 0).players[0]!.badge).toBe("Goes again");
    const two = sow(one, 6);
    expect(two.turn).toBe(1);
  });

  it("misses out the other player's store on a long lap", () => {
    // Thirteen seeds go all the way round and back to the pit they came from.
    const s = withBoard(start(), [13, 0, 0, 0, 0, 0], [1, 1, 1, 1, 1, 1], [0, 5]);
    const next = sow(s, 1);
    expect(next.stores[1]).toBe(5);
    // One in each of its own other five, one in the store, one in each of theirs, and the last back home: a capture.
    expect(next.pits[1]).toEqual([2, 2, 2, 2, 2, 0]);
    expect(next.stores[0]).toBe(1 + 3);
    expect(next.last!.took).toBe(3);
  });

  it("can only be done from your own pits, with seeds in, on your turn", () => {
    const s = start();
    refused(() => g.apply(s, 0, { type: "sow", cell: mancalaCell(1, 2) }), /other side/);
    refused(() => g.apply(s, 1, { type: "sow", cell: mancalaCell(1, 2) }), /not your turn/);
    refused(() => g.apply(s, 0, { type: "sow", cell: 12 }), /not a pit/);
    refused(() => sow(withBoard(s, [0, 4, 4, 4, 4, 4], [4, 4, 4, 4, 4, 4]), 1), /empty/);
    expect(mancalaMoves(withBoard(s, [0, 4, 0, 4, 4, 4], [4, 4, 4, 4, 4, 4]), 0)).toEqual([1, 3, 4, 5]);
  });
});

describe("capturing", () => {
  it("takes what is across from a last seed in your own empty pit, and that seed", () => {
    const s = withBoard(start(), [1, 0, 3, 3, 3, 3], [2, 2, 2, 2, 7, 2]);
    const next = sow(s, 1);
    // Pit 2 is across from their pit 5 (their rows run the other way).
    expect(next.stores[0]).toBe(8);
    expect(next.pits[0]).toEqual([0, 0, 3, 3, 3, 3]);
    expect(next.pits[1]).toEqual([2, 2, 2, 2, 0, 2]);
    expect(next.narration).toBe("{0} sows 1 from pit 1 and captures 8");
    expect(next.turn).toBe(1);
    const marks = g.view(next, 0).grids[0]!.marks!;
    expect(marks).toContainEqual({ cell: mancalaCell(0, 1), mark: "last" });
    expect(marks).toContainEqual({ cell: mancalaCell(1, 4), mark: "threat" });
  });

  it("takes nothing when the pit across is empty, or the table plays without captures", () => {
    const empty = sow(withBoard(start(), [1, 0, 3, 3, 3, 3], [2, 2, 2, 2, 0, 2]), 1);
    expect(empty.stores[0]).toBe(0);
    expect(empty.pits[0]).toEqual([0, 1, 3, 3, 3, 3]);
    const gentle = sow(withBoard(start(gentleMancala), [1, 0, 3, 3, 3, 3], [2, 2, 2, 2, 7, 2]), 1);
    expect(gentle.stores[0]).toBe(0);
    expect(gentle.pits[1]![4]).toBe(7);
  });
});

describe("the end", () => {
  it("comes when a row is empty: what is left goes to its owner", () => {
    const s = withBoard(start(), [0, 0, 0, 0, 0, 1], [3, 0, 2, 0, 0, 4], [20, 18]);
    const done = sow(s, 6);
    expect(done.phase).toBe("finished");
    expect(done.stores).toEqual([21, 27]);
    expect(done.pits).toEqual([[0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0]]);
    expect(g.summary(done)).toMatchObject({ over: true, winners: [1], order: [1, 0], scoreLine: "21 to 27" });
    expect(g.view(done, 0).over).toEqual({ winners: [1], title: "{1} wins 27 to 21!" });
    expect(done.narration).toMatch(/A row is empty\. \{1\} wins 27 to 21$/);
    for (const seat of [0, 1]) expect(movesOffered(g.view(done, seat))).toEqual([]);
    refused(() => sow(done, 1), /over/);
  });

  it("can be a draw", () => {
    const done = sow(withBoard(start(), [0, 0, 0, 0, 0, 1], [1, 0, 0, 0, 0, 0], [23, 23]), 6);
    expect(g.summary(done)).toMatchObject({ over: true, winners: [0, 1] });
    expect(g.view(done, 1).over!.title).toBe("It's a draw: 24 all!");
  });

  it("plays a match game by game, taking turns to go first", () => {
    const s = withBoard(start({ games: 3 }), [0, 0, 0, 0, 0, 1], [3, 0, 2, 0, 0, 4], [20, 18]);
    const one = sow(s, 6);
    expect(one.phase).toBe("scored");
    expect(g.view(one, 0).result).toMatchObject({ title: "{1} wins game 1" });
    expect(movesOffered(g.view(one, 0))).toEqual([{ type: "next" }]);
    const two = g.apply(g.apply(one, 0, { type: "next" }), 1, { type: "next" });
    expect([two.round, two.first, two.turn, two.phase]).toEqual([2, 1, 1, "playing"]);
    expect(two.pits).toEqual([[4, 4, 4, 4, 4, 4], [4, 4, 4, 4, 4, 4]]);
    expect(two.wins).toEqual([0, 1]);
  });
});

describe("what a seat sees", () => {
  it("is its own row nearest it, its pits to tap, and the stores as reserves", () => {
    const s = start();
    const mine = g.view(s, 0);
    const theirs = g.view(s, 1);
    expect([mine.grids[0]!.rows, mine.grids[0]!.cols]).toEqual([2, 6]);
    expect(mine.grids[0]!.flip).toBe(false);
    expect(theirs.grids[0]!.flip).toBe(true);
    expect(mine.grids[0]!.tap).toEqual({ type: "sow", cells: [6, 7, 8, 9, 10, 11] });
    expect(theirs.grids[0]!.tap).toBeNull();
    expect(mine.grids[0]!.cells[6]).toMatchObject({ kind: "seeds", glyph: "4", count: 4, label: "4 seeds" });
    expect(mine.grids[0]!.names![6]).toBe("your pit 1");
    expect(theirs.grids[0]!.names![6]).toBe("their pit 1");
    expect(mine.reserves.map((r) => [r.owner, r.label, r.pieces[0]!.count])).toEqual([[0, "Store", 0], [1, "Store", 0]]);
    // An empty pit is an empty cell, and can't be tapped.
    const gap = g.view(withBoard(s, [0, 4, 4, 4, 4, 4], [4, 4, 4, 4, 4, 4]), 0);
    expect(gap.grids[0]!.cells[6]).toBeNull();
    expect(gap.grids[0]!.tap!.cells).toEqual([7, 8, 9, 10, 11]);
  });
});

describe("the computer player", () => {
  it("takes the extra turn and the capture when they are there", () => {
    const s = start();
    // Pit 3 has four seeds and is four from the store.
    expect(bestMancalaMove(s, 0, 1)).toBe(2);
    const capture = withBoard(s, [1, 0, 0, 0, 0, 2], [1, 1, 1, 1, 9, 1]);
    expect(bestMancalaMove(capture, 0, 2)).toBe(0);
    expect(g.bot(capture, 0, SHARP)).toEqual({ type: "sow", cell: mancalaCell(0, 0) });
    expect(g.bot(capture, 1, SHARP)).toBeNull();
  });

  it("beats a player who sows whatever is nearest", () => {
    let wins = 0;
    for (let seed = 1; seed <= 20; seed++) {
      let s = start({ first: "random" }, seed);
      for (let moves = 0; s.phase === "playing" && moves < 400; moves++) {
        s = s.turn === 0 ? g.apply(s, 0, g.bot(s, 0, SHARP)!) : sow(s, mancalaMoves(s, 1)[0]! + 1);
      }
      if (g.summary(s).winners?.length === 1 && g.summary(s).winners![0] === 0) wins++;
    }
    expect(wins).toBeGreaterThanOrEqual(18);
  });
});

describe("rules", () => {
  it("come out whole from anything", () => {
    expect(g.normalize({ seeds: 9, games: 2 })).toMatchObject({ seeds: 4, games: 1, captures: true, first: "random" });
    expect(g.normalize({ id: "mancala-gentle" })).toMatchObject({ captures: false });
    expect(g.describe(g.normalize(gentleMancala)).join(" ")).toMatch(/no captures/);
    expect(newMancala(classicMancala, 2, 1).pits.flat().reduce((a, b) => a + b, 0)).toBe(48);
  });
});
