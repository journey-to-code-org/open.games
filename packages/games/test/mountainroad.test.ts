// The Mountain Road's own rules: the bends, the traffic, the law, the gas stations and the damage.
// It is not in the catalogue, so what test/arcade.test.ts asks of every arcade game is asked of it here.
import { mulberry32 } from "@journey-to-code/rules";
import { describe, expect, it } from "vitest";
import { ARCADE_GAMES, MOUNTAIN_ROAD_PRESETS, ROAD_LIMIT, mountainRoad as game, mountainRoadResults, stockBuild, CAR_MODELS, type MountainRoadInput, type MountainRoadState } from "../src/index.js";

const RATE = game.rate;
const car = (key: string) => stockBuild(CAR_MODELS.findIndex((m) => m.key === key));
const quiet = game.normalize({ id: "quiet", stages: 2, stageLength: 1500, traffic: "light", patrols: 0 });
const wholeNumbers = (value: unknown): boolean => (typeof value === "number" ? Number.isSafeInteger(value) : !value || typeof value !== "object" || Object.values(value).every(wholeNumbers));

/** Drive until `until`, or the run ends. `hold` is handed the state and gives the controls. */
function drive(s: MountainRoadState, hold: (s: MountainRoadState) => Partial<MountainRoadInput>, until: (s: MountainRoadState) => boolean = () => false, limit = RATE * 600) {
  for (let t = 0; t < limit && s.phase !== "over" && !until(s); t++) game.step(s, [{ gas: 0, brake: 0, steer: 0, gear: 0, stage: true, build: car("wasp"), ...hold(s) }]);
  return s;
}
/** A computer driver at the wheel, with any of the controls overridden. */
const chauffeur = (skill: number, over: (s: MountainRoadState, input: MountainRoadInput) => Partial<MountainRoadInput> = () => ({})) => {
  const rand = mulberry32(7);
  return (s: MountainRoadState) => {
    const input = game.bot(s, 0, { skill, sloppy: 0 }, rand);
    return { ...input, build: car("wasp"), ...over(s, input) };
  };
};

describe("the mountain road", () => {
  it("is an arcade game that is kept out of the catalogue", () => {
    expect(ARCADE_GAMES.some((g) => g.id === "mountainroad")).toBe(false);
    expect(game.category).toBe("arcade");
    for (const preset of MOUNTAIN_ROAD_PRESETS) {
      expect(game.validate(preset)).toEqual([]);
      expect(game.normalize(preset)).toEqual(preset);
      expect(game.describe(preset).length).toBeGreaterThan(2);
    }
    expect(game.validate({ ...MOUNTAIN_ROAD_PRESETS[0]!, stages: 0 }).length).toBe(1);
    expect(game.input(null)).toEqual(game.idle);
    for (const junk of [7, "left", [], { steer: 900, gas: -4, brake: NaN, gear: 2.7, build: "x" }]) {
      const input = game.input(junk);
      expect(wholeNumbers(input)).toBe(true);
      expect(game.input(input)).toEqual(input);
    }
  });

  it("is the same run from the same seed, in whole numbers, and a different road from another", () => {
    const run = (seed: number) => {
      const s = game.newGame(MOUNTAIN_ROAD_PRESETS[2]!, 2, seed);
      const rand = mulberry32(seed);
      for (let t = 0; t < RATE * 50; t++) game.step(s, [game.bot(s, 0, { skill: 0.9 }, rand), game.bot(s, 1, { skill: 0.3, sloppy: 0.3 }, rand)]);
      return s;
    };
    const a = run(11);
    expect(run(11)).toEqual(a);
    expect(wholeNumbers(a)).toBe(true);
    expect(JSON.parse(JSON.stringify(a))).toEqual(a);
    expect(run(12).curve).not.toEqual(a.curve);
    expect(game.summary(a).score).toBeGreaterThan(0);
    expect(game.view(a).score).toBe(game.summary(a).score);
    expect(a.traffic.length).toBeGreaterThan(0);
  });

  it("ends when nobody touches it, and then stands still", () => {
    const s = game.newGame(quiet, 1, 3);
    for (let t = 0; t < RATE * 60 * 19 && !game.summary(s).over; t++) game.step(s, [null]);
    expect(game.summary(s).over).toBe(true);
    const was = JSON.stringify(s);
    game.step(s, [{ ...game.idle, gas: 100, gear: 1 }]);
    expect(JSON.stringify(s)).toBe(was);
  });

  it("can be driven from one end to the other, stopping for gas on the way", () => {
    const s = drive(game.newGame(quiet, 1, 5), chauffeur(0.9));
    const [run] = mountainRoadResults(s);
    expect(run).toMatchObject({ out: "finished", won: true, place: 1, distance: 3000, fines: 0 });
    expect(run!.legs).toHaveLength(2);
    expect(Math.abs(run!.legs[0]! + run!.legs[1]! - run!.time)).toBeLessThanOrEqual(2);
    expect(run!.engineWear).toBeGreaterThan(0);
    expect(game.view(s).road!.stations).toEqual([1_500_000, 3_000_000]);
    expect(game.view(s).banner).toBe("{0} wins");
  });

  it("fills the tank at a station, and stops the clock while it does", () => {
    const s = game.newGame(quiet, 1, 5);
    drive(s, chauffeur(0.9), (st) => st.drivers[0]!.stage === 1);
    const d = s.drivers[0]!;
    expect(d.rest).toBeGreaterThan(0);
    expect(game.view(s).road!.drivers[0]).toMatchObject({ fuel: 1000, speed: 0, stage: 1 });
    const clock = d.clock;
    game.step(s, [chauffeur(0.9)(s) as MountainRoadInput]);
    expect(d.clock).toBe(clock);
  });

  it("pushes a car wide in a bend, and wider the faster it goes", () => {
    // Put the car in a bend at a speed, hands off the wheel, and see how fast it slides across.
    const slide = (mph: number) => {
      const s = game.newGame(quiet, 1, 5);
      drive(s, () => ({}), (st) => st.phase === "driving");
      const piece = s.curve.findIndex((c) => Math.abs(c) > 6000);
      const d = s.drivers[0]!;
      d.car.dist = (s.at[piece]! + 5) * 10_000;
      d.car.speed = mph * 4470;
      for (let t = 0; t < 20; t++) game.step(s, [{ ...game.idle, stage: true, build: car("wasp") }]);
      // It goes to the outside of the bend.
      expect(Math.sign(d.vx)).toBe(-Math.sign(s.curve[piece]!));
      return Math.abs(d.vx);
    };
    expect(slide(80)).toBeGreaterThan(slide(40) * 2);
    expect(slide(40)).toBeGreaterThan(0);
  });

  it("ends the run at the drop, and only scrapes at the rock", () => {
    const off = drive(game.newGame(quiet, 1, 5), (s) => ({ gas: 100, gear: 1, steer: s.phase === "driving" ? -100 : 0 }), (s) => !!s.drivers[0]!.out, RATE * 60);
    expect(mountainRoadResults(off)[0]).toMatchObject({ out: "edge", damage: 1000, won: false });
    const rock = drive(game.newGame(quiet, 1, 5), (s) => ({ gas: 100, gear: 2, steer: s.phase === "driving" ? 100 : 0 }), (s) => s.drivers[0]!.damage > 0 || !!s.drivers[0]!.out, RATE * 60);
    expect(rock.drivers[0]!.out).toBe(0);
    expect(rock.drivers[0]!.damage).toBeGreaterThan(0);
    expect(rock.drivers[0]!.x).toBe(game.view(rock).road!.wall);
  });

  it("hurts a car that hits another, and a hurt car is a slower one", () => {
    const s = game.newGame(game.normalize({ ...quiet, traffic: "heavy" }), 1, 9);
    // Flat out up the middle of your own lane until something is in the way.
    drive(s, chauffeur(0.9, () => ({ gas: 100, brake: 0 })), (st) => st.drivers[0]!.damage > 0 || !!st.drivers[0]!.out, RATE * 120);
    const d = s.drivers[0]!;
    expect(d.damage).toBeGreaterThan(0);
    // The same car, the same road: with damage on it, it gets there later.
    const time = (damage: number) => {
      const t = game.newGame(quiet, 1, 5);
      drive(t, (st) => {
        if (st.phase === "driving" && st.tick < RATE * 30) st.drivers[0]!.damage = damage;
        return chauffeur(0.9)(st);
      });
      return mountainRoadResults(t)[0]!.time;
    };
    expect(time(600)).toBeGreaterThan(time(0));
  });

  it("warns of a patrol car, and sends it after a car that goes by too fast", () => {
    const rules = game.normalize({ ...quiet, patrols: 3 });
    const s = game.newGame(rules, 1, 5);
    let chirped = 0;
    let seen = false;
    drive(s, chauffeur(0.2, (st) => {
      const d = game.view(st).road!.drivers[0]!;
      chirped = Math.max(chirped, d.radar);
      seen ||= game.view(st).road!.patrols.some((p) => !p.lit);
      return {};
    }), (st) => st.drivers[0]!.cop === 1, RATE * 200);
    expect(chirped).toBe(3);
    expect(seen).toBe(true);
    expect(s.drivers[0]!.cop).toBe(1);
    expect(s.drivers[0]!.car.speed / 4470).toBeGreaterThan(ROAD_LIMIT + 10);
    expect(game.view(s).road!.drivers[0]!.chase).not.toBeNull();
    expect(game.view(s).road!.patrols.some((p) => p.lit)).toBe(true);
    // Pulling over is a ticket and twenty seconds.
    drive(s, chauffeur(0.2), (st) => st.drivers[0]!.fines > 0, RATE * 60);
    expect(s.drivers[0]).toMatchObject({ fines: 150, penalty: RATE * 20, cop: 0 });
    expect(s.drivers[0]!.rest).toBeGreaterThan(0);
  });

  it("costs more to be run down than to pull over, and a careful driver is never stopped", () => {
    const rules = game.normalize({ ...quiet, patrols: 3 });
    const s = game.newGame(rules, 1, 5);
    drive(s, chauffeur(0.2), (st) => st.drivers[0]!.cop === 1, RATE * 200);
    // Carry on at a crawl in the road with the lights on behind.
    // Keep driving as if nobody were there, with the lights on behind.
    const deaf = chauffeur(0.2);
    drive(s, (st) => {
      const blind = structuredClone(st);
      blind.drivers[0]!.cop = 0;
      return deaf(blind);
    }, (st) => st.drivers[0]!.fines > 0 || !!st.drivers[0]!.out, RATE * 90);
    expect(s.drivers[0]).toMatchObject({ fines: 400, penalty: RATE * 45 });
    const careful = drive(game.newGame(rules, 1, 5), chauffeur(0.9));
    expect(mountainRoadResults(careful)[0]).toMatchObject({ out: "finished", fines: 0 });
  });

  it("ends the run, and costs a thousand dollars, to hit a parked patrol car", () => {
    const s = game.newGame(game.normalize({ ...quiet, patrols: 2 }), 1, 5);
    const trap = s.traps[0]!;
    // Up the road at the limit, then onto the verge where he is sitting.
    drive(s, chauffeur(0.9, (st, input) => (st.drivers[0]!.car.dist / 10_000 > trap - 60 ? { steer: 100, gas: 60, brake: 0 } : input)), (st) => !!st.drivers[0]!.out, RATE * 200);
    expect(mountainRoadResults(s)[0]).toMatchObject({ out: "arrested", fines: 1000, won: false });
    expect(mountainRoadResults(s)[0]!.damage).toBeGreaterThan(0);
    expect(game.view(s).road!.drivers[0]!.out).toBe("arrested");
  });

  it("has traffic that gets out of the way of a car on the wrong side, and waits behind a slow one", () => {
    const s = game.newGame(quiet, 1, 5);
    drive(s, () => ({}), (st) => st.phase === "driving");
    const d = s.drivers[0]!;
    const here = d.car.dist;
    const cruise = -22 * 10_000;
    s.traffic = [{ id: 900, kind: 0, s: here + 60 * 10_000, x: -1800, v: cruise, cruise, lane: -1800 }, { id: 901, kind: 0, s: here - 12 * 10_000, x: 1800, v: 20 * 10_000, cruise: 20 * 10_000, lane: 1800 }];
    // Sitting still, in the oncoming lane for the one and in the way of the other.
    d.x = -1800;
    for (let t = 0; t < 30; t++) game.step(s, [{ ...game.idle, stage: true, build: car("wasp") }]);
    const oncoming = s.traffic.find((t) => t.id === 900)!;
    expect(Math.abs(oncoming.v)).toBeLessThan(Math.abs(cruise));
    expect(oncoming.x).toBeLessThan(-1800);
    d.x = 1800;
    d.shaken = 600;
    for (let t = 0; t < 40; t++) game.step(s, [{ ...game.idle, stage: true, build: car("wasp") }]);
    const behind = s.traffic.find((t) => t.id === 901);
    if (behind) expect(behind.v).toBeLessThan(20 * 10_000);
  });

  it("puts two drivers on the same road, and the one who gets there first wins", () => {
    const s = game.newGame(quiet, 2, 8);
    const rand = mulberry32(8);
    while (!game.summary(s).over) game.step(s, [{ ...game.bot(s, 0, { skill: 1, sloppy: 0 }, rand), build: car("zenith") }, { ...game.bot(s, 1, { skill: 0.3, sloppy: 0.2 }, rand), build: car("estate") }]);
    const [quick, slow] = mountainRoadResults(s);
    expect(quick).toMatchObject({ out: "finished", place: 1, won: true });
    expect(slow!.won).toBe(false);
    if (slow!.out === "finished") expect(slow!.time).toBeGreaterThan(quick!.time);
    expect(game.summary(s).order[0]).toBe(0);
  });
});
