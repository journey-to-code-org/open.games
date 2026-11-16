// The Mountain Road: the other half of Road to the Shootout. A run from one end of a two-lane road
// to the other, with a rock face on your side and a drop on the other, in the cars from
// `pinkslipscars.ts` and with the same drivetrain. One or two drivers, on the same road at once.
//
// What is on the road with you:
//   - Bends. A car at speed wants to go straight on; the tighter the bend and the faster you are,
//     the more steering it takes to stay on, and there is only so much grip to steer with.
//   - Traffic. Slow cars on your side, and cars coming the other way on theirs. Pull out to pass
//     and you are in their lane.
//   - The law. Patrol cars sit where you cannot see them. A radar detector chirps as you come up on
//     one. Go past too fast and it comes after you: stop on your own side and take the ticket, or
//     keep your foot in and try to lose it. Get run down and it costs a great deal more.
//   - Gas stations. The road is in legs, each ending at one. The car is stopped and filled, and the
//     leg's time is written down. Between them the tank is what it is.
//   - Damage. Every scrape and every hit takes something off the car: less power, and a wheel that
//     no longer points quite straight. Enough of it and the run is over. Going off the drop is the
//     end of it at once.
//
// It is an `ArcadeGame`, and it is not in the catalogue: it is reached from Road to the Shootout's
// garage, with a car, rather than from the front page.
//
// Units are the drivetrain's along the road (tenths of a millimetre, and those a second) and whole
// millimetres across it, measured from the centre line with your own side positive. A tick is a
// sixtieth of a second. Everything in the state is a whole number.
import type { PlayStyle } from "@journey-to-code/rules";
import type { ArcadeEvent, ArcadeGame, ArcadeRoad, ArcadeSummary, ArcadeThing, ArcadeView } from "./arcade.js";
import { CAR_MODELS, PINKSLIPS_RATE, driveCar, restingCar, safeBuild, specOf, stockBuild, toMph, wellDriven, type Build, type CarMotion, type CarSpec } from "./pinkslipscars.js";
import { nextRandom, who, type BaseRules } from "./table.js";

const RATE = PINKSLIPS_RATE;
export const MOUNTAIN_ROAD_FIELD = { width: 6000, height: 8000 };
/** A metre, along the road. */
const M = 10_000;
const LANE = 1800;
const HALF_ROAD = 3600;
/** The rock face, on your side. */
const WALL = 5200;
/** Where the ground stops, on the other. */
const DROP = -4800;
/** The limit, and how far over it a patrol car will let go: in miles an hour. */
export const ROAD_LIMIT = 55;
const TOLERANCE = 10;
const MPH = 4470;
/** What tyres will take sideways or under braking, in mm/s², on a road and not a prepared strip. */
const ROAD_GRIP = 8300;
const STAGE_LIMIT = RATE * 20;
const RUN_LIMIT = RATE * 60 * 18;
const TANK = 1_000_000;
const WRECKED = 1000;
const TONES = ["blue", "red"];
const LOANER: Build = stockBuild(0, 600, 500);
const TRAFFIC_KINDS = ["sedan", "wagon", "pickup", "van", "hatch", "truck"];

export interface MountainRoadRules extends BaseRules {
  /** How many legs, and how long each is, in metres. */
  stages: number;
  stageLength: number;
  traffic: "light" | "steady" | "heavy";
  /** How many patrol cars to a leg. */
  patrols: number;
}

export const MOUNTAIN_ROAD_PRESETS: MountainRoadRules[] = [
  { id: "sunday", name: "Sunday drive", stages: 2, stageLength: 2500, traffic: "light", patrols: 1 },
  { id: "run", name: "The run", stages: 4, stageLength: 3000, traffic: "steady", patrols: 2 },
  { id: "rush", name: "Rush hour", stages: 3, stageLength: 2500, traffic: "heavy", patrols: 1 },
  { id: "heat", name: "Heat", stages: 3, stageLength: 3000, traffic: "steady", patrols: 4 },
];

export interface MountainRoadInput {
  gas: number;
  brake: number;
  /** -100 (toward the drop) to 100 (toward the rock). */
  steer: number;
  gear: number;
  stage: boolean;
  build: Build;
}

type Out = 0 | 1 | 2 | 3 | 4;
const OUTS = [null, "finished", "wrecked", "edge", "fuel"] as const;

interface Driver {
  build: Build;
  staged: boolean;
  car: CarMotion;
  /** Millimetres across the road, and millimetres a second across it. */
  x: number;
  vx: number;
  /** Which piece of the road it is on. */
  piece: number;
  fuel: number;
  damage: number;
  /** Ticks during which another hit does not count. */
  shaken: number;
  out: Out;
  /** Ticks on the clock, ticks added by tickets, and dollars. */
  clock: number;
  penalty: number;
  fines: number;
  stage: number;
  /** The clock at the start of this leg, and the ticks each finished leg took. */
  legFrom: number;
  legs: number[];
  /** Ticks left stopped: at a station, or with the law. */
  rest: number;
  /** The next trap not yet passed. */
  trap: number;
  /** The patrol car after it: 0 none, 1 chasing. Where it is, how fast, and how long it has been alongside and behind. */
  cop: number;
  copAt: number;
  copSpeed: number;
  copOn: number;
  copFor: number;
  squeal: boolean;
}

interface Traffic {
  id: number;
  kind: number;
  s: number;
  x: number;
  /** Tenths of a millimetre a second: negative comes toward you. */
  v: number;
}

export interface MountainRoadState {
  rules: MountainRoadRules;
  seats: number;
  rng: number;
  tick: number;
  phase: "staging" | "driving" | "over";
  /** The road: where each piece starts (metres), its bend and its grade. */
  at: number[];
  curve: number[];
  grade: number[];
  /** Metres. */
  length: number;
  traps: number[];
  drivers: Driver[];
  traffic: Traffic[];
  nextId: number;
  /** Where the next car on your side will appear (metres), and the tick the next oncoming one will. */
  nextSame: number;
  nextOncoming: number;
  events: ArcadeEvent[];
}

const IDLE: MountainRoadInput = { gas: 0, brake: 0, steer: 0, gear: 0, stage: false, build: stockBuild(0) };
const clamp = (n: number, low: number, high: number) => (n < low ? low : n > high ? high : n);
const whole = (n: unknown) => (typeof n === "number" && Number.isFinite(n) ? Math.trunc(n) + 0 : 0);

function safeInput(given: unknown): MountainRoadInput {
  if (!given || typeof given !== "object" || Array.isArray(given)) return IDLE;
  const g = given as Record<string, unknown>;
  return { gas: clamp(whole(g.gas), 0, 100), brake: clamp(whole(g.brake), 0, 100), steer: clamp(whole(g.steer), -100, 100), gear: clamp(whole(g.gear), 0, 6), stage: g.stage === true, build: safeBuild(g.build) };
}

const specs = new Map<string, CarSpec>();
function specFor(build: Build): CarSpec {
  const key = build.join(",");
  let spec = specs.get(key);
  if (!spec) {
    if (specs.size > 400) specs.clear();
    specs.set(key, (spec = specOf(build)));
  }
  return spec;
}

/** What the tyres will take sideways, in mm/s²: the car's tyres against a stock set, and less as it is hurt. */
function gripOf(spec: CarSpec, damage: number): number {
  const stock = specFor(stockBuild(spec.model)).traction;
  return Math.round((((ROAD_GRIP * spec.traction) / stock) * (1000 - Math.floor(damage / 4))) / 1000);
}

/** The piece of road at a place, starting the search from where it was last. */
function pieceAt(s: MountainRoadState, metres: number, from = 0): number {
  let i = clamp(from, 0, s.at.length - 1);
  while (i + 1 < s.at.length && s.at[i + 1]! <= metres) i++;
  while (i > 0 && s.at[i]! > metres) i--;
  return i;
}

const stationOf = (s: MountainRoadState, stage: number) => (stage + 1) * s.rules.stageLength;

function say(s: MountainRoadState, kind: string, seat: number, more: Partial<ArcadeEvent> = {}) {
  if (s.events.length < 40) s.events.push({ kind, x: 3000, y: 6000, seat, ...more });
}

function hurt(s: MountainRoadState, d: Driver, seat: number, amount: number, what: string) {
  d.damage = Math.min(WRECKED, d.damage + amount);
  say(s, what, seat, { amount });
  if (d.damage >= WRECKED && !d.out) {
    d.out = 2;
    d.car.speed = 0;
    say(s, "wrecked", seat, { text: "Wrecked" });
  }
}

function stageDriver(s: MountainRoadState, seat: number, build: Build) {
  const d = s.drivers[seat]!;
  d.build = build;
  d.staged = true;
  d.car = restingCar(specFor(build));
  // Nose to tail on the right side of the road, the first seat in front.
  d.car.dist = (s.seats - 1 - seat) * 9 * M;
  say(s, "staged", seat, { text: CAR_MODELS[build[0]!]!.name });
}

function spawnTraffic(s: MountainRoadState) {
  const active = s.drivers.filter((d) => d.staged && !d.out);
  if (!active.length) return;
  const rand = nextRandom(s);
  const ahead = Math.max(...active.map((d) => d.car.dist));
  const behind = Math.min(...active.map((d) => d.car.dist));
  const [gap, every] = s.rules.traffic === "light" ? [520, 420] : s.rules.traffic === "heavy" ? [170, 130] : [300, 240];
  // Cars on your side are placed along the road ahead of whoever is in front.
  while (s.nextSame * M < ahead + 900 * M && s.nextSame < s.length - 150) {
    if (s.traffic.length < 60) s.traffic.push({ id: s.nextId++, kind: Math.floor(rand() * TRAFFIC_KINDS.length), s: s.nextSame * M, x: LANE + Math.floor(rand() * 301) - 150, v: (17 + Math.floor(rand() * 8)) * M });
    s.nextSame += gap + Math.floor(rand() * gap);
  }
  // Cars the other way arrive over time, over the horizon.
  if (s.tick >= s.nextOncoming) {
    if (ahead + 900 * M < s.length * M && s.traffic.length < 60) s.traffic.push({ id: s.nextId++, kind: Math.floor(rand() * TRAFFIC_KINDS.length), s: ahead + 900 * M, x: -LANE + Math.floor(rand() * 301) - 150, v: -(20 + Math.floor(rand() * 8)) * M });
    s.nextOncoming = s.tick + every + Math.floor(rand() * every);
  }
  s.traffic = s.traffic.filter((t) => t.s > behind - 300 * M && t.s < s.length * M + 100 * M);
}

function stepDriver(s: MountainRoadState, seat: number, input: MountainRoadInput) {
  const d = s.drivers[seat]!;
  if (!d.staged || d.out) return;
  const spec = specFor(d.build);
  const car = d.car;
  if (d.shaken > 0) d.shaken--;
  if (d.rest > 0) {
    // Stopped, at a pump or with a patrolman. The clock waits.
    d.rest--;
    car.speed = 0;
    d.vx = 0;
    car.rpm = Math.max(900, car.rpm - 150);
    return;
  }
  d.clock++;

  // A hurt car makes less, and no fuel makes none.
  const gas = d.fuel <= 0 ? 0 : Math.round((input.gas * (1000 - Math.floor(d.damage / 2))) / 1000);
  const news = driveCar(spec, car, gas, input.gear, 900);
  if (news.shifted) say(s, "shift", seat, { amount: news.shifted });
  if (news.blew) say(s, "blown", seat, { text: "Blown!" });
  d.fuel = Math.max(0, d.fuel - 2 - Math.floor((gas * car.rpm) / 5000));
  const grip = gripOf(spec, d.damage);
  if (input.brake > 0) car.speed = Math.max(0, car.speed - Math.round((input.brake * grip * 10) / (100 * RATE)));

  // Across the road. The bend pushes the car out; the wheel pushes back, as hard as the tyres allow.
  d.piece = pieceAt(s, Math.floor(car.dist / M), d.piece);
  const v = Math.floor(car.speed / 10);
  const bend = Math.round((((v * v) / 1000) * s.curve[d.piece]!) / 1_000_000);
  // A bent car pulls to one side.
  const pull = d.damage > 400 ? (seat % 2 ? -1 : 1) * Math.floor((d.damage - 400) / 40) : 0;
  const turn = Math.round((clamp(input.steer + pull, -100, 100) * grip) / 100);
  const moving = Math.min(1000, Math.floor(v / 8));
  const want = Math.round((((turn - bend) * 35) / 100) * moving / 1000);
  d.vx += Math.round((want - d.vx) / 4);
  d.x += Math.round(d.vx / RATE);
  d.squeal = v > 6000 && (Math.abs(bend) > (grip * 4) / 5 || Math.abs(turn) >= grip);

  // Off the tarmac.
  if (Math.abs(d.x) > HALF_ROAD) car.speed -= Math.floor(car.speed / 200);
  if (d.x >= WALL) {
    d.x = WALL;
    d.vx = -Math.floor(Math.abs(d.vx) / 2);
    car.speed -= Math.floor(car.speed / 30);
    if (!d.shaken && v > 4000) {
      d.shaken = 20;
      hurt(s, d, seat, clamp(Math.floor(v / 500), 10, 120), "scrape");
    }
  } else if (d.x <= DROP) {
    d.out = 3;
    d.damage = WRECKED;
    car.speed = 0;
    say(s, "edge", seat, { text: "Over the edge" });
    return;
  }

  // Other cars.
  for (const t of s.traffic) {
    if (Math.abs(t.s - car.dist) > 44_000 || Math.abs(t.x - d.x) > 1750 || d.shaken) continue;
    const closing = Math.abs(car.speed - t.v) / M;
    d.shaken = 50;
    hurt(s, d, seat, clamp(Math.round(closing * 14), 40, WRECKED), "crash");
    car.speed = t.v < 0 ? 0 : Math.floor((car.speed + t.v) / 2);
    d.vx += d.x >= t.x ? 900 : -900;
    t.s = -1;
  }
  s.drivers.forEach((o, other) => {
    if (other === seat || !o.staged || o.out || d.shaken || o.shaken) return;
    if (Math.abs(o.car.dist - car.dist) > 44_000 || Math.abs(o.x - d.x) > 1750) return;
    const closing = Math.abs(car.speed - o.car.speed) / M;
    d.shaken = o.shaken = 50;
    const mean = Math.floor((car.speed + o.car.speed) / 2);
    // Door handles at the same speed is a rub. Anything more is a hit.
    if (closing >= 2) {
      hurt(s, d, seat, clamp(Math.round(closing * 10), 25, 500), "crash");
      hurt(s, o, other, clamp(Math.round(closing * 10), 25, 500), "crash");
    }
    car.speed = o.car.speed = mean;
    d.vx += d.x >= o.x ? 700 : -700;
    o.vx -= d.x >= o.x ? 700 : -700;
  });
  if (d.out) return;

  // The law.
  const limit = (ROAD_LIMIT + TOLERANCE) * MPH;
  while (d.trap < s.traps.length && s.traps[d.trap]! * M <= car.dist) {
    if (!d.cop && car.speed > limit) {
      d.cop = 1;
      d.copAt = s.traps[d.trap]! * M;
      d.copSpeed = 0;
      d.copOn = d.copFor = 0;
      say(s, "siren", seat, { text: `${toMph(car.speed)} in a ${ROAD_LIMIT}` });
    }
    d.trap++;
  }
  if (d.cop) {
    d.copFor++;
    d.copSpeed = Math.min(62 * M, d.copSpeed + Math.round((6 * M) / RATE));
    const gap = car.dist - d.copAt;
    // Once it is on your bumper it stays there.
    if (gap < 12 * M) d.copSpeed = Math.min(d.copSpeed, Math.max(car.speed, 0));
    d.copAt = Math.min(d.copAt + Math.round(d.copSpeed / RATE), car.dist - 6 * M);
    if (gap < 14 * M) {
      d.copOn++;
      if (car.speed < M && d.x > LANE - 400) {
        // Pulled over. A ticket, a talking-to, and on your way.
        d.cop = 0;
        d.penalty += RATE * 20;
        d.fines += 150;
        d.rest = RATE * 4;
        say(s, "ticket", seat, { text: "Ticket: $150 and 20 seconds", amount: 150 });
      } else if (d.copOn > RATE * 8) {
        // Run down. That is a different conversation.
        d.cop = 0;
        d.penalty += RATE * 45;
        d.fines += 400;
        d.rest = RATE * 6;
        car.speed = 0;
        d.x = LANE + 1400;
        say(s, "busted", seat, { text: "Run down: $400 and 45 seconds", amount: 400 });
      }
    } else {
      d.copOn = 0;
      if (gap > 550 * M || d.copFor > RATE * 45) {
        d.cop = 0;
        say(s, "escaped", seat, { text: "Lost him" });
      }
    }
  }

  // The end of a leg: a gas station, or the finish.
  if (car.dist >= stationOf(s, d.stage) * M) {
    d.legs.push(d.clock - d.legFrom);
    d.legFrom = d.clock;
    d.stage++;
    if (d.stage >= s.rules.stages) {
      d.out = 1;
      say(s, "home", seat, { text: clock(d.clock + d.penalty) });
    } else {
      // Each seat has its own pump, one behind the other.
      car.dist = (stationOf(s, d.stage - 1) + (s.seats - 1 - seat) * 9) * M;
      car.speed = 0;
      d.x = LANE + 1000;
      d.vx = 0;
      d.fuel = TANK;
      d.rest = RATE * 3;
      d.cop = 0;
      say(s, "station", seat, { text: `Leg ${d.stage}: ${clock(d.legs[d.legs.length - 1]!)}` });
    }
  } else if (d.fuel <= 0 && car.speed === 0) {
    d.out = 4;
    say(s, "fuel", seat, { text: "Out of gas" });
  } else if (car.blown && car.speed === 0) {
    d.out = 2;
    say(s, "wrecked", seat, { text: "Engine's gone" });
  }
}

const ms = (ticks: number) => Math.round((ticks * 1000) / RATE);
/** Ticks as m:ss.t */
function clock(ticks: number): string {
  const tenths = Math.floor((ticks * 10) / RATE);
  return `${Math.floor(tenths / 600)}:${String(Math.floor(tenths / 10) % 60).padStart(2, "0")}.${tenths % 10}`;
}

function step(s: MountainRoadState, inputs: readonly (MountainRoadInput | null | undefined)[]) {
  if (s.phase === "over") return;
  s.events = [];
  const held = s.drivers.map((_, seat) => safeInput(inputs[seat]));
  if (s.phase === "staging") {
    s.drivers.forEach((d, seat) => {
      if (!d.staged && held[seat]!.stage) stageDriver(s, seat, held[seat]!.build);
      else if (!d.staged && s.tick >= STAGE_LIMIT) stageDriver(s, seat, LOANER);
    });
    if (s.drivers.every((d) => d.staged)) {
      s.phase = "driving";
      s.events.push({ kind: "green", x: 3000, y: 6000 });
    }
  } else {
    for (const t of s.traffic) t.s += Math.round(t.v / RATE);
    s.drivers.forEach((_, seat) => stepDriver(s, seat, held[seat]!));
    s.traffic = s.traffic.filter((t) => t.s >= 0);
    spawnTraffic(s);
  }
  s.tick++;
  if (s.phase === "driving" && (s.drivers.every((d) => d.out) || s.tick >= RUN_LIMIT)) {
    s.phase = "over";
    s.events.push({ kind: "finish", x: 3000, y: 2000, seat: placing(s)[0] });
  }
}

/** Best to worst: whoever finished, by time with tickets on it; then whoever got furthest. */
function placing(s: MountainRoadState): number[] {
  return s.drivers
    .map((d, seat) => ({ d, seat }))
    .sort((a, b) => Number(b.d.out === 1) - Number(a.d.out === 1) || (a.d.out === 1 && b.d.out === 1 ? a.d.clock + a.d.penalty - (b.d.clock + b.d.penalty) : b.d.car.dist - a.d.car.dist) || a.seat - b.seat)
    .map((e) => e.seat);
}

/** A point for every metre, and for finishing, a point for every hundredth of a second under twenty minutes. */
const scoreOf = (d: Driver) => Math.floor(d.car.dist / M) + (d.out === 1 ? Math.max(0, Math.floor((RATE * 1200 - d.clock - d.penalty) * 100 / RATE)) : 0);

function summary(s: MountainRoadState): ArcadeSummary {
  const scores = s.drivers.map(scoreOf);
  const order = placing(s);
  const best = s.drivers[order[0]!]!;
  return {
    game: "mountainroad",
    rules: s.rules.name,
    phase: s.phase === "staging" ? "staging" : s.phase === "over" ? "over" : `leg ${Math.min(s.rules.stages, Math.max(...s.drivers.map((d) => d.stage)) + 1)} of ${s.rules.stages}`,
    over: s.phase === "over",
    seats: s.seats,
    ticks: s.tick,
    score: Math.max(...scores),
    scores,
    scoreLine: best.out === 1 ? `${who(order[0]!)} made it in ${clock(best.clock + best.penalty)}` : s.phase === "over" ? "Nobody made it to the end" : `${Math.floor(best.car.dist / M / 100) / 10} km down the road`,
    order,
  };
}

/** One driver's run, for whoever puts the car back in its garage and takes the fines out of the tin. */
export interface MountainRoadResult {
  seat: number;
  place: number;
  won: boolean;
  build: Build;
  car: string;
  out: (typeof OUTS)[number];
  /** Metres. */
  distance: number;
  /** Ms on the clock, with tickets on it. */
  time: number;
  legs: number[];
  fines: number;
  /** Thousandths of damage: 1000 is a wreck. */
  damage: number;
  blown: boolean;
  engineWear: number;
  rubberWear: number;
  oilWear: number;
  plugsWear: number;
}

export function mountainRoadResults(s: MountainRoadState): MountainRoadResult[] {
  const order = placing(s);
  return s.drivers.map((d, seat) => ({
    seat,
    place: order.indexOf(seat) + 1,
    won: s.phase === "over" && order[0] === seat && d.out === 1,
    build: d.build,
    car: CAR_MODELS[d.build[0]!]!.name,
    out: OUTS[d.out],
    distance: Math.floor(d.car.dist / M),
    time: ms(d.clock + d.penalty),
    legs: d.legs.map(ms),
    fines: d.fines,
    damage: d.damage,
    blown: d.car.blown,
    // A long drive is harder on a car than a pass down the strip.
    engineWear: d.clock ? 6 + Math.floor(d.clock / (RATE * 20)) + Math.floor(d.car.strain / 6) : 0,
    rubberWear: d.clock ? 8 + Math.floor(d.clock / (RATE * 12)) : 0,
    oilWear: d.clock ? 30 + Math.floor(d.clock / (RATE * 8)) : 0,
    plugsWear: d.clock ? 6 + specFor(d.build).rich * 40 : 0,
  }));
}

function view(s: MountainRoadState): ArcadeView {
  const order = placing(s);
  const sum = summary(s);
  const lead = s.drivers[0]!;
  const things: ArcadeThing[] = [];
  // For a screen that only knows things: the road from above, 400 metres of it, centred on the first driver.
  const place = (along: number, across: number): [number, number] => [3000 + Math.round((across * 2800) / WALL), 6000 - Math.round(((along - lead.car.dist) * 5000) / (300 * M))];
  const near = (along: number) => along > lead.car.dist - 100 * M && along < lead.car.dist + 300 * M;
  const drivers: ArcadeRoad["drivers"] = s.drivers.map((d, seat) => {
    const spec = specFor(d.build);
    const [x, y] = place(d.car.dist, d.x);
    if (d.staged && near(d.car.dist)) things.push({ id: seat + 1, kind: `car:${CAR_MODELS[d.build[0]!]!.key}`, x, y, r: 220, tone: TONES[seat % TONES.length], angle: 27000, seat, health: WRECKED - d.damage, ...(d.out > 1 ? { ghost: true } : {}) });
    const trap = s.traps[d.trap];
    const toTrap = trap === undefined ? -1 : trap * M - d.car.dist;
    return {
      seat,
      car: d.staged ? CAR_MODELS[d.build[0]!]!.name : "",
      staged: d.staged,
      out: OUTS[d.out],
      along: Math.floor(d.car.dist / 10),
      across: d.x,
      speed: Math.floor(d.car.speed / 10),
      drift: d.vx,
      mph: toMph(d.car.speed),
      rpm: d.car.rpm,
      redline: spec.redline,
      gear: d.car.gear,
      gears: spec.gears.length,
      auto: spec.auto,
      boost: spec.turbo ? d.car.boost : null,
      heat: clamp(Math.floor((d.car.heat * 1000) / spec.blowAt), 0, 1000),
      oil: d.car.oil,
      afr: spec.afr,
      fuel: Math.floor(d.fuel / (TANK / 1000)),
      damage: d.damage,
      squeal: d.squeal,
      radar: d.cop || toTrap < 0 || toTrap > 700 * M ? 0 : toTrap < 200 * M ? 3 : toTrap < 400 * M ? 2 : 1,
      chase: d.cop ? Math.floor((d.car.dist - d.copAt) / 10) : null,
      resting: d.rest,
      stage: Math.min(d.stage, s.rules.stages - 1),
      time: ms(d.clock),
      penalty: ms(d.penalty),
      fines: d.fines,
      legs: d.legs.map(ms),
      place: s.phase === "over" ? order.indexOf(seat) + 1 : null,
    };
  });
  const traffic = s.traffic.map((t) => {
    if (near(t.s)) {
      const [x, y] = place(t.s, t.x);
      things.push({ id: 100 + t.id, kind: `traffic:${TRAFFIC_KINDS[t.kind]}`, x, y, r: 220, tone: "grey", angle: t.v < 0 ? 9000 : 27000 });
    }
    return { id: t.id, kind: TRAFFIC_KINDS[t.kind]!, along: Math.floor(t.s / 10), across: t.x, speed: Math.floor(t.v / 10) };
  });
  // A parked patrol car is seen only from close by; one on the move has its lights on.
  const patrols: ArcadeRoad["patrols"] = [];
  s.drivers.forEach((d) => {
    if (d.cop) patrols.push({ along: Math.floor(d.copAt / 10), across: LANE, lit: true });
    const trap = s.traps[d.trap];
    if (!d.cop && d.staged && trap !== undefined && trap * M - d.car.dist < 180 * M && !patrols.some((p) => p.along === trap * 1000)) patrols.push({ along: trap * 1000, across: WALL - 500, lit: false });
  });
  const banner = s.phase === "staging" ? "Start your engine" : s.phase === "over" ? (s.drivers[order[0]!]!.out === 1 ? `${who(order[0]!)} wins` : "Nobody made it") : undefined;
  return {
    game: "mountainroad",
    tick: s.tick,
    rate: RATE,
    seats: s.seats,
    field: MOUNTAIN_ROAD_FIELD,
    things,
    pilots: s.drivers.map((d, seat) => ({
      seat,
      playing: d.staged && !d.out,
      score: sum.scores[seat]!,
      lives: d.out > 1 ? 0 : 1,
      stats: [
        { key: "mph", label: "MPH", value: toMph(d.car.speed) },
        { key: "fuel", label: "Fuel", value: Math.floor(d.fuel / (TANK / 1000)), max: 1000 },
        { key: "damage", label: "Damage", value: d.damage, max: WRECKED },
      ],
    })),
    score: sum.score,
    stage: sum.phase,
    ...(banner ? { banner } : {}),
    road: {
      phase: s.phase,
      length: s.length * 1000,
      stations: Array.from({ length: s.rules.stages }, (_, i) => stationOf(s, i) * 1000),
      halfWidth: HALF_ROAD,
      wall: WALL,
      drop: DROP,
      pieces: s.at.map((at, i) => ({ at: at * 1000, curve: s.curve[i]!, grade: s.grade[i]! })),
      limit: ROAD_LIMIT,
      drivers,
      traffic,
      patrols,
    },
    events: s.events,
    over: s.phase === "over",
  };
}

// ---- The computer driver ---------------------------------------------------------------------------

function bot(s: MountainRoadState, seat: number, style: PlayStyle, rand: () => number = Math.random): MountainRoadInput {
  const d = s.drivers[seat];
  if (!d) return IDLE;
  const skill = style.skill ?? 0.6;
  const sloppy = style.sloppy ?? 0.1;
  const build = d.staged ? d.build : stockBuild([0, 5, 9][skill < 0.45 ? 0 : skill < 0.85 ? 1 : 2]! + (seat % 2), 850, 800);
  const still: MountainRoadInput = { gas: 0, brake: 0, steer: 0, gear: 0, stage: true, build };
  if (s.phase !== "driving" || d.out || d.rest > 0) return still;
  const spec = specFor(build);
  const car = d.car;
  const grip = gripOf(spec, d.damage);
  const v = Math.floor(car.speed / 10);
  const here = Math.floor(car.dist / M);

  // How fast the road ahead can be taken: the tightest bend in the next few seconds, and what the tyres hold.
  let cap = 70_000;
  const look = here + 30 + Math.floor((v * 3) / 1000);
  for (let i = d.piece; i < s.at.length && s.at[i]! <= look; i++) {
    const bend = Math.abs(s.curve[i]!);
    if (bend) cap = Math.min(cap, Math.floor(Math.sqrt((grip * (550 + Math.round(skill * 300)) * 1_000_000) / bend)));
  }
  // A careful driver backs off for the detector. A bad one finds out.
  const trap = s.traps[d.trap];
  if (skill >= 0.5 && trap !== undefined && trap - here < 400) cap = Math.min(cap, Math.floor(((ROAD_LIMIT + 5) * MPH) / 10));
  let target = LANE;
  if (d.cop) {
    // Lights in the mirror: over to the side and stop.
    target = LANE + 1400;
    cap = 0;
  } else {
    // The car ahead on this side, and the nearest one coming the other way.
    let slow: Traffic | null = null;
    let oncoming = Infinity;
    const others: Traffic[] = s.drivers.filter((o, other) => other !== seat && o.staged && !o.out).map((o) => ({ id: 0, kind: 0, s: o.car.dist, x: o.x, v: Math.max(1, o.car.speed) }));
    for (const t of [...s.traffic, ...others]) {
      if (t.v > 0 && Math.abs(t.x - LANE) > 1500 && Math.abs(t.x - d.x) > 1700) continue;
      const gap = (t.s - car.dist) / M;
      if (t.v > 0 && gap > -14 && gap < 25 + (v * 2) / 1000 && (!slow || t.s < slow.s)) slow = t;
      if (t.v < 0 && gap > -10) oncoming = Math.min(oncoming, gap);
    }
    if (slow) {
      // Pull out if the other side is clear for long enough, and stay out until past. Otherwise sit behind.
      const clear = 140 + (v * (9 - Math.round(skill * 3))) / 1000;
      const bending = Math.abs(s.curve[d.piece]!) > 4000;
      if (oncoming > clear && (!bending || d.x < 0)) target = -LANE;
      else if (d.x < 300 && oncoming <= clear && (slow.s - car.dist) / M > -6) cap = Math.min(cap, Math.max(0, Math.floor(slow.v / 10) - 1500));
      else cap = Math.min(cap, Math.floor(slow.v / 10) - 300);
    }
  }
  // Steer for the lane: what the bend takes, plus what it takes to get across.
  const bend = Math.round((((v * v) / 1000) * s.curve[d.piece]!) / 1_000_000);
  const across = clamp((target - d.x) * 2, -2600, 2600) - d.vx;
  const wobble = sloppy > 0 ? Math.round((rand() - 0.5) * sloppy * 40) : 0;
  const steer = clamp(Math.round(((bend + (across * 100) / 35) * 100) / grip) + wobble, -100, 100);
  const drive = wellDriven(spec, car, 900, 400);
  const over = v - cap;
  return { gas: over > 0 ? 0 : drive.gas, brake: over > 1500 ? 100 : over > 400 ? 50 : 0, steer, gear: drive.gear, stage: true, build };
}

// ---- The game ------------------------------------------------------------------------------------

function normalize(rules: unknown): MountainRoadRules {
  const given = (rules && typeof rules === "object" ? rules : {}) as Partial<MountainRoadRules>;
  const preset = MOUNTAIN_ROAD_PRESETS.find((p) => p.id === given.id) ?? MOUNTAIN_ROAD_PRESETS[0]!;
  const num = (n: unknown, low: number, high: number, or: number) => (typeof n === "number" && Number.isFinite(n) ? clamp(Math.trunc(n), low, high) : or);
  return {
    id: typeof given.id === "string" ? given.id : preset.id,
    name: typeof given.name === "string" && given.name ? given.name : preset.name,
    stages: num(given.stages, 1, 8, preset.stages),
    stageLength: num(given.stageLength, 1000, 6000, preset.stageLength),
    traffic: given.traffic === "light" || given.traffic === "steady" || given.traffic === "heavy" ? given.traffic : preset.traffic,
    patrols: num(given.patrols, 0, 6, preset.patrols),
  };
}

function layRoad(s: MountainRoadState) {
  const rand = nextRandom(s);
  // A straight to get going on, then bends and straights until there is enough road.
  s.at = [0];
  s.curve = [0];
  s.grade = [0];
  let at = 220;
  let side = rand() < 0.5 ? 1 : -1;
  while (at < s.length + 400) {
    const straight = rand() < 0.38;
    s.at.push(at);
    // From a long sweep to a bend you have to brake for: a radius of 420 metres down to 95.
    s.curve.push(straight ? 0 : side * (2400 + Math.floor(rand() * 8100)));
    s.grade.push(Math.floor(rand() * 121) - 60);
    if (!straight && rand() < 0.7) side = -side;
    at += (straight ? 90 : 60) + Math.floor(rand() * 160);
  }
  // Patrol cars: somewhere in each leg, not in its first quarter-mile.
  s.traps = [];
  for (let leg = 0; leg < s.rules.stages; leg++) for (let i = 0; i < s.rules.patrols; i++) s.traps.push(leg * s.rules.stageLength + 400 + Math.floor(rand() * (s.rules.stageLength - 600)));
  s.traps.sort((a, b) => a - b);
}

const newDriver = (): Driver => ({ build: LOANER, staged: false, car: restingCar(specFor(LOANER)), x: LANE, vx: 0, piece: 0, fuel: TANK, damage: 0, shaken: 0, out: 0, clock: 0, penalty: 0, fines: 0, stage: 0, legFrom: 0, legs: [], rest: 0, trap: 0, cop: 0, copAt: 0, copSpeed: 0, copOn: 0, copFor: 0, squeal: false });

export const mountainRoad: ArcadeGame<MountainRoadRules, MountainRoadState, MountainRoadInput> = {
  id: "mountainroad",
  name: "The Mountain Road",
  emoji: "⛰️",
  category: "arcade",
  blurb: "One road, a rock face, a drop, and everyone else on it",
  tagline: "A run down a two-lane mountain road in what you built: bends, traffic both ways, the law, and a gas station at the end of each leg.",
  seats: { min: 1, max: 2, default: 1 },
  teams: false,
  presets: MOUNTAIN_ROAD_PRESETS,
  fields: [
    { key: "stages", label: "Legs", kind: "number", min: 1, max: 8 },
    { key: "stageLength", label: "Metres a leg", kind: "number", min: 1000, max: 6000, step: 500 },
    { key: "traffic", label: "Traffic", kind: "choice", options: [["light", "Light"], ["steady", "Steady"], ["heavy", "Heavy"]] },
    { key: "patrols", label: "Patrol cars a leg", kind: "number", min: 0, max: 6 },
  ],
  normalize,
  validate(rules) {
    const problems: string[] = [];
    if (!Number.isInteger(rules.stages) || rules.stages < 1 || rules.stages > 8) problems.push("A run has from one to eight legs.");
    if (!Number.isInteger(rules.stageLength) || rules.stageLength < 1000 || rules.stageLength > 6000) problems.push("A leg is from 1,000 to 6,000 metres.");
    if (rules.traffic !== "light" && rules.traffic !== "steady" && rules.traffic !== "heavy") problems.push("Traffic is light, steady or heavy.");
    if (!Number.isInteger(rules.patrols) || rules.patrols < 0 || rules.patrols > 6) problems.push("There are from no patrol cars to six a leg.");
    return problems;
  },
  describe(rules) {
    return [
      `${rules.stages} ${rules.stages === 1 ? "leg" : "legs"} of ${(rules.stageLength / 1000).toFixed(1)} km, with a gas station at the end of each. ${rules.traffic === "light" ? "Not much on the road." : rules.traffic === "heavy" ? "The road is busy both ways." : "Traffic both ways."}`,
      "A bend pushes the car wide. The faster you are, the more wheel it takes, and there is only so much grip.",
      `The limit is ${ROAD_LIMIT}. ${rules.patrols ? "The detector chirps when a patrol car is near. Pass one too fast and it comes after you: stop on your own side for a ticket, or try to lose it." : "Nobody is out to enforce it."}`,
      "Hits and scrapes take power off the car and bend it. Enough of them end the run, and the drop ends it at once.",
    ];
  },
  controls: ["Left and right, or A and D, steer. Up or W is the throttle, Down or S the brake.", "Shift up with Space or E, down with Q.", "With lights behind you, stop on your own side of the road to take the ticket."],
  rate: RATE,
  newGame(rules, seats, seed) {
    const count = clamp(Math.trunc(seats) || 1, 1, 2);
    const s: MountainRoadState = { rules, seats: count, rng: seed >>> 0, tick: 0, phase: "staging", at: [], curve: [], grade: [], length: rules.stages * rules.stageLength, traps: [], drivers: Array.from({ length: count }, newDriver), traffic: [], nextId: 1, nextSame: 260, nextOncoming: RATE * 4, events: [] };
    layRoad(s);
    return s;
  },
  idle: IDLE,
  input: safeInput,
  step,
  view,
  bot,
  summary,
};
