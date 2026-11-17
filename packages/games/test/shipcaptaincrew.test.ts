import { describe, expect, it } from "vitest";
import { classicShipCaptainCrew, drinkingShipCaptainCrew, GameError, movesOffered, newShipCaptainCrew, oneShipCaptainCrew, shipCaptainCrew, shipCargo, type ShipCaptainCrewRules, type ShipCaptainCrewState } from "../src/index.js";

const g = shipCaptainCrew;
const SHARP = { skill: 1, sloppy: 0 };
const start = (rules: Partial<ShipCaptainCrewRules> = {}, seats = 2, seed = 1) => newShipCaptainCrew(g.normalize({ ...classicShipCaptainCrew, ...rules }), seats, seed);
const roll = (s: ShipCaptainCrewState) => g.apply(s, s.turn, { type: "roll" });
const stop = (s: ShipCaptainCrewState) => g.apply(s, s.turn, { type: "stop" });
/** The same game with the mover holding these dice after `rolls` rolls: the first `aboard` of them are the ship, captain and crew. */
function withDice(s: ShipCaptainCrewState, dice: number[], aboard: number, rolls = 1): ShipCaptainCrewState {
  return { ...structuredClone(s), dice, aboard: dice.map((_, i) => i < aboard), rolls };
}
/** A first roll that brings this many of the ship, captain and crew aboard. */
function firstRoll(aboard: number, rules: Partial<ShipCaptainCrewRules> = {}, seats = 2): { before: ShipCaptainCrewState; after: ShipCaptainCrewState } {
  for (let seed = 1; seed < 3000; seed++) {
    const before = start(rules, seats, seed);
    const after = roll(before);
    if (after.aboard.filter(Boolean).length === aboard) return { before, after };
  }
  throw new Error("no such roll");
}
/** A whole turn for the mover that ends with this cargo (0: never leaves port). */
const turnOf = (s: ShipCaptainCrewState, cargo: number) => (cargo ? stop(withDice(s, [6, 5, 4, Math.min(6, cargo - 1), cargo - Math.min(6, cargo - 1)], 3)) : (() => {
  // Two rolls gone with nothing aboard, and a third that finds no six.
  for (let seed = 1; seed < 200; seed++) {
    const next = roll({ ...withDice(s, [1, 1, 1, 1, 1], 0, 2), rng: seed });
    if (!next.dice.includes(6)) return next;
  }
  throw new Error("always found a ship");
})());
const refused = (fn: () => unknown, message?: RegExp) => {
  expect(fn).toThrow(GameError);
  if (message) expect(fn).toThrow(message);
};

describe("finding a ship, a captain and a crew", () => {
  it("takes them aboard in order, several in one roll if they come", () => {
    for (const aboard of [0, 1, 2, 3]) {
      const { after } = firstRoll(aboard);
      const kept = after.dice.filter((_, i) => after.aboard[i]).sort((a, b) => b - a);
      expect(kept).toEqual([6, 5, 4].slice(0, aboard));
      // Whatever comes next isn't among the dice left, or it would have been taken.
      if (aboard < 3) expect(after.dice.filter((_, i) => !after.aboard[i])).not.toContain([6, 5, 4][aboard]);
      expect(g.view(after, 0).dice!.dice.map((d) => !!d.held)).toEqual(after.aboard);
    }
  });

  it("has no use for a five before a six, or a four before a five", () => {
    // Roll after roll with nothing aboard: fives and fours are thrown again with the rest.
    for (let seed = 1; seed < 40; seed++) {
      const s = roll({ ...withDice(start(), [5, 4, 5, 4, 3], 0), rng: seed });
      if (!s.dice.includes(6)) expect(s.aboard.some(Boolean)).toBe(false);
    }
  });

  it("only throws the dice that aren't aboard", () => {
    const s = withDice(start(), [6, 5, 2, 2, 3], 2);
    const next = roll(s);
    expect(next.dice.slice(0, 2)).toEqual([6, 5]);
    expect(next.rolls).toBe(2);
    expect(next.throws).toBe(s.throws + 1);
  });

  it("can't stop without all three, or before rolling, or out of turn", () => {
    const s = start();
    refused(() => stop(s), /Roll the dice first/);
    refused(() => stop(withDice(s, [6, 5, 2, 2, 3], 2)), /without a ship, a captain and a crew/);
    refused(() => g.apply(s, 1 - s.turn, { type: "roll" }), /not your turn/);
    expect(movesOffered(g.view(withDice(s, [6, 5, 2, 2, 3], 2), s.turn))).toEqual([{ type: "roll" }]);
    expect(movesOffered(g.view(s, 1 - s.turn))).toEqual([]);
  });
});

describe("the cargo", () => {
  it("is the other two dice, once all three are aboard", () => {
    const s = withDice(start(), [6, 5, 4, 3, 6], 3);
    expect(shipCargo(s)).toBe(9);
    expect(shipCargo(withDice(start(), [6, 5, 1, 6, 6], 2))).toBe(0);
    const v = g.view(s, s.turn);
    expect(v.choices!.options.map((o) => o.label)).toEqual(["Keep 9", "Roll the cargo again (2 left)"]);
    expect(v.choices!.options.map((o) => !!o.primary)).toEqual([true, false]);
    expect(v.players[s.turn]!.line).toBe("0 rounds · cargo 9");
  });

  it("can be thrown again, both dice together, for whatever comes", () => {
    const s = withDice(start({}, 2, 4), [6, 5, 4, 1, 1], 3);
    const next = roll(s);
    expect(next.dice.slice(0, 3)).toEqual([6, 5, 4]);
    expect(shipCargo(next)).toBe(next.dice[3]! + next.dice[4]!);
    expect(next.turn).toBe(s.turn);
  });

  it("is settled by the third roll, whatever it shows", () => {
    const s = withDice(start({}, 2, 4), [6, 5, 4, 1, 1], 3, 2);
    const next = roll(s);
    expect(next.played[s.turn]).toBe(true);
    expect(next.cargo[s.turn]).toBe(next.dice[3]! + next.dice[4]!);
    expect(next.turn).toBe(1 - s.turn);
    expect(next.rolls).toBe(0);
    // The dice lie as they fell, dimmed, until the next player picks them up.
    expect(g.view(next, 0).dice!.dice.every((d) => d.used && !d.held)).toBe(true);
  });

  it("is nothing for a turn that never finds a crew", () => {
    const s = start();
    const next = turnOf(s, 0);
    expect(next.cargo[s.turn]).toBe(0);
    expect(next.narration).toBe(`{${s.turn}} stays in port`);
    expect(g.view(next, 0).players[s.turn]!.line).toBe("0 rounds · no cargo");
  });
});

describe("a round", () => {
  it("goes to the biggest cargo, and the next one starts with the next player", () => {
    const s = start();
    const first = s.turn;
    const after = turnOf(turnOf(s, 9), 6);
    expect(after.won[first]).toBe(1);
    expect(after.round).toBe(2);
    expect([after.first, after.turn]).toEqual([1 - first, 1 - first]);
    expect(after.played).toEqual([false, false]);
    expect(after.narration).toBe(`{${1 - first}} sails with a cargo of 6. {${first}} takes round 1 with a cargo of 9`);
    expect(g.view(after, 0).scores.map((x) => x.value)).toEqual(after.won);
  });

  it("goes to nobody when the biggest is shared, or nobody sails", () => {
    const tied = turnOf(turnOf(start(), 8), 8);
    expect(tied.won).toEqual([0, 0]);
    expect(tied.round).toBe(2);
    expect(tied.narration).toMatch(/tie on 8: nobody takes round 1/);
    const none = turnOf(turnOf(start(), 0), 0);
    expect(none.won).toEqual([0, 0]);
    expect(none.narration).toMatch(/Nobody put to sea in round 1/);
  });

  it("shows what there is to beat", () => {
    const s = turnOf(start({}, 3), 7);
    expect(g.view(s, 0).info).toContain("Cargo to beat: 7");
    // A cargo that doesn't lead the round can't stand: rolling again is the main button.
    const behind = withDice(s, [6, 5, 4, 3, 4], 3);
    expect(g.view(behind, behind.turn).choices!.options.find((o) => o.primary)!.move).toEqual({ type: "roll" });
  });
});

describe("the game", () => {
  it("is won by the first to take enough rounds", () => {
    let s = start();
    const seat = s.turn;
    // The same player wins three rounds running, whoever rolls first.
    for (let round = 1; round <= 3; round++) {
      expect(s.phase).toBe("playing");
      s = s.turn === seat ? turnOf(turnOf(s, 10), 4) : turnOf(turnOf(s, 4), 10);
    }
    expect(s.phase).toBe("finished");
    expect(g.summary(s)).toMatchObject({ over: true, winners: [seat], order: [seat, 1 - seat], hand: 3, scoreLine: seat === 0 ? "3 · 0" : "0 · 3" });
    expect(g.view(s, 0).over).toEqual({ winners: [seat], title: `{${seat}} wins, 3 rounds to 0!` });
    for (const i of [0, 1]) expect(movesOffered(g.view(s, i))).toEqual([]);
    refused(() => roll(s), /over/);
  });

  it("is one round when the table says so, played again while it is tied", () => {
    const tied = turnOf(turnOf(start(oneShipCaptainCrew), 8), 8);
    expect(tied.phase).toBe("playing");
    const first = tied.turn;
    const done = turnOf(turnOf(tied, 5), 3);
    expect(done.phase).toBe("finished");
    expect(g.view(done, 0).over).toEqual({ winners: [first], title: `{${first}} wins!` });
  });
});

describe("the computer player", () => {
  it("rolls until it has a crew, then weighs the cargo against the rolls left", () => {
    const s = start({}, 3);
    const move = (dice: number[], aboard: number, rolls: number, from = s) => g.bot(withDice(from, dice, aboard, rolls), from.turn, SHARP)!.type;
    expect(g.bot(s, s.turn, SHARP)).toEqual({ type: "roll" });
    expect(g.bot(s, (s.turn + 1) % 3, SHARP)).toBeNull();
    expect(move([6, 5, 1, 1, 1], 2, 1)).toBe("roll");
    expect(move([6, 5, 4, 3, 4], 3, 1)).toBe("roll");
    expect(move([6, 5, 4, 3, 4], 3, 2)).toBe("stop");
    expect(move([6, 5, 4, 2, 4], 3, 2)).toBe("roll");
    expect(move([6, 5, 4, 5, 6], 3, 1)).toBe("stop");
  });

  it("never keeps a cargo that can't win, and keeps any that already has", () => {
    const s = turnOf(start({}, 2), 10);
    const move = (dice: number[], rolls: number) => g.bot(withDice(s, dice, 3, rolls), s.turn, SHARP)!.type;
    expect(move([6, 5, 4, 5, 5], 1)).toBe("roll");
    expect(move([6, 5, 4, 4, 5], 2)).toBe("roll");
    // The last to roll, and ahead: it's won.
    expect(move([6, 5, 4, 5, 6], 1)).toBe("stop");
    const low = turnOf(start({}, 2), 3);
    expect(g.bot(withDice(low, [6, 5, 4, 1, 3], 3, 1), low.turn, SHARP)).toEqual({ type: "stop" });
  });
});

describe("drinking mode and rules", () => {
  it("costs the smallest cargo a drink, and nobody when they're level", () => {
    const s = start(drinkingShipCaptainCrew, 3);
    const [a, b, c] = [s.turn, (s.turn + 1) % 3, (s.turn + 2) % 3];
    const done = turnOf(turnOf(turnOf(s, 9), 4), 4);
    expect([done.tally.drank[a], done.tally.drank[b], done.tally.drank[c]]).toEqual([0, 1, 1]);
    expect(done.narration).toContain("🍺");
    const level = turnOf(turnOf(turnOf(s, 6), 6), 6);
    expect(level.tally.drank).toEqual([0, 0, 0]);
  });

  it("come out whole from anything", () => {
    expect(g.normalize({ wins: 4 })).toMatchObject({ wins: 3, drinking: false });
    expect(g.normalize({ id: "shipcaptaincrew-one" })).toEqual(oneShipCaptainCrew);
    expect(g.describe(oneShipCaptainCrew).join(" ")).toMatch(/played again/);
  });
});
