// The word list: what counts as a word, and which words are common.
import { describe, expect, it } from "vitest";
import { commonWords, isCommonWord, isWord, letterCounts, plainWords, speltFrom, tidyWord, wordsOfLength } from "../src/index.js";

describe("the words", () => {
  it("knows a word from a not-word, whatever its case", () => {
    for (const word of ["aa", "cat", "Crane", "QUEEN", "zymurgy", "aardvark", "zyzzyvas"]) expect(isWord(word), word).toBe(true);
    for (const word of ["", "a", "xq", "catt", "qqqqq", "hello world", "né", "cat1", "aardvarks", "constructor", "__proto__"]) expect(isWord(word), word).toBe(false);
    expect(tidyWord("  Crane ")).toBe("crane");
    expect(tidyWord("it's")).toBe("");
    expect(tidyWord(null)).toBe("");
  });

  it("finds every word it lists, first and last included, and nothing between them", () => {
    for (let n = 2; n <= 8; n++) {
      const all = wordsOfLength(n);
      expect(all.length).toBeGreaterThan(50);
      expect([...all].sort()).toEqual(all);
      expect(new Set(all).size).toBe(all.length);
      for (const word of [all[0]!, all[all.length - 1]!, all[all.length >> 1]!, all[7]!]) expect(isWord(word), word).toBe(true);
      expect(all.every((w) => w.length === n)).toBe(true);
    }
    expect(wordsOfLength(9)).toEqual([]);
    // Every five-letter word is found, and its neighbours in the alphabet that aren't words aren't.
    const five = new Set(wordsOfLength(5));
    for (const word of five) expect(isWord(word)).toBe(true);
    for (const word of ["craen", "zzzzz", "aaaaa", "abcde"]) expect(isWord(word)).toBe(five.has(word));
  });

  it("marks the common words, and among them the ones to guess", () => {
    for (let n = 3; n <= 8; n++) {
      const [all, common, plain] = [wordsOfLength(n), commonWords(n), plainWords(n)];
      expect(plain.length).toBeGreaterThan(200);
      expect(common.length).toBeGreaterThan(plain.length);
      expect(all.length).toBeGreaterThan(common.length);
      const known = new Set(common);
      // A word to guess is a word a computer player knows, and both are words.
      expect(plain.every((w) => known.has(w))).toBe(true);
      expect(common.every(isWord)).toBe(true);
    }
    for (const word of ["house", "water", "table"]) expect(plainWords(5), word).toContain(word);
    expect(isCommonWord("house")).toBe(true);
    // A word nobody says is still a word, and never the answer.
    expect(isWord("xylyl")).toBe(true);
    expect(isCommonWord("xylyl")).toBe(false);
    // Nor is a word that has no place at a family table.
    for (const word of ["death", "idiot", "naked"]) {
      expect(isWord(word), word).toBe(true);
      expect(plainWords(5), word).not.toContain(word);
    }
  });

  it("counts letters, and says whether a word can be spelt from a rack", () => {
    expect(letterCounts("llama")).toEqual({ l: 2, a: 2, m: 1 });
    expect(speltFrom("tale", ["l", "a", "t", "e", "s"])).toBe(true);
    expect(speltFrom("tall", "lates")).toBe(false);
    expect(speltFrom("", "abc")).toBe(true);
  });
});
