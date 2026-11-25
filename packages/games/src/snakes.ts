// Snakes & Ladders: a race up a board of a hundred squares. Everyone has one counter at the start,
// beside square 1, and the first to square 100 wins.
//
//   - The parlor's way (the usual rules): a turn is a roll of two dice, and the counter moves by one
//     die or the other, or by both together. Three ways to go, so most turns are a choice: reach for
//     a ladder, step round a snake's head.
//   - The classic way: one die, and the counter moves what it shows.
//   - Landing on the foot of a ladder takes the counter up it; landing on the head of a snake takes
//     it down. A board can be the parlor's own, or shuffled: new ladders and snakes every game,
//     dealt from the seed.
//   - Count past 100 and the counter bounces back off it (or, at a table that asks for it, a counter
//     needs the exact count, and a roll too big is no move).
//   - Land on someone and you swap places: they go back to the square you came from.
//   - Doubles (a six, with one die) roll again, up to twice in a row.
//
// The board is a grid of ten columns and eleven rows. The top ten rows are the squares, read as a
// snake: square 1 is bottom left, each row runs the other way from the one below, and square 100 is
// top left. The row under them is the start, a cell for each seat, the rest shaded "none". Every
// square carries its number (`tags`), each ladder and snake is a link from one cell to another
// (`links`), and the last move is a `trail` square by square, for a table that walks a counter along
// it. For a table that draws none of that, ladder feet and snake heads are also nobody's pieces whose
// glyph says where they lead ("↑23", "↓6"); nothing ever rests on one.
import type { PlayStyle } from "@journey-to-code/rules";
import type { BoardGame, BoardGrid, BoardPiece, BoardTone, BoardView, CellShade } from "./board.js";
import { careless, clone, GameError, nextRandom, pickRandom, rankSeats, who, type BaseRules, type Choice } from "./table.js";

export interface SnakesRules extends BaseRules {
  /** "choice": two dice, and the counter moves by either or both. "one": one die, moved as it falls. */
  dice: "choice" | "one";
  /** The parlor's own board, or a new one shuffled for every game. */
  board: "classic" | "shuffled";
  /** Snakes take a counter back down. Without them the board has only ladders. */
  snakes: boolean;
  /** Counting past 100: bounce back off it, or no move at all (the exact count). */
  finish: "bounce" | "exact";
  /** Landing on someone swaps the two of you. */
  bump: boolean;
  /** Doubles (a six, with one die) roll again, up to twice in a row. */
  again: boolean;
  /** Who throws first: the luck of the draw, or the first seat. */
  first: "random" | "seat1";
}

const BASE = { dice: "choice", board: "classic", snakes: true, finish: "bounce", bump: true, again: true, first: "random" } as const;
export const parlorSnakes: SnakesRules = { id: "snakes-parlor", name: "Parlor rules", ...BASE };
export const shuffledSnakes: SnakesRules = { id: "snakes-shuffled", name: "Shuffled board", ...BASE, board: "shuffled" };
export const classicSnakes: SnakesRules = { id: "snakes-classic", name: "Classic (one die)", ...BASE, dice: "one", bump: false };
export const gentleSnakes: SnakesRules = { id: "snakes-gentle", name: "Gentle (ladders only)", ...BASE, dice: "one", snakes: false, bump: false };
const PRESETS = [parlorSnakes, shuffledSnakes, classicSnakes, gentleSnakes];

// ---- The board ----------------------------------------------------------------------------------

/** The last square. A counter at 0 is at the start, beside square 1. */
export const SNAKES_END = 100;
const END = SNAKES_END;
export const SNAKES_COLS = 10;
const COLS = SNAKES_COLS;
const ROWS = 11;
const CELLS = ROWS * COLS;

/** Where the ladders and snakes are: a ladder's foot and top, a snake's head and tail. */
export interface SnakesLayout {
  ladders: [number, number][];
  snakes: [number, number][];
}

/** The parlor's own board: nine ladders and nine snakes, none crossing another, and a long one at 99. */
export const SNAKES_LADDERS: readonly (readonly [number, number])[] = [[3, 39], [11, 34], [20, 41], [24, 58], [32, 49], [42, 59], [48, 68], [63, 78], [85, 96]];
export const SNAKES_SNAKES: readonly (readonly [number, number])[] = [[17, 4], [25, 8], [50, 31], [67, 54], [72, 51], [80, 61], [88, 65], [97, 77], [99, 62]];
const CLASSIC: SnakesLayout = { ladders: SNAKES_LADDERS.map(([a, b]) => [a, b]), snakes: SNAKES_SNAKES.map(([a, b]) => [a, b]) };

/** Which row of the board (from the bottom) a square is on, and which column. */
const rowUp = (square: number) => Math.floor((square - 1) / COLS);
const colOf = (square: number) => (rowUp(square) % 2 === 0 ? (square - 1) % COLS : COLS - 1 - ((square - 1) % COLS));

/** How close two straight links come, in squares: 0 where they cross. */
function apart(a: readonly [number, number], b: readonly [number, number]): number {
  const p = (sq: number) => [colOf(sq), rowUp(sq)] as const;
  const [p1, p2, q1, q2] = [p(a[0]), p(a[1]), p(b[0]), p(b[1])];
  const cross = (o: readonly number[], x: readonly number[], y: readonly number[]) => (x[0]! - o[0]!) * (y[1]! - o[1]!) - (x[1]! - o[1]!) * (y[0]! - o[0]!);
  if (cross(p1, p2, q1) * cross(p1, p2, q2) < 0 && cross(q1, q2, p1) * cross(q1, q2, p2) < 0) return 0;
  const toSegment = (pt: readonly number[], s1: readonly number[], s2: readonly number[]) => {
    const dx = s2[0]! - s1[0]!;
    const dy = s2[1]! - s1[1]!;
    const t = Math.max(0, Math.min(1, ((pt[0]! - s1[0]!) * dx + (pt[1]! - s1[1]!) * dy) / (dx * dx + dy * dy)));
    return Math.hypot(pt[0]! - s1[0]! - t * dx, pt[1]! - s1[1]! - t * dy);
  };
  return Math.min(toSegment(p1, q1, q2), toSegment(p2, q1, q2), toSegment(q1, p1, p2), toSegment(q2, p1, p2));
}

/**
 * A board dealt from the random source: seven to nine ladders and as many snakes, each crossing at
 * least one row and leaning no more than three columns, none crossing or crowding another (so each
 * can be seen), none touching the same square, nothing on squares 1 and 100, and never more than
 * two snake heads in the last six squares (a finish nobody could get through).
 */
export function shuffledLayout(rand: () => number): SnakesLayout {
  const used = new Set([1, END]);
  const between = (lo: number, hi: number) => lo + Math.floor(rand() * (hi - lo + 1));
  const ladders: [number, number][] = [];
  const snakes: [number, number][] = [];
  const nLadders = between(7, 9);
  const nSnakes = between(7, 9);
  const fits = (link: [number, number]) => !used.has(link[0]) && !used.has(link[1]) && rowUp(link[0]) !== rowUp(link[1]) && Math.abs(colOf(link[0]) - colOf(link[1])) <= 3 && [...ladders, ...snakes].every((other) => apart(link, other) >= 0.9);
  for (let tries = 0; tries < 4000 && (ladders.length < nLadders || snakes.length < nSnakes); tries++) {
    if (ladders.length < nLadders && (snakes.length >= nSnakes || tries % 2 === 0)) {
      const foot = between(2, 88);
      const top = foot + between(9, 38);
      if (top >= END || !fits([foot, top])) continue;
      ladders.push([foot, top]);
      used.add(foot).add(top);
    } else {
      const head = between(14, 99);
      const tail = head - between(9, 44);
      if (tail < 2 || !fits([head, tail])) continue;
      if (head >= 94 && snakes.filter(([h]) => h >= 94).length >= 2) continue;
      snakes.push([head, tail]);
      used.add(head).add(tail);
    }
  }
  ladders.sort((a, b) => a[0] - b[0]);
  snakes.sort((a, b) => a[0] - b[0]);
  return { ladders, snakes };
}

/** Where a counter that counts to each square ends up: itself, or the other end of a ladder or snake. */
function landingsOf(layout: SnakesLayout, withSnakes: boolean): number[] {
  const out = Array.from({ length: END + 1 }, (_, square) => square);
  for (const [foot, top] of layout.ladders) out[foot] = top;
  if (withSnakes) for (const [head, tail] of layout.snakes) out[head] = tail;
  return out;
}

/** The cell a square of the board is drawn in. */
function squareCell(square: number): number {
  const i = square - 1;
  const up = Math.floor(i / COLS);
  const col = up % 2 === 0 ? i % COLS : COLS - 1 - (i % COLS);
  return (ROWS - 2 - up) * COLS + col;
}
const SQUARE_CELL: readonly number[] = Array.from({ length: END + 1 }, (_, square) => (square === 0 ? -1 : squareCell(square)));
const startCell = (seat: number) => (ROWS - 1) * COLS + seat;
/** The cell a seat's counter is drawn in when it is on `square` (0 is its place at the start). */
export const snakesCell = (seat: number, square: number) => (square === 0 ? startCell(seat) : SQUARE_CELL[square]!);

// ---- The state ----------------------------------------------------------------------------------

/** How the last move went: who moved, from where, by how much, and what happened on the way. */
export interface SnakesLast {
  seat: number;
  from: number;
  by: number;
  /** The square the count came to, after any bounce: the foot of a ladder, say. */
  counted: number;
  /** Where the counter ended up. */
  to: number;
  bounced: boolean;
  /** The seats it swapped places with: each is now on `from`. */
  swapped: number[];
}

export interface SnakesState {
  game: "snakes";
  rules: SnakesRules;
  seats: number;
  rng: number;
  /** The board this game is played on. */
  layout: SnakesLayout;
  /** Whose turn it is. */
  turn: number;
  /** "roll" until the dice are thrown, "move" while a choice is waiting, "finished" at the end. */
  phase: "roll" | "move" | "finished";
  /** Each seat's square: 0 at the start, `SNAKES_END` home. */
  at: number[];
  /** The dice last thrown: this turn's while moving, the last throw's while waiting. Empty before the first. */
  dice: number[];
  /** How many times the dice have been thrown, and how many moves made: the table's keys. */
  rolls: number;
  moves: number;
  /** Extra throws this seat has had this turn, for doubles. */
  streak: number;
  last: SnakesLast | null;
  narration: string | null;
}

export type SnakesMove = { type: "roll" } | { type: "move"; by?: number; from?: number; to?: number };

function newSnakes(rules: SnakesRules, seats: number, seed: number): SnakesState {
  const s: SnakesState = {
    game: "snakes",
    rules,
    seats,
    rng: seed >>> 0,
    layout: CLASSIC,
    turn: 0,
    phase: "roll",
    at: Array<number>(seats).fill(0),
    dice: [],
    rolls: 0,
    moves: 0,
    streak: 0,
    last: null,
    narration: null,
  };
  if (rules.board === "shuffled") s.layout = shuffledLayout(nextRandom(s));
  if (rules.first === "random") s.turn = Math.floor(nextRandom(s)() * seats);
  return s;
}

/** The landings for a layout and whether it has snakes, worked out once for each. */
const landCache = new Map<string, number[]>();
function landOf(s: Pick<SnakesState, "layout" | "rules">): number[] {
  const key = `${s.rules.snakes ? 1 : 0}${JSON.stringify(s.layout)}`;
  let land = landCache.get(key);
  if (!land) {
    if (landCache.size > 64) landCache.clear();
    land = landingsOf(s.layout, s.rules.snakes);
    landCache.set(key, land);
  }
  return land;
}

/** One way a counter could go with the dice thrown. */
export interface SnakesOption {
  by: number;
  counted: number;
  to: number;
  bounced: boolean;
}

/** The counts on offer from the dice: one die or the other or both, or the one die. */
const countsOf = (dice: readonly number[], mode: SnakesRules["dice"]) => (mode === "one" || dice.length < 2 ? [dice[0]!] : [...new Set([dice[0]!, dice[1]!, dice[0]! + dice[1]!])].sort((a, b) => a - b));

/** Where each count takes a counter on `from`: none that two counts share, none past 100 at an exact table. */
function optionsFrom(land: readonly number[], from: number, counts: readonly number[], finish: SnakesRules["finish"]): SnakesOption[] {
  const out: SnakesOption[] = [];
  for (const by of counts) {
    let counted = from + by;
    let bounced = false;
    if (counted > END) {
      if (finish === "exact") continue;
      counted = 2 * END - counted;
      bounced = true;
    }
    if (out.some((o) => o.counted === counted)) continue;
    out.push({ by, counted, to: land[counted]!, bounced });
  }
  return out;
}

/** The ways the seat to move can go now. */
export function snakesOptions(s: SnakesState, seat: number): SnakesOption[] {
  if (s.phase !== "move" || s.turn !== seat) return [];
  return optionsFrom(landOf(s), s.at[seat]!, countsOf(s.dice, s.rules.dice), s.rules.finish);
}

const lucky = (s: SnakesState) => (s.rules.dice === "one" ? s.dice[0] === 6 : s.dice.length === 2 && s.dice[0] === s.dice[1]);

/** The turn passes on. */
function pass(s: SnakesState) {
  s.turn = (s.turn + 1) % s.seats;
  s.phase = "roll";
  s.streak = 0;
}

/** After a move: the same seat throws again for doubles, or the turn passes. Says which. */
function afterMove(s: SnakesState, seat: number): string {
  if (s.rules.again && lucky(s) && s.streak < 2) {
    s.streak += 1;
    s.phase = "roll";
    return `. ${s.rules.dice === "one" ? "A six" : "Doubles"}: ${who(seat)} rolls again`;
  }
  pass(s);
  return "";
}

/** Move the seat's counter as `option` says, and say what happened. */
function perform(s: SnakesState, seat: number, option: SnakesOption, thrown: string | null): void {
  const from = s.at[seat]!;
  s.at[seat] = option.to;
  const swapped: number[] = [];
  if (s.rules.bump && option.to !== END && option.to !== 0) {
    for (let other = 0; other < s.seats; other++) {
      if (other !== seat && s.at[other] === option.to) {
        s.at[other] = from;
        swapped.push(other);
      }
    }
  }
  s.moves += 1;
  s.last = { seat, from, by: option.by, counted: option.counted, to: option.to, bounced: option.bounced, swapped };

  let line = thrown ? `${thrown}, ` : `${who(seat)} `;
  line += `moves ${option.by}`;
  if (option.bounced) line += `, bounces back off ${END} to ${option.counted}`;
  if (option.to > option.counted) line += ` and climbs the ladder from ${option.counted} to ${option.to}`;
  else if (option.to < option.counted) line += ` and slides down the snake from ${option.counted} to ${option.to}`;
  else if (option.to === END) line += ` to square ${END}`;
  else if (!option.bounced) line += ` to square ${option.to}`;
  if (swapped.length) line += ` and swaps places with ${swapped.map(who).join(" and ")}`;

  if (option.to === END) {
    s.phase = "finished";
    s.narration = `${line}. ${who(seat)} wins!`;
    return;
  }
  s.narration = line + afterMove(s, seat);
}

// ---- Moves --------------------------------------------------------------------------------------

function apply(state: SnakesState, seat: number, move: SnakesMove): SnakesState {
  if (move?.type !== "roll" && move?.type !== "move") throw new GameError("That's not a move in Snakes & Ladders.");
  if (state.phase === "finished") throw new GameError("The game is over.");
  if (!Number.isInteger(seat) || seat < 0 || seat >= state.seats) throw new GameError("You're not at this table.");
  if (state.turn !== seat) throw new GameError("It's not your turn.");

  if (move.type === "roll") {
    if (state.phase !== "roll") throw new GameError("Move your counter first.");
    const s = clone(state);
    const rand = nextRandom(s);
    s.dice = s.rules.dice === "one" ? [1 + Math.floor(rand() * 6)] : [1 + Math.floor(rand() * 6), 1 + Math.floor(rand() * 6)];
    s.rolls += 1;
    s.phase = "move";
    const thrown = `${who(seat)} rolls ${s.dice.join(" and ")}`;
    const options = snakesOptions(s, seat);
    if (!options.length) {
      s.last = null;
      s.narration = `${thrown} and can't move: ${END} takes the exact count`;
      pass(s);
    } else if (options.length === 1) perform(s, seat, options[0]!, thrown);
    else s.narration = thrown;
    return s;
  }

  if (state.phase !== "move") throw new GameError("Roll the dice first.");
  const options = snakesOptions(state, seat);
  let option: SnakesOption | undefined;
  if (move.by !== undefined) option = options.find((o) => o.by === Number(move.by));
  else if (move.to !== undefined) {
    const to = Number(move.to);
    option = options.find((o) => snakesCell(seat, o.counted) === to) ?? options.find((o) => snakesCell(seat, o.to) === to);
  }
  if (!option) {
    const counts = options.map((o) => o.by);
    throw new GameError(`Move ${counts.slice(0, -1).join(", ")}${counts.length > 1 ? " or " : ""}${counts[counts.length - 1]}.`);
  }
  const s = clone(state);
  perform(s, seat, option, null);
  return s;
}

// ---- The computer player ------------------------------------------------------------------------
// It weighs each way to go by where the counter would be likely to get to on its next throw (so a
// square just short of a ladder is worth more than one just past it, and one in reach of a snake's
// head worth less), by what a swap would take from the player it lands on, and by the chance
// someone behind lands on it and swaps it back.

/** For every square, the square a counter on it gets to on average with its next throw, played as well as it can be. */
const outlookCache = new WeakMap<number[], Map<string, Float64Array>>();
function outlookOf(land: number[], mode: SnakesRules["dice"], finish: SnakesRules["finish"]): Float64Array {
  const byRules = outlookCache.get(land) ?? new Map<string, Float64Array>();
  outlookCache.set(land, byRules);
  const key = `${mode}/${finish}`;
  const known = byRules.get(key);
  if (known) return known;
  const table = new Float64Array(END + 1);
  for (let from = 0; from < END; from++) {
    let total = 0;
    let n = 0;
    for (let a = 1; a <= 6; a++) {
      for (let b = 1; b <= (mode === "one" ? 1 : 6); b++) {
        const options = optionsFrom(land, from, mode === "one" ? [a] : countsOf([a, b], "choice"), finish);
        total += options.length ? Math.max(...options.map((o) => (o.to === END ? END + 20 : o.to))) : from;
        n += 1;
      }
    }
    table[from] = total / n;
  }
  table[END] = END + 30;
  byRules.set(key, table);
  return table;
}

/** The chance (out of 1) a counter on `from` can land on `square` with its next throw, when it would want to. */
function reachChance(land: readonly number[], from: number, square: number, mode: SnakesRules["dice"], finish: SnakesRules["finish"]): number {
  if (from >= square) return 0;
  let hits = 0;
  let n = 0;
  for (let a = 1; a <= 6; a++) {
    for (let b = 1; b <= (mode === "one" ? 1 : 6); b++) {
      n += 1;
      if (optionsFrom(land, from, mode === "one" ? [a] : countsOf([a, b], "choice"), finish).some((o) => o.to === square)) hits += 1;
    }
  }
  return hits / n;
}

/** How good going `option` looks to `seat`. */
function weigh(s: SnakesState, seat: number, option: SnakesOption): number {
  const land = landOf(s);
  const outlook = outlookOf(land, s.rules.dice, s.rules.finish);
  if (option.to === END) return 1e6;
  const from = s.at[seat]!;
  let value = outlook[option.to]!;
  if (s.rules.bump) {
    for (let other = 0; other < s.seats; other++) {
      if (other === seat) continue;
      const theirs = s.at[other]!;
      // A swap: they drop back to where this counter came from.
      if (theirs === option.to) value += (theirs - from) * 0.8;
      // Someone behind who could land here and swap it back.
      else if (theirs < option.to) value -= reachChance(land, theirs, option.to, s.rules.dice, s.rules.finish) * (option.to - theirs) * 0.6;
    }
  }
  return value;
}

function bot(s: SnakesState, seat: number, style: PlayStyle, rand: () => number = Math.random): SnakesMove | null {
  if (s.phase === "finished" || s.turn !== seat) return null;
  if (s.phase === "roll") return { type: "roll" };
  const options = snakesOptions(s, seat);
  if (!options.length) return null;
  if (careless(style, rand)) return { type: "move", by: pickRandom(options, rand).by };
  let best = options[0]!;
  let bestValue = -Infinity;
  for (const option of options) {
    // A whisker of chance, so two ways that come to the same aren't always played the same.
    const value = weigh(s, seat, option) + rand() * 0.01;
    if (value > bestValue) {
      best = option;
      bestValue = value;
    }
  }
  return { type: "move", by: best.by };
}

// ---- What a seat sees ---------------------------------------------------------------------------

const TONES: BoardTone[] = ["red", "blue", "green", "gold"];
const COLOUR = ["red", "blue", "green", "yellow"];

/** The board with nothing on it: shades, names, numbers, and the ladders and snakes. Made once for each board. */
interface Bare {
  shade: CellShade[];
  names: string[];
  tags: string[];
  links: NonNullable<BoardGrid["links"]>;
  cells: (BoardPiece | null)[];
}
const bareBoards = new Map<string, Bare>();
function bareOf(s: SnakesState): Bare {
  const key = `${s.seats}${s.rules.snakes ? 1 : 0}${JSON.stringify(s.layout)}`;
  let bare = bareBoards.get(key);
  if (bare) return bare;
  const shade = Array<CellShade>(CELLS).fill("none");
  const names = Array<string>(CELLS).fill("off the board");
  const tags = Array<string>(CELLS).fill("");
  const links: Bare["links"] = [];
  const cells = Array<BoardPiece | null>(CELLS).fill(null);
  for (let square = 1; square <= END; square++) {
    const cell = SQUARE_CELL[square]!;
    shade[cell] = (rowUp(square) + (cell % COLS)) % 2 === 0 ? "light" : "dark";
    tags[cell] = String(square);
    names[cell] = square === END ? `square ${END}, the finish` : `square ${square}`;
  }
  const lay = (from: number, to: number, kind: "ladder" | "snake") => {
    const up = kind === "ladder";
    shade[SQUARE_CELL[from]!] = "spot";
    names[SQUARE_CELL[from]!] = `square ${from}, ${up ? "a ladder up" : "a snake down"} to ${to}`;
    names[SQUARE_CELL[to]!] = `square ${to}, the ${up ? "top of the ladder" : "tail of the snake"} from ${from}`;
    links.push({ from: SQUARE_CELL[from]!, to: SQUARE_CELL[to]!, kind, label: `${up ? "ladder" : "snake"} from square ${from} ${up ? "up" : "down"} to ${to}` });
    cells[SQUARE_CELL[from]!] = { owner: null, kind, glyph: `${up ? "↑" : "↓"}${to}`, label: `${up ? "ladder up" : "snake down"} to square ${to}`, tone: up ? "light" : "dark" };
  };
  for (const [foot, top] of s.layout.ladders) lay(foot, top, "ladder");
  if (s.rules.snakes) for (const [head, tail] of s.layout.snakes) lay(head, tail, "snake");
  for (let seat = 0; seat < s.seats; seat++) {
    shade[startCell(seat)] = "plain";
    names[startCell(seat)] = `${COLOUR[seat]}'s start`;
  }
  bare = { shade, names, tags, links, cells };
  if (bareBoards.size > 64) bareBoards.clear();
  bareBoards.set(key, bare);
  return bare;
}

const counterOf = (owner: number): BoardPiece => ({ owner, kind: "counter", glyph: "●", label: `${COLOUR[owner]} counter`, tone: TONES[owner] });
/** A counter's id: the same all game. */
export const snakesId = (seat: number) => `snakes-${seat}`;

/** The squares a count passes over, from the one after `from` to where it came to (bounce and all). */
function stepsOf(from: number, by: number): number[] {
  const out: number[] = [];
  let at = from;
  let dir = 1;
  for (let k = 0; k < by; k++) {
    if (at === END) dir = -1;
    at += dir;
    out.push(at);
  }
  return out;
}

/** The last move as a trail of cells. */
function trailOf(s: SnakesState): BoardGrid["trail"] {
  const last = s.last;
  if (!last) return null;
  const cells = [snakesCell(last.seat, last.from), ...stepsOf(last.from, last.by).map((sq) => SQUARE_CELL[sq]!)];
  const by = cells.slice(1).map(() => "step");
  if (last.to !== last.counted) {
    cells.push(SQUARE_CELL[last.to]!);
    by.push(last.to > last.counted ? "ladder" : "snake");
  }
  const paths = [{ id: snakesId(last.seat), cells, by }];
  for (const other of last.swapped) paths.push({ id: snakesId(other), cells: [SQUARE_CELL[last.to]!, snakesCell(other, last.from)], by: ["swap"] });
  return { key: s.moves, paths };
}

/** What a way to go says on its button: "+5 → 33", "+8 🪜 56", "+2 🐍 6", "+3 🏁". */
function optionLabel(o: SnakesOption): string {
  return `+${o.by} ${o.to === END ? "🏁" : o.to > o.counted ? `🪜 ${o.to}` : o.to < o.counted ? `🐍 ${o.to}` : `→ ${o.to}`}`;
}
function optionHint(o: SnakesOption): string {
  return `Move ${o.by}${o.bounced ? `, bounce off ${END}` : ""}${o.to > o.counted ? `, up the ladder to ${o.to}` : o.to < o.counted ? `, down the snake to ${o.to}` : ` to square ${o.to}`}`;
}

function view(s: SnakesState, seat: number): BoardView {
  const over = s.phase === "finished";
  const mine = !over && s.turn === seat;
  const bare = bareOf(s);
  const cells = [...bare.cells];
  const marks: NonNullable<BoardGrid["marks"]> = [];

  // Counters, gathered by the cell they stand on: those sharing one are a stack of everyone's ids.
  const here = new Map<number, number[]>();
  s.at.forEach((square, owner) => {
    const cell = snakesCell(owner, square);
    here.set(cell, [...(here.get(cell) ?? []), owner]);
  });
  for (const [cell, owners] of here) {
    const first = counterOf(owners[0]!);
    cells[cell] = owners.length > 1 ? { ...first, glyph: String(owners.length), label: owners.map((o) => `${COLOUR[o]}`).join(" and ") + " counters", count: owners.length, ids: owners.map(snakesId) } : { ...first, id: snakesId(owners[0]!) };
  }
  if (s.last) marks.push({ cell: snakesCell(s.last.seat, s.last.from), mark: "from" }, { cell: SQUARE_CELL[s.last.to]!, mark: "last" });

  const options = snakesOptions(s, seat);
  for (const o of options) marks.push({ cell: SQUARE_CELL[o.counted]!, mark: "hint" });
  const grid: BoardGrid = {
    id: "board",
    label: "Board",
    rows: ROWS,
    cols: COLS,
    cells,
    shade: bare.shade,
    names: bare.names,
    tags: bare.tags,
    links: bare.links,
    marks,
    trail: trailOf(s),
    select: options.length ? { type: "move", sources: [{ from: snakesCell(seat, s.at[seat]!), to: options.map((o) => SQUARE_CELL[o.counted]!) }] } : null,
  };

  const where = (i: number) => (s.at[i] === 0 ? "at the start" : s.at[i] === END ? "home!" : `on square ${s.at[i]}`);
  const winner = over ? s.last!.seat : null;
  const title = over ? `${who(winner!)} wins!` : "";
  const moveChoices: Choice[] = options.map((o) => ({ label: optionLabel(o), hint: optionHint(o), move: { type: "move", by: o.by } }));
  return {
    game: "snakes",
    seats: s.seats,
    me: seat,
    teams: false,
    phase: s.phase,
    turn: over ? null : s.turn,
    grids: [grid],
    reserves: [],
    // Dimmed while they are last turn's, or once they have been moved.
    dice: { dice: (s.rules.dice === "one" ? [0] : [0, 1]).map((id) => ({ id, value: s.dice[id] ?? null, used: s.phase !== "move" && s.dice.length > 0 })), roll: s.rolls, sides: 6, tap: null },
    choices: mine
      ? s.phase === "roll"
        ? { prompt: "", options: [{ label: s.streak ? "Roll again" : "Roll the dice", move: { type: "roll" }, primary: true }] }
        : { prompt: s.rules.dice === "one" ? "" : "Move by one die, or both", options: moveChoices, layout: "row" }
      : null,
    players: s.at.map((_, i) => ({ line: where(i), piece: counterOf(i), ...(s.streak && s.turn === i && !over ? { badge: "Rolls again" } : {}) })),
    info: over
      ? []
      : [
          `First to square ${END} wins`,
          s.rules.finish === "bounce" ? `Count past ${END} and you bounce back` : `Square ${END} takes the exact count`,
          ...(s.rules.bump ? ["Land on someone and you swap places"] : []),
          ...(s.rules.again ? [s.rules.dice === "one" ? "A six rolls again" : "Doubles roll again"] : []),
        ],
    narration: s.narration,
    scores: s.at.map((square, i) => ({ seats: [i], value: square })),
    result: over ? { key: "final", title, sides: s.at.map((_, i) => [i]), rows: [{ label: "Square", values: s.at.map((square) => String(square)), tone: "total" as const }] } : null,
    over: over ? { winners: [winner!], title } : null,
  };
}

// ---- The game -----------------------------------------------------------------------------------

function normalize(rules: unknown): SnakesRules {
  const given = (rules && typeof rules === "object" ? rules : {}) as Partial<SnakesRules>;
  const base = PRESETS.find((p) => p.id === given.id) ?? parlorSnakes;
  const r = { ...base, ...given };
  return {
    id: String(r.id),
    name: String(r.name),
    dice: r.dice === "one" ? "one" : "choice",
    board: r.board === "shuffled" ? "shuffled" : "classic",
    snakes: r.snakes !== false,
    finish: r.finish === "exact" ? "exact" : "bounce",
    bump: r.bump !== false,
    again: r.again !== false,
    first: r.first === "seat1" ? "seat1" : "random",
  };
}

export const snakes: BoardGame<SnakesRules, SnakesState, SnakesMove> = {
  id: "snakes",
  name: "Snakes & Ladders",
  emoji: "🐍",
  category: "board",
  blurb: "Race to square 100, up ladders and down snakes",
  tagline: "Roll two dice and move by one or both: reach for the ladders, dodge the snakes, and swap places with anyone you land on.",
  seats: { min: 2, max: 4, default: 2 },
  teams: false,
  presets: PRESETS,
  fields: [
    { key: "dice", label: "Dice", kind: "choice", options: [["choice", "Two: move by one or both"], ["one", "One (classic)"]] },
    { key: "board", label: "Board", kind: "choice", options: [["classic", "The parlor's board"], ["shuffled", "Shuffled every game"]] },
    { key: "snakes", label: "Snakes", hint: "Without them the board has only ladders.", kind: "toggle" },
    { key: "finish", label: "Past 100", kind: "choice", options: [["bounce", "Bounce back"], ["exact", "Needs the exact count"]] },
    { key: "bump", label: "Swap places", hint: "Land on someone and they go back to where you came from.", kind: "toggle" },
    { key: "again", label: "Roll again", hint: "Doubles (a six, with one die) roll again, up to twice in a row.", kind: "toggle" },
    { key: "first", label: "Who goes first", kind: "choice", options: [["random", "Luck of the draw"], ["seat1", "The first seat"]] },
  ],
  normalize,
  validate: () => [],
  describe(r) {
    return [
      `Everyone starts beside square 1. The board snakes up from square 1, bottom left, to square ${END}, top left.`,
      r.dice === "one" ? "On your turn, roll the die and move that many squares." : "On your turn, roll two dice and move by one die, the other, or both added together: whichever suits you.",
      r.snakes ? "Land on the foot of a ladder and you climb it. Land on a snake's head and you slide down to its tail." : "Land on the foot of a ladder and you climb it. There are no snakes on this board.",
      r.board === "shuffled" ? "The ladders and snakes are shuffled for every game." : "The board is the parlor's own, the same every game.",
      r.finish === "bounce" ? `Count past ${END} and you bounce back off it by the squares left over.` : `You need the exact count to land on ${END}; a roll too big is no move.`,
      ...(r.bump ? ["Land on someone and you swap places: they go back to the square you came from."] : ["Any number of counters can share a square."]),
      ...(r.again ? [r.dice === "one" ? "Roll a six and you roll again, up to twice in a row." : "Roll doubles and you roll again, up to twice in a row."] : []),
      `The first to square ${END} wins.`,
      r.first === "random" ? "Who goes first is the luck of the draw." : "The first seat goes first.",
    ];
  },
  newGame: newSnakes,
  apply,
  view,
  bot,
  // Long enough for the table to walk the last move before the next throw: a hop a square, a beat for a ladder or a snake.
  thinkingTime: (s) => {
    if (s.phase === "move") return 900;
    const last = s.last;
    const walk = last ? last.by * 170 + (last.to !== last.counted ? 900 : 0) + (last.swapped.length ? 400 : 0) : 0;
    return Math.min(4200, 700 + walk);
  },
  summary(s) {
    const over = s.phase === "finished";
    return {
      game: "snakes",
      rules: s.rules.name,
      phase: s.phase,
      over,
      hand: 1,
      scoreLine: s.at.join(" · "),
      order: over ? rankSeats(s.at.map((square, i) => ({ seats: [i], score: square }))) : null,
      winners: over ? [s.last!.seat] : null,
      teams: false,
      seats: s.seats,
    };
  },
};
