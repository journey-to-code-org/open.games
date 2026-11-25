// The word kit: what one seat sees of any game played with letters and words, in one shared shape,
// the way KitView is for cards, BoardView for boards and SportView for table sports. One table
// screen draws every such game from it, and the same room on the server runs them.
//
// A word game differs from the other kits in one thing: a move can be a word that is typed, and
// there are too many of those to list. So a view says what may be typed (`entry`: how long, and
// from which letters if it has to come from a rack), the table lets anything of that shape be
// sent, and the engine says no, in words, to what isn't a word. Everything else a seat can do is
// listed, as it is everywhere: a letter to pick (`pick`), a button (`choices`).
//
// What is on the table is rows of letter tiles (`boards`: the guesses so far, the word being
// uncovered), a `rack` of letters to make words from, and the `words` that have been played.
// A tile's `tone` says what is known about its letter, and `keys` says the same for the whole
// alphabet, so a keyboard can be coloured to match.
import type { BaseRules, Choices, GameOver, RoundResult, Scores, TableGame, WordGameId } from "./table.js";

/** What is known about a letter: in the word and in its place, in the word somewhere else, or not in it. */
export type WordTone = "hit" | "near" | "miss";

/** One tile. `letter` is "" for an empty place, or for a letter that hasn't been shown yet (`hidden`). */
export interface WordTile {
  letter: string;
  tone?: WordTone;
  /** A letter there is, that this seat may not see yet. */
  hidden?: boolean;
  /** A square that is worth more (on a board tiles are played onto): double or triple the letter or the word, or the start. */
  bonus?: WordBonus;
  /** Played on the last turn: shown so everyone sees what changed. */
  fresh?: boolean;
}

export type WordBonus = "dl" | "tl" | "dw" | "tw" | "start";

/** Rows of tiles, all `cols` wide: a board of guesses, a word being uncovered. */
export interface WordBoard {
  id: string;
  /** For screen readers, and shown above the board when there are several: "Your guesses". */
  label: string;
  /** A private board: whose it is. It is only ever sent to that seat. Left out for one everyone sees. */
  owner?: number;
  cols: number;
  rows: WordTile[][];
  /**
   * A grid a word is traced on: from tile to touching tile, across, down or corner to corner, each
   * tile once. The table lets a player spell by dragging or tapping a path; what is sent is the word.
   */
  trace?: boolean;
}

/** Tiles may be put on a board now: a move is `{ type, tiles: [{ row, col, letter }] }`, the letters from `hand`. */
export interface WordPlace {
  type: string;
  prompt: string;
  /** The board they go on. */
  board: string;
}

/** A tile put on a board. */
export interface PlacedTile {
  row: number;
  col: number;
  letter: string;
}

/** A picture drawn on the table, a stroke at a time. Points run 0 to 1000 across and down, in pairs. */
export interface WordStroke {
  points: number[];
  /** An index into `CANVAS_COLORS`. */
  color: number;
  /** An index into `CANVAS_SIZES`. */
  size: number;
}

/** The pens a drawing is made with: black, then a box of colours, then white to rub out with. */
export const CANVAS_COLORS = ["#1d1a16", "#d23b2f", "#e9862a", "#e8c31f", "#3f9a52", "#2f6fd6", "#7b4bc4", "#8a5a2b", "#ffffff"] as const;
/** Pen widths, in thousandths of the canvas's width. */
export const CANVAS_SIZES = [6, 14, 32] as const;
/** The most points one stroke may have, and the most strokes one picture. */
export const STROKE_POINTS = 600;
export const CANVAS_STROKES = 300;

export interface WordCanvas {
  strokes: WordStroke[];
  /** This seat may draw: a stroke is sent as `{ type, stroke }`. */
  draw: { type: string; prompt: string } | null;
}

/** A word may be typed now: sending it is `{ type, word }`, in lower case. */
export interface WordEntry {
  type: string;
  /** "Guess the word", "Your best word". */
  prompt: string;
  /** How long it may be, in letters. */
  min: number;
  max: number;
  /** The letters it has to be spelt from, each used no more often than it is here (the rack). Left out: any letters. */
  pool?: string[];
}

/** One letter may be picked now: picking it sends `{ type, letter }`. */
export interface WordPick {
  type: string;
  prompt: string;
  letters: string[];
}

/** A word that has been played, for everyone to see. */
export interface PlayedWord {
  word: string;
  /** Who played it, or null for a word that is nobody's (the answer, shown at the end). */
  by: number | null;
  /** "7 letters", "not a word". */
  note?: string;
  /** What it scored. */
  points?: number;
}

export interface WordSeat {
  /** A short line under the name: "Solved in 4", "Thinking". */
  line: string;
  badge?: string;
  /** Finished with this round: solved it, out of tries, word handed in. */
  done?: boolean;
  /**
   * How this seat's guesses went, as everyone may see it: a row of tones per guess and no letters
   * (the coloured squares people show each other without giving the word away).
   */
  marks?: WordTone[][];
}

/**
 * A question put to everyone at once, answered with a control and not with letters: a slider, a
 * vote for one of the players, a row of either-ors, a few short answers, a line of words, or stars
 * for what the others wrote. A table draws the control `kind` asks for and sends
 * `{ type, ...answer }`: `value` for a slider, `pick` (a seat) for a vote, `flags` for either-ors,
 * `tags` for short answers, `text` for a line, `stars` for a rating of each item.
 */
export interface WordForm {
  type: string;
  kind: "scale" | "vote" | "either" | "three" | "caption" | "rate";
  prompt: string;
  /** A slider's ends, and what they mean. */
  min?: number;
  max?: number;
  low?: string;
  high?: string;
  /** Who can be voted for: seats. */
  seats?: number[];
  /** The either-ors: the two sides of each. */
  pairs?: [string, string][];
  /** How many short answers are wanted, and how long each, or a line of words, may be. */
  count?: number;
  length?: number;
  /** What is to be given stars: what the others wrote, without their names. */
  items?: string[];
}

/** How a question came out, for everyone to see: who said what, where the room was, and what it was worth. */
export interface WordRoom {
  kind: WordForm["kind"];
  prompt: string;
  /** In a word or two, where the room landed: "The room said 62". */
  headline: string;
  /** A bar for each answer given, or each side: what it was, how many gave it, and which seats. */
  bars: { label: string; value: number; seats: number[]; best?: boolean }[];
  /** What each seat gained for it. */
  gained: number[];
}

/**
 * A chain of a game of telephone, as it is turned over: who started it, and its steps so far, each
 * the words someone wrote or the drawing someone made of the step before.
 */
export interface WordChain {
  /** Whose words started it. */
  owner: number;
  /** Which chain it is, from 1, and of how many. */
  index: number;
  of: number;
  /** How many steps it has in all, shown or not. */
  length: number;
  steps: { by: number; text?: string; strokes?: WordStroke[] }[];
}

export interface WordView {
  game: WordGameId;
  seats: number;
  me: number;
  teams: false;
  phase: string;
  /** Whose go it is, or null when everyone plays at once or nobody may. */
  turn: number | null;
  boards: WordBoard[];
  /** Letters to make words from, in the order they are shown, the same for everyone. None for a game without a rack. */
  rack: string[] | null;
  /** This seat's own letters, which nobody else sees (a hand of tiles). */
  hand?: string[] | null;
  /** What each letter is worth, for a game that scores by letter. */
  values?: Record<string, number>;
  /** Tiles may be put on a board. */
  place?: WordPlace | null;
  /** A picture on the table (a drawing game). */
  canvas?: WordCanvas | null;
  /** What this seat knows about each letter it has tried. */
  keys: Record<string, WordTone>;
  entry: WordEntry | null;
  pick: WordPick | null;
  /** Words played and shown: this round's, once they are turned over. */
  words: PlayedWord[];
  /** Buttons: "No word", "Next round". */
  choices: Choices | null;
  players: WordSeat[];
  /** Small facts for the table: "Round 2 of 3", "4 misses left". */
  info: string[];
  /** The question on the table, for everyone to see, whether or not they have answered it. */
  question?: string | null;
  /** The question as this seat is to answer it, with a control. Null once it has. */
  form?: WordForm | null;
  /** How the last question came out. */
  room?: WordRoom | null;
  /** A chain being shown, in a game of passing things on (Pass the Picture): its steps so far, words and drawings in turn. */
  chain?: WordChain | null;
  /** What just happened, in words. */
  narration: string | null;
  scores: Scores;
  /** After a round, until everyone moves on. */
  result: RoundResult | null;
  /** `winners` is every seat when it's a tie. */
  over: GameOver | null;
}

/** A word game: an engine whose seats see a `WordView`. */
export interface WordGame<R extends BaseRules = BaseRules, S = unknown, M = Record<string, unknown>> extends TableGame<R, S, M, WordView> {
  id: WordGameId;
}

// ---- Helpers for engines, tables and tests ------------------------------------------------------

/**
 * How a guess compares with the word, tile by tile. A letter in its place is a hit; a letter that
 * is in the word elsewhere is near, but only as many times as the word has it to spare: guessing
 * "llama" at "label" marks the first l a hit, the second near, and the second a a miss.
 */
export function compareWords(guess: string, word: string): WordTone[] {
  const tones: WordTone[] = Array.from(guess, () => "miss");
  const spare: Record<string, number> = {};
  for (let i = 0; i < word.length; i++) {
    if (guess[i] === word[i]) tones[i] = "hit";
    else spare[word[i]!] = (spare[word[i]!] ?? 0) + 1;
  }
  for (let i = 0; i < guess.length; i++) {
    if (tones[i] === "hit" || !spare[guess[i]!]) continue;
    tones[i] = "near";
    spare[guess[i]!]! -= 1;
  }
  return tones;
}

const RANK: Record<WordTone, number> = { miss: 0, near: 1, hit: 2 };
/** What a run of guesses has shown about each letter: the best that was seen of it. */
export function keysFrom(guesses: readonly string[], word: string): Record<string, WordTone> {
  const keys: Record<string, WordTone> = {};
  for (const guess of guesses) {
    compareWords(guess, word).forEach((tone, i) => {
      const letter = guess[i]!;
      if (!keys[letter] || RANK[tone] > RANK[keys[letter]!]) keys[letter] = tone;
    });
  }
  return keys;
}

/**
 * Whether a view's `entry` allows this move: the right type, a word of lower-case letters, of a
 * length it allows and spelt from its rack. It doesn't say the engine will take it (that needs
 * the word list); it says the table would let it be sent.
 */
export function entryAllows(view: Pick<WordView, "entry">, move: unknown): boolean {
  const entry = view.entry;
  const m = move as { type?: unknown; word?: unknown } | null;
  if (!entry || !m || m.type !== entry.type || typeof m.word !== "string" || !/^[a-z]+$/.test(m.word)) return false;
  if (m.word.length < entry.min || m.word.length > entry.max) return false;
  if (!entry.pool) return true;
  const left = [...entry.pool];
  for (const letter of m.word) {
    const at = left.indexOf(letter);
    if (at < 0) return false;
    left.splice(at, 1);
  }
  return true;
}

/**
 * Whether a view's `place` allows this move: tiles from this seat's hand (each no more often than it
 * is there), on empty squares of the board, all in one row or one column, none twice. It doesn't
 * say the engine will take it: that needs the words they make.
 */
export function placeAllows(view: Pick<WordView, "place" | "hand" | "boards">, move: unknown): boolean {
  const place = view.place;
  const m = move as { type?: unknown; tiles?: unknown } | null;
  if (!place || !m || m.type !== place.type || !Array.isArray(m.tiles) || m.tiles.length === 0) return false;
  const board = view.boards.find((b) => b.id === place.board);
  if (!board) return false;
  const left = [...(view.hand ?? [])];
  const seen = new Set<string>();
  for (const t of m.tiles as PlacedTile[]) {
    if (!t || !Number.isInteger(t.row) || !Number.isInteger(t.col) || typeof t.letter !== "string") return false;
    const square = board.rows[t.row]?.[t.col];
    if (!square || square.letter || seen.has(`${t.row},${t.col}`)) return false;
    seen.add(`${t.row},${t.col}`);
    const at = left.indexOf(t.letter);
    if (at < 0) return false;
    left.splice(at, 1);
  }
  const tiles = m.tiles as PlacedTile[];
  return tiles.every((t) => t.row === tiles[0]!.row) || tiles.every((t) => t.col === tiles[0]!.col);
}

/** Whether a view's `canvas` lets this stroke be drawn: whole numbers 0 to 1000 in pairs, a pen and a width there are. */
export function strokeAllows(view: Pick<WordView, "canvas">, move: unknown): boolean {
  const draw = view.canvas?.draw;
  const m = move as { type?: unknown; stroke?: Partial<WordStroke> } | null;
  if (!draw || !m || m.type !== draw.type || !m.stroke) return false;
  const { points, color, size } = m.stroke;
  return (
    Array.isArray(points) &&
    points.length >= 2 &&
    points.length <= STROKE_POINTS * 2 &&
    points.length % 2 === 0 &&
    points.every((n) => Number.isInteger(n) && n >= 0 && n <= 1000) &&
    Number.isInteger(color) &&
    color! >= 0 &&
    color! < CANVAS_COLORS.length &&
    Number.isInteger(size) &&
    size! >= 0 &&
    size! < CANVAS_SIZES.length
  );
}

/** Whether a view's `form` allows this answer: the right type, and the right shape for the control it asks for. */
export function formAllows(view: Pick<WordView, "form">, move: unknown): boolean {
  const form = view.form;
  const m = move as Record<string, unknown> | null;
  if (!form || !m || m.type !== form.type) return false;
  const short = (text: unknown, most: number) => typeof text === "string" && text.trim().length > 0 && text.length <= most;
  if (form.kind === "scale") return Number.isInteger(m.value) && (m.value as number) >= form.min! && (m.value as number) <= form.max!;
  if (form.kind === "vote") return form.seats!.includes(m.pick as number);
  if (form.kind === "either") return Array.isArray(m.flags) && m.flags.length === form.pairs!.length && m.flags.every((f) => typeof f === "boolean");
  if (form.kind === "three") return Array.isArray(m.tags) && m.tags.length === form.count && m.tags.every((t) => short(t, form.length!));
  if (form.kind === "caption") return short(m.text, form.length!);
  return Array.isArray(m.stars) && m.stars.length === form.items!.length && m.stars.every((n) => Number.isInteger(n) && n >= 1 && n <= 5);
}

/** Whether a move is one a view offers in a form that can't be listed: a typed word, tiles on a board, a stroke, an answer to a question. */
export const freeformAllows = (view: WordView, move: unknown) => entryAllows(view, move) || placeAllows(view, move) || strokeAllows(view, move) || formAllows(view, move);

/** Everything a seat can send from a view that can be listed: every letter it may pick, every button. (A typed word can't be: see `entryAllows`.) */
export function wordMovesOffered(view: WordView): Record<string, unknown>[] {
  return [...(view.pick?.letters ?? []).map((letter) => ({ type: view.pick!.type, letter })), ...(view.choices?.options ?? []).map((o) => o.move)];
}
