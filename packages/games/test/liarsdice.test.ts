import { describe, expect, it } from "vitest";
import { classicLiarsDice, drinkingLiarsDice, GameError, liarsDice, liarsDiceBids, liarsDiceChance, movesOffered, newLiarsDice, plainLiarsDice, quickLiarsDice, type LiarsDiceRules, type LiarsDiceState } from "../src/index.js";

const g = liarsDice;
const SHARP = { skill: 1, sloppy: 0 };
const start = (rules: Partial<LiarsDiceRules> = {}, seats = 3, seed = 1) => newLiarsDice(g.normalize({ ...classicLiarsDice, ...rules }), seats, seed);
/** The same game with these dice under the cups (a seat with none is out). */
const withHands = (s: LiarsDiceState, hands: number[][], turn = s.turn): LiarsDiceState => ({ ...structuredClone(s), hands, turn });
const bid = (s: LiarsDiceState, count: number, face: number) => g.apply(s, s.turn, { type: "bid", count, face });
const liar = (s: LiarsDiceState) => g.apply(s, s.turn, { type: "liar" });
/** Everyone looks and moves on. */
const next = (s: LiarsDiceState) => Array.from({ length: s.seats }, (_, i) => i).reduce((at, seat) => g.apply(at, seat, { type: "next" }), s);
const refused = (fn: () => unknown, message?: RegExp) => {
  expect(fn).toThrow(GameError);
  if (message) expect(fn).toThrow(message);
};

describe("bidding", () => {
  it("goes round the table, each bid higher than the last", () => {
    const s = withHands(start(), [[1, 2, 3, 4, 5], [2, 2, 3, 6, 6], [1, 1, 4, 5, 6]], 0);
    const one = bid(s, 3, 4);
    expect(one.bid).toEqual({ seat: 0, count: 3, face: 4 });
    expect(one.turn).toBe(1);
    expect(one.narration).toBe("{0} bids 3 fours");
    // As many of a higher number, or more of any.
    expect(bid(one, 3, 5).bid).toMatchObject({ count: 3, face: 5 });
    expect(bid(one, 4, 1).bid).toMatchObject({ count: 4, face: 1 });
    refused(() => bid(one, 3, 4), /higher than 3 fours/);
    refused(() => bid(one, 3, 2), /higher than 3 fours/);
    refused(() => bid(one, 2, 6), /higher than 3 fours/);
    refused(() => bid(one, 16, 2), /only 15 dice/);
    refused(() => bid(one, 4, 7), /one to six/);
    refused(() => bid(one, 0, 5), /at least one/);
    refused(() => g.apply(one, 0, { type: "bid", count: 5, face: 5 }), /not your turn/);
  });

  it("offers every number at the lowest quantity that outbids, and the next two up", () => {
    const s = withHands(start(), [[1, 2, 3, 4, 5], [2, 2, 3, 6, 6], [1, 1, 4, 5, 6]], 0);
    expect(liarsDiceBids(s)).toHaveLength(18);
    expect(liarsDiceBids(s)[0]).toEqual({ count: 1, face: 1 });
    // No call to make before there is a bid.
    expect(movesOffered(g.view(s, 0)).map((m) => m.type)).not.toContain("liar");
    const one = bid(s, 3, 4);
    const offered = liarsDiceBids(one);
    expect(offered.slice(0, 3)).toEqual([{ count: 3, face: 5 }, { count: 3, face: 6 }, { count: 4, face: 1 }]);
    expect(offered).toHaveLength(2 + 6 + 6);
    const v = g.view(one, 1);
    expect(v.choices!.options[0]).toMatchObject({ label: "Liar!", move: { type: "liar" }, primary: true });
    expect(v.choices!.options[1]).toMatchObject({ label: "3 fives", move: { type: "bid", count: 3, face: 5 } });
    expect(v.choices!.layout).toBe("grid");
    expect(movesOffered(g.view(one, 0))).toEqual([]);
    // After sixes the next quantity is the lowest; with every die bid there is only the call.
    expect(liarsDiceBids(bid(s, 3, 6))[0]).toEqual({ count: 4, face: 1 });
    expect(liarsDiceBids(bid(s, 15, 6))).toEqual([]);
    expect(movesOffered(g.view(bid(s, 15, 6), 1))).toEqual([{ type: "liar" }]);
    expect(liarsDiceBids(bid(s, 14, 3)).at(-1)).toEqual({ count: 15, face: 6 });
  });
});

describe("a call", () => {
  const table = () => withHands(start(), [[1, 2, 3, 4, 5], [2, 2, 3, 6, 6], [1, 1, 4, 5, 6]], 0);

  it("costs the bidder a die when there are fewer than the bid", () => {
    // Fives, with ones wild: 1 and 5, none, 1, 1 and 5: five in all.
    const called = liar(bid(table(), 6, 5));
    expect(called.phase).toBe("reveal");
    expect(called.called).toMatchObject({ caller: 1, found: 5, loser: 0 });
    expect(called.narration).toBe("{1} calls {0} a liar on 6 fives: there are 5 fives, so {0} loses a die");
    // The die goes when everyone has looked, and the loser bids first.
    expect(called.hands[0]).toHaveLength(5);
    const round = next(called);
    expect(round.phase).toBe("bidding");
    expect(round.hands.map((h) => h.length)).toEqual([4, 5, 5]);
    expect([round.round, round.turn, round.bid]).toEqual([2, 0, null]);
    expect(round.hands).not.toEqual(called.hands);
  });

  it("costs the caller a die when the bid was good", () => {
    const called = liar(bid(table(), 5, 5));
    expect(called.called).toMatchObject({ found: 5, loser: 1 });
    expect(next(called).hands.map((h) => h.length)).toEqual([5, 4, 5]);
    expect(next(called).turn).toBe(1);
  });

  it("counts ones as ones only when ones are bid, and not at all without wilds", () => {
    expect(liar(bid(table(), 4, 1)).called).toMatchObject({ found: 3, loser: 0 });
    const plain = liar(bid(withHands(start(plainLiarsDice), table().hands, 0), 3, 5));
    expect(plain.called).toMatchObject({ found: 2, loser: 0 });
    expect(plain.narration).toMatch(/there are 2 fives/);
    expect(liar(bid(withHands(start(plainLiarsDice), [[2], [3], [4]], 0), 1, 5)).narration).toMatch(/there are no fives/);
  });

  it("lifts every cup for everyone until they move on", () => {
    const called = liar(bid(table(), 6, 5));
    for (const seat of [0, 1, 2]) {
      const v = g.view(called, seat);
      expect(v.turn).toBeNull();
      expect(v.players.map((p) => p.line)).toEqual(["1 2 3 4 5", "2 2 3 6 6", "1 1 4 5 6"]);
      expect(v.players[0]!.badge).toBe("Loses a die");
      expect(movesOffered(v)).toEqual([{ type: "next" }]);
    }
    const one = g.apply(called, 2, { type: "next" });
    expect(one.phase).toBe("reveal");
    expect(movesOffered(g.view(one, 2))).toEqual([]);
    expect(g.view(one, 0).players[2]!.badge).toBe("Ready");
    refused(() => g.apply(one, 2, { type: "next" }), /Waiting/);
    refused(() => bid(called, 7, 5), /cups are up/);
    refused(() => g.apply(table(), 0, { type: "next" }), /nothing to move on from/);
    refused(() => liar(table()), /no bid to call/);
  });
});

describe("going out, and the end", () => {
  it("puts a player with no dice out, and passes the first bid on", () => {
    const s = withHands(start(), [[4], [2, 2, 3], [6, 6]], 0);
    const round = next(liar(bid(s, 3, 4)));
    expect(round.hands[0]).toEqual([]);
    expect(round.out).toEqual([0]);
    expect(round.turn).toBe(1);
    const v = g.view(round, 0);
    expect(v.players[0]).toMatchObject({ line: "out", out: true });
    expect(v.dice!.dice).toEqual([]);
    expect(movesOffered(v)).toEqual([]);
    // The bidding skips them.
    expect(bid(bid(round, 1, 2), 1, 3).turn).toBe(1);
  });

  it("is over at once when a call leaves one player with dice", () => {
    const s = withHands({ ...start(), out: [0] }, [[], [3], [6]], 1);
    const done = liar(bid(s, 1, 4));
    expect(done.phase).toBe("finished");
    expect(g.summary(done)).toMatchObject({ over: true, winners: [2], order: [2, 1, 0] });
    for (const seat of [0, 1, 2]) {
      const v = g.view(done, seat);
      expect(v.over).toEqual({ winners: [2], title: "{2} wins!" });
      // The last cups stay lifted.
      expect(v.players.map((p) => p.line)).toEqual(["out", "3", "6"]);
      expect(movesOffered(v)).toEqual([]);
    }
    refused(() => bid(done, 1, 5), /over/);
  });
});

describe("what is hidden", () => {
  it("shows a seat its own dice and nobody else's, whatever they are", () => {
    const s = bid(withHands(start(), [[1, 2, 3, 4, 5], [2, 2, 3, 6, 6], [1, 1, 4, 5, 6]], 0), 2, 3);
    const other = withHands(s, [[1, 2, 3, 4, 5], [5, 5, 5, 5, 5], [6, 6, 6, 6, 6]], s.turn);
    expect(JSON.stringify(g.view(other, 0))).toBe(JSON.stringify(g.view(s, 0)));
    expect(g.view(s, 0).dice).toMatchObject({ owner: 0, dice: [1, 2, 3, 4, 5].map((value, id) => ({ id, value })) });
    expect(g.view(s, 1).dice!.dice.map((d) => d.value)).toEqual([2, 2, 3, 6, 6]);
    // Nothing public gives the dice away either.
    expect(JSON.stringify(g.summary(other))).toBe(JSON.stringify(g.summary(s)));
    // Dice from the round before stay hidden once the cups are back down.
    const again = next(liar(s));
    const moved = withHands(again, [again.hands[0]!, again.hands[1]!.map(() => 4), again.hands[2]!.map(() => 4)]);
    expect(JSON.stringify(g.view(moved, 0))).toBe(JSON.stringify(g.view(again, 0)));
  });
});

describe("the computer player", () => {
  it("knows the odds from its own dice and how many it can't see", () => {
    const s = withHands(start(), [[5, 5, 5, 1, 2], [2, 2, 3, 6, 6], [1, 1, 4, 5, 6]], 0);
    // Four of its own count as fives; ten dice it can't see, a third of them fives or ones.
    expect(liarsDiceChance(s, 0, { count: 4, face: 5 })).toBe(1);
    expect(liarsDiceChance(s, 0, { count: 15, face: 5 })).toBeLessThan(0.001);
    expect(liarsDiceChance(s, 0, { count: 7, face: 5 })).toBeCloseTo(0.7009, 3);
    // Ones bid as ones: one of its own, and a sixth of the rest.
    expect(liarsDiceChance(s, 0, { count: 3, face: 1 })).toBeCloseTo(0.5155, 3);
    // The same for a seat whose dice are different, without looking at anyone else's.
    expect(liarsDiceChance(withHands(s, [[5, 5, 5, 1, 2], [4, 4, 4, 4, 4], [4, 4, 4, 4, 4]]), 0, { count: 7, face: 5 })).toBeCloseTo(0.7009, 3);
  });

  it("opens on what it holds, calls a bid that can't be true, and raises one that is likely", () => {
    const s = withHands(start(), [[5, 5, 5, 1, 2], [2, 2, 3, 6, 6], [1, 1, 4, 5, 6]], 0);
    const open = g.bot(s, 0, SHARP) as { type: "bid"; count: number; face: number };
    expect(open).toMatchObject({ type: "bid", face: 5 });
    expect(liarsDiceChance(s, 0, open)).toBeGreaterThanOrEqual(0.6);
    expect(g.bot(s, 1, SHARP)).toBeNull();
    expect(g.bot(bid(bid(bid(s, 2, 2), 2, 3), 12, 3), 0, SHARP)).toEqual({ type: "liar" });
    const raise = g.bot(bid(bid(bid(s, 2, 2), 2, 3), 3, 3), 0, SHARP)!;
    expect(raise.type).toBe("bid");
    // With every die bid there is nothing left but the call.
    expect(g.bot(bid(s, 15, 6), 1, SHARP)).toEqual({ type: "liar" });
  });

  it("moves on after a call, once", () => {
    const called = liar(bid(withHands(start(), [[1, 2, 3, 4, 5], [2, 2, 3, 6, 6], [1, 1, 4, 5, 6]], 0), 6, 5));
    expect(g.bot(called, 0, SHARP)).toEqual({ type: "next" });
    expect(g.bot(g.apply(called, 0, { type: "next" }), 0, SHARP)).toBeNull();
  });

  it("beats players who bid and call without looking", () => {
    let wins = 0;
    const dice = (seed: number) => {
      let n = seed;
      return () => ((n = (n * 1103515245 + 12345) >>> 0) / 2 ** 32);
    };
    for (let seed = 1; seed <= 60; seed++) {
      let s = start({}, 3, seed);
      const rand = dice(seed);
      for (let moves = 0; s.phase !== "finished" && moves < 5000; moves++) {
        const seat = [0, 1, 2].find((i) => g.bot(s, i, SHARP) !== null)!;
        s = g.apply(s, seat, g.bot(s, seat, seat === 0 ? SHARP : { skill: 0, sloppy: 1 }, rand)!);
      }
      if (g.summary(s).winners![0] === 0) wins++;
    }
    expect(wins).toBeGreaterThan(35);
  });
});

describe("drinking mode and rules", () => {
  it("costs a drink with the die", () => {
    const s = withHands(start(drinkingLiarsDice), [[1, 2, 3, 4, 5], [2, 2, 3, 6, 6], [1, 1, 4, 5, 6]], 0);
    const called = liar(bid(s, 6, 5));
    expect(called.tally.drank).toEqual([1, 0, 0]);
    expect(called.narration).toContain("🍺 {0} drinks 1");
  });

  it("come out whole from anything", () => {
    expect(g.normalize({ dice: 9 })).toMatchObject({ dice: 5, wild: true, drinking: false });
    expect(g.normalize({ id: "liarsdice-quick" })).toEqual(quickLiarsDice);
    expect(start(quickLiarsDice).hands.map((h) => h.length)).toEqual([3, 3, 3]);
    expect(g.describe(plainLiarsDice).join(" ")).toMatch(/not wild/);
  });
});
