// The three word games' own rules. The shared word tests (word.test.ts) play whole games of each.
import { describe, expect, it } from "vitest";
import { GameError, anagrams, anagramsSeven, hangman, hangmanClassic, isWord, newAnagrams, newHangman, newSecretWord, plainWords, secretFive, secretThree, secretWord, speltFrom, type AnagramsState, type HangmanState, type SecretWordState, type WordView } from "../src/index.js";

/**
 * Whether a view gives the word away: it is spelt out in the letters the view carries (its tiles
 * row by row, its rack, the words it shows, the keys it colours). Not in its sentences or its
 * labels: "Guess the word" doesn't give away GUESS.
 */
const gives = (view: WordView, word: string) =>
  [...view.boards.flatMap((b) => b.rows.map((row) => row.map((t) => t.letter).join(""))), ...view.words.map((w) => w.word), (view.rack ?? []).join(""), ...(view.result?.rows.flatMap((r) => r.values) ?? [])].some((text) => text.toLowerCase().includes(word));

describe("Secret Word", () => {
  const start = (seats = 2, rules = secretFive): SecretWordState => ({ ...newSecretWord(rules, seats, 3), secret: "crane" });
  const guess = (s: SecretWordState, seat: number, word: string) => secretWord.apply(s, seat, { type: "guess", word });

  it("picks a word everyone knows, and keeps it out of every view until the round is over", () => {
    for (let seed = 1; seed <= 40; seed++) {
      const s = newSecretWord(secretFive, 3, seed);
      expect(plainWords(5)).toContain(s.secret);
      for (let seat = 0; seat < 3; seat++) expect(gives(secretWord.view(s, seat), s.secret)).toBe(false);
    }
    let s = start();
    s = guess(s, 0, "trace");
    // Seat 1 sees how seat 0's guess went, and none of its letters.
    const theirs = secretWord.view(s, 1);
    expect(theirs.players[0]!.marks).toEqual([["miss", "hit", "hit", "near", "hit"]]);
    expect(gives(theirs, "trace")).toBe(false);
    expect(gives(theirs, "crane")).toBe(false);
    expect(theirs.boards[0]!.rows.flat().every((tile) => tile.letter === "")).toBe(true);
    expect(theirs.keys).toEqual({});
  });

  it("marks each guess, colours the keys, and counts the tries", () => {
    let s = start(1);
    s = guess(s, 0, "TRACE");
    const v = secretWord.view(s, 0);
    expect(v.boards[0]!.rows[0]).toEqual([
      { letter: "t", tone: "miss" },
      { letter: "r", tone: "hit" },
      { letter: "a", tone: "hit" },
      { letter: "c", tone: "near" },
      { letter: "e", tone: "hit" },
    ]);
    expect(v.boards[0]!.rows).toHaveLength(6);
    expect(v.keys).toEqual({ t: "miss", r: "hit", a: "hit", c: "near", e: "hit" });
    expect(v.entry).toEqual({ type: "guess", prompt: "5 guesses left", min: 5, max: 5 });
    expect(v.players[0]!.line).toBe("1 of 6");
  });

  it("takes only words, of the right length, once each", () => {
    const s = start(1);
    expect(() => guess(s, 0, "cran")).toThrow(/5 letters/);
    expect(() => guess(s, 0, "cranes")).toThrow(/5 letters/);
    expect(() => guess(s, 0, "qqqqq")).toThrow(/isn't a word/);
    const once = guess(s, 0, "trace");
    expect(() => guess(once, 0, "trace")).toThrow(/tried/);
    // An odd word is still a word: it may be guessed, though it would never be the answer.
    expect(isWord("xylyl")).toBe(true);
    expect(guess(s, 0, "xylyl").guesses[0]).toEqual(["xylyl"]);
  });

  it("scores a point for the word and one for every try left, and waits for everyone", () => {
    let s = start(2);
    s = guess(s, 0, "trace");
    s = guess(s, 0, "crane");
    expect(s.phase).toBe("playing");
    expect(s.narration).toContain("has it, in 2");
    expect(secretWord.view(s, 0).entry).toBeNull();
    expect(() => guess(s, 0, "blunt")).toThrow(/got it already/);
    // The other player runs out.
    for (const word of ["blunt", "sound", "might", "pious", "level"]) s = guess(s, 1, word);
    expect(s.phase).toBe("playing");
    s = guess(s, 1, "jumpy");
    expect(s.phase).toBe("finished");
    expect(s.points).toEqual([5, 0]);
    expect(s.winners).toEqual([0]);
    const v = secretWord.view(s, 1);
    expect(v.words).toEqual([{ word: "crane", by: null, note: "The word" }]);
    expect(v.result!.title).toBe("The word was CRANE");
    expect(v.over!.title).toContain("wins");
  });

  it("plays several words, each a new one, when the house says", () => {
    let s: SecretWordState = { ...newSecretWord(secretThree, 1, 3), secret: "crane" };
    s = guess(s, 0, "crane");
    expect(s.phase).toBe("round");
    expect(secretWord.view(s, 0).choices!.options[0]!.label).toBe("Next word");
    expect(() => guess(s, 0, "trace")).toThrow(/finished/);
    s = secretWord.apply(s, 0, { type: "next" });
    expect([s.phase, s.hand, s.guesses, s.points]).toEqual(["playing", 2, [[]], [6]]);
    expect(s.secret).not.toBe("crane");
  });
});

describe("Anagrams", () => {
  const start = (seats = 2): AnagramsState => ({ ...newAnagrams(anagramsSeven, seats, 3), rack: [..."eaprtns"], source: "parents" });
  const word = (s: AnagramsState, seat: number, w: string) => anagrams.apply(s, seat, { type: "word", word: w });

  it("deals the letters of a word everyone knows, shuffled, and never shows the word", () => {
    for (let seed = 1; seed <= 40; seed++) {
      const s = newAnagrams(anagramsSeven, 2, seed);
      expect(plainWords(7)).toContain(s.source);
      expect([...s.rack].sort()).toEqual([...s.source].sort());
      expect(s.rack.join("")).not.toBe(s.source);
      expect(gives(anagrams.view(s, 0), s.source)).toBe(false);
    }
  });

  it("takes a word spelt from the rack, and nothing else", () => {
    const s = start();
    expect(() => word(s, 0, "at")).toThrow(/at least 3/);
    expect(() => word(s, 0, "sparest")).toThrow(/can't be made/);
    expect(() => word(s, 0, "tests")).toThrow(/can't be made/);
    expect(() => word(s, 0, "nrstp")).toThrow(/isn't a word/);
    const in0 = word(s, 0, "Parent");
    expect(in0.entries).toEqual(["parent", null]);
    expect(() => word(in0, 0, "pants")).toThrow(/is in/);
  });

  it("keeps a word unseen until all are in, then turns them over and scores them", () => {
    let s = word(start(3), 0, "parents");
    // The others are told only that seat 0 is in.
    const theirs = anagrams.view(s, 1);
    expect(gives(theirs, "parents")).toBe(false);
    expect(theirs.players[0]!.line).toBe("Word in");
    expect(theirs.entry!.pool).toEqual([..."eaprtns"]);
    // Seat 0 still sees its own word, and has nothing more to do.
    const mine = anagrams.view(s, 0);
    expect(mine.words).toEqual([{ word: "parents", by: 0, note: "7 letters", points: 10 }]);
    expect([mine.entry, mine.choices]).toEqual([null, null]);
    s = word(s, 1, "pants");
    s = anagrams.apply(s, 2, { type: "pass" });
    expect(s.phase).toBe("round");
    // A point a letter, and three for the whole rack.
    expect(s.points).toEqual([10, 5, 0]);
    const v = anagrams.view(s, 2);
    expect(v.words.map((w) => [w.word, w.by, w.points])).toEqual([["parents", 0, 10], ["pants", 1, 5], ["parents", null, undefined]]);
    expect(v.result!.rows[0]!.values).toEqual(["PARENTS", "PANTS", "—"]);
    expect(v.players.map((p) => p.line)).toEqual(["PARENTS", "PANTS", "No word"]);
  });

  it("moves on when everyone is ready, to a new rack, and ends after the last round", () => {
    let s = start(1);
    for (let round = 1; round <= 5; round++) {
      expect(s.hand).toBe(round);
      const found = ["parents", "pants", "ants"].find((w) => speltFrom(w, s.rack) && isWord(w));
      s = found ? word(s, 0, found) : anagrams.apply(s, 0, { type: "pass" });
      if (round < 5) {
        expect(s.phase).toBe("round");
        const rack = s.rack.join("");
        s = anagrams.apply(s, 0, { type: "next" });
        expect(s.rack.join("")).not.toBe(rack);
        expect(s.entries).toEqual([null]);
      }
    }
    expect(s.phase).toBe("finished");
    expect(s.winners).toEqual([0]);
    expect(() => anagrams.apply(s, 0, { type: "next" })).toThrow(GameError);
  });
});

describe("Hangman", () => {
  const start = (seats = 2, rules = hangmanClassic): HangmanState => ({ ...newHangman(rules, seats, 3), secret: "banana" });
  const name = (s: HangmanState, seat: number, letter: string) => hangman.apply(s, seat, { type: "letter", letter });

  it("hides the word: only named letters are in a view", () => {
    for (let seed = 1; seed <= 40; seed++) {
      const s = newHangman(hangmanClassic, 2, seed);
      expect([5, 6]).toContain(s.secret.length);
      expect(gives(hangman.view(s, 0), s.secret)).toBe(false);
    }
    const s = name(start(), 0, "a");
    const v = hangman.view(s, 1);
    expect(v.boards[0]!.rows[0]).toEqual([{ letter: "", hidden: true }, { letter: "a", tone: "hit" }, { letter: "", hidden: true }, { letter: "a", tone: "hit" }, { letter: "", hidden: true }, { letter: "a", tone: "hit" }]);
    expect(gives(v, "banana")).toBe(false);
  });

  it("scores a point for each place a letter is turned over, and takes turns", () => {
    let s = start(3);
    expect(hangman.view(s, 0).pick!.letters).toHaveLength(26);
    expect(hangman.view(s, 1).pick).toBeNull();
    s = name(s, 0, "A");
    expect(s.points).toEqual([3, 0, 0]);
    expect(s.turn).toBe(1);
    expect(() => name(s, 0, "n")).toThrow(/not your turn/);
    expect(() => name(s, 1, "a")).toThrow(/named already/);
    expect(() => name(s, 1, "ab")).toThrow(/Name a letter/);
    s = name(s, 1, "z");
    expect(s.points).toEqual([3, 0, 0]);
    expect(hangman.view(s, 2).info[0]).toBe("5 misses left");
    expect(hangman.view(s, 2).keys).toEqual({ a: "hit", z: "miss" });
    expect(hangman.view(s, 2).pick!.letters).not.toContain("a");
  });

  it("is won by uncovering the word, and the next word starts with whoever was next", () => {
    let s = start(2);
    s = name(s, 0, "a");
    s = name(s, 1, "n");
    s = name(s, 0, "b");
    expect(s.phase).toBe("round");
    expect(s.solved).toBe(1);
    expect(s.points).toEqual([4, 2]);
    expect(hangman.view(s, 0).result!.title).toBe("BANANA: the table has it");
    expect(hangman.view(s, 0).words).toEqual([{ word: "banana", by: null, note: "The word" }]);
    s = hangman.apply(s, 0, { type: "next" });
    expect(() => hangman.apply(s, 0, { type: "next" })).toThrow(/Waiting/);
    s = hangman.apply(s, 1, { type: "next" });
    expect([s.phase, s.hand, s.turn, s.named]).toEqual(["playing", 2, 1, []]);
  });

  it("is lost when the misses run out, and the word is shown", () => {
    let s = start(1, { ...hangmanClassic, rounds: 1 });
    for (const letter of "zxqjkw") s = name(s, 0, letter);
    expect(s.phase).toBe("finished");
    expect(s.solved).toBe(0);
    const v = hangman.view(s, 0);
    expect(v.over!.title).toBe("The word won");
    // The letters nobody found are shown, marked as missed.
    expect(v.boards[0]!.rows[0]!.map((t) => `${t.letter}:${t.tone}`).join(" ")).toBe("b:miss a:miss n:miss a:miss n:miss a:miss");
    expect(v.pick).toBeNull();
  });
});
