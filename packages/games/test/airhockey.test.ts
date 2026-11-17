// Air hockey's own rules: goals, walls, mallets that keep to their half, the seven-second rule, the
// clock and next goal wins, and the house at the far end. test/arcade.test.ts covers what every
// arcade game owes: whole numbers, replays, stored games, junk controls.
import { describe, expect, it } from "vitest";
import { AIRHOCKEY_FIELD, AIRHOCKEY_MALLET, AIRHOCKEY_PUCK, AIRHOCKEY_RATE, AIRHOCKEY_SCALE, AIRHOCKEY_SLOW, airHockey, type AirHockeyInput, type AirHockeyState } from "../src/index.js";

const S = AIRHOCKEY_SCALE;
const { width: W, height: H } = AIRHOCKEY_FIELD;
const RATE = AIRHOCKEY_RATE;

/** A game with the puck put where a test wants it, in field units and field units a tick. */
function table(seats: number, puck: { x: number; y: number; vx?: number; vy?: number }, rules: Partial<AirHockeyState["rules"]> = {}): AirHockeyState {
  const s = airHockey.newGame(airHockey.normalize({ ...airHockey.presets[0], ...rules }), seats, 1);
  s.puck = { x: puck.x * S, y: puck.y * S, vx: (puck.vx ?? 0) * S, vy: (puck.vy ?? 0) * S };
  s.side = puck.y > H / 2 ? 0 : 1;
  s.sideTicks = 0;
  return s;
}
/** Both mallets out of the way, in the corners of their own halves. */
function aside(s: AirHockeyState) {
  s.mallets[0].x = AIRHOCKEY_MALLET * S;
  s.mallets[0].y = (H - AIRHOCKEY_MALLET) * S;
  s.mallets[1].x = (W - AIRHOCKEY_MALLET) * S;
  s.mallets[1].y = AIRHOCKEY_MALLET * S;
  return s;
}
const run = (s: AirHockeyState, ticks: number, inputs: (AirHockeyInput | null)[] = []) => {
  for (let t = 0; t < ticks && s.phase !== "over"; t++) airHockey.step(s, inputs);
  return s;
};
const puckOf = (s: AirHockeyState) => airHockey.view(s).rink!.puck!;

describe("air hockey", () => {
  it("scores when the puck reaches an end wall inside the mouth, and gives the puck to the side scored on", () => {
    const s = aside(table(2, { x: W / 2, y: 1500, vy: -100 }));
    run(s, 20);
    expect(s.goals).toEqual([1, 0]);
    expect(s.phase).toBe("goal");
    expect(airHockey.view(s).rink!.puck).toBeNull();
    expect(airHockey.view(s).banner).toBe("1–0");
    run(s, RATE);
    expect(s.phase).toBe("play");
    // In the far half, where the far end can get at it, and still.
    expect(puckOf(s)).toMatchObject({ x: W / 2, vx: 0, vy: 0 });
    expect(puckOf(s).y).toBeLessThan(H / 2);
  });

  it("scores for the far end at the near wall", () => {
    const s = aside(table(2, { x: W / 2 + 300, y: H - 1500, vy: 100 }));
    run(s, 20);
    expect(s.goals).toEqual([0, 1]);
    expect(airHockey.summary(s).order).toEqual([1, 0]);
  });

  it("bounces off an end wall outside the mouth, and off the side walls", () => {
    const end = aside(table(2, { x: 800, y: 1500, vy: -100 }));
    run(end, 20);
    expect(end.goals).toEqual([0, 0]);
    expect(end.puck.vy).toBeGreaterThan(0);
    const side = aside(table(2, { x: 1000, y: H / 2 + 500, vx: -100 }));
    run(side, 12);
    expect(side.puck.vx).toBeGreaterThan(0);
    // A wall gives back less than it was given.
    expect(side.puck.vx).toBeLessThan(100 * S);
    expect(puckOf(side).x).toBeGreaterThanOrEqual(AIRHOCKEY_PUCK);
  });

  it("makes the goals as wide as the rules say", () => {
    const at = (mouth: "narrow" | "wide") => run(aside(table(2, { x: W / 2 + 1000, y: 1500, vy: -100 }, { mouth })), 20).goals;
    expect(at("narrow")).toEqual([0, 0]);
    expect(at("wide")).toEqual([1, 0]);
  });

  it("keeps a mallet in its own half and inside the walls, however far away it is sent", () => {
    const s = table(2, { x: W / 2, y: H / 2 });
    aside(s);
    s.puck.x = 300 * S;
    run(s, 120, [{ x: W, y: 0 }, { x: 0, y: H }]);
    const [near, far] = airHockey.view(s).rink!.ends;
    expect(near).toMatchObject({ seat: 0, x: W - AIRHOCKEY_MALLET, y: H / 2 + AIRHOCKEY_MALLET });
    expect(far).toMatchObject({ seat: 1, x: AIRHOCKEY_MALLET, y: H / 2 - AIRHOCKEY_MALLET });
  });

  it("leaves a mallet where it is when its seat is idle", () => {
    const s = table(2, { x: 300, y: H / 2 });
    const before = airHockey.view(s).rink!.ends.map((e) => [e.x, e.y]);
    run(s, 30, [airHockey.idle, null]);
    expect(airHockey.view(s).rink!.ends.map((e) => [e.x, e.y])).toEqual(before);
  });

  it("sends the puck away when a mallet strikes it, faster than the mallet was moving", () => {
    const s = table(2, { x: W / 2, y: H / 2 + 1500 });
    s.mallets[0].y = (H / 2 + 2600) * S;
    // Straight up the table through the puck.
    const hits: number[] = [];
    for (let t = 0; t < 20; t++) {
      airHockey.step(s, [{ x: W / 2, y: H / 2 + 400 }, null]);
      hits.push(...airHockey.view(s).events.filter((e) => e.kind === "hit" && e.seat === 0).map((e) => e.amount!));
    }
    expect(hits.length).toBe(1);
    expect(s.hits).toEqual([1, 0]);
    expect(s.puck.vy).toBeLessThan(-100 * S);
    expect(Math.abs(s.puck.vx)).toBeLessThan(5 * S);
  });

  it("never lets the puck go faster than the rules allow", () => {
    for (const [puck, top] of [["steady", 120], ["quick", 165]] as const) {
      const s = table(2, { x: W / 2, y: H / 2 + 1500, vy: 160 }, { puck });
      s.mallets[0].y = (H / 2 + 2600) * S;
      run(s, 12, [{ x: W / 2, y: H / 2 + 400 }, null]);
      const { vx, vy } = puckOf(s);
      expect(Math.hypot(vx, vy)).toBeLessThanOrEqual(top + 1);
      expect(Math.hypot(vx, vy)).toBeGreaterThan(top - 10);
    }
  });

  it("does not let a mallet push the puck through a wall, or pump it up against one", () => {
    // The puck against the near end's side wall, and the mallet driven into it for two seconds.
    const s = table(2, { x: AIRHOCKEY_PUCK, y: H / 2 + 2000 });
    s.mallets[0].x = 1500 * S;
    s.mallets[0].y = (H / 2 + 2000) * S;
    let walls = 0;
    for (let t = 0; t < RATE * 2; t++) {
      airHockey.step(s, [{ x: 0, y: H / 2 + 2000 }, null]);
      walls += airHockey.view(s).events.filter((e) => e.kind === "wall").length;
      const p = s.puck;
      expect(p.x).toBeGreaterThanOrEqual(AIRHOCKEY_PUCK * S);
      // The mallet has given way: it is never inside the puck at the end of a tick.
      expect(Math.hypot(p.x - s.mallets[0].x, p.y - s.mallets[0].y)).toBeGreaterThanOrEqual((AIRHOCKEY_PUCK + AIRHOCKEY_MALLET) * S - 2);
    }
    expect(walls).toBeLessThan(RATE / 4);
  });

  it("takes the puck from a side that sits on it for seven seconds", () => {
    const s = aside(table(2, { x: 1000, y: H / 2 + 1000 }));
    run(s, AIRHOCKEY_SLOW - 1);
    expect(puckOf(s).y).toBeGreaterThan(H / 2);
    expect(airHockey.view(s).rink!.slow).toEqual({ end: 0, ticksLeft: 1 });
    airHockey.step(s, []);
    expect(airHockey.view(s).events.some((e) => e.kind === "slow" && e.seat === 0)).toBe(true);
    expect(puckOf(s).y).toBeLessThan(H / 2);
    expect(airHockey.view(s).rink!.slow).toMatchObject({ end: 1 });
  });

  it("is won by the first to the target", () => {
    const s = aside(table(2, { x: W / 2, y: 1500, vy: -100 }, { goals: 3 }));
    s.goals = [2, 1];
    run(s, 20);
    expect(s.phase).toBe("over");
    const sum = airHockey.summary(s);
    expect(sum).toMatchObject({ over: true, scores: [3, 1], order: [0, 1], scoreLine: "{0} won: {0} 3, {1} 1" });
    expect(airHockey.view(s).rink!.winner).toBe(0);
    expect(airHockey.view(s).stage).toBe("Full time");
  });

  it("goes to whoever is ahead when the clock runs out", () => {
    const s = aside(table(2, { x: 1000, y: H / 2 + 1000 }, { minutes: 1 }));
    s.goals = [1, 2];
    run(s, RATE * 60 + 5);
    expect(s.phase).toBe("over");
    expect(s.tick).toBe(RATE * 60);
    expect(s.winner).toBe(1);
  });

  it("plays a minute of next goal wins when the clock runs out level, and then calls it a draw", () => {
    const s = aside(table(2, { x: 1000, y: H / 2 + 1000 }, { minutes: 1 }));
    run(s, RATE * 60);
    expect(s.phase).toBe("play");
    expect(s.overtime).toBe(true);
    expect(airHockey.view(s).banner).toBe("Next goal wins");
    const draw = run(JSON.parse(JSON.stringify(s)) as AirHockeyState, RATE * 61);
    expect(draw.phase).toBe("over");
    expect(draw.winner).toBe(2);
    expect(airHockey.summary(draw).scoreLine).toBe("A draw: {0} 0, {1} 0");
    // One goal in that minute ends it, whatever the target.
    s.puck = { x: (W / 2) * S, y: 1500 * S, vx: 0, vy: -100 * S };
    run(s, 20);
    expect(s.phase).toBe("over");
    expect(s.goals).toEqual([1, 0]);
    expect(s.winner).toBe(0);
  });

  it("plays the far end itself when there is one seat, better as the rules ask", () => {
    const goalsBy = (house: "gentle" | "sharp") => {
      let far = 0;
      for (let seed = 1; seed <= 3; seed++) {
        // Nobody at the near end.
        const s = airHockey.newGame(airHockey.normalize({ ...airHockey.presets[0], house, goals: 15, minutes: 3 }), 1, seed);
        run(s, RATE * 60 * 4);
        expect(s.phase).toBe("over");
        far += s.goals[1];
      }
      return far;
    };
    const gentle = goalsBy("gentle");
    const sharp = goalsBy("sharp");
    expect(gentle).toBeGreaterThan(0);
    expect(sharp).toBeGreaterThan(gentle);
    const s = airHockey.newGame(airHockey.normalize(null), 1, 2);
    const v = airHockey.view(s);
    expect(v.pilots).toHaveLength(1);
    expect(v.rink!.ends.map((e) => e.seat)).toEqual([0, null]);
    // The house's mallet belongs to no seat.
    expect(v.things.filter((t) => t.kind === "mallet").map((t) => t.seat)).toEqual([0, undefined]);
    expect(airHockey.summary(run(s, RATE * 60 * 7)).scoreLine).toMatch(/the house/i);
  });

  it("starts the puck in the middle, drifting toward an end the seed chose", () => {
    const ways = new Set<number>();
    for (let seed = 1; seed <= 12; seed++) {
      const s = airHockey.newGame(airHockey.normalize(null), 2, seed);
      expect(puckOf(s)).toMatchObject({ x: W / 2, y: H / 2 });
      ways.add(Math.sign(s.puck.vy));
    }
    expect([...ways].sort()).toEqual([-1, 1]);
  });

  it("gives a computer player a mallet that scores against an empty end", () => {
    const s = airHockey.newGame(airHockey.normalize({ ...airHockey.presets[0], minutes: 3 }), 2, 4);
    let n = 0;
    const rand = () => ((n = (n * 1103515245 + 12345) & 0x7fffffff) / 0x80000000);
    for (let t = 0; t < RATE * 60 * 4 && s.phase !== "over"; t++) airHockey.step(s, [airHockey.bot(s, 0, { skill: 0.8, sloppy: 0.05 }, rand), null]);
    expect(s.goals[0]).toBeGreaterThan(s.goals[1]);
    // And a bot's controls are a place on the field, or idle.
    const input = airHockey.bot(airHockey.newGame(airHockey.normalize(null), 2, 4), 1, {}, rand);
    expect(Number.isInteger(input.x) && Number.isInteger(input.y)).toBe(true);
  });
});
