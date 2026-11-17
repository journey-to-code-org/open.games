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
}

/** Rows of tiles, all `cols` wide: a board of guesses, a word being uncovered. */
export interface WordBoard {
  id: string;
  /** For screen readers, and shown above the board when there are several: "Your guesses". */
  label: string;
  /** A private board: whose it is. It is only ever sent to that seat. Left out for one everyone sees. */
  owner?: number;
  cols: number;
  rows: WordTile[][];
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

export interface WordView {
  game: WordGameId;
  seats: number;
  me: number;
  teams: false;
  phase: string;
  /** Whose go it is, or null when everyone plays at once or nobody may. */
  turn: number | null;
  boards: WordBoard[];
  /** Letters to make words from, in the order they are shown. None for a game without a rack. */
  rack: string[] | null;
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

/** Everything a seat can send from a view that can be listed: every letter it may pick, every button. (A typed word can't be: see `entryAllows`.) */
export function wordMovesOffered(view: WordView): Record<string, unknown>[] {
  return [...(view.pick?.letters ?? []).map((letter) => ({ type: view.pick!.type, letter })), ...(view.choices?.options ?? []).map((o) => o.move)];
}
