// Criss-Crosswords: a crossword tile game. Seven letter tiles each, drawn from a bag; on your turn
// put some of them on the board in one row or one column, joined to what is there, so that every
// run of letters they touch spells a word. Letters score their value, and some squares double or
// triple a letter or a whole word. Using all seven tiles at once is worth a bonus.
//
// Our own board, letter counts and values: not any other crossword game's.
//
// Words are checked as they are played (no challenges): every word made has to be in the list,
// which runs to 8 letters, so a longer word can't be made.
import type { PlayStyle } from "@journey-to-code/rules";
import { careless, clone, GameError, nextRandom, rankSeats, shuffled, thinkFor, who, type BaseRules, type RuleField, type ThinkBudget } from "./table.js";
import type { PlacedTile, PlayedWord, WordBonus, WordGame, WordTile, WordView } from "./word.js";
import { commonWords, isWord, plainWords, WORD_LENGTHS } from "./words.js";

const SIZE = 15;
const MID = 7;
const RACK = 7;
/** For putting all seven tiles down in one turn. */
const ALL_SEVEN = 40;
/** The game ends after this many turns in a row in which nobody scored (passes and swaps). */
const STALL = 6;

/** The letters in the bag, and what each is worth. 102 tiles, no blanks. */
const COUNTS: Record<string, number> = { e: 11, a: 9, i: 8, o: 8, r: 6, t: 6, n: 6, s: 5, l: 5, u: 4, d: 4, c: 3, g: 3, h: 3, m: 3, p: 3, b: 2, y: 2, f: 2, w: 2, k: 2, v: 1, x: 1, j: 1, q: 1, z: 1 };
export const CRISS_VALUES: Record<string, number> = { e: 1, a: 1, i: 1, o: 1, r: 1, t: 1, n: 1, s: 1, l: 2, u: 2, d: 2, c: 3, g: 3, h: 3, m: 3, p: 3, b: 4, y: 4, f: 4, w: 4, k: 5, v: 6, x: 8, j: 8, q: 10, z: 10 };

// The squares that are worth more: one corner's worth, mirrored into the other three and across
// the diagonal. The middle square is where the first word goes, and it doubles that word.
const QUARTER: [number, number, WordBonus][] = [
  [0, 3, "tw"],
  [1, 1, "dw"],
  [3, 3, "dw"],
  [5, 5, "dw"],
  [0, 0, "tl"],
  [2, 6, "tl"],
  [1, 5, "dl"],
  [2, 4, "dl"],
  [6, 6, "dl"],
  [3, 7, "dl"],
  [0, 7, "dl"],
  [4, 0, "dl"],
];
export const CRISS_BONUS: (WordBonus | null)[][] = (() => {
  const grid: (WordBonus | null)[][] = Array.from({ length: SIZE }, () => Array<WordBonus | null>(SIZE).fill(null));
  for (const [r0, c0, bonus] of QUARTER) {
    for (const [r, c] of [
      [r0, c0],
      [c0, r0],
    ]) {
      for (const rr of [r!, SIZE - 1 - r!]) for (const cc of [c!, SIZE - 1 - c!]) grid[rr]![cc] = bonus;
    }
  }
  grid[MID]![MID] = "start";
  return grid;
})();

export interface CrissRules extends BaseRules {
  /** How many tiles each player holds. */
  rack: number;
  /** Points for using all your tiles in one turn. */
  bonus: number;
}

export const crissClassic: CrissRules = { id: "classic", name: "Classic", rack: RACK, bonus: ALL_SEVEN };
const PRESETS = [crissClassic];

export interface CrissState {
  game: "crisscross";
  rules: CrissRules;
  seats: number;
  rng: number;
  hand: 1;
  dealer: 0;
  phase: "playing" | "finished";
  turn: number;
  /** The board, row by row: a letter, or "" for an empty square. */
  board: string[][];
  bag: string[];
  racks: string[][];
  points: number[];
  /** The squares the last move filled, and the words it made, for everyone to see. */
  fresh: { row: number; col: number }[];
  lastWords: { word: string; points: number }[];
  lastBy: number | null;
  /** Turns in a row that scored nothing. */
  stall: number;
  winners: number[] | null;
  narration: string | null;
}

export type CrissMove = { type: "place"; tiles: PlacedTile[] } | { type: "pass" } | { type: "swap" };

const empty = (b: string[][]) => b.every((row) => row.every((x) => !x));
const has = (b: string[][], r: number, c: number) => r >= 0 && r < SIZE && c >= 0 && c < SIZE && !!b[r]![c];

export function newCriss(rules: CrissRules, seats: number, seed: number): CrissState {
  const s = { game: "crisscross", rules, seats, rng: seed, hand: 1, dealer: 0, phase: "playing", turn: 0, points: Array<number>(seats).fill(0), fresh: [], lastWords: [], lastBy: null, stall: 0, winners: null } as unknown as CrissState;
  s.board = Array.from({ length: SIZE }, () => Array<string>(SIZE).fill(""));
  s.bag = shuffled(
    Object.entries(COUNTS).flatMap(([letter, n]) => Array<string>(n).fill(letter)),
    nextRandom(s),
  );
  s.racks = Array.from({ length: seats }, () => s.bag.splice(0, rules.rack));
  s.narration = `${who(0)} starts: the first word goes through the middle square.`;
  return s;
}

/** What a move makes, if it is a legal one: the words it forms and what they score. Throws a GameError saying why not. */
export function judge(board: string[][], tiles: PlacedTile[], rules: CrissRules = crissClassic): { words: { word: string; points: number }[]; total: number } {
  if (!tiles.length) throw new GameError("Put at least one tile down.");
  const seen = new Set<string>();
  for (const t of tiles) {
    if (!Number.isInteger(t?.row) || !Number.isInteger(t?.col) || t.row < 0 || t.row >= SIZE || t.col < 0 || t.col >= SIZE) throw new GameError("That's off the board.");
    if (typeof t.letter !== "string" || !/^[a-z]$/.test(t.letter)) throw new GameError("A tile is a letter.");
    if (board[t.row]![t.col]) throw new GameError("There's a tile on that square already.");
    if (seen.has(`${t.row},${t.col}`)) throw new GameError("Two tiles on one square.");
    seen.add(`${t.row},${t.col}`);
  }
  const across = tiles.every((t) => t.row === tiles[0]!.row);
  const down = tiles.every((t) => t.col === tiles[0]!.col);
  if (!across && !down) throw new GameError("Tiles go in one row or one column.");
  const next = board.map((row) => [...row]);
  for (const t of tiles) next[t.row]![t.col] = t.letter;
  // The run the tiles are in: from the first to the last, with no gaps.
  const horizontal = tiles.length === 1 ? has(next, tiles[0]!.row, tiles[0]!.col - 1) || has(next, tiles[0]!.row, tiles[0]!.col + 1) : across;
  const fixed = horizontal ? tiles[0]!.row : tiles[0]!.col;
  const along = tiles.map((t) => (horizontal ? t.col : t.row));
  for (let i = Math.min(...along); i <= Math.max(...along); i++) if (!(horizontal ? next[fixed]![i] : next[i]![fixed])) throw new GameError("The tiles have to make one word, with no gaps.");
  if (empty(board)) {
    if (!tiles.some((t) => t.row === MID && t.col === MID)) throw new GameError("The first word goes through the middle square.");
    if (tiles.length < 2) throw new GameError("The first word needs at least two letters.");
  } else if (!tiles.some((t) => [[-1, 0], [1, 0], [0, -1], [0, 1]].some(([dr, dc]) => has(board, t.row + dr!, t.col + dc!)))) {
    throw new GameError("A word has to join up with the tiles already on the board.");
  }
  const placed = new Set(tiles.map((t) => `${t.row},${t.col}`));
  /** The word through (r, c) one way, if it is two letters or more, scored. */
  const wordAt = (r: number, c: number, dr: number, dc: number) => {
    while (has(next, r - dr, c - dc)) [r, c] = [r - dr, c - dc];
    let word = "";
    let sum = 0;
    let times = 1;
    for (; has(next, r, c); r += dr, c += dc) {
      const letter = next[r]![c]!;
      word += letter;
      let value = CRISS_VALUES[letter]!;
      if (placed.has(`${r},${c}`)) {
        const bonus = CRISS_BONUS[r]![c];
        if (bonus === "dl") value *= 2;
        if (bonus === "tl") value *= 3;
        if (bonus === "dw" || bonus === "start") times *= 2;
        if (bonus === "tw") times *= 3;
      }
      sum += value;
    }
    return word.length > 1 ? { word, points: sum * times } : null;
  };
  const words: { word: string; points: number }[] = [];
  const main = horizontal ? wordAt(tiles[0]!.row, tiles[0]!.col, 0, 1) : wordAt(tiles[0]!.row, tiles[0]!.col, 1, 0);
  if (main) words.push(main);
  for (const t of tiles) {
    const cross = horizontal ? wordAt(t.row, t.col, 1, 0) : wordAt(t.row, t.col, 0, 1);
    if (cross) words.push(cross);
  }
  if (!words.length) throw new GameError("That doesn't make a word.");
  for (const { word } of words) {
    if (word.length > WORD_LENGTHS.max) throw new GameError(`${word.toUpperCase()} is longer than the list goes (${WORD_LENGTHS.max} letters).`);
    if (!isWord(word)) throw new GameError(`${word.toUpperCase()} isn't a word here.`);
  }
  const total = words.reduce((sum, w) => sum + w.points, 0) + (tiles.length >= rules.rack ? rules.bonus : 0);
  return { words, total };
}

/** The game is over: what is left in each rack comes off its owner's score, and goes to whoever went out. */
function finish(s: CrissState, out: number | null) {
  let left = 0;
  s.racks.forEach((rack, seat) => {
    const sum = rack.reduce((n, letter) => n + CRISS_VALUES[letter]!, 0);
    s.points[seat]! -= sum;
    left += sum;
  });
  if (out !== null) s.points[out]! += left;
  s.phase = "finished";
  const best = Math.max(...s.points);
  s.winners = s.points.flatMap((n, seat) => (n === best ? [seat] : []));
  s.narration = `${out !== null ? `${who(out)} is out of tiles. ` : "Nobody can score: the game ends. "}${s.winners.length === s.seats ? "It's a tie!" : `${s.winners.map(who).join(" and ")} ${s.winners.length === 1 ? "wins" : "win"}!`}`;
}

function apply(state: CrissState, seat: number, move: CrissMove): CrissState {
  if (!Number.isInteger(seat) || seat < 0 || seat >= state.seats) throw new GameError("That's not a seat at this table.");
  if (move?.type !== "place" && move?.type !== "pass" && move?.type !== "swap") throw new GameError("That's not a move in Criss-Crosswords.");
  if (state.phase !== "playing") throw new GameError("This game is over.");
  if (state.turn !== seat) throw new GameError("It's not your turn.");
  const s = clone(state);
  const rack = s.racks[seat]!;
  if (move.type === "place") {
    if (!Array.isArray(move.tiles)) throw new GameError("Put at least one tile down.");
    const left = [...rack];
    for (const t of move.tiles) {
      const at = left.indexOf(t?.letter);
      if (at < 0) throw new GameError(`You haven't a ${String(t?.letter ?? "").toUpperCase() || "tile"} to play.`);
      left.splice(at, 1);
    }
    const { words, total } = judge(s.board, move.tiles, s.rules);
    for (const t of move.tiles) s.board[t.row]![t.col] = t.letter;
    s.racks[seat] = [...left, ...s.bag.splice(0, s.rules.rack - left.length)];
    s.points[seat]! += total;
    s.fresh = move.tiles.map((t) => ({ row: t.row, col: t.col }));
    s.lastWords = words;
    s.lastBy = seat;
    s.stall = 0;
    s.narration = `${who(seat)} plays ${words.map((w) => w.word.toUpperCase()).join(", ")} for ${total}.${move.tiles.length >= s.rules.rack ? ` All ${s.rules.rack} tiles: +${s.rules.bonus}!` : ""}`;
    if (!s.racks[seat]!.length) {
      finish(s, seat);
      return s;
    }
  } else if (move.type === "swap") {
    if (s.bag.length < s.rules.rack) throw new GameError("There aren't enough tiles left in the bag to swap.");
    const back = s.racks[seat]!;
    s.racks[seat] = s.bag.splice(0, back.length);
    s.bag = shuffled([...s.bag, ...back], nextRandom(s));
    s.stall += 1;
    s.fresh = [];
    s.narration = `${who(seat)} swaps their tiles.`;
  } else {
    s.stall += 1;
    s.fresh = [];
    s.narration = `${who(seat)} passes.`;
  }
  if (s.stall >= STALL) {
    finish(s, null);
    return s;
  }
  s.turn = (seat + 1) % s.seats;
  return s;
}

function view(s: CrissState, seat: number): WordView {
  const playing = s.phase === "playing";
  const mine = playing && s.turn === seat;
  const fresh = new Set(s.fresh.map((f) => `${f.row},${f.col}`));
  const rows: WordTile[][] = s.board.map((row, r) =>
    row.map((letter, c) => {
      const tile: WordTile = { letter };
      const bonus = CRISS_BONUS[r]![c];
      if (bonus) tile.bonus = bonus;
      if (fresh.has(`${r},${c}`)) tile.fresh = true;
      return tile;
    }),
  );
  const words: PlayedWord[] = s.lastBy === null ? [] : s.lastWords.map((w) => ({ word: w.word, by: s.lastBy, points: w.points }));
  return {
    game: "crisscross",
    seats: s.seats,
    me: seat,
    teams: false,
    phase: s.phase,
    turn: playing ? s.turn : null,
    boards: [{ id: "board", label: "The board", cols: SIZE, rows }],
    rack: null,
    hand: [...s.racks[seat]!],
    values: CRISS_VALUES,
    keys: {},
    entry: null,
    pick: null,
    place: mine ? { type: "place", prompt: empty(s.board) ? "Play a word through the middle square" : "Your turn: put tiles down", board: "board" } : null,
    words,
    choices: mine
      ? {
          prompt: "",
          options: [
            ...(s.bag.length >= s.rules.rack ? [{ label: "Swap my tiles", move: { type: "swap" }, confirm: "Swap all your tiles for new ones? It costs you this turn." }] : []),
            { label: "Pass", move: { type: "pass" }, confirm: "Pass this turn?" },
          ],
        }
      : null,
    players: s.racks.map((rack, i) => ({ line: `${rack.length} tiles`, badge: playing && s.turn === i ? "Playing" : undefined })),
    info: [`${s.bag.length} ${s.bag.length === 1 ? "tile" : "tiles"} in the bag`],
    narration: s.narration,
    scores: s.points.map((value, i) => ({ seats: [i], value })),
    result: null,
    over: s.phase === "finished" ? { winners: s.winners ?? [], title: s.seats === 1 ? `${s.points[0]} points` : s.winners!.length === s.seats ? "All square" : `${s.winners!.map(who).join(" and ")} ${s.winners!.length === 1 ? "wins" : "win"}` } : null,
  };
}

// ---- A computer player --------------------------------------------------------------------------
// Every place a word can go: each row and each column, each stretch of 2 to 8 squares that stands
// clear at both ends, joins what is there, and has a few empty squares to fill. Then every word of
// that length it knows that fits the letters already there, the tiles in its rack, and the words
// each new tile would make across the other way.

const LETTERS = "abcdefghijklmnopqrstuvwxyz";
const maskOf = (word: string) => {
  let m = 0;
  for (const letter of word) m |= 1 << (letter.charCodeAt(0) - 97);
  return m;
};
const masks = new Map<string, Int32Array>();
function masked(words: readonly string[], key: string): Int32Array {
  const had = masks.get(key);
  if (had) return had;
  const out = Int32Array.from(words, maskOf);
  masks.set(key, out);
  return out;
}

interface Found {
  tiles: PlacedTile[];
  total: number;
  length: number;
}

export function crissMoves(board: string[][], rack: readonly string[], vocabulary: (length: number) => readonly string[], rules: CrissRules = crissClassic, enough = Infinity): Found[] {
  const out: Found[] = [];
  const first = empty(board);
  const counts: Record<string, number> = {};
  for (const letter of rack) counts[letter] = (counts[letter] ?? 0) + 1;
  // The letters an empty square may take, from the word it would make the other way.
  const crossCache = new Map<string, string | null>();
  const crossAt = (r: number, c: number, horizontal: boolean): string | null => {
    const key = `${r},${c},${horizontal}`;
    if (crossCache.has(key)) return crossCache.get(key)!;
    const [dr, dc] = horizontal ? [1, 0] : [0, 1];
    let before = "";
    for (let rr = r - dr, cc = c - dc; has(board, rr, cc); rr -= dr, cc -= dc) before = board[rr]![cc]! + before;
    let after = "";
    for (let rr = r + dr, cc = c + dc; has(board, rr, cc); rr += dr, cc += dc) after += board[rr]![cc]!;
    const allowed = !before && !after ? null : [...LETTERS].filter((x) => before.length + after.length + 1 <= WORD_LENGTHS.max && isWord(before + x + after)).join("");
    crossCache.set(key, allowed);
    return allowed;
  };
  const rackMask = maskOf(rack.join(""));
  for (const horizontal of [true, false]) {
    for (let line = 0; line < SIZE; line++) {
      const at = (i: number) => (horizontal ? board[line]![i]! : board[i]![line]!);
      const square = (i: number) => (horizontal ? [line, i] : [i, line]) as [number, number];
      for (let start = 0; start < SIZE; start++) {
        if (start > 0 && at(start - 1)) continue;
        for (let length = 2; length <= WORD_LENGTHS.max && start + length <= SIZE; length++) {
          const end = start + length - 1;
          if (end + 1 < SIZE && at(end + 1)) continue;
          let blanks = 0;
          let joined = false;
          let fixedMask = 0;
          for (let i = start; i <= end; i++) {
            const letter = at(i);
            if (letter) {
              joined = true;
              fixedMask |= 1 << (letter.charCodeAt(0) - 97);
            } else {
              blanks += 1;
              const [r, c] = square(i);
              if (crossAt(r, c, horizontal) !== null) joined = true;
            }
          }
          if (!blanks || blanks > rack.length) continue;
          if (first ? !(line === MID && start <= MID && end >= MID) : !joined) continue;
          const words = vocabulary(length);
          const wordMasks = masked(words, `${length}/${words.length}/${words[0] ?? ""}`);
          const avail = rackMask | fixedMask;
          for (let w = 0; w < words.length; w++) {
            if (wordMasks[w]! & ~avail) continue;
            const word = words[w]!;
            const need: Record<string, number> = {};
            const tiles: PlacedTile[] = [];
            let fits = true;
            for (let i = 0; i < length && fits; i++) {
              const there = at(start + i);
              const letter = word[i]!;
              if (there) fits = there === letter;
              else {
                need[letter] = (need[letter] ?? 0) + 1;
                if (need[letter]! > (counts[letter] ?? 0)) fits = false;
                const [r, c] = square(start + i);
                const cross = crossAt(r, c, horizontal);
                if (cross !== null && !cross.includes(letter)) fits = false;
                tiles.push({ row: r, col: c, letter });
              }
            }
            if (!fits) continue;
            try {
              const { total } = judge(board, tiles, rules);
              out.push({ tiles, total, length });
              if (out.length >= enough) return out;
            } catch {
              // A word the long way that the list doesn't run to: not a move.
            }
          }
        }
      }
    }
  }
  return out;
}

function bot(s: CrissState, seat: number, style: PlayStyle, rand: () => number = Math.random, budget?: ThinkBudget): CrissMove | null {
  if (s.phase !== "playing" || s.turn !== seat) return null;
  const skill = Math.min(1, Math.max(0, style.skill ?? 1));
  const hurried = budget !== undefined && budget.ms <= 10;
  // A sharp player knows the common words; a poorer one, the plain ones.
  const vocabulary = skill >= 0.5 ? commonWords : plainWords;
  const moves = crissMoves(s.board, s.racks[seat]!, vocabulary, s.rules, hurried ? 1 : Infinity);
  if (!moves.length) return s.bag.length >= s.rules.rack ? { type: "swap" } : { type: "pass" };
  moves.sort((a, b) => b.total - a.total);
  // The best move, or for a weaker or careless player one of the better few.
  const pool = careless(style, rand) ? moves : moves.slice(0, Math.max(1, Math.round(1 + (1 - skill) * 12)));
  return { type: "place", tiles: pool[Math.floor(rand() * pool.length)]!.tiles };
}

function normalize(rules: unknown): CrissRules {
  const given = (rules && typeof rules === "object" ? rules : {}) as Partial<CrissRules>;
  const base = PRESETS.find((p) => p.id === given.id) ?? crissClassic;
  return { id: base.id, name: base.name, rack: RACK, bonus: [0, 25, ALL_SEVEN, 50].includes(Number(given.bonus)) ? Number(given.bonus) : base.bonus };
}

const FIELDS: RuleField<CrissRules>[] = [{ key: "bonus", label: "All seven tiles", hint: "Points for using all your tiles in one turn.", kind: "choice", options: [0, 25, ALL_SEVEN, 50].map((n) => [String(n), n ? `+${n}` : "Nothing"]) }];

export const crissCross: WordGame<CrissRules, CrissState, CrissMove> = {
  id: "crisscross",
  name: "Criss-Crosswords",
  emoji: "🧩",
  category: "words",
  blurb: "Build crossing words from your tiles on one board",
  tagline: "Seven tiles, one board, and every word has to cross.",
  seats: { min: 2, max: 4, default: 2 },
  teams: false,
  presets: PRESETS,
  fields: FIELDS,
  normalize,
  validate: () => [],
  describe(r) {
    return [
      `Everyone holds ${RACK} letter tiles from a bag of ${Object.values(COUNTS).reduce((a, b) => a + b, 0)}. On your turn, put some of them in one row or one column, joined to the tiles on the board. The first word goes through the middle square.`,
      "Every run of letters your tiles touch, across and down, has to be a word. Words are checked as they're played, up to 8 letters long.",
      "A word scores its letters' values. Pale squares double a letter, deep ones triple it; the word squares double or triple the whole word, the middle square too.",
      `${r.bonus ? `Using all ${RACK} tiles in one turn scores ${r.bonus} more. ` : ""}You may pass, or swap all your tiles while the bag has ${RACK} or more.`,
      `The game ends when someone uses their last tile with the bag empty, or after ${STALL} turns in a row without a score. Tiles left in a rack come off its owner's score, and go to whoever went out.`,
    ];
  },
  newGame: newCriss,
  apply,
  view,
  bot,
  heavy: (s, seat) => s.phase === "playing" && s.turn === seat,
  thinkingTime: () => thinkFor(12, 1.6),
  summary(s) {
    const over = s.phase === "finished";
    return {
      game: "crisscross",
      rules: s.rules.name,
      phase: s.phase,
      over,
      hand: 1,
      scoreLine: s.points.join(" · "),
      order: over ? rankSeats(s.points.map((score, seat) => ({ seats: [seat], score }))) : null,
      winners: over ? (s.winners ?? []) : null,
      teams: false,
      seats: s.seats,
    };
  },
};
