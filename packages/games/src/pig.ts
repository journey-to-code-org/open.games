// Pig: one die and your nerve. On your turn you roll as often as you like, and every roll is added
// to a running total for the turn. Stop, and the total is yours to keep. Roll a one first, and the
// turn's total is gone and the die moves on. The first player to bank the target (100, usually) wins.
//
// With two dice a turn is over when either die shows a one, and two ones together cost everything
// banked so far as well.
//
// There is no board and no sheet: the view is the board kit's `dice` (thrown here from the game's
// seeded random source, like a deal) and two buttons.
import type { PlayStyle } from "@journey-to-code/rules";
import type { BoardGame, BoardView } from "./board.js";
import { drink, newTally, type Tally } from "./drinks.js";
import { drinkingField } from "./kit.js";
import { careless, clone, GameError, nextRandom, rankSeats, who, type BaseRules } from "./table.js";

export interface PigRules extends BaseRules {
  /** The score that wins. */
  target: number;
  /** How many dice are thrown: one, or two (where two ones lose everything). */
  dice: 1 | 2;
  /** Drinking mode: a one costs a drink as well as the turn. */
  drinking: boolean;
}

export const classicPig: PigRules = { id: "pig-classic", name: "Classic", target: 100, dice: 1, drinking: false };
export const twoDicePig: PigRules = { id: "pig-two", name: "Two dice", target: 100, dice: 2, drinking: false };
export const quickPig: PigRules = { id: "pig-quick", name: "Quick (to 50)", target: 50, dice: 1, drinking: false };
export const drinkingPig: PigRules = { ...classicPig, id: "pig-drinking", name: "Drinking Pig 🍺", drinking: true };
const PRESETS = [classicPig, twoDicePig, quickPig, drinkingPig];
const TARGETS = [50, 100, 200];

export interface PigState {
  game: "pig";
  rules: PigRules;
  seats: number;
  rng: number;
  /** Who had the first turn, and whose turn it is. */
  first: number;
  turn: number;
  /** Turns taken so far, by everyone: a round is one each. */
  turns: number;
  /** What each seat has banked. */
  scores: number[];
  /** What this turn is worth so far: lost to a one, banked by stopping. */
  pot: number;
  /** What the dice show (0 before the first roll of the game). */
  dice: number[];
  /** Rolls made this turn. At 0 the dice are whatever the turn before left. */
  rolls: number;
  /** Every throw since the game began: what the table watches to know the dice were thrown. */
  throws: number;
  tally: Tally;
  phase: "playing" | "finished";
  narration: string | null;
}

export type PigMove = { type: "roll" } | { type: "bank" };

export function newPig(rules: PigRules, seats: number, seed: number): PigState {
  const s = { game: "pig", rules, seats, rng: seed >>> 0, turns: 0, pot: 0, rolls: 0, throws: 0, phase: "playing", narration: null } as unknown as PigState;
  s.first = Math.floor(nextRandom(s)() * seats);
  s.turn = s.first;
  s.scores = Array<number>(seats).fill(0);
  s.dice = Array<number>(rules.dice).fill(0);
  s.tally = newTally(seats);
  return s;
}

/** The turn is over: the die goes to the next player. */
function pass(s: PigState) {
  s.pot = 0;
  s.rolls = 0;
  s.turns += 1;
  s.turn = (s.turn + 1) % s.seats;
}

function apply(state: PigState, seat: number, move: PigMove): PigState {
  if (move?.type !== "roll" && move?.type !== "bank") throw new GameError("That's not a move in Pig.");
  if (state.phase !== "playing") throw new GameError("The game is over.");
  if (!Number.isInteger(seat) || seat < 0 || seat >= state.seats) throw new GameError("You're not at this table.");
  if (state.turn !== seat) throw new GameError("It's not your turn.");
  const s = clone(state);
  const { rules } = s;

  if (move.type === "roll") {
    const rand = nextRandom(s);
    s.dice = s.dice.map(() => 1 + Math.floor(rand() * 6));
    s.rolls += 1;
    s.throws += 1;
    const ones = s.dice.filter((d) => d === 1).length;
    if (!ones) {
      s.pot += s.dice.reduce((a, b) => a + b, 0);
      s.narration = `${who(seat)} rolls ${s.dice.join(" and ")}: ${s.pot} this turn`;
      return s;
    }
    const lost = s.pot;
    let line = `${who(seat)} rolls a one${lost ? ` and loses ${lost}` : ""}`;
    if (ones === 2) {
      line = `${who(seat)} rolls two ones${s.scores[seat]! + lost ? " and loses everything" : ""}`;
      s.scores[seat] = 0;
    }
    if (rules.drinking) line += ` · ${drink(s.tally, [seat], ones)}`;
    s.narration = line;
    pass(s);
    return s;
  }

  if (s.rolls === 0) throw new GameError("Roll first.");
  s.scores[seat]! += s.pot;
  s.narration = `${who(seat)} banks ${s.pot}`;
  if (s.scores[seat]! >= rules.target) {
    s.phase = "finished";
    s.turns += 1;
    s.pot = 0;
    s.rolls = 0;
    const others = s.scores.map((_, i) => i).filter((i) => i !== seat);
    s.narration = `${who(seat)} banks ${state.pot} and wins!` + (rules.drinking && others.length ? ` · ${drink(s.tally, others, 1)}` : "");
    return s;
  }
  pass(s);
  return s;
}

const winnersOf = (s: PigState) => {
  const best = Math.max(...s.scores);
  return s.scores.flatMap((t, seat) => (t === best ? [seat] : []));
};

/** The turn total a careful player stops at: about twenty, sooner when a one would cost a lot (two dice), later when behind. */
function holdAt(s: PigState, seat: number): number {
  const mine = s.scores[seat]!;
  const ahead = Math.max(0, ...s.scores.filter((_, i) => i !== seat));
  const { target, dice } = s.rules;
  // Near the end, by either side, there is nothing to save a banked score for: roll for the line.
  if (Math.max(mine, ahead) >= target * 0.71) return target - mine;
  const chase = Math.round((ahead - mine) / 8);
  // Two dice: a roll adds 8 on average 25 times in 36, loses the turn 11 times and everything once.
  const base = dice === 1 ? 21 : Math.max(10, Math.round((200 - mine) / 11));
  return Math.max(6, base + chase);
}

function bot(s: PigState, seat: number, style: PlayStyle, rand: () => number = Math.random): PigMove | null {
  if (s.phase !== "playing" || s.turn !== seat) return null;
  if (s.rolls === 0) return { type: "roll" };
  if (s.scores[seat]! + s.pot >= s.rules.target) return { type: "bank" };
  // A careless moment: stop or carry on by the feel of it.
  if (careless(style, rand)) return rand() < 0.5 ? { type: "bank" } : { type: "roll" };
  return s.pot >= holdAt(s, seat) ? { type: "bank" } : { type: "roll" };
}

function overTitle(s: PigState): string {
  const [w] = winnersOf(s);
  return `${who(w!)} wins with ${s.scores[w!]}!`;
}

function view(s: PigState, seat: number): BoardView {
  const { rules } = s;
  const over = s.phase === "finished";
  const mine = !over && s.turn === seat;
  const spent = s.rolls === 0;
  const wins = s.scores[seat]! + s.pot >= rules.target;
  return {
    game: "pig",
    seats: s.seats,
    me: seat,
    teams: false,
    phase: s.phase,
    turn: over ? null : s.turn,
    grids: [],
    reserves: [],
    // Dice from the turn before lie where they fell, dimmed, until the next roll picks them up.
    dice: { dice: s.dice.map((value, id) => ({ id, value: value || null, used: spent && value > 0 })), roll: s.throws, sides: 6, tap: null },
    choices: mine
      ? {
          prompt: spent ? "" : `${s.pot} this turn: roll again, or stop and keep it`,
          options: spent
            ? [{ label: rules.dice === 1 ? "Roll the die" : "Roll the dice", move: { type: "roll" }, primary: true }]
            : [
                // Past twenty or so the odds favour keeping it; before that, rolling.
                { label: "Roll again", move: { type: "roll" }, primary: !wins && s.pot < 20 },
                { label: wins ? `Bank ${s.pot} and win` : `Stop and bank ${s.pot}`, move: { type: "bank" }, primary: wins || s.pot >= 20 },
              ],
        }
      : null,
    players: s.scores.map((score, i) => ({
      line: [`${score} points`, ...(!over && s.turn === i && s.pot ? [`${s.pot} this turn`] : []), ...(rules.drinking ? [`🍺 ${s.tally.drank[i]}`] : [])].join(" · "),
    })),
    info: [
      `First to ${rules.target}`,
      ...(over ? [] : [rules.dice === 1 ? "A one ends your turn" : "A one ends your turn · two ones lose everything"]),
      ...(rules.drinking && !over ? ["🍺 Roll a one: you drink"] : []),
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

function normalize(rules: unknown): PigRules {
  const given = (rules && typeof rules === "object" ? rules : {}) as Partial<PigRules>;
  const base = PRESETS.find((p) => p.id === given.id) ?? classicPig;
  const r = { ...base, ...given };
  return {
    id: String(r.id),
    name: String(r.name),
    target: TARGETS.includes(Number(r.target)) ? Number(r.target) : 100,
    dice: Number(r.dice) === 2 ? 2 : 1,
    drinking: !!r.drinking,
  };
}

export const pig: BoardGame<PigRules, PigState, PigMove> = {
  id: "pig",
  name: "Pig",
  emoji: "🐖",
  category: "dice",
  blurb: "Roll again, or keep what you have?",
  tagline: "Roll as often as you dare and add it all up. Stop to keep it; roll a one and the turn is gone. First to 100 wins.",
  seats: { min: 2, max: 6, default: 2 },
  teams: false,
  presets: PRESETS,
  fields: [
    { key: "target", label: "Play to", kind: "choice", options: TARGETS.map((t) => [t, `${t} points`]) },
    { key: "dice", label: "Dice", hint: "With two dice, a one on either ends your turn, and two ones together lose everything you've banked.", kind: "choice", options: [[1, "One die"], [2, "Two dice"]] },
    drinkingField<PigRules>("Adults only. Roll a one and you take a drink; when someone wins, everyone else does (water counts)."),
  ],
  normalize,
  validate: () => [],
  describe(r) {
    return [
      r.dice === 1
        ? "On your turn, roll the die as often as you like. Every roll is added to your total for the turn."
        : "On your turn, roll both dice as often as you like. Every roll is added to your total for the turn.",
      "Stop whenever you like, and the turn's total is banked: it is yours for good.",
      r.dice === 1 ? "Roll a one, and the turn's total is lost and your turn is over." : "If either die shows a one, the turn's total is lost and your turn is over. Two ones together lose everything you have banked as well.",
      `The first player to bank ${r.target} wins.`,
      ...(r.drinking ? ["🍺 Drinking mode: roll a one and you take a drink (two for two ones). When someone wins, everyone else drinks."] : []),
    ];
  },
  newGame: newPig,
  apply,
  view,
  bot,
  // Rolling is quick; stopping takes a moment's thought.
  thinkingTime: (s) => (s.rolls === 0 ? 700 : s.pot >= 15 ? 1200 : 800),
  summary(s) {
    const over = s.phase === "finished";
    return {
      game: "pig",
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
