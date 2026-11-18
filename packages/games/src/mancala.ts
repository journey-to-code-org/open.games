// Mancala, the game most tables call by that name: Kalah. Two rows of six pits with a few seeds in
// each, and a store at each player's right hand. On your turn you pick up every seed in one of your
// pits and sow them one at a time round the board, anticlockwise: along your row, into your store,
// on along the other row, and round again, always missing out the other player's store.
//
//   - If your last seed lands in your store, you go again.
//   - If it lands in an empty pit of your own and the pit across from it has seeds in, you capture
//     those and your own last seed, into your store.
//
// When either player's row is empty the game is over: the other player takes what is left in their
// own row. Most seeds in the store wins.
//
// The board is a grid of two rows of six: a pit is a cell, and the seeds in it are one piece with a
// `count`. The stores are each player's reserve. The second player's board is drawn turned round,
// so everyone's own row is nearest them and their store at their right.
import type { PlayStyle } from "@journey-to-code/rules";
import { settleMatch, withOffers } from "./offers.js";
import type { BoardGame, BoardGrid, BoardPiece, BoardView } from "./board.js";
import { careless, clone, GameError, markReady, nextHandChoices, nextRandom, pickRandom, thinkFor, who, type BaseRules } from "./table.js";

export interface MancalaRules extends BaseRules {
  /** Seeds in each pit at the start. */
  seeds: number;
  /** A last seed in your own empty pit takes what is across from it. */
  captures: boolean;
  /** Who goes first in the first game. */
  first: "random" | "seat1" | "seat2";
  /** Games in a match: most wins takes it. */
  games: number;
}

export const classicMancala: MancalaRules = { id: "mancala-classic", name: "Classic (four seeds)", seeds: 4, captures: true, first: "random", games: 1 };
export const threeMancala: MancalaRules = { id: "mancala-three", name: "Three seeds", seeds: 3, captures: true, first: "random", games: 1 };
export const sixMancala: MancalaRules = { id: "mancala-six", name: "Six seeds", seeds: 6, captures: true, first: "random", games: 1 };
export const gentleMancala: MancalaRules = { id: "mancala-gentle", name: "No captures", seeds: 4, captures: false, first: "random", games: 1 };
const PRESETS = [classicMancala, threeMancala, sixMancala, gentleMancala];
const SEEDS = [3, 4, 5, 6];

/** Pits a side. */
export const MANCALA_PITS = 6;
const PITS = MANCALA_PITS;

export interface MancalaState {
  game: "mancala";
  rules: MancalaRules;
  seats: number;
  rng: number;
  /** Which game of the match, from 1. */
  round: number;
  /** Who goes first in this game. */
  first: number;
  /** Seeds in each pit: `pits[seat][0]` is that seat's pit farthest from its store, `[5]` the one beside it. */
  pits: number[][];
  /** Seeds in each seat's store. */
  stores: number[];
  turn: number;
  /** The last sowing: whose, from which pit, where the last seed fell, and what it took. */
  last: { seat: number; pit: number; end: { seat: number; pit: number } | "store"; took: number } | null;
  /** Who won the game just played; null for a draw (or while playing). */
  roundWinner: number | null;
  wins: number[];
  draws: number;
  phase: "playing" | "scored" | "finished";
  ready: boolean[];
  narration: string | null;
}

export type MancalaMove = { type: "sow"; cell: number } | { type: "next" };

const other = (seat: number) => 1 - seat;

/**
 * Where a pit is on the board, as a cell of the grid: the first seat's row is the bottom one, left
 * to right, and the second seat's is the top one, right to left, so sowing runs anticlockwise.
 */
export const mancalaCell = (seat: number, pit: number): number => (seat === 0 ? PITS + pit : PITS - 1 - pit);
/** The pit a cell of the grid is: whose, and which. */
const pitAt = (cell: number): { seat: number; pit: number } => (cell >= PITS ? { seat: 0, pit: cell - PITS } : { seat: 1, pit: PITS - 1 - cell });

function startRound(s: MancalaState) {
  s.pits = [0, 1].map(() => Array<number>(PITS).fill(s.rules.seeds));
  s.stores = [0, 0];
  s.turn = s.first;
  s.last = null;
  s.roundWinner = null;
  s.phase = "playing";
  s.ready = Array<boolean>(s.seats).fill(false);
  s.narration = null;
}

export function newMancala(rules: MancalaRules, seats: number, seed: number): MancalaState {
  const s = { game: "mancala", rules, seats: 2, rng: seed >>> 0, round: 1, wins: [0, 0], draws: 0 } as MancalaState;
  s.first = rules.first === "seat1" ? 0 : rules.first === "seat2" ? 1 : nextRandom(s)() < 0.5 ? 0 : 1;
  startRound(s);
  return s;
}

// ---- Sowing -------------------------------------------------------------------------------------
// The rules and the computer player both sow on a flat board of fourteen numbers: the mover's six
// pits (0 to 5), the mover's store (6), the other side's six pits (7 to 12) and their store (13),
// in the order seeds travel.

type Flat = number[];
const flatOf = (s: Pick<MancalaState, "pits" | "stores">, seat: number): Flat => [...s.pits[seat]!, s.stores[seat]!, ...s.pits[other(seat)]!, s.stores[other(seat)]!];

/**
 * Sow the mover's pit on a flat board, changing it. Says where the last seed fell (an index of the
 * flat board), how many seeds a capture took (the last seed included), and whether the mover goes again.
 */
function sow(b: Flat, pit: number, captures: boolean): { end: number; took: number; again: boolean } {
  let seeds = b[pit]!;
  b[pit] = 0;
  let at = pit;
  while (seeds > 0) {
    at = (at + 1) % 14;
    // The other player's store is passed over.
    if (at === 13) continue;
    b[at]! += 1;
    seeds -= 1;
  }
  let took = 0;
  const across = 12 - at;
  if (captures && at < PITS && b[at] === 1 && b[across]! > 0) {
    took = b[across]! + 1;
    b[6]! += took;
    b[at] = 0;
    b[across] = 0;
  }
  return { end: at, took, again: at === 6 };
}

/** A row is empty: what is left on the other row goes to its owner's store. True if the game ended so. */
function sweep(b: Flat): boolean {
  const mine = b.slice(0, PITS).reduce((a, n) => a + n, 0);
  const theirs = b.slice(7, 13).reduce((a, n) => a + n, 0);
  if (mine && theirs) return false;
  b[6]! += mine;
  b[13]! += theirs;
  for (let i = 0; i < PITS; i++) b[i] = b[7 + i] = 0;
  return true;
}

/** The pits a seat could sow: the ones with seeds in. */
export const mancalaMoves = (s: Pick<MancalaState, "pits">, seat: number): number[] => s.pits[seat]!.flatMap((n, pit) => (n > 0 ? [pit] : []));

// ---- Moves --------------------------------------------------------------------------------------

/** How a match stands once this game is in: finished when the games run out or one side can't be caught. */
function matchOver(s: MancalaState): boolean {
  const left = s.rules.games - s.round;
  return left <= 0 || Math.abs(s.wins[0]! - s.wins[1]!) > left;
}

function apply(state: MancalaState, seat: number, move: MancalaMove): MancalaState {
  if (move?.type === "next") {
    if (state.phase !== "scored") throw new GameError("There's a game going on.");
    const s = clone(state);
    if (markReady(s.ready, seat)) {
      // Take turns going first.
      s.round += 1;
      s.first = other(s.first);
      startRound(s);
    }
    return s;
  }
  if (move?.type !== "sow") throw new GameError("That's not a move in Mancala.");
  if (state.phase !== "playing") throw new GameError("This game is over.");
  if (state.turn !== seat) throw new GameError("It's not your turn.");
  const cell = Number(move.cell);
  if (!Number.isInteger(cell) || cell < 0 || cell >= PITS * 2) throw new GameError("That's not a pit on the board.");
  const at = pitAt(cell);
  if (at.seat !== seat) throw new GameError("That pit is on the other side: sow from your own row.");
  if (!state.pits[seat]![at.pit]) throw new GameError("That pit is empty.");

  const s = clone(state);
  const b = flatOf(s, seat);
  const sown = b[at.pit]!;
  const { end, took, again } = sow(b, at.pit, s.rules.captures);
  const done = sweep(b);
  s.pits[seat] = b.slice(0, PITS);
  s.stores[seat] = b[6]!;
  s.pits[other(seat)] = b.slice(7, 13);
  s.stores[other(seat)] = b[13]!;
  s.last = { seat, pit: at.pit, end: end === 6 ? "store" : end < PITS ? { seat, pit: end } : { seat: other(seat), pit: end - 7 }, took };
  // (The table turns "{0} sows" into "You sow" for the player it names; one verb each keeps that right.)
  let line = `${who(seat)} sows ${sown} from pit ${at.pit + 1}`;
  if (took) line += ` and captures ${took}`;
  else if (again) line += " and ends in the store";

  if (!done) {
    if (again) line += `. ${who(seat)} goes again`;
    else s.turn = other(seat);
    s.narration = line;
    return s;
  }
  const [a, c] = s.stores as [number, number];
  const many = s.rules.games > 1;
  if (a === c) {
    s.draws += 1;
    s.narration = `${line}. A row is empty. ${many ? `Game ${s.round} is a draw` : "It's a draw"}, ${a} all`;
  } else {
    const winner = a > c ? 0 : 1;
    s.wins[winner]! += 1;
    s.roundWinner = winner;
    s.narration = `${line}. A row is empty. ${who(winner)} wins${many ? ` game ${s.round}` : ""} ${Math.max(a, c)} to ${Math.min(a, c)}`;
  }
  s.phase = matchOver(s) ? "finished" : "scored";
  return s;
}

/** Best first. A drawn match lists the player who went second in the last game first, as Reversi does. */
function order(s: MancalaState): number[] {
  const [a, b] = s.wins as [number, number];
  if (a !== b) return a > b ? [0, 1] : [1, 0];
  return [other(s.first), s.first];
}
const winners = (s: MancalaState) => (s.wins[0] === s.wins[1] ? [0, 1] : [s.wins[0]! > s.wins[1]! ? 0 : 1]);

// ---- The computer player ------------------------------------------------------------------------
// It looks ahead: every pit it could sow, every answer, and so on some moves deep, skipping lines
// that can't change its mind (alpha-beta). A turn that ends in the store carries straight on, so an
// extra turn costs no depth. Where the looking stops, a position is worth the difference between
// the stores, with a little for seeds still on its own side. A careless player sows any pit.

interface Search {
  captures: boolean;
  nodes: number;
  limit: number;
  stopped: boolean;
}

/** The value of a flat board for the player to move, looking `depth` turns ahead. */
function search(x: Search, b: Flat, depth: number, alpha: number, beta: number): number {
  if (++x.nodes > x.limit) {
    x.stopped = true;
    return 0;
  }
  if (depth <= 0) return (b[6]! - b[13]!) * 4 + b.slice(0, PITS).reduce((a, n) => a + n, 0) - b.slice(7, 13).reduce((a, n) => a + n, 0);
  let best = -Infinity;
  // Pits nearest the store first: they are the ones that end in it, and good moves found early save work.
  for (let pit = PITS - 1; pit >= 0; pit--) {
    if (!b[pit]) continue;
    const next = [...b];
    const { again } = sow(next, pit, x.captures);
    let value: number;
    if (sweep(next)) value = (next[6]! - next[13]!) * 100;
    else if (again) value = search(x, next, depth, alpha, beta);
    else value = -search(x, [...next.slice(7), ...next.slice(0, 7)], depth - 1, -beta, -alpha);
    if (x.stopped) return 0;
    if (value > best) best = value;
    if (best > alpha) alpha = best;
    if (alpha >= beta) break;
  }
  return best;
}

/** How far ahead a computer player looks, by how sharp it is. */
const depthFor = (skill: number) => (skill >= 0.85 ? 9 : skill >= 0.5 ? 5 : 2);
/** The most positions one move may look at: a few milliseconds' worth. */
const WORK = 60_000;

/** The pit the search likes best for `seat`. It looks one turn further each time round, so if the work runs out the last finished look stands. */
export function bestMancalaMove(s: Pick<MancalaState, "pits" | "stores" | "rules">, seat: number, depth: number, rand: () => number = Math.random): number | null {
  const moves = mancalaMoves(s, seat);
  if (moves.length <= 1) return moves[0] ?? null;
  const flat = flatOf(s, seat);
  const x: Search = { captures: s.rules.captures, nodes: 0, limit: WORK, stopped: false };
  let best = pickRandom(moves, rand);
  for (let d = 1; d <= depth; d++) {
    let top = -Infinity;
    let found: number[] = [];
    for (const pit of moves) {
      const next = [...flat];
      const { again } = sow(next, pit, x.captures);
      const value = sweep(next) ? (next[6]! - next[13]!) * 100 : again ? search(x, next, d, -Infinity, Infinity) : -search(x, [...next.slice(7), ...next.slice(0, 7)], d - 1, -Infinity, Infinity);
      if (x.stopped) return best;
      if (value > top) [top, found] = [value, [pit]];
      else if (value === top) found.push(pit);
    }
    // Pits that come out the same are chosen between by chance, so it doesn't always play the same game.
    best = pickRandom(found, rand);
  }
  return best;
}

function bot(s: MancalaState, seat: number, style: PlayStyle, rand: () => number = Math.random): MancalaMove | null {
  if (s.phase === "scored") return s.ready[seat] ? null : { type: "next" };
  if (s.phase !== "playing" || s.turn !== seat) return null;
  const pit = careless(style, rand) ? pickRandom(mancalaMoves(s, seat), rand) : bestMancalaMove(s, seat, depthFor(style.skill ?? 1), rand)!;
  return { type: "sow", cell: mancalaCell(seat, pit) };
}

// ---- What a seat sees ---------------------------------------------------------------------------

const TONES = ["gold", "blue"] as const;
const seedsOf = (seat: number, count: number): BoardPiece => ({ owner: null, kind: "seeds", glyph: String(count), label: `${count} seed${count === 1 ? "" : "s"}`, tone: TONES[seat], count });
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

function view(s: MancalaState, seat: number): BoardView {
  const over = s.phase === "finished";
  const mine = s.phase === "playing" && s.turn === seat;
  const many = s.rules.games > 1;
  const w = over ? winners(s) : [];
  const cells: (BoardPiece | null)[] = Array<BoardPiece | null>(PITS * 2).fill(null);
  const names: string[] = Array<string>(PITS * 2).fill("");
  for (const side of [0, 1]) {
    for (let pit = 0; pit < PITS; pit++) {
      const cell = mancalaCell(side, pit);
      const count = s.pits[side]![pit]!;
      cells[cell] = count ? seedsOf(side, count) : null;
      names[cell] = `${side === seat ? "your" : "their"} pit ${pit + 1}`;
    }
  }
  const marks: NonNullable<BoardGrid["marks"]> = [];
  if (s.last) {
    marks.push({ cell: mancalaCell(s.last.seat, s.last.pit), mark: "from" });
    if (s.last.end !== "store") marks.push({ cell: mancalaCell(s.last.end.seat, s.last.end.pit), mark: "last" });
    // What a capture emptied: the pit across from where the last seed fell.
    if (s.last.took && s.last.end !== "store") marks.push({ cell: mancalaCell(other(s.last.end.seat), PITS - 1 - s.last.end.pit), mark: "threat" });
  }
  const grid: BoardGrid = {
    id: "board",
    label: "Board",
    rows: 2,
    cols: PITS,
    cells,
    names,
    marks,
    // Everyone's own row is nearest them, their store at their right hand.
    flip: seat === 1,
    tap: mine ? { type: "sow", cells: mancalaMoves(s, seat).map((pit) => mancalaCell(seat, pit)) } : null,
  };
  const [a, b] = s.stores as [number, number];
  const scoreTitle = s.roundWinner === null ? `Game ${s.round} is a draw` : `${who(s.roundWinner)} wins game ${s.round}`;
  const title = () => {
    // (A game that was agreed drawn or resigned didn't end on the count, so the count isn't quoted.)
    if (w.length > 1) return many || a !== b ? "It's a draw!" : `It's a draw: ${a} all!`;
    const tally = many ? s.wins : s.stores;
    if (tally[w[0]!]! <= tally[other(w[0]!)]!) return `${who(w[0]!)} wins!`;
    return `${who(w[0]!)} wins ${tally[w[0]!]} to ${tally[other(w[0]!)]}!`;
  };
  return {
    game: "mancala",
    seats: s.seats,
    me: seat,
    teams: false,
    phase: s.phase,
    turn: s.phase === "playing" ? s.turn : null,
    grids: [grid],
    // The stores: what each player has won so far.
    reserves: s.stores.map((count, owner) => ({ owner, label: "Store", pieces: [{ piece: { owner, kind: "seed", glyph: "●", label: "seed", tone: TONES[owner] }, count }] })),
    choices: s.phase === "scored" ? nextHandChoices(s.ready, seat, false, "Next game") : null,
    players: s.stores.map((count, i) => ({
      line: `${plural(count, "seed")} in store${many ? ` · ${plural(s.wins[i]!, "win")}` : ""}`,
      badge: s.phase !== "playing" ? undefined : s.last === null && i === s.first ? "Goes first" : s.last?.end === "store" && s.last.seat === i && s.turn === i ? "Goes again" : undefined,
    })),
    info: ["Most seeds in your store wins", ...(many ? [`Game ${s.round} of ${s.rules.games}`] : []), ...(s.rules.captures ? [] : ["No captures"])],
    narration: s.narration ?? (mine ? "You go first: tap one of your pits to sow it" : null),
    // One game is scored in seeds; a match in games won, with the seeds under each name.
    scores: (many ? s.wins : s.stores).map((value, i) => ({ seats: [i], value })),
    result:
      many && s.phase !== "playing"
        ? {
            key: `game-${s.round}`,
            title: scoreTitle,
            sides: [[0], [1]],
            rows: [{ label: "Seeds", values: s.stores.map(String), tone: "score" }, { label: "Wins", values: s.wins.map(String), tone: "total" }, ...(s.draws ? [{ label: "Draws", values: [String(s.draws), String(s.draws)] }] : [])],
          }
        : null,
    over: over ? { winners: w, title: title() } : null,
  };
}

// ---- The game -----------------------------------------------------------------------------------

function normalize(rules: unknown): MancalaRules {
  const given = (rules && typeof rules === "object" ? rules : {}) as Partial<MancalaRules>;
  const base = PRESETS.find((p) => p.id === given.id) ?? classicMancala;
  const r = { ...base, ...given };
  return {
    id: String(r.id),
    name: String(r.name),
    seeds: SEEDS.includes(Number(r.seeds)) ? Number(r.seeds) : 4,
    captures: r.captures !== false,
    first: r.first === "seat1" || r.first === "seat2" ? r.first : "random",
    games: [1, 3, 5, 7].includes(Number(r.games)) ? Number(r.games) : 1,
  };
}

const rules: BoardGame<MancalaRules, MancalaState, MancalaMove> = {
  id: "mancala",
  name: "Mancala",
  emoji: "🫘",
  category: "board",
  blurb: "Sow your seeds round the board and fill your store",
  tagline: "Pick up a pit of seeds and sow them round the board, one a pit. End in your store to go again; end in your own empty pit to capture. Most seeds wins.",
  seats: { min: 2, max: 2, default: 2 },
  teams: false,
  presets: PRESETS,
  fields: [
    { key: "seeds", label: "Seeds in each pit", kind: "choice", options: SEEDS.map((n) => [n, String(n)]) },
    { key: "captures", label: "Captures", hint: "A last seed in your own empty pit takes the seeds across from it, and itself, into your store.", kind: "toggle" },
    { key: "first", label: "Who goes first", kind: "choice", options: [["random", "Luck of the draw"], ["seat1", "The first seat"], ["seat2", "The second seat"]] },
    { key: "games", label: "Games in a match", kind: "choice", options: [[1, "Just one"], [3, "Three"], [5, "Five"], [7, "Seven"]] },
  ],
  normalize,
  validate: () => [],
  describe(r) {
    return [
      `Each player has a row of six pits with ${r.seeds} seeds in each, and a store at the right-hand end of their row.`,
      "On your turn, pick up all the seeds in one of your pits and sow them one at a time, a pit each, to the right along your row, into your store, and on round the other row. The other player's store is passed over.",
      "If your last seed lands in your store, you go again.",
      ...(r.captures ? ["If your last seed lands in an empty pit on your own side, and the pit across from it has seeds in, you capture those seeds and your last one: they all go in your store."] : ["There are no captures at this table."]),
      "When one row is empty the game is over, and whatever is left in the other row goes to that row's owner. Most seeds in the store wins.",
      ...(r.games > 1 ? [`A match is ${r.games} games; most wins takes it. Players take turns going first.`] : []),
    ];
  },
  newGame: newMancala,
  apply,
  view,
  bot,
  // A search: off the table's main thread (see TableGame.heavy).
  heavy: (s, seat) => s.phase === "playing" && s.turn === seat,
  thinkingTime: (s) => thinkFor(s.phase === "playing" ? mancalaMoves(s, s.turn).length : 0, s.last === null ? 0.7 : 1),
  summary(s) {
    const over = s.phase === "finished";
    return {
      game: "mancala",
      rules: s.rules.name,
      phase: s.phase,
      over,
      hand: s.round,
      // One game is told in seeds, a match in games won.
      scoreLine: s.rules.games > 1 ? `${s.wins[0]} to ${s.wins[1]}${s.draws ? ` · ${s.draws} drawn` : ""}` : `${s.stores[0]} to ${s.stores[1]}`,
      order: over ? order(s) : null,
      winners: over ? winners(s) : null,
      teams: false,
      seats: s.seats,
    };
  },
};

/** Mancala, with resigning, draw offers and taking a move back (see offers.ts). */
export const mancala = withOffers<MancalaRules, MancalaState, MancalaMove>(rules, {
  takeBack: true,
  settle: settleMatch,
  // Seeds in the store: the only thing that counts at the end.
  standing: (s, seat) => s.stores[seat]! - s.stores[other(seat)]!,
});
