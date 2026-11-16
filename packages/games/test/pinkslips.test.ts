// Road to the Shootout's own rules: the cars and what parts do to them, the garage, and the race itself (the
// light, the launch, the shifts, and who wins). test/arcade.test.ts already drives it with every
// preset in every number of lanes.
import { describe, expect, it } from "vitest";
import {
  CAR_MODELS, EIGHTH_MILE, GARAGE_BAYS, GARAGE_STAKE, PART_SLOTS, PARTS, QUARTER_MILE,
  afterRace, bodyCost, botRide, buildOf, carValue, garageAct, garageView, giveCar, horsepower, idealFuel, launchRpm, loadGarage, oilPressure, oilStarved, restingCar, driveCar, salvageValue, scrapValue, newDay, newGarage,
  partCost, pinkSlips, pinkSlipsResults, safeBuild, settleUp, specOf, stockBuild, takeCar, timeslip, wellDriven,
  type Build, type PinkSlipsInput, type PinkSlipsState,
} from "../src/index.js";

const model = (key: string) => CAR_MODELS.findIndex((m) => m.key === key);
const game = pinkSlips;
const RATE = game.rate;

/** Race `builds` against each other, each driven by `drive` (the tick since green, or a negative number before it). */
function race(builds: Build[], drive: (seat: number, s: PinkSlipsState) => Partial<PinkSlipsInput>, rules: unknown = null, seed = 4) {
  const s = game.newGame(game.normalize(rules), builds.length, seed);
  for (let t = 0; t < RATE * 90 && !game.summary(s).over; t++) game.step(s, builds.map((build, seat) => ({ gas: 0, gear: 0, stage: true, build, ...drive(seat, s) })));
  return s;
}
/** Leaves `late` ticks after the green and drives it well from there. */
const driven = (late = 6) => (seat: number, s: PinkSlipsState): Partial<PinkSlipsInput> => {
  const lane = s.lanes[seat]!;
  const spec = specOf(lane.build);
  if (s.phase !== "racing" || s.tick - s.greenAt < late) return { gas: 40, gear: 0 };
  return wellDriven(spec, lane.car, s.track);
};

describe("the cars", () => {
  it("come in three tiers, and the one everybody wants is at the top", () => {
    expect(CAR_MODELS.filter((m) => m.tier === 0).length).toBeGreaterThanOrEqual(4);
    expect(CAR_MODELS.filter((m) => m.tier === 1).length).toBeGreaterThanOrEqual(3);
    expect(CAR_MODELS[model("umbra")]).toMatchObject({ tier: 2, drive: "awd", year: 1990 });
    expect(new Set(CAR_MODELS.map((m) => m.key)).size).toBe(CAR_MODELS.length);
  });

  it("run the times you would expect of them", () => {
    for (const [i, m] of CAR_MODELS.entries()) {
      const slip = timeslip(stockBuild(i));
      expect(slip.finished, m.name).toBe(true);
      if (m.tier === 0) expect(slip.et, m.name).toBeGreaterThan(18_000);
      if (m.tier === 1) expect(slip.et > 14_000 && slip.et < 18_000, `${m.name} ${slip.et}`).toBe(true);
      if (m.tier === 2) expect(slip.et > 13_000 && slip.et < 15_500, `${m.name} ${slip.et}`).toBe(true);
      // An eighth is quicker than a quarter, and the same run every time.
      expect(timeslip(stockBuild(i), EIGHTH_MILE).et).toBeLessThan(slip.et);
      expect(timeslip(stockBuild(i))).toEqual(slip);
    }
  });

  it("leave hardest with all four wheels driven, and it shows on a back road", () => {
    const umbra = timeslip(stockBuild(model("umbra")), QUARTER_MILE, 780);
    for (const key of ["cyclone", "zenith", "brumby"]) expect(umbra.sixty, key).toBeLessThan(timeslip(stockBuild(model(key)), QUARTER_MILE, 780).sixty);
  });

  it("are quicker for every part bolted on, and slower worn out", () => {
    const i = model("brick");
    const stock = timeslip(stockBuild(i)).et;
    for (const [n, slot] of PART_SLOTS.entries()) {
      const build = stockBuild(i);
      build[n + 1] = PARTS[slot].levels.length;
      // With the fuel set for it: a part that helps it breathe wants more.
      build[12] = idealFuel(build);
      expect(timeslip(build).et, slot).toBeLessThan(stock);
    }
    expect(timeslip(stockBuild(i, 300, 300)).et).toBeGreaterThan(stock);
    expect(horsepower(specOf([i, 3, 3, 3, 3]))).toBeGreaterThan(horsepower(specOf(stockBuild(i))));
    // Boost needs a turbo: it does nothing bolted to a car without one.
    expect(safeBuild([model("sparrow"), 0, 0, 0, 3])[4]).toBe(0);
    // A manual swap takes the automatic out.
    expect(specOf(stockBuild(model("estate"))).auto).toBe(true);
    expect(specOf([model("estate"), 0, 0, 0, 0, 0, 0, 1]).auto).toBe(false);
  });

  it("make a car that exists out of anything", () => {
    for (const junk of [null, 7, "car", {}, [99, -4, 9.5, NaN, Infinity, "x"], [2, 1, 1, 1, 1, 1, 1, 1, 9, -5, 4000]]) {
      const build = safeBuild(junk);
      expect(build).toHaveLength(14);
      expect(build.every(Number.isSafeInteger)).toBe(true);
      expect(safeBuild(build)).toEqual(build);
    }
    // A blown engine goes nowhere.
    expect(timeslip(stockBuild(0, 0)).finished).toBe(false);
  });
});

describe("the race", () => {
  it("is won by the quicker car when both leave together", () => {
    const s = race([stockBuild(model("sparrow")), stockBuild(model("zenith"))], driven());
    const [slow, fast] = pinkSlipsResults(s);
    expect(fast).toMatchObject({ place: 1, won: true, finished: true, foul: false });
    expect(slow).toMatchObject({ place: 2, won: false, finished: true });
    expect(fast!.time!).toBeLessThan(slow!.time!);
    expect(game.summary(s).order).toEqual([1, 0]);
    expect(game.view(s).race!.lanes[1]!.place).toBe(1);
    expect(game.view(s).banner).toBe("{1} wins");
  });

  it("can be won on the light by the slower car", () => {
    // The same car in both lanes, and one of them asleep for half a second.
    const car = stockBuild(model("kite"));
    const s = race([car, car], (seat, st) => driven(seat === 0 ? 3 : 33)(seat, st));
    const [awake, asleep] = pinkSlipsResults(s);
    expect(awake!.won).toBe(true);
    expect(asleep!.reaction! - awake!.reaction!).toBe(500);
    // On the slip they ran the same time: the race was lost at the tree.
    expect(Math.abs(awake!.time! - asleep!.time!)).toBeLessThan(20);
  });

  it("is lost by leaving before the green, whatever you run", () => {
    const s = race([stockBuild(model("zenith")), stockBuild(model("sparrow"))], (seat, st) => (seat === 0 && st.phase === "tree" ? { gas: 100, gear: 1 } : seat === 0 && st.phase === "racing" ? wellDriven(specOf(st.lanes[0]!.build), st.lanes[0]!.car) : driven()(seat, st)));
    const [jumped, honest] = pinkSlipsResults(s);
    expect(jumped).toMatchObject({ foul: true, finished: true, won: false, place: 2 });
    expect(honest).toMatchObject({ foul: false, won: true, place: 1 });
    expect(game.summary(s).scores[0]).toBe(0);
    expect(game.view(s).things.some((t) => t.kind === "light:red" && t.seat === 0)).toBe(true);
  });

  it("holds the car on the line until the tree starts", () => {
    const s = game.newGame(game.normalize(null), 1, 1);
    while (s.phase !== "tree") {
      game.step(s, [{ gas: 100, gear: 1, stage: true, build: stockBuild(0) }]);
      expect(s.lanes[0]!.car.dist).toBe(0);
    }
    expect(s.lanes[0]!.foul).toBe(false);
  });

  it("blows an engine held past the redline, and the car comes back needing one", () => {
    const s = race([stockBuild(model("wasp"))], (_seat, st) => (st.phase === "racing" ? { gas: 100, gear: 1 } : {}));
    const [run] = pinkSlipsResults(s);
    expect(run).toMatchObject({ blown: true, finished: false, won: false });
    expect(game.summary(s).score).toBe(0);
    const g = newGarage(1);
    const car = giveCar(g, { model: model("wasp"), engine: 900, rubber: 900 })!;
    afterRace(g, car.id, run!);
    expect(car.engine).toBe(0);
    expect(garageView(g).cars[0]!.runs).toBe(false);
  });

  it("punishes too many revs off the line with wheelspin", () => {
    const build = stockBuild(model("brumby"));
    const flatOut = race([build], (_seat, st) => {
      if (st.phase !== "racing") return { gas: 70, gear: 0 };
      const hold = wellDriven(specOf(build), st.lanes[0]!.car, st.track);
      return { gas: 100, gear: hold.gear };
    });
    const feathered = race([build], driven(0));
    expect(flatOut.lanes[0]!.car.smoke).toBeGreaterThan(feathered.lanes[0]!.car.smoke);
    expect(pinkSlipsResults(flatOut)[0]!.rubberWear).toBeGreaterThan(pinkSlipsResults(feathered)[0]!.rubberWear);
    expect(launchRpm(specOf(build))).toBeLessThan(specOf(build).redline);
  });

  it("starts each kind of start its own way, and never shows when an arm will drop", () => {
    const pro = game.newGame(game.normalize({ id: "pro" }), 1, 2);
    const street = game.newGame(game.normalize({ id: "street" }), 1, 2);
    const strip = game.newGame(game.normalize(null), 1, 2);
    for (const s of [pro, street, strip]) while (s.phase !== "tree") game.step(s, [{ gas: 0, gear: 0, stage: true, build: stockBuild(0) }]);
    expect(pro.greenAt - pro.treeAt).toBe(24);
    expect(strip.greenAt - strip.treeAt).toBe(90);
    expect(game.view(pro).race!.tree.ambers).toEqual([true, true, true]);
    expect(game.view(strip).race!.tree.ambers).toEqual([true, false, false]);
    expect(game.view(street).race!.tree.ambers).toEqual([false, false, false]);
    expect(street.track).toBeLessThan(strip.track);
    expect(street.line).toBe(QUARTER_MILE);
    expect(game.newGame(game.normalize({ id: "eighth" }), 1, 2).line).toBe(EIGHTH_MILE);
  });

  it("rolls a seat up in a loaner if it never stages, and keeps a staged car as it was", () => {
    const s = game.newGame(game.normalize(null), 2, 6);
    const zenith = stockBuild(model("zenith"));
    game.step(s, [{ gas: 0, gear: 0, stage: true, build: zenith }]);
    expect(s.lanes.map((l) => l.staged)).toEqual([true, false]);
    // Swapping cars after staging does nothing.
    game.step(s, [{ gas: 0, gear: 0, stage: true, build: stockBuild(model("umbra")) }]);
    expect(s.lanes[0]!.build).toEqual(zenith);
    while (s.phase === "staging") game.step(s, [{ gas: 0, gear: 0, stage: true, build: zenith }]);
    expect(s.tick).toBeGreaterThanOrEqual(RATE * 20);
    expect(CAR_MODELS[s.lanes[1]!.build[0]!]!.tier).toBe(0);
  });

  it("gives a computer player a car to suit it", () => {
    expect(CAR_MODELS[botRide(0.25, 0)[0]!]!.tier).toBe(0);
    expect(CAR_MODELS[botRide(0.65, 1)[0]!]!.tier).toBe(1);
    expect(CAR_MODELS[botRide(1, 2)[0]!]!.tier).toBe(2);
  });
});

describe("the garage", () => {
  it("starts with a stake, no cars, and something in the classifieds it can afford", () => {
    for (let seed = 1; seed <= 40; seed++) {
      const g = newGarage(seed);
      expect(g.cash).toBe(GARAGE_STAKE);
      expect(g.cars).toEqual([]);
      expect(g.listings.some((l) => l.price <= GARAGE_STAKE && CAR_MODELS[l.model]!.tier === 0), `seed ${seed}`).toBe(true);
      expect(newGarage(seed)).toEqual(g);
      expect(loadGarage(JSON.parse(JSON.stringify(g)))).toEqual(g);
    }
  });

  it("only ever lists the cars everybody wants as basket cases, and rarely", () => {
    let prizes = 0;
    let total = 0;
    const g = newGarage(77);
    for (let day = 1; day <= 300; day++) {
      expect(newDay(g, day)).toBe(true);
      for (const l of g.listings) {
        total++;
        if (CAR_MODELS[l.model]!.tier === 2) {
          prizes++;
          expect(l.engine).toBeLessThanOrEqual(250);
        }
      }
    }
    expect(prizes).toBeGreaterThan(0);
    expect(prizes / total).toBeLessThan(0.08);
    expect(newDay(g, 300)).toBe(false);
  });

  it("buys, wrenches, renames and sells", () => {
    const g = newGarage(3);
    const listing = g.listings.find((l) => l.price <= GARAGE_STAKE && CAR_MODELS[l.model]!.tier === 0)!;
    expect(garageAct(g, { cmd: "buy", listing: listing.id }).ok).toBe(true);
    expect(garageAct(g, { cmd: "buy", listing: listing.id }).ok).toBe(false);
    const car = g.cars[0]!;
    expect(g.cash).toBe(GARAGE_STAKE - listing.price);
    const before = timeslip(buildOf(car)).et;
    settleUp(g, 5000);
    // Nothing comes off a car without the tool for it.
    expect(garageAct(g, { cmd: "fit", car: car.id, slot: "exhaust", level: 2 })).toMatchObject({ ok: false, message: "You need a wrench set for that." });
    expect(garageAct(g, { cmd: "tyres", car: car.id })).toMatchObject({ ok: false, message: "You need a floor jack for that." });
    for (const tool of ["jack", "wrenches", "hammer"]) expect(garageAct(g, { cmd: "tool", tool }).ok).toBe(true);
    expect(garageAct(g, { cmd: "tool", tool: "jack" }).ok).toBe(false);
    expect(garageAct(g, { cmd: "tool", tool: "welder" }).ok).toBe(false);
    expect(g.cash).toBe(GARAGE_STAKE - listing.price + 5000 - 60 - 90 - 35);
    expect(garageAct(g, { cmd: "fit", car: car.id, slot: "exhaust", level: 2 }).ok).toBe(true);
    expect(car.parts.exhaust).toBe(2);
    expect(garageAct(g, { cmd: "fit", car: car.id, slot: "exhaust", level: 1 }).ok).toBe(false);
    expect(garageAct(g, { cmd: "fit", car: car.id, slot: "boost", level: 1 }).ok).toBe(false);
    expect(garageAct(g, { cmd: "fit", car: car.id, slot: "nitrous", level: 1 }).ok).toBe(false);
    expect(garageAct(g, { cmd: "engine", car: car.id }).ok).toBe(true);
    expect(garageAct(g, { cmd: "engine", car: car.id }).ok).toBe(false);
    expect(garageAct(g, { cmd: "tyres", car: car.id }).ok).toBe(true);
    expect(garageAct(g, { cmd: "final", car: car.id, final: 2 }).ok).toBe(true);
    expect(garageAct(g, { cmd: "name", car: car.id, name: "  The   Turd  " }).ok).toBe(true);
    expect(car).toMatchObject({ engine: 1000, rubber: 1000, final: 2, name: "The Turd" });
    expect(garageAct(g, { cmd: "fuel", car: car.id, fuel: idealFuel(buildOf(car)) }).ok).toBe(true);
    expect(timeslip(buildOf(car)).et).toBeLessThan(before);
    const view = garageView(g);
    expect(view.cars[0]!.sheet.quarter).not.toBeNull();
    expect(view.cars[0]!.parts.find((p) => p.slot === "exhaust")).toMatchObject({ level: 2, has: "Headers" });
    expect(view.cars[0]!.parts.some((p) => p.slot === "boost")).toBe(false);
    const cash = g.cash;
    expect(garageAct(g, { cmd: "sell", car: car.id }).ok).toBe(true);
    expect(g.cash).toBe(cash + view.cars[0]!.sells);
    expect(g.cars).toEqual([]);
    for (const junk of [null, 5, {}, { cmd: "sell", car: 999 }, { cmd: "fit" }, { cmd: "steal" }]) expect(garageAct(g, junk).ok).toBe(false);
  });

  it("refuses what the tin will not cover, and a seventh car", () => {
    const g = newGarage(9);
    settleUp(g, -g.cash);
    expect(garageAct(g, { cmd: "buy", listing: g.listings[0]!.id }).ok).toBe(false);
    expect(settleUp(g, -500)).toBe(0);
    settleUp(g, 1_000_000);
    for (let day = 1; g.cars.length < GARAGE_BAYS; day++) {
      newDay(g, day);
      garageAct(g, { cmd: "buy", listing: g.listings[0]!.id });
    }
    newDay(g, 999);
    expect(garageAct(g, { cmd: "buy", listing: g.listings[0]!.id })).toMatchObject({ ok: false });
    expect(garageView(g).listings.every((l) => !l.can)).toBe(true);
  });

  it("hands a car over on a pink slip exactly as it was", () => {
    const loser = newGarage(1);
    const winner = newGarage(2);
    const car = giveCar(loser, { model: model("umbra"), parts: { boost: 2, tyres: 3 }, engine: 870, rubber: 640, name: "Shadow", races: 12, wins: 9 })!;
    const value = carValue(car);
    const slip = takeCar(loser, car.id)!;
    expect(loser.cars).toEqual([]);
    expect(takeCar(loser, car.id)).toBeNull();
    const won = giveCar(winner, slip)!;
    expect(won).toMatchObject({ model: model("umbra"), engine: 870, rubber: 640, name: "Shadow", races: 12, wins: 9 });
    expect(won.parts).toMatchObject({ boost: 2, tyres: 3 });
    expect(carValue(won)).toBe(value);
    expect([loser.slipsLost, winner.slipsWon]).toEqual([1, 1]);
    expect(giveCar(winner, { model: 999 })).toBeNull();
  });

  it("wears a car a little with every pass", () => {
    const g = newGarage(5);
    const car = giveCar(g, { model: model("mule"), engine: 800, rubber: 800 })!;
    const s = race([buildOf(car)], driven());
    const [run] = pinkSlipsResults(s);
    expect(afterRace(g, car.id, run!)).toBe(true);
    expect(car.engine).toBeLessThan(800);
    expect(car.rubber).toBeLessThan(800);
    expect(car).toMatchObject({ races: 1, wins: 1 });
    expect(afterRace(g, 999, run!)).toBe(false);
  });

  it("will not open a garage that is not one", () => {
    const g = newGarage(8);
    for (const junk of [null, 3, {}, { ...g, v: 2 }, { ...g, cars: "none" }, { ...g, cars: [{ model: 400 }] }]) expect(loadGarage(junk)).toBeNull();
    expect(partCost(model("umbra"), "boost", 1)).toBe(partCost(model("brick"), "boost", 1) * 3 / 2);
  });

  it("starts with no tools, and a garage from before there were tools has them all", () => {
    const g = newGarage(4);
    expect(g.tools).toEqual({ jack: false, wrenches: false, hammer: false });
    expect(garageView(g).tools.map((t) => [t.tool, t.cost, t.owned])).toEqual([["jack", 60, false], ["wrenches", 90, false], ["hammer", 35, false]]);
    const old = JSON.parse(JSON.stringify(g));
    delete old.tools;
    delete old.rix;
    expect(loadGarage(old)!.tools).toEqual({ jack: true, wrenches: true, hammer: true });
  });

  it("sells a car as the seller described it, and hands over the one it is", () => {
    let lied = 0;
    for (let seed = 1; seed <= 60; seed++) {
      const g = newGarage(seed);
      settleUp(g, 100_000);
      for (const l of [...g.listings]) {
        if (g.cars.length >= GARAGE_BAYS) break;
        expect(l.trueEngine).toBeLessThanOrEqual(l.engine);
        const said = garageView(g).listings.find((v) => v.id === l.id)!;
        expect(said.engine).toBe(l.engine);
        const answer = garageAct(g, { cmd: "buy", listing: l.id });
        expect(g.cars.at(-1)!.engine).toBe(l.trueEngine);
        if (l.trueEngine < l.engine) {
          lied++;
          expect(answer.message).toContain("not what he said");
        }
      }
    }
    expect(lied).toBeGreaterThan(10);
  });

  it("needs retuning after a part that helps it breathe, and says which way it is off", () => {
    const g = newGarage(6);
    settleUp(g, 20_000);
    garageAct(g, { cmd: "tool", tool: "wrenches" });
    const car = giveCar(g, { model: model("brick"), engine: 1000, rubber: 1000 })!;
    expect(garageView(g).cars[0]).toMatchObject({ mixture: "right", afr: 118 });
    expect(garageAct(g, { cmd: "fit", car: car.id, slot: "boost", level: 2 }).message).toContain("more fuel");
    expect(garageView(g).cars[0]).toMatchObject({ mixture: "lean", afr: 130 });
    garageAct(g, { cmd: "fuel", car: car.id, fuel: car.fuel + 4 });
    expect(garageView(g).cars[0]).toMatchObject({ mixture: "rich", afr: 106 });
    garageAct(g, { cmd: "fuel", car: car.id, fuel: idealFuel(buildOf(car)) });
    expect(garageView(g).cars[0]!.mixture).toBe("right");
    garageAct(g, { cmd: "fuel", car: car.id, fuel: 99 });
    expect(car.fuel).toBe(14);
  });

  it("blows an engine run lean and hard, and fouls the plugs of one run rich", () => {
    const right = stockBuild(model("wasp"));
    const lean = [...right];
    lean[12] = right[12]! - 2;
    const rich = [...right];
    rich[12] = right[12]! + 3;
    // A little lean is a little quicker, for as long as it lasts.
    expect(specOf(lean).peak).toBeGreaterThan(specOf(right).peak);
    expect(specOf(rich).peak).toBeLessThan(specOf(right).peak);
    // Flat out in top gear on the same road: the lean one lets go and the others do not.
    const flatOut = (build: Build) => {
      const spec = specOf(build);
      const car = restingCar(spec);
      for (let t = 0; t < 60 * 60 && !car.blown; t++) driveCar(spec, car, 100, wellDriven(spec, car).gear, 1000);
      return car.blown;
    };
    expect([flatOut(lean), flatOut(right), flatOut(rich)]).toEqual([true, false, false]);
    const run = (build: Build) => pinkSlipsResults(race([build], driven()))[0]!;
    expect(run(rich).plugsWear).toBeGreaterThan(run(right).plugsWear);
    const plugs = [...right];
    plugs[13] = 100;
    expect(timeslip(plugs).et).toBeGreaterThan(timeslip(right).et);
  });

  it("loses oil pressure with old oil in a tired engine, and an engine short of it does not last", () => {
    const fresh = specOf(stockBuild(model("mule")));
    const tired = specOf([model("mule"), 0, 0, 0, 0, 0, 0, 0, 1, 400, 800, 200]);
    expect(oilPressure(tired, 5000)).toBeLessThan(oilPressure(fresh, 5000));
    expect(oilPressure(fresh, 5000)).toBeGreaterThan(oilPressure(fresh, 1000));
    expect(oilStarved(oilPressure(fresh, 5500), 5500)).toBe(false);
    expect(oilStarved(oilPressure(tired, 5000), 5000)).toBe(true);
    const s = race([[model("mule"), 0, 0, 0, 0, 0, 0, 0, 1, 400, 800, 200]], driven());
    expect(pinkSlipsResults(s)[0]!.blown).toBe(true);
    expect(game.view(s).race!.lanes[0]!.oil).toBe(0);
    // An oil change is all it wanted.
    const g = newGarage(2);
    garageAct(g, { cmd: "tool", tool: "wrenches" });
    const car = giveCar(g, { model: model("mule"), engine: 400, rubber: 800, oil: 200, plugs: 300 })!;
    expect(garageAct(g, { cmd: "oil", car: car.id }).ok).toBe(true);
    expect(garageAct(g, { cmd: "plugs", car: car.id }).ok).toBe(true);
    expect(garageAct(g, { cmd: "oil", car: car.id }).ok).toBe(false);
    expect(car).toMatchObject({ oil: 1000, plugs: 1000 });
    expect(pinkSlipsResults(race([buildOf(car)], driven()))[0]).toMatchObject({ blown: false, finished: true, oilWear: 25 });
  });

  it("keeps a bent car at home until it is straightened, and writes off one bent double", () => {
    const g = newGarage(3);
    settleUp(g, 10_000);
    const car = giveCar(g, { model: model("kite"), engine: 900, rubber: 900, parts: { exhaust: 2 } })!;
    const clean = carValue(car);
    afterRace(g, car.id, { won: false, blown: false, engineWear: 0, rubberWear: 0, damage: 350 });
    expect(car.body).toBe(350);
    expect(garageView(g).cars[0]).toMatchObject({ runs: false, totaled: false });
    expect(carValue(car)).toBeLessThan(clean);
    expect(garageAct(g, { cmd: "body", car: car.id })).toMatchObject({ ok: false, message: "You need a body hammer for that." });
    garageAct(g, { cmd: "tool", tool: "hammer" });
    const cash = g.cash;
    expect(garageAct(g, { cmd: "body", car: car.id }).ok).toBe(true);
    expect(g.cash).toBe(cash - bodyCost({ model: car.model, body: 350 }));
    expect(garageView(g).cars[0]!.runs).toBe(true);
    expect(garageAct(g, { cmd: "scrap", car: car.id }).ok).toBe(false);
    // Bent double: no hammer fixes that. Scrap it, or pull the parts first for more.
    afterRace(g, car.id, { won: false, blown: false, engineWear: 0, rubberWear: 0, damage: 5000 });
    expect(garageView(g).cars[0]).toMatchObject({ totaled: true, runs: false, body: 1000 });
    expect(garageAct(g, { cmd: "body", car: car.id }).ok).toBe(false);
    expect(salvageValue(car)).toBeGreaterThan(scrapValue(car));
    expect(garageAct(g, { cmd: "salvage", car: car.id })).toMatchObject({ ok: false });
    garageAct(g, { cmd: "tool", tool: "wrenches" });
    const before = g.cash;
    expect(garageAct(g, { cmd: "salvage", car: car.id }).ok).toBe(true);
    expect(g.cash).toBe(before + salvageValue(car));
    expect(g.cars).toEqual([]);
    const other = giveCar(g, { model: model("sparrow"), engine: 500, rubber: 500, body: 1000 })!;
    expect(garageAct(g, { cmd: "scrap", car: other.id }).ok).toBe(true);
    expect(g.cars).toEqual([]);
  });

  it("stocks Rix Racing with used parts for less than new, for the kind of car they came off", () => {
    const g = newGarage(12);
    settleUp(g, 50_000);
    garageAct(g, { cmd: "tool", tool: "wrenches" });
    garageAct(g, { cmd: "tool", tool: "jack" });
    expect(g.rix.length).toBe(6);
    for (const r of g.rix) expect(r.price).toBeLessThan(PARTS[r.slot].costs[r.level - 1]! * (r.tier + 1));
    // Find a first-level part on the shelf over a run of days, and a car it goes on.
    let part = g.rix.find((r) => r.level === 1 && r.slot !== "boost");
    for (let day = 1; !part; day++) {
      newDay(g, day);
      part = g.rix.find((r) => r.level === 1 && r.slot !== "boost");
    }
    const fits = CAR_MODELS.findIndex((m) => m.tier === part!.tier);
    const wrong = CAR_MODELS.findIndex((m) => m.tier !== part!.tier);
    const car = giveCar(g, { model: fits, engine: 900, rubber: 900 })!;
    const other = giveCar(g, { model: wrong, engine: 900, rubber: 900 })!;
    expect(garageView(g).cars[0]!.parts.find((p) => p.slot === part!.slot)!.next!.rix).toEqual({ id: part.id, price: part.price });
    expect(garageAct(g, { cmd: "fit", car: other.id, slot: part.slot, level: 1, rix: part.id }).ok).toBe(false);
    const cash = g.cash;
    expect(garageAct(g, { cmd: "fit", car: car.id, slot: part.slot, level: 1, rix: part.id }).ok).toBe(true);
    expect(g.cash).toBe(cash - part.price);
    expect(car.parts[part.slot]).toBe(1);
    expect(g.rix.some((r) => r.id === part!.id)).toBe(false);
    expect(garageAct(g, { cmd: "fit", car: car.id, slot: part.slot, level: 1, rix: part.id })).toMatchObject({ ok: false, message: "Rix sold that one." });
    expect(loadGarage(JSON.parse(JSON.stringify(g)))).toEqual(g);
  });
});
