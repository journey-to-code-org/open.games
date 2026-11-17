// Shut the Box: a row of numbered tiles, all open, and two dice. Roll, and shut any open tiles that
// add up to what you rolled: a nine can be the 9, or 8 and 1, or 2, 3 and 4. Roll again, and keep
// going until a roll can't be made from what is still open. What's left open, added up, is your
// score, and the lowest wins. Shut every tile and you have shut the box: nothing left at all.
//
// Once the open tiles add up to six or less you may roll one die instead of two.
//
// Everyone has a turn with a fresh box, for one round or several; one player can play alone for
// a score.
//
// The box is a grid of one piece a tile, and the dice are the board kit's `dice` (thrown here from
// the game's seeded random source, like a deal). A tile that could be part of the roll can be
// tapped to shut it, and one shut for this roll can be tapped again to open it.
import { mulberry32, type PlayStyle } from "@journey-to-code/rules";
import type { BoardGame, BoardGrid, BoardView } from "./board.js";
import { drink, newTally, type Tally } from "./drinks.js";
import { drinkingField } from "./kit.js";
import { careless, clone, GameError, nextRandom, rankSeats, who, type BaseRules } from "./table.js";

export interface ShutTheBoxRules extends BaseRules {
  /** How many tiles are in the box: 1 to 9, or 1 to 12. */
  tiles: 9 | 12;
  /** How many turns each player has; the scores are added up. */
  rounds: number;
  /** Drinking mode: whoever is left with the most each round drinks. */
  drinking: boolean;
}

export const classicShutTheBox: ShutTheBoxRules = { id: "shutthebox-classic", name: "Classic", tiles: 9, rounds: 1, drinking: false };
export const threeShutTheBox: ShutTheBoxRules = { id: "shutthebox-three", name: "Three rounds", tiles: 9, rounds: 3, drinking: false };
export const twelveShutTheBox: ShutTheBoxRules = { id: "shutthebox-twelve", name: "Twelve tiles", tiles: 12, rounds: 1, drinking: false };
export const drinkingShutTheBox: ShutTheBoxRules = { ...threeShutTheBox, id: "shutthebox-drinking", name: "Pub rules 🍺", drinking: true };
const PRESETS = [classicShutTheBox, threeShutTheBox, twelveShutTheBox, drinkingShutTheBox];
const ROUNDS = [1, 3, 5];
/** One die may be rolled once the open tiles add up to this or less. */
export const SHUT_THE_BOX_ONE_DIE = 6;

export interface ShutTheBoxState {
  game: "shutthebox";
  rules: ShutTheBoxRules;
  seats: number;
  rng: number;
  /** Which round, from 1. */
  round: number;
  /** Who rolls first this round, and whose turn it is. */
  first: number;
  turn: number;
  /** The box: `open[0]` is the 1 tile. Between turns it is as the last player left it. */
  open: boolean[];
  /** What the dice show: 0 for a die that wasn't thrown (before the first roll, or when one die was rolled). */
  dice: number[];
  /** What is still to shut from this roll: 0 when the roll has been made, or there is none. */
  need: number;
  /** The tiles shut for this roll so far (as indexes into `open`): they can still be opened again. */
  chosen: number[];
  /** Rolls made this turn. At 0 the box and the dice are whatever the turn before left. */
  rolls: number;
  /** Every throw since the game began: what the table watches to know the dice were thrown. */
  throws: number;
  /** This round: what each seat was left with, or null if it hasn't played yet. */
  played: (number | null)[];
  /** What each seat has been left with over the rounds so far. */
  left: number[];
  /** How many times each seat has shut the box. */
  boxes: number[];
  tally: Tally;
  phase: "playing" | "finished";
  narration: string | null;
}

export type ShutTheBoxMove = { type: "roll"; dice?: number } | { type: "shut"; cell: number };

export function newShutTheBox(rules: ShutTheBoxRules, seats: number, seed: number): ShutTheBoxState {
  const s = { game: "shutthebox", rules, seats, rng: seed >>> 0, round: 1, need: 0, chosen: [], rolls: 0, throws: 0, phase: "playing", narration: null } as unknown as ShutTheBoxState;
  s.first = Math.floor(nextRandom(s)() * seats);
  s.turn = s.first;
  s.open = Array<boolean>(rules.tiles).fill(true);
  s.dice = [0, 0];
  s.played = Array<number | null>(seats).fill(null);
  s.left = Array<number>(seats).fill(0);
  s.boxes = Array<number>(seats).fill(0);
  s.tally = newTally(seats);
  return s;
}

// ---- The tiles ----------------------------------------------------------------------------------
// A set of tiles is a number with a bit for each: bit 0 is the 1 tile.

const maskOf = (open: readonly boolean[]) => open.reduce((mask, yes, i) => (yes ? mask | (1 << i) : mask), 0);
const sumOfMask = (mask: number) => {
  let sum = 0;
  for (let i = 0; mask >> i; i++) if ((mask >> i) & 1) sum += i + 1;
  return sum;
};
/** Every set of tiles (of the first twelve) that adds up to each total a roll can be. */
const COMBOS: number[][] = (() => {
  const by: number[][] = Array.from({ length: 13 }, () => []);
  const pick = (tile: number, mask: number, sum: number) => {
    if (sum > 12) return;
    if (tile > 12) return void (mask && by[sum]!.push(mask));
    pick(tile + 1, mask, sum);
    pick(tile + 1, mask | (1 << (tile - 1)), sum + tile);
  };
  pick(1, 0, 0);
  return by;
})();
/** The ways to make `total` out of the open tiles. */
const waysToMake = (mask: number, total: number): number[] => (total >= 1 && total <= 12 ? COMBOS[total]!.filter((combo) => (combo & mask) === combo) : []);
/** The open tiles that could be part of making `total`, as a set. */
const usable = (mask: number, total: number) => waysToMake(mask, total).reduce((all, combo) => all | combo, 0);

/** What the open tiles add up to. */
export const shutTheBoxOpen = (s: Pick<ShutTheBoxState, "open">): number => sumOfMask(maskOf(s.open));
/** Whether the seat whose turn it is may roll one die: it has rolled, and the open tiles add up to six or less. */
const oneDie = (s: ShutTheBoxState) => s.rolls > 0 && shutTheBoxOpen(s) <= SHUT_THE_BOX_ONE_DIE;

// ---- Moves --------------------------------------------------------------------------------------

/** Everyone has had a turn: on to the next round, or the end. */
function settle(s: ShutTheBoxState) {
  const scores = s.played.map((n) => n ?? 0);
  if (s.rules.drinking && s.seats > 1) {
    const most = Math.max(...scores);
    // Everyone level: nobody is left with the most.
    if (most > Math.min(...scores)) s.narration += ` · ${drink(s.tally, scores.flatMap((n, seat) => (n === most ? [seat] : [])), 1)}`;
  }
  if (s.round >= s.rules.rounds) {
    s.phase = "finished";
    return;
  }
  s.round += 1;
  s.first = (s.first + 1) % s.seats;
  s.turn = s.first;
  s.played.fill(null);
}

/** A seat's turn is over with the box as it stands. */
function finish(s: ShutTheBoxState, seat: number, line: string) {
  const score = shutTheBoxOpen(s);
  s.played[seat] = score;
  s.left[seat]! += score;
  if (score === 0) s.boxes[seat]! += 1;
  s.narration = line;
  // The box and the dice stay as they were left until the next roll.
  s.rolls = 0;
  s.need = 0;
  s.chosen = [];
  s.turn = (seat + 1) % s.seats;
  if (s.turn === s.first) settle(s);
}

function apply(state: ShutTheBoxState, seat: number, move: ShutTheBoxMove): ShutTheBoxState {
  if (move?.type !== "roll" && move?.type !== "shut") throw new GameError("That's not a move in Shut the Box.");
  if (state.phase !== "playing") throw new GameError("The game is over.");
  if (!Number.isInteger(seat) || seat < 0 || seat >= state.seats) throw new GameError("You're not at this table.");
  if (state.turn !== seat) throw new GameError("It's not your turn.");

  if (move.type === "roll") {
    if (state.need > 0) throw new GameError(`Shut tiles that add up to ${state.need + state.chosen.reduce((n, i) => n + i + 1, 0)} first.`);
    const single = move.dice !== undefined && Number(move.dice) === 1;
    if (move.dice !== undefined && !single && Number(move.dice) !== 2) throw new GameError("Roll one die or two.");
    if (single && !oneDie(state)) throw new GameError(`You can roll one die once the open tiles add up to ${SHUT_THE_BOX_ONE_DIE} or less.`);
    const s = clone(state);
    // A new turn starts with every tile open.
    if (s.rolls === 0) s.open.fill(true);
    const rand = nextRandom(s);
    s.dice = [1 + Math.floor(rand() * 6), single ? 0 : 1 + Math.floor(rand() * 6)];
    s.rolls += 1;
    s.throws += 1;
    const total = s.dice[0]! + s.dice[1]!;
    if (waysToMake(maskOf(s.open), total).length) {
      s.need = total;
      s.narration = `${who(seat)} rolls ${total}`;
    } else finish(s, seat, `${who(seat)} rolls ${total} and can't make it: ${shutTheBoxOpen(s)} left`);
    return s;
  }

  const cell = Number(move.cell);
  if (!Number.isInteger(cell) || cell < 0 || cell >= state.rules.tiles) throw new GameError("That's not a tile in the box.");
  if (state.need === 0) throw new GameError("Roll the dice first.");
  const s = clone(state);
  if (s.chosen.includes(cell)) {
    // Shut for this roll, and tapped again: it opens.
    s.chosen = s.chosen.filter((i) => i !== cell);
    s.open[cell] = true;
    s.need += cell + 1;
    return s;
  }
  if (!s.open[cell]) throw new GameError("That tile is already shut.");
  if (!((usable(maskOf(s.open), s.need) >> cell) & 1)) throw new GameError(`The ${cell + 1} can't be part of ${s.need}.`);
  s.open[cell] = false;
  s.chosen.push(cell);
  s.need -= cell + 1;
  if (s.need > 0) return s;
  const shut = s.chosen.map((i) => i + 1).sort((a, b) => a - b);
  s.chosen = [];
  s.narration = `${who(seat)} shuts ${shut.length > 1 ? `${shut.slice(0, -1).join(", ")} and ${shut.at(-1)}` : shut[0]}`;
  if (!s.open.some(Boolean)) finish(s, seat, `${who(seat)} shuts the box!`);
  return s;
}

const winnersOf = (s: ShutTheBoxState) => {
  const best = Math.min(...s.left);
  return s.left.flatMap((n, seat) => (n === best ? [seat] : []));
};

// ---- The computer player ------------------------------------------------------------------------
// It shuts whatever leaves the least behind on average, worked out exactly: a box has at most
// 4,096 ways to be part open, and what each is worth is the average over the next roll of the best
// way to make it (or, if it can't be made, what is open).

/** For two dice, how likely each total is; `TWO[7]` is 6/36. */
const TWO = Array.from({ length: 13 }, (_, total) => (total < 2 ? 0 : (6 - Math.abs(total - 7)) / 36));
const WORTH = new Map<number, number>();

/** What a turn is expected to leave, about to roll with these tiles open, and whether one die does better than two. */
function worth(mask: number): number {
  if (!mask) return 0;
  const known = WORTH.get(mask);
  if (known !== undefined) return known;
  const value = Math.min(rolling(mask, 2), sumOfMask(mask) <= SHUT_THE_BOX_ONE_DIE ? rolling(mask, 1) : Infinity);
  WORTH.set(mask, value);
  return value;
}
/** What these tiles are expected to leave if this many dice are rolled next. */
function rolling(mask: number, dice: 1 | 2): number {
  let sum = 0;
  for (let total = dice; total <= dice * 6; total++) sum += (dice === 1 ? 1 / 6 : TWO[total]!) * afterRoll(mask, total).value;
  return sum;
}
/** The best set of tiles to shut for a roll, and what that leaves on average. No set: the turn is over with what's open. */
function afterRoll(mask: number, total: number): { combo: number; value: number } {
  let best = { combo: 0, value: Infinity };
  for (const combo of waysToMake(mask, total)) {
    const value = worth(mask ^ combo);
    if (value < best.value) best = { combo, value };
  }
  return best.combo ? best : { combo: 0, value: sumOfMask(mask) };
}

/** What the sharpest player would do now: how many dice to roll, or (with a roll to make) the tiles to shut for the rest of it. */
export function shutTheBoxPlan(s: ShutTheBoxState): { dice: 1 | 2 } | { shut: number[] } | null {
  if (s.phase !== "playing") return null;
  const mask = maskOf(s.open);
  if (s.need === 0) return { dice: oneDie(s) && rolling(mask, 1) < rolling(mask, 2) ? 1 : 2 };
  const { combo } = afterRoll(mask, s.need);
  return { shut: s.open.flatMap((_, i) => ((combo >> i) & 1 ? [i + 1] : [])) };
}

function bot(s: ShutTheBoxState, seat: number, style: PlayStyle): ShutTheBoxMove | null {
  if (s.phase !== "playing" || s.turn !== seat) return null;
  // Shutting tiles takes a move a tile, so the plan has to be the same one each time it's asked
  // for between two rolls: whether this is a careless moment is decided by the dice.
  const rand = mulberry32((s.rng ^ Math.imul(s.throws + 1, 0x9e3779b1) ^ Math.imul(seat + 1, 0x85ebca6b)) >>> 0);
  const sloppy = careless(style, rand);
  if (s.need === 0) {
    const plan = shutTheBoxPlan(s) as { dice: 1 | 2 };
    return plan.dice === 1 && !sloppy ? { type: "roll", dice: 1 } : { type: "roll" };
  }
  // Someone not thinking uses up the small tiles first, which are the ones worth keeping.
  if (sloppy) {
    const can = usable(maskOf(s.open), s.need);
    return { type: "shut", cell: s.open.findIndex((_, i) => (can >> i) & 1) };
  }
  const { shut } = shutTheBoxPlan(s) as { shut: number[] };
  return { type: "shut", cell: shut.at(-1)! - 1 };
}

// ---- What a seat sees ---------------------------------------------------------------------------

function overTitle(s: ShutTheBoxState): string {
  const w = winnersOf(s);
  const best = s.left[w[0]!]!;
  if (s.seats === 1) return best === 0 && s.rules.rounds === 1 ? `${who(0)} shuts the box!` : `${who(0)} is left with ${best}`;
  if (w.length === s.seats) return `Everyone is left with ${best}!`;
  return w.length > 1 ? `${w.map(who).join(" and ")} tie on ${best}!` : best === 0 ? `${who(w[0]!)} wins with nothing left!` : `${who(w[0]!)} wins with ${best} left!`;
}

function view(s: ShutTheBoxState, seat: number): BoardView {
  const { rules } = s;
  const over = s.phase === "finished";
  const mine = !over && s.turn === seat;
  const mask = maskOf(s.open);
  const open = sumOfMask(mask);
  const rolled = s.need + s.chosen.reduce((n, i) => n + i + 1, 0);
  const can = s.need > 0 ? usable(mask, s.need) : 0;
  // Twelve tiles are two rows of six, so each is big enough to tap on a phone.
  const cols = rules.tiles === 12 ? 6 : 9;
  const grid: BoardGrid = {
    id: "box",
    label: "The box",
    rows: rules.tiles / cols,
    cols,
    cells: s.open.map((yes, i) => ({ owner: null, kind: yes ? "tile" : "shut", glyph: String(i + 1), label: yes ? `${i + 1}, open` : `${i + 1}, shut`, tone: yes ? "light" : "dark", id: `tile-${i + 1}`, faded: !yes })),
    names: s.open.map((_, i) => `tile ${i + 1}`),
    marks: s.chosen.map((cell) => ({ cell, mark: "last" as const })),
    tap: mine && s.need > 0 ? { type: "shut", cells: [...s.open.flatMap((_, i) => ((can >> i) & 1 ? [i] : [])), ...s.chosen].sort((a, b) => a - b) } : null,
  };
  // One die was rolled: only that one is on the table.
  const thrown = s.dice[1] || !s.dice[0] ? s.dice : s.dice.slice(0, 1);
  return {
    game: "shutthebox",
    seats: s.seats,
    me: seat,
    teams: false,
    phase: s.phase,
    turn: over ? null : s.turn,
    grids: [grid],
    reserves: [],
    // Dice whose roll has been made (or couldn't be) are dimmed until the next roll picks them up.
    dice: { dice: thrown.map((value, id) => ({ id, value: value || null, used: s.need === 0 && value > 0 })), roll: s.throws, sides: 6, tap: null },
    choices: mine
      ? s.need > 0
        ? { prompt: s.chosen.length ? `${s.need} more to shut. Tap a tile again to open it` : `Shut tiles that add up to ${rolled}`, options: [] }
        : {
            prompt: "",
            options: [
              { label: s.rolls === 0 ? "Roll the dice" : "Roll again", move: { type: "roll" }, primary: true },
              ...(oneDie(s) ? [{ label: "Roll one die", move: { type: "roll", dice: 1 } }] : []),
            ],
          }
      : null,
    players: s.left.map((total, i) => ({
      line:
        [
          ...(rules.rounds > 1 || over ? [`${total} in all`] : []),
          ...(over ? [] : s.played[i] !== null ? [s.played[i] === 0 ? "shut the box" : `left ${s.played[i]}`] : s.turn === i && s.rolls > 0 ? [`${open} open`] : []),
          ...(rules.drinking ? [`🍺 ${s.tally.drank[i]}`] : []),
        ].join(" · ") || "Yet to roll",
    })),
    info: [
      ...(rules.rounds > 1 ? [over ? `${rules.rounds} rounds played` : `Round ${s.round} of ${rules.rounds}`] : []),
      ...(s.seats > 1 && !over ? ["Lowest score wins"] : []),
      ...(!over && s.rolls > 0 ? [`${open} open`] : []),
      ...(rules.drinking && !over && s.seats > 1 ? ["🍺 Left with the most: you drink"] : []),
    ],
    narration: s.narration,
    scores: s.left.map((value, i) => ({ seats: [i], value })),
    result: over
      ? {
          key: "final",
          title: overTitle(s),
          sides: s.left.map((_, i) => [i]),
          rows: [
            ...(s.boxes.some(Boolean) ? [{ label: "Boxes shut", values: s.boxes.map(String) }] : []),
            { label: "Left open", values: s.left.map(String), tone: "total" as const },
            ...(rules.drinking ? [{ label: "Drinks 🍺", values: s.tally.drank.map(String) }] : []),
          ],
        }
      : null,
    over: over ? { winners: winnersOf(s), title: overTitle(s) } : null,
  };
}

// ---- The game -----------------------------------------------------------------------------------

function normalize(rules: unknown): ShutTheBoxRules {
  const given = (rules && typeof rules === "object" ? rules : {}) as Partial<ShutTheBoxRules>;
  const base = PRESETS.find((p) => p.id === given.id) ?? classicShutTheBox;
  const r = { ...base, ...given };
  return { id: String(r.id), name: String(r.name), tiles: Number(r.tiles) === 12 ? 12 : 9, rounds: ROUNDS.includes(Number(r.rounds)) ? Number(r.rounds) : 1, drinking: !!r.drinking };
}

export const shutTheBox: BoardGame<ShutTheBoxRules, ShutTheBoxState, ShutTheBoxMove> = {
  id: "shutthebox",
  name: "Shut the Box",
  emoji: "🧰",
  category: "dice",
  blurb: "Roll, and shut the tiles that add up to it",
  tagline: "Roll the dice and shut any open tiles that add up to the roll. Keep going until you can't: what's left open is your score, and lowest wins.",
  seats: { min: 1, max: 6, default: 2 },
  teams: false,
  presets: PRESETS,
  fields: [
    { key: "tiles", label: "Tiles", kind: "choice", options: [[9, "1 to 9"], [12, "1 to 12"]] },
    { key: "rounds", label: "Rounds", hint: "A turn each with a fresh box. Over several rounds the scores are added up.", kind: "choice", options: ROUNDS.map((n) => [n, n === 1 ? "One round" : `${n} rounds`]) },
    drinkingField<ShutTheBoxRules>("Adults only. Whoever is left with the most each round takes a drink (water counts)."),
  ],
  normalize,
  validate: () => [],
  describe(r) {
    return [
      `The box has tiles numbered 1 to ${r.tiles}, all open when your turn starts. Roll two dice and shut any open tiles that add up to the roll: a nine can be the 9, or 8 and 1, or 2, 3 and 4.`,
      "Roll again and keep shutting tiles until a roll can't be made from the tiles still open. That ends your turn, and the open tiles added up are your score.",
      `Once the open tiles add up to ${SHUT_THE_BOX_ONE_DIE} or less, you can roll one die instead of two.`,
      "Shut every tile and you have shut the box: a score of nothing.",
      r.rounds === 1 ? "Everyone has one turn. The lowest score wins." : `Everyone has ${r.rounds} turns, and the scores are added up. The lowest total wins.`,
      ...(r.drinking ? ["🍺 Drinking mode: whoever is left with the most each round takes a drink."] : []),
    ];
  },
  newGame: newShutTheBox,
  apply,
  view,
  bot,
  // Rolling is quick; which tiles to shut takes a moment, and the second of them less.
  thinkingTime: (s) => (s.need === 0 ? 800 : s.chosen.length ? 450 : 1100),
  summary(s) {
    const over = s.phase === "finished";
    return {
      game: "shutthebox",
      rules: s.rules.name,
      phase: s.phase,
      over,
      hand: s.round,
      scoreLine: s.left.join(" · ") + (s.seats === 1 ? " left" : "") + (s.rules.drinking ? ` · 🍺 ${s.tally.drank.join(" · ")}` : ""),
      order: over ? rankSeats(s.left.map((score, seat) => ({ seats: [seat], score })), true) : null,
      winners: over ? winnersOf(s) : null,
      teams: false,
      seats: s.seats,
    };
  },
};
