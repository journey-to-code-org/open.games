// Chinese Checkers: a six-pointed star of 121 holes, and ten pegs each in the point nearest you.
// The race is to get all ten into the point straight across. A peg moves one hole along a line, or
// jumps over one peg next to it (anyone's) into the empty hole beyond, and may go on jumping from
// where it lands for as long as there is something to jump. Nothing is ever taken off the board.
//
//   - A peg may pass through anyone's point but can only come to rest in the point it started in
//     or the one it is going to.
//   - You have won when the point across from you is full and at least one peg in it is yours, so
//     nobody can keep you out by leaving a peg at home.
//   - So that a game always ends, it is played to a number of turns each: if nobody has got home
//     by then, whoever has most pegs home (and then whoever is nearest) wins.
//
// The star is drawn on a grid of 17 rows by 25 columns: the holes of a row are two columns apart,
// and each row sits a column to the side of the one above, so the six holes round a hole are two
// along the row and one diagonally each way. Every cell that isn't a hole is shaded "none".
import type { PlayStyle } from "@journey-to-code/rules";
import type { BoardGame, BoardGrid, BoardPiece, BoardTone, BoardView, CellShade } from "./board.js";
import { careless, clone, GameError, nextRandom, pickRandom, thinkFor, who, type BaseRules } from "./table.js";

export interface ChineseCheckersRules extends BaseRules {
  /** Turns each before the game is called for whoever is furthest on. */
  turns: number;
}

export const classicChineseCheckers: ChineseCheckersRules = { id: "chinesecheckers-classic", name: "Classic", turns: 100 };
export const quickChineseCheckers: ChineseCheckersRules = { id: "chinesecheckers-quick", name: "Quick (50 turns each)", turns: 50 };
export const longChineseCheckers: ChineseCheckersRules = { id: "chinesecheckers-long", name: "Long (200 turns each)", turns: 200 };
const PRESETS = [classicChineseCheckers, quickChineseCheckers, longChineseCheckers];
const TURNS = [50, 100, 200];

// ---- The star -----------------------------------------------------------------------------------

export const STAR_ROWS = 17;
export const STAR_COLS = 25;
const COLS = STAR_COLS;
/** How many holes each row has, from the top point to the bottom one. */
const WIDTHS = [1, 2, 3, 4, 13, 12, 11, 10, 9, 10, 11, 12, 13, 4, 3, 2, 1];
const cellAt = (row: number, col: number) => row * COLS + col;
const rowOf = (cell: number) => Math.floor(cell / COLS);
const colOf = (cell: number) => cell % COLS;
/** The cells of a row's holes, left to right. */
const rowHoles = (row: number) => Array.from({ length: WIDTHS[row]! }, (_, i) => cellAt(row, 12 - (WIDTHS[row]! - 1) + 2 * i));
const HOLES: readonly number[] = WIDTHS.flatMap((_, row) => rowHoles(row));
const IS_HOLE: readonly boolean[] = (() => {
  const out = Array<boolean>(STAR_ROWS * COLS).fill(false);
  for (const cell of HOLES) out[cell] = true;
  return out;
})();
/** The six ways to a hole next door: along the row, and diagonally up and down. */
const WAYS: readonly (readonly [number, number])[] = [[0, 2], [0, -2], [1, 1], [1, -1], [-1, 1], [-1, -1]];
const step = (cell: number, [dr, dc]: readonly [number, number], times = 1): number | null => {
  const row = rowOf(cell) + dr * times;
  const col = colOf(cell) + dc * times;
  return row >= 0 && row < STAR_ROWS && col >= 0 && col < COLS && IS_HOLE[cellAt(row, col)] ? cellAt(row, col) : null;
};
/** How many steps apart two holes are. */
export function starDistance(a: number, b: number): number {
  const dr = Math.abs(rowOf(a) - rowOf(b));
  const dc = Math.abs(colOf(a) - colOf(b));
  return dr + Math.max(0, (dc - dr) / 2);
}

/**
 * The six points, clockwise from the top: each is ten holes, and `tip` is its outermost one. The
 * point across from point k is k + 3.
 */
const POINTS: readonly { holes: readonly number[]; tip: number }[] = (() => {
  // The first four holes of a row of the wide middle, less one a row, are a side point; so are the last four.
  const side = (rows: number[], end: "left" | "right") => rows.flatMap((row, i) => (end === "left" ? rowHoles(row).slice(0, 4 - i) : rowHoles(row).slice(-(4 - i))));
  const top = [0, 1, 2, 3].flatMap(rowHoles);
  const bottom = [16, 15, 14, 13].flatMap(rowHoles);
  return [
    { holes: top, tip: cellAt(0, 12) },
    { holes: side([4, 5, 6, 7], "right"), tip: cellAt(4, 24) },
    { holes: side([12, 11, 10, 9], "right"), tip: cellAt(12, 24) },
    { holes: bottom, tip: cellAt(16, 12) },
    { holes: side([12, 11, 10, 9], "left"), tip: cellAt(12, 0) },
    { holes: side([4, 5, 6, 7], "left"), tip: cellAt(4, 0) },
  ];
})();
/** Which point a hole is in, or -1 for the middle of the board. */
const POINT_OF: readonly number[] = (() => {
  const out = Array<number>(STAR_ROWS * COLS).fill(-1);
  POINTS.forEach((point, k) => point.holes.forEach((cell) => (out[cell] = k)));
  return out;
})();
/** Which points are played, by how many are at the table: the first seat's is the bottom one. */
const pointsFor = (seats: number): number[] => ({ 2: [3, 0], 3: [3, 5, 1], 4: [2, 4, 5, 1], 5: [3, 4, 5, 0, 1], 6: [3, 4, 5, 0, 1, 2] })[seats] ?? [3, 0];
const across = (point: number) => (point + 3) % 6;

// ---- The state ----------------------------------------------------------------------------------

export interface ChineseCheckersState {
  game: "chinesecheckers";
  rules: ChineseCheckersRules;
  seats: number;
  rng: number;
  turn: number;
  /** Moves made so far, by everyone: the game is called after `rules.turns` each. */
  moves: number;
  /** Where each seat's ten pegs are: cells of the grid. A peg keeps its place in the list all game. */
  pegs: number[][];
  /** The last move: where from, where to, and (for a run of jumps) the holes it touched down in on the way. */
  last: { from: number; to: number; via: number[] } | null;
  /** Why the game ended: someone got home, or the turns ran out. */
  ended: "home" | "turns" | null;
  phase: "playing" | "finished";
  narration: string | null;
}

export type ChineseCheckersMove = { type: "move"; from: number; to: number };

export function newChineseCheckers(rules: ChineseCheckersRules, seats: number, seed: number): ChineseCheckersState {
  const s = { game: "chinesecheckers", rules, seats, rng: seed >>> 0, moves: 0, last: null, ended: null, phase: "playing", narration: null } as unknown as ChineseCheckersState;
  s.turn = Math.floor(nextRandom(s)() * seats);
  s.pegs = pointsFor(seats).map((point) => [...POINTS[point]!.holes]);
  return s;
}

const homeOf = (s: Pick<ChineseCheckersState, "seats">, seat: number) => pointsFor(s.seats)[seat]!;
const goalOf = (s: Pick<ChineseCheckersState, "seats">, seat: number) => across(homeOf(s, seat));
/** Who is in each cell: a seat, or -1. */
function occupants(s: Pick<ChineseCheckersState, "pegs">): Int8Array {
  const board = new Int8Array(STAR_ROWS * COLS).fill(-1);
  s.pegs.forEach((pegs, seat) => pegs.forEach((cell) => (board[cell] = seat)));
  return board;
}

/**
 * Everywhere a peg could end its move, with the holes a run of jumps would touch on the way there.
 * A peg can pass through any point, but only rest in the middle, its own point or its goal.
 */
function reach(s: ChineseCheckersState, seat: number, from: number, board = occupants(s)): Map<number, number[]> {
  const out = new Map<number, number[]>();
  const rest = (cell: number) => POINT_OF[cell] === -1 || POINT_OF[cell] === homeOf(s, seat) || POINT_OF[cell] === goalOf(s, seat);
  for (const way of WAYS) {
    const next = step(from, way);
    if (next !== null && board[next] === -1 && rest(next)) out.set(next, []);
  }
  // Jumps: over one peg into the empty hole beyond, and on from there.
  const seen = new Map<number, number[]>([[from, []]]);
  const queue = [from];
  while (queue.length) {
    const cell = queue.shift()!;
    for (const way of WAYS) {
      const over = step(cell, way);
      const land = step(cell, way, 2);
      if (over === null || land === null || board[over] === -1 || over === from || board[land] !== -1 || seen.has(land)) continue;
      seen.set(land, [...seen.get(cell)!, ...(cell === from ? [] : [cell])]);
      queue.push(land);
    }
  }
  for (const [cell, via] of seen) if (cell !== from && rest(cell) && !(out.has(cell) && !via.length)) out.set(cell, via);
  return out;
}

/** Every move a seat has: each peg that can move, and where to. */
export function chineseCheckersMoves(s: ChineseCheckersState, seat: number): { from: number; to: number[] }[] {
  const board = occupants(s);
  return s.pegs[seat]!.flatMap((from) => {
    const to = [...reach(s, seat, from, board).keys()].sort((a, b) => a - b);
    return to.length ? [{ from, to }] : [];
  });
}

/** How many of a seat's pegs are in the point it is going to, and how far the rest have to go to its tip. */
function standing(s: ChineseCheckersState, seat: number): { home: number; far: number } {
  const goal = goalOf(s, seat);
  let home = 0;
  let far = 0;
  for (const cell of s.pegs[seat]!) {
    if (POINT_OF[cell] === goal) home++;
    else far += starDistance(cell, POINTS[goal]!.tip);
  }
  return { home, far };
}
/** The point across is full, and at least one peg in it is this seat's. */
function isHome(s: ChineseCheckersState, seat: number, board = occupants(s)): boolean {
  const goal = POINTS[goalOf(s, seat)]!.holes;
  return goal.every((cell) => board[cell] !== -1) && goal.some((cell) => board[cell] === seat);
}
/** Best first: most pegs home, then least far to go. */
function ranking(s: ChineseCheckersState): number[] {
  const score = s.pegs.map((_, seat) => standing(s, seat));
  return s.pegs.map((_, seat) => seat).sort((a, b) => score[b]!.home - score[a]!.home || score[a]!.far - score[b]!.far || a - b);
}
function winnersOf(s: ChineseCheckersState): number[] {
  const board = occupants(s);
  const home = s.pegs.flatMap((_, seat) => (isHome(s, seat, board) ? [seat] : []));
  if (home.length) return home;
  const order = ranking(s);
  const best = standing(s, order[0]!);
  return order.filter((seat) => standing(s, seat).home === best.home && standing(s, seat).far === best.far);
}

function apply(state: ChineseCheckersState, seat: number, move: ChineseCheckersMove): ChineseCheckersState {
  if (move?.type !== "move") throw new GameError("That's not a move in Chinese Checkers.");
  if (state.phase !== "playing") throw new GameError("The game is over.");
  if (!Number.isInteger(seat) || seat < 0 || seat >= state.seats) throw new GameError("You're not at this table.");
  if (state.turn !== seat) throw new GameError("It's not your turn.");
  const from = Number(move.from);
  const to = Number(move.to);
  const peg = state.pegs[seat]!.indexOf(from);
  if (!Number.isInteger(from) || peg < 0) throw new GameError("You don't have a peg there.");
  const via = Number.isInteger(to) ? reach(state, seat, from).get(to) : undefined;
  if (!via) throw new GameError("That peg can't get there: move one hole, or jump over a peg into the empty hole beyond.");

  const s = clone(state);
  s.pegs[seat]![peg] = to;
  s.last = { from, to, via };
  s.moves += 1;
  const jumps = starDistance(from, to) > 1 || via.length ? via.length + 1 : 0;
  s.narration = jumps > 1 ? `${who(seat)} jumps ${jumps} times` : jumps ? `${who(seat)} jumps` : `${who(seat)} moves`;
  if (isHome(s, seat)) {
    s.phase = "finished";
    s.ended = "home";
    s.narration += `. ${who(seat)} is home, and wins!`;
    return s;
  }
  if (s.moves >= s.rules.turns * s.seats) {
    s.phase = "finished";
    s.ended = "turns";
    s.narration += `. That's ${s.rules.turns} turns each`;
    return s;
  }
  s.turn = (seat + 1) % s.seats;
  return s;
}

// ---- The computer player ------------------------------------------------------------------------
// It takes the move that gets a peg furthest towards the tip of the point across, with a little
// more for bringing up the pegs at the back (a peg left behind has nobody to jump over), and it
// doesn't take a peg out of the point once it is in.

function worth(s: ChineseCheckersState, seat: number, from: number, to: number): number {
  const goal = goalOf(s, seat);
  const tip = POINTS[goal]!.tip;
  const before = starDistance(from, tip);
  const after = starDistance(to, tip);
  let value = (before - after) * 10 + before * 0.6;
  if (POINT_OF[from] === goal && POINT_OF[to] !== goal) value -= 200;
  if (POINT_OF[to] === goal && POINT_OF[from] !== goal) value += 6;
  // Leaving home matters early: a peg still in its own point is the furthest back there is.
  if (POINT_OF[from] === homeOf(s, seat) && POINT_OF[to] !== homeOf(s, seat)) value += 3;
  return value;
}

/** The move the computer player likes best for a seat; null if it has none. */
export function bestChineseCheckersMove(s: ChineseCheckersState, seat: number, rand: () => number = Math.random): { from: number; to: number } | null {
  let best: { from: number; to: number }[] = [];
  let top = -Infinity;
  for (const { from, to } of chineseCheckersMoves(s, seat)) {
    for (const cell of to) {
      const value = worth(s, seat, from, cell);
      if (value > top + 1e-9) [top, best] = [value, [{ from, to: cell }]];
      else if (value > top - 1e-9) best.push({ from, to: cell });
    }
  }
  return best.length ? pickRandom(best, rand) : null;
}

function bot(s: ChineseCheckersState, seat: number, style: PlayStyle, rand: () => number = Math.random): ChineseCheckersMove | null {
  if (s.phase !== "playing" || s.turn !== seat) return null;
  const moves = chineseCheckersMoves(s, seat);
  if (!moves.length) return null;
  if (careless(style, rand)) {
    const { from, to } = pickRandom(moves, rand);
    return { type: "move", from, to: pickRandom(to, rand) };
  }
  return { type: "move", ...bestChineseCheckersMove(s, seat, rand)! };
}

// ---- What a seat sees ---------------------------------------------------------------------------

const TONES: BoardTone[] = ["red", "blue", "green", "gold", "dark", "light"];
const COLOUR = ["red", "blue", "green", "yellow", "black", "white"];

function overTitle(s: ChineseCheckersState): string {
  const w = winnersOf(s);
  if (s.ended === "home") return `${who(w[0]!)} is home, and wins!`;
  const { home } = standing(s, w[0]!);
  return w.length > 1 ? `${w.map(who).join(" and ")} tie with ${home} home!` : `${who(w[0]!)} wins with ${home} home!`;
}

function view(s: ChineseCheckersState, seat: number): BoardView {
  const over = s.phase === "finished";
  const mine = !over && s.turn === seat;
  const points = pointsFor(s.seats);
  const shade: CellShade[] = IS_HOLE.map((hole) => (hole ? "plain" : "none"));
  const names: string[] = Array<string>(STAR_ROWS * COLS).fill("off the board");
  WIDTHS.forEach((_, row) => rowHoles(row).forEach((cell, i) => (names[cell] = `row ${row + 1}, hole ${i + 1}`)));
  const cells: (BoardPiece | null)[] = Array<BoardPiece | null>(STAR_ROWS * COLS).fill(null);
  s.pegs.forEach((pegs, owner) => pegs.forEach((cell, i) => (cells[cell] = { owner, kind: "peg", glyph: "●", label: `${COLOUR[owner]} peg`, tone: TONES[owner], id: `peg-${owner}-${i}` })));
  // A point is coloured for whoever started in it, as on a board of wood: you are going to the one across.
  const marks: NonNullable<BoardGrid["marks"]> = points.flatMap((point, owner) => POINTS[point]!.holes.map((cell) => ({ cell, mark: "claimed" as const, owner })));
  if (s.last) marks.push({ cell: s.last.from, mark: "from" }, ...s.last.via.map((cell) => ({ cell, mark: "from" as const })), { cell: s.last.to, mark: "last" });
  const turnsLeft = Math.ceil((s.rules.turns * s.seats - s.moves) / s.seats);
  const grid: BoardGrid = {
    id: "board",
    label: "Board",
    rows: STAR_ROWS,
    cols: COLS,
    cells,
    shade,
    names,
    marks,
    // Turned half way round for anyone whose own point is in the top half, so it is nearest them.
    flip: [0, 1, 5].includes(points[seat]!),
    select: mine ? { type: "move", sources: chineseCheckersMoves(s, seat) } : null,
  };
  return {
    game: "chinesecheckers",
    seats: s.seats,
    me: seat,
    teams: false,
    phase: s.phase,
    turn: over ? null : s.turn,
    grids: [grid],
    reserves: [],
    choices: null,
    // What each seat plays with: a table colours its point to match.
    players: s.pegs.map((_, i) => ({ line: `${standing(s, i).home} of 10 home`, piece: { owner: i, kind: "peg", glyph: "●", label: `${COLOUR[i]} peg`, tone: TONES[i] } })),
    info: ["Get all ten pegs into the point across from you", ...(over ? [] : [turnsLeft <= 10 ? `${turnsLeft} turn${turnsLeft === 1 ? "" : "s"} each left` : `${s.rules.turns} turns each`])],
    narration: s.narration ?? (mine ? "You go first: tap a peg, then where it goes" : null),
    scores: s.pegs.map((_, i) => ({ seats: [i], value: standing(s, i).home })),
    result: over ? { key: "final", title: overTitle(s), sides: s.pegs.map((_, i) => [i]), rows: [{ label: "Pegs home", values: s.pegs.map((_, i) => String(standing(s, i).home)), tone: "total" as const }] } : null,
    over: over ? { winners: winnersOf(s), title: overTitle(s) } : null,
  };
}

// ---- The game -----------------------------------------------------------------------------------

function normalize(rules: unknown): ChineseCheckersRules {
  const given = (rules && typeof rules === "object" ? rules : {}) as Partial<ChineseCheckersRules>;
  const base = PRESETS.find((p) => p.id === given.id) ?? classicChineseCheckers;
  const r = { ...base, ...given };
  return { id: String(r.id), name: String(r.name), turns: TURNS.includes(Number(r.turns)) ? Number(r.turns) : 100 };
}

export const chineseCheckers: BoardGame<ChineseCheckersRules, ChineseCheckersState, ChineseCheckersMove> = {
  id: "chinesecheckers",
  name: "Chinese Checkers",
  emoji: "✡️",
  category: "board",
  blurb: "Hop your pegs across the star before anyone else",
  tagline: "Move a peg one hole, or jump over a peg and keep jumping. First to get all ten into the point across the star wins.",
  seats: { min: 2, max: 6, default: 2 },
  teams: false,
  presets: PRESETS,
  fields: [{ key: "turns", label: "Length", hint: "If nobody is home by then, whoever has most pegs home wins.", kind: "choice", options: TURNS.map((n) => [n, `${n} turns each`]) }],
  normalize,
  validate: () => [],
  describe(r) {
    return [
      "Everyone starts with ten pegs filling one point of the star, and is racing to fill the point straight across.",
      "On your turn, move one peg. It can step one hole along a line in any of six directions.",
      "Or it can jump: over one peg next to it (yours or anyone's) into the empty hole straight beyond. From where it lands it can jump again, as often as there is something to jump, changing direction as it likes. Nothing is taken off the board.",
      "A peg can pass through anyone's point on the way, but can only come to rest in the middle, the point it started in or the point it is going to.",
      "You win when the point across from you is full and at least one peg in it is yours.",
      `If nobody is home after ${r.turns} turns each, whoever has most pegs home wins, and then whoever is nearest.`,
    ];
  },
  newGame: newChineseCheckers,
  apply,
  view,
  bot,
  thinkingTime: (s, seat) => thinkFor(chineseCheckersMoves(s, seat).length),
  summary(s) {
    const over = s.phase === "finished";
    return {
      game: "chinesecheckers",
      rules: s.rules.name,
      phase: s.phase,
      over,
      hand: Math.floor(s.moves / s.seats) + (over ? 0 : 1),
      scoreLine: s.pegs.map((_, i) => standing(s, i).home).join(" · "),
      order: over ? [...winnersOf(s), ...ranking(s).filter((seat) => !winnersOf(s).includes(seat))] : null,
      winners: over ? winnersOf(s) : null,
      teams: false,
      seats: s.seats,
    };
  },
};
