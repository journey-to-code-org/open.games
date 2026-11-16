import { validateWorld, type Body } from "@journey-to-code/physics";
import { describe, expect, it } from "vitest";
import { billiards as game, eightBall, eightBallCalled, GameError, nineBall, type BilliardsRules, type BilliardsState } from "../src/index.js";

const R = 286;
const ball = (id: string, x: number, y: number): Body => ({ id, x, y, r: R });
const cue = (x: number, y: number) => ball("cue", x, y);

/** A table set up by hand, after the break, with seat 0 to shoot. */
function table(rules: BilliardsRules, bodies: Body[], over: Partial<BilliardsState> = {}, seats = 2): BilliardsState {
  const s = game.newGame(rules, seats, 1);
  return { ...s, world: { ...s.world, bodies }, breaking: false, inHand: false, turn: 0, ...over };
}
const shoot = (s: BilliardsState, angle: number, power = 600, seat = s.turn, extra: Record<string, unknown> = {}) => game.apply(s, seat, { type: "shot", body: "cue", angle, power, ...extra } as never);
const body = (s: BilliardsState, id: string) => s.world.bodies.find((b) => b.id === id)!;
const view = (s: BilliardsState, seat = s.turn) => game.view(s, seat);
// Up and to the left, along the diagonal into the top-left pocket.
const UP_LEFT = 22500;

describe("the rack", () => {
  it("racks fifteen balls with the 8 in the middle and a solid and a stripe at the back corners", () => {
    for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
      const s = game.newGame(eightBall, 2, seed);
      expect(validateWorld(s.world)).toEqual([]);
      expect(s.world.bodies).toHaveLength(16);
      const spot = (id: string) => body(s, id);
      expect(spot("8").x).toBe(20042);
      expect(spot("8").y).toBe(6350);
      const solid = (n: number) => n <= 7;
      const corners = s.world.bodies.filter((b) => b.x === 21034 && (b.y === 5206 || b.y === 7494)).map((b) => Number(b.id));
      expect(corners).toHaveLength(2);
      expect(solid(corners[0]!)).not.toBe(solid(corners[1]!));
    }
  });
  it("racks nine balls in a diamond: the 1 at the front, the 9 in the middle", () => {
    const s = game.newGame(nineBall, 2, 3);
    expect(validateWorld(s.world)).toEqual([]);
    expect(s.world.bodies).toHaveLength(10);
    expect(body(s, "1").x).toBe(19050);
    expect(body(s, "9").x).toBe(20042);
    expect(body(s, "9").y).toBe(6350);
  });
  it("racks a different way for a different seed, and the same way for the same one", () => {
    const a = game.newGame(eightBall, 2, 5);
    expect(JSON.stringify(game.newGame(eightBall, 2, 5))).toBe(JSON.stringify(a));
    expect(JSON.stringify(game.newGame(eightBall, 2, 6).world)).not.toBe(JSON.stringify(a.world));
  });
});

describe("the break and the cue ball", () => {
  it("offers the break from behind the head string only", () => {
    const s = game.newGame(eightBall, 2, 1);
    const v = view(s, 0);
    expect(v.shoot!.place).toEqual({ y: 6350, min: 700, max: 6350 });
    expect(() => shoot(s, 0, 800, 0, { at: 6351 })).toThrow(GameError);
    expect(() => shoot(s, 0, 800, 0, { at: 100 })).toThrow(GameError);
    expect(body(shoot(s, 0, 800, 0, { at: 3000 }), "cue").x).not.toBe(3000); // it has moved on since
    expect(view(s, 1).shoot).toBeNull();
  });
  it("lets only the shooter place the cue ball, and only when it's in hand", () => {
    const s = table(eightBall, [cue(5000, 6350), ball("1", 15000, 3000), ball("2", 15000, 9000)]);
    expect(() => shoot(s, 0, 300, 0, { at: 4000 })).toThrow(/can't move it/);
  });
  it("won't put the cue ball on top of another ball", () => {
    const s = table(eightBall, [cue(5000, 6350), ball("1", 9000, 6350), ball("2", 15000, 9000)], { inHand: true });
    expect(() => shoot(s, 0, 300, 0, { at: 9100 })).toThrow(/in the way/);
    expect(() => shoot(s, 0, 300, 0, { at: 8000 })).not.toThrow();
  });
  it("breaks: a ball dropped on the break keeps the table open and the turn", () => {
    // Over lots of seeds, a hard break usually drops something; check the rules hold whatever happens.
    for (const seed of [1, 2, 3, 4, 5, 6]) {
      const s = game.newGame(eightBall, 2, seed);
      const after = shoot(s, 0, 1000, 0);
      expect(after.groups).toEqual([null, null]);
      expect(after.breaking).toBe(false);
      if (after.phase === "finished") continue;
      const sunk = after.world.bodies.filter((b) => b.pocketed && b.id !== "cue" && b.id !== "8");
      if (sunk.length && !after.inHand) expect(after.turn).toBe(0);
    }
  });
});

describe("eight-ball", () => {
  // Ball 1 at (2000, 2000) goes into the top-left pocket when the cue ball, at (4000, 4000), hits it square.
  const base = () => [cue(4000, 4000), ball("1", 2000, 2000), ball("9", 20000, 11000), ball("8", 20000, 2000), ball("2", 12000, 9000)];

  it("gives the shooter the group of the first ball sunk, and the turn again", () => {
    const s = shoot(table(eightBall, base()), UP_LEFT);
    expect(s.groups).toEqual(["solids", "stripes"]);
    expect(s.turn).toBe(0);
    expect(s.narration).toMatch(/takes the solids/);
    expect(body(s, "1").pocketed).toBe("top-left");
    expect(view(s, 0).players[0]!.line).toMatch(/Solids/);
    expect(view(s, 1).players[1]!.line).toMatch(/Stripes/);
  });
  it("passes the turn when nothing drops", () => {
    const s = shoot(table(eightBall, [cue(4000, 6350), ball("2", 9000, 6350), ball("9", 20000, 11000), ball("1", 20000, 1500)]), 0, 250);
    // The cue ball hits the 2 softly and nothing reaches a rail: a foul. Hit harder instead.
    expect(s.turn).toBe(1);
  });
  it("is a foul to hit the other side's ball first, and the other seat gets the ball in hand", () => {
    const rest = [cue(4000, 6350), ball("1", 20000, 2000), ball("9", 9000, 6350), ball("2", 20000, 11000)];
    const s = shoot(table(eightBall, rest, { groups: ["solids", "stripes"] }), 0, 700);
    expect(s.turn).toBe(1);
    expect(s.inHand).toBe(true);
    expect(s.narration).toMatch(/other side's ball first/);
    expect(view(s, 1).shoot!.place).toEqual({ y: 6350, min: 700, max: 24700 });
  });
  it("is a foul to hit nothing", () => {
    const s = shoot(table(eightBall, [cue(4000, 6350), ball("1", 20000, 2000), ball("9", 20000, 11000)]), 9000, 600);
    expect(s.narration).toMatch(/missed every ball/);
    expect(s.turn).toBe(1);
    expect(s.inHand).toBe(true);
  });
  it("puts a scratched cue ball back on the table, in hand for the other seat", () => {
    // The cue ball goes straight into the top-left pocket with nothing in the way.
    const s = shoot(table(eightBall, [cue(4000, 4000), ball("1", 20000, 2000), ball("9", 20000, 11000)]), UP_LEFT);
    expect(s.narration).toMatch(/scratched/);
    expect(s.turn).toBe(1);
    expect(s.inHand).toBe(true);
    expect(body(s, "cue").pocketed).toBeUndefined();
    expect(validateWorld(s.world)).toEqual([]);
  });
  it("offers behind-the-head-string only when ball in hand is off", () => {
    const s = shoot(table({ ...eightBall, ballInHand: false }, [cue(4000, 4000), ball("1", 20000, 2000), ball("9", 20000, 11000)]), UP_LEFT);
    expect(view(s, 1).shoot!.place!.max).toBe(6350);
  });
  it("loses the game for sinking the 8 early", () => {
    const s = shoot(table(eightBall, [cue(4000, 4000), ball("8", 2000, 2000), ball("1", 20000, 2000), ball("9", 20000, 11000)], { groups: ["solids", "stripes"] }), UP_LEFT);
    expect(s.phase).toBe("finished");
    expect(s.winners).toEqual([1]);
    expect(game.view(s, 0).over!.winners).toEqual([1]);
  });
  it("wins the game for sinking the 8 once the group is cleared", () => {
    const s = shoot(table(eightBall, [cue(4000, 4000), ball("8", 2000, 2000), ball("9", 20000, 11000)], { groups: ["solids", "stripes"] }), UP_LEFT);
    expect(s.phase).toBe("finished");
    expect(s.winners).toEqual([0]);
    expect(game.summary(s).order).toEqual([0, 1]);
  });
  it("loses for sinking the 8 on a scratch, even when it's the last ball", () => {
    // The 8 and the cue ball both drop: the cue ball follows the 8 in.
    const s = shoot(table(eightBall, [cue(2500, 2500), ball("8", 700, 700), ball("9", 20000, 11000)], { groups: ["solids", "stripes"] }), UP_LEFT, 1000);
    expect(body(s, "8").pocketed).toBe("top-left");
    expect(s.narration).toMatch(/scratched/);
    expect(s.phase).toBe("finished");
    expect(s.winners).toEqual([1]);
  });
  it("makes a scratch while shooting at the 8 a loss, or just a foul, as the rules say", () => {
    const rest = [cue(4000, 4000), ball("8", 20000, 2000), ball("9", 20000, 11000)];
    const lost = shoot(table(eightBall, rest, { groups: ["solids", "stripes"] }), UP_LEFT);
    expect(lost.winners).toEqual([1]);
    const foul = shoot(table({ ...eightBall, eightScratch: "foul" }, rest, { groups: ["solids", "stripes"] }), UP_LEFT);
    expect(foul.phase).toBe("playing");
    expect(foul.turn).toBe(1);
    expect(foul.inHand).toBe(true);
  });
  it("racks again for the 8 on the break", () => {
    const s0 = game.newGame(eightBall, 2, 1);
    const s = { ...s0, world: { ...s0.world, bodies: [cue(4000, 4000), ball("8", 2000, 2000), ball("1", 20000, 2000), ball("9", 20000, 11000)] } };
    const after = shoot(s, UP_LEFT, 800, 0);
    expect(after.phase).toBe("playing");
    expect(after.world.bodies).toHaveLength(16);
    expect(after.breaking).toBe(true);
    expect(after.turn).toBe(0);
  });
});

describe("calling the shot", () => {
  const rest = () => [cue(4000, 4000), ball("1", 2000, 2000), ball("2", 20000, 2000), ball("9", 20000, 11000)];
  it("asks for a call, and counts the called ball in the called pocket", () => {
    const s = table(eightBallCalled, rest());
    expect(view(s).shoot!.call!.pockets).toHaveLength(6);
    const after = shoot(s, UP_LEFT, 600, 0, { call: { ball: "1", pocket: "top-left" } });
    expect(after.turn).toBe(0);
    expect(after.groups[0]).toBe("solids");
  });
  it("doesn't count a ball that wasn't called, or went in elsewhere", () => {
    const plain = shoot(table(eightBallCalled, rest()), UP_LEFT);
    expect(plain.turn).toBe(1);
    expect(plain.groups).toEqual([null, null]);
    expect(plain.narration).toMatch(/doesn't count/);
    const wrong = shoot(table(eightBallCalled, rest()), UP_LEFT, 600, 0, { call: { ball: "1", pocket: "top-right" } });
    expect(wrong.turn).toBe(1);
  });
  it("refuses a call for a ball that isn't there or a pocket that doesn't exist", () => {
    const s = table(eightBallCalled, rest());
    expect(() => shoot(s, UP_LEFT, 600, 0, { call: { ball: "13", pocket: "top-left" } })).toThrow(GameError);
    expect(() => shoot(s, UP_LEFT, 600, 0, { call: { ball: "1", pocket: "nowhere" } })).toThrow(GameError);
  });
  it("loses for sinking the 8 without calling it", () => {
    const s = shoot(table(eightBallCalled, [cue(4000, 4000), ball("8", 2000, 2000), ball("9", 20000, 11000)], { groups: ["solids", "stripes"] }), UP_LEFT);
    expect(s.winners).toEqual([1]);
    const ok = shoot(table(eightBallCalled, [cue(4000, 4000), ball("8", 2000, 2000), ball("9", 20000, 11000)], { groups: ["solids", "stripes"] }), UP_LEFT, 600, 0, { call: { ball: "8", pocket: "top-left" } });
    expect(ok.winners).toEqual([0]);
  });
});

describe("nine-ball", () => {
  it("makes the lowest ball the one to hit first", () => {
    const rest = [cue(4000, 6350), ball("1", 20000, 2000), ball("2", 9000, 6350), ball("9", 20000, 11000)];
    const s = shoot(table(nineBall, rest), 0, 700);
    expect(s.narration).toMatch(/hit the 2 before the 1/);
    expect(s.inHand).toBe(true);
    expect(view(table(nineBall, rest)).info).toContain("Hit the 1 first");
  });
  it("wins for sinking the 9 with a clean shot, at any point", () => {
    const s = shoot(table(nineBall, [cue(4000, 4000), ball("1", 2000, 2000), ball("9", 20000, 11000)]), UP_LEFT);
    // Hitting the 1 first and sinking it is legal; the 9 is still on the table.
    expect(s.phase).toBe("playing");
    const win = shoot(table(nineBall, [cue(4000, 4000), ball("9", 2000, 2000), ball("1", 20000, 2000)]), UP_LEFT);
    // The 1 is the lowest ball and wasn't hit first: a foul, so the 9 is spotted.
    expect(win.phase).toBe("playing");
    expect(body(win, "9").pocketed).toBeUndefined();
    const clean = shoot(table(nineBall, [cue(4000, 4000), ball("9", 2000, 2000)]), UP_LEFT);
    expect(clean.phase).toBe("finished");
    expect(clean.winners).toEqual([0]);
  });
  it("keeps the turn for a ball sunk, loses it for a foul", () => {
    const s = shoot(table(nineBall, [cue(4000, 4000), ball("1", 2000, 2000), ball("9", 20000, 11000)]), UP_LEFT);
    expect(s.turn).toBe(0);
    expect(s.potted[0]).toBe(1);
  });
});

describe("partners", () => {
  it("has the partners take turns: the sides alternate, and each side's players do too", () => {
    let s = table(eightBall, [cue(4000, 6350), ball("1", 20000, 2000), ball("9", 20000, 11000)], {}, 4);
    const turns = [s.turn];
    for (let i = 0; i < 5; i++) {
      s = shoot(s, 9000, 600);
      if (s.inHand) s = { ...s, inHand: false };
      turns.push(s.turn);
    }
    expect(turns).toEqual([0, 1, 2, 3, 0, 1]);
    expect(view(s, 0).teams).toBe(true);
    expect(view(s, 0).players.map((p) => p.team)).toEqual([0, 1, 0, 1]);
  });
  it("wins for the partner too", () => {
    const s = shoot(table(eightBall, [cue(4000, 4000), ball("8", 2000, 2000), ball("9", 20000, 11000)], { groups: ["solids", "stripes"], turn: 2 }, 4), UP_LEFT, 600, 2);
    expect(s.winners).toEqual([0, 2]);
    expect(game.summary(s).order!.slice(0, 2)).toEqual([0, 2]);
  });
});

describe("the rules and the shot limit", () => {
  it("normalizes rules from anywhere, keeping each preset as it is", () => {
    for (const p of game.presets) expect(game.normalize(p)).toEqual(p);
    expect(game.normalize({ game: "nine", call: true }).call).toBe(false); // there is no calling in nine-ball
    expect(game.normalize({ id: "eight", ballInHand: false }).ballInHand).toBe(false);
  });
  it("calls the game after the shot limit, for whoever has sunk more", () => {
    let s = table(eightBall, [cue(4000, 6350), ball("1", 20000, 2000), ball("9", 20000, 11000)], { shots: 149, potted: [3, 1] });
    s = shoot(s, 9000, 600);
    expect(s.phase).toBe("finished");
    expect(s.winners).toEqual([0]);
    expect(view(s, 1).over!.title).toMatch(/Time's up/);
  });
  it("refuses spin, out-of-turn shots and junk, leaving the state alone", () => {
    const s = table(eightBall, [cue(4000, 6350), ball("1", 20000, 2000), ball("9", 20000, 11000)]);
    const before = JSON.stringify(s);
    expect(() => shoot(s, 0, 600, 0, { spin: 200 })).toThrow(GameError);
    expect(() => shoot(s, 0, 600, 1)).toThrow(/not your shot/);
    expect(() => shoot(s, 0, 600, 0, { body: "1" })).toThrow(GameError);
    expect(JSON.stringify(s)).toBe(before);
  });
});
