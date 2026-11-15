// Bowling: the scoring of a game from its balls (strikes, spares, the last frame), the lane as a
// physics world, what a ball knocks down, the order of play, and computer players finishing whole
// games at every table size and preset.
import { simulate, validateWorld } from "@journey-to-code/physics";
import { describe, expect, it } from "vitest";
import { bowling, bestRoll, frameScores, GameError, laneWorld, newBowling, PIN_SPOTS, pinsDown, sameRest, scoreOf, worldBefore, type BowlingMove, type BowlingState } from "../src/index.js";

const rulesOf = (id = "bowling-ten") => bowling.normalize({ id });
const fresh = (id = "bowling-ten", seats = 2, seed = 7) => newBowling(rulesOf(id), seats, seed);
const SHARP = { skill: 1, sloppy: 0 } as never;

describe("scoring", () => {
  const score = (rolls: number[], frames = 10) => frameScores(rolls, frames).totals.filter((t) => t !== null).at(-1) ?? 0;
  it("scores a perfect game, a gutter game and a game of spares", () => {
    expect(score(Array(12).fill(10))).toBe(300);
    expect(score(Array(20).fill(0))).toBe(0);
    expect(score([5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5])).toBe(150);
  });
  it("scores a game with strikes, spares and misses the way the sheet does", () => {
    const rolls = [10, 7, 3, 9, 0, 10, 0, 8, 8, 2, 0, 6, 10, 10, 10, 8, 1];
    const { marks, totals } = frameScores(rolls, 10);
    expect(marks).toEqual(["X", "7/", "9-", "X", "-8", "8/", "-6", "X", "X", "X81"]);
    expect(totals).toEqual([20, 39, 48, 66, 74, 84, 90, 120, 148, 167]);
  });
  it("leaves a frame open until its bonus balls have been bowled", () => {
    expect(frameScores([10], 10).totals[0]).toBeNull();
    expect(frameScores([10, 10], 10).totals[0]).toBeNull();
    expect(frameScores([10, 10, 5], 10).totals[0]).toBe(25);
    expect(frameScores([7, 3], 10).totals[0]).toBeNull();
    expect(frameScores([7, 3, 4], 10).totals[0]).toBe(14);
    expect(scoreOf({ rolls: [[10, 10]], rules: rulesOf() }, 0)).toBe(30);
  });
  it("plays a short game of five frames", () => {
    expect(score([...Array(7).fill(10)], 5)).toBe(150);
    expect(score([3, 4, 3, 4, 3, 4, 3, 4, 3, 4], 5)).toBe(35);
  });
});

describe("the lane", () => {
  it("is a valid world, with ten pins numbered from the front, 7 on the left", () => {
    for (const bumpers of [false, true]) expect(validateWorld(laneWorld([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], { bumpers }))).toEqual([]);
    expect(PIN_SPOTS).toHaveLength(10);
    expect(PIN_SPOTS[0]).toEqual([0, 0]);
    const [seven, ten] = [PIN_SPOTS[6]!, PIN_SPOTS[9]!];
    expect(seven[0]).toBeLessThan(0);
    expect(ten[0]).toBe(-seven[0]);
    expect(seven[1]).toBe(ten[1]);
  });
  it("lets a ball down the middle knock down most of the pins, and a gutter ball none", () => {
    const world = laneWorld([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], { bumpers: false });
    expect(pinsDown(simulate(world, { body: "ball", angle: 26924, power: 850 }).world).length).toBeGreaterThanOrEqual(9);
    expect(pinsDown(simulate(world, { body: "ball", angle: 26000, power: 850 }).world)).toEqual([]);
  });
  it("is the same every time it is played", () => {
    const world = laneWorld([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], { bumpers: true });
    const a = simulate(world, { body: "ball", angle: 27040, power: 700 });
    const b = simulate(world, { body: "ball", angle: 27040, power: 700 });
    expect(a.world).toEqual(b.world);
    expect(a.ticks).toBe(b.ticks);
  });
  it("keeps a ball on the lane when the bumpers are up", () => {
    const world = laneWorld([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], { bumpers: true });
    const ball = simulate(world, { body: "ball", angle: 26500, power: 700 }).world.bodies.find((b) => b.id === "ball")!;
    expect(ball.out === undefined || ball.out === "pit").toBe(true);
  });
});

describe("play", () => {
  const roll = (s: BowlingState, seat: number, angle: number, power = 850) => bowling.apply(s, seat, { type: "shot", body: "ball", angle, power });
  const STRIKE = 26924;
  const GUTTER = 26000;

  it("starts with the seat chosen by the seed, and refuses anyone else", () => {
    const s = fresh();
    expect(bowling.view(s, s.turn).shoot).toMatchObject({ body: "ball" });
    expect(bowling.view(s, 1 - s.turn).shoot).toBeNull();
    expect(() => roll(s, 1 - s.turn, STRIKE)).toThrow(GameError);
    expect(() => roll(s, s.turn, 40000)).toThrow(GameError);
    expect(() => bowling.apply(s, s.turn, { type: "shot", body: "ball", angle: STRIKE, power: 5 })).toThrow(GameError);
    expect(() => bowling.apply(s, s.turn, { type: "shot", body: "pin-1", angle: STRIKE, power: 500 })).toThrow(GameError);
  });

  it("gives a strike one ball, and then the next seat steps up", () => {
    let s = fresh("bowling-ten", 2);
    const first = s.turn;
    // Find a ball down the middle that knocks all ten down.
    const ideal = bestRoll([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], s.rules);
    s = roll(s, first, ideal.angle, ideal.power);
    expect(s.rolls[first]).toEqual([10]);
    expect(s.turn).toBe(1 - first);
    expect(s.standing).toHaveLength(10);
    expect(bowling.view(s, 0).narration).toContain("strike");
  });

  it("gives a frame two balls, with the standing pins left for the second", () => {
    let s = fresh("bowling-ten", 1);
    s = roll(s, 0, GUTTER);
    expect(s.rolls[0]).toEqual([0]);
    expect(s.turn).toBe(0);
    expect(s.frame).toBe(0);
    expect(s.standing).toHaveLength(10);
    s = roll(s, 0, GUTTER);
    expect(s.frame).toBe(1);
    expect(s.rolls[0]).toEqual([0, 0]);
  });

  it("takes pins that fell off the deck for the second ball", () => {
    let s = fresh("bowling-ten", 1);
    s = roll(s, 0, 27000, 850);
    const left = s.standing.length;
    expect(left).toBeGreaterThan(0);
    expect(left).toBe(10 - s.rolls[0]![0]!);
    const world = bowling.view(s, 0).table.world;
    expect(world.bodies.filter((b) => b.id.startsWith("pin-"))).toHaveLength(left);
  });

  it("lets the last frame have three balls after a strike or a spare, and ends the game", () => {
    const s0 = fresh("bowling-five", 1);
    const s: BowlingState = { ...s0, frame: 4, cur: [10], standing: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10], rolls: [[0, 0, 0, 0, 0, 0, 0, 0, 10]] };
    const next = roll(s, 0, GUTTER);
    expect(next.phase).toBe("playing");
    expect(next.cur).toEqual([10, 0]);
    const over = roll(next, 0, GUTTER);
    expect(over.phase).toBe("finished");
    expect(bowling.summary(over)).toMatchObject({ over: true, winners: [0] });
    // Without a strike or a spare the game ends after two.
    const plain: BowlingState = { ...s0, frame: 4, cur: [3], standing: [4, 5, 6, 7, 8, 9, 10], rolls: [[0, 0, 0, 0, 0, 0, 0, 0, 3]] };
    expect(roll(plain, 0, GUTTER).phase).toBe("finished");
  });

  it("carries a game round the table, a frame at a time, and picks the highest score", () => {
    let s = fresh("bowling-five", 3, 11);
    const order = [s.turn, (s.turn + 1) % 3, (s.turn + 2) % 3];
    for (let n = 0; n < 40 && s.phase === "playing"; n++) {
      const m = bowling.bot(s, s.turn, SHARP) as BowlingMove;
      s = bowling.apply(s, s.turn, m);
    }
    expect(s.phase).toBe("finished");
    for (const seat of order) expect(s.rolls[seat]!.length).toBeGreaterThanOrEqual(5);
    const summary = bowling.summary(s);
    const scores = [0, 1, 2].map((i) => scoreOf(s, i));
    expect(summary.winners).toEqual(scores.flatMap((v, i) => (v === Math.max(...scores) ? [i] : [])));
  });

  it("shows every seat the same lane and a shot a browser can replay to the same rest", () => {
    let s = fresh();
    s = roll(s, s.turn, 26960, 800);
    for (const seat of [0, 1]) {
      const v = bowling.view(s, seat);
      expect(v.last).not.toBeNull();
      const before = worldBefore(v)!;
      const again = simulate(before, v.last!.shot);
      expect(sameRest(again.world, v.last!.rest)).toBe(true);
    }
    expect(bowling.view(s, 0).table.world).toEqual(bowling.view(s, 1).table.world);
  });
});

describe("the computer player", () => {
  it("finishes whole games at every table size and preset, the same way from the same seed", () => {
    for (const preset of bowling.presets) {
      for (const seats of [1, 2, 4, 6]) {
        const run = () => {
          let s = newBowling(bowling.normalize(preset), seats, 5);
          for (let n = 0; n < 400 && s.phase === "playing"; n++) {
            const m = bowling.bot(s, s.turn, { skill: 0.6, sloppy: 0.1 } as never, () => 0.5) as BowlingMove;
            s = bowling.apply(s, s.turn, m);
          }
          return s;
        };
        const a = run();
        expect(a.phase, `${preset.id} for ${seats}`).toBe("finished");
        expect(run().rolls).toEqual(a.rolls);
      }
    }
  });

  it("bowls better the sharper it is", () => {
    const average = (skill: number) => {
      let total = 0;
      let n = 0;
      for (let seed = 1; seed <= 12; seed++) {
        let s = newBowling(bowling.normalize({ id: "bowling-ten" }), 1, seed);
        let r = seed;
        const rand = () => ((r = (r * 1664525 + 1013904223) >>> 0) / 4294967296);
        for (let k = 0; k < 40 && s.phase === "playing"; k++) s = bowling.apply(s, 0, bowling.bot(s, 0, { skill, sloppy: 0 } as never, rand) as BowlingMove);
        total += scoreOf(s, 0);
        n++;
      }
      return total / n;
    };
    expect(average(1)).toBeGreaterThan(average(0.1) + 30);
  });
});
