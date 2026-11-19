// Snakes & Ladders: a race round a snaking track of 36 squares. Each seat has pieces in a yard
// before square 1; they race to square 36, and the first to get every piece there wins.
//
//   - A turn is a roll of two dice. Each die is spent on a move of one piece, in any order, so a
//     player chooses which piece takes which die. A die that no piece can use is lost.
//   - A piece must land on square 36 by exact count: a move that would pass it is not allowed.
//   - Ladders lift a piece up the track; snakes (when the table plays with them) bring it down.
//     Landing on the foot of a ladder or the head of a snake moves the piece at once.
//   - A piece that lands on another player's piece sends it back to the yard. Pieces of one
//     player can share a square.
//
// The track is a 6 × 6 grid read in a snake: square 1 is bottom left, and each row runs the other
// way from the one below it. Square 36 is top right, at the end of the track.
import type { PlayStyle } from "@journey-to-code/rules";
import { cellAt, type BoardGame, type BoardGrid, type BoardPiece, type BoardView } from "./board.js";
import { careless, clone, GameError, nextRandom, pickRandom, thinkFor, who, type BaseRules } from "./table.js";

export interface SnakesRules extends BaseRules {
  /** Pieces each seat races: one for a quick game, two for the full one. */
  pieces: number;
  /** Snakes bring a piece back down the track. Without them the game has only ladders. */
  snakes: boolean;
  /** Who goes first. */
  first: "random" | "seat1" | "seat2";
}

export const classicSnakes: SnakesRules = { id: "snakes-classic", name: "Classic (two pieces)", pieces: 2, snakes: true, first: "random" };
export const quickSnakes: SnakesRules = { id: "snakes-quick", name: "Quick (one piece)", pieces: 1, snakes: true, first: "random" };
export const gentleSnakes: SnakesRules = { id: "snakes-gentle", name: "Gentle (ladders only)", pieces: 2, snakes: false, first: "random" };
const PRESETS = [classicSnakes, quickSnakes, gentleSnakes];

/** The last square of the track: a piece that lands here is home. */
const HOME = 36;
const SIDE = 6;
/** Where a ladder starts (its foot) and where it ends (its top). */
const LADDERS: Readonly<Record<number, number>> = { 3: 12, 8: 19, 15: 26, 22: 30 };
/** Where a snake starts (its head) and where it ends (its tail). */
const SNAKES: Readonly<Record<number, number>> = { 17: 5, 25: 9, 31: 14, 35: 20 };

export interface SnakesState {
  game: "snakes";
  rules: SnakesRules;
  seats: number;
  rng: number;
  /** Which seat rolls (and then moves) now. */
  turn: number;
  /** "roll" for the seat whose turn it is to throw; "move" while its dice are being spent; "finished" at the end. */
  phase: "roll" | "move" | "finished";
  /** Each seat's pieces: the square each is on, from 0 (the yard) to HOME. */
  pieces: number[][];
  /** This turn's two dice, once thrown. */
  dice: number[];
  /** Which of those dice have been spent. */
  spent: boolean[];
  /** How many times the dice have been thrown, so the table can tumble them once per roll. */
  rolls: number;
  /** Where the last move landed, for the table to mark. */
  last: number | null;
  winner: number | null;
  narration: string | null;
}

export type SnakesMove = { type: "roll" } | { type: "move"; from: number; die: number };

/** The next seat to throw. */
const nextSeat = (s: Pick<SnakesState, "seats">, seat: number) => (seat + 1) % s.seats;

/** The square a piece is on, shown as a cell of the grid. */
const cellOfSquare = (square: number) => {
  const i = square - 1;
  const row = Math.floor(i / SIDE);
  const col = row % 2 === 0 ? i % SIDE : SIDE - 1 - (i % SIDE);
  return cellAt(SIDE, SIDE - 1 - row, col);
};
/** The grid cell of each square 1–36, and the square of each cell. */
const CELL_OF = Array.from({ length: HOME }, (_, i) => cellOfSquare(i + 1));
const SQUARE_OF = new Map(CELL_OF.map((cell, i) => [cell, i + 1]));

function newSnakes(rules: SnakesRules, seats: number, seed: number): SnakesState {
  const s: SnakesState = {
    game: "snakes",
    rules,
    seats,
    rng: seed >>> 0,
    turn: 0,
    phase: "roll",
    pieces: Array.from({ length: seats }, () => Array<number>(rules.pieces).fill(0)),
    dice: [],
    spent: [],
    rolls: 0,
    last: null,
    winner: null,
    narration: null,
  };
  s.turn = rules.first === "seat1" ? 0 : rules.first === "seat2" ? 1 : nextRandom(s)() < 0.5 ? 0 : 1;
  return s;
}

/** Where a piece ends up after landing on `square`: a ladder or snake takes it there. */
const afterLanding = (rules: SnakesRules, square: number): number => {
  if (LADDERS[square] !== undefined) return LADDERS[square];
  if (rules.snakes && SNAKES[square] !== undefined) return SNAKES[square];
  return square;
};

/** Where a piece on `from` ends up if spent on die `value`, or null if the move isn't allowed. */
function landing(rules: SnakesRules, from: number, value: number): number | null {
  if (from === HOME) return null;
  const square = from + value;
  if (square > HOME) return null;
  return afterLanding(rules, square);
}

/** The moves a seat can make now: one per distinct square and die (pieces on one square are interchangeable). */
function movesFor(s: Pick<SnakesState, "rules" | "pieces" | "dice" | "spent" | "phase" | "turn">, seat: number): SnakesMove[] {
  if (s.phase === "roll") return s.turn === seat ? [{ type: "roll" }] : [];
  if (s.phase !== "move" || s.turn !== seat) return [];
  const out: SnakesMove[] = [];
  const seen = new Set<string>();
  s.dice.forEach((value, die) => {
    if (s.spent[die]) return;
    for (const from of new Set(s.pieces[seat]!)) {
      const key = `${from}:${die}`;
      if (seen.has(key) || landing(s.rules, from, value) === null) continue;
      seen.add(key);
      out.push({ type: "move", from, die });
    }
  });
  return out;
}

/** Whether a seat has every piece home. */
const allHome = (s: SnakesState, seat: number) => s.pieces[seat]!.every((p) => p === HOME);

/** Ends the turn: the next seat rolls, and any dice that could not be spent are lost. */
function endTurn(s: SnakesState) {
  s.turn = nextSeat(s, s.turn);
  s.phase = "roll";
  s.dice = [];
  s.spent = [];
}

function apply(state: SnakesState, seat: number, move: SnakesMove): SnakesState {
  if (state.phase === "finished") throw new GameError("This game is over.");
  if (state.turn !== seat) throw new GameError("It's not your turn.");
  if (move?.type === "roll") {
    if (state.phase !== "roll") throw new GameError("You've already thrown the dice.");
    const s = clone(state);
    const next = nextRandom(s);
    s.dice = [Math.floor(next() * 6) + 1, Math.floor(next() * 6) + 1];
    s.spent = [false, false];
    s.rolls += 1;
    s.phase = "move";
    s.last = null;
    s.narration = `${who(seat)} throws ${s.dice[0]} and ${s.dice[1]}`;
    if (movesFor(s, seat).length === 0) {
      s.narration = `${who(seat)} throws ${s.dice[0]} and ${s.dice[1]} and can't move`;
      endTurn(s);
    }
    return s;
  }
  if (move?.type !== "move") throw new GameError("That's not a move in Snakes & Ladders.");
  if (state.phase !== "move") throw new GameError("Throw the dice first.");
  const die = Number(move.die);
  const from = Number(move.from);
  if (!Number.isInteger(die) || die < 0 || die >= state.dice.length || state.spent[die]) throw new GameError("That die is already spent.");
  if (!state.pieces[seat]!.includes(from)) throw new GameError("No piece of yours is there.");
  const to = landing(state.rules, from, state.dice[die]!);
  if (to === null) throw new GameError(from === HOME ? "That piece is already home." : `That piece can't move ${state.dice[die]} without passing square ${HOME}.`);

  const s = clone(state);
  const index = s.pieces[seat]!.indexOf(from);
  s.pieces[seat]![index] = to;
  s.spent[die] = true;
  s.last = to;
  const notes = [`${who(seat)} moves ${state.dice[die]} to square ${to}`];
  if (to !== from + state.dice[die]!) notes.push(to > from + state.dice[die]! ? "up a ladder" : "down a snake");
  // A piece that lands on another player's piece sends it back to the yard.
  if (to !== HOME) {
    for (let other2 = 0; other2 < s.seats; other2++) {
      if (other2 === seat) continue;
      s.pieces[other2] = s.pieces[other2]!.map((p) => {
        if (p !== to) return p;
        notes.push(`and sends ${who(other2)}'s piece back to the yard`);
        return 0;
      });
    }
  }
  s.narration = notes.join(", ");
  if (allHome(s, seat)) {
    s.winner = seat;
    s.phase = "finished";
    s.narration = `${who(seat)} gets every piece home!`;
    return s;
  }
  // Nothing is left to spend, or nothing else can be moved: the turn ends.
  if (s.spent.every(Boolean) || movesFor(s, seat).length === 0) endTurn(s);
  return s;
}

// ---- What a seat sees ---------------------------------------------------------------------------

const TONE = ["red", "blue", "green", "gold"] as const;
const toneOf = (seat: number) => TONE[seat % TONE.length];

/** A piece alone on its square keeps its id, so the table slides it to where it goes; a stack lists an id for each piece in it. */
function pieceOf(seat: number, count: number, ids: string[]): BoardPiece {
  const base = { owner: seat, kind: "piece", glyph: "●", label: `${who(seat)}'s piece`, tone: toneOf(seat) };
  if (count === 1 && ids[0] !== undefined) return { ...base, id: ids[0] };
  return { ...base, count, ids };
}

function view(s: SnakesState, seat: number): BoardView {
  const finished = s.phase === "finished";
  const cells: (BoardPiece | null)[] = Array<BoardPiece | null>(HOME).fill(null);
  // Ladder feet and snake heads are drawn as nobody's piece on their square, so the table shows them.
  for (const [from, to] of Object.entries(LADDERS)) {
    cells[CELL_OF[Number(from) - 1]!] = { owner: null, kind: "ladder", glyph: "▲", label: `Ladder to square ${to}`, tone: "green" };
  }
  if (s.rules.snakes) {
    for (const [from, to] of Object.entries(SNAKES)) {
      cells[CELL_OF[Number(from) - 1]!] = { owner: null, kind: "snake", glyph: "▼", label: `Snake to square ${to}` , tone: "red" };
    }
  }
  // Pieces stack on their square; a square never has pieces of two players, since landing on one sends it home.
  const stacks = new Map<number, { seat: number; ids: string[] }>();
  s.pieces.forEach((list, owner) => {
    list.forEach((square, k) => {
      if (square === 0 || square === HOME) return;
      const stack = stacks.get(square) ?? { seat: owner, ids: [] };
      stack.ids.push(`s${owner}p${k}`);
      stacks.set(square, stack);
    });
  });
  for (const [square, stack] of stacks) cells[CELL_OF[square - 1]!] = pieceOf(stack.seat, stack.ids.length, stack.ids);

  const grid: BoardGrid = {
    id: "board",
    label: "Track",
    rows: SIDE,
    cols: SIDE,
    cells,
    names: Array.from({ length: SIDE * SIDE }, (_, cell) => (SQUARE_OF.has(cell) ? `square ${SQUARE_OF.get(cell)}` : "off the track")),
    marks: s.last !== null && s.last !== HOME ? [{ cell: CELL_OF[s.last - 1]!, mark: "last" }] : [],
  };
  // Pieces in the yard and at home, beside the track.
  const yard = s.pieces.map((list, owner) => {
    const waiting = list.filter((p) => p === 0);
    return { owner, count: waiting.length, home: list.filter((p) => p === HOME).length };
  });

  const legal = movesFor(s, seat);
  const choices = legal.length
    ? {
        prompt: s.phase === "roll" ? "Your turn: throw the dice" : `Spend ${s.dice.map((d, i) => (s.spent[i] ? null : d)).filter((d) => d !== null).join(" and ")}`,
        options: legal.map((move) =>
          move.type === "roll"
            ? { label: "Throw the dice", move, primary: true }
            : {
                label: `${move.from === 0 ? "Bring a piece in" : `Move from square ${move.from}`} by ${s.dice[move.die]}`,
                move,
                hint: `to square ${landing(s.rules, move.from, s.dice[move.die]!)}`,
              },
        ),
        layout: "list" as const,
      }
    : null;

  return {
    game: "snakes",
    seats: s.seats,
    me: seat,
    teams: false,
    phase: s.phase,
    turn: finished ? null : s.turn,
    grids: [grid],
    reserves: yard.flatMap((y) => (y.count ? [{ owner: y.owner, label: "In the yard", pieces: [{ piece: pieceOf(y.owner, y.count, []), count: y.count }] }] : [])),
    dice: s.dice.length
      ? { dice: s.dice.map((value, id) => ({ id, value, used: s.spent[id] ?? false })), roll: s.rolls, sides: 6, tap: null }
      : null,
    choices,
    players: yard.map((y) => ({
      line: `${y.home} of ${s.rules.pieces} home`,
      piece: pieceOf(y.owner, 1, []),
      badge: !finished && s.turn === y.owner ? "Their turn" : undefined,
    })),
    info: [`Get every piece to square ${HOME}`, ...(s.rules.snakes ? ["Ladders go up, snakes go down"] : ["Ladders go up; there are no snakes"])],
    narration: s.narration ?? (s.phase === "roll" && s.turn === seat ? "You go first: throw the dice" : null),
    scores: yard.map((y) => ({ seats: [y.owner], value: y.home })),
    result: null,
    over: finished ? { winners: [s.winner!], title: `${who(s.winner!)} wins!` } : null,
  };
}

// ---- Computer players ---------------------------------------------------------------------------

/** How good a move is for its seat: getting home, then sending a piece back, then the distance gone. */
function valueOf(s: SnakesState, seat: number, move: SnakesMove): number {
  if (move.type === "roll") return 0;
  const to = landing(s.rules, move.from, s.dice[move.die]!)!;
  let value = to - move.from;
  if (to === HOME) value += 100;
  // A ladder's lift is worth more than the squares it covers; a snake's drop costs what it takes back.
  if (LADDERS[move.from + s.dice[move.die]!] !== undefined) value += 4;
  if (s.rules.snakes && SNAKES[move.from + s.dice[move.die]!] !== undefined) value -= 6;
  // Sending a piece back to the yard is worth the square it was on.
  s.pieces.forEach((list, owner) => {
    if (owner !== seat && list.includes(to) && to !== HOME) value += to;
  });
  return value;
}

function bot(s: SnakesState, seat: number, style: PlayStyle, rand: () => number = Math.random): SnakesMove | null {
  if (s.phase === "finished") return null;
  const legal = movesFor(s, seat);
  if (legal.length === 0) return null;
  if (s.phase === "roll") return legal[0]!;
  if (careless(style, rand)) return pickRandom(legal, rand);
  let best = legal[0]!;
  let bestValue = -Infinity;
  for (const move of legal) {
    const value = valueOf(s, seat, move) + rand() * 0.5;
    if (value > bestValue) [best, bestValue] = [move, value];
  }
  return best;
}

// ---- The game -----------------------------------------------------------------------------------

function normalize(rules: unknown): SnakesRules {
  const given = (rules && typeof rules === "object" ? rules : {}) as Partial<SnakesRules>;
  const base = PRESETS.find((p) => p.id === given.id) ?? classicSnakes;
  const r = { ...base, ...given };
  return {
    id: String(r.id),
    name: String(r.name),
    pieces: r.pieces === 1 ? 1 : 2,
    snakes: r.snakes !== false,
    first: r.first === "seat1" || r.first === "seat2" ? r.first : "random",
  };
}

export const snakes: BoardGame<SnakesRules, SnakesState, SnakesMove> = {
  id: "snakes",
  name: "Snakes & Ladders",
  emoji: "🐍",
  category: "board",
  blurb: "Race to the last square, up ladders and down snakes",
  tagline: "Throw two dice and choose which piece takes each one. Ladders take you up; snakes don't.",
  seats: { min: 2, max: 4, default: 2 },
  teams: false,
  presets: PRESETS,
  fields: [
    { key: "pieces", label: "Pieces each", kind: "choice", options: [[1, "One"], [2, "Two"]] },
    { key: "snakes", label: "Snakes", kind: "toggle" },
    { key: "first", label: "Who goes first", kind: "choice", options: [["random", "Luck of the draw"], ["seat1", "The first seat"], ["seat2", "The second seat"]] },
  ],
  normalize,
  validate: () => [],
  describe(r) {
    return [
      `Race your ${r.pieces === 1 ? "piece" : "pieces"} from the yard to square ${HOME}. The first to get every piece there wins.`,
      "Throw two dice each turn. Spend each die on a move of one piece, in any order. A die no piece can use is lost.",
      `A piece must land on square ${HOME} exactly: a move that would pass it isn't allowed.`,
      "A ladder takes a piece up the track. " + (r.snakes ? "A snake takes it back down." : "There are no snakes in this game."),
      "A piece that lands on another player's piece sends it back to the yard.",
      r.first === "random" ? "Who goes first is the luck of the draw." : `The ${r.first === "seat1" ? "first" : "second"} seat goes first.`,
    ];
  },
  newGame: newSnakes,
  apply,
  view,
  bot,
  thinkingTime: (s, seat) => thinkFor(Math.min(movesFor(s, seat).length, 6), 1),
  summary(s) {
    const over = s.phase === "finished";
    return {
      game: "snakes",
      rules: s.rules.name,
      phase: s.phase,
      over,
      hand: 1,
      scoreLine: s.pieces.map((list, i) => `${who(i)} ${list.filter((p) => p === HOME).length}/${s.rules.pieces}`).join(" · "),
      order: over ? [s.winner!, ...s.pieces.map((_, i) => i).filter((i) => i !== s.winner)] : null,
      winners: over ? [s.winner!] : null,
      teams: false,
      seats: s.seats,
    };
  },
};
