// Pink Slips, the cars: every model there is, the parts that go on them, and the drivetrain that
// turns a build into a car that moves. The race (`pinkslips.ts`) and the garage
// (`pinkslipsgarage.ts`) are both built on this file.
//
// The makes and models are our own. They are the kind of thing that sat in the classifieds around
// 1990: econoboxes, hand-me-down wagons and a mini pickup at the bottom, a few cars nobody suspects
// in the middle, and a handful everybody wants at the top.
//
// A car in a race is a `Build`: eleven whole numbers (the model, a level for each part, the final
// drive, and how worn the engine and the tyres are). `specOf(build)` works out what that car is
// (mass, torque curve, gearing, grip), and `driveCar` moves it on one tick. Everything is whole
// numbers and exact operations, so the same build driven the same way runs the same time
// everywhere:
//
//   distance   tenths of a millimetre        speed    tenths of a millimetre a second
//   torque     newton metres                 force    newtons
//   ratios, grip, shares and factors         thousandths
//
// A tick is a sixtieth of a second.

export const PINKSLIPS_RATE = 60;
const IDLE_RPM = 900;
/** How far past the redline an engine will spin with nothing holding it back. */
const OVER_REV = 1200;
/** How fast the revs come down to meet the road when the clutch goes in at speed, a tick. */
const CLUTCH_SLIP = 40;
/** How much of the grip is left once the tyres are spinning. */
const SPIN_KEEPS = 820;

export type Drive = "fwd" | "rwd" | "awd";
/** 0 is a shitbox, 1 a sleeper, 2 one of the cars everybody wants. */
export type CarTier = 0 | 1 | 2;
export const CAR_TIERS = ["Shitbox", "Sleeper", "Sought after"] as const;

export interface CarModel {
  key: string;
  name: string;
  tier: CarTier;
  year: number;
  /** A line for the classifieds. */
  blurb: string;
  /** Kilograms, empty. */
  mass: number;
  drive: Drive;
  /** How much of the car's weight sits on the driven wheels when it launches, in thousandths. */
  bite: number;
  /** Drag area, in thousandths of a square metre. */
  drag: number;
  /** Tyre radius, in millimetres. */
  radius: number;
  /** Peak torque and where it is made. */
  peak: number;
  peakRpm: number;
  redline: number;
  /** How much of the peak there is at 1000 rpm, and at the redline, in thousandths. */
  low: number;
  tail: number;
  /** A turbo: how much torque there is off boost (thousandths), where it spools, and how fast (thousandths a tick). */
  turbo: { off: number; spool: number; rate: number } | null;
  /** An automatic shifts for itself, slowly. */
  auto: boolean;
  /** Gear ratios, in thousandths, first gear first. */
  gears: number[];
  final: number;
  /** What a clean one is worth, in dollars. */
  value: number;
}

export const CAR_MODELS: CarModel[] = [
  { key: "sparrow", name: "Bexley Sparrow", tier: 0, year: 1984, blurb: "Runs. Radio works. Three hubcaps.", mass: 820, drive: "fwd", bite: 540, drag: 620, radius: 280, peak: 98, peakRpm: 3200, redline: 6000, low: 700, tail: 640, turbo: null, auto: false, gears: [3545, 1904, 1233, 885], final: 4058, value: 900 },
  { key: "custodian", name: "Harlan Custodian", tier: 0, year: 1986, blurb: "One owner, a retired teacher. Smells like it.", mass: 1250, drive: "fwd", bite: 550, drag: 720, radius: 300, peak: 180, peakRpm: 2800, redline: 5200, low: 800, tail: 560, turbo: null, auto: true, gears: [2840, 1600, 1000], final: 3020, value: 1100 },
  { key: "estate", name: "Wexford Estate", tier: 0, year: 1983, blurb: "Wood on the sides, most of it. Seats eight.", mass: 1500, drive: "rwd", bite: 550, drag: 760, radius: 315, peak: 200, peakRpm: 2600, redline: 5200, low: 820, tail: 580, turbo: null, auto: true, gears: [2740, 1570, 1000], final: 2730, value: 1300 },
  { key: "mule", name: "Tobiko Mule", tier: 0, year: 1987, blurb: "Mini pickup. Nothing in the bed, and it shows off the line.", mass: 1150, drive: "rwd", bite: 470, drag: 800, radius: 320, peak: 150, peakRpm: 3000, redline: 5500, low: 760, tail: 620, turbo: null, auto: false, gears: [3670, 2100, 1360, 1000], final: 3900, value: 1200 },
  { key: "caravel", name: "Harlan Caravel", tier: 0, year: 1989, blurb: "Minivan. One sliding door works. V6, somehow.", mass: 1600, drive: "fwd", bite: 560, drag: 950, radius: 315, peak: 230, peakRpm: 2800, redline: 5600, low: 800, tail: 620, turbo: null, auto: true, gears: [2800, 1550, 1000, 690], final: 3620, value: 1500 },
  { key: "wasp", name: "Bexley Wasp 16V", tier: 1, year: 1990, blurb: "The Sparrow's angry cousin. Wants to be revved.", mass: 950, drive: "fwd", bite: 550, drag: 600, radius: 290, peak: 165, peakRpm: 4600, redline: 7000, low: 620, tail: 780, turbo: null, auto: false, gears: [3450, 1940, 1290, 970, 800], final: 4250, value: 4500 },
  { key: "brumby", name: "Calder Brumby V8", tier: 1, year: 1988, blurb: "Five litres. Clutch is new because the last one left.", mass: 1400, drive: "rwd", bite: 630, drag: 640, radius: 320, peak: 400, peakRpm: 3200, redline: 5800, low: 820, tail: 640, turbo: null, auto: false, gears: [3350, 1930, 1290, 1000, 680], final: 3080, value: 6500 },
  { key: "kite", name: "Tobiko Kite", tier: 1, year: 1990, blurb: "Two seats, no roof, no weight.", mass: 960, drive: "rwd", bite: 610, drag: 580, radius: 290, peak: 135, peakRpm: 5000, redline: 7200, low: 640, tail: 800, turbo: null, auto: false, gears: [3136, 1888, 1330, 1000, 814], final: 4300, value: 5200 },
  { key: "brick", name: "Nordby Brick Turbo", tier: 1, year: 1987, blurb: "Square, sensible, and boosted. Nobody ever sees it coming.", mass: 1350, drive: "rwd", bite: 600, drag: 700, radius: 315, peak: 255, peakRpm: 3000, redline: 6000, low: 700, tail: 620, turbo: { off: 620, spool: 2400, rate: 22 }, auto: false, gears: [4030, 2160, 1370, 1000], final: 3730, value: 4800 },
  { key: "umbra", name: "Kagami Umbra AWD Turbo", tier: 2, year: 1990, blurb: "Two litres, a turbo and all four wheels. It leaves like nothing else.", mass: 1245, drive: "awd", bite: 950, drag: 590, radius: 305, peak: 275, peakRpm: 3000, redline: 7000, low: 680, tail: 700, turbo: { off: 600, spool: 2600, rate: 26 }, auto: false, gears: [3083, 1684, 1115, 833, 666], final: 4929, value: 14000 },
  { key: "cyclone", name: "Tobiko Cyclone Twin Rotor", tier: 2, year: 1992, blurb: "No pistons. Revs to eight thousand and sounds like a chainsaw choir.", mass: 1280, drive: "rwd", bite: 640, drag: 560, radius: 315, peak: 294, peakRpm: 5000, redline: 8000, low: 560, tail: 820, turbo: { off: 640, spool: 3000, rate: 30 }, auto: false, gears: [3483, 2015, 1391, 1000, 719], final: 4100, value: 21000 },
  { key: "zenith", name: "Sora Zenith Twin Turbo", tier: 2, year: 1993, blurb: "Three litres, two turbos, six gears. The one on the poster.", mass: 1560, drive: "rwd", bite: 650, drag: 600, radius: 325, peak: 427, peakRpm: 4000, redline: 7000, low: 720, tail: 760, turbo: { off: 620, spool: 2600, rate: 24 }, auto: false, gears: [3827, 2360, 1685, 1312, 1000, 793], final: 3133, value: 26000 },
];

// ---- Parts ---------------------------------------------------------------------------------------

export const PART_SLOTS = ["intake", "exhaust", "cam", "boost", "tyres", "weight", "trans"] as const;
export type PartSlot = (typeof PART_SLOTS)[number];

export interface PartInfo {
  slot: PartSlot;
  label: string;
  /** What each level is called, from level 1. Level 0 is whatever the car came with. */
  levels: string[];
  /** What each level costs on a shitbox, in dollars. A sleeper pays twice that and the top cars three times. */
  costs: number[];
  hint: string;
}

export const PARTS: Record<PartSlot, PartInfo> = {
  intake: { slot: "intake", label: "Intake", levels: ["Open filter", "Bigger carb or throttle body", "Ported manifold"], costs: [120, 260, 480], hint: "More air: 3% more torque a level" },
  exhaust: { slot: "exhaust", label: "Exhaust", levels: ["Cherry bomb", "Headers", "Full straight-through"], costs: [150, 320, 600], hint: "3%, 6%, then 10% more torque. Louder every time" },
  cam: { slot: "cam", label: "Cam", levels: ["Mild", "Hot", "Race"], costs: [220, 480, 900], hint: "More torque higher up and a higher redline, for less at the bottom" },
  boost: { slot: "boost", label: "Boost", levels: ["Bleed valve", "Bigger turbo", "Too much turbo"], costs: [300, 700, 1400], hint: "Turbo cars only. A lot more torque, later, and it spools slower" },
  tyres: { slot: "tyres", label: "Tyres", levels: ["Sport", "Drag radials", "Slicks"], costs: [160, 380, 720], hint: "Grip off the line: 10%, 22%, then 38% more" },
  weight: { slot: "weight", label: "Weight", levels: ["Back seat out", "Gutted", "Lexan and a prayer"], costs: [90, 240, 500], hint: "4% lighter a level" },
  trans: { slot: "trans", label: "Gearbox", levels: ["Manual swap or short shifter", "Close-ratio race box"], costs: [350, 900], hint: "Faster shifts. Turns an automatic into a manual" },
};

const maxLevel = (slot: PartSlot) => PARTS[slot].levels.length;

const TORQUE_GAIN: Record<"intake" | "exhaust" | "cam" | "boost", number[]> = {
  intake: [0, 30, 60, 90],
  exhaust: [0, 30, 60, 100],
  cam: [0, 50, 90, 140],
  boost: [0, 100, 200, 320],
};
const CAM_PEAK = [0, 300, 600, 900];
const CAM_REDLINE = [0, 300, 600, 800];
const CAM_LOW = [0, 40, 80, 120];
const BOOST_SPOOL = [0, 200, 400, 600];
const BOOST_RATE = [0, 3, 6, 9];
const TYRE_GRIP = [1000, 1100, 1220, 1380];
const MASS_KEPT = [1000, 960, 920, 880];
/** Ticks a shift takes: an automatic, then a manual at each gearbox level. */
const AUTO_SHIFT = 28;
const MANUAL_SHIFT = [18, 14, 9];
/** The final drive can be set one step taller or shorter than stock: thousandths of the stock ratio. */
const FINAL_STEPS = [900, 1000, 1100];
const DRIVER = 75;
const BASE_GRIP = 1000;

/** What a part level costs on this model. */
export function partCost(model: number, slot: PartSlot, level: number): number {
  const m = CAR_MODELS[model];
  const cost = PARTS[slot].costs[level - 1];
  return m && cost ? cost * (m.tier + 1) : 0;
}

/** Whether a part can go on a model at all: boost needs a turbo to turn up. */
export const partFits = (model: number, slot: PartSlot) => slot !== "boost" || !!CAR_MODELS[model]?.turbo;

// ---- A build -------------------------------------------------------------------------------------

/**
 * A car as it comes to the line: `[model, intake, exhaust, cam, boost, tyres, weight, trans, final,
 * engine, rubber]`. The parts are levels from 0 (stock). `final` is 0, 1 or 2: a taller final
 * drive, stock, or a shorter one. `engine` and `rubber` are how good the engine and the tyres
 * are, in thousandths: 1000 is new, and an engine at 0 is blown.
 */
export type Build = number[];
export const BUILD_LENGTH = 11;
const B = { model: 0, intake: 1, exhaust: 2, cam: 3, boost: 4, tyres: 5, weight: 6, trans: 7, final: 8, engine: 9, rubber: 10 } as const;

/** A stock car of a model, as good as new unless said otherwise. */
export function stockBuild(model: number, engine = 1000, rubber = 1000): Build {
  return safeBuild([model, 0, 0, 0, 0, 0, 0, 0, 1, engine, rubber]);
}

const clamp = (n: number, low: number, high: number) => (n < low ? low : n > high ? high : n);
const whole = (n: unknown) => (typeof n === "number" && Number.isFinite(n) ? Math.trunc(n) + 0 : 0);

/** A build from outside, made safe: whatever is given, what comes back is a car that exists. */
export function safeBuild(given: unknown): Build {
  const g = Array.isArray(given) ? given : [];
  const model = clamp(whole(g[B.model]), 0, CAR_MODELS.length - 1);
  const level = (slot: PartSlot, i: number) => (partFits(model, slot) ? clamp(whole(g[i]), 0, maxLevel(slot)) : 0);
  return [
    model,
    level("intake", B.intake),
    level("exhaust", B.exhaust),
    level("cam", B.cam),
    level("boost", B.boost),
    level("tyres", B.tyres),
    level("weight", B.weight),
    level("trans", B.trans),
    g[B.final] === undefined ? 1 : clamp(whole(g[B.final]), 0, 2),
    g[B.engine] === undefined ? 1000 : clamp(whole(g[B.engine]), 0, 1000),
    g[B.rubber] === undefined ? 1000 : clamp(whole(g[B.rubber]), 0, 1000),
  ];
}

/** What a build is, worked out: everything the drivetrain needs to move it. */
export interface CarSpec {
  model: number;
  name: string;
  tier: CarTier;
  /** With the driver in it. */
  mass: number;
  drive: Drive;
  peak: number;
  peakRpm: number;
  redline: number;
  low: number;
  tail: number;
  turbo: { off: number; spool: number; rate: number } | null;
  auto: boolean;
  gears: number[];
  final: number;
  shiftTicks: number;
  /** The tyre's way round, in tenths of a millimetre. */
  circumference: number;
  radius: number;
  /** The most the driven tyres can put down on a prepared strip, in newtons. */
  traction: number;
  drag: number;
  /** Newtons lost to rolling, always. */
  rolling: number;
  /** Thousandths of the drivetrain's torque that reach the road. */
  efficiency: number;
  /** How much over-revving it takes to blow the engine. */
  blowAt: number;
}

export function specOf(given: unknown): CarSpec {
  const b = safeBuild(given);
  const m = CAR_MODELS[b[B.model]!]!;
  const cam = b[B.cam]!;
  const boost = b[B.boost]!;
  const engine = b[B.engine]!;
  const gain = 1000 + TORQUE_GAIN.intake[b[B.intake]!]! + TORQUE_GAIN.exhaust[b[B.exhaust]!]! + TORQUE_GAIN.cam[cam]! + TORQUE_GAIN.boost[boost]!;
  // A tired engine makes less: 70% of what it should with nothing left in it.
  const health = 700 + Math.round((300 * engine) / 1000);
  const mass = Math.round((m.mass * MASS_KEPT[b[B.weight]!]!) / 1000) + DRIVER;
  const trans = b[B.trans]!;
  const auto = m.auto && trans === 0;
  const grip = Math.round((BASE_GRIP * TYRE_GRIP[b[B.tyres]!]! * (750 + Math.round((250 * b[B.rubber]!) / 1000))) / 1_000_000);
  return {
    model: b[B.model]!,
    name: m.name,
    tier: m.tier,
    mass,
    drive: m.drive,
    peak: engine === 0 ? 0 : Math.round((m.peak * gain * health) / 1_000_000),
    peakRpm: m.peakRpm + CAM_PEAK[cam]!,
    redline: m.redline + CAM_REDLINE[cam]!,
    low: m.low - CAM_LOW[cam]!,
    tail: m.tail,
    turbo: m.turbo ? { off: m.turbo.off - boost * 40, spool: m.turbo.spool + BOOST_SPOOL[boost]!, rate: m.turbo.rate - BOOST_RATE[boost]! } : null,
    auto,
    gears: m.gears,
    final: Math.round((m.final * FINAL_STEPS[b[B.final]!]!) / 1000),
    shiftTicks: auto ? AUTO_SHIFT : MANUAL_SHIFT[m.auto ? Math.max(0, trans - 1) : trans]!,
    circumference: Math.round((m.radius * 2 * 355 * 10) / 113),
    radius: m.radius,
    traction: Math.round((((mass * 981) / 100) * m.bite * grip) / 1_000_000),
    drag: m.drag,
    rolling: Math.round((mass * 981 * 15) / 100_000),
    efficiency: m.drive === "awd" ? 800 : 850,
    // A boosted engine and a tired one both let go sooner.
    blowAt: Math.max(60, 120 + Math.round((120 * engine) / 1000) - boost * 20),
  };
}

/** Torque at full throttle and full boost, in newton metres. */
export function torqueAt(spec: CarSpec, rpm: number): number {
  let share: number;
  if (rpm <= 1000) share = spec.low;
  else if (rpm <= spec.peakRpm) share = spec.low + Math.round(((1000 - spec.low) * (rpm - 1000)) / (spec.peakRpm - 1000));
  else if (rpm <= spec.redline) share = 1000 - Math.round(((1000 - spec.tail) * (rpm - spec.peakRpm)) / (spec.redline - spec.peakRpm));
  else share = Math.max(300, spec.tail - Math.round(((spec.tail - 300) * (rpm - spec.redline)) / OVER_REV));
  return Math.round((spec.peak * share) / 1000);
}

/** Peak horsepower, for a spec sheet. */
export function horsepower(spec: CarSpec): number {
  let best = 0;
  for (let rpm = 1000; rpm <= spec.redline; rpm += 100) best = Math.max(best, Math.round((torqueAt(spec, rpm) * rpm) / 7121));
  return best;
}

// ---- The drivetrain ------------------------------------------------------------------------------

/** A car on the move. Plain whole numbers: it lives in a race's state. */
export interface CarMotion {
  /** Tenths of a millimetre from the line. */
  dist: number;
  /** Tenths of a millimetre a second. */
  speed: number;
  rpm: number;
  /** 0 is neutral. */
  gear: number;
  /** Ticks left of a shift, and the gear it ends in. */
  shifting: number;
  toGear: number;
  /** How far the turbo has spooled, in thousandths. */
  boost: number;
  /** Over-revving builds heat; enough of it and the engine lets go. */
  heat: number;
  blown: boolean;
  /** The tyres are spinning this tick. */
  spin: boolean;
  /** Ticks spent over the redline, and ticks spent spinning, for what the run cost the car. */
  strain: number;
  smoke: number;
}

export const restingCar = (spec: CarSpec): CarMotion => ({ dist: 0, speed: 0, rpm: IDLE_RPM, gear: 0, shifting: 0, toGear: 0, boost: 0, heat: 0, blown: spec.peak === 0, spin: false, strain: 0, smoke: 0 });

/** What the engine would turn at this speed in this gear. */
export function roadRpm(spec: CarSpec, speed: number, gear: number): number {
  const ratio = spec.gears[gear - 1];
  if (!ratio) return 0;
  return Math.round((((speed * 60) / spec.circumference) * ratio * spec.final) / 1_000_000);
}

/** The push at the tyres from full throttle at these revs in this gear, in newtons, before grip is asked. */
export function pushAt(spec: CarSpec, rpm: number, gear: number, boost = 1000): number {
  const ratio = spec.gears[gear - 1];
  if (!ratio) return 0;
  const onBoost = spec.turbo ? spec.turbo.off + Math.round(((1000 - spec.turbo.off) * boost) / 1000) : 1000;
  const torque = Math.round((torqueAt(spec, rpm) * onBoost) / 1000);
  return Math.round((((torque * ratio) / 1000) * spec.final * spec.efficiency) / (spec.radius * 1000));
}

/** The revs the engine settles at in neutral with this much throttle. */
export const freeRev = (spec: CarSpec, gas: number) => IDLE_RPM + Math.round((gas * (spec.redline + OVER_REV - IDLE_RPM)) / 100);

/** What happened in a tick, for sounds and smoke. */
export interface DriveNews {
  shifted?: number;
  spun?: boolean;
  blew?: boolean;
}

/**
 * One tick of one car. `gas` is 0 to 100; `want` is the gear the driver has asked for (in an
 * automatic, anything above neutral means drive); `track` is how good the surface is, in
 * thousandths of a prepared strip. **Changes the car.**
 */
export function driveCar(spec: CarSpec, car: CarMotion, gas: number, want: number, track: number): DriveNews {
  const news: DriveNews = {};
  const top = spec.gears.length;
  const wasSpinning = car.spin;
  car.spin = false;
  if (car.blown) gas = 0;

  // The gearbox.
  if (car.shifting > 0) {
    if (--car.shifting === 0) {
      car.gear = car.toGear;
      car.rpm = Math.max(IDLE_RPM, roadRpm(spec, car.speed, car.gear));
      news.shifted = car.gear;
    }
  } else if (spec.auto) {
    if (want <= 0) car.gear = 0;
    else if (car.gear === 0) car.gear = 1;
    else if (car.gear < top && car.rpm >= spec.redline - 300) {
      car.shifting = spec.shiftTicks;
      car.toGear = car.gear + 1;
    }
  } else {
    const to = clamp(want, 0, top);
    if (to !== car.gear) {
      // Out of gear, or away from a standstill, is at once. A change on the move takes time.
      if (to === 0 || car.gear === 0) car.gear = to;
      else {
        car.shifting = spec.shiftTicks;
        car.toGear = to;
      }
    }
  }

  const driving = car.gear > 0 && car.shifting === 0;
  let push = 0;
  if (!driving) {
    // Nothing connected: the engine goes where the throttle sends it.
    const target = car.blown ? 0 : car.shifting > 0 ? Math.max(IDLE_RPM, car.rpm - 60) : freeRev(spec, gas);
    car.rpm = car.rpm < target ? Math.min(target, car.rpm + 250) : Math.max(target, car.rpm - 150);
  } else {
    const road = roadRpm(spec, car.speed, car.gear);
    if (car.rpm < road) car.rpm = road;
    push = Math.round((pushAt(spec, car.rpm, car.gear, car.boost) * gas) / 100);
    const grip = Math.round((spec.traction * track) / 1000);
    if (push > grip) {
      // More than the tyres will take: they spin, less gets through, and the revs climb.
      car.spin = true;
      car.smoke++;
      push = Math.round((grip * SPIN_KEEPS) / 1000);
      car.rpm = Math.min(spec.redline + OVER_REV, car.rpm + 45);
      if (!wasSpinning) news.spun = true;
    } else if (car.rpm > road) car.rpm = Math.max(road, IDLE_RPM, car.rpm - CLUTCH_SLIP);
    else car.rpm = Math.max(road, IDLE_RPM);
    // An engine that is not pulling holds the car back, and one that has let go holds it hard.
    if (car.blown) push = -spec.mass * 3;
    else if (gas === 0) push = -Math.round(spec.mass / 2);
  }

  // The turbo spools with the throttle down and enough revs, and sighs when it comes up.
  if (spec.turbo) {
    if (driving && gas >= 70 && car.rpm >= spec.turbo.spool) car.boost = Math.min(1000, car.boost + spec.turbo.rate);
    else car.boost = Math.max(0, car.boost - (car.shifting > 0 ? 12 : 40));
  }

  // Past the redline it gets hot, and hot enough is the end of it.
  if (!car.blown) {
    if (car.rpm > spec.redline) {
      car.heat += 1 + Math.floor((car.rpm - spec.redline) / 250);
      car.strain++;
      if (car.heat >= spec.blowAt) {
        car.blown = true;
        news.blew = true;
      }
    } else if (car.heat > 0) car.heat--;
  }

  // The road pushes back.
  const air = Math.round((spec.drag * 6125 * Math.round((car.speed * car.speed) / 1_000_000)) / 1_000_000_000);
  const net = push - air - (car.speed > 0 ? spec.rolling : 0);
  car.speed = Math.max(0, car.speed + Math.round((net * 10_000) / (spec.mass * PINKSLIPS_RATE)));
  car.dist += Math.round(car.speed / PINKSLIPS_RATE);
  return news;
}

// ---- A driver that knows the car ------------------------------------------------------------------

/** The revs to leave at: as much push as the tyres will take, and no more. */
export function launchRpm(spec: CarSpec, track = 1000): number {
  const grip = Math.round((spec.traction * track) / 1000);
  const off = spec.turbo ? 0 : 1000;
  let best = 1500;
  for (let rpm = 1500; rpm <= spec.redline - 400; rpm += 100) if (pushAt(spec, rpm, 1, off) <= grip) best = rpm;
  return best;
}

/**
 * How a driver who knows the car would hold the controls this tick, once the light is green:
 * flat out unless that would spin the tyres, and into the next gear just short of the redline.
 * The computer players start from this, and so does `timeslip`.
 */
export function wellDriven(spec: CarSpec, car: CarMotion, track = 1000, shiftEarly = 150): { gas: number; gear: number } {
  if (car.shifting > 0) return { gas: 100, gear: car.toGear };
  const gear = Math.max(1, car.gear);
  if (spec.auto) return { gas: 100, gear: 1 };
  const full = pushAt(spec, car.rpm, gear, car.boost);
  const grip = Math.round((spec.traction * track) / 1000);
  const gas = full > grip ? clamp(Math.floor((grip * 100) / full), 30, 100) : 100;
  const up = gear < spec.gears.length && car.rpm >= spec.redline - shiftEarly;
  return { gas, gear: up ? gear + 1 : gear };
}

/** A run on paper. */
export interface Timeslip {
  /** Seconds to the line, in thousandths: from when the car first moves, as a strip times it. */
  et: number;
  /** Miles an hour at the line. */
  mph: number;
  /** Thousandths of a second to sixty feet: how well it leaves. */
  sixty: number;
  finished: boolean;
}

export const QUARTER_MILE = 4_023_360;
export const EIGHTH_MILE = 2_011_680;
export const toMph = (speed: number) => Math.round((speed * 3600) / 16_093_440);

/** What a build runs when it is driven well: the garage's test and tune. */
export function timeslip(build: unknown, distance = QUARTER_MILE, track = 1000): Timeslip {
  const spec = specOf(build);
  const car = restingCar(spec);
  const leave = launchRpm(spec, track);
  car.rpm = spec.auto ? IDLE_RPM : leave;
  let sixty = 0;
  for (let tick = 1; tick <= PINKSLIPS_RATE * 60; tick++) {
    const hold = wellDriven(spec, car, track);
    const before = car.dist;
    driveCar(spec, car, hold.gas, hold.gear, track);
    if (!sixty && car.dist >= 182_880) sixty = Math.round((tick * 1000) / PINKSLIPS_RATE);
    if (car.dist >= distance) {
      const over = car.dist - distance;
      const et = Math.round((tick * 1000) / PINKSLIPS_RATE) - (car.dist > before ? Math.round((over * 1000) / PINKSLIPS_RATE / (car.dist - before)) : 0);
      return { et, mph: toMph(car.speed), sixty, finished: true };
    }
    if (car.blown && car.speed === 0) break;
  }
  return { et: 0, mph: toMph(car.speed), sixty, finished: false };
}
