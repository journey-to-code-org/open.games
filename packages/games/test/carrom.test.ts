// Carrom's own rules. The shared sport tests (sport.test.ts) play whole games of it; these set up
// a board with a few pieces on it and look at what one shot is worth.
import { validateWorld } from "@journey-to-code/physics";
import { describe, expect, it } from "vitest";
import { GameError, angleTo, carrom, carromClear, carromPoints, newCarrom, type CarromMove, type CarromState } from "../src/index.js";

const STRIKER = "striker";
const QUEEN = "queen";
const live = (s: CarromState, id: string) => {
  const b = s.world.bodies.find((x) => x.id === id)!;
  return b.pocketed === undefined && b.out === undefined;
};
const at = (s: CarromState, id: string) => {
  const b = s.world.bodies.find((x) => x.id === id)!;
  return { x: b.x, y: b.y };
};
const down = (s: CarromState, prefix: string) => s.world.bodies.filter((b) => b.id.startsWith(prefix) && b.id !== STRIKER && b.pocketed !== undefined).length;

/**
 * A board with only the pieces named on it, where they are put; everything else is in a pocket.
 * It is seat 0's shot (White, from the bottom baseline), a few shots into the board.
 */
function board(pieces: Record<string, [number, number]>, rules = carromClear, change: Partial<CarromState> = {}): CarromState {
  const s = newCarrom(rules, 2, 1);
  for (const b of s.world.bodies) {
    if (b.id === STRIKER) continue;
    const put = pieces[b.id];
    if (put) [b.x, b.y] = put;
    else b.pocketed = "top-left";
  }
  expect(validateWorld(s.world)).toEqual([]);
  return { ...s, boardShots: 4, shots: 4, ...change };
}

/** The first shot, of a spread round a line from the baseline through `through`, that does what is asked. */
function shotThat(s: CarromState, seat: number, through: { x: number; y: number }, wanted: (after: CarromState) => boolean): CarromState {
  const y = at(s, STRIKER).y;
  for (const from of [1400, 2000, 2600, 3200, 3700, 4200, 4800, 5400, 6000]) {
    const aim = angleTo({ x: from, y }, through);
    for (const power of [200, 300, 400, 150, 500, 650]) {
      for (const off of [0, 40, -40, 90, -90, 150, -150]) {
        const move: CarromMove = { type: "shot", body: STRIKER, angle: (aim + off + 36000) % 36000, power, at: from };
        let after: CarromState;
        try {
          after = carrom.apply(s, seat, move);
        } catch (e) {
          if (e instanceof GameError) continue;
          throw e;
        }
        if (wanted(after)) return after;
      }
    }
  }
  throw new Error("no shot did that");
}

// Near the bottom-left pocket (at 0, 7400), on a line from the bottom baseline.
const BY_POCKET: [number, number] = [620, 6900];
const BY_OTHER_POCKET: [number, number] = [6780, 6900];
const MIDDLE = { x: 3700, y: 3700 };

describe("Carrom", () => {
  it("sets out nine white, nine black and the queen in the middle, with White to break from the bottom", () => {
    const s = newCarrom(carromClear, 2, 3);
    expect(validateWorld(s.world)).toEqual([]);
    const ids = s.world.bodies.map((b) => b.id);
    expect(ids.filter((id) => /^w\d$/.test(id))).toHaveLength(9);
    expect(ids.filter((id) => /^b\d$/.test(id))).toHaveLength(9);
    expect(at(s, QUEEN)).toEqual(MIDDLE);
    const v = carrom.view(s, 0);
    expect(v.turn).toBe(0);
    expect(v.shoot!.place!.y).toBeGreaterThan(3700);
    expect(at(s, STRIKER).y).toBe(v.shoot!.place!.y);
    // The striker is the heavy one.
    expect(s.world.bodies.find((b) => b.id === STRIKER)!.mass).toBe(3);
    expect(carrom.view(s, 1).shoot).toBeNull();
  });

  it("gives you another shot for pocketing one of your own", () => {
    const s = board({ w1: BY_POCKET, w2: [3000, 2000], b1: [4500, 2000], queen: [3700, 3700] });
    const after = shotThat(s, 0, { x: BY_POCKET[0], y: BY_POCKET[1] }, (a) => !live(a, "w1") && !/foul/.test(a.narration ?? ""));
    expect(after.turn).toBe(0);
    expect(down(after, "w")).toBe(8);
    // The striker is back on the same baseline for the next shot.
    expect(at(after, STRIKER).y).toBe(at(s, STRIKER).y);
    expect(live(after, STRIKER)).toBe(true);
  });

  it("leaves one of theirs down, to their good, and passes the turn", () => {
    const s = board({ b1: BY_POCKET, w2: [3000, 2000], b2: [4500, 2000], queen: [3700, 3700] });
    const after = shotThat(s, 0, { x: BY_POCKET[0], y: BY_POCKET[1] }, (a) => !live(a, "b1") && !/foul/.test(a.narration ?? ""));
    expect(after.turn).toBe(1);
    expect(down(after, "b")).toBe(8);
    // Black shoots from the other side of the board.
    expect(at(after, STRIKER).y).toBeLessThan(3700);
    expect(carrom.view(after, 1).shoot!.place!.y).toBe(at(after, STRIKER).y);
  });

  it("wants the queen covered: with the next shot, or she goes back to the middle", () => {
    const s = board({ queen: BY_POCKET, w1: BY_OTHER_POCKET, w2: [3000, 2000], b1: [4500, 2000] });
    const pending = shotThat(s, 0, { x: BY_POCKET[0], y: BY_POCKET[1] }, (a) => !live(a, QUEEN) && live(a, "w1") && live(a, "w2") && !/foul/.test(a.narration ?? ""));
    expect(pending.queen).toBe("pending");
    expect(pending.queenBy).toBe(0);
    expect(pending.turn).toBe(0);
    expect(carrom.view(pending, 0).players[0]!.badge).toBe("Covering");

    const covered = shotThat(pending, 0, { x: BY_OTHER_POCKET[0], y: BY_OTHER_POCKET[1] }, (a) => !live(a, "w1") && !/foul/.test(a.narration ?? ""));
    expect(covered.queen).toBe("covered");
    expect(live(covered, QUEEN)).toBe(false);
    expect(covered.turn).toBe(0);

    // A shot that pockets nothing: she is back where she started, and the turn passes.
    const missed = shotThat(pending, 0, { x: 3700, y: 5000 }, (a) => live(a, "w1") && live(a, "w2") && live(a, "b1") && !/foul/.test(a.narration ?? ""));
    expect(missed.queen).toBe("board");
    expect(missed.queenBy).toBeNull();
    expect(live(missed, QUEEN)).toBe(true);
    expect(at(missed, QUEEN)).toEqual(MIDDLE);
    expect(missed.turn).toBe(1);
  });

  it("counts the queen at once when she needn't be covered", () => {
    const s = board({ queen: BY_POCKET, w1: BY_OTHER_POCKET, w2: [3000, 2000], b1: [4500, 2000] }, { ...carromClear, cover: false });
    const after = shotThat(s, 0, { x: BY_POCKET[0], y: BY_POCKET[1] }, (a) => !live(a, QUEEN) && !/foul/.test(a.narration ?? ""));
    expect(after.queen).toBe("covered");
    expect(after.queenBy).toBe(0);
  });

  it("makes a pocketed striker cost a piece, or a piece owed", () => {
    // Seven of White's are down: one comes back.
    const s = board({ w1: [3000, 2000], w2: [3400, 2000], b1: [4500, 2000], queen: [3700, 3700] });
    const corner = { x: 0, y: 7400 };
    const foul = shotThat(s, 0, corner, (a) => /foul/.test(a.narration ?? ""));
    expect(down(foul, "w")).toBe(6);
    expect(foul.dues).toEqual([0, 0]);
    expect(foul.turn).toBe(1);
    expect(live(foul, STRIKER)).toBe(true);

    // Nothing down to pay with: it is owed, and the next piece pocketed pays it.
    const none = newCarrom(carromClear, 2, 1);
    const all = { ...none, boardShots: 4, shots: 4 };
    // Clear the way to the corner: the pack is in the middle, the corner is free.
    const owed = shotThat(all, 0, corner, (a) => /foul/.test(a.narration ?? "") && down(a, "w") === 0);
    expect(owed.dues).toEqual([1, 0]);
    expect(carrom.view(owed, 0).players[0]!.line).toContain("owes 1");
    const paying = { ...owed, turn: 0, world: { ...owed.world, bodies: owed.world.bodies.map((b) => (b.id === "w1" ? { ...b, x: BY_POCKET[0], y: BY_POCKET[1] } : b.id === STRIKER ? { ...b, y: at(s, STRIKER).y, x: 3700 } : b)) } };
    const paid = shotThat(paying, 0, { x: BY_POCKET[0], y: BY_POCKET[1] }, (a) => a.dues[0] === 0 && !/foul/.test(a.narration ?? ""));
    // The piece that dropped went straight back out.
    expect(down(paid, "w")).toBe(0);
  });

  it("won't let anyone finish while the queen is on the board", () => {
    const s = board({ w1: BY_POCKET, b1: [4500, 2000], queen: [3700, 3700] });
    const after = shotThat(s, 0, { x: BY_POCKET[0], y: BY_POCKET[1] }, (a) => /last piece comes back/.test(a.narration ?? ""));
    expect(after.phase).toBe("playing");
    expect(down(after, "w")).toBe(8);
    expect(live(after, "w1")).toBe(true);
    expect(after.turn).toBe(1);
  });

  it("is won by the first side to clear, once the queen is covered", () => {
    const s = board({ w1: BY_POCKET, b1: [4500, 2000], b2: [4900, 2000] }, carromClear, { queen: "covered", queenBy: 1 });
    const after = shotThat(s, 0, { x: BY_POCKET[0], y: BY_POCKET[1] }, (a) => a.phase === "finished");
    expect(after.winners).toEqual([0]);
    expect(carrom.summary(after).over).toBe(true);
    expect(carrom.view(after, 1).over!.winners).toEqual([0]);
    expect(carrom.view(after, 0).shoot).toBeNull();
  });

  it("scores a board for points: a point for each piece they have left, and three for a queen you covered", () => {
    const s = board({ w1: BY_POCKET, b1: [4500, 2000], b2: [4900, 2000] }, carromPoints, { queen: "covered", queenBy: 0 });
    const after = shotThat(s, 0, { x: BY_POCKET[0], y: BY_POCKET[1] }, (a) => a.phase !== "playing");
    expect(after.phase).toBe("board");
    expect(after.points).toEqual([5, 0]);
    const v = carrom.view(after, 1);
    expect(v.result!.title).toBe("Board 1 to White");
    expect(v.choices!.options[0]!.label).toBe("Next board");
    expect(v.shoot).toBeNull();
    // Everyone moves on, and Black breaks the second board from the top.
    const waiting = carrom.apply(after, 0, { type: "next" });
    expect(waiting.phase).toBe("board");
    expect(() => carrom.apply(waiting, 0, { type: "next" })).toThrow(GameError);
    const next = carrom.apply(waiting, 1, { type: "next" });
    expect(next.phase).toBe("playing");
    expect(next.hand).toBe(2);
    expect(next.turn).toBe(1);
    expect(next.points).toEqual([5, 0]);
    expect(next.world.bodies.filter((b) => b.pocketed !== undefined)).toHaveLength(0);
    expect(at(next, STRIKER).y).toBeLessThan(3700);
    expect(next.queen).toBe("board");

    // Without the queen, only the pieces count; and the target ends the game.
    const close = board({ w1: BY_POCKET, b1: [4500, 2000] }, carromPoints, { queen: "covered", queenBy: 1, points: [14, 9] });
    const won = shotThat(close, 0, { x: BY_POCKET[0], y: BY_POCKET[1] }, (a) => a.phase !== "playing");
    expect(won.phase).toBe("finished");
    expect(won.points).toEqual([15, 9]);
    expect(won.winners).toEqual([0]);
  });

  it("calls a board that goes on too long, for whoever has more down", () => {
    const s = board({ w1: [3000, 2000], b1: [4500, 2000], b2: [4900, 2000], queen: [3700, 3700] }, carromClear, { boardShots: 119 });
    const after = shotThat(s, 0, { x: 3700, y: 5500 }, (a) => a.phase === "finished");
    expect(after.over).toContain("Time's up");
    // White has eight down to Black's seven.
    expect(after.winners).toEqual([0]);
  });

  it("puts the striker only on your own baseline, clear of the pieces", () => {
    const s = board({ w1: [3700, 6350], b1: [4500, 2000], queen: [3700, 3700] });
    const shot = { type: "shot" as const, body: STRIKER, angle: 27000, power: 300 };
    expect(() => carrom.apply(s, 0, { ...shot, at: 3700 })).toThrow(/in the way/);
    expect(() => carrom.apply(s, 0, { ...shot, at: 100 })).toThrow(/baseline/);
    expect(() => carrom.apply(s, 0, { ...shot, at: 3000.5 })).toThrow(GameError);
    expect(() => carrom.apply(s, 0, { ...shot, spin: 50 })).toThrow(/spin/);
    expect(() => carrom.apply(s, 0, { ...shot, body: "w1" })).toThrow(/striker/);
    expect(() => carrom.apply(s, 1, shot)).toThrow(/not your shot/);
  });

  it("puts the striker down clear of a piece standing on the baseline", () => {
    // Black's shot, from the top, touches nothing; the striker then goes to White's baseline,
    // where a white piece stands on the middle of it.
    const s = board({ w1: [3700, 6350], b1: [4500, 2000], queen: [3700, 3700] }, carromClear, { turn: 1 });
    s.world.bodies.find((b) => b.id === STRIKER)!.y = 1050;
    const after = carrom.apply(s, 1, { type: "shot", body: STRIKER, angle: 0, power: 60 });
    expect(after.turn).toBe(0);
    const striker = at(after, STRIKER);
    expect(striker.y).toBe(6350);
    expect(Math.abs(striker.x - 3700)).toBeGreaterThanOrEqual(155 + 205);
    expect(Math.abs(striker.x - 3700)).toBeLessThan(155 + 205 + 40);
  });

  it("takes partners in turn from the same baseline", () => {
    let s = newCarrom(carromClear, 4, 2);
    const order: number[] = [];
    for (let i = 0; i < 6; i++) {
      order.push(s.turn);
      // A soft shot along the baseline that touches nothing.
      s = carrom.apply(s, s.turn, { type: "shot", body: STRIKER, angle: 0, power: 60 });
      expect(s.narration).toContain("pockets nothing");
    }
    expect(order).toEqual([0, 1, 2, 3, 0, 1]);
    expect(carrom.view(s, 0).teams).toBe(true);
    expect(carrom.view(s, 2).players[2]!.line).toContain("White");
    expect(carrom.view(s, 3).players[3]!.line).toContain("Black");
  });
});
