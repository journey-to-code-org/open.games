// Snakes & Ladders: a race along a snaking track of 36 squares. Everyone has pieces in a yard
// before square 1; they race to square 36, and the first to get every piece there wins.
//
//   - A turn is a roll of two dice. Each die moves one piece, in either order, so a player chooses
//     which piece takes which die (or gives both to one). A die that no piece can use is lost.
//   - A piece needs the exact count to reach square 36.
//   - Landing on the foot of a ladder takes a piece up it at once; landing on the head of a snake
//     (when the table plays with them) takes it down.
//   - Land on another player's pieces and they go back to their yard. Your own share a square.
//
// The board is a grid of six columns and eight rows. The middle six rows are the track, read as a
// snake: square 1 is bottom left, each row runs the other way from the one below, and square 36
// is top left. The bottom row holds a yard for each seat and the top row a home for each seat,
// with the cells that are neither shaded "none". A piece is drawn where it ends up, so a piece
// that reaches square 36 is drawn in its owner's home. Ladder feet and snake heads are nobody's
// pieces whose glyph says where they lead ("↑12", "↓5"); nothing ever rests on one.
import type { PlayStyle } from "@journey-to-code/rules";
import type { BoardGame, BoardGrid, BoardPiece, BoardTone, BoardView, CellShade } from "./board.js";
import { careless, clone, GameError, nextRandom, pickRandom, rankSeats, who, type BaseRules } from "./table.js";

export interface SnakesRules extends BaseRules {
  /** Pieces each: two, or one for a quick game. */
  pieces: number;
  /** Snakes take a piece back down the track. Without them the board has only ladders. */
  snakes: boolean;
  /** Who throws first: the luck of the draw, or the first seat. */
  first: "random" | "seat1";
}

export const classicSnakes: SnakesRules = { id: "snakes-classic", name: "Classic (two pieces)", pieces: 2, snakes: true, first: "random" };
export const quickSnakes: SnakesRules = { id: "snakes-quick", name: "Quick (one piece)", pieces: 1, snakes: true, first: "random" };
export const gentleSnakes: SnakesRules = { id: "snakes-gentle", name: "Gentle (ladders only)", pieces: 2, snakes: false, first: "random" };
const PRESETS = [classicSnakes, quickSnakes, gentleSnakes];

// ---- The board ----------------------------------------------------------------------------------

/** Where a piece is: 0 in the yard, 1 to 35 on that square of the track, `SNAKES_HOME` home. */
export const SNAKES_HOME = 36;
const HOME = SNAKES_HOME;
export const SNAKES_COLS = 6;
const COLS = SNAKES_COLS;
const ROWS = 8;
/** The foot of each ladder and the square at its top. */
export const SNAKES_LADDERS: readonly (readonly [number, number])[] = [[3, 12], [8, 19], [15, 26], [22, 30]];
/** The head of each snake and the square at its tail. */
export const SNAKES_SNAKES: readonly (readonly [number, number])[] = [[17, 5], [25, 9], [31, 14], [35, 20]];

/** Where a piece that counts to each square ends up: itself, or the other end of a ladder or snake. One table with snakes, one without. */
function landings(withSnakes: boolean): readonly number[] {
  const out = Array.from({ length: HOME + 1 }, (_, square) => square);
  for (const [foot, top] of SNAKES_LADDERS) out[foot] = top;
  if (withSnakes) for (const [head, tail] of SNAKES_SNAKES) out[head] = tail;
  return out;
}
const LAND_LADDERS = landings(false);
const LAND_BOTH = landings(true);
const landOf = (rules: Pick<SnakesRules, "snakes">) => (rules.snakes ? LAND_BOTH : LAND_LADDERS);

/** The cell a square of the track is drawn in. */
function trackCell(square: number): number {
  const i = square - 1;
  const up = Math.floor(i / COLS);
  const col = up % 2 === 0 ? i % COLS : COLS - 1 - (i % COLS);
  return (ROWS - 2 - up) * COLS + col;
}
const TRACK: readonly number[] = Array.from({ length: HOME + 1 }, (_, square) => (square === 0 ? -1 : trackCell(square)));
const SQUARE_AT = new Map(TRACK.map((cell, square) => [cell, square] as const).slice(1));
const yardCell = (seat: number) => (ROWS - 1) * COLS + seat;
const homeCell = (seat: number) => seat;
/** The cell a seat's piece is drawn in when it is at `at`. */
export const snakesCell = (seat: number, at: number) => (at === 0 ? yardCell(seat) : at === HOME ? homeCell(seat) : TRACK[at]!);

// ---- The state ----------------------------------------------------------------------------------

export interface SnakesState {
  game: "snakes";
  rules: SnakesRules;
  seats: number;
  rng: number;
  /** Whose turn it is. */
  turn: number;
  /** "roll" until the dice are thrown, "move" while there is a die to spend, "finished" at the end. */
  phase: "roll" | "move" | "finished";
  /** Where each seat's pieces are: see `SNAKES_HOME`. */
  pieces: number[][];
  /** The last two dice thrown: this turn's while moving, the turn before's while waiting for a roll. Empty before the first throw. */
  dice: number[];
  /** Which of them are spent or lost. */
  spent: boolean[];
  /** How many times the dice have been thrown. */
  rolls: number;
  /** The cells the last move went between. */
  last: { from: number; to: number } | null;
  narration: string | null;
}

export type SnakesMove = { type: "roll" } | { type: "move"; from: number; to: number };

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
    narration: null,
  };
  if (rules.first === "random") s.turn = Math.floor(nextRandom(s)() * seats);
  return s;
}

/** One thing a seat could do with a die: move a piece of its own from one place to another. */
interface Step {
  die: number;
  from: number;
  to: number;
}

/** Every step a seat's pieces could take with the dice still to spend. Pieces sharing a place are one step, and so are two dice showing the same. */
function stepsWith(land: readonly number[], mine: readonly number[], dice: readonly number[], spent: readonly boolean[]): Step[] {
  const out: Step[] = [];
  for (let die = 0; die < dice.length; die++) {
    if (spent[die] || (die > 0 && !spent[die - 1] && dice[die - 1] === dice[die])) continue;
    for (let i = 0; i < mine.length; i++) {
      const from = mine[i]!;
      if (from === HOME || mine.indexOf(from) !== i || from + dice[die]! > HOME) continue;
      out.push({ die, from, to: land[from + dice[die]!]! });
    }
  }
  return out;
}

/** The steps a seat can take now. */
const stepsFor = (s: SnakesState, seat: number): Step[] => (s.phase === "move" && s.turn === seat ? stepsWith(landOf(s.rules), s.pieces[seat]!, s.dice, s.spent) : []);

const allHome = (s: SnakesState, seat: number) => s.pieces[seat]!.every((at) => at === HOME);
const winnersOf = (s: SnakesState) => s.pieces.flatMap((_, seat) => (allHome(s, seat) ? [seat] : []));
/** How far a seat has got in all: what places the players who didn't win. */
const progress = (s: SnakesState, seat: number) => s.pieces[seat]!.reduce((n, at) => n + at, 0);

/** The turn passes. The dice stay on the table, spent, until the next throw. */
function pass(s: SnakesState) {
  s.turn = (s.turn + 1) % s.seats;
  s.phase = "roll";
  s.spent = s.dice.map(() => true);
}

// ---- Moves --------------------------------------------------------------------------------------

function apply(state: SnakesState, seat: number, move: SnakesMove): SnakesState {
  if (move?.type !== "roll" && move?.type !== "move") throw new GameError("That's not a move in Snakes & Ladders.");
  if (state.phase === "finished") throw new GameError("The game is over.");
  if (!Number.isInteger(seat) || seat < 0 || seat >= state.seats) throw new GameError("You're not at this table.");
  if (state.turn !== seat) throw new GameError("It's not your turn.");

  if (move.type === "roll") {
    if (state.phase !== "roll") throw new GameError("Move a piece first.");
    const s = clone(state);
    const rand = nextRandom(s);
    s.dice = [1 + Math.floor(rand() * 6), 1 + Math.floor(rand() * 6)];
    s.spent = [false, false];
    s.rolls += 1;
    s.last = null;
    s.phase = "move";
    const thrown = `${who(seat)} rolls ${s.dice[0]} and ${s.dice[1]}`;
    if (stepsFor(s, seat).length) s.narration = thrown;
    else {
      s.narration = `${thrown} and can't move`;
      pass(s);
    }
    return s;
  }

  if (state.phase !== "move") throw new GameError("Roll the dice first.");
  const from = Number(move.from);
  const to = Number(move.to);
  const cells = ROWS * COLS;
  if (!Number.isInteger(from) || from < 0 || from >= cells || !Number.isInteger(to) || to < 0 || to >= cells) throw new GameError("That's not a square on the board.");
  if (from === homeCell(seat)) throw new GameError("That piece is already home.");
  const at = from === yardCell(seat) ? 0 : (SQUARE_AT.get(from) ?? -1);
  if (at < 0 || !state.pieces[seat]!.includes(at)) throw new GameError("You don't have a piece there.");
  const steps = stepsFor(state, seat).filter((step) => step.from === at);
  const step = steps.find((option) => snakesCell(seat, option.to) === to);
  if (!step) {
    const left = state.dice.filter((_, die) => !state.spent[die]);
    throw new GameError(steps.length ? `That piece can't go there with ${left.length > 1 ? `a ${left[0]} or a ${left[1]}` : `a ${left[0]}`}.` : `That piece needs the exact count to reach square ${HOME}.`);
  }

  const s = clone(state);
  const value = s.dice[step.die]!;
  const counted = at + value;
  s.pieces[seat]![s.pieces[seat]!.indexOf(at)] = step.to;
  s.spent[step.die] = true;
  s.last = { from, to };
  let line =
    step.to === HOME
      ? `${who(seat)} gets a piece home`
      : step.to > counted
        ? `${who(seat)} moves ${value} and climbs the ladder to square ${step.to}`
        : step.to < counted
          ? `${who(seat)} moves ${value} and slides down the snake to square ${step.to}`
          : at === 0
            ? `${who(seat)} brings a piece out to square ${step.to}`
            : `${who(seat)} moves ${value} to square ${step.to}`;
  // Everything of anyone else's on the square goes back to its yard. Nobody is ever caught at home.
  if (step.to !== HOME) {
    const caught: string[] = [];
    for (let other = 0; other < s.seats; other++) {
      if (other === seat) continue;
      const sent = s.pieces[other]!.filter((theirs) => theirs === step.to).length;
      if (!sent) continue;
      s.pieces[other] = s.pieces[other]!.map((theirs) => (theirs === step.to ? 0 : theirs));
      caught.push(`${who(other)}'s ${sent > 1 ? `${sent} pieces` : "piece"}`);
    }
    if (caught.length) line += ` and sends ${caught.join(" and ")} back to the yard`;
  }
  if (allHome(s, seat)) {
    s.phase = "finished";
    s.spent = s.dice.map(() => true);
    s.narration = `${line}. ${who(seat)} wins!`;
    return s;
  }
  if (!stepsFor(s, seat).length) {
    // The other die is lost when nothing can use it.
    if (s.spent.some((used) => !used)) line += `. Nothing can move ${s.dice[s.spent.indexOf(false)]}`;
    pass(s);
  }
  s.narration = line;
  return s;
}

// ---- The computer player ------------------------------------------------------------------------
// It looks at every way of spending the dice it has left (which piece takes which, and in which
// order) and plays the first step of the one that leaves it best off: its own pieces far along,
// the others' sent back, and as little as possible standing where a roll could land on it.

/**
 * For a piece at `from`, how many of the 36 rolls of two dice let it land on each square: with
 * either die alone, or with one and then the other. One table with snakes and one without, worked
 * out the first time it is asked for.
 */
const reachTables = new Map<readonly number[], Uint8Array[]>();
function reachOf(land: readonly number[]): Uint8Array[] {
  let table = reachTables.get(land);
  if (table) return table;
  table = [];
  for (let from = 0; from < HOME; from++) {
    const counts = new Uint8Array(HOME + 1);
    const go = (start: number, die: number) => (start < HOME && start + die <= HOME ? land[start + die]! : -1);
    for (let a = 1; a <= 6; a++) {
      for (let b = 1; b <= 6; b++) {
        const firstA = go(from, a);
        const firstB = go(from, b);
        const hit = new Set([firstA, firstB, firstA < 0 ? -1 : go(firstA, b), firstB < 0 ? -1 : go(firstB, a)]);
        for (const square of hit) if (square > 0 && square < HOME) counts[square]! += 1;
      }
    }
    table.push(counts);
  }
  reachTables.set(land, table);
  return table;
}

/** What being home is worth over standing on the last square before it: it can't be caught, and it is done. */
const HOME_BONUS = 10;
/** How much one square of someone else's progress weighs against one of the bot's own. */
const THEIRS = 0.8;
/** What a caught piece loses besides its square: the turns it takes to come back. */
const CAUGHT = 4;

/** How good the table looks to the seat whose pieces are `mine`. */
function judge(land: readonly number[], mine: readonly number[], others: readonly (readonly number[])[]): number {
  const reach = reachOf(land);
  let value = 0;
  for (const at of mine) {
    value += at === HOME ? HOME + HOME_BONUS : at;
    if (at === 0 || at === HOME) continue;
    // The chance somebody lands on it before it moves again, taken as the sum of each piece's chance.
    let rolls = 0;
    for (const theirs of others) for (const from of theirs) if (from < HOME) rolls += reach[from]![at]!;
    value -= (Math.min(rolls, 36) / 36) * (at + CAUGHT);
  }
  let against = 0;
  for (const theirs of others) for (const at of theirs) against += at === HOME ? HOME + HOME_BONUS : at;
  return value - (against * THEIRS) / Math.max(1, others.length);
}

/** The best the seat can do with the dice left, and the step that starts it. */
function plan(land: readonly number[], mine: readonly number[], others: readonly (readonly number[])[], dice: readonly number[], spent: readonly boolean[], rand: () => number): { value: number; step: Step | null } {
  const steps = stepsWith(land, mine, dice, spent);
  if (!steps.length) return { value: judge(land, mine, others), step: null };
  let best: { value: number; step: Step | null } = { value: -Infinity, step: null };
  for (const step of steps) {
    const moved = [...mine];
    moved[moved.indexOf(step.from)] = step.to;
    const left = step.to === HOME ? others : others.map((theirs) => (theirs.includes(step.to) ? theirs.map((at) => (at === step.to ? 0 : at)) : theirs));
    const used = [...spent];
    used[step.die] = true;
    // A whisker of chance, so two plans that come to the same aren't always played the same way.
    const value = plan(land, moved, left, dice, used, rand).value + rand() * 0.01;
    if (value > best.value) best = { value, step };
  }
  return best;
}

function bot(s: SnakesState, seat: number, style: PlayStyle, rand: () => number = Math.random): SnakesMove | null {
  if (s.phase === "finished" || s.turn !== seat) return null;
  if (s.phase === "roll") return { type: "roll" };
  const steps = stepsFor(s, seat);
  const others = s.pieces.filter((_, other) => other !== seat);
  const step = careless(style, rand) ? pickRandom(steps, rand) : plan(landOf(s.rules), s.pieces[seat]!, others, s.dice, s.spent, rand).step!;
  return { type: "move", from: snakesCell(seat, step.from), to: snakesCell(seat, step.to) };
}

// ---- What a seat sees ---------------------------------------------------------------------------

const TONES: BoardTone[] = ["red", "blue", "green", "gold"];
const COLOUR = ["red", "blue", "green", "yellow"];
const CELLS = ROWS * COLS;

/** The board with nothing on it, for a table with snakes and one without: shades, names, and the ladders and snakes. It never changes, so it is made once. */
interface Bare {
  shade: CellShade[];
  names: string[];
  cells: (BoardPiece | null)[];
}
const bareBoards = new Map<boolean, Bare>();
function bareOf(withSnakes: boolean): Bare {
  let bare = bareBoards.get(withSnakes);
  if (bare) return bare;
  const shade = Array<CellShade>(CELLS).fill("none");
  const names = Array<string>(CELLS).fill("off the board");
  const cells = Array<BoardPiece | null>(CELLS).fill(null);
  for (let square = 1; square <= HOME; square++) {
    shade[TRACK[square]!] = "plain";
    names[TRACK[square]!] = square === HOME ? `square ${HOME}, the last` : `square ${square}`;
  }
  const lay = (from: number, to: number, kind: "ladder" | "snake") => {
    const up = kind === "ladder";
    shade[TRACK[from]!] = "spot";
    names[TRACK[from]!] = `square ${from}, ${up ? "a ladder up" : "a snake down"} to ${to}`;
    names[TRACK[to]!] = `square ${to}, the ${up ? "top of the ladder" : "tail of the snake"} from ${from}`;
    cells[TRACK[from]!] = { owner: null, kind, glyph: `${up ? "↑" : "↓"}${to}`, label: `${up ? "ladder up" : "snake down"} to square ${to}`, tone: up ? "light" : "dark" };
  };
  for (const [foot, top] of SNAKES_LADDERS) lay(foot, top, "ladder");
  if (withSnakes) for (const [head, tail] of SNAKES_SNAKES) lay(head, tail, "snake");
  bare = { shade, names, cells };
  bareBoards.set(withSnakes, bare);
  return bare;
}

const pieceOf = (owner: number): BoardPiece => ({ owner, kind: "piece", glyph: "●", label: `${COLOUR[owner]} piece`, tone: TONES[owner] });

function view(s: SnakesState, seat: number): BoardView {
  const over = s.phase === "finished";
  const mine = !over && s.turn === seat;
  const bare = bareOf(s.rules.snakes);
  const shade = [...bare.shade];
  const names = [...bare.names];
  const cells = [...bare.cells];
  const marks: NonNullable<BoardGrid["marks"]> = [];
  s.pieces.forEach((pieces, owner) => {
    // A yard and a home for every seat at the table, in its colour.
    for (const [cell, name] of [[yardCell(owner), "yard"], [homeCell(owner), "home"]] as const) {
      shade[cell] = "dark";
      names[cell] = `${COLOUR[owner]}'s ${name}`;
      marks.push({ cell, mark: "claimed", owner });
    }
    // Pieces, gathered by the cell they stand on. Those sharing one are a single piece that says how many it is.
    const here = new Map<number, string[]>();
    pieces.forEach((at, piece) => {
      const cell = snakesCell(owner, at);
      const ids = here.get(cell);
      if (ids) ids.push(`snakes-${owner}-${piece}`);
      else here.set(cell, [`snakes-${owner}-${piece}`]);
    });
    for (const [cell, ids] of here) {
      cells[cell] = ids.length > 1 ? { ...pieceOf(owner), glyph: String(ids.length), label: `${ids.length} ${COLOUR[owner]} pieces`, count: ids.length, ids } : { ...pieceOf(owner), id: ids[0] };
    }
  });
  if (s.last) marks.push({ cell: s.last.from, mark: "from" }, { cell: s.last.to, mark: "last" });

  // What each piece that can move could do: pick one up, and put it down where it would end.
  const sources = new Map<number, number[]>();
  for (const step of stepsFor(s, seat)) {
    const from = snakesCell(seat, step.from);
    const to = snakesCell(seat, step.to);
    const list = sources.get(from);
    if (!list) sources.set(from, [to]);
    else if (!list.includes(to)) list.push(to);
  }
  const grid: BoardGrid = {
    id: "board",
    label: "Board",
    rows: ROWS,
    cols: COLS,
    cells,
    shade,
    names,
    marks,
    select: sources.size ? { type: "move", sources: [...sources].map(([from, to]) => ({ from, to })) } : null,
  };

  const left = s.phase === "move" ? s.dice.filter((_, die) => !s.spent[die]) : [];
  const home = (i: number) => s.pieces[i]!.filter((at) => at === HOME).length;
  const yard = (i: number) => s.pieces[i]!.filter((at) => at === 0).length;
  const title = over ? `${who(winnersOf(s)[0]!)} wins!` : "";
  return {
    game: "snakes",
    seats: s.seats,
    me: seat,
    teams: false,
    phase: s.phase,
    turn: over ? null : s.turn,
    grids: [grid],
    reserves: [],
    // A die is dimmed once it has been moved, or lost.
    dice: { dice: [0, 1].map((id) => ({ id, value: s.dice[id] ?? null, used: s.dice.length > 0 && (s.spent[id] ?? true) })), roll: s.rolls, sides: 6, tap: null },
    choices: mine
      ? s.phase === "roll"
        ? { prompt: "", options: [{ label: "Roll the dice", move: { type: "roll" }, primary: true }] }
        : { prompt: left.length > 1 ? (left[0] === left[1] ? `Move ${left[0]}, twice` : `Move ${left[0]} and ${left[1]}, in either order`) : `Move ${left[0]}`, options: [] }
      : null,
    players: s.pieces.map((_, i) => ({
      line: [`${home(i)} home`, ...(yard(i) ? [`${yard(i)} in the yard`] : [])].join(" · "),
      piece: pieceOf(i),
    })),
    info: [
      s.rules.pieces === 1 ? `First to square ${HOME}` : `First to get both pieces to square ${HOME}`,
      ...(over ? [] : [`Square ${HOME} takes the exact count`, s.rules.snakes ? "↑ a ladder up · ↓ a snake down" : "↑ a ladder up"]),
    ],
    narration: s.narration,
    scores: s.pieces.map((_, i) => ({ seats: [i], value: home(i) })),
    result: over ? { key: "final", title, sides: s.pieces.map((_, i) => [i]), rows: [{ label: "Pieces home", values: s.pieces.map((_, i) => String(home(i))), tone: "total" as const }] } : null,
    over: over ? { winners: winnersOf(s), title } : null,
  };
}

// ---- The game -----------------------------------------------------------------------------------

function normalize(rules: unknown): SnakesRules {
  const given = (rules && typeof rules === "object" ? rules : {}) as Partial<SnakesRules>;
  const base = PRESETS.find((p) => p.id === given.id) ?? classicSnakes;
  const r = { ...base, ...given };
  return { id: String(r.id), name: String(r.name), pieces: Number(r.pieces) === 1 ? 1 : 2, snakes: r.snakes !== false, first: r.first === "seat1" ? "seat1" : "random" };
}

export const snakes: BoardGame<SnakesRules, SnakesState, SnakesMove> = {
  id: "snakes",
  name: "Snakes & Ladders",
  emoji: "🐍",
  category: "board",
  blurb: "Race to the last square, up ladders and down snakes",
  tagline: "Roll two dice and choose which piece takes each. Ladders take you up, snakes take you down, and anyone you land on goes back to the yard.",
  seats: { min: 2, max: 4, default: 2 },
  teams: false,
  presets: PRESETS,
  fields: [
    { key: "pieces", label: "Pieces each", kind: "choice", options: [[2, "Two"], [1, "One (a quick game)"]] },
    { key: "snakes", label: "Snakes", hint: "Without them the board has only ladders.", kind: "toggle" },
    { key: "first", label: "Who goes first", kind: "choice", options: [["random", "Luck of the draw"], ["seat1", "The first seat"]] },
  ],
  normalize,
  validate: () => [],
  describe(r) {
    return [
      `Everyone has ${r.pieces === 1 ? "a piece" : "two pieces"} in the yard. The track snakes up the board from square 1, bottom left, to square ${HOME}, top left.`,
      r.pieces === 1 ? "On your turn, roll two dice and move your piece one die and then the other." : "On your turn, roll two dice. Each die moves one piece: give one to each, or both to the same piece, in either order.",
      `A piece needs the exact count to reach square ${HOME}. A die that nothing can use is lost.`,
      r.snakes ? "Land on the foot of a ladder and the piece climbs it. Land on the head of a snake and it slides down." : "Land on the foot of a ladder and the piece climbs it. There are no snakes on this board.",
      "Land on another player's pieces and they go back to their yard. Your own pieces can share a square.",
      r.pieces === 1 ? `The first to square ${HOME} wins.` : `The first to get both pieces to square ${HOME} wins.`,
      r.first === "random" ? "Who goes first is the luck of the draw." : "The first seat goes first.",
    ];
  },
  newGame: newSnakes,
  apply,
  view,
  bot,
  // Rolling is quick; choosing between pieces and dice takes a moment.
  thinkingTime: (s, seat) => (s.phase === "roll" ? 700 : stepsFor(s, seat).length > 1 ? 1100 : 600),
  summary(s) {
    const over = s.phase === "finished";
    return {
      game: "snakes",
      rules: s.rules.name,
      phase: s.phase,
      over,
      hand: 1,
      scoreLine: s.pieces.map((pieces) => pieces.filter((at) => at === HOME).length).join(" · "),
      order: over ? rankSeats(s.pieces.map((_, i) => ({ seats: [i], score: progress(s, i) }))) : null,
      winners: over ? winnersOf(s) : null,
      teams: false,
      seats: s.seats,
    };
  },
};
