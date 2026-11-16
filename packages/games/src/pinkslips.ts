// Road to the Shootout (`pinkslips` in code: its first name, which its id, files and exports
// keep): a drag race, the fourth game on the arcade kit and the first where the seats are
// against each other. One to four cars line up, the tree comes down, and the first one to the line
// without leaving early wins. What you race is what you built: a seat brings its car to the line
// as a `Build` (see `pinkslipscars.ts`), and the garage it came from is `pinkslipsgarage.ts`.
//
// A run has three places to win or lose it:
//   - The light. Leave before the green and you have red-lit: you lose, whatever you run. Leave
//     late and you have given the other lane a head start.
//   - The launch. Hold the revs in neutral and drop it into first on the green. Too few revs and
//     it bogs; too many for the tyres and they spin, and a spinning tyre pushes less.
//   - The shifts. Each gear change costs time with nothing driving the car, so shift where the
//     engine is still pulling. Over the redline the engine gets hot, and hot enough it lets go.
//     An automatic shifts for itself, slowly.
//
// The race runs in phases: staging (each seat rolls up with its car), ready, the tree, racing,
// over. A seat that never stages is rolled up in a tired econobox after twenty seconds, and a race
// nobody finishes is called off, so a game always ends.
//
// Everything in the state is a whole number: see the units at the top of `pinkslipscars.ts`. Times
// to the line are kept in millionths of a second, worked out from how far past the line the car
// was at the end of its last tick, so two cars that cross in the same sixtieth are still split.
import type { PlayStyle } from "@journey-to-code/rules";
import type { ArcadeEvent, ArcadeGame, ArcadeRace, ArcadeSummary, ArcadeThing, ArcadeView } from "./arcade.js";
import { CAR_MODELS, EIGHTH_MILE, PINKSLIPS_RATE, QUARTER_MILE, driveCar, freeRev, launchRpm, restingCar, roadRpm, safeBuild, specOf, stockBuild, toMph, wellDriven, type Build, type CarMotion, type CarSpec } from "./pinkslipscars.js";
import { nextRandom, who, type BaseRules } from "./table.js";

export const PINKSLIPS_FIELD = { width: 6000, height: 8000 };
const W = PINKSLIPS_FIELD.width;
const RATE = PINKSLIPS_RATE;
const START_Y = 7200;
const FINISH_Y = 800;
/** Ticks a seat has to roll up before it is rolled up for it. */
const STAGE_LIMIT = RATE * 20;
/** Ticks after the green before a race nobody has finished is called off. */
const RACE_LIMIT = RATE * 40;
/** Ticks the rest have to get there once somebody has. */
const AFTER_FIRST = RATE * 12;
const TONES = ["blue", "red", "green", "gold"];
/** What a seat that never staged is given. */
const LOANER: Build = stockBuild(0, 600, 500);

export interface PinkSlipsRules extends BaseRules {
  distance: "quarter" | "eighth";
  /**
   * Three ambers a half second apart; all three at once; no lights at all and somebody drops a
   * flashlight when they feel like it; or a roll: side by side at an agreed speed, and go on the
   * signal. From a roll there is no launch and nobody can leave early.
   */
  tree: "sportsman" | "pro" | "drop" | "roll";
  /** The speed a roll race starts from, in miles an hour. */
  roll: number;
  /**
   * Index racing: the time to run to, in hundredths of a second, or 0 for a plain race. Run quicker
   * than the index and you have broken out, and a breakout loses to a clean run however slow.
   */
  index: number;
  /** A prepared strip, or a back road with a fifth less grip. */
  surface: "strip" | "street";
}

export const PINKSLIPS_PRESETS: PinkSlipsRules[] = [
  { id: "strip", name: "Strip night", distance: "quarter", tree: "sportsman", surface: "strip", roll: 40, index: 0 },
  { id: "eighth", name: "Eighth mile", distance: "eighth", tree: "sportsman", surface: "strip", roll: 40, index: 0 },
  { id: "pro", name: "Pro tree", distance: "quarter", tree: "pro", surface: "strip", roll: 40, index: 0 },
  { id: "street", name: "Flashlight drags", distance: "quarter", tree: "drop", surface: "street", roll: 40, index: 0 },
  { id: "roll", name: "Roll race", distance: "quarter", tree: "roll", surface: "street", roll: 40, index: 0 },
  { id: "index", name: "Index 15.00", distance: "quarter", tree: "sportsman", surface: "strip", roll: 40, index: 1500 },
];

/** What a seat's controls are doing. */
export interface PinkSlipsInput {
  /** The throttle, 0 to 100. */
  gas: number;
  /** The gear asked for: 0 is neutral. In an automatic anything above neutral is drive. */
  gear: number;
  /** Roll up to the line with `build`. Once staged a seat stays staged, and its car cannot be changed. */
  stage: boolean;
  build: Build;
}

interface Lane {
  build: Build;
  staged: boolean;
  car: CarMotion;
  /** The tick it first moved, or -1. */
  left: number;
  foul: boolean;
  /** Millionths of a second from the green to the line, or 0 while it is not there. */
  done: number;
  /** Its speed at the line. */
  trap: number;
}

export interface PinkSlipsState {
  rules: PinkSlipsRules;
  seats: number;
  rng: number;
  tick: number;
  phase: "staging" | "ready" | "tree" | "racing" | "over";
  /** How good the surface is tonight, in thousandths of a prepared strip. */
  track: number;
  /** How far it is to the line, in tenths of a millimetre. */
  line: number;
  /** The ticks the tree starts and goes green, once everyone is staged. */
  treeAt: number;
  greenAt: number;
  /** The tick the race is called, whoever is still out there. */
  endsAt: number;
  lanes: Lane[];
  events: ArcadeEvent[];
}

const IDLE: PinkSlipsInput = { gas: 0, gear: 0, stage: false, build: stockBuild(0) };
const clamp = (n: number, low: number, high: number) => (n < low ? low : n > high ? high : n);
const whole = (n: unknown) => (typeof n === "number" && Number.isFinite(n) ? Math.trunc(n) + 0 : 0);

function safeInput(given: unknown): PinkSlipsInput {
  if (!given || typeof given !== "object" || Array.isArray(given)) return IDLE;
  const g = given as Record<string, unknown>;
  return { gas: clamp(whole(g.gas), 0, 100), gear: clamp(whole(g.gear), 0, 6), stage: g.stage === true, build: safeBuild(g.build) };
}

// A spec is worked out from a build and never changes, so it is kept by the build's numbers. It
// is not part of any state: the same build always gives the same spec.
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

const laneX = (seat: number, seats: number) => W / 2 + (seat * 2 - (seats - 1)) * 500;
const carY = (s: PinkSlipsState, dist: number) => START_Y - Math.floor((Math.min(dist, s.line) * (START_Y - FINISH_Y)) / s.line);

function say(s: PinkSlipsState, kind: string, seat: number, more: Partial<ArcadeEvent> = {}) {
  const lane = s.lanes[seat];
  if (s.events.length < 40) s.events.push({ kind, x: laneX(seat, s.seats), y: lane ? carY(s, lane.car.dist) : START_Y, seat, ...more });
}

const seconds = (millionths: number) => (Math.round(millionths / 1000) / 1000).toFixed(3);

function stageLane(s: PinkSlipsState, seat: number, build: Build) {
  const lane = s.lanes[seat]!;
  lane.build = build;
  lane.staged = true;
  lane.car = restingCar(specFor(build));
  say(s, "staged", seat, { text: CAR_MODELS[build[0]!]!.name });
}

function step(s: PinkSlipsState, inputs: readonly (PinkSlipsInput | null | undefined)[]) {
  if (s.phase === "over") return;
  s.events = [];
  const held = s.lanes.map((_, seat) => safeInput(inputs[seat]));

  if (s.phase === "staging") {
    s.lanes.forEach((lane, seat) => {
      if (!lane.staged && held[seat]!.stage) stageLane(s, seat, held[seat]!.build);
      else if (!lane.staged && s.tick >= STAGE_LIMIT) stageLane(s, seat, LOANER);
    });
    if (s.lanes.every((l) => l.staged)) {
      const rand = nextRandom(s);
      s.phase = "ready";
      // A breath before the lights, never the same length twice.
      s.treeAt = s.tick + RATE + Math.floor(rand() * RATE * 2);
      s.greenAt = s.treeAt + (s.rules.tree === "sportsman" ? 90 : s.rules.tree === "pro" ? 24 : RATE + Math.floor(rand() * RATE * 3));
      if (s.rules.tree === "roll") {
        // Rolling: everyone up to the agreed speed in a gear that suits it, and holding it there.
        for (const lane of s.lanes) {
          const spec = specFor(lane.build);
          lane.car.speed = s.rules.roll * 4470;
          let gear = 1;
          while (gear < spec.gears.length && roadRpm(spec, lane.car.speed, gear) > spec.peakRpm) gear++;
          lane.car.gear = gear;
          lane.car.rpm = Math.max(900, roadRpm(spec, lane.car.speed, gear));
        }
      }
      s.endsAt = s.greenAt + RACE_LIMIT;
    }
  } else if (s.phase === "ready" && s.tick >= s.treeAt) {
    s.phase = "tree";
    if (s.rules.tree === "sportsman" || s.rules.tree === "pro") s.events.push({ kind: "amber", x: W / 2, y: START_Y - 600 });
  } else if (s.phase === "tree") {
    if (s.tick >= s.greenAt) {
      s.phase = "racing";
      s.events.push({ kind: "green", x: W / 2, y: START_Y - 600 });
    } else if (s.rules.tree === "sportsman" && (s.tick - s.treeAt) % 30 === 0) s.events.push({ kind: "amber", x: W / 2, y: START_Y - 600 });
  }

  let firstHome = false;
  s.lanes.forEach((lane, seat) => {
    if (!lane.staged || lane.done) return;
    const spec = specFor(lane.build);
    const car = lane.car;
    const input = held[seat]!;
    const rolling = s.rules.tree === "roll" && s.phase !== "racing" && s.phase !== "staging";
    // Until the tree starts the car is held on the line: rev it all you like. From a roll it is
    // held at the speed instead, in whatever gear the driver likes, until the signal.
    // (From a roll, neutral on the shifter means "leave it where it is": there is no line to sit on.)
    const want = s.rules.tree === "roll" && s.phase !== "staging" ? (spec.auto ? 1 : input.gear || car.gear) : s.phase === "tree" || s.phase === "racing" ? input.gear : 0;
    const before = car.dist;
    const news = driveCar(spec, car, rolling ? 0 : input.gas, want, s.track);
    if (rolling) {
      car.speed = s.rules.roll * 4470;
      car.dist = before + Math.round(car.speed / RATE);
      s.line = car.dist + lineOf(s.rules);
      return;
    }
    if (news.shifted) say(s, "shift", seat, { amount: news.shifted });
    if (news.spun) say(s, "spin", seat);
    if (news.blew) say(s, "blown", seat, { text: "Blown!" });
    // From a roll the car is already moving: it has left when the driver gets on it.
    if (lane.left < 0 && (s.rules.tree === "roll" ? s.phase === "racing" && input.gas >= 50 : car.dist > 0)) {
      lane.left = s.tick;
      if (s.phase === "tree") {
        lane.foul = true;
        say(s, "redlight", seat, { text: "Red light!" });
      } else say(s, "launch", seat, { amount: Math.round(((s.tick - s.greenAt) * 1000) / RATE) });
    }
    if (car.dist >= s.line) {
      const tick = Math.round(((s.tick + 1 - s.greenAt) * 1_000_000) / RATE);
      const over = car.dist > before ? Math.round(((car.dist - s.line) * 1_000_000) / RATE / (car.dist - before)) : 0;
      lane.done = Math.max(1, tick - over);
      lane.trap = car.speed;
      if (!lane.foul) firstHome = true;
      say(s, "home", seat, { text: seconds(lane.done - reactionOf(s, lane) * 1000), amount: toMph(car.speed) });
    }
  });
  s.tick++;

  if (s.phase === "racing") {
    if (firstHome) s.endsAt = Math.min(s.endsAt, s.tick + AFTER_FIRST);
    const settled = s.lanes.every((l) => l.done || (l.car.blown && l.car.speed === 0));
    if (settled || s.tick >= s.endsAt) {
      s.phase = "over";
      const best = placing(s)[0]!;
      s.events.push({ kind: "finish", x: laneX(best, s.seats), y: FINISH_Y, seat: clean(s.lanes[best]!) ? best : undefined });
    }
  }
}

/** Ms from the green to moving (never less than nothing: a red light left before it). */
const reactionOf = (s: PinkSlipsState, lane: Lane) => (lane.left < 0 ? 0 : Math.max(0, Math.round(((lane.left - s.greenAt) * 1000) / RATE)));
/** Got to the line and did not leave early. */
const clean = (lane: Lane) => lane.done > 0 && !lane.foul;
/** Ms from moving to the line, as a strip times it. */
const timeOf = (s: PinkSlipsState, lane: Lane) => Math.round(lane.done / 1000) - reactionOf(s, lane);
/** In index racing: ran quicker than the index, and by how many ms. 0 when it did not, or there is no index. */
const brokeOut = (s: PinkSlipsState, lane: Lane) => (s.rules.index > 0 && clean(lane) ? Math.max(0, s.rules.index * 10 - timeOf(s, lane)) : 0);
const lineOf = (rules: PinkSlipsRules) => (rules.distance === "eighth" ? EIGHTH_MILE : QUARTER_MILE);

/**
 * Seats best to worst: clean runs by who got there first, then breakouts by who broke out least,
 * then red lights, then whoever got furthest.
 */
function placing(s: PinkSlipsState): number[] {
  const rank = (l: Lane) => (clean(l) ? (brokeOut(s, l) ? 1 : 0) : l.done ? 2 : 3);
  return s.lanes
    .map((lane, seat) => ({ lane, seat }))
    .sort((a, b) => rank(a.lane) - rank(b.lane) || (rank(a.lane) === 1 ? brokeOut(s, a.lane) - brokeOut(s, b.lane) : 0) || (a.lane.done && b.lane.done ? a.lane.done - b.lane.done : b.lane.car.dist - a.lane.car.dist) || a.seat - b.seat)
    .map((e) => e.seat);
}

/** What a run scores: sixty thousand, less a point for each thousandth of a second from the green to the line. Nothing for a red light or a car that never got there. */
const scoreOf = (lane: Lane) => (clean(lane) ? Math.max(1, 60_000 - Math.round(lane.done / 1000)) : 0);

function summary(s: PinkSlipsState): ArcadeSummary {
  const scores = s.lanes.map(scoreOf);
  const order = placing(s);
  const best = s.lanes[order[0]!]!;
  const names = { staging: "staging", ready: "staged", tree: "on the tree", racing: "racing", over: "over" } as const;
  return {
    game: "pinkslips",
    rules: s.rules.name,
    phase: names[s.phase],
    over: s.phase === "over",
    seats: s.seats,
    ticks: s.tick,
    score: Math.max(...scores),
    scores,
    scoreLine: clean(best) ? `${who(order[0]!)} ran ${seconds(best.done - reactionOf(s, best) * 1000)} at ${toMph(best.trap)} mph` : s.phase === "over" ? "Nobody made a clean run" : "On the line",
    order,
  };
}

/** One seat's run, for whoever settles the wager and puts the car back in its garage. */
export interface PinkSlipsResult {
  seat: number;
  /** 1 for the winner. */
  place: number;
  /** Won it: first, with a clean run. */
  won: boolean;
  build: Build;
  car: string;
  /** Got to the line. */
  finished: boolean;
  foul: boolean;
  /** In index racing: ran quicker than the index. */
  breakout: boolean;
  blown: boolean;
  /** Ms from the green to moving, or null if it never did. */
  reaction: number | null;
  /** Ms from moving to the line, as a strip times it, or null. */
  time: number | null;
  /** Miles an hour at the line, or as fast as it was going when the race was called. */
  mph: number;
  /** What the run cost the car, in thousandths, for `afterRace`. */
  engineWear: number;
  rubberWear: number;
  oilWear: number;
  plugsWear: number;
}

export function pinkSlipsResults(s: PinkSlipsState): PinkSlipsResult[] {
  const order = placing(s);
  return s.lanes.map((lane, seat) => {
    const place = order.indexOf(seat) + 1;
    return {
      seat,
      place,
      // A breakout only wins when everyone else broke out by more, red-lit, or never got there.
      won: s.phase === "over" && place === 1 && clean(lane),
      breakout: brokeOut(s, lane) > 0,
      build: lane.build,
      car: CAR_MODELS[lane.build[0]!]!.name,
      finished: lane.done > 0,
      foul: lane.foul,
      blown: lane.car.blown,
      reaction: lane.left < 0 ? null : reactionOf(s, lane),
      time: lane.done ? Math.round(lane.done / 1000) - reactionOf(s, lane) : null,
      mph: toMph(lane.done ? lane.trap : lane.car.speed),
      // A pass is a pass: a little off the engine and the tyres, more for revs past the line on the dial, boost, and smoke.
      engineWear: lane.left < 0 ? 0 : 4 + Math.floor(lane.car.strain / 6) + lane.build[4]! * 2,
      rubberWear: lane.left < 0 ? 0 : 6 + Math.floor(lane.car.smoke / 3) + lane.build[5]! * 4,
      // Oil is used up a pass at a time, and a rich mixture fouls the plugs.
      oilWear: lane.left < 0 ? 0 : 25,
      plugsWear: lane.left < 0 ? 0 : 4 + specFor(lane.build).rich * 30,
    };
  });
}

function view(s: PinkSlipsState): ArcadeView {
  const things: ArcadeThing[] = [];
  const edge = (s.seats + 1) * 500;
  const lit = s.phase === "tree" ? s.tick - s.treeAt : -1;
  const green = s.phase === "racing" || s.phase === "over";
  const ambers = [0, 1, 2].map((i) => (s.rules.tree === "sportsman" || s.rules.tree === "pro") && lit >= 0 && (s.rules.tree === "pro" || lit >= i * 30));
  ambers.forEach((on, i) => things.push({ id: 10 + i, kind: "light:amber", x: W / 2, y: START_Y - 900 + i * 220, r: 90, tone: on ? "gold" : "grey" }));
  things.push({ id: 13, kind: "light:green", x: W / 2, y: START_Y - 240, r: 90, tone: green ? "green" : "grey" });
  [START_Y, FINISH_Y].forEach((y, i) => {
    things.push({ id: 30 + i * 2, kind: i ? "post:finish" : "post:start", x: W / 2 - edge, y, r: 70, tone: "white" });
    things.push({ id: 31 + i * 2, kind: i ? "post:finish" : "post:start", x: W / 2 + edge, y, r: 70, tone: "white" });
  });
  const order = placing(s);
  const lanes: ArcadeRace["lanes"] = s.lanes.map((lane, seat) => {
    const spec = specFor(lane.build);
    const car = lane.car;
    const x = laneX(seat, s.seats);
    if (lane.staged) {
      things.push({ id: seat + 1, kind: `car:${CAR_MODELS[lane.build[0]!]!.key}`, x, y: carY(s, car.dist), r: 240, tone: TONES[seat % TONES.length], angle: 27000, seat, health: car.blown ? 0 : clamp(1000 - Math.floor((car.heat * 1000) / spec.blowAt), 0, 1000), ...(car.spin ? { mark: "spin" } : {}), ...(car.blown ? { ghost: true } : {}) });
      if (lane.foul) things.push({ id: 20 + seat, kind: "light:red", x, y: START_Y + 400, r: 90, tone: "red", seat });
    }
    return {
      seat,
      car: lane.staged ? CAR_MODELS[lane.build[0]!]!.name : "",
      staged: lane.staged,
      distance: Math.floor(Math.min(car.dist, s.line) / 10),
      speed: Math.floor(car.speed / 10),
      mph: toMph(car.speed),
      rpm: car.rpm,
      redline: spec.redline,
      gear: car.gear,
      gears: spec.gears.length,
      auto: spec.auto,
      shifting: car.shifting > 0,
      boost: spec.turbo ? car.boost : null,
      heat: clamp(Math.floor((car.heat * 1000) / spec.blowAt), 0, 1000),
      oil: car.oil,
      afr: spec.afr,
      spinning: car.spin,
      blown: car.blown,
      foul: lane.foul,
      breakout: brokeOut(s, lane) > 0,
      reaction: lane.left < 0 ? null : reactionOf(s, lane),
      time: lane.done ? Math.round(lane.done / 1000) - reactionOf(s, lane) : null,
      trap: lane.done ? toMph(lane.trap) : null,
      place: s.phase === "over" ? order.indexOf(seat) + 1 : null,
    };
  });
  const sum = summary(s);
  const winner = s.lanes[order[0]!]!;
  const stage = { staging: "Staging", ready: "Staged", tree: "On the tree", racing: "Racing", over: clean(winner) ? `${seconds(winner.done - reactionOf(s, winner) * 1000)} at ${toMph(winner.trap)} mph` : "No clean run" }[s.phase];
  const banner = s.phase === "staging" ? "Roll up to the line" : s.phase === "racing" && s.tick - s.greenAt < RATE ? "GO" : s.phase === "over" ? (clean(winner) ? `${who(order[0]!)} wins` : "Nobody wins") : undefined;
  return {
    game: "pinkslips",
    tick: s.tick,
    rate: RATE,
    seats: s.seats,
    field: PINKSLIPS_FIELD,
    things,
    pilots: s.lanes.map((lane, seat) => ({
      seat,
      playing: lane.staged && !lane.car.blown && !lane.done,
      score: sum.scores[seat]!,
      lives: lane.foul || lane.car.blown ? 0 : 1,
      stats: [
        { key: "mph", label: "MPH", value: toMph(lane.car.speed) },
        { key: "rpm", label: "RPM", value: lane.car.rpm, max: specFor(lane.build).redline },
        { key: "gear", label: "Gear", value: lane.car.gear, max: specFor(lane.build).gears.length },
      ],
    })),
    score: sum.score,
    stage,
    ...(banner ? { banner } : {}),
    race: { phase: s.phase, distance: Math.floor(s.line / 10), index: s.rules.index * 10, tree: { ambers, green }, lanes },
    events: s.events,
    over: s.phase === "over",
  };
}

// ---- The computer driver ---------------------------------------------------------------------------

/** What a computer player brings when nobody has given it a car: a shitbox for a beginner, something that wins for a hard one. */
export function botRide(skill: number, seat: number): Build {
  const tier = skill < 0.45 ? 0 : skill < 0.85 ? 1 : 2;
  const pool = CAR_MODELS.map((m, i) => ({ m, i })).filter((e) => e.m.tier === tier);
  return stockBuild(pool[seat % pool.length]!.i, 850, 800);
}

function bot(s: PinkSlipsState, seat: number, style: PlayStyle, rand: () => number = Math.random): PinkSlipsInput {
  const lane = s.lanes[seat];
  if (!lane) return IDLE;
  const skill = style.skill ?? 0.6;
  const sloppy = style.sloppy ?? 0.1;
  const build = lane.staged ? lane.build : botRide(skill, seat);
  if (s.phase === "over" || lane.done || lane.car.blown) return { gas: 0, gear: 0, stage: true, build };
  const spec = specFor(build);
  // On the line: hold the revs where the car wants to leave. A beginner guesses.
  const revs = skill >= 0.5 ? launchRpm(spec, s.track) : Math.round((spec.redline * 11) / 20);
  const span = freeRev(spec, 100) - freeRev(spec, 0);
  const waiting: PinkSlipsInput = { gas: clamp(Math.ceil(((revs - freeRev(spec, 0)) * 100) / span), 0, 100), gear: 0, stage: true, build };
  if (s.phase !== "racing") return waiting;
  if (lane.left < 0) {
    // Nobody leaves on the very tick: a good driver is a tenth of a second behind the light, a beginner a third.
    const wait = 5 + Math.round((1 - skill) * 16);
    if (s.tick - s.greenAt < wait || rand() < sloppy) return waiting;
    // From a roll it is already in a gear: get on it where it is.
    if (s.rules.tree === "roll") return { ...wellDriven(spec, lane.car, s.track), stage: true, build };
    return { gas: skill >= 0.5 ? wellDriven(spec, { ...lane.car, gear: 1 }, s.track).gas : 100, gear: 1, stage: true, build };
  }
  // Away: flat out, lifting for wheelspin if it knows how, and shifting about where it should.
  const drive = wellDriven(spec, lane.car, s.track, 150 + Math.round((1 - skill) * 500) - Math.round(sloppy * 700));
  return { gas: skill >= 0.5 ? drive.gas : 100, gear: drive.gear, stage: true, build };
}

// ---- The game ------------------------------------------------------------------------------------

function normalize(rules: unknown): PinkSlipsRules {
  const given = (rules && typeof rules === "object" ? rules : {}) as Partial<PinkSlipsRules>;
  const preset = PINKSLIPS_PRESETS.find((p) => p.id === given.id) ?? PINKSLIPS_PRESETS[0]!;
  return {
    id: typeof given.id === "string" ? given.id : preset.id,
    name: typeof given.name === "string" && given.name ? given.name : preset.name,
    distance: given.distance === "quarter" || given.distance === "eighth" ? given.distance : preset.distance,
    tree: given.tree === "sportsman" || given.tree === "pro" || given.tree === "drop" || given.tree === "roll" ? given.tree : preset.tree,
    roll: typeof given.roll === "number" && Number.isFinite(given.roll) ? clamp(Math.trunc(given.roll), 20, 80) : preset.roll,
    index: typeof given.index === "number" && Number.isFinite(given.index) ? clamp(Math.trunc(given.index), 0, 2500) : preset.index,
    surface: given.surface === "strip" || given.surface === "street" ? given.surface : preset.surface,
  };
}

export const pinkSlips: ArcadeGame<PinkSlipsRules, PinkSlipsState, PinkSlipsInput> = {
  id: "pinkslips",
  name: "Road to the Shootout",
  emoji: "🏁",
  category: "arcade",
  blurb: "Build a shitbox, line it up, and leave on the green",
  tagline: "A drag race for what you built: hold the revs, leave on the green, and shift before it lets go. Alone against the clock, or up to four wide.",
  seats: { min: 1, max: 4, default: 2 },
  teams: false,
  presets: PINKSLIPS_PRESETS,
  fields: [
    { key: "distance", label: "Distance", kind: "choice", options: [["quarter", "Quarter mile"], ["eighth", "Eighth mile"]] },
    { key: "tree", label: "Start", hint: "A pro tree lights all three ambers at once. An arm drop has no lights: it goes when it goes", kind: "choice", options: [["sportsman", "Sportsman tree"], ["pro", "Pro tree"], ["drop", "Flashlight"], ["roll", "From a roll"]] },
    { key: "roll", label: "Roll speed", hint: "Miles an hour a roll race starts from", kind: "number", min: 20, max: 80, step: 5 },
    { key: "index", label: "Index", hint: "Hundredths of a second to run to: 1500 is 15.00. Quicker than that is a breakout. 0 is a plain race", kind: "number", min: 0, max: 2500, step: 50 },
    { key: "surface", label: "Surface", hint: "A back road has a fifth less grip than a prepared strip", kind: "choice", options: [["strip", "Prepared strip"], ["street", "Back road"]] },
  ],
  normalize,
  validate(rules) {
    const problems: string[] = [];
    if (rules.distance !== "quarter" && rules.distance !== "eighth") problems.push("A race is a quarter mile or an eighth.");
    if (rules.tree !== "sportsman" && rules.tree !== "pro" && rules.tree !== "drop" && rules.tree !== "roll") problems.push("The start is a sportsman tree, a pro tree, a flashlight or a roll.");
    if (!Number.isInteger(rules.roll) || rules.roll < 20 || rules.roll > 80) problems.push("A roll starts from between 20 and 80 miles an hour.");
    if (!Number.isInteger(rules.index) || rules.index < 0 || rules.index > 2500) problems.push("An index is from 0 to 25.00 seconds.");
    if (rules.surface !== "strip" && rules.surface !== "street") problems.push("The surface is a prepared strip or a back road.");
    return problems;
  },
  describe(rules) {
    return [
      `${rules.distance === "quarter" ? "A quarter mile" : "An eighth of a mile"} on ${rules.surface === "strip" ? "a prepared strip" : "a back road, with a fifth less grip"}. First to the line wins.`,
      rules.tree === "sportsman" ? "Three ambers come down half a second apart, then green." : rules.tree === "pro" ? "All three ambers light at once, and it is green four tenths of a second later." : rules.tree === "drop" ? "No lights. It goes when the flashlight drops, and nobody knows when that is." : `From a roll: side by side at ${rules.roll}, and go on the signal. No launch, so it is all power and gearing.`,
      ...(rules.index ? [`Index racing: run as close to ${(rules.index / 100).toFixed(2)} as you can without going quicker. Quicker is a breakout, and a breakout loses to any clean run.`] : []),
      rules.tree === "roll" ? "Pick your gear on the roll. The clock starts when you get on it." : "Leave before the green and you have red-lit: you lose, whatever you run.",
      "Too many revs off the line spins the tyres, and a spinning tyre pushes less. Too few and it bogs.",
      "Past the redline the engine gets hot. Hot enough, and it lets go.",
    ];
  },
  controls: [
    "Hold Up, W or the pedal for the throttle.",
    "Shift up with Space or D, down with A. First gear on the green is the launch.",
    "Hold the revs in neutral while you wait for the light.",
  ],
  rate: RATE,
  newGame(rules, seats, seed) {
    const count = clamp(Math.trunc(seats) || 1, 1, 4);
    const s: PinkSlipsState = {
      rules,
      seats: count,
      rng: seed >>> 0,
      tick: 0,
      phase: "staging",
      track: 1000,
      line: lineOf(rules),
      treeAt: 0,
      greenAt: 0,
      endsAt: 0,
      lanes: Array.from({ length: count }, () => ({ build: LOANER, staged: false, car: restingCar(specFor(LOANER)), left: -1, foul: false, done: 0, trap: 0 })),
      events: [],
    };
    // The surface is a little different every night.
    s.track = (rules.surface === "street" ? 780 : 1000) + Math.floor(nextRandom(s)() * 61) - 30;
    return s;
  },
  idle: IDLE,
  input: safeInput,
  step,
  view,
  bot,
  summary,
};

/** The colour of a seat's car, as the other arcade games give them. */
export const pinkSlipsTone = (seat: number) => TONES[seat % TONES.length]!;
