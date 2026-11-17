import { describe, expect, it } from "vitest";
import { classicTenThousand, drinkingTenThousand, GameError, movesOffered, newTenThousand, plainTenThousand, quickTenThousand, tenThousand, tenThousandPlan, tenThousandScore, tenThousandTurn, type TenThousandRules, type TenThousandState } from "../src/index.js";

const g = tenThousand;
const SHARP = { skill: 1, sloppy: 0 };
const CARELESS = { skill: 0, sloppy: 1 };
const start = (rules: Partial<TenThousandRules> = {}, seats = 2, seed = 1) => newTenThousand(g.normalize({ ...quickTenThousand, ...rules }), seats, seed);
/**
 * The same game with these dice just thrown by whoever's turn it is, and everything that scores
 * kept, as a roll leaves it. `set` is how many of the six were set aside on earlier rolls (the
 * first ones), and `pot` what those made.
 */
function withDice(s: TenThousandState, thrown: number[], pot = 0, rolls = 1): TenThousandState {
  const next = structuredClone(s);
  const aside = 6 - thrown.length;
  next.dice = [...Array<number>(aside).fill(1), ...thrown];
  next.set = next.dice.map((_, i) => i < aside);
  next.pot = pot;
  next.rolls = rolls;
  const view = g.view({ ...next, kept: next.dice.map(() => false) }, next.turn);
  next.kept = next.dice.map((_, i) => view.dice!.tap!.dice.includes(i));
  return next;
}
const roll = (s: TenThousandState) => g.apply(s, s.turn, { type: "roll" });
const bank = (s: TenThousandState) => g.apply(s, s.turn, { type: "bank" });
const keep = (s: TenThousandState, die: number) => g.apply(s, s.turn, { type: "keep", die });
const refused = (fn: () => unknown, message?: RegExp) => {
  expect(fn).toThrow(GameError);
  if (message) expect(fn).toThrow(message);
};

describe("scoring", () => {
  it("counts ones, fives and three or more of a kind", () => {
    expect(tenThousandScore([1])).toBe(100);
    expect(tenThousandScore([5, 5])).toBe(100);
    expect(tenThousandScore([1, 5, 1])).toBe(250);
    expect(tenThousandScore([2, 2, 2])).toBe(200);
    expect(tenThousandScore([6, 6, 6])).toBe(600);
    expect(tenThousandScore([1, 1, 1])).toBe(1000);
    // Each die more of the same doubles it.
    expect(tenThousandScore([4, 4, 4, 4])).toBe(800);
    expect(tenThousandScore([4, 4, 4, 4, 4])).toBe(1600);
    expect(tenThousandScore([1, 1, 1, 1, 1, 1])).toBe(8000);
    expect(tenThousandScore([3, 3, 3, 5, 1])).toBe(450);
    expect(tenThousandScore([2, 2, 2, 6, 6, 6])).toBe(800);
  });

  it("scores nothing for a set with a die that doesn't count", () => {
    expect(tenThousandScore([])).toBeNull();
    expect(tenThousandScore([2])).toBeNull();
    expect(tenThousandScore([1, 3])).toBeNull();
    expect(tenThousandScore([4, 4])).toBeNull();
    expect(tenThousandScore([6, 6, 6, 2])).toBeNull();
  });

  it("scores a straight and three pairs with all six dice, where the table plays them", () => {
    expect(tenThousandScore([1, 2, 3, 4, 5, 6])).toBe(1500);
    expect(tenThousandScore([2, 2, 4, 4, 6, 6])).toBe(1500);
    expect(tenThousandScore([1, 1, 5, 5, 3, 3])).toBe(1500);
    // Four and two are not three pairs, and five in a row are not a straight.
    expect(tenThousandScore([2, 2, 2, 2, 3, 3])).toBeNull();
    expect(tenThousandScore([1, 2, 3, 4, 5])).toBeNull();
    // Six ones are worth more as ones.
    expect(tenThousandScore([1, 1, 1, 1, 1, 1], { combos: true })).toBe(8000);
    expect(tenThousandScore([1, 2, 3, 4, 5, 6], { combos: false })).toBeNull();
    expect(tenThousandScore([1, 1, 5, 5, 3, 3], { combos: false })).toBeNull();
  });
});

describe("a turn", () => {
  it("keeps everything that scores after a roll, and nothing else", () => {
    const s = withDice(start(), [1, 5, 2, 2, 3, 6]);
    const v = g.view(s, s.turn);
    expect(v.dice!.dice.map((d) => !!d.held)).toEqual([true, true, false, false, false, false]);
    expect(v.dice!.tap).toEqual({ type: "keep", dice: [0, 1] });
    expect(tenThousandTurn(s)).toEqual({ total: 150, left: 4, bank: true });
    expect(movesOffered(v)).toEqual([{ type: "keep", die: 0 }, { type: "keep", die: 1 }, { type: "bank" }, { type: "roll" }]);
    expect(v.choices!.options.map((o) => o.label)).toEqual(["Bank 150", "Roll 4 dice"]);
    // Nobody else is offered anything, but they see the same dice.
    const other = g.view(s, 1 - s.turn);
    expect(movesOffered(other)).toEqual([]);
    expect(other.dice!.dice).toEqual(v.dice!.dice);
  });

  it("lets a scoring die be put back, but not all of them, and not half a set", () => {
    const s = withDice(start(), [1, 5, 2, 2, 3, 6]);
    const one = keep(s, 1);
    expect(tenThousandTurn(one)).toEqual({ total: 100, left: 5, bank: true });
    const none = keep(one, 0);
    expect(tenThousandTurn(none)).toBeNull();
    expect(g.view(none, none.turn).choices).toMatchObject({ prompt: "Keep at least one die that scores", options: [] });
    refused(() => roll(none), /at least one/);
    refused(() => bank(none), /at least one/);
    refused(() => keep(s, 2), /doesn't score/);
    refused(() => keep(s, 9), /not one of the dice/);

    const triple = withDice(start(), [4, 4, 4, 2, 3, 6]);
    expect(tenThousandTurn(triple)!.total).toBe(400);
    const broken = keep(triple, 0);
    expect(g.view(broken, broken.turn).choices!.options).toEqual([]);
    refused(() => roll(broken), /three of a kind/);
  });

  it("sets aside what was kept and throws only the rest", () => {
    const s = withDice(start({}, 2, 5), [1, 5, 2, 2, 3, 6]);
    const next = roll(keep(s, 1));
    // Either the five dice came up with something, or it was a bust and the turn moved on.
    if (next.turn === s.turn) {
      expect(next.pot).toBe(100);
      expect(next.dice[0]).toBe(1);
      expect(next.set).toEqual([true, false, false, false, false, false]);
      expect(g.view(next, 0).dice!.dice[0]).toMatchObject({ value: 1, used: true });
      expect(g.view(next, next.turn).dice!.tap!.dice).not.toContain(0);
      refused(() => keep(next, 0), /already set aside/);
    } else {
      expect(next.narration).toMatch(/busts and loses 100/);
    }
    expect(next.throws).toBe(s.throws + 1);
  });

  it("banks the turn and passes the dice", () => {
    const s = withDice(start(), [1, 1, 1, 2, 3, 6], 250, 2);
    const seat = s.turn;
    const done = bank(s);
    expect(done.scores[seat]).toBe(1250);
    expect(done.turn).toBe(1 - seat);
    expect([done.pot, done.rolls]).toEqual([0, 0]);
    expect(g.view(done, 0).dice!.dice.every((d) => d.used && !d.held)).toBe(true);
    expect(movesOffered(g.view(done, done.turn))).toEqual([{ type: "roll" }]);
  });

  it("busts on a roll with nothing in it, and loses the turn's points", () => {
    // Throw one die until it misses: a one or a five keeps the turn alive.
    let bust: TenThousandState | null = null;
    for (let seed = 1; seed < 200 && !bust; seed++) {
      const s = withDice(start({}, 2, seed), [1, 2, 3, 4, 6, 6].slice(0, 2), 400, 3);
      const next = roll(s);
      if (next.turn !== s.turn) {
        bust = next;
        expect(next.scores).toEqual([0, 0]);
        expect(next.narration).toBe(`{${s.turn}} busts and loses 500`);
        expect(![1, 5].includes(next.dice[5]!)).toBe(true);
      } else expect([1, 5]).toContain(next.dice[5]);
    }
    expect(bust).not.toBeNull();
  });

  it("gives all six back when all six have scored", () => {
    const s = withDice(start({}, 2, 3), [5, 5], 600, 3);
    expect(tenThousandTurn(s)).toEqual({ total: 700, left: 6, bank: true });
    expect(g.view(s, s.turn).choices!.options.at(-1)!.label).toBe("Hot dice! Roll all six");
    const next = roll(s);
    if (next.turn === s.turn) {
      expect(next.pot).toBe(700);
      expect(next.set.every((x) => !x)).toBe(true);
      expect(next.narration).toMatch(/Hot dice/);
    }
    expect(next.dice).not.toEqual(s.dice);
  });

  it("can't roll or keep out of turn, or keep before rolling", () => {
    const s = start();
    refused(() => g.apply(s, 1 - s.turn, { type: "roll" }), /not your turn/);
    refused(() => keep(s, 0), /Roll the dice first/);
    refused(() => bank(s), /Roll the dice first/);
  });
});

describe("getting on the board", () => {
  it("needs a big enough turn for the first bank only", () => {
    const s = withDice(start(classicTenThousand), [1, 5, 2, 2, 3, 6], 300, 2);
    expect(tenThousandTurn(s)).toEqual({ total: 450, left: 4, bank: false });
    const v = g.view(s, s.turn);
    expect(v.choices!.options.map((o) => o.move)).toEqual([{ type: "roll" }]);
    expect(v.choices!.prompt).toMatch(/first bank has to be 500/);
    refused(() => bank(s), /50 to go/);
    expect(bank({ ...s, pot: 350 }).scores[s.turn]).toBe(500);
    // Once on the board, anything can be banked.
    const on = { ...s, scores: s.scores.map(() => 500) };
    expect(bank(on).scores[s.turn]).toBe(950);
  });
});

describe("the end", () => {
  it("gives everyone else one more turn, and the highest score wins", () => {
    const s = withDice(start({}, 3), [1, 1, 1, 2, 3, 6]);
    const seat = s.turn;
    const out = bank({ ...s, scores: s.scores.map(() => 4200) });
    expect(out.closer).toBe(seat);
    expect(out.phase).toBe("playing");
    expect(out.narration).toMatch(/reaches 5000: everyone else has one more turn/);
    expect(g.view(out, 0).players[seat]!.badge).toBe("Made it");
    expect(g.view(out, 0).info).toContain("Last turns: 5200 to beat");
    // The next player passes them; the one after doesn't; then it's over.
    const second = bank(withDice(out, [1, 1, 1, 1, 2, 3]));
    expect(second.phase).toBe("playing");
    const third = bank(withDice(second, [5, 2, 2, 3, 4, 6]));
    expect(third.phase).toBe("finished");
    const winner = (seat + 1) % 3;
    expect(g.summary(third)).toMatchObject({ over: true, winners: [winner] });
    expect(g.summary(third).order).toEqual([winner, seat, (seat + 2) % 3]);
    expect(g.view(third, 0).over!.title).toBe(`{${winner}} wins with 6200!`);
    for (let i = 0; i < 3; i++) expect(movesOffered(g.view(third, i))).toEqual([]);
  });
});

describe("the computer player", () => {
  const plan = (s: TenThousandState) => tenThousandPlan(s, s.turn)!;
  it("banks a big turn with few dice left, and rolls a small one with many", () => {
    expect(plan(withDice(start(), [1, 2, 3, 4, 6, 6])).roll).toBe(true);
    expect(plan(withDice(start(), [5, 2], 1500, 3)).roll).toBe(false);
    expect(plan(withDice(start(), [1, 1, 1, 2, 3], 0, 2)).roll).toBe(false);
    // Hot dice with a little made: six fresh dice are worth throwing.
    expect(plan(withDice(start(), [1, 5], 300, 3)).roll).toBe(true);
  });

  it("puts a five back to throw five dice instead of four", () => {
    const s = withDice(start(), [1, 5, 2, 3, 4, 6].map((v, i) => (i === 3 ? 2 : v)));
    expect(plan(s)).toEqual({ keep: [0, 1, 0, 0, 0, 0, 0], roll: true });
    // It takes it a move: let go of the five, then roll. The same answer each time it's asked.
    expect(g.bot(s, s.turn, SHARP)).toEqual({ type: "keep", die: 1 });
    expect(g.bot(s, s.turn, SHARP)).toEqual({ type: "keep", die: 1 });
    expect(g.bot(keep(s, 1), s.turn, SHARP)).toEqual({ type: "roll" });
    // Someone not thinking keeps the lot.
    expect(g.bot(s, s.turn, CARELESS)).toEqual({ type: "roll" });
    expect(g.bot(withDice(start(), [1, 5, 2, 3, 4, 6], 200, 2), start().turn, CARELESS)).toEqual({ type: "bank" });
  });

  it("rolls on when a bank isn't allowed or can't win, and takes the win when it can", () => {
    const small = withDice(start(classicTenThousand), [5, 2], 300, 3);
    expect(plan(small).roll).toBe(true);
    const seat = small.turn;
    // The last round, behind: 1,550 doesn't pass 4,000 more.
    const behind = { ...withDice(start(), [5, 2], 1500, 3), closer: 1 - seat, scores: [0, 0].map((_, i) => (i === seat ? 1000 : 5000)) };
    expect(plan(behind).roll).toBe(true);
    const ahead = { ...behind, scores: [0, 0].map((_, i) => (i === seat ? 4000 : 5000)) };
    expect(plan(ahead).roll).toBe(false);
    // Enough to go out: bank it, even with six dice to come.
    const home = { ...withDice(start(), [1, 5], 300, 3), scores: [0, 0].map((_, i) => (i === seat ? 4700 : 0)) };
    expect(plan(home).roll).toBe(false);
    expect(tenThousandPlan(small, 1 - seat)).toBeNull();
    expect(g.bot(small, 1 - seat, SHARP)).toBeNull();
  });

  it("averages more a turn than someone who banks whatever the first roll gives", () => {
    const average = (play: (s: TenThousandState) => TenThousandState) => {
      let total = 0;
      for (let seed = 1; seed <= 300; seed++) {
        let s = start({}, 2, seed);
        const seat = s.turn;
        while (s.turn === seat && s.phase === "playing") s = play(s);
        total += s.scores[seat]!;
      }
      return total / 300;
    };
    const sharp = average((s) => g.apply(s, s.turn, g.bot(s, s.turn, SHARP)!));
    const timid = average((s) => (s.rolls ? bank(s) : roll(s)));
    expect(sharp).toBeGreaterThan(timid + 100);
    expect(sharp).toBeGreaterThan(450);
  });
});

describe("drinking mode and rules", () => {
  it("costs a drink for a bust", () => {
    for (let seed = 1; seed < 300; seed++) {
      const s = start(drinkingTenThousand, 2, seed);
      const next = roll(s);
      if (next.turn === s.turn) continue;
      expect(next.tally.drank[s.turn]).toBe(1);
      expect(next.narration).toBe(`{${s.turn}} busts · 🍺 {${s.turn}} drinks 1`);
      return;
    }
    throw new Error("no first roll ever bust");
  });

  it("come out whole from anything", () => {
    expect(g.normalize({ target: 123, opening: 7 })).toMatchObject({ target: 10000, opening: 0, combos: true });
    expect(g.normalize(plainTenThousand)).toEqual(plainTenThousand);
    expect(g.describe(classicTenThousand).join(" ")).toMatch(/first bank has to be a turn of 500/);
    expect(g.describe(plainTenThousand).join(" ")).not.toMatch(/three pairs/);
  });
});
