// The words the word games play with: what counts as a word, and which words are common enough to
// ask someone to guess. The data (worddata.ts) is written by scripts/build-words.mjs from the
// ENABLE word list and SCOWL's frequency levels; packages/games/words/README.md says where those
// come from. Everything here is a pure function of that data, so a game that uses it stays
// deterministic: the same seed picks the same word on every machine.
import { COMMON, PLAIN, WORDS } from "./worddata.js";

/** The shortest and longest words there are. */
export const WORD_LENGTHS = { min: 2, max: 8 } as const;

/** A word as the games keep it: lower case, letters only. Anything else comes back as "". */
export function tidyWord(text: unknown): string {
  const word = String(text ?? "").trim().toLowerCase();
  return /^[a-z]+$/.test(word) ? word : "";
}

/** Whether this is a word (of 2 to 8 letters). */
export function isWord(text: string): boolean {
  const word = tidyWord(text);
  const all = WORDS[word.length];
  if (!all) return false;
  // The words of one length lie end to end in order: a binary search over them.
  const n = word.length;
  let low = 0;
  let high = all.length / n - 1;
  while (low <= high) {
    const mid = (low + high) >> 1;
    const at = all.slice(mid * n, mid * n + n);
    if (at === word) return true;
    if (at < word) low = mid + 1;
    else high = mid - 1;
  }
  return false;
}

const lists = new Map<string, readonly string[]>();
function listed(kind: "all" | "common" | "plain", length: number): readonly string[] {
  const key = `${kind}/${length}`;
  const had = lists.get(key);
  if (had) return had;
  const all = WORDS[length] ?? "";
  const words: string[] = [];
  const marks = kind === "all" ? null : atob((kind === "common" ? COMMON : PLAIN)[length] ?? "");
  for (let i = 0; i * length < all.length; i++) {
    if (marks && !((marks.charCodeAt(i >> 3) >> (i & 7)) & 1)) continue;
    words.push(all.slice(i * length, i * length + length));
  }
  lists.set(key, words);
  return words;
}

/** Every word of a length, in order. */
export const wordsOfLength = (length: number) => listed("all", length);
/** The words of a length that most people know: a computer player's vocabulary. */
export const commonWords = (length: number) => listed("common", length);
/** The words of a length that everyone knows: the ones a player may be asked to guess. */
export const plainWords = (length: number) => listed("plain", length);
/** Whether most people know this word. */
export const isCommonWord = (word: string) => commonWords(word.length).includes(word);

/** How many of each letter a word has: "llama" is { l: 2, a: 2, m: 1 }. */
export function letterCounts(word: string): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const letter of word) counts[letter] = (counts[letter] ?? 0) + 1;
  return counts;
}

/** Whether a word can be spelt from a pool of letters, using each no more often than it is there. */
export function speltFrom(word: string, pool: readonly string[] | string): boolean {
  const have = letterCounts(typeof pool === "string" ? pool : pool.join(""));
  for (const [letter, n] of Object.entries(letterCounts(word))) if ((have[letter] ?? 0) < n) return false;
  return true;
}
