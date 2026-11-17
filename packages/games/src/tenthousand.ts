// Ten Thousand: six dice, and how far you dare push them. On your turn you roll all six. Ones and
// fives score on their own, and so do three or more of a kind; you have to set aside at least one
// scoring die from every roll, and then either bank what the turn has made or roll the dice that
// are left for more. A roll with nothing in it that scores is a bust: the turn's points are gone.
// Set all six aside and you have hot dice: all six come back, and the turn goes on.
//
// The first player to bank the target (10,000, usually) starts the last round: everyone else gets
// one more turn to beat it. Many tables also make you earn your way in: your first bank has to be
// a turn of 500 or more.
//
// There is no board and no sheet: the view is the board kit's `dice` (thrown here from the game's
// seeded random source, like a deal) and buttons. After a roll every die that scores is kept for
// you; tap one to put it back and roll it again.
import { mulberry32, type PlayStyle } from "@journey-to-code/rules";
import type { BoardGame, BoardView } from "./board.js";
import { drink, newTally, type Tally } from "./drinks.js";
import { drinkingField } from "./kit.js";
import { careless, clone, GameError, nextRandom, rankSeats, who, type BaseRules } from "./table.js";

export interface TenThousandRules extends BaseRules {
  /** The score that starts the last round. */
  target: number;
  /** What a turn has to be worth before a player's first bank: 0 for no such rule. */
  opening: number;
  /** A straight (one of each) and three pairs score 1,500 when all six dice make them. */
  combos: boolean;
  /** Drinking mode: a bust costs a drink as well as the points. */
  drinking: boolean;
}

export const classicTenThousand: TenThousandRules = { id: "tenthousand-classic", name: "Classic", target: 10000, opening: 500, combos: true, drinking: false };
export const quickTenThousand: TenThousandRules = { id: "tenthousand-quick", name: "Quick (to 5,000)", target: 5000, opening: 0, combos: true, drinking: false };
export const plainTenThousand: TenThousandRules = { id: "tenthousand-plain", name: "Plain (no straights)", target: 10000, opening: 0, combos: false, drinking: false };
export const drinkingTenThousand: TenThousandRules = { ...quickTenThousand, id: "tenthousand-drinking", name: "Drinking Ten Thousand 🍺", drinking: true };
const PRESETS = [classicTenThousand, quickTenThousand, plainTenThousand, drinkingTenThousand];
const TARGETS = [2500, 5000, 10000];
const OPENINGS = [0, 350, 500, 1000];

export const TEN_THOUSAND_DICE = 6;
/** What a straight or three pairs is worth. */
export const TEN_THOUSAND_COMBO = 1500;

// ---- Scoring ------------------------------------------------------------------------------------

/** How many dice show each face: `counts[3]` is the number of threes. (`counts[0]` is unused.) */
type Counts = readonly number[];
const countsOf = (dice: readonly number[]): number[] => {
  const counts = [0, 0, 0, 0, 0, 0, 0];
  for (const d of dice) counts[d]! += 1;
  return counts;
};
const sizeOf = (counts: Counts) => counts.reduce((n, c) => n + c, 0);

/** A straight, or three pairs of three different numbers: only ever all six dice. */
function comboOf(counts: Counts): boolean {
  if (sizeOf(counts) !== TEN_THOUSAND_DICE) return false;
  const faces = counts.slice(1);
  return faces.every((c) => c === 1) || faces.filter((c) => c === 2).length === 3;
}

/**
 * What a set of dice scores when every one of them counts: three of a kind is 100 times the number
 * (1,000 for ones) and doubles with each die more, and ones and fives on their own are 100 and 50.
 * Null when a die among them scores nothing, or there are no dice at all.
 */
function scoreCounts(counts: Counts, combos: boolean): number | null {
  let plain = 0;
  let stray = false;
  for (let face = 1; face <= 6; face++) {
    const n = counts[face]!;
    if (n >= 3) plain += (face === 1 ? 1000 : face * 100) * 2 ** (n - 3);
    else if (face === 1) plain += n * 100;
    else if (face === 5) plain += n * 50;
    else if (n) stray = true;
  }
  if (combos && comboOf(counts)) return Math.max(TEN_THOUSAND_COMBO, stray ? 0 : plain);
  return stray || !plain ? null : plain;
}

/** What these dice score if all of them are set aside together, or null if one of them doesn't score. */
export const tenThousandScore = (dice: readonly number[], rules: Pick<TenThousandRules, "combos"> = { combos: true }): number | null => scoreCounts(countsOf(dice), rules.combos);

/** Of the dice just thrown, how many of each face could be set aside: everything that scores. */
function scoringCounts(counts: Counts, combos: boolean): number[] {
  if (combos && comboOf(counts)) return [...counts];
  return counts.map((n, face) => (face === 1 || face === 5 || n >= 3 ? n : 0));
}

// ---- The state ----------------------------------------------------------------------------------

export interface TenThousandState {
  game: "tenthousand";
  rules: TenThousandRules;
  seats: number;
  rng: number;
  /** Who had the first turn, and whose turn it is. */
  first: number;
  turn: number;
  /** Turns taken so far, by everyone: a round is one each. */
  turns: number;
  /** What each seat has banked. */
  scores: number[];
  /** The turn's points from the rolls before this one. */
  pot: number;
  /** What the six dice show (0 before the first roll of the game). */
  dice: number[];
  /** Set aside on an earlier roll of this turn: scored already, and out of the next throw. */
  set: boolean[];
  /** Of the dice just thrown, the ones being kept for their score. */
  kept: boolean[];
  /** Rolls made this turn. At 0 the dice are whatever the turn before left. */
  rolls: number;
  /** Every throw since the game began: what the table watches to know the dice were thrown. */
  throws: number;
  /** Who reached the target first: when the turn comes back round to them the game is over. */
  closer: number | null;
  tally: Tally;
  phase: "playing" | "finished";
  narration: string | null;
}

export type TenThousandMove = { type: "roll" } | { type: "keep"; die: number } | { type: "bank" };

export function newTenThousand(rules: TenThousandRules, seats: number, seed: number): TenThousandState {
  const s = { game: "tenthousand", rules, seats, rng: seed >>> 0, turns: 0, pot: 0, rolls: 0, throws: 0, closer: null, phase: "playing", narration: null } as unknown as TenThousandState;
  s.first = Math.floor(nextRandom(s)() * seats);
  s.turn = s.first;
  s.scores = Array<number>(seats).fill(0);
  s.dice = Array<number>(TEN_THOUSAND_DICE).fill(0);
  s.set = Array<boolean>(TEN_THOUSAND_DICE).fill(false);
  s.kept = Array<boolean>(TEN_THOUSAND_DICE).fill(false);
  s.tally = newTally(seats);
  return s;
}

/** The dice thrown on the last roll, as counts. */
const thrownCounts = (s: TenThousandState) => countsOf(s.dice.filter((_, i) => !s.set[i]));
/** The dice being kept from the last roll, as counts. */
const keptCounts = (s: TenThousandState) => countsOf(s.dice.filter((_, i) => s.kept[i]));
/** What the dice being kept score, or null when they don't all score (or none are kept). */
const keptScore = (s: TenThousandState) => (s.rolls === 0 ? null : scoreCounts(keptCounts(s), s.rules.combos));
/** A seat has yet to make its first bank, at a table where that takes a big enough turn. */
const outside = (s: TenThousandState, seat: number) => s.rules.opening > 0 && s.scores[seat] === 0;
/** What a seat still needs this turn before it may bank, with `total` made: 0 when it may. */
const short = (s: TenThousandState, seat: number, total: number) => (outside(s, seat) && total < s.rules.opening ? s.rules.opening - total : 0);

/** What the turn is worth with the dice being kept, and whether its seat could bank it. Null when the kept dice don't score. */
export function tenThousandTurn(s: TenThousandState): { total: number; left: number; bank: boolean } | null {
  const score = keptScore(s);
  if (score === null) return null;
  const total = s.pot + score;
  const left = s.set.filter((x) => !x).length - s.kept.filter(Boolean).length;
  return { total, left: left || TEN_THOUSAND_DICE, bank: !short(s, s.turn, total) };
}

// ---- Moves --------------------------------------------------------------------------------------

/** The turn is over: the dice go to the next player, or the game ends when they come back to whoever went out. */
function pass(s: TenThousandState) {
  s.pot = 0;
  s.rolls = 0;
  s.set.fill(false);
  s.kept.fill(false);
  s.turns += 1;
  s.turn = (s.turn + 1) % s.seats;
  if (s.closer !== null && s.turn === s.closer) s.phase = "finished";
}

/** Throw every die that isn't set aside, and keep whatever scores. False when nothing does: a bust. */
function throwDice(s: TenThousandState): boolean {
  const rand = nextRandom(s);
  s.dice = s.dice.map((value, i) => (s.set[i] ? value : 1 + Math.floor(rand() * 6)));
  s.rolls += 1;
  s.throws += 1;
  const want = scoringCounts(thrownCounts(s), s.rules.combos);
  s.kept = s.dice.map((value, i) => !s.set[i] && want[value]! > 0);
  return s.kept.some(Boolean);
}

function apply(state: TenThousandState, seat: number, move: TenThousandMove): TenThousandState {
  if (move?.type !== "roll" && move?.type !== "keep" && move?.type !== "bank") throw new GameError("That's not a move in Ten Thousand.");
  if (state.phase !== "playing") throw new GameError("The game is over.");
  if (!Number.isInteger(seat) || seat < 0 || seat >= state.seats) throw new GameError("You're not at this table.");
  if (state.turn !== seat) throw new GameError("It's not your turn.");
  const { rules } = state;

  if (move.type === "keep") {
    if (state.rolls === 0) throw new GameError("Roll the dice first.");
    const die = Number(move.die);
    if (!Number.isInteger(die) || die < 0 || die >= TEN_THOUSAND_DICE) throw new GameError("That's not one of the dice.");
    if (state.set[die]) throw new GameError("That die is already set aside.");
    if (!scoringCounts(thrownCounts(state), rules.combos)[state.dice[die]!]) throw new GameError("That die doesn't score.");
    const s = clone(state);
    s.kept[die] = !s.kept[die];
    return s;
  }

  const now = tenThousandTurn(state);
  if (state.rolls > 0 && !now) throw new GameError(state.kept.some(Boolean) ? "Those dice don't all score: three of a kind have to stay together." : "Keep at least one die that scores.");

  if (move.type === "roll") {
    const s = clone(state);
    if (now) {
      // What was kept is scored and set aside; with all six aside they all come back (hot dice).
      s.pot = now.total;
      s.set = s.set.map((was, i) => was || s.kept[i]!);
      if (s.set.every(Boolean)) s.set.fill(false);
    }
    const hot = !!now && now.left === TEN_THOUSAND_DICE && s.rolls > 0;
    if (throwDice(s)) {
      s.narration = hot ? `Hot dice! ${who(seat)} rolls all six again with ${s.pot} made` : s.rolls === 1 ? `${who(seat)} rolls` : `${who(seat)} rolls ${now!.left === 1 ? "the last die" : `${now!.left} dice`} with ${s.pot} made`;
      return s;
    }
    s.narration = `${who(seat)} busts${s.pot ? ` and loses ${s.pot}` : ""}` + (rules.drinking ? ` · ${drink(s.tally, [seat], 1)}` : "");
    pass(s);
    return s;
  }

  if (!now) throw new GameError("Roll the dice first.");
  const need = short(state, seat, now.total);
  if (need) throw new GameError(`Your first bank has to be ${rules.opening} or more: ${need} to go.`);
  const s = clone(state);
  s.scores[seat]! += now.total;
  s.narration = `${who(seat)} banks ${now.total}`;
  if (s.closer === null && s.scores[seat]! >= rules.target) {
    s.closer = seat;
    s.narration += ` and reaches ${rules.target}: everyone else has one more turn`;
  }
  pass(s);
  return s;
}

const winnersOf = (s: TenThousandState) => {
  const best = Math.max(...s.scores);
  return s.scores.flatMap((t, seat) => (t === best ? [seat] : []));
};

// ---- The computer player ------------------------------------------------------------------------
// It plays a turn for the most points it can expect, worked out exactly. With `p` points made and
// `n` dice to throw, a turn is worth the average over every way the dice can fall of the best thing
// to do with that roll: which scoring dice to set aside, and then whether to bank or to throw the
// rest. A throw only ever adds to the turn's points, so the table is filled in from the most
// points down. Past `CAP` it simply banks.

const CAP = 5000;
const STEP = 50;
/** A way some dice can fall, how likely it is, and the ways to keep scoring dice from it: how many, and their score. */
interface Fall {
  counts: number[];
  chance: number;
  keeps: { counts: number[]; size: number; score: number }[];
}
interface Odds {
  /** For 1 to 6 dice thrown, every way they can fall. */
  falls: Fall[][];
  /** `value[n][p / STEP]`: what a turn is worth about to throw `n` dice with `p` points made. */
  value: Float64Array[];
}
const ODDS = new Map<boolean, Odds>();

/** Every way to keep scoring dice out of a roll. */
function keepsOf(counts: Counts, combos: boolean): Fall["keeps"] {
  const out: Fall["keeps"] = [];
  const pick = (face: number, kept: number[]) => {
    if (face > 6) {
      const score = scoreCounts(kept, combos);
      if (score !== null) out.push({ counts: [...kept], size: sizeOf(kept), score });
      return;
    }
    for (let n = 0; n <= counts[face]!; n++) {
      kept[face] = n;
      pick(face + 1, kept);
    }
    kept[face] = 0;
  };
  pick(1, [0, 0, 0, 0, 0, 0, 0]);
  return out;
}

function odds(combos: boolean): Odds {
  const known = ODDS.get(combos);
  if (known) return known;
  const factorial = [1, 1, 2, 6, 24, 120, 720];
  const falls: Fall[][] = [[]];
  for (let n = 1; n <= TEN_THOUSAND_DICE; n++) {
    const list: Fall[] = [];
    const fill = (face: number, counts: number[], size: number) => {
      if (face > 6) {
        if (size !== n) return;
        const ways = counts.reduce((w, c) => w / factorial[c]!, factorial[n]!);
        list.push({ counts: [...counts], chance: ways / 6 ** n, keeps: keepsOf(counts, combos) });
        return;
      }
      for (let c = 0; size + c <= n; c++) {
        counts[face] = c;
        fill(face + 1, counts, size + c);
      }
      counts[face] = 0;
    };
    fill(1, [0, 0, 0, 0, 0, 0, 0], 0);
    falls.push(list);
  }
  const slots = CAP / STEP + 1;
  const value = Array.from({ length: TEN_THOUSAND_DICE + 1 }, () => new Float64Array(slots));
  const made: Odds = { falls, value };
  for (let slot = slots - 1; slot >= 0; slot--) {
    for (let n = 1; n <= TEN_THOUSAND_DICE; n++) {
      let sum = 0;
      for (const fall of falls[n]!) {
        let best = 0;
        for (const keep of fall.keeps) best = Math.max(best, after(made, slot * STEP + keep.score, n - keep.size).value);
        sum += fall.chance * best;
      }
      value[n]![slot] = sum;
    }
  }
  ODDS.set(combos, made);
  return made;
}

/** With `total` made and `left` dice not set aside (none: all six come back): what it's worth, and whether throwing them beats banking. */
function after(o: Odds, total: number, left: number): { value: number; roll: boolean } {
  if (total >= CAP) return { value: total, roll: false };
  const rolling = o.value[left || TEN_THOUSAND_DICE]![Math.round(total / STEP)]!;
  return rolling > total + 1e-9 ? { value: rolling, roll: true } : { value: total, roll: false };
}

export interface TenThousandPlan {
  /** How many dice of each face to keep from the roll (`keep[5]` fives). */
  keep: number[];
  /** Then throw the rest, or bank. */
  roll: boolean;
}

/** Whether banking `total` now would be a mistake whatever the odds: it isn't allowed, or it can't win any more. */
function mustRoll(s: TenThousandState, seat: number, total: number): boolean {
  if (short(s, seat, total)) return true;
  // The last round: a bank that doesn't pass the leader is a loss.
  return s.closer !== null && s.scores[seat]! + total <= Math.max(...s.scores);
}

/** What the sharpest player would do with the dice just thrown: which to keep, and whether to roll on. Null before a roll. */
export function tenThousandPlan(s: TenThousandState, seat: number): TenThousandPlan | null {
  if (s.phase !== "playing" || s.turn !== seat || s.rolls === 0) return null;
  const o = odds(s.rules.combos);
  const thrown = thrownCounts(s);
  const dice = sizeOf(thrown);
  let best: (TenThousandPlan & { value: number }) | null = null;
  for (const keep of keepsOf(thrown, s.rules.combos)) {
    const total = s.pot + keep.score;
    const left = dice - keep.size;
    const mine = s.scores[seat]! + total;
    let choice = after(o, total, left);
    // Enough to go out, or to take the lead on a last turn: bank it.
    if (mine >= s.rules.target && (s.closer === null || mine > Math.max(...s.scores))) choice = { value: total + CAP, roll: false };
    else if (mustRoll(s, seat, total)) choice = { value: o.value[left || TEN_THOUSAND_DICE]![Math.min(CAP, total) / STEP]!, roll: true };
    if (!best || choice.value > best.value + 1e-9) best = { keep: keep.counts, roll: choice.roll, value: choice.value };
  }
  return best && { keep: best.keep, roll: best.roll };
}

/** What someone not really thinking does: keeps everything that scores, and banks as soon as there's 300 in it. */
function casualPlan(s: TenThousandState, seat: number): TenThousandPlan {
  const keep = scoringCounts(thrownCounts(s), s.rules.combos);
  const total = s.pot + (scoreCounts(keep, s.rules.combos) ?? 0);
  return { keep, roll: mustRoll(s, seat, total) || total < 300 };
}

function bot(s: TenThousandState, seat: number, style: PlayStyle): TenThousandMove | null {
  if (s.phase !== "playing" || s.turn !== seat) return null;
  if (s.rolls === 0) return { type: "roll" };
  // Changing which dice are kept takes a move a die, so the plan has to be the same one each time
  // it's asked for between two rolls: whether this is a careless moment is decided by the dice.
  const rand = mulberry32((s.rng ^ Math.imul(s.throws + 1, 0x9e3779b1) ^ Math.imul(seat + 1, 0x85ebca6b)) >>> 0);
  const plan = careless(style, rand) ? casualPlan(s, seat) : tenThousandPlan(s, seat)!;
  // Which dice to keep: the ones already kept first, so as few as possible change.
  const want = [...plan.keep];
  const keep = Array<boolean>(TEN_THOUSAND_DICE).fill(false);
  for (const kept of [true, false]) {
    s.dice.forEach((value, die) => {
      if (!s.set[die] && s.kept[die] === kept && want[value]! > 0) {
        keep[die] = true;
        want[value]! -= 1;
      }
    });
  }
  const die = keep.findIndex((k, i) => k !== s.kept[i]);
  if (die >= 0) return { type: "keep", die };
  return plan.roll ? { type: "roll" } : { type: "bank" };
}

// ---- What a seat sees ---------------------------------------------------------------------------

/** 10000 as "10,000". */
const spaced = (n: number) => String(n).replace(/\B(?=(\d{3})+$)/g, ",");

function overTitle(s: TenThousandState): string {
  const w = winnersOf(s);
  const best = s.scores[w[0]!]!;
  return w.length > 1 ? `${w.map(who).join(" and ")} tie on ${best}!` : `${who(w[0]!)} wins with ${best}!`;
}

function view(s: TenThousandState, seat: number): BoardView {
  const { rules } = s;
  const over = s.phase === "finished";
  const mine = !over && s.turn === seat;
  const spent = s.rolls === 0;
  const now = tenThousandTurn(s);
  const scoring = spent ? [] : scoringCounts(thrownCounts(s), rules.combos);
  const need = now ? short(s, s.turn, now.total) : 0;
  const lead = Math.max(...s.scores);
  return {
    game: "tenthousand",
    seats: s.seats,
    me: seat,
    teams: false,
    phase: s.phase,
    turn: over ? null : s.turn,
    grids: [],
    reserves: [],
    dice: {
      // Dice set aside earlier in the turn are dimmed; the ones kept from this roll are held. A
      // turn that is over leaves its dice where they fell, dimmed, until the next roll.
      dice: s.dice.map((value, id) => ({ id, value: value || null, held: !spent && s.kept[id]!, used: spent ? value > 0 : s.set[id]! })),
      roll: s.throws,
      sides: 6,
      // A die that scores can be kept or put back to roll again.
      tap: mine && !spent ? { type: "keep", dice: s.dice.flatMap((value, id) => (!s.set[id] && scoring[value]! > 0 ? [id] : [])) } : null,
    },
    choices: mine
      ? {
          prompt: spent
            ? ""
            : !now
              ? s.kept.some(Boolean)
                ? "Those dice don't all score: three of a kind have to stay together"
                : "Keep at least one die that scores"
              : need
                ? `${now.total} this turn: your first bank has to be ${rules.opening} or more`
                : `${now.total} this turn: bank it, or roll for more. Tap a die to put it back`,
          options: spent
            ? [{ label: "Roll the dice", move: { type: "roll" }, primary: true }]
            : !now
              ? []
              : [
                  ...(need ? [] : [{ label: `Bank ${now.total}`, move: { type: "bank" }, primary: true }]),
                  { label: now.left === TEN_THOUSAND_DICE ? "Hot dice! Roll all six" : now.left === 1 ? "Roll the last die" : `Roll ${now.left} dice`, move: { type: "roll" }, primary: !!need },
                ],
        }
      : null,
    players: s.scores.map((score, i) => ({
      line: [`${score} points`, ...(!over && s.turn === i && now ? [`${now.total} this turn`] : []), ...(rules.drinking ? [`🍺 ${s.tally.drank[i]}`] : [])].join(" · "),
      badge: s.closer === i && !over ? "Made it" : undefined,
    })),
    info: [
      `First to ${spaced(rules.target)}`,
      ...(rules.opening && !over ? [`${rules.opening} in a turn to get on the board`] : []),
      ...(s.closer !== null && !over ? [`Last turns: ${lead} to beat`] : []),
      ...(rules.drinking && !over ? ["🍺 Bust: you drink"] : []),
    ],
    narration: s.narration,
    scores: s.scores.map((value, i) => ({ seats: [i], value })),
    result: over
      ? {
          key: "final",
          title: overTitle(s),
          sides: s.scores.map((_, i) => [i]),
          rows: [{ label: "Total", values: s.scores.map(String), tone: "total" as const }, ...(rules.drinking ? [{ label: "Drinks 🍺", values: s.tally.drank.map(String) }] : [])],
        }
      : null,
    over: over ? { winners: winnersOf(s), title: overTitle(s) } : null,
  };
}

// ---- The game -----------------------------------------------------------------------------------

function normalize(rules: unknown): TenThousandRules {
  const given = (rules && typeof rules === "object" ? rules : {}) as Partial<TenThousandRules>;
  const base = PRESETS.find((p) => p.id === given.id) ?? classicTenThousand;
  const r = { ...base, ...given };
  return {
    id: String(r.id),
    name: String(r.name),
    target: TARGETS.includes(Number(r.target)) ? Number(r.target) : 10000,
    opening: OPENINGS.includes(Number(r.opening)) ? Number(r.opening) : 0,
    combos: !!r.combos,
    drinking: !!r.drinking,
  };
}

export const tenThousand: BoardGame<TenThousandRules, TenThousandState, TenThousandMove> = {
  id: "tenthousand",
  name: "Ten Thousand",
  emoji: "🔥",
  category: "dice",
  blurb: "Six dice: bank the points, or push your luck",
  tagline: "Set aside the dice that score and roll the rest for more, or bank what you have before a bust takes it. First to 10,000.",
  seats: { min: 2, max: 6, default: 2 },
  teams: false,
  presets: PRESETS,
  fields: [
    { key: "target", label: "Play to", kind: "choice", options: TARGETS.map((t) => [t, `${spaced(t)} points`]) },
    { key: "opening", label: "Getting on the board", hint: "What one turn has to be worth before you can bank for the first time.", kind: "choice", options: OPENINGS.map((o) => [o, o ? `A turn of ${spaced(o)}` : "Any score"]) },
    { key: "combos", label: "Straights and three pairs", hint: `One of each number, or three pairs, with all six dice: ${spaced(TEN_THOUSAND_COMBO)}.`, kind: "toggle" },
    drinkingField<TenThousandRules>("Adults only. Bust and you take a drink (water counts)."),
  ],
  normalize,
  validate: () => [],
  describe(r) {
    return [
      "On your turn, roll all six dice. Set aside at least one die that scores, then bank the turn's points or roll the dice that are left for more.",
      "A one is 100 and a five is 50. Three of a kind is 100 times the number (three ones are 1,000), and each die more of the same doubles it: four fours are 800, five fours 1,600.",
      ...(r.combos ? [`One of each number, or three pairs, with all six dice is ${spaced(TEN_THOUSAND_COMBO)}.`] : []),
      "A roll with nothing that scores is a bust: the turn's points are lost and the dice move on. Set aside all six and you have hot dice: roll all six again and keep adding.",
      ...(r.opening ? [`Your first bank has to be a turn of ${spaced(r.opening)} or more.`] : []),
      `When someone banks ${spaced(r.target)}, everyone else has one more turn. The highest score wins.`,
      ...(r.drinking ? ["🍺 Drinking mode: bust and you take a drink."] : []),
    ];
  },
  newGame: newTenThousand,
  apply,
  view,
  bot,
  thinkingTime(s, seat) {
    // Rolling is quick, moving a die quicker; bank or roll is the part people think about.
    const next = bot(s, seat, {});
    return s.rolls === 0 ? 800 : next?.type === "keep" ? 420 : 1300;
  },
  summary(s) {
    const over = s.phase === "finished";
    return {
      game: "tenthousand",
      rules: s.rules.name,
      phase: s.phase,
      over,
      hand: Math.floor(Math.max(0, s.turns - (over ? 1 : 0)) / s.seats) + 1,
      scoreLine: s.scores.join(" · ") + (s.rules.drinking ? ` · 🍺 ${s.tally.drank.join(" · ")}` : ""),
      order: over ? rankSeats(s.scores.map((score, seat) => ({ seats: [seat], score }))) : null,
      winners: over ? winnersOf(s) : null,
      teams: false,
      seats: s.seats,
    };
  },
};
