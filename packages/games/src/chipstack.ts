// Chip Stack: an idle clicker against the clock, the third game on the arcade kit. Tap the chip to
// earn chips, spend them on things that earn chips by themselves, and see how high the stack is
// when the time runs out. The score is every chip earned in the run.
//
// An idle game with no end has nothing to beat, so this one has a clock, and the clock is what makes
// the choices hard:
//   - Everything bought costs more the next time, and pays for itself more slowly. What to buy,
//     and when to stop saving for the next big thing, is the game.
//   - Tapping fast builds heat, and heat multiplies a tap up to three times over. Let it cool and
//     it is gone.
//   - A golden chip turns up now and then for a few seconds. Catch it for a frenzy (everything
//     times seven) or a windfall.
//   - Cashing out sells the lot for stars, each worth a tenth more on everything for the rest of
//     the run. Worth it early; ruinous late.
//
// One to four people tap the same chip into the same bank.
//
// The bank is kept in sixtieths of a chip, so that "chips a second" is a whole number of sixtieths
// a tick and nothing is ever rounded. A seat's input is a command with a number on it, carried out
// once, on the tick its number is first seen (as in Tower of Ryan).
import type { PlayStyle } from "@journey-to-code/rules";
import { shortly, type ArcadeEvent, type ArcadeGame, type ArcadeMarket, type ArcadeSummary, type ArcadeThing, type ArcadeView } from "./arcade.js";
import { nextRandom, who, type BaseRules } from "./table.js";

export const CHIPSTACK_FIELD = { width: 6000, height: 3600 };
const W = CHIPSTACK_FIELD.width;
const H = CHIPSTACK_FIELD.height;
const RATE = 60;
/** The bank's unit: this many to a chip. */
const UNIT = 60;
/** Nothing is ever worth more than this many sixtieths: every number stays one a machine can hold exactly. */
const CEILING = 9_000_000_000_000_000;
/** Ticks between taps that count: fifteen a second at most, however fast the finger. */
const TAP_EVERY = 4;
const HEAT_MAX = 100;
const FRENZY_TICKS = RATE * 12;
const GOLDEN_TICKS = RATE * 9;
/** Chips to have earned since the last cash-out before there is anything to cash out. */
const CASH_FROM = 250_000;
const TONES = ["blue", "red", "green", "gold"];

export interface ChipStackRules extends BaseRules {
  /** How long a run lasts. */
  minutes: number;
  /** Golden chips turn up to be caught. */
  golden: boolean;
  /** Fast tapping builds heat, which multiplies a tap. */
  heat: boolean;
}

export const CHIPSTACK_PRESETS: ChipStackRules[] = [
  { id: "classic", name: "Classic", minutes: 8, golden: true, heat: true },
  { id: "sprint", name: "Sprint", minutes: 3, golden: true, heat: true },
  { id: "marathon", name: "Marathon", minutes: 20, golden: true, heat: true },
  { id: "purist", name: "Purist", minutes: 8, golden: false, heat: false },
];

/** What earns chips by itself: what the first costs, and what each brings in a second. */
const EARNERS: { key: string; label: string; cost: number; cps: number }[] = [
  { key: "shark", label: "Card shark", cost: 15, cps: 1 },
  { key: "dice", label: "Dice table", cost: 120, cps: 6 },
  { key: "slot", label: "Slot machine", cost: 960, cps: 36 },
  { key: "wheel", label: "Roulette wheel", cost: 7_700, cps: 216 },
  { key: "room", label: "Poker room", cost: 61_000, cps: 1_300 },
  { key: "lounge", label: "High-roller lounge", cost: 490_000, cps: 7_800 },
  { key: "casino", label: "Casino", cost: 3_900_000, cps: 46_000 },
  { key: "resort", label: "Resort", cost: 31_000_000, cps: 280_000 },
  { key: "strip", label: "Neon strip", cost: 250_000_000, cps: 1_700_000 },
  { key: "island", label: "Private island", cost: 2_000_000_000, cps: 10_000_000 },
];
// Each one costs about eight times the one before and earns about six times as much, so the next
// thing up always takes a little longer to pay for itself: there is always something worth saving for.
/** An earner can be boosted three times, each doubling it: how many it takes to own, and what it costs in first-costs. */
const BOOSTS: { need: number; times: number }[] = [
  { need: 10, times: 20 },
  { need: 25, times: 200 },
  { need: 50, times: 2_000 },
];
/** What each tap power-up costs: ten times the one before. */
const POWER_COSTS = [100, 1_000, 10_000, 100_000, 1_000_000, 10_000_000, 100_000_000, 1_000_000_000];
const MAX_POWER = POWER_COSTS.length;
const powerCost = (level: number) => POWER_COSTS[level] ?? POWER_COSTS[MAX_POWER - 1]!;

/** What a seat asks for. It is carried out on the tick its `n` is first seen, and not again. */
export interface ChipStackInput {
  /** A number that is different for every command a seat gives: one more each time will do. */
  n: number;
  /** tap the chip; buy an earner; boost an earner; power up the tap; catch the golden chip; cash out. */
  cmd: "none" | "tap" | "buy" | "boost" | "power" | "catch" | "cashout";
  /** For buy and boost: which earner, from 0. */
  item: number;
}

interface Earner {
  count: number;
  /** What the next one costs, in chips. */
  cost: number;
  /** Boosts bought, 0 to 3. */
  boosts: number;
}

export interface ChipStackState {
  rules: ChipStackRules;
  seats: number;
  rng: number;
  tick: number;
  /** The tick the run ends on. */
  ends: number;
  phase: "play" | "over";
  /** In sixtieths of a chip, like everything that is counted in chips below. */
  bank: number;
  /** Every chip earned in the run: the score. */
  earned: number;
  /** Earned since the last cash-out: what the next cash-out is worth. */
  sinceCash: number;
  earners: Earner[];
  /** Tap power-ups bought: each doubles a tap. */
  power: number;
  stars: number;
  heat: number;
  /** Ticks until each seat's next tap counts. */
  tapCool: number[];
  /** What each seat's own taps have earned. */
  tapped: number[];
  taps: number[];
  golden: { id: number; x: number; y: number; until: number } | null;
  /** The tick the next golden chip turns up. */
  nextGolden: number;
  /** Ticks of frenzy left. */
  frenzy: number;
  caught: number;
  nextId: number;
  seen: number[];
  events: ArcadeEvent[];
}

const IDLE: ChipStackInput = { n: 0, cmd: "none", item: 0 };
const CMDS = ["none", "tap", "buy", "boost", "power", "catch", "cashout"];
const clamp = (n: number, low: number, high: number) => (n < low ? low : n > high ? high : n);
const whole = (n: unknown) => (typeof n === "number" && Number.isFinite(n) ? Math.trunc(n) + 0 : 0);

function safeInput(given: unknown): ChipStackInput {
  if (!given || typeof given !== "object") return IDLE;
  const g = given as Record<string, unknown>;
  return { n: clamp(whole(g.n), 0, 2 ** 31 - 1), cmd: CMDS.includes(g.cmd as string) ? (g.cmd as ChipStackInput["cmd"]) : "none", item: clamp(whole(g.item), 0, EARNERS.length - 1) };
}

function say(s: ChipStackState, kind: string, x: number, y: number, more: Partial<ArcadeEvent> = {}) {
  if (s.events.length < 60) s.events.push({ kind, x, y, ...more });
}

/** Chips a second from everything owned, before a frenzy. */
function income(s: ChipStackState): number {
  let total = 0;
  s.earners.forEach((e, i) => (total += e.count * EARNERS[i]!.cps * (1 << e.boosts)));
  return Math.min(CEILING / UNIT / 8, Math.floor((total * (10 + s.stars)) / 10));
}
const frenzied = (s: ChipStackState) => (s.frenzy > 0 ? 7 : 1);
/** What a tap is worth now, in sixtieths: a chip (doubled by each power-up) and a hundredth of what comes in each second, and more with heat. */
function tapWorth(s: ChipStackState): number {
  const base = (1 << s.power) + Math.floor(income(s) / 100);
  return Math.min(CEILING / 64, Math.floor((base * UNIT * (HEAT_MAX + s.heat * 2) * (10 + s.stars) * frenzied(s)) / (HEAT_MAX * 10)));
}
/** Stars a cash-out would give now. */
function starsFor(s: ChipStackState): number {
  const chips = Math.floor(s.sinceCash / UNIT);
  return chips < CASH_FROM ? 0 : Math.floor(Math.sqrt(chips / 250_000));
}
function gain(s: ChipStackState, sixtieths: number) {
  s.bank = Math.min(CEILING, s.bank + sixtieths);
  s.earned = Math.min(CEILING, s.earned + sixtieths);
  s.sinceCash = Math.min(CEILING, s.sinceCash + sixtieths);
}
const boostCost = (i: number, boosts: number) => EARNERS[i]!.cost * BOOSTS[boosts]!.times;
const freshEarners = (): Earner[] => EARNERS.map((e) => ({ count: 0, cost: e.cost, boosts: 0 }));

function obey(s: ChipStackState, seat: number, input: ChipStackInput) {
  const refuse = (text: string) => say(s, "nope", W / 2, H - 400, { seat, text });
  const pay = (chips: number) => {
    if (s.bank < chips * UNIT) return false;
    s.bank -= chips * UNIT;
    return true;
  };
  switch (input.cmd) {
    case "tap": {
      if (s.tapCool[seat]! > 0) return;
      s.tapCool[seat] = TAP_EVERY;
      const worth = tapWorth(s);
      gain(s, worth);
      s.tapped[seat] = Math.min(CEILING, s.tapped[seat]! + worth);
      s.taps[seat] = s.taps[seat]! + 1;
      if (s.rules.heat) s.heat = Math.min(HEAT_MAX, s.heat + 10);
      // Where the number floats up from moves about, so a run of taps reads as a run.
      const n = s.taps[seat]!;
      say(s, "tap", W / 2 + ((n * 7919) % 1400) - 700, H / 2 - 500 - ((n * 104729) % 500), { seat, amount: Math.floor(worth / UNIT), text: `+${shortly(Math.floor(worth / UNIT))}` });
      return;
    }
    case "buy": {
      const e = s.earners[input.item]!;
      if (!pay(e.cost)) return refuse("Not enough chips");
      e.count++;
      e.cost = Math.min(CEILING / UNIT, Math.ceil((e.cost * 115) / 100));
      say(s, "buy", W / 2, H / 2, { seat, amount: input.item });
      return;
    }
    case "boost": {
      const e = s.earners[input.item]!;
      const next = BOOSTS[e.boosts];
      if (!next) return refuse("As good as it gets");
      if (e.count < next.need) return refuse(`Needs ${next.need} of them`);
      if (!pay(boostCost(input.item, e.boosts))) return refuse("Not enough chips");
      e.boosts++;
      say(s, "boost", W / 2, H / 2, { seat, amount: input.item });
      return;
    }
    case "power": {
      if (s.power >= MAX_POWER) return refuse("As good as it gets");
      if (!pay(powerCost(s.power))) return refuse("Not enough chips");
      s.power++;
      say(s, "boost", W / 2, H / 2, { seat });
      return;
    }
    case "catch": {
      if (!s.golden) return;
      const { x, y } = s.golden;
      s.golden = null;
      s.caught++;
      const rand = nextRandom(s);
      if (rand() < 0.5) {
        s.frenzy = FRENZY_TICKS;
        say(s, "frenzy", x, y, { seat, text: "Frenzy ×7" });
      } else {
        // A windfall: forty seconds of what comes in by itself, and never nothing.
        const windfall = income(s) * UNIT * 40 + 77 * UNIT;
        gain(s, windfall);
        say(s, "lucky", x, y, { seat, amount: Math.floor(windfall / UNIT), text: `Lucky +${shortly(Math.floor(windfall / UNIT))}` });
      }
      return;
    }
    case "cashout": {
      const stars = starsFor(s);
      if (stars < 1) return refuse(`Earn ${shortly(CASH_FROM)} first`);
      s.stars += stars;
      s.bank = 0;
      s.sinceCash = 0;
      s.earners = freshEarners();
      s.power = 0;
      s.heat = 0;
      say(s, "cashout", W / 2, H / 2, { seat, amount: stars, text: `Cashed out: +${stars} ${stars === 1 ? "star" : "stars"}` });
      return;
    }
  }
}

function step(s: ChipStackState, inputs: readonly (ChipStackInput | null | undefined)[]) {
  if (s.phase === "over") return;
  s.tick++;
  s.events = [];
  for (let seat = 0; seat < s.seats; seat++) {
    if (s.tapCool[seat]! > 0) s.tapCool[seat] = s.tapCool[seat]! - 1;
    const input = safeInput(inputs[seat]);
    if (input.n === s.seen[seat]) continue;
    s.seen[seat] = input.n;
    if (input.cmd !== "none") obey(s, seat, input);
  }

  // What comes in by itself: chips a second is that many sixtieths a tick.
  const coming = income(s) * frenzied(s);
  if (coming > 0) gain(s, coming);
  if (s.frenzy > 0) s.frenzy--;
  if (s.heat > 0 && s.tick % 2 === 0) s.heat--;

  if (s.rules.golden) {
    if (s.golden && s.tick >= s.golden.until) {
      s.golden = null;
      say(s, "golden-gone", W / 2, H / 2);
    }
    if (!s.golden && s.tick >= s.nextGolden) {
      const rand = nextRandom(s);
      s.golden = { id: s.nextId++, x: 700 + Math.floor(rand() * (W - 1400)), y: 500 + Math.floor(rand() * (H - 1000)), until: s.tick + GOLDEN_TICKS };
      s.nextGolden = s.golden.until + RATE * (14 + Math.floor(rand() * 20));
      say(s, "golden", s.golden.x, s.golden.y);
    }
  }

  if (s.tick >= s.ends) {
    s.phase = "over";
    s.golden = null;
    say(s, "over", W / 2, H / 2);
  }
}

// ---- The view ------------------------------------------------------------------------------------

function marketOf(s: ChipStackState): ArcadeMarket {
  const bank = Math.floor(s.bank / UNIT);
  const items: ArcadeMarket["items"] = [];
  const times = (10 + s.stars) / 10;
  s.earners.forEach((e, i) => {
    const each = EARNERS[i]!.cps * (1 << e.boosts);
    // Earners come into view as the one before is owned, so the list grows with the stack.
    if (i > 0 && e.count === 0 && s.earners[i - 1]!.count === 0) return;
    items.push({ key: `buy:${i}`, group: "Earners", label: EARNERS[i]!.label, hint: `${shortly(Math.floor(each * times))} a second each`, cost: e.cost, owned: e.count, can: bank >= e.cost });
  });
  if (s.power < MAX_POWER) items.push({ key: "power", group: "Boosts", label: `Heavier chip ${s.power + 1}`, hint: "Doubles the chip you tap", cost: powerCost(s.power), can: bank >= powerCost(s.power) });
  s.earners.forEach((e, i) => {
    const next = BOOSTS[e.boosts];
    if (!next || e.count < next.need) return;
    const cost = boostCost(i, e.boosts);
    items.push({ key: `boost:${i}`, group: "Boosts", label: `Better ${EARNERS[i]!.label.toLowerCase()}s`, hint: `Doubles every ${EARNERS[i]!.label.toLowerCase()}`, cost, can: bank >= cost });
  });
  const stars = starsFor(s);
  if (stars > 0) items.push({ key: "cashout", group: "Cash out", label: `Cash out for ${stars} ${stars === 1 ? "star" : "stars"}`, hint: `Sells everything. Each star is +10% on everything for the rest of the run`, cost: 0, can: true });
  const badges: ArcadeMarket["badges"] = [];
  if (s.frenzy > 0) badges.push({ key: "frenzy", label: "Frenzy ×7", tone: "gold", ticksLeft: s.frenzy });
  if (s.stars > 0) badges.push({ key: "stars", label: `${s.stars} ${s.stars === 1 ? "star" : "stars"} · +${s.stars * 10}%`, tone: "purple" });
  if (s.heat >= 50) badges.push({ key: "heat", label: `Hot ×${(1 + s.heat / 50).toFixed(1)}`, tone: "red" });
  return { bank, perSecond: income(s) * frenzied(s), perTap: Math.floor(tapWorth(s) / UNIT), items, ticksLeft: Math.max(0, s.ends - s.tick), badges };
}

function view(s: ChipStackState): ArcadeView {
  const things: ArcadeThing[] = [{ id: -1, kind: "chip", x: W / 2, y: H / 2, r: 1050, tone: s.frenzy > 0 ? "gold" : "red", level: s.power + 1, ...(s.heat > 0 ? { health: s.heat * 10 } : {}) }];
  if (s.golden) things.push({ id: s.golden.id, kind: "golden", x: s.golden.x, y: s.golden.y, r: 330, tone: "gold", health: Math.round(((s.golden.until - s.tick) * 1000) / GOLDEN_TICKS) });
  const left = Math.max(0, s.ends - s.tick);
  const clock = `${Math.floor(left / RATE / 60)}:${String(Math.floor(left / RATE) % 60).padStart(2, "0")}`;
  return {
    game: "chipstack",
    tick: s.tick,
    rate: RATE,
    seats: s.seats,
    field: CHIPSTACK_FIELD,
    things,
    pilots: s.tapped.map((tapped, seat) => ({
      seat,
      playing: s.phase === "play",
      score: Math.floor(tapped / UNIT),
      lives: 0,
      stats: [
        { key: "taps", label: "Taps", value: s.taps[seat]! },
        { key: "heat", label: "Heat", value: s.heat * 10, max: 1000 },
      ],
    })),
    score: Math.floor(s.earned / UNIT),
    stage: s.phase === "over" ? "Time" : clock,
    ...(left <= RATE * 10 && left > 0 && left % RATE > RATE / 2 ? { banner: String(Math.ceil(left / RATE)) } : {}),
    ...(s.phase === "over" ? { banner: "Time!" } : {}),
    market: marketOf(s),
    events: s.events,
    over: s.phase === "over",
  };
}

// ---- The computer player -------------------------------------------------------------------------

/**
 * A computer player: it taps, catches the golden chip when it sees one, and buys whatever pays for
 * itself soonest as soon as it can. A sloppy one taps less and sometimes misses the gold.
 */
function bot(s: ChipStackState, seat: number, style: PlayStyle, rand: () => number = Math.random): ChipStackInput {
  if (s.phase === "over" || seat >= s.seats) return IDLE;
  const held = { ...IDLE, n: s.seen[seat] ?? 0 };
  const act = (cmd: ChipStackInput["cmd"], item = 0): ChipStackInput => ({ n: (s.seen[seat] ?? 0) + 1, cmd, item });
  const skill = style.skill ?? 0.7;
  const sloppy = style.sloppy ?? 0.05;
  if (s.golden && rand() > sloppy && s.golden.until - s.tick < GOLDEN_TICKS - 30 - Math.round((1 - skill) * 200)) return act("catch");
  // Shopping is the first seat's job, a few times a second: two hands in one till only get in each other's way.
  if (seat === 0 && s.tick % 10 === 0) {
    const bank = Math.floor(s.bank / UNIT);
    const left = (s.ends - s.tick) / RATE;
    let best: ChipStackInput | null = null;
    let bestPayback = Infinity;
    const cps = Math.max(1, income(s));
    for (let i = 0; i < s.earners.length; i++) {
      const e = s.earners[i]!;
      const each = EARNERS[i]!.cps * (1 << e.boosts);
      const payback = e.cost / each;
      if (payback < bestPayback && payback < left) {
        bestPayback = payback;
        best = bank >= e.cost ? act("buy", i) : null;
      }
      const next = BOOSTS[e.boosts];
      if (next && e.count >= next.need) {
        const cost = boostCost(i, e.boosts);
        const back = cost / Math.max(1, e.count * each);
        if (back < bestPayback && back < left) {
          bestPayback = back;
          best = bank >= cost ? act("boost", i) : null;
        }
      }
    }
    if (s.power < MAX_POWER && powerCost(s.power) < cps * 20 && bank >= powerCost(s.power)) return act("power");
    if (best) return best;
  }
  if (s.tapCool[seat] === 0 && rand() > sloppy * 2 + (1 - skill) * 0.4) return act("tap");
  return held;
}

// ---- The game ------------------------------------------------------------------------------------

function summary(s: ChipStackState): ArcadeSummary {
  const score = Math.floor(s.earned / UNIT);
  const scores = s.tapped.map((n) => Math.floor(n / UNIT));
  return {
    game: "chipstack",
    rules: s.rules.name,
    phase: s.phase === "over" ? "over" : "stacking",
    over: s.phase === "over",
    seats: s.seats,
    ticks: s.tick,
    score,
    scores,
    scoreLine: s.seats > 1 ? `${shortly(score)} chips (${scores.map((n, seat) => `${who(seat)} tapped ${shortly(n)}`).join(" · ")})` : `${shortly(score)} chips`,
    order: scores.map((n, seat) => ({ n, seat })).sort((a, b) => b.n - a.n || a.seat - b.seat).map((e) => e.seat),
  };
}

function normalize(rules: unknown): ChipStackRules {
  const given = (rules && typeof rules === "object" ? rules : {}) as Partial<ChipStackRules>;
  const preset = CHIPSTACK_PRESETS.find((p) => p.id === given.id) ?? CHIPSTACK_PRESETS[0]!;
  return {
    id: typeof given.id === "string" ? given.id : preset.id,
    name: typeof given.name === "string" && given.name ? given.name : preset.name,
    minutes: typeof given.minutes === "number" && Number.isFinite(given.minutes) ? clamp(Math.round(given.minutes), 1, 60) : preset.minutes,
    golden: typeof given.golden === "boolean" ? given.golden : preset.golden,
    heat: typeof given.heat === "boolean" ? given.heat : preset.heat,
  };
}

export const chipStack: ArcadeGame<ChipStackRules, ChipStackState, ChipStackInput> = {
  id: "chipstack",
  name: "Chip Stack",
  emoji: "🪙",
  category: "arcade",
  blurb: "Tap, buy, and stack as high as the clock allows",
  tagline: "An idle clicker against the clock: tap the chip, buy what earns for you, and see how high the stack is when time runs out. Alone, or up to four on the same chip.",
  seats: { min: 1, max: 4, default: 1 },
  teams: false,
  presets: CHIPSTACK_PRESETS,
  fields: [
    { key: "minutes", label: "Length", kind: "choice", options: [[3, "3 minutes"], [5, "5 minutes"], [8, "8 minutes"], [12, "12 minutes"], [20, "20 minutes"], [30, "30 minutes"]] },
    { key: "golden", label: "Golden chips", hint: "One turns up now and then for a few seconds: a frenzy or a windfall for whoever catches it", kind: "toggle" },
    { key: "heat", label: "Heat", hint: "Fast tapping multiplies a tap, up to three times over", kind: "toggle" },
  ],
  normalize,
  validate(rules) {
    return Number.isInteger(rules.minutes) && rules.minutes >= 1 && rules.minutes <= 60 ? [] : ["A run is between 1 and 60 minutes."];
  },
  describe(rules) {
    return [
      `A run lasts ${rules.minutes === 1 ? "a minute" : `${rules.minutes} minutes`}. The score is every chip earned in it.`,
      "Everything costs 15% more each time you buy it. Own 10, 25 and 50 of something to double it.",
      rules.heat ? "Fast tapping builds heat, which multiplies a tap up to three times over. Fifteen taps a second is as fast as counts." : "A tap is worth the same however fast you tap. Fifteen a second is as fast as counts.",
      rules.golden ? "Catch a golden chip for a frenzy (everything ×7 for 12 seconds) or a windfall." : "No golden chips.",
      "Once you have earned 250,000, cashing out sells everything for stars: each is +10% on everything for the rest of the run.",
    ];
  },
  controls: [
    "Tap or click the big chip, or hold Space.",
    "Tap anything in the list to buy it. Keys 1 to 9 and 0 buy the earners in order.",
    "Tap a golden chip before it goes, or press G.",
  ],
  rate: RATE,
  newGame(rules, seats, seed) {
    const count = clamp(Math.trunc(seats) || 1, 1, 4);
    const s: ChipStackState = {
      rules,
      seats: count,
      rng: seed >>> 0,
      tick: 0,
      ends: rules.minutes * 60 * RATE,
      phase: "play",
      bank: 0,
      earned: 0,
      sinceCash: 0,
      earners: freshEarners(),
      power: 0,
      stars: 0,
      heat: 0,
      tapCool: Array.from({ length: count }, () => 0),
      tapped: Array.from({ length: count }, () => 0),
      taps: Array.from({ length: count }, () => 0),
      golden: null,
      nextGolden: 0,
      frenzy: 0,
      caught: 0,
      nextId: 1,
      seen: Array.from({ length: count }, () => 0),
      events: [],
    };
    s.nextGolden = RATE * (12 + Math.floor(nextRandom(s)() * 14));
    return s;
  },
  idle: IDLE,
  input: safeInput,
  step,
  view,
  bot,
  summary,
};

/** The colour of a seat, as the other arcade games give them. */
export const chipStackTone = (seat: number) => TONES[seat % TONES.length]!;
