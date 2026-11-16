// Pink Slips, the garage: the money, the cars you own, the classifieds, and the wrenching. A
// garage is one player's, plain data with whole numbers, and it knows nothing of anyone else's.
//
// The loop it is for: buy something tired out of the classifieds, fix what is worn, bolt on what
// you can afford, take it to the line (`buildOf(car)` is what the race wants), and bring back
// what the run did to it (`afterRace`). Money and cars that change hands between players, a wager
// or a pink slip, go through `settleUp`, `takeCar` and `giveCar`: whoever runs the game joins two
// garages up, the way they join the stores in Delbie's Parts Network.
//
// Like every engine here it has no clock and no `Math.random`. The classifieds change when it is
// told a new day has come (`newDay`), and what is in them comes from the garage's own seed.
import { CAR_MODELS, CAR_TIERS, PARTS, PART_SLOTS, horsepower, partCost, partFits, safeBuild, specOf, timeslip, type Build, type PartSlot } from "./pinkslipscars.js";
import { nextRandom } from "./table.js";

export const GARAGE_VERSION = 1;
/** What a new garage has in the tin. Enough for a shitbox and a part or two. */
export const GARAGE_STAKE = 1200;
/** How many cars fit. */
export const GARAGE_BAYS = 6;
const LISTINGS = 6;
const CEILING = 9_000_000_000_000;

export interface OwnedCar {
  id: number;
  model: number;
  /** A level for each part, from 0 (stock). */
  parts: Record<PartSlot, number>;
  /** 0, 1 or 2: a taller final drive, stock, or a shorter one. */
  final: number;
  /** How good the engine and the tyres are, in thousandths. An engine at 0 is blown. */
  engine: number;
  rubber: number;
  /** What its owner calls it. */
  name: string;
  races: number;
  wins: number;
}

export interface Listing {
  id: number;
  model: number;
  engine: number;
  rubber: number;
  price: number;
  /** The seller's line. */
  pitch: string;
}

export interface GarageState {
  v: number;
  rng: number;
  cash: number;
  /** The last day the classifieds changed. */
  day: number;
  cars: OwnedCar[];
  listings: Listing[];
  nextId: number;
  races: number;
  wins: number;
  /** Cars won and lost on a pink slip. */
  slipsWon: number;
  slipsLost: number;
}

export type GarageCommand =
  | { cmd: "buy"; listing: number }
  | { cmd: "sell"; car: number }
  | { cmd: "fit"; car: number; slot: PartSlot; level: number }
  | { cmd: "engine"; car: number }
  | { cmd: "tyres"; car: number }
  | { cmd: "final"; car: number; final: number }
  | { cmd: "name"; car: number; name: string };

export interface GarageAnswer {
  ok: boolean;
  message: string;
}

const clamp = (n: number, low: number, high: number) => (n < low ? low : n > high ? high : n);
const whole = (n: unknown) => (typeof n === "number" && Number.isFinite(n) ? Math.trunc(n) + 0 : 0);
const noParts = (): Record<PartSlot, number> => ({ intake: 0, exhaust: 0, cam: 0, boost: 0, tyres: 0, weight: 0, trans: 0 });
const dollars = (n: number) => `$${n.toLocaleString("en-US")}`;

/** The car as the race wants it. */
export function buildOf(car: OwnedCar): Build {
  return safeBuild([car.model, car.parts.intake, car.parts.exhaust, car.parts.cam, car.parts.boost, car.parts.tyres, car.parts.weight, car.parts.trans, car.final, car.engine, car.rubber]);
}

/** What a rebuild costs: a quarter of what the model is worth for an engine with nothing left, and less for less. */
export function engineCost(car: Pick<OwnedCar, "model" | "engine">): number {
  const value = CAR_MODELS[car.model]?.value ?? 0;
  return car.engine >= 1000 ? 0 : Math.max(40, Math.round((value * (1000 - car.engine)) / 4000));
}
/** A set of tyres like the ones on it. */
export function tyresCost(car: Pick<OwnedCar, "model" | "rubber" | "parts">): number {
  if (car.rubber >= 1000) return 0;
  const tier = CAR_MODELS[car.model]?.tier ?? 0;
  return Math.round(((80 + car.parts.tyres * 90) * (tier + 1) * (1000 - car.rubber)) / 1000) + 20;
}

/** What a car would fetch: the model, worn down, plus half of what was spent on parts. */
export function carValue(car: Pick<OwnedCar, "model" | "engine" | "rubber" | "parts">): number {
  const model = CAR_MODELS[car.model];
  if (!model) return 0;
  // An engine is 45% of a car, the tyres 5%, and the rest is the rest.
  const shell = Math.round((model.value * (500 + Math.round((450 * car.engine) / 1000) + Math.round((50 * car.rubber) / 1000))) / 1000);
  let parts = 0;
  for (const slot of PART_SLOTS) for (let level = 1; level <= car.parts[slot]; level++) parts += partCost(car.model, slot, level);
  return shell + Math.floor(parts / 2);
}

const PITCHES = ["Ran when parked.", "Needs nothing. Needs a few things.", "My loss, your gain.", "No lowballers. I know what I have.", "Wife says it goes.", "Runs and drives. Mostly drives.", "Selling for a friend.", "Was my grandmother's.", "Fast. Ask anybody.", "Just needs a battery."];

function makeListing(g: GarageState): Listing {
  const rand = nextRandom(g);
  const roll = Math.floor(rand() * 100);
  // Seven in ten are shitboxes, and four in a hundred are one of the cars everybody wants.
  const tier = roll < 70 ? 0 : roll < 96 ? 1 : 2;
  const pool = CAR_MODELS.map((m, i) => ({ m, i })).filter((e) => e.m.tier === tier);
  const model = pool[Math.floor(rand() * pool.length)]!.i;
  // The good ones never turn up clean: somebody blew it up, and that is why it is for sale.
  const engine = tier === 2 ? Math.floor(rand() * 26) * 10 : 350 + Math.floor(rand() * 56) * 10;
  const rubber = 200 + Math.floor(rand() * 71) * 10;
  // Sellers ask between 90% and 120% of what it is worth.
  const asked = Math.round((carValue({ model, engine, rubber, parts: noParts() }) * (90 + Math.floor(rand() * 31))) / 100);
  const pitch = tier === 2 && engine < 100 ? "Engine's in the trunk. All there, I think." : PITCHES[Math.floor(rand() * PITCHES.length)]!;
  return { id: g.nextId++, model, engine, rubber, price: Math.max(50, Math.round(asked / 10) * 10), pitch };
}

function fillListings(g: GarageState) {
  g.listings = [];
  for (let i = 0; i < LISTINGS; i++) g.listings.push(makeListing(g));
  // Nobody is ever stuck: there is always something the stake would have bought.
  if (!g.listings.some((l) => CAR_MODELS[l.model]!.tier === 0 && l.price <= GARAGE_STAKE - 300)) {
    const cheap = makeListing(g);
    cheap.model = 0;
    cheap.engine = 600;
    cheap.rubber = 500;
    cheap.price = Math.round(carValue({ model: 0, engine: 600, rubber: 500, parts: noParts() }) / 10) * 10;
    cheap.pitch = PITCHES[0]!;
    g.listings[LISTINGS - 1] = cheap;
  }
}

/** A new garage: the stake, no cars, and today's classifieds. */
export function newGarage(seed: number, day = 0): GarageState {
  const g: GarageState = { v: GARAGE_VERSION, rng: seed >>> 0, cash: GARAGE_STAKE, day: whole(day), cars: [], listings: [], nextId: 1, races: 0, wins: 0, slipsWon: 0, slipsLost: 0 };
  fillListings(g);
  return g;
}

/** Tell the garage what day it is. A later day than it knew brings new classifieds. **Changes the garage.** */
export function newDay(g: GarageState, day: number): boolean {
  const d = whole(day);
  if (d <= g.day) return false;
  g.day = d;
  fillListings(g);
  return true;
}

const find = (g: GarageState, id: number) => g.cars.find((c) => c.id === id);
const no = (message: string): GarageAnswer => ({ ok: false, message });
const yes = (message: string): GarageAnswer => ({ ok: true, message });

/** Carry a command out, or say why not. **Changes the garage.** */
export function garageAct(g: GarageState, given: unknown): GarageAnswer {
  const c = (given && typeof given === "object" ? given : {}) as Record<string, unknown>;
  switch (c.cmd) {
    case "buy": {
      const at = g.listings.findIndex((l) => l.id === whole(c.listing));
      const listing = g.listings[at];
      if (!listing) return no("That one's gone.");
      if (g.cars.length >= GARAGE_BAYS) return no("No room. Sell something first.");
      if (g.cash < listing.price) return no(`You're ${dollars(listing.price - g.cash)} short.`);
      g.cash -= listing.price;
      g.listings.splice(at, 1);
      const model = CAR_MODELS[listing.model]!;
      g.cars.push({ id: g.nextId++, model: listing.model, parts: noParts(), final: 1, engine: listing.engine, rubber: listing.rubber, name: model.name, races: 0, wins: 0 });
      return yes(`The ${model.name} is yours.`);
    }
    case "sell": {
      const car = find(g, whole(c.car));
      if (!car) return no("You don't own that.");
      // A dealer gives four fifths of what it is worth.
      const price = Math.floor((carValue(car) * 4) / 5);
      g.cash = Math.min(CEILING, g.cash + price);
      g.cars = g.cars.filter((x) => x !== car);
      return yes(`Sold for ${dollars(price)}.`);
    }
    case "fit": {
      const car = find(g, whole(c.car));
      if (!car) return no("You don't own that.");
      const slot = c.slot as PartSlot;
      if (!PART_SLOTS.includes(slot)) return no("There's no such part.");
      if (!partFits(car.model, slot)) return no("That needs a turbo to bolt on to.");
      const level = whole(c.level);
      if (level <= car.parts[slot] || level > PARTS[slot].levels.length) return no("That wouldn't be an upgrade.");
      // Skipping a level still pays for the ones in between: they don't give those away.
      let cost = 0;
      for (let l = car.parts[slot] + 1; l <= level; l++) cost += partCost(car.model, slot, l);
      if (g.cash < cost) return no(`You're ${dollars(cost - g.cash)} short.`);
      g.cash -= cost;
      car.parts[slot] = level;
      // New tyres are new tyres.
      if (slot === "tyres") car.rubber = 1000;
      return yes(`${PARTS[slot].levels[level - 1]} fitted.`);
    }
    case "engine": {
      const car = find(g, whole(c.car));
      if (!car) return no("You don't own that.");
      const cost = engineCost(car);
      if (!cost) return no("There's nothing wrong with it.");
      if (g.cash < cost) return no(`A rebuild is ${dollars(cost)}. You're ${dollars(cost - g.cash)} short.`);
      g.cash -= cost;
      car.engine = 1000;
      return yes("Rebuilt. Good as new.");
    }
    case "tyres": {
      const car = find(g, whole(c.car));
      if (!car) return no("You don't own that.");
      const cost = tyresCost(car);
      if (!cost) return no("They're new.");
      if (g.cash < cost) return no(`You're ${dollars(cost - g.cash)} short.`);
      g.cash -= cost;
      car.rubber = 1000;
      return yes("New rubber all round.");
    }
    case "final": {
      const car = find(g, whole(c.car));
      if (!car) return no("You don't own that.");
      car.final = clamp(whole(c.final), 0, 2);
      return yes(["Taller gears: slower off the line, more at the top.", "Back to the stock final drive.", "Shorter gears: harder off the line, runs out sooner."][car.final]!);
    }
    case "name": {
      const car = find(g, whole(c.car));
      if (!car) return no("You don't own that.");
      const name = typeof c.name === "string" ? c.name.replace(/\s+/g, " ").trim().slice(0, 28) : "";
      car.name = name || CAR_MODELS[car.model]!.name;
      return yes(`She's called ${car.name}.`);
    }
    default:
      return no("The garage doesn't know how to do that.");
  }
}

/** What a run did to a car: what `pinkSlipsResults` says of a seat. */
export interface RaceToll {
  won: boolean;
  blown: boolean;
  /** Thousandths the engine and the tyres are worse by. */
  engineWear: number;
  rubberWear: number;
}

/** Bring a car back from a race. **Changes the garage.** */
export function afterRace(g: GarageState, carId: number, toll: RaceToll): boolean {
  const car = find(g, carId);
  if (!car) return false;
  car.races++;
  g.races++;
  if (toll.won) {
    car.wins++;
    g.wins++;
  }
  car.engine = toll.blown ? 0 : clamp(car.engine - Math.max(0, whole(toll.engineWear)), 1, 1000);
  car.rubber = clamp(car.rubber - Math.max(0, whole(toll.rubberWear)), 0, 1000);
  return true;
}

/** Money in or out: a purse, a wager, a tow. It never goes below nothing. **Changes the garage.** */
export function settleUp(g: GarageState, amount: number): number {
  g.cash = clamp(g.cash + whole(amount), 0, CEILING);
  return g.cash;
}

/** A pink slip lost: the car leaves, and is handed back for whoever won it. **Changes the garage.** */
export function takeCar(g: GarageState, carId: number): OwnedCar | null {
  const car = find(g, carId);
  if (!car) return null;
  g.cars = g.cars.filter((c) => c !== car);
  g.slipsLost++;
  return car;
}

/** A pink slip won: the car arrives as it left the other garage, parts and wear and all. There is always room for one you won. **Changes the garage.** */
export function giveCar(g: GarageState, given: unknown): OwnedCar | null {
  const car = loadCar(given);
  if (!car) return null;
  car.id = g.nextId++;
  g.cars.push(car);
  g.slipsWon++;
  return car;
}

function loadCar(given: unknown): OwnedCar | null {
  if (!given || typeof given !== "object") return null;
  const c = given as Record<string, unknown>;
  const model = whole(c.model);
  if (!CAR_MODELS[model] || c.model !== model) return null;
  const p = (c.parts && typeof c.parts === "object" ? c.parts : {}) as Record<string, unknown>;
  const parts = noParts();
  for (const slot of PART_SLOTS) parts[slot] = partFits(model, slot) ? clamp(whole(p[slot]), 0, PARTS[slot].levels.length) : 0;
  const name = typeof c.name === "string" && c.name.trim() ? c.name.trim().slice(0, 28) : CAR_MODELS[model]!.name;
  return { id: Math.max(0, whole(c.id)), model, parts, final: clamp(c.final === undefined ? 1 : whole(c.final), 0, 2), engine: clamp(whole(c.engine), 0, 1000), rubber: clamp(whole(c.rubber), 0, 1000), name, races: Math.max(0, whole(c.races)), wins: Math.max(0, whole(c.wins)) };
}

/** A garage from storage, checked piece by piece: null when it is not one. */
export function loadGarage(saved: unknown): GarageState | null {
  if (!saved || typeof saved !== "object") return null;
  const s = saved as Record<string, unknown>;
  if (s.v !== GARAGE_VERSION || !Array.isArray(s.cars) || !Array.isArray(s.listings)) return null;
  const cars: OwnedCar[] = [];
  for (const given of s.cars) {
    const car = loadCar(given);
    if (!car || cars.some((c) => c.id === car.id)) return null;
    cars.push(car);
  }
  const listings: Listing[] = [];
  for (const given of s.listings) {
    const l = (given && typeof given === "object" ? given : {}) as Record<string, unknown>;
    if (!CAR_MODELS[whole(l.model)] || whole(l.price) <= 0) return null;
    listings.push({ id: whole(l.id), model: whole(l.model), engine: clamp(whole(l.engine), 0, 1000), rubber: clamp(whole(l.rubber), 0, 1000), price: whole(l.price), pitch: typeof l.pitch === "string" ? l.pitch.slice(0, 80) : "" });
  }
  const top = Math.max(0, ...cars.map((c) => c.id), ...listings.map((l) => l.id));
  const count = (n: unknown) => Math.max(0, whole(n));
  return { v: GARAGE_VERSION, rng: whole(s.rng) >>> 0, cash: clamp(whole(s.cash), 0, CEILING), day: whole(s.day), cars, listings, nextId: Math.max(top + 1, count(s.nextId)), races: count(s.races), wins: count(s.wins), slipsWon: count(s.slipsWon), slipsLost: count(s.slipsLost) };
}

// ---- What the player sees ------------------------------------------------------------------------

export interface CarSheet {
  model: string;
  tier: string;
  year: number;
  drive: string;
  gearbox: string;
  horsepower: number;
  /** Kilograms, with the driver in. */
  mass: number;
  /** What it would run over a quarter mile driven well, in thousandths of a second, and its speed at the line. Null when it would not get there. */
  quarter: { et: number; mph: number } | null;
}

/** A build's numbers, for a spec sheet or a classified. */
export function sheetOf(build: unknown): CarSheet {
  const spec = specOf(build);
  const model = CAR_MODELS[spec.model]!;
  const slip = timeslip(build);
  return {
    model: model.name,
    tier: CAR_TIERS[model.tier],
    year: model.year,
    drive: spec.drive === "awd" ? "All-wheel drive" : spec.drive === "fwd" ? "Front-wheel drive" : "Rear-wheel drive",
    gearbox: `${spec.gears.length}-speed ${spec.auto ? "automatic" : "manual"}`,
    horsepower: horsepower(spec),
    mass: spec.mass,
    quarter: slip.finished ? { et: slip.et, mph: slip.mph } : null,
  };
}

export interface GarageView {
  cash: number;
  day: number;
  bays: number;
  record: { races: number; wins: number; slipsWon: number; slipsLost: number };
  cars: {
    id: number;
    name: string;
    sheet: CarSheet;
    build: Build;
    engine: number;
    rubber: number;
    final: number;
    value: number;
    /** What the dealer would give. */
    sells: number;
    races: number;
    wins: number;
    /** Whether it will start: a blown engine needs rebuilding first. */
    runs: boolean;
    repairs: { engine: number; tyres: number };
    parts: { slot: PartSlot; label: string; hint: string; level: number; has: string; next: { level: number; label: string; cost: number; can: boolean } | null }[];
  }[];
  listings: { id: number; price: number; pitch: string; engine: number; rubber: number; sheet: CarSheet; can: boolean }[];
}

/** What the player sees. Does not change the garage. */
export function garageView(g: GarageState): GarageView {
  return {
    cash: g.cash,
    day: g.day,
    bays: GARAGE_BAYS,
    record: { races: g.races, wins: g.wins, slipsWon: g.slipsWon, slipsLost: g.slipsLost },
    cars: g.cars.map((car) => {
      const value = carValue(car);
      return {
        id: car.id,
        name: car.name,
        sheet: sheetOf(buildOf(car)),
        build: buildOf(car),
        engine: car.engine,
        rubber: car.rubber,
        final: car.final,
        value,
        sells: Math.floor((value * 4) / 5),
        races: car.races,
        wins: car.wins,
        runs: car.engine > 0,
        repairs: { engine: engineCost(car), tyres: tyresCost(car) },
        parts: PART_SLOTS.filter((slot) => partFits(car.model, slot)).map((slot) => {
          const level = car.parts[slot];
          const label = PARTS[slot].levels[level];
          const cost = partCost(car.model, slot, level + 1);
          return { slot, label: PARTS[slot].label, hint: PARTS[slot].hint, level, has: level ? PARTS[slot].levels[level - 1]! : "Stock", next: label ? { level: level + 1, label, cost, can: g.cash >= cost } : null };
        }),
      };
    }),
    listings: g.listings.map((l) => ({ id: l.id, price: l.price, pitch: l.pitch, engine: l.engine, rubber: l.rubber, sheet: sheetOf([l.model, 0, 0, 0, 0, 0, 0, 0, 1, l.engine, l.rubber]), can: g.cash >= l.price && g.cars.length < GARAGE_BAYS })),
  };
}
