// Delbie's Counter: a shift behind the counter of Delbie's parts store, and the first game on the
// arcade kit that is played with forms and not a stick. Customers come in and say what they need.
// The right part is looked up for their car and rung up in the right number, the core is charged
// unless they brought the old one, a shop gets its price, and whoever pays cash gets their change
// to the penny. Some bring a part back, and get a refund, an exchange or neither, by the store's
// rules. Everyone has only so much patience, and the line does not stop.
//
// It is on the arcade kit because a shift is a few minutes against the clock, the same seed is the
// same shift for everyone, and a log of what was done replays to the same score. A seat's controls
// are a command and a number that counts up: a command is carried out on the tick its number
// changes, so holding one does nothing and a log is short.
//
// Money is in cents and everything in the state is a whole number. A step uses only addition,
// multiplication and `Math.floor`.
import type { PlayStyle } from "@journey-to-code/rules";
import { points, type ArcadeCounter, type ArcadeEvent, type ArcadeGame, type ArcadeSummary, type ArcadeView } from "./arcade.js";
import { dollars } from "./idle.js";
import { nextRandom, type BaseRules } from "./table.js";

export const COUNTER_RATE = 10;
/** Sales tax, in hundredths: six cents on the dollar. Cores are not taxed. */
export const COUNTER_TAX = 6;
/** What comes off for each price level, in hundredths: retail, a shop's account, wholesale. */
export const COUNTER_LEVELS = [0, 15, 25] as const;
export const COUNTER_LEVEL_NAMES = ["Retail", "Shop", "Wholesale"] as const;
/** The store's rules for a part brought back, in days. */
export const COUNTER_POLICY = { refundDays: 30, warrantyDays: 365 };
const MOST_IN_LINE = 5;

// ---- What the store sells -------------------------------------------------------------------------

export interface CounterVehicle { year: number; make: string; model: string; engine: string; cylinders: number }
/** The cars that come in. The makes are made up: nobody's badge is on the shelf. */
export const COUNTER_VEHICLES: CounterVehicle[] = [
  { year: 2009, make: "Hartwell", model: "Ridgeline", engine: "5.3L V8", cylinders: 8 },
  { year: 2014, make: "Corsa", model: "Meridian", engine: "2.5L", cylinders: 4 },
  { year: 2003, make: "Hartwell", model: "Bronto", engine: "4.0L V6", cylinders: 6 },
  { year: 2017, make: "Tanaka", model: "Civet", engine: "1.8L", cylinders: 4 },
  { year: 2011, make: "Volksbahn", model: "Jetstream", engine: "2.0L", cylinders: 4 },
  { year: 1998, make: "Dorsey", model: "Ramrod", engine: "5.9L V8", cylinders: 8 },
  { year: 2019, make: "Tanaka", model: "Trailhead", engine: "3.5L V6", cylinders: 6 },
  { year: 2006, make: "Corsa", model: "Vagabond", engine: "3.8L V6", cylinders: 6 },
  { year: 2015, make: "Hartwell", model: "Sprite", engine: "1.4L", cylinders: 4 },
  { year: 2001, make: "Buckeye", model: "Century", engine: "3.8L V6", cylinders: 6 },
  { year: 2012, make: "Dorsey", model: "Caravel", engine: "3.6L V6", cylinders: 6 },
  { year: 2020, make: "Kestrel", model: "Outland", engine: "2.4L", cylinders: 4 },
];

interface PartLine { key: string; code: string; name: string; asked: string; price: number; core: number; count: "one" | "pair" | "cylinders" }
const PART_LINES: PartLine[] = [
  { key: "pads", code: "BP", name: "Front brake pads", asked: "a set of front brake pads", price: 3499, core: 0, count: "one" },
  { key: "rotors", code: "RT", name: "Front rotor", asked: "both front rotors", price: 4299, core: 0, count: "pair" },
  { key: "oilfilter", code: "OF", name: "Oil filter", asked: "an oil filter", price: 599, core: 0, count: "one" },
  { key: "airfilter", code: "AF", name: "Air filter", asked: "an air filter", price: 1499, core: 0, count: "one" },
  { key: "wipers", code: "WB", name: "Wiper blade", asked: "a pair of wiper blades", price: 1299, core: 0, count: "pair" },
  { key: "plugs", code: "SP", name: "Spark plug", asked: "a full set of spark plugs", price: 449, core: 0, count: "cylinders" },
  { key: "battery", code: "BA", name: "Battery", asked: "a battery", price: 12999, core: 2200, count: "one" },
  { key: "alternator", code: "AL", name: "Alternator", asked: "an alternator", price: 15999, core: 4500, count: "one" },
  { key: "starter", code: "ST", name: "Starter", asked: "a starter", price: 13999, core: 4000, count: "one" },
  { key: "belt", code: "SB", name: "Serpentine belt", asked: "a serpentine belt", price: 2799, core: 0, count: "one" },
  { key: "bulbs", code: "HB", name: "Headlight bulb", asked: "both headlight bulbs", price: 1099, core: 0, count: "pair" },
  { key: "thermostat", code: "TH", name: "Thermostat", asked: "a thermostat", price: 1899, core: 0, count: "one" },
];
const GRADES = ["Value", "Premium"] as const;

/** One thing on the shelf: a part of a kind and a grade, for one car. */
export interface CounterPart { sku: string; vehicle: number; line: number; grade: number; name: string; grade_name: string; price: number; core: number }
/** Everything the store sells, for every car: what a screen looks parts up in. */
export const COUNTER_PARTS: CounterPart[] = COUNTER_VEHICLES.flatMap((_, vehicle) =>
  PART_LINES.flatMap((part, line) =>
    GRADES.map((grade_name, grade) => {
      const value = part.price + ((vehicle * 53 + line * 17) % 9) * 50;
      return { sku: `${part.code}${1000 + vehicle * 12 + line}${grade ? "P" : "V"}`, vehicle, line, grade, name: part.name, grade_name, price: grade ? Math.floor((value * 14 + 5) / 10) : value, core: part.core };
    }),
  ),
);
const BY_SKU = new Map(COUNTER_PARTS.map((part) => [part.sku, part]));
export const counterPart = (sku: string): CounterPart | undefined => BY_SKU.get(sku);
/** A car, as it is said. */
export const counterVehicleName = (v: CounterVehicle) => `${v.year} ${v.make} ${v.model} ${v.engine}`;

/** What a ticket comes to. */
export interface CounterTotals { subtotal: number; discount: number; core: number; tax: number; total: number }
export function counterTotals(lines: readonly { sku: string; qty: number }[], coreBack: boolean, level: number): CounterTotals {
  let subtotal = 0;
  let core = 0;
  for (const line of lines) {
    const part = BY_SKU.get(line.sku);
    if (!part) continue;
    subtotal += part.price * line.qty;
    core += part.core * line.qty;
  }
  const discount = Math.floor((subtotal * (COUNTER_LEVELS[level] ?? 0)) / 100);
  if (coreBack) core = 0;
  const tax = Math.floor(((subtotal - discount) * COUNTER_TAX + 50) / 100);
  return { subtotal, discount, core, tax, total: subtotal - discount + core + tax };
}
/** What the store's rules say to do with a part brought back. */
export const counterRuling = (days: number, opened: boolean, defective: boolean): "refund" | "exchange" | "refuse" =>
  defective ? (days <= COUNTER_POLICY.warrantyDays ? "exchange" : "refuse") : !opened && days <= COUNTER_POLICY.refundDays ? "refund" : "refuse";

// ---- Rules ----------------------------------------------------------------------------------------

export interface CounterRules extends BaseRules {
  /** How long the shift is, in seconds. */
  shift: number;
  /** How fast they come in and how long they will wait. */
  rush: "slow" | "steady" | "slammed";
  /** Whether the register works out the change. */
  drawer: boolean;
}
export const COUNTER_PRESETS: CounterRules[] = [
  { id: "tuesday", name: "Slow Tuesday", shift: 180, rush: "slow", drawer: true },
  { id: "saturday", name: "Saturday morning", shift: 210, rush: "steady", drawer: false },
  { id: "truck", name: "Truck day", shift: 240, rush: "slammed", drawer: false },
];
/** Seconds between customers, seconds each will wait, and how many things one may want, by how busy it is. */
const RUSH = { slow: { gap: 17, wait: 60, most: 1, shops: 10, returns: 12 }, steady: { gap: 13, wait: 48, most: 2, shops: 22, returns: 18 }, slammed: { gap: 10, wait: 40, most: 2, shops: 34, returns: 22 } } as const;

// ---- State ----------------------------------------------------------------------------------------

const DOES = ["none", "ring", "void", "core", "level", "cash", "card", "refund", "exchange", "refuse"] as const;
type Does = (typeof DOES)[number];
/** What a seat's controls are doing. A command is carried out on the tick `n` changes. */
export interface CounterInput {
  n: number;
  do: Does;
  /** For "ring" and "void". */
  sku: string;
  /** For "ring". */
  qty: number;
  /** For "core": whether the old part came back. */
  on: boolean;
  /** For "level": a place in `COUNTER_LEVELS`. */
  level: number;
  /** For "cash": the change handed back, in cents. */
  cents: number;
}
const IDLE: CounterInput = { n: 0, do: "none", sku: "", qty: 1, on: false, level: 0, cents: 0 };

interface Customer {
  id: number;
  /** Who they are and how they say hello, as places in the lists below. */
  name: number;
  hello: number;
  kind: "sale" | "return";
  patience: number;
  wait: number;
  /** A sale: what they want, whether they have the old part with them, their price level, and how they pay. */
  wants: { sku: string; qty: number }[];
  coreBack: number;
  level: number;
  cash: number;
  tender: number;
  /** A return: what it is, how long ago it was bought, and the state it is in. */
  days: number;
  opened: number;
  defective: number;
}

export interface CounterState {
  rules: CounterRules;
  seats: number;
  rng: number;
  tick: number;
  phase: "open" | "closed";
  /** Who is waiting. The first is at the counter. */
  line: Customer[];
  nextId: number;
  /** Ticks until the next one walks in, and until the next steps up to the counter. */
  arrives: number;
  pause: number;
  ticket: { lines: { sku: string; qty: number }[]; coreBack: number; level: number };
  /** The number of the last command carried out. */
  seq: number;
  till: number;
  served: number;
  walked: number;
  mistakes: number;
  streak: number;
  stars: number;
  rated: number;
  score: number;
  /** How the last customer went: whether it was right, the stars they left, and what was wrong. */
  last: { ok: number; stars: number; notes: string[] } | null;
  events: ArcadeEvent[];
}

const NAMES = ["Earl", "Wanda", "Dale", "Loretta", "Hoyt", "Bonnie", "Vern", "Tammy", "Gus", "Nadine", "Lyle", "Darlene", "Chet", "Opal", "Rusty", "Maxine"];
const HELLOS = ["Morning.", "Hey there.", "How's it going?", "Hope you can help me.", "Quick one for you.", "Alright,"];
const SHOPS = ["Hillside Garage", "Twin Forks Auto", "Ridge Runner Repair", "Potomac Tire & Lube"];

const say = (s: CounterState, kind: string, more: Partial<ArcadeEvent> = {}) => { s.events.push({ kind, x: 0, y: 0, ...more }); };

/** Somebody new walks in, wanting something. */
function arrive(s: CounterState) {
  const rand = nextRandom(s);
  const pick = (n: number) => Math.floor(rand() * n);
  const rush = RUSH[s.rules.rush];
  const wait = rush.wait * COUNTER_RATE;
  const who: Customer = { id: s.nextId++, name: pick(NAMES.length), hello: pick(HELLOS.length), kind: "sale", patience: wait, wait, wants: [], coreBack: 0, level: 0, cash: 0, tender: 0, days: 0, opened: 0, defective: 0 };
  const vehicle = pick(COUNTER_VEHICLES.length);
  const grade = pick(2);
  const skuOf = (line: number) => COUNTER_PARTS[(vehicle * PART_LINES.length + line) * 2 + grade]!.sku;
  const count = (line: number) => (PART_LINES[line]!.count === "pair" ? 2 : PART_LINES[line]!.count === "cylinders" ? COUNTER_VEHICLES[vehicle]!.cylinders : 1);
  const first = pick(PART_LINES.length);
  if (pick(100) < rush.returns) {
    who.kind = "return";
    who.wants = [{ sku: skuOf(first), qty: 1 }];
    // Half are inside the thirty days, the rest anywhere up to a year and a bit.
    who.days = pick(2) ? 1 + pick(COUNTER_POLICY.refundDays) : COUNTER_POLICY.refundDays + 1 + pick(400);
    who.defective = pick(3) === 0 ? 1 : 0;
    who.opened = who.defective || pick(2) ? 1 : 0;
  } else {
    who.wants = [{ sku: skuOf(first), qty: count(first) }];
    if (rush.most > 1 && pick(3) === 0) {
      const second = (first + 1 + pick(PART_LINES.length - 1)) % PART_LINES.length;
      who.wants.push({ sku: skuOf(second), qty: count(second) });
    }
    who.coreBack = pick(2);
    who.level = pick(100) < rush.shops ? 1 + (pick(4) === 0 ? 1 : 0) : 0;
    // A shop's account goes on a card; anyone else may well pay in cash, with whatever notes cover it.
    who.cash = who.level === 0 && pick(5) < 3 ? 1 : 0;
    if (who.cash) {
      const total = counterTotals(who.wants, who.coreBack === 1, who.level).total;
      const note = [100, 500, 1000, 2000][pick(4)]!;
      who.tender = Math.floor((total + note - 1) / note) * note;
    }
  }
  s.line.push(who);
  say(s, "arrive", { text: NAMES[who.name]! });
}

/** The customer at the counter is done with, one way or another. */
function finish(s: CounterState, notes: string[], amount: number) {
  const who = s.line.shift()!;
  const left = Math.floor((who.patience * 100) / who.wait);
  const ok = notes.length === 0;
  const stars = ok ? (left > 60 ? 5 : left > 30 ? 4 : 3) : Math.max(1, 3 - notes.length);
  if (ok) {
    const gain = 100 + left + 10 * Math.min(s.streak, 10);
    s.score += gain;
    s.streak++;
    s.served++;
    s.till += amount;
    say(s, who.kind === "sale" ? "sale" : "sorted", { amount: gain, text: `+${gain}` });
  } else {
    s.mistakes += notes.length;
    s.score = Math.max(0, s.score - 25 * notes.length);
    s.streak = 0;
    s.served++;
    say(s, "wrong", { text: "What are YOOOOOU doing?" });
  }
  s.stars += stars;
  s.rated++;
  s.last = { ok: ok ? 1 : 0, stars, notes };
  s.ticket = { lines: [], coreBack: 0, level: 0 };
  s.pause = 8;
}

const same = (a: readonly { sku: string; qty: number }[], b: readonly { sku: string; qty: number }[]) => a.length === b.length && a.every((line) => b.some((other) => other.sku === line.sku && other.qty === line.qty));

function carryOut(s: CounterState, input: CounterInput) {
  const who = s.line[0];
  const t = s.ticket;
  if (input.do === "ring") {
    if (!BY_SKU.has(input.sku)) return;
    t.lines = t.lines.filter((line) => line.sku !== input.sku);
    if (t.lines.length < 6) t.lines.push({ sku: input.sku, qty: input.qty });
    say(s, "ring");
  } else if (input.do === "void") {
    t.lines = t.lines.filter((line) => line.sku !== input.sku);
    say(s, "void");
  } else if (input.do === "core") t.coreBack = input.on ? 1 : 0;
  else if (input.do === "level") t.level = input.level;
  else if (!who || s.pause > 0) return;
  else if (input.do === "cash" || input.do === "card") {
    const notes: string[] = [];
    if (who.kind !== "sale") notes.push("They were bringing a part back, not buying one.");
    else {
      if (!same(t.lines, who.wants)) notes.push("The parts on the ticket were not what was asked for.");
      const cored = who.wants.some((line) => BY_SKU.get(line.sku)!.core > 0);
      if (cored && t.coreBack !== who.coreBack) notes.push(who.coreBack ? "They brought the old one back: no core charge." : "No old part came back: the core should have been charged.");
      if (t.level !== who.level) notes.push(`That was a ${COUNTER_LEVEL_NAMES[who.level]!.toLowerCase()} price.`);
      if ((input.do === "cash") !== (who.cash === 1)) notes.push(who.cash ? "They were paying cash." : "They were paying by card.");
      else if (who.cash) {
        const due = Math.max(0, who.tender - counterTotals(t.lines, t.coreBack === 1, t.level).total);
        if (input.cents !== due) notes.push(`The change was ${dollars(due)}, not ${dollars(input.cents)}.`);
      }
    }
    finish(s, notes, counterTotals(t.lines, t.coreBack === 1, t.level).total);
  } else {
    const notes: string[] = [];
    if (who.kind !== "return") notes.push("They came to buy, not to bring something back.");
    else {
      const ruling = counterRuling(who.days, who.opened === 1, who.defective === 1);
      if (ruling !== input.do) notes.push(ruling === "refund" ? "Unopened and inside thirty days: that was a refund." : ruling === "exchange" ? "Defective and under warranty: that was an exchange." : who.defective ? "The warranty had run out: that one is refused." : who.opened ? "Opened and not defective: that one is refused." : "Past thirty days: that one is refused.");
    }
    finish(s, notes, 0);
  }
}

function step(s: CounterState, inputs: readonly (CounterInput | null | undefined)[]) {
  if (s.phase !== "open") return;
  const input = safe(inputs[0]);
  s.tick++;
  s.events = [];
  if (s.pause > 0) s.pause--;
  if (input.n !== s.seq) {
    s.seq = input.n;
    carryOut(s, input);
  }
  // Everyone in line gets a little less patient, the one being served slowest of all.
  for (const who of [...s.line]) {
    if (who === s.line[0] && s.tick % 2) continue;
    if (--who.patience > 0) continue;
    const front = who === s.line[0];
    s.line = s.line.filter((other) => other !== who);
    s.walked++;
    s.streak = 0;
    s.stars += 1;
    s.rated++;
    if (front) { s.ticket = { lines: [], coreBack: 0, level: 0 }; s.last = { ok: 0, stars: 1, notes: [`${NAMES[who.name]} got tired of waiting and left.`] }; s.pause = 8; }
    say(s, "walk", { text: NAMES[who.name]! });
  }
  if (--s.arrives <= 0) {
    if (s.line.length < MOST_IN_LINE) arrive(s);
    const rand = nextRandom(s);
    const gap = RUSH[s.rules.rush].gap * COUNTER_RATE;
    s.arrives = Math.floor(gap / 2) + Math.floor(rand() * gap);
  }
  if (s.tick >= s.rules.shift * COUNTER_RATE) {
    s.phase = "closed";
    say(s, "over", { text: "Living that dream." });
  }
}

// ---- What everyone sees ---------------------------------------------------------------------------

/** What the customer at the counter says: everything needed to serve them is in it, and nothing else is told. */
function words(who: Customer): string {
  const part = BY_SKU.get(who.wants[0]!.sku)!;
  const car = COUNTER_VEHICLES[part.vehicle]!;
  if (who.kind === "return") {
    const state = who.defective ? "It quit on me." : who.opened ? "I opened it up, and it's not what I need." : "Never opened it.";
    return `${HELLOS[who.hello]} I need to bring this ${part.name.toLowerCase()} back. Bought it ${who.days} ${who.days === 1 ? "day" : "days"} ago. ${state}`;
  }
  const asked = who.wants.map((line) => PART_LINES[BY_SKU.get(line.sku)!.line]!.asked).join(" and ");
  const grade = part.grade ? "The good stuff." : "Cheapest you've got.";
  const cored = who.wants.some((line) => BY_SKU.get(line.sku)!.core > 0);
  const core = !cored ? "" : who.coreBack ? " Got the old one right here." : " I'll bring the old one in later.";
  const level = who.level === 0 ? "" : ` Put it on the ${who.level === 2 ? "wholesale" : "shop"} account, ${SHOPS[who.id % SHOPS.length]}.`;
  const pay = who.level > 0 ? "" : who.cash ? ` Here's ${dollars(who.tender)}.` : " I'll put it on the card.";
  return `${HELLOS[who.hello]} I need ${asked} for a ${car.year} ${car.make} ${car.model}, the ${car.engine}. ${grade}${core}${level}${pay}`;
}

function view(s: CounterState): ArcadeView {
  const who = s.pause > 0 ? undefined : s.line[0];
  const totals = counterTotals(s.ticket.lines, s.ticket.coreBack === 1, s.ticket.level);
  const left = Math.max(0, s.rules.shift - Math.floor(s.tick / COUNTER_RATE));
  const counter: ArcadeCounter = {
    seconds: left,
    shift: s.rules.shift,
    line: s.line.map((c) => ({ id: c.id, name: NAMES[c.name]!, face: c.name, mood: Math.floor((c.patience * 1000) / c.wait), kind: c.kind })),
    says: who ? words(who) : "",
    asks: who ? who.kind : null,
    tender: who && who.kind === "sale" && who.cash ? who.tender : null,
    returning: who && who.kind === "return" ? { sku: who.wants[0]!.sku, name: BY_SKU.get(who.wants[0]!.sku)!.name, days: who.days } : null,
    ticket: {
      lines: s.ticket.lines.map((line) => { const part = BY_SKU.get(line.sku)!; return { sku: line.sku, name: `${part.name} (${part.grade_name})`, qty: line.qty, each: part.price, amount: part.price * line.qty }; }),
      ...totals,
      coreBack: s.ticket.coreBack === 1,
      level: s.ticket.level,
      change: s.rules.drawer && who && who.kind === "sale" && who.cash ? Math.max(0, who.tender - totals.total) : null,
    },
    till: s.till,
    served: s.served,
    walked: s.walked,
    mistakes: s.mistakes,
    streak: s.streak,
    stars: s.rated ? Math.floor((s.stars * 10) / s.rated) : 0,
    last: s.last ? { ok: s.last.ok === 1, stars: s.last.stars, notes: s.last.notes } : null,
    seq: s.seq,
  };
  return {
    game: "counter",
    tick: s.tick,
    rate: COUNTER_RATE,
    seats: 1,
    field: { width: 1000, height: 1000 },
    things: [],
    pilots: [{ seat: 0, playing: s.phase === "open", score: s.score, lives: 1, stats: [{ key: "served", label: "Served", value: s.served }, { key: "till", label: "Drawer", value: s.till }] }],
    score: s.score,
    stage: s.rules.name,
    counter,
    events: s.events,
    over: s.phase !== "open",
  };
}

// ---- A computer player ----------------------------------------------------------------------------

/** It reads the customer's mind, which is cheating, and takes its time, which is not. A sloppy one fumbles the change. */
function bot(s: CounterState, _seat: number, style: PlayStyle, rand: () => number = Math.random): CounterInput {
  const hold: CounterInput = { ...IDLE, n: s.seq };
  const who = s.line[0];
  const think = 6 + Math.round((1 - (style.skill ?? 0.7)) * 14);
  if (s.phase !== "open" || !who || s.pause > 0 || s.tick % think !== 0) return hold;
  const act = (more: Partial<CounterInput>): CounterInput => ({ ...IDLE, n: s.seq + 1, ...more });
  if (who.kind === "return") return act({ do: counterRuling(who.days, who.opened === 1, who.defective === 1) });
  const t = s.ticket;
  const extra = t.lines.find((line) => !who.wants.some((want) => want.sku === line.sku));
  if (extra) return act({ do: "void", sku: extra.sku });
  const missing = who.wants.find((want) => !t.lines.some((line) => line.sku === want.sku && line.qty === want.qty));
  if (missing) return act({ do: "ring", sku: missing.sku, qty: missing.qty });
  if (t.coreBack !== who.coreBack) return act({ do: "core", on: who.coreBack === 1 });
  if (t.level !== who.level) return act({ do: "level", level: who.level });
  if (!who.cash) return act({ do: "card" });
  const due = who.tender - counterTotals(t.lines, t.coreBack === 1, t.level).total;
  return act({ do: "cash", cents: rand() < (style.sloppy ?? 0.1) * 0.5 ? due + 100 : due });
}

// ---- The game -------------------------------------------------------------------------------------

const whole = (n: unknown, low: number, high: number, or: number) => (typeof n === "number" && Number.isFinite(n) ? Math.min(high, Math.max(low, Math.trunc(n))) : or);

function safe(given: unknown): CounterInput {
  const g = (given && typeof given === "object" ? given : {}) as Partial<Record<keyof CounterInput, unknown>>;
  return {
    n: whole(g.n, 0, 1_000_000_000, 0),
    do: DOES.includes(g.do as Does) ? (g.do as Does) : "none",
    sku: typeof g.sku === "string" && BY_SKU.has(g.sku) ? g.sku : "",
    qty: whole(g.qty, 1, 12, 1),
    on: g.on === true,
    level: whole(g.level, 0, COUNTER_LEVELS.length - 1, 0),
    cents: whole(g.cents, 0, 10_000_000, 0),
  };
}

function normalize(rules: unknown): CounterRules {
  const given = (rules && typeof rules === "object" ? rules : {}) as Partial<CounterRules>;
  const preset = COUNTER_PRESETS.find((p) => p.id === given.id) ?? COUNTER_PRESETS[0]!;
  return {
    id: typeof given.id === "string" ? given.id : preset.id,
    name: typeof given.name === "string" && given.name ? given.name : preset.name,
    shift: whole(given.shift, 60, 600, preset.shift),
    rush: given.rush === "slow" || given.rush === "steady" || given.rush === "slammed" ? given.rush : preset.rush,
    drawer: typeof given.drawer === "boolean" ? given.drawer : preset.drawer,
  };
}

function summary(s: CounterState): ArcadeSummary {
  return {
    game: "counter",
    rules: s.rules.name,
    phase: s.phase,
    over: s.phase !== "open",
    seats: 1,
    ticks: s.tick,
    score: s.score,
    scores: [s.score],
    scoreLine: `${s.served} served · ${s.walked} walked out · ${dollars(s.till)} in the drawer · ${points(s.score)}`,
    order: [0],
  };
}

export const delbiesCounter: ArcadeGame<CounterRules, CounterState, CounterInput> = {
  id: "counter",
  name: "Delbie's Counter",
  emoji: "🧾",
  category: "arcade",
  blurb: "A shift behind the parts counter: look it up, ring it up, make the change, and keep the line moving.",
  tagline: "Welcome to the Daycare. The line is out the door and Delbie is watching.",
  seats: { min: 1, max: 1, default: 1 },
  teams: false,
  presets: COUNTER_PRESETS,
  fields: [
    { key: "shift", label: "Shift", hint: "How long it lasts, in seconds", kind: "number", min: 60, max: 600 },
    { key: "rush", label: "Rush", hint: "How fast they come in, and how long they will wait", kind: "choice", options: [["slow", "Slow"], ["steady", "Steady"], ["slammed", "Slammed"]] },
    { key: "drawer", label: "The register makes change", hint: "Off, and the change is yours to work out", kind: "toggle" },
  ],
  normalize,
  validate(rules) {
    const problems: string[] = [];
    if (!Number.isInteger(rules.shift) || rules.shift < 60 || rules.shift > 600) problems.push("A shift is 60 to 600 seconds.");
    if (!["slow", "steady", "slammed"].includes(rules.rush)) problems.push("The rush is slow, steady or slammed.");
    return problems;
  },
  describe(rules) {
    return [
      "Each customer says what they need. Look the part up for their car, in the grade they asked for, and ring up the right number: rotors, wipers and bulbs come in pairs, and a set of plugs is one a cylinder.",
      "Batteries, alternators and starters carry a core charge unless the old one came back. A shop or wholesale account gets its price.",
      rules.drawer ? "Cash gets change, and the register works it out." : "Cash gets change, to the penny, and working it out is on you.",
      `A part brought back unopened inside ${COUNTER_POLICY.refundDays} days is refunded. A defective one inside a year is exchanged. Anything else is refused.`,
      `The shift is ${rules.shift} seconds. Quick and right earns the most; a mistake costs, and so does anyone who gives up and walks out.`,
    ];
  },
  controls: [
    "Pick the customer's car, then find the part: type a few letters of it",
    "Set how many and add it to the ticket",
    "Switch the core off if the old part came back, and set the price level",
    "Card, or cash with the change, finishes the sale",
    "For a part brought back: refund, exchange or refuse",
  ],
  rate: COUNTER_RATE,
  newGame(rules, _seats, seed) {
    return { rules, seats: 1, rng: (seed ^ 0x0c7a) >>> 0, tick: 0, phase: "open", line: [], nextId: 1, arrives: 10, pause: 0, ticket: { lines: [], coreBack: 0, level: 0 }, seq: 0, till: 0, served: 0, walked: 0, mistakes: 0, streak: 0, stars: 0, rated: 0, score: 0, last: null, events: [] };
  },
  idle: IDLE,
  input: safe,
  step,
  view,
  bot,
  summary,
};
