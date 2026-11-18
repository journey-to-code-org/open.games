// Ludo: a race round a cross-shaped board. Everyone has four tokens in a yard in their corner. Roll
// a six to bring one out onto your start square, then move it the roll of the die clockwise round
// the track, up your own home column and into the middle. Land on another player's token and it
// goes back to their yard. First to get every token home wins.
//
//   - A six gives another roll, but a third six in a row ends the turn.
//   - A token needs the exact roll to reach home.
//   - Nobody can be captured on their own start square or (if the table plays them) on a star,
//     so a token can't land on one of those while someone else is standing there.
//
// The board is a 15 × 15 grid with the cells that aren't part of the cross shaded "none". A token
// is a piece; two of your own on one square are one piece with a `count`. Squares that belong to a
// player (their yard, start square and home column) are marked "claimed" for them; a yard is
// shaded "dark" with a "light" place for each token, and the stars are shaded "spot". The die is the board kit's `dice`, thrown from the game's seeded random source.
import type { PlayStyle } from "@journey-to-code/rules";
import type { BoardGame, BoardGrid, BoardPiece, BoardTone, BoardView, CellShade } from "./board.js";
import { careless, clone, GameError, nextRandom, pickRandom, rankSeats, who, type BaseRules } from "./table.js";

export interface LudoRules extends BaseRules {
  /** Tokens each: four, or two for a quick game. */
  tokens: number;
  /** What brings a token out of the yard: a six, or a six or a one. */
  enter: "six" | "sixone";
  /** The four star squares are safe: nobody on one can be captured. */
  safe: boolean;
}

export const classicLudo: LudoRules = { id: "ludo-classic", name: "Classic", tokens: 4, enter: "six", safe: true };
export const quickLudo: LudoRules = { id: "ludo-quick", name: "Quick (two tokens)", tokens: 2, enter: "sixone", safe: true };
export const easyLudo: LudoRules = { id: "ludo-easy", name: "Easy start (a six or a one)", tokens: 4, enter: "sixone", safe: true };
export const openLudo: LudoRules = { id: "ludo-open", name: "No safe squares", tokens: 4, enter: "six", safe: false };
const PRESETS = [classicLudo, quickLudo, easyLudo, openLudo];

// ---- The board ----------------------------------------------------------------------------------

export const LUDO_SIDE = 15;
const SIDE = LUDO_SIDE;
const at = (row: number, col: number) => row * SIDE + col;
/** A run of cells from one to another in a straight line, both ends included. */
function run(r0: number, c0: number, r1: number, c1: number): number[] {
  const out: number[] = [];
  const steps = Math.max(Math.abs(r1 - r0), Math.abs(c1 - c0));
  for (let i = 0; i <= steps; i++) out.push(at(r0 + Math.sign(r1 - r0) * i, c0 + Math.sign(c1 - c0) * i));
  return out;
}
/** The 52 squares of the track, clockwise, from the first corner's start square. */
const LOOP: readonly number[] = [
  ...run(6, 1, 6, 5), ...run(5, 6, 0, 6), at(0, 7), at(0, 8), ...run(1, 8, 5, 8), ...run(6, 9, 6, 14), at(7, 14), at(8, 14),
  ...run(8, 13, 8, 9), ...run(9, 8, 14, 8), at(14, 7), at(14, 6), ...run(13, 6, 9, 6), ...run(8, 5, 8, 0), at(7, 0), at(6, 0),
];
/** For each corner (top left, top right, bottom right, bottom left): where on the track its tokens start. */
const START = [0, 13, 26, 39];
/** The five squares of each corner's home column, from the track inwards, and then home itself. */
const HOME_RUN: readonly (readonly number[])[] = [run(7, 1, 7, 6), run(1, 7, 6, 7), run(7, 13, 7, 8), run(13, 7, 8, 7)];
/** Where each corner's tokens wait in the yard. */
const YARD: readonly (readonly number[])[] = [
  [at(2, 2), at(2, 3), at(3, 2), at(3, 3)],
  [at(2, 11), at(2, 12), at(3, 11), at(3, 12)],
  [at(11, 11), at(11, 12), at(12, 11), at(12, 12)],
  [at(11, 2), at(11, 3), at(12, 2), at(12, 3)],
];
/** The whole of each corner's yard: six squares by six. */
const YARD_AREA: readonly (readonly number[])[] = [[0, 0], [0, 9], [9, 9], [9, 0]].map(([r, c]) => Array.from({ length: 36 }, (_, i) => at(r! + Math.floor(i / 6), c! + (i % 6))));
/** The star squares, as places on the track: eight on from each start. */
const STARS = new Set(START.map((s) => (s + 8) % LOOP.length));

/** How far a token has to go: out of the yard is 0, the last track square 50, the home column 51 to 55, home 56. */
export const LUDO_HOME = 56;
const HOME = LUDO_HOME;
const LAST_TRACK = 50;
/** Which corners are played: two players sit opposite each other. */
const cornersFor = (seats: number) => (seats === 2 ? [0, 2] : [0, 1, 2, 3].slice(0, seats));
/** Where on the track (0 to 51) a seat's token is after `steps`, or null if it is in the yard, the home column or home. */
const trackOf = (corner: number, steps: number) => (steps >= 0 && steps <= LAST_TRACK ? (START[corner]! + steps) % LOOP.length : null);
/** The cell a token is drawn on. `slot` is which of the yard's places a token still in the yard has. */
function cellOf(corner: number, steps: number, slot: number): number {
  if (steps < 0) return YARD[corner]![slot]!;
  if (steps <= LAST_TRACK) return LOOP[trackOf(corner, steps)!]!;
  return HOME_RUN[corner]![steps - LAST_TRACK - 1]!;
}

// ---- The state ----------------------------------------------------------------------------------

export interface LudoState {
  game: "ludo";
  rules: LudoRules;
  seats: number;
  rng: number;
  turn: number;
  /** What the die shows (0 before the first roll of the game). */
  die: number;
  /** The die has been rolled and a token is to be moved. */
  rolled: boolean;
  /** Sixes rolled in a row this turn. */
  sixes: number;
  /** Every throw since the game began: what the table watches to know the die was thrown. */
  throws: number;
  /** How far each of each seat's tokens has gone: -1 in the yard, 0 to 55 on the way, 56 home. */
  tokens: number[][];
  /** The last move: the cells it went from and to, for the table to mark. */
  last: { from: number; to: number } | null;
  phase: "playing" | "finished";
  narration: string | null;
}

export type LudoMove = { type: "roll" } | { type: "move"; cell: number };

export function newLudo(rules: LudoRules, seats: number, seed: number): LudoState {
  const s = { game: "ludo", rules, seats, rng: seed >>> 0, die: 0, rolled: false, sixes: 0, throws: 0, last: null, phase: "playing", narration: null } as unknown as LudoState;
  s.turn = Math.floor(nextRandom(s)() * seats);
  s.tokens = Array.from({ length: seats }, () => Array<number>(rules.tokens).fill(-1));
  return s;
}

const cornerOf = (s: Pick<LudoState, "seats">, seat: number) => cornersFor(s.seats)[seat]!;
/** Who (other than `seat`) has a token on a square of the track, and whether it can be captured there. */
function standing(s: LudoState, seat: number, track: number): { seat: number; safe: boolean } | null {
  for (let other = 0; other < s.seats; other++) {
    if (other === seat) continue;
    const corner = cornerOf(s, other);
    if (s.tokens[other]!.some((steps) => trackOf(corner, steps) === track)) return { seat: other, safe: track === START[corner] || (s.rules.safe && STARS.has(track)) };
  }
  return null;
}
const enters = (rules: LudoRules, die: number) => die === 6 || (rules.enter === "sixone" && die === 1);

/** Where a token would get to with this roll, or null if it can't move: it needs a six to come out, the exact roll to get home, and can't land where someone is safe. */
function destination(s: LudoState, seat: number, token: number, die: number): number | null {
  const steps = s.tokens[seat]![token]!;
  if (steps === HOME) return null;
  const to = steps < 0 ? (enters(s.rules, die) ? 0 : null) : steps + die;
  if (to === null || to > HOME) return null;
  const track = trackOf(cornerOf(s, seat), to);
  // Coming out onto your own start square takes whoever is there; nowhere else can a safe token be landed on.
  if (track !== null && to > 0 && standing(s, seat, track)?.safe) return null;
  return to;
}
/** The tokens a seat could move with the roll that is showing, as indexes; ones that would do the same thing are all there. */
export const ludoMoves = (s: LudoState, seat: number): number[] => (s.rolled && s.turn === seat ? s.tokens[seat]!.flatMap((_, token) => (destination(s, seat, token, s.die) !== null ? [token] : [])) : []);

// ---- Moves --------------------------------------------------------------------------------------

function pass(s: LudoState) {
  s.rolled = false;
  s.sixes = 0;
  s.turn = (s.turn + 1) % s.seats;
}

function apply(state: LudoState, seat: number, move: LudoMove): LudoState {
  if (move?.type !== "roll" && move?.type !== "move") throw new GameError("That's not a move in Ludo.");
  if (state.phase !== "playing") throw new GameError("The game is over.");
  if (!Number.isInteger(seat) || seat < 0 || seat >= state.seats) throw new GameError("You're not at this table.");
  if (state.turn !== seat) throw new GameError("It's not your turn.");
  const corner = cornerOf(state, seat);

  if (move.type === "roll") {
    if (state.rolled) throw new GameError(`Move a token ${state.die} first.`);
    const s = clone(state);
    s.die = 1 + Math.floor(nextRandom(s)() * 6);
    s.throws += 1;
    s.last = null;
    s.sixes = s.die === 6 ? s.sixes + 1 : 0;
    if (s.sixes === 3) {
      s.narration = `${who(seat)} rolls a third six in a row, and the turn passes`;
      pass(s);
      return s;
    }
    s.rolled = true;
    if (ludoMoves(s, seat).length) {
      s.narration = `${who(seat)} rolls a ${s.die}`;
      return s;
    }
    // Nothing can move. A six still earns its second roll.
    s.rolled = false;
    if (s.die === 6) s.narration = `${who(seat)} rolls a 6 with nothing to move, and rolls again`;
    else {
      s.narration = `${who(seat)} rolls a ${s.die} and can't move`;
      pass(s);
    }
    return s;
  }

  if (!state.rolled) throw new GameError("Roll the die first.");
  const cell = Number(move.cell);
  if (!Number.isInteger(cell) || cell < 0 || cell >= SIDE * SIDE) throw new GameError("That's not a square on the board.");
  const mine = state.tokens[seat]!.flatMap((steps, token) => (cellOf(corner, steps, token) === cell && steps !== HOME ? [token] : []));
  if (!mine.length) throw new GameError("You don't have a token there.");
  const token = mine.find((t) => destination(state, seat, t, state.die) !== null);
  if (token === undefined) throw new GameError(state.tokens[seat]![mine[0]!]! < 0 ? "A token needs a six to come out." : `That token can't move ${state.die}.`);

  const s = clone(state);
  const from = s.tokens[seat]![token]!;
  const to = destination(s, seat, token, s.die)!;
  s.tokens[seat]![token] = to;
  s.last = { from: cellOf(corner, from, token), to: cellOf(corner, to, token) };
  let line = from < 0 ? `${who(seat)} brings a token out` : to === HOME ? `${who(seat)} gets a token home` : `${who(seat)} moves ${s.die}`;
  const track = trackOf(corner, to);
  const hit = track === null ? null : standing(s, seat, track);
  if (hit) {
    // Everything of theirs on the square goes back to the yard.
    const theirs = cornerOf(s, hit.seat);
    let sent = 0;
    s.tokens[hit.seat] = s.tokens[hit.seat]!.map((steps) => (trackOf(theirs, steps) === track ? (sent++, -1) : steps));
    line += ` and sends ${who(hit.seat)}'s ${sent > 1 ? `${sent} tokens` : "token"} back to the yard`;
  }
  if (s.tokens[seat]!.every((steps) => steps === HOME)) {
    s.phase = "finished";
    s.rolled = false;
    s.narration = `${line}. ${who(seat)} wins!`;
    return s;
  }
  if (s.die === 6) {
    s.rolled = false;
    s.narration = `${line}, and rolls again`;
  } else {
    s.narration = line;
    pass(s);
  }
  return s;
}

/** How far a seat has got in all: what places the players who didn't win. */
const progress = (s: LudoState, seat: number) => s.tokens[seat]!.reduce((n, steps) => n + steps + 1, 0);
const winnersOf = (s: LudoState) => s.tokens.flatMap((tokens, seat) => (tokens.every((steps) => steps === HOME) ? [seat] : []));

// ---- The computer player ------------------------------------------------------------------------
// It weighs each token it could move: a capture and getting home come first, then coming out,
// reaching a safe square, and getting out from in front of someone who could land on it.

/** How many other tokens are one to six squares behind a place on the track: the ones that could land there next roll. */
function hunters(s: LudoState, seat: number, track: number): number {
  let n = 0;
  for (let other = 0; other < s.seats; other++) {
    if (other === seat) continue;
    const corner = cornerOf(s, other);
    for (const steps of s.tokens[other]!) {
      const theirs = trackOf(corner, steps);
      if (theirs === null) continue;
      const gap = (track - theirs + LOOP.length) % LOOP.length;
      // Not one that would have turned up its own home column before it got here.
      if (gap >= 1 && gap <= 6 && steps + gap <= LAST_TRACK) n++;
    }
  }
  return n;
}
const safeFor = (s: LudoState, seat: number, track: number | null) => track === null || track === START[cornerOf(s, seat)] || (s.rules.safe && STARS.has(track));

function worth(s: LudoState, seat: number, token: number): number {
  const corner = cornerOf(s, seat);
  const from = s.tokens[seat]![token]!;
  const to = destination(s, seat, token, s.die)!;
  const before = trackOf(corner, from);
  const after = trackOf(corner, to);
  let value = to - Math.max(from, 0) + to / 20;
  if (from < 0) value += 22;
  if (to === HOME) value += 40;
  const hit = after === null ? null : standing(s, seat, after);
  if (hit) value += 45 + Math.max(...s.tokens[hit.seat]!.filter((steps) => trackOf(cornerOf(s, hit.seat), steps) === after)) / 2;
  // What is at stake where it stands, and where it would stand.
  const risk = (track: number | null, steps: number) => (safeFor(s, seat, track) ? 0 : hunters(s, seat, track!) * (8 + steps / 3));
  value += risk(before, from) - risk(after, to);
  if (after !== null && safeFor(s, seat, after) && to > 0) value += 6;
  return value;
}

function bot(s: LudoState, seat: number, style: PlayStyle, rand: () => number = Math.random): LudoMove | null {
  if (s.phase !== "playing" || s.turn !== seat) return null;
  if (!s.rolled) return { type: "roll" };
  const moves = ludoMoves(s, seat);
  const token = careless(style, rand) ? pickRandom(moves, rand) : moves.reduce((best, t) => (worth(s, seat, t) > worth(s, seat, best) ? t : best));
  return { type: "move", cell: cellOf(cornerOf(s, seat), s.tokens[seat]![token]!, token) };
}

// ---- What a seat sees ---------------------------------------------------------------------------

const TONES: BoardTone[] = ["red", "green", "gold", "blue"];
const COLOUR = ["red", "green", "yellow", "blue"];

function view(s: LudoState, seat: number): BoardView {
  const over = s.phase === "finished";
  const mine = !over && s.turn === seat;
  const corners = cornersFor(s.seats);
  // The cross: the track, the home columns, and the yards of the corners in play.
  const shade: CellShade[] = Array<CellShade>(SIDE * SIDE).fill("none");
  const names: string[] = Array<string>(SIDE * SIDE).fill("off the board");
  const marks: NonNullable<BoardGrid["marks"]> = [];
  LOOP.forEach((cell, track) => {
    shade[cell] = s.rules.safe && STARS.has(track) ? "spot" : "plain";
    names[cell] = s.rules.safe && STARS.has(track) ? `star, square ${track + 1}` : `square ${track + 1}`;
  });
  corners.forEach((corner, owner) => {
    // A yard is a dark panel in its owner's colour, with a light place for each token to wait on.
    for (const cell of YARD_AREA[corner]!) {
      shade[cell] = "dark";
      names[cell] = `${COLOUR[owner]}'s yard`;
      marks.push({ cell, mark: "claimed", owner });
    }
    for (const cell of YARD[corner]!.slice(0, s.rules.tokens)) shade[cell] = "light";
    HOME_RUN[corner]!.forEach((cell, i) => {
      shade[cell] = "plain";
      names[cell] = i === 5 ? `${COLOUR[owner]}'s home` : `${COLOUR[owner]}'s home column, ${i + 1}`;
      marks.push({ cell, mark: "claimed", owner });
    });
    const start = LOOP[START[corner]!]!;
    names[start] = `${COLOUR[owner]}'s start`;
    marks.push({ cell: start, mark: "claimed", owner });
  });
  // Tokens, gathered by the cell they stand on.
  const cells: (BoardPiece | null)[] = Array<BoardPiece | null>(SIDE * SIDE).fill(null);
  s.tokens.forEach((tokens, owner) => {
    const here = new Map<number, string[]>();
    tokens.forEach((steps, token) => {
      const cell = cellOf(corners[owner]!, steps, token);
      here.set(cell, [...(here.get(cell) ?? []), `ludo-${owner}-${token}`]);
    });
    for (const [cell, ids] of here) {
      // Tokens sharing a square are one piece that says how many it is.
      const base = { owner, kind: "token", label: `${ids.length > 1 ? `${ids.length} ` : ""}${COLOUR[owner]} token${ids.length > 1 ? "s" : ""}`, tone: TONES[owner] };
      cells[cell] = ids.length > 1 ? { ...base, glyph: String(ids.length), count: ids.length, ids } : { ...base, glyph: "●", id: ids[0] };
    }
  });
  if (s.last) marks.push({ cell: s.last.from, mark: "from" }, { cell: s.last.to, mark: "last" });
  const can = mine ? ludoMoves(s, seat) : [];
  const grid: BoardGrid = {
    id: "board",
    label: "Board",
    rows: SIDE,
    cols: SIDE,
    cells,
    shade,
    names,
    marks,
    tap: can.length ? { type: "move", cells: [...new Set(can.map((token) => cellOf(corners[seat]!, s.tokens[seat]![token]!, token)))].sort((a, b) => a - b) } : null,
  };
  const home = (i: number) => s.tokens[i]!.filter((steps) => steps === HOME).length;
  const yard = (i: number) => s.tokens[i]!.filter((steps) => steps < 0).length;
  const title = over ? `${who(winnersOf(s)[0]!)} wins!` : "";
  return {
    game: "ludo",
    seats: s.seats,
    me: seat,
    teams: false,
    phase: s.phase,
    turn: over ? null : s.turn,
    grids: [grid],
    reserves: [],
    // The die is dimmed once its roll has been moved (or couldn't be).
    dice: { dice: [{ id: 0, value: s.die || null, used: !s.rolled && s.die > 0 }], roll: s.throws, sides: 6, tap: null },
    choices: mine
      ? s.rolled
        ? { prompt: `Tap a token to move it ${s.die}`, options: [] }
        : { prompt: "", options: [{ label: s.sixes ? "Roll again" : "Roll the die", move: { type: "roll" }, primary: true }] }
      : null,
    players: s.tokens.map((_, i) => ({
      line: [`${home(i)} home`, ...(yard(i) ? [`${yard(i)} in the yard`] : [])].join(" · "),
      // What this seat plays with: a table colours its squares to match.
      piece: { owner: i, kind: "token", glyph: "●", label: `${COLOUR[i]} token`, tone: TONES[i] },
    })),
    info: [
      `First to get ${s.rules.tokens === 2 ? "both" : "all four"} tokens home`,
      ...(over ? [] : [s.rules.enter === "six" ? "A six brings a token out" : "A six or a one brings a token out"]),
      ...(over || !s.rules.safe ? [] : ["Stars are safe"]),
    ],
    narration: s.narration,
    scores: s.tokens.map((_, i) => ({ seats: [i], value: home(i) })),
    result: over ? { key: "final", title, sides: s.tokens.map((_, i) => [i]), rows: [{ label: "Tokens home", values: s.tokens.map((_, i) => String(home(i))), tone: "total" as const }] } : null,
    over: over ? { winners: winnersOf(s), title } : null,
  };
}

// ---- The game -----------------------------------------------------------------------------------

function normalize(rules: unknown): LudoRules {
  const given = (rules && typeof rules === "object" ? rules : {}) as Partial<LudoRules>;
  const base = PRESETS.find((p) => p.id === given.id) ?? classicLudo;
  const r = { ...base, ...given };
  return { id: String(r.id), name: String(r.name), tokens: Number(r.tokens) === 2 ? 2 : 4, enter: r.enter === "sixone" ? "sixone" : "six", safe: r.safe !== false };
}

export const ludo: BoardGame<LudoRules, LudoState, LudoMove> = {
  id: "ludo",
  name: "Ludo",
  emoji: "🎯",
  category: "board",
  blurb: "Race your tokens round the board and home",
  tagline: "Roll a six to come out, race your tokens round the track and up your home column, and send anyone you land on back to their yard.",
  seats: { min: 2, max: 4, default: 4 },
  teams: false,
  presets: PRESETS,
  fields: [
    { key: "tokens", label: "Tokens each", kind: "choice", options: [[4, "Four"], [2, "Two (a quick game)"]] },
    { key: "enter", label: "Coming out of the yard", kind: "choice", options: [["six", "On a six"], ["sixone", "On a six or a one"]] },
    { key: "safe", label: "Safe stars", hint: "A token on a star square can't be captured.", kind: "toggle" },
  ],
  normalize,
  validate: () => [],
  describe(r) {
    return [
      `Everyone has ${r.tokens === 2 ? "two" : "four"} tokens in the yard in their corner. On your turn, roll the die and move one token that many squares, clockwise round the track.`,
      r.enter === "six" ? "A token needs a six to come out of the yard onto your start square." : "A token needs a six or a one to come out of the yard onto your start square.",
      "A six gives you another roll. A third six in a row ends your turn without a move.",
      "Land on another player's token and it goes back to their yard.",
      r.safe ? "Nobody can be captured on their own start square or on a star, so you can't land on one of those while someone else is standing there." : "Nobody can be captured on their own start square, so you can't land on someone else's start while they are standing there.",
      "After a lap of the board a token turns up your own home column. It needs the exact roll to reach home.",
      `The first to get ${r.tokens === 2 ? "both" : "all four"} tokens home wins.`,
    ];
  },
  newGame: newLudo,
  apply,
  view,
  bot,
  // Rolling is quick; choosing between tokens takes a moment.
  thinkingTime: (s, seat) => (!s.rolled ? 700 : ludoMoves(s, seat).length > 1 ? 1100 : 600),
  summary(s) {
    const over = s.phase === "finished";
    return {
      game: "ludo",
      rules: s.rules.name,
      phase: s.phase,
      over,
      hand: 1,
      scoreLine: s.tokens.map((tokens) => tokens.filter((steps) => steps === HOME).length).join(" · "),
      order: over ? rankSeats(s.tokens.map((_, i) => ({ seats: [i], score: progress(s, i) }))) : null,
      winners: over ? winnersOf(s) : null,
      teams: false,
      seats: s.seats,
    };
  },
};
