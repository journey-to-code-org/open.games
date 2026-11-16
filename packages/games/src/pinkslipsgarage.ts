// Road to the Shootout, the garage: the money, the cars you own, the classifieds, and the wrenching. A
// garage is one player's, plain data with whole numbers, and it knows nothing of anyone else's.
//
// The loop it is for: buy something tired out of the classifieds, fix what is worn, bolt on what
// you can afford (with the tools to do it: a garage starts with none), take it to the line (`buildOf(car)` is what the race wants), and bring back
// what the run did to it (`afterRace`). Money and cars that change hands between players, a wager
// or a pink slip, go through `settleUp`, `takeCar` and `giveCar`: whoever runs the game joins two
// garages up, the way they join the stores in Delbie's Parts Network.
//
// Like every engine here it has no clock and no `Math.random`. The classifieds change when it is
// told a new day has come (`newDay`), and what is in them comes from the garage's own seed.
import { CAR_MODELS, CAR_TIERS, FUEL_MAX, PARTS, PART_SLOTS, horsepower, idealFuel, partCost, partFits, safeBuild, specOf, timeslip, type Build, type PartSlot } from "./pinkslipscars.js";
import { nextRandom } from "./table.js";

export const GARAGE_VERSION = 1;
/** What a new garage has in the tin. Enough for a shitbox and a part or two. */
export const GARAGE_STAKE = 1200;
/** How many cars fit. */
export const GARAGE_BAYS = 6;
const LISTINGS = 6;
/** A car this bent or worse is not going anywhere until it is straightened, and at a thousand it never is. */
export const UNDRIVABLE = 300;
export const TOTALED = 1000;

/** A garage starts with none of these, and a job needs its tool. */
export const TOOLS = {
  jack: { label: "Floor jack", cost: 60, hint: "Tyres do not come off without one" },
  wrenches: { label: "Wrench set", cost: 90, hint: "Parts, oil, plugs and rebuilds" },
  hammer: { label: "Body hammer", cost: 35, hint: "Beating out damage" },
} as const;
export type Tool = keyof typeof TOOLS;
const TOOL_NAMES = Object.keys(TOOLS) as Tool[];
/** A session on the dyno in Morgantown, and what a tuner charges to do it over a laptop instead. */
export const DYNO_COST = 180;
export const REMOTE_TUNE_COST = 70;
const OIL_CHANGE = 35;
const NEW_PLUGS = 24;
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
  /** How good the oil and the plugs are, in thousandths. */
  oil: number;
  plugs: number;
  /** Where the fuel is set, 0 to `FUEL_MAX`. Right is `idealFuel` for what is bolted on. */
  fuel: number;
  /** How bent it is, in thousandths: at `UNDRIVABLE` it stays home, and at `TOTALED` it is scrap. */
  body: number;
  /** What its owner calls it. */
  name: string;
  races: number;
  wins: number;
}

/** What a car comes apart into besides the parts bolted on to it, and how much of the car's worth each is when perfect, in thousandths. */
export const SALVAGE = {
  block: { label: "Engine", share: 300 },
  gearbox: { label: "Gearbox", share: 120 },
  panels: { label: "Body panels", share: 150 },
  interior: { label: "Interior", share: 70 },
  wheels: { label: "Wheels and tyres", share: 60 },
  glass: { label: "Glass", share: 40 },
} as const;
export type SalvageKind = keyof typeof SALVAGE;
export type PieceKind = PartSlot | SalvageKind;
const SALVAGE_KINDS = Object.keys(SALVAGE) as SalvageKind[];
/** Every kind of piece, in the order the market's rates are kept in. */
export const PIECE_KINDS: PieceKind[] = [...PART_SLOTS, ...SALVAGE_KINDS];
/** How many pieces fit on the shelf. */
export const SHELF_SPACE = 30;
/** Who else is parting cars out. They are all computer players, and the first of them is the one to beat. */
export const SCRAPPERS = ["Ricky at Rix Racing", "Junkyard Dale", "Patty's Parts Barn", "Two-Bay Tony"] as const;

/** A part off a car, on the shelf: a bolt-on at its level, or a piece of the car itself (level 0). */
export interface Piece {
  id: number;
  kind: PieceKind;
  level: number;
  /** The tier of car it came off, which is the tier it fits, and the model. */
  tier: number;
  model: number;
  /** How good it is, in thousandths. */
  cond: number;
}

export interface Listing {
  id: number;
  model: number;
  /** What the seller says of the engine and the tyres. */
  engine: number;
  rubber: number;
  /** What they are. You find out when it is in your garage. */
  trueEngine: number;
  trueRubber: number;
  price: number;
  /** The seller's line. */
  pitch: string;
  /** Sold for parts: it does not run and it is bent, by this much. */
  partsCar: boolean;
  body: number;
  /** A scrapper has seen it too. It is gone once the garage has made this many moves (0: nobody is after it), to this scrapper. */
  snipe: number;
  by: number;
}

export interface GarageState {
  v: number;
  rng: number;
  cash: number;
  /** The last day the classifieds changed. */
  day: number;
  cars: OwnedCar[];
  listings: Listing[];
  /** Which tools are on the wall. */
  tools: Record<Tool, boolean>;
  /** What Rix Racing has on the shelf today: used parts, each for one tier of car. */
  rix: RixPart[];
  nextId: number;
  races: number;
  wins: number;
  /** Cars won and lost on a pink slip. */
  slipsWon: number;
  slipsLost: number;
  /** Pieces off cars, waiting to be fitted or sold. */
  shelf: Piece[];
  /** What each kind of piece fetches today, in thousandths of its worth, in `PIECE_KINDS` order; and which scrapper has flooded it (-1: nobody). */
  rates: number[];
  glut: number[];
  /** How many things have been done in this garage. Scrappers move when you do. */
  moves: number;
  /** The last thing a scrapper did that you would want to know about. */
  news: string;
}

/** A used part at Rix Racing: this level of this slot, for cars of one tier, for less than new. */
export interface RixPart {
  id: number;
  slot: PartSlot;
  level: number;
  tier: number;
  price: number;
}

export type GarageCommand =
  | { cmd: "buy"; listing: number }
  | { cmd: "sell"; car: number }
  | { cmd: "tool"; tool: Tool }
  | { cmd: "fit"; car: number; slot: PartSlot; level: number; rix?: number }
  | { cmd: "oil"; car: number }
  | { cmd: "plugs"; car: number }
  | { cmd: "fuel"; car: number; fuel: number }
  | { cmd: "dyno"; car: number }
  | { cmd: "remote"; car: number }
  | { cmd: "body"; car: number }
  | { cmd: "scrap"; car: number }
  | { cmd: "pull"; car: number; slot: PartSlot }
  | { cmd: "bolt"; car: number; piece: number }
  | { cmd: "strip"; car: number }
  | { cmd: "sellPiece"; piece: number }
  | { cmd: "salvage"; car: number }
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
  return safeBuild([car.model, car.parts.intake, car.parts.exhaust, car.parts.cam, car.parts.boost, car.parts.tyres, car.parts.weight, car.parts.trans, car.final, car.engine, car.rubber, car.oil, car.fuel, car.plugs]);
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

/** What it costs to straighten a car: four tenths of the model for one bent double, and less for less. */
export function bodyCost(car: Pick<OwnedCar, "model" | "body">): number {
  const value = CAR_MODELS[car.model]?.value ?? 0;
  return car.body <= 0 ? 0 : Math.max(20, Math.round((value * car.body * 4) / 10_000 / 10) * 10);
}
/** What the parts on a car cost. */
function partsCost(car: Pick<OwnedCar, "model" | "parts">): number {
  let parts = 0;
  for (const slot of PART_SLOTS) for (let level = 1; level <= car.parts[slot]; level++) parts += partCost(car.model, slot, level);
  return parts;
}
/** What the scrapyard gives for the shell, and what pulling the good parts off first comes to. */
export const scrapValue = (car: Pick<OwnedCar, "model">) => Math.round((CAR_MODELS[car.model]?.value ?? 0) / 8 / 10) * 10;
export const salvageValue = (car: Pick<OwnedCar, "model" | "parts">) => Math.round((CAR_MODELS[car.model]?.value ?? 0) / 20 / 10) * 10 + Math.floor(partsCost(car) / 2);

/** What a car would fetch: the model, worn down and bent, plus half of what was spent on parts. */
export function carValue(car: Pick<OwnedCar, "model" | "engine" | "rubber" | "parts"> & { body?: number }): number {
  const model = CAR_MODELS[car.model];
  if (!model) return 0;
  // An engine is 45% of a car, the tyres 5%, and the rest is the rest.
  const sound = Math.round((model.value * (500 + Math.round((450 * car.engine) / 1000) + Math.round((50 * car.rubber) / 1000))) / 1000);
  const shell = Math.round((sound * (1000 - Math.floor((Math.min(TOTALED, car.body ?? 0) * 6) / 10))) / 1000);
  return shell + Math.floor(partsCost(car) / 2);
}

/** What a piece is worth with nobody flooding the market: a used bolt-on is half of new, and a piece of the car is its share of the model. */
export function pieceWorth(piece: Pick<Piece, "kind" | "level" | "tier" | "model" | "cond">): number {
  const whole1 = piece.kind in SALVAGE ? ((CAR_MODELS[piece.model]?.value ?? 0) * SALVAGE[piece.kind as SalvageKind].share) / 1000 : ((PARTS[piece.kind as PartSlot].costs[piece.level - 1] ?? 0) * (piece.tier + 1)) / 2;
  return Math.max(5, Math.round((whole1 * piece.cond) / 1000 / 5) * 5);
}
/** What it fetches today, with the scrappers doing what they are doing. */
export const pieceValue = (g: Pick<GarageState, "rates">, piece: Piece) => Math.max(5, Math.round((pieceWorth(piece) * (g.rates[PIECE_KINDS.indexOf(piece.kind)] ?? 1000)) / 1000 / 5) * 5);

/** What a car comes apart into: its bolt-ons, a level at a time, and the car itself in six pieces. */
function piecesOf(car: Pick<OwnedCar, "model" | "parts" | "engine" | "rubber" | "body">): Omit<Piece, "id">[] {
  const tier = CAR_MODELS[car.model]!.tier;
  const out: Omit<Piece, "id">[] = [];
  for (const slot of PART_SLOTS) for (let level = 1; level <= car.parts[slot]; level++) out.push({ kind: slot, level, tier, model: car.model, cond: 750 });
  const straight = 1000 - Math.min(TOTALED, car.body);
  const cond: Record<SalvageKind, number> = { block: car.engine, gearbox: Math.round((car.engine + 1000) / 2), panels: straight, interior: 600, wheels: car.rubber, glass: straight > 500 ? 900 : 300 };
  for (const kind of SALVAGE_KINDS) out.push({ kind, level: 0, tier, model: car.model, cond: cond[kind] });
  return out;
}
/** What a car would come to in pieces, at full rates, with the shell to the yard. */
export function teardownWorth(car: Pick<OwnedCar, "model" | "parts" | "engine" | "rubber" | "body">): number {
  return piecesOf(car).reduce((sum, piece) => sum + pieceWorth(piece), 0) + Math.round((CAR_MODELS[car.model]?.value ?? 0) / 20 / 10) * 10;
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
  // Three sellers in ten are telling you about a better engine than the one in it, and price it so.
  const lies = tier < 2 && rand() < 0.3;
  const trueEngine = lies ? Math.max(120, engine - 150 - Math.floor(rand() * 21) * 10) : engine;
  const listing: Listing = { id: g.nextId++, model, engine, rubber, trueEngine, trueRubber: rubber, price: Math.max(50, Math.round(asked / 10) * 10), pitch, partsCar: false, body: 0, snipe: 0, by: 0 };
  // One listing in four is a parts car: it does not run, it is bent, and it is priced by what is left of it.
  if (rand() < 0.25) {
    listing.partsCar = true;
    listing.engine = listing.trueEngine = Math.floor(rand() * 16) * 10;
    listing.body = 300 + Math.floor(rand() * 61) * 10;
    const apart = teardownWorth({ model, parts: noParts(), engine: listing.engine, rubber, body: listing.body });
    const share = 45 + Math.floor(rand() * 51);
    listing.price = Math.max(40, Math.round((apart * share) / 100 / 10) * 10);
    listing.pitch = ["Parts only. No title.", "Hit a deer. Then a tree.", "Good glass. Bring a trailer.", "Was going to fix it."][Math.floor(rand() * 4)]!;
    // A cheap one is a deal, and the scrappers can count: it is gone in a few moves. Ricky is quickest.
    if (share < 70) {
      listing.snipe = g.moves + 2 + Math.floor(rand() * 4);
      listing.by = rand() < 0.5 ? 0 : 1 + Math.floor(rand() * (SCRAPPERS.length - 1));
    }
  }
  return listing;
}

function fillListings(g: GarageState) {
  g.listings = [];
  for (let i = 0; i < LISTINGS; i++) g.listings.push(makeListing(g));
  // Nobody is ever stuck: there is always something the stake would have bought.
  if (!g.listings.some((l) => !l.partsCar && CAR_MODELS[l.model]!.tier === 0 && l.price <= GARAGE_STAKE - 300)) {
    const cheap = makeListing(g);
    cheap.partsCar = false;
    cheap.body = cheap.snipe = 0;
    cheap.model = 0;
    cheap.engine = cheap.trueEngine = 600;
    cheap.rubber = cheap.trueRubber = 500;
    cheap.price = Math.round(carValue({ model: 0, engine: 600, rubber: 500, parts: noParts() }) / 10) * 10;
    cheap.pitch = PITCHES[0]!;
    g.listings[LISTINGS - 1] = cheap;
  }
}

/** What Rix has pulled off other people's cars this week. */
function fillRix(g: GarageState) {
  const rand = nextRandom(g);
  g.rix = [];
  for (let i = 0; i < 6; i++) {
    const slot = PART_SLOTS[Math.floor(rand() * PART_SLOTS.length)]!;
    const level = 1 + Math.floor(rand() * PARTS[slot].levels.length);
    const tier = Math.floor(rand() * 100) < 55 ? 0 : Math.floor(rand() * 100) < 75 ? 1 : 2;
    // Between 45% and 65% of new.
    const price = Math.max(20, Math.round((PARTS[slot].costs[level - 1]! * (tier + 1) * (45 + Math.floor(rand() * 21))) / 100 / 5) * 5);
    g.rix.push({ id: g.nextId++, slot, level, tier, price });
  }
}

/**
 * What pieces fetch today. Most go for about what they are worth. Three kinds do not: Ricky has
 * flooded two of them and somebody else a third, and those go for a little over half.
 */
function fillMarket(g: GarageState) {
  const rand = nextRandom(g);
  g.rates = PIECE_KINDS.map(() => 880 + Math.floor(rand() * 13) * 10);
  g.glut = PIECE_KINDS.map(() => -1);
  for (const by of [0, 0, 1 + Math.floor(rand() * (SCRAPPERS.length - 1))]) {
    const kind = Math.floor(rand() * PIECE_KINDS.length);
    g.glut[kind] = by;
    g.rates[kind] = 520 + Math.floor(rand() * 17) * 10;
  }
}

/** A new garage: the stake, no cars, no tools, and today's classifieds. */
export function newGarage(seed: number, day = 0): GarageState {
  const g: GarageState = { v: GARAGE_VERSION, rng: seed >>> 0, cash: GARAGE_STAKE, day: whole(day), cars: [], listings: [], tools: { jack: false, wrenches: false, hammer: false }, rix: [], nextId: 1, races: 0, wins: 0, slipsWon: 0, slipsLost: 0, shelf: [], rates: [], glut: [], moves: 0, news: "" };
  fillListings(g);
  fillRix(g);
  fillMarket(g);
  return g;
}

/** Tell the garage what day it is. A later day than it knew brings new classifieds. **Changes the garage.** */
export function newDay(g: GarageState, day: number): boolean {
  const d = whole(day);
  if (d <= g.day) return false;
  g.day = d;
  fillListings(g);
  fillRix(g);
  fillMarket(g);
  g.news = "";
  return true;
}

const find = (g: GarageState, id: number) => g.cars.find((c) => c.id === id);
const no = (message: string): GarageAnswer => ({ ok: false, message });
/** Why a job cannot be done for want of a tool, or null when the tool is there. */
const needs = (g: GarageState, tool: Tool): GarageAnswer | null => (g.tools[tool] ? null : no(`You need a ${TOOLS[tool].label.toLowerCase()} for that.`));
/** A car as it comes: oil, plugs and a tune of somebody else's doing. */
function used(g: GarageState, model: number, engine: number, rubber: number): OwnedCar {
  const rand = nextRandom(g);
  const parts = noParts();
  return { id: g.nextId++, model, parts, final: 1, engine, rubber, oil: 500 + Math.floor(rand() * 41) * 10, plugs: 400 + Math.floor(rand() * 61) * 10, fuel: clamp(idealFuel([model]) + Math.floor(rand() * 3) - 1, 0, FUEL_MAX), body: 0, name: CAR_MODELS[model]!.name, races: 0, wins: 0 };
}
const yes = (message: string): GarageAnswer => ({ ok: true, message });

/**
 * Carry a command out, or say why not. **Changes the garage.** Everything done is a move, and the
 * scrappers move when you do: a parts car one of them had an eye on is gone when its time is up.
 */
export function garageAct(g: GarageState, given: unknown): GarageAnswer {
  const answer = carryOut(g, given);
  if (!answer.ok) return answer;
  g.moves++;
  const taken = g.listings.filter((l) => l.snipe > 0 && g.moves >= l.snipe);
  if (taken.length) {
    g.listings = g.listings.filter((l) => !taken.includes(l));
    const first = taken[0]!;
    g.news = `${SCRAPPERS[first.by]} bought the ${CAR_MODELS[first.model]!.name} parts car before you did.`;
  }
  return answer;
}

function carryOut(g: GarageState, given: unknown): GarageAnswer {
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
      g.cars.push({ ...used(g, listing.model, listing.trueEngine, listing.trueRubber), body: listing.body });
      return yes(listing.trueEngine < listing.engine ? `The ${model.name} is yours. The engine is not what he said it was.` : `The ${model.name} is yours.`);
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
    case "pull": {
      const car = find(g, whole(c.car));
      if (!car) return no("You don't own that.");
      const slot = c.slot as PartSlot;
      if (!PART_SLOTS.includes(slot) || car.parts[slot] <= 0) return no("There is nothing there to take off.");
      const missing = needs(g, slot === "tyres" ? "jack" : "wrenches");
      if (missing) return missing;
      if (g.shelf.length >= SHELF_SPACE) return no("The shelf is full. Sell something.");
      const level = car.parts[slot]--;
      g.shelf.push({ id: g.nextId++, kind: slot, level, tier: CAR_MODELS[car.model]!.tier, model: car.model, cond: 750 });
      return yes(`${PARTS[slot].levels[level - 1]} off and on the shelf.${slot === "intake" || slot === "exhaust" || slot === "cam" || slot === "boost" ? " It is running rich now." : ""}`);
    }
    case "bolt": {
      const car = find(g, whole(c.car));
      if (!car) return no("You don't own that.");
      const piece = g.shelf.find((x) => x.id === whole(c.piece));
      if (!piece) return no("That is not on the shelf.");
      if (piece.kind in SALVAGE) return no("That is a piece of a car, not something to bolt on.");
      const slot = piece.kind as PartSlot;
      if (!partFits(car.model, slot)) return no("That needs a turbo to bolt on to.");
      if (piece.tier !== CAR_MODELS[car.model]!.tier) return no("That came off a different kind of car. It won't go on this one.");
      if (piece.level !== car.parts[slot] + 1) return no(piece.level <= car.parts[slot] ? "That wouldn't be an upgrade." : "It needs the part before it first.");
      const missing = needs(g, slot === "tyres" ? "jack" : "wrenches");
      if (missing) return missing;
      car.parts[slot] = piece.level;
      g.shelf = g.shelf.filter((x) => x !== piece);
      return yes(`${PARTS[slot].levels[piece.level - 1]} fitted from the shelf.`);
    }
    case "strip": {
      const car = find(g, whole(c.car));
      if (!car) return no("You don't own that.");
      const missing = needs(g, "wrenches") ?? needs(g, "jack");
      if (missing) return missing;
      const pieces = piecesOf(car);
      if (g.shelf.length + pieces.length > SHELF_SPACE) return no(`It comes apart into ${pieces.length} pieces, and there is room on the shelf for ${SHELF_SPACE - g.shelf.length}.`);
      for (const piece of pieces) g.shelf.push({ id: g.nextId++, ...piece });
      const shell = Math.round((CAR_MODELS[car.model]?.value ?? 0) / 20 / 10) * 10;
      g.cash = Math.min(CEILING, g.cash + shell);
      g.cars = g.cars.filter((x) => x !== car);
      return yes(`In ${pieces.length} pieces on the shelf, and ${dollars(shell)} from the yard for the shell.`);
    }
    case "sellPiece": {
      const piece = g.shelf.find((x) => x.id === whole(c.piece));
      if (!piece) return no("That is not on the shelf.");
      const price = pieceValue(g, piece);
      const by = g.glut[PIECE_KINDS.indexOf(piece.kind)] ?? -1;
      g.cash = Math.min(CEILING, g.cash + price);
      g.shelf = g.shelf.filter((x) => x !== piece);
      return yes(by >= 0 ? `${dollars(price)}. ${SCRAPPERS[by]} has the market full of those.` : `Sold for ${dollars(price)}.`);
    }
    case "tool": {
      const tool = c.tool as Tool;
      if (!TOOL_NAMES.includes(tool)) return no("They don't sell that.");
      if (g.tools[tool]) return no("You have one.");
      if (g.cash < TOOLS[tool].cost) return no(`You're ${dollars(TOOLS[tool].cost - g.cash)} short.`);
      g.cash -= TOOLS[tool].cost;
      g.tools[tool] = true;
      return yes(`${TOOLS[tool].label}: on the wall.`);
    }
    case "fit": {
      const car = find(g, whole(c.car));
      if (!car) return no("You don't own that.");
      // A used part from Rix is the part it is; a new one is whatever was asked for.
      const shelf = c.rix === undefined ? null : g.rix.find((r) => r.id === whole(c.rix));
      if (c.rix !== undefined && !shelf) return no("Rix sold that one.");
      const slot = shelf ? shelf.slot : (c.slot as PartSlot);
      if (!PART_SLOTS.includes(slot)) return no("There's no such part.");
      if (!partFits(car.model, slot)) return no("That needs a turbo to bolt on to.");
      const missing = needs(g, slot === "tyres" ? "jack" : "wrenches");
      if (missing) return missing;
      const level = shelf ? shelf.level : whole(c.level);
      if (level <= car.parts[slot] || level > PARTS[slot].levels.length) return no("That wouldn't be an upgrade.");
      let cost = 0;
      if (shelf) {
        if (shelf.tier !== CAR_MODELS[car.model]!.tier) return no("That came off a different kind of car. It won't go on this one.");
        if (level !== car.parts[slot] + 1) return no("It needs the part before it first.");
        cost = shelf.price;
      } else {
        // Skipping a level still pays for the ones in between: they don't give those away.
        for (let l = car.parts[slot] + 1; l <= level; l++) cost += partCost(car.model, slot, l);
      }
      if (g.cash < cost) return no(`You're ${dollars(cost - g.cash)} short.`);
      g.cash -= cost;
      car.parts[slot] = level;
      if (shelf) g.rix = g.rix.filter((r) => r !== shelf);
      // New tyres are new tyres.
      if (slot === "tyres") car.rubber = 1000;
      const breathes = slot === "intake" || slot === "exhaust" || slot === "cam" || slot === "boost";
      return yes(`${PARTS[slot].levels[level - 1]} fitted.${breathes ? " It will want more fuel now." : ""}`);
    }
    case "oil":
    case "plugs": {
      const car = find(g, whole(c.car));
      if (!car) return no("You don't own that.");
      const missing = needs(g, "wrenches");
      if (missing) return missing;
      const cost = c.cmd === "oil" ? OIL_CHANGE : NEW_PLUGS;
      if (car[c.cmd] >= 1000) return no(c.cmd === "oil" ? "The oil is fresh." : "The plugs are new.");
      if (g.cash < cost) return no(`You're ${dollars(cost - g.cash)} short.`);
      g.cash -= cost;
      car[c.cmd] = 1000;
      return yes(c.cmd === "oil" ? "Fresh oil and a filter." : "New plugs, gapped.");
    }
    case "fuel": {
      const car = find(g, whole(c.car));
      if (!car) return no("You don't own that.");
      car.fuel = clamp(whole(c.fuel), 0, FUEL_MAX);
      const off = car.fuel - idealFuel(buildOf(car));
      return yes(off < 0 ? "Leaner. Watch it does not get hot." : off > 0 ? "Richer. Safe, and it will foul the plugs." : "That is where it wants to be.");
    }
    case "dyno":
    case "remote": {
      // Either way it comes back right. The dyno is paid for there; a remote tune is paid for when
      // the pulls have been made, which is the caller's to check.
      const car = find(g, whole(c.car));
      if (!car) return no("You don't own that.");
      const cost = c.cmd === "dyno" ? DYNO_COST : REMOTE_TUNE_COST;
      if (g.cash < cost) return no(`You're ${dollars(cost - g.cash)} short.`);
      g.cash -= cost;
      car.fuel = idealFuel(buildOf(car));
      return yes(c.cmd === "dyno" ? "Three pulls on the rollers and it is where it wants to be." : "He sent the map over. It is where it wants to be.");
    }
    case "body": {
      const car = find(g, whole(c.car));
      if (!car) return no("You don't own that.");
      if (car.body <= 0) return no("It's straight.");
      if (car.body >= TOTALED) return no("That is past beating out. Scrap it, or pull the parts.");
      const missing = needs(g, "hammer");
      if (missing) return missing;
      const cost = bodyCost(car);
      if (g.cash < cost) return no(`Straightening it is ${dollars(cost)}. You're ${dollars(cost - g.cash)} short.`);
      g.cash -= cost;
      car.body = 0;
      return yes("Straight again, near enough.");
    }
    case "scrap":
    case "salvage": {
      const car = find(g, whole(c.car));
      if (!car) return no("You don't own that.");
      if (car.body < TOTALED) return no("It isn't a write-off.");
      if (c.cmd === "salvage") {
        const missing = needs(g, "wrenches");
        if (missing) return missing;
      }
      const price = c.cmd === "scrap" ? scrapValue(car) : salvageValue(car);
      g.cash = Math.min(CEILING, g.cash + price);
      g.cars = g.cars.filter((x) => x !== car);
      return yes(c.cmd === "scrap" ? `The yard gave you ${dollars(price)} for it.` : `Parts pulled and sold, and the shell hauled off: ${dollars(price)}.`);
    }
    case "engine": {
      const car = find(g, whole(c.car));
      if (!car) return no("You don't own that.");
      const cost = engineCost(car);
      if (!cost) return no("There's nothing wrong with it.");
      const missing = needs(g, "wrenches");
      if (missing) return missing;
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
      const missing = needs(g, "jack");
      if (missing) return missing;
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
  /** Thousandths the oil and the plugs are worse by, and how much more bent the car is. */
  oilWear?: number;
  plugsWear?: number;
  damage?: number;
}

/** Bring a car back from a race or a run. **Changes the garage.** */
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
  car.oil = clamp(car.oil - Math.max(0, whole(toll.oilWear)), 0, 1000);
  car.plugs = clamp(car.plugs - Math.max(0, whole(toll.plugsWear)), 0, 1000);
  car.body = clamp(car.body + Math.max(0, whole(toll.damage)), 0, TOTALED);
  return true;
}

/** Money in or out: a purse, a wager, a tow. It never goes below nothing. **Changes the garage.** */
export function settleUp(g: GarageState, amount: number): number {
  g.cash = clamp(g.cash + whole(amount), 0, CEILING);
  return g.cash;
}

/**
 * A car leaves the garage, and is handed back for whoever it goes to. It is a pink slip lost
 * unless it is `sold`, which is a car changing hands for money. **Changes the garage.**
 */
export function takeCar(g: GarageState, carId: number, sold = false): OwnedCar | null {
  const car = find(g, carId);
  if (!car) return null;
  g.cars = g.cars.filter((c) => c !== car);
  if (!sold) g.slipsLost++;
  return car;
}

/** A piece leaves the shelf, for whoever it goes to. **Changes the garage.** */
export function takePiece(g: GarageState, pieceId: number): Piece | null {
  const piece = g.shelf.find((x) => x.id === pieceId);
  if (!piece) return null;
  g.shelf = g.shelf.filter((x) => x !== piece);
  return piece;
}

/** A piece arrives on the shelf, as it left the other one. Null when it is not a piece, or the shelf is full. **Changes the garage.** */
export function givePiece(g: GarageState, given: unknown): Piece | null {
  const x = (given && typeof given === "object" ? given : {}) as Record<string, unknown>;
  const kind = x.kind as PieceKind;
  if (!PIECE_KINDS.includes(kind) || !CAR_MODELS[whole(x.model)] || g.shelf.length >= SHELF_SPACE) return null;
  const level = kind in SALVAGE ? 0 : clamp(whole(x.level), 1, PARTS[kind as PartSlot].levels.length);
  const piece: Piece = { id: g.nextId++, kind, level, tier: clamp(whole(x.tier), 0, 2), model: whole(x.model), cond: clamp(whole(x.cond), 0, 1000) };
  g.shelf.push(piece);
  return piece;
}

/**
 * A car arrives as it left the other garage, parts and wear and all. It is a pink slip won unless
 * it was `bought`. There is always room for one you won; whoever sells one should ask first.
 * **Changes the garage.**
 */
export function giveCar(g: GarageState, given: unknown, bought = false): OwnedCar | null {
  const car = loadCar(given);
  if (!car) return null;
  car.id = g.nextId++;
  g.cars.push(car);
  if (!bought) g.slipsWon++;
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
  const fresh = (n: unknown) => (n === undefined ? 1000 : clamp(whole(n), 0, 1000));
  const ideal = idealFuel([model, parts.intake, parts.exhaust, parts.cam, parts.boost]);
  return { id: Math.max(0, whole(c.id)), model, parts, final: clamp(c.final === undefined ? 1 : whole(c.final), 0, 2), engine: clamp(whole(c.engine), 0, 1000), rubber: clamp(whole(c.rubber), 0, 1000), oil: fresh(c.oil), plugs: fresh(c.plugs), fuel: c.fuel === undefined ? ideal : clamp(whole(c.fuel), 0, FUEL_MAX), body: clamp(whole(c.body), 0, TOTALED), name, races: Math.max(0, whole(c.races)), wins: Math.max(0, whole(c.wins)) };
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
    const engine = clamp(whole(l.engine), 0, 1000);
    const rubber = clamp(whole(l.rubber), 0, 1000);
    listings.push({ id: whole(l.id), model: whole(l.model), engine, rubber, trueEngine: l.trueEngine === undefined ? engine : clamp(whole(l.trueEngine), 0, 1000), trueRubber: l.trueRubber === undefined ? rubber : clamp(whole(l.trueRubber), 0, 1000), price: whole(l.price), pitch: typeof l.pitch === "string" ? l.pitch.slice(0, 80) : "", partsCar: l.partsCar === true, body: clamp(whole(l.body), 0, TOTALED), snipe: Math.max(0, whole(l.snipe)), by: clamp(whole(l.by), 0, SCRAPPERS.length - 1) });
  }
  // A garage from before there were tools has all of them: nobody is locked out of their own car.
  const t = (s.tools && typeof s.tools === "object" ? s.tools : null) as Record<string, unknown> | null;
  const tools = { jack: t ? t.jack === true : true, wrenches: t ? t.wrenches === true : true, hammer: t ? t.hammer === true : true };
  const rix: RixPart[] = [];
  for (const given of Array.isArray(s.rix) ? s.rix : []) {
    const r = (given && typeof given === "object" ? given : {}) as Record<string, unknown>;
    const slot = r.slot as PartSlot;
    if (!PART_SLOTS.includes(slot) || whole(r.level) < 1 || whole(r.level) > PARTS[slot].levels.length || whole(r.price) <= 0) continue;
    rix.push({ id: whole(r.id), slot, level: whole(r.level), tier: clamp(whole(r.tier), 0, 2), price: whole(r.price) });
  }
  const shelf: Piece[] = [];
  for (const given of Array.isArray(s.shelf) ? s.shelf : []) {
    const x = (given && typeof given === "object" ? given : {}) as Record<string, unknown>;
    const kind = x.kind as PieceKind;
    if (!PIECE_KINDS.includes(kind) || !CAR_MODELS[whole(x.model)] || shelf.length >= SHELF_SPACE) continue;
    const level = kind in SALVAGE ? 0 : clamp(whole(x.level), 1, PARTS[kind as PartSlot].levels.length);
    shelf.push({ id: whole(x.id), kind, level, tier: clamp(whole(x.tier), 0, 2), model: whole(x.model), cond: clamp(whole(x.cond), 0, 1000) });
  }
  const list = (given: unknown, low: number, high: number, or: number) => PIECE_KINDS.map((_, i) => (Array.isArray(given) && typeof given[i] === "number" ? clamp(whole(given[i]), low, high) : or));
  const top = Math.max(0, ...cars.map((c) => c.id), ...listings.map((l) => l.id), ...rix.map((r) => r.id), ...shelf.map((x) => x.id));
  const count = (n: unknown) => Math.max(0, whole(n));
  return { v: GARAGE_VERSION, rng: whole(s.rng) >>> 0, cash: clamp(whole(s.cash), 0, CEILING), day: whole(s.day), cars, listings, tools, rix, nextId: Math.max(top + 1, count(s.nextId)), races: count(s.races), wins: count(s.wins), slipsWon: count(s.slipsWon), slipsLost: count(s.slipsLost), shelf, rates: list(s.rates, 100, 1500, 1000), glut: list(s.glut, -1, SCRAPPERS.length - 1, -1), moves: count(s.moves), news: typeof s.news === "string" ? s.news.slice(0, 160) : "" };
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
  tools: { tool: Tool; label: string; hint: string; cost: number; owned: boolean; can: boolean }[];
  /** Your own shelf: pieces to fit or to sell, with what each fetches today and who has flooded the market for it, if anyone. */
  shelf: { id: number; kind: PieceKind; name: string; from: string; tier: string; cond: number; worth: number; value: number; glut: string | null }[];
  shelfSpace: number;
  /** What the scrappers are up to: which kinds they have flooded, and the last deal one of them beat you to. */
  gluts: { kind: PieceKind; label: string; by: string }[];
  news: string;
  /** Rix Racing's shelf. */
  rix: { id: number; slot: PartSlot; label: string; name: string; tier: string; price: number; can: boolean }[];
  record: { races: number; wins: number; slipsWon: number; slipsLost: number };
  cars: {
    id: number;
    name: string;
    sheet: CarSheet;
    build: Build;
    engine: number;
    rubber: number;
    oil: number;
    plugs: number;
    /** Where the fuel is set and how far it can go, the air-fuel ratio that gives in tenths, and which way it is off. */
    fuel: number;
    fuelMax: number;
    afr: number;
    mixture: "lean" | "right" | "rich";
    body: number;
    totaled: boolean;
    final: number;
    value: number;
    /** What the dealer would give. */
    sells: number;
    races: number;
    wins: number;
    /** Whether it can be driven: a blown engine needs rebuilding first, and a bent car straightening. */
    runs: boolean;
    /** What each job costs (0 when there is nothing to do), and the tool it needs if that tool is not on the wall. */
    repairs: { engine: number; tyres: number; oil: number; plugs: number; body: number };
    /** What a write-off fetches as scrap, and with its parts pulled first. */
    scrap: number;
    salvage: number;
    /** What it would come to torn down and sold a piece at a time, at today's prices. */
    teardown: number;
    parts: { slot: PartSlot; label: string; hint: string; level: number; has: string; needs: Tool | null; /** A piece on your own shelf that is the next step for this car, to bolt on for nothing. */ shelf: number | null; next: { level: number; label: string; cost: number; can: boolean; rix: { id: number; price: number } | null } | null }[];
  }[];
  /** What is for sale. The engine and tyres are the seller's word for them. A parts car says what it would come to in pieces, and whether a scrapper is circling it. */
  listings: { id: number; price: number; pitch: string; engine: number; rubber: number; sheet: CarSheet; can: boolean; partsCar: boolean; body: number; teardown: number; watching: string | null; movesLeft: number }[];
}

/** What the player sees. Does not change the garage. */
export function garageView(g: GarageState): GarageView {
  return {
    cash: g.cash,
    day: g.day,
    bays: GARAGE_BAYS,
    tools: TOOL_NAMES.map((tool) => ({ tool, label: TOOLS[tool].label, hint: TOOLS[tool].hint, cost: TOOLS[tool].cost, owned: g.tools[tool], can: !g.tools[tool] && g.cash >= TOOLS[tool].cost })),
    rix: g.rix.map((r) => ({ id: r.id, slot: r.slot, label: PARTS[r.slot].label, name: PARTS[r.slot].levels[r.level - 1]!, tier: CAR_TIERS[r.tier as 0 | 1 | 2], price: r.price, can: g.cash >= r.price })),
    shelf: g.shelf.map((x) => {
      const by = g.glut[PIECE_KINDS.indexOf(x.kind)] ?? -1;
      return { id: x.id, kind: x.kind, name: x.kind in SALVAGE ? SALVAGE[x.kind as SalvageKind].label : PARTS[x.kind as PartSlot].levels[x.level - 1]!, from: CAR_MODELS[x.model]!.name, tier: CAR_TIERS[x.tier as 0 | 1 | 2], cond: x.cond, worth: pieceWorth(x), value: pieceValue(g, x), glut: by >= 0 ? SCRAPPERS[by]! : null };
    }),
    shelfSpace: SHELF_SPACE,
    gluts: PIECE_KINDS.flatMap((kind, i) => ((g.glut[i] ?? -1) >= 0 ? [{ kind, label: kind in SALVAGE ? SALVAGE[kind as SalvageKind].label : PARTS[kind as PartSlot].label, by: SCRAPPERS[g.glut[i]!]! }] : [])),
    news: g.news,
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
        oil: car.oil,
        plugs: car.plugs,
        fuel: car.fuel,
        fuelMax: FUEL_MAX,
        afr: specOf(buildOf(car)).afr,
        mixture: (car.fuel < idealFuel(buildOf(car)) ? "lean" : car.fuel > idealFuel(buildOf(car)) ? "rich" : "right") as "lean" | "right" | "rich",
        body: car.body,
        totaled: car.body >= TOTALED,
        final: car.final,
        value,
        sells: Math.floor((value * 4) / 5),
        races: car.races,
        wins: car.wins,
        runs: car.engine > 0 && car.body < UNDRIVABLE,
        repairs: { engine: engineCost(car), tyres: tyresCost(car), oil: car.oil >= 1000 ? 0 : OIL_CHANGE, plugs: car.plugs >= 1000 ? 0 : NEW_PLUGS, body: car.body >= TOTALED ? 0 : bodyCost(car) },
        scrap: scrapValue(car),
        salvage: salvageValue(car),
        teardown: piecesOf(car).reduce((sum, piece) => sum + pieceValue(g, { id: 0, ...piece }), 0) + Math.round((CAR_MODELS[car.model]?.value ?? 0) / 20 / 10) * 10,
        parts: PART_SLOTS.filter((slot) => partFits(car.model, slot)).map((slot) => {
          const level = car.parts[slot];
          const label = PARTS[slot].levels[level];
          const cost = partCost(car.model, slot, level + 1);
          const tool: Tool = slot === "tyres" ? "jack" : "wrenches";
          // The same part, used, if Rix has one for this kind of car.
          const shelf = g.rix.filter((r) => r.slot === slot && r.level === level + 1 && r.tier === CAR_MODELS[car.model]!.tier).sort((a, b) => a.price - b.price)[0];
          return { slot, label: PARTS[slot].label, hint: PARTS[slot].hint, level, has: level ? PARTS[slot].levels[level - 1]! : "Stock", needs: g.tools[tool] ? null : tool, shelf: g.shelf.find((x) => x.kind === slot && x.level === level + 1 && x.tier === CAR_MODELS[car.model]!.tier)?.id ?? null, next: label ? { level: level + 1, label, cost, can: g.tools[tool] && g.cash >= cost, rix: shelf ? { id: shelf.id, price: shelf.price } : null } : null };
        }),
      };
    }),
    listings: g.listings.map((l) => ({ id: l.id, price: l.price, pitch: l.pitch, engine: l.engine, rubber: l.rubber, sheet: { ...sheetOf([l.model, 0, 0, 0, 0, 0, 0, 0, 1, l.engine, l.rubber]), ...(l.partsCar ? { quarter: null } : {}) }, can: g.cash >= l.price && g.cars.length < GARAGE_BAYS, partsCar: l.partsCar, body: l.body, teardown: teardownWorth({ model: l.model, parts: noParts(), engine: l.engine, rubber: l.rubber, body: l.body }), watching: l.snipe > 0 ? SCRAPPERS[l.by]! : null, movesLeft: l.snipe > 0 ? Math.max(0, l.snipe - g.moves) : 0 })),
  };
}
