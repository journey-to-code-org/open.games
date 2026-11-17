import { describe, expect, it } from "vitest";
import { classicPig, drinkingPig, GameError, movesOffered, newPig, pig, twoDicePig, type PigRules, type PigState } from "../src/index.js";

const g = pig;
const SHARP = { skill: 1, sloppy: 0 };
const start = (rules: Partial<PigRules> = {}, seats = 2, seed = 1) => newPig(g.normalize({ ...classicPig, ...rules }), seats, seed);
const roll = (s: PigState) => g.apply(s, s.turn, { type: "roll" });
const bank = (s: PigState) => g.apply(s, s.turn, { type: "bank" });
/** Roll until the dice show something the test is after (a one, or no one), from seeds that are tried in turn. */
function rolled(rules: Partial<PigRules>, want: (dice: number[]) => boolean, seats = 2): { before: PigState; after: PigState } {
  for (let seed = 1; seed < 500; seed++) {
    const before = start(rules, seats, seed);
    const after = roll(before);
    if (want(after.dice)) return { before, after };
  }
  throw new Error("no such roll");
}
const refused = (fn: () => unknown, message?: RegExp) => {
  expect(fn).toThrow(GameError);
  if (message) expect(fn).toThrow(message);
};

describe("a turn of Pig", () => {
  it("adds every roll to the turn until a one loses it", () => {
    const { before, after } = rolled({}, (d) => d[0] !== 1);
    const seat = before.turn;
    expect(after.pot).toBe(after.dice[0]);
    expect(after.turn).toBe(seat);
    expect(after.scores).toEqual([0, 0]);
    // Keep rolling: the total grows by what the die shows until a one ends the turn with nothing banked.
    let s = after;
    while (s.turn === seat) {
      const next = roll(s);
      if (next.turn === seat) expect(next.pot).toBe(s.pot + next.dice[0]!);
      else {
        expect(next.dice[0]).toBe(1);
        expect([next.pot, next.rolls, next.scores[seat]]).toEqual([0, 0, 0]);
        expect(next.narration).toMatch(/rolls a one and loses \d+/);
      }
      s = next;
    }
  });

  it("banks the turn's total and passes the die", () => {
    const { before, after } = rolled({}, (d) => d[0] !== 1);
    const seat = before.turn;
    const done = bank(after);
    expect(done.scores[seat]).toBe(after.pot);
    expect(done.turn).toBe(1 - seat);
    expect([done.pot, done.rolls]).toEqual([0, 0]);
    // The die lies where it fell, dimmed, until the next player picks it up.
    expect(g.view(done, 0).dice!.dice).toEqual([{ id: 0, value: after.dice[0], used: true }]);
  });

  it("can't bank before rolling, or out of turn", () => {
    const s = start();
    refused(() => bank(s), /Roll first/);
    refused(() => g.apply(s, 1 - s.turn, { type: "roll" }), /not your turn/);
    refused(() => g.apply(s, 5, { type: "roll" }), /not at this table/);
  });

  it("is won by the bank that reaches the target, at once", () => {
    const { after } = rolled({}, (d) => d[0] !== 1);
    const seat = after.turn;
    const near = { ...after, scores: after.scores.map((_, i) => (i === seat ? 99 : 40)) };
    const won = bank(near);
    expect(won.phase).toBe("finished");
    expect(g.summary(won)).toMatchObject({ over: true, winners: [seat], order: [seat, 1 - seat] });
    expect(g.view(won, 0).over).toEqual({ winners: [seat], title: `{${seat}} wins with ${99 + after.pot}!` });
    expect(movesOffered(g.view(won, seat))).toEqual([]);
    refused(() => roll(won), /over/);
  });
});

describe("two dice", () => {
  it("loses the turn to one one, and everything to two", () => {
    const single = rolled(twoDicePig, (d) => d.filter((v) => v === 1).length === 1);
    const seat = single.before.turn;
    const kept = g.apply({ ...single.before, scores: single.before.scores.map(() => 30) }, seat, { type: "roll" });
    expect(kept.scores[seat]).toBe(30);
    expect(kept.turn).toBe(1 - seat);

    const double = rolled(twoDicePig, (d) => d[0] === 1 && d[1] === 1);
    const lost = g.apply({ ...double.before, scores: double.before.scores.map(() => 30) }, double.before.turn, { type: "roll" });
    expect(lost.scores[double.before.turn]).toBe(0);
    expect(lost.scores[1 - double.before.turn]).toBe(30);
    expect(lost.narration).toMatch(/two ones and loses everything/);
  });

  it("adds both dice", () => {
    const { after } = rolled(twoDicePig, (d) => !d.includes(1));
    expect(after.pot).toBe(after.dice[0]! + after.dice[1]!);
    expect(g.view(after, 0).dice!.dice).toHaveLength(2);
  });
});

describe("what a seat is offered", () => {
  it("roll alone to start, then roll or bank, and nothing when it isn't your turn", () => {
    const s = start();
    expect(movesOffered(g.view(s, s.turn))).toEqual([{ type: "roll" }]);
    expect(movesOffered(g.view(s, 1 - s.turn))).toEqual([]);
    const { after } = rolled({}, (d) => d[0] !== 1);
    expect(movesOffered(g.view(after, after.turn))).toEqual([{ type: "roll" }, { type: "bank" }]);
    expect(g.view(after, 1 - after.turn).players[after.turn]!.line).toBe(`0 points · ${after.pot} this turn`);
  });

  it("makes stopping the main button once the turn is worth twenty, or wins", () => {
    const { after } = rolled({}, (d) => d[0] !== 1);
    const main = (s: PigState) => g.view(s, s.turn).choices!.options.find((o) => o.primary)!.move;
    expect(main({ ...after, pot: 12 })).toEqual({ type: "roll" });
    expect(main({ ...after, pot: 20 })).toEqual({ type: "bank" });
    expect(main({ ...after, pot: 4, scores: after.scores.map(() => 97) })).toEqual({ type: "bank" });
  });
});

describe("the computer player", () => {
  it("rolls to start, stops at about twenty, and goes for the line near the end", () => {
    const { after } = rolled({}, (d) => d[0] !== 1);
    const seat = after.turn;
    const at = (pot: number, mine = 0, theirs = 0) => g.bot({ ...after, pot, scores: after.scores.map((_, i) => (i === seat ? mine : theirs)) }, seat, SHARP)!.type;
    expect(g.bot(start(), start().turn, SHARP)).toEqual({ type: "roll" });
    expect(g.bot(after, 1 - seat, SHARP)).toBeNull();
    expect(at(14)).toBe("roll");
    expect(at(21)).toBe("bank");
    // Well behind, it pushes on; with the game in reach it takes it.
    expect(at(21, 0, 60)).toBe("roll");
    expect(at(8, 92, 10)).toBe("bank");
    // Someone is nearly home: nothing to save a score for.
    expect(at(25, 30, 90)).toBe("roll");
  });

  it("beats a player who stops at once", () => {
    let wins = 0;
    for (let seed = 1; seed <= 60; seed++) {
      let s = start({}, 2, seed);
      while (s.phase !== "finished") s = s.turn === 0 ? g.apply(s, 0, g.bot(s, 0, SHARP)!) : s.rolls ? bank(s) : roll(s);
      if (g.summary(s).winners![0] === 0) wins++;
    }
    expect(wins).toBeGreaterThan(40);
  });
});

describe("drinking mode", () => {
  it("costs a drink for a one, and one each for the losers", () => {
    const { before } = rolled(drinkingPig, (d) => d[0] === 1);
    const seat = before.turn;
    const one = roll(before);
    expect(one.tally.drank[seat]).toBe(1);
    expect(one.narration).toContain("🍺");
    const good = rolled(drinkingPig, (d) => d[0] !== 1, 3).after;
    const won = bank({ ...good, scores: good.scores.map(() => 99) });
    expect(won.tally.drank.map((n, i) => (i === good.turn ? n : n - 1))).toEqual([0, 0, 0]);
    expect(g.view(won, 0).result!.rows.at(-1)!.label).toBe("Drinks 🍺");
  });
});

describe("rules", () => {
  it("come out whole from anything", () => {
    expect(g.normalize({ target: 37, dice: 9 })).toMatchObject({ target: 100, dice: 1, drinking: false });
    expect(g.normalize({ id: "pig-two", target: 50 })).toMatchObject({ dice: 2, target: 50 });
    expect(g.describe(twoDicePig).join(" ")).toMatch(/Two ones together/);
  });
});
