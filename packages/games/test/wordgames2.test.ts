// Word Hunt, Criss-Crosswords and Draw & Guess: their own rules. The shared word tests
// (word.test.ts) play whole games of each with computer players.
import { describe, expect, it } from "vitest";
import {
  CANVAS_COLORS,
  CRISS_BONUS,
  CRISS_VALUES,
  DRAW_PROMPTS,
  GameError,
  crissClassic,
  crissCross,
  crissMoves,
  drawGuess,
  drawClassic,
  drawRelaxed,
  huntClassic,
  huntRelaxed,
  isWord,
  judge,
  newCriss,
  newDrawGuess,
  newWordHunt,
  placeAllows,
  commonWords,
  traceable,
  wordHunt,
  wordsIn,
  type CrissState,
  type DrawGuessState,
  type WordHuntState,
} from "../src/index.js";

// ---- Word Hunt ----------------------------------------------------------------------------------

describe("Word Hunt", () => {
  // c a t s
  // o r e x
  // l d n p
  // e i g h
  const GRID = "catsorexldnpeigh";
  const start = (seats = 2, rules = huntClassic): WordHuntState => ({ ...newWordHunt(rules, seats, 3), grid: GRID });
  const word = (s: WordHuntState, seat: number, w: string, elapsed = 1000) => wordHunt.apply(s, seat, { type: "word", word: w }, { elapsed });

  it("traces a word from letter to touching letter, each once", () => {
    expect(traceable(GRID, "cat")).toBe(true);
    expect(traceable(GRID, "care")).toBe(true); // c a r e: down and back across
    expect(traceable(GRID, "cold")).toBe(true);
    expect(traceable(GRID, "cats")).toBe(true);
    expect(traceable(GRID, "tact")).toBe(false); // one C, used twice
    expect(traceable(GRID, "cap")).toBe(false); // a and p don't touch
    expect(wordsIn(GRID)).toContain("cart");
    expect(wordsIn(GRID).every((w) => traceable(GRID, w) && w.length >= 3)).toBe(true);
  });

  it("deals a square with plenty of words in it, the same one for the same seed", () => {
    for (let seed = 1; seed <= 20; seed++) {
      const s = newWordHunt(huntClassic, 2, seed);
      expect(s.grid).toMatch(/^[a-z]{16}$/);
      expect(s.grid).not.toContain("q");
      expect(wordsIn(s.grid).length).toBeGreaterThanOrEqual(25);
      expect(newWordHunt(huntClassic, 2, seed).grid).toBe(s.grid);
    }
  });

  it("takes a word that is in the square and in the list, once, and keeps it from the others", () => {
    let s = start();
    expect(() => word(s, 0, "ca")).toThrow(/at least 3/);
    expect(() => word(s, 0, "cap")).toThrow(/can't be traced/);
    expect(() => word(s, 0, "cxp")).toThrow(/can't be traced/);
    expect(() => word(s, 0, "ldn")).toThrow(/isn't a word/);
    s = word(s, 0, "CART");
    expect(() => word(s, 0, "cart")).toThrow(/already/);
    expect(wordHunt.view(s, 0).words).toEqual([{ word: "cart", by: 0, points: 2 }]);
    // Seat 1 sees nothing of it: not the word, not how many.
    const theirs = wordHunt.view(s, 1);
    expect(theirs.words).toEqual([]);
    expect(theirs.players[0]!.line).toBe("Hunting");
    expect(JSON.stringify(theirs)).not.toContain("cart");
  });

  it("reads the words out when everyone is done, and a word two found scores nothing", () => {
    let s = start();
    s = word(s, 0, "cart");
    s = word(s, 0, "cold");
    s = word(s, 1, "cart");
    s = wordHunt.apply(s, 0, { type: "done" }, { elapsed: 0 });
    expect(s.phase).toBe("playing");
    expect(wordHunt.view(s, 0).entry).toBeNull();
    s = wordHunt.apply(s, 1, { type: "done" }, { elapsed: 0 });
    expect(s.phase).toBe("finished");
    // CART cancels; COLD is 4 letters: 2.
    expect(s.points).toEqual([2, 0]);
    const v = wordHunt.view(s, 1);
    expect(v.words.filter((w) => w.by !== null).map((w) => [w.word, w.by, w.points])).toEqual([["cart", 0, 0], ["cold", 0, 2], ["cart", 1, 0]]);
    expect(v.words.filter((w) => w.by === null).length).toBeGreaterThan(0);
    expect(v.words.find((w) => w.by === 0 && w.word === "cart")!.note).toContain("{1}");
  });

  it("ends the round when the time has gone, whoever is still hunting", () => {
    let s = start();
    expect(wordHunt.deadline!(s)).toEqual({ seat: 0, after: 180_000, move: { type: "done" }, strict: true });
    s = word(s, 0, "cart", 100_000);
    expect(wordHunt.deadline!(s)!.after).toBe(80_000);
    s = word(s, 1, "cold", 81_000);
    expect(s.phase).toBe("finished");
    expect(s.points).toEqual([2, 2]);
    // With no clock there is no deadline.
    expect(wordHunt.deadline!(start(2, huntRelaxed))).toBeNull();
  });
});

// ---- Criss-Crosswords ---------------------------------------------------------------------------

describe("Criss-Crosswords", () => {
  const blank = () => Array.from({ length: 15 }, () => Array<string>(15).fill(""));
  const across = (row: number, col: number, word: string) => [...word].map((letter, i) => ({ row, col: col + i, letter }));
  const down = (row: number, col: number, word: string) => [...word].map((letter, i) => ({ row: row + i, col, letter }));
  const withRack = (s: CrissState, seat: number, letters: string): CrissState => ({ ...s, racks: s.racks.map((r, i) => (i === seat ? [...letters] : r)) });

  it("has a board of its own, symmetric every way, with the start in the middle", () => {
    expect(CRISS_BONUS[7]![7]).toBe("start");
    for (let r = 0; r < 15; r++) for (let c = 0; c < 15; c++) {
      expect(CRISS_BONUS[r]![c]).toBe(CRISS_BONUS[c]![r]);
      expect(CRISS_BONUS[r]![c]).toBe(CRISS_BONUS[14 - r]![c]);
    }
    const s = newCriss(crissClassic, 2, 1);
    expect(s.racks.map((r) => r.length)).toEqual([7, 7]);
    expect(s.bag.length + 14).toBe(102);
    // A hand is its owner's alone.
    expect(crissCross.view(s, 0).hand).toEqual(s.racks[0]);
    expect(JSON.stringify(crissCross.view(s, 1))).not.toContain(JSON.stringify(s.racks[0]));
  });

  it("wants the first word through the middle, and every word after it joined and in the list", () => {
    expect(() => judge(blank(), across(0, 0, "cat"))).toThrow(/middle/);
    expect(() => judge(blank(), across(7, 7, "a"))).toThrow(/two letters/);
    // C on the start (double word): (3 + 1 + 1) × 2.
    expect(judge(blank(), across(7, 7, "cat"))).toEqual({ words: [{ word: "cat", points: 10 }], total: 10 });
    const b = blank();
    for (const t of across(7, 7, "cat")) b[t.row]![t.col] = t.letter;
    expect(() => judge(b, across(1, 1, "dog"))).toThrow(/join up/);
    expect(() => judge(b, [{ row: 8, col: 7, letter: "x" }, { row: 8, col: 9, letter: "x" }])).toThrow(/no gaps/);
    expect(() => judge(b, [{ row: 8, col: 7, letter: "x" }, { row: 9, col: 8, letter: "x" }])).toThrow(/one row/);
    expect(() => judge(b, across(7, 7, "s"))).toThrow(/already/);
    // CATS: the S joins on the end, and only the new tile's square counts double or triple.
    expect(judge(b, [{ row: 7, col: 10, letter: "s" }])).toEqual({ words: [{ word: "cats", points: 6 }], total: 6 });
    // A tile under the A that makes AX down and nothing across, on a double-letter square: 1 + 8 × 2.
    expect(CRISS_BONUS[8]![8]).toBe("dl");
    expect(judge(b, [{ row: 8, col: 8, letter: "x" }]).words).toEqual([{ word: "ax", points: 17 }]);
    // One that doesn't make a word.
    expect(() => judge(b, [{ row: 8, col: 8, letter: "q" }])).toThrow(/AQ isn't a word/);
  });

  it("scores all seven tiles with the bonus, and refills the rack from the bag", () => {
    let s = withRack(newCriss(crissClassic, 2, 1), 0, "retains");
    const bag = s.bag.length;
    s = crissCross.apply(s, 0, { type: "place", tiles: across(7, 4, "retains") });
    expect(s.points[0]).toBeGreaterThan(crissClassic.bonus);
    expect(s.narration).toContain("+40");
    expect(s.racks[0]).toHaveLength(7);
    expect(s.bag.length).toBe(bag - 7);
    expect(s.turn).toBe(1);
    const v = crissCross.view(s, 1);
    expect(v.boards[0]!.rows[7]!.slice(4, 11).every((t) => t.fresh)).toBe(true);
    expect(v.words[0]).toMatchObject({ word: "retains", by: 0 });
  });

  it("won't play a tile you haven't got, and lets a view's placement through only from the hand", () => {
    const s = withRack(newCriss(crissClassic, 2, 1), 0, "catxyzq");
    expect(() => crissCross.apply(s, 0, { type: "place", tiles: across(7, 7, "cats") })).toThrow(/haven't a S/);
    expect(() => crissCross.apply(s, 1, { type: "place", tiles: across(7, 7, "cat") })).toThrow(/not your turn/);
    const v = crissCross.view(s, 0);
    expect(placeAllows(v, { type: "place", tiles: across(7, 7, "cat") })).toBe(true);
    expect(placeAllows(v, { type: "place", tiles: across(7, 7, "cats") })).toBe(false);
    expect(placeAllows(v, { type: "place", tiles: [{ row: 7, col: 7, letter: "c" }, { row: 8, col: 8, letter: "a" }] })).toBe(false);
  });

  it("finds the computer player's moves, all of them legal", () => {
    const b = blank();
    for (const t of across(7, 6, "house")) b[t.row]![t.col] = t.letter;
    const moves = crissMoves(b, [..."tradeil"], (n) => commonWords(n));
    expect(moves.length).toBeGreaterThan(20);
    for (const m of moves.slice(0, 200)) expect(judge(b, m.tiles).total).toBe(m.total);
    const opening = crissMoves(blank(), [..."tradeil"], (n) => commonWords(n));
    expect(opening.every((m) => m.tiles.some((t) => t.row === 7 && t.col === 7))).toBe(true);
  });

  it("ends when someone goes out: the others' tiles come off their scores and go to them", () => {
    let s = withRack({ ...newCriss(crissClassic, 2, 1), bag: [] }, 0, "at");
    s = withRack(s, 1, "zq");
    s = crissCross.apply(s, 0, { type: "place", tiles: across(7, 7, "at") });
    expect(s.phase).toBe("finished");
    // AT on the start: (1 + 1) × 2 = 4, then Z and Q: 20 from seat 1, to seat 0.
    expect(s.points).toEqual([24, -20]);
    expect(s.winners).toEqual([0]);
  });

  it("ends after six scoreless turns in a row, and swaps only while the bag can", () => {
    let s = newCriss(crissClassic, 2, 1);
    for (let i = 0; i < 5; i++) s = crissCross.apply(s, s.turn, { type: "pass" });
    expect(s.phase).toBe("playing");
    s = crissCross.apply(s, s.turn, { type: "swap" });
    expect(s.phase).toBe("finished");
    const low = { ...newCriss(crissClassic, 2, 1), bag: ["a", "b"] };
    expect(() => crissCross.apply(low, 0, { type: "swap" })).toThrow(/aren't enough/);
    expect(crissCross.view(low, 0).choices!.options.map((o) => o.label)).toEqual(["Pass"]);
    expect(Object.keys(CRISS_VALUES)).toHaveLength(26);
  });
});

// ---- Draw & Guess -------------------------------------------------------------------------------

describe("Draw & Guess", () => {
  const LINE = { points: [100, 100, 900, 900], color: 0, size: 1 };
  const chosen = (seats = 3, rules = drawClassic): DrawGuessState => drawGuess.apply({ ...newDrawGuess(rules, seats, 1), offer: ["apple", "house", "snail"] }, 0, { type: "choose", index: 1 });

  it("offers the artist three things to draw, and nobody else sees them", () => {
    const s = newDrawGuess(drawClassic, 3, 1);
    expect(s.offer).toHaveLength(3);
    expect(new Set(s.offer).size).toBe(3);
    expect(drawGuess.view(s, 0).choices!.options.map((o) => o.label)).toEqual(s.offer);
    for (const seat of [1, 2]) {
      const v = drawGuess.view(s, seat);
      expect(v.choices).toBeNull();
      for (const word of s.offer) expect(JSON.stringify(v)).not.toContain(`"${word}"`);
    }
    expect(DRAW_PROMPTS.every((w) => /^[a-z]+$/.test(w))).toBe(true);
    expect(drawGuess.practice).toBe(false);
  });

  it("lets only the artist draw, and shows everyone the drawing and how long the word is", () => {
    let s = chosen();
    expect(() => drawGuess.apply(s, 1, { type: "stroke", stroke: LINE })).toThrow(/Only the artist/);
    expect(() => drawGuess.apply(s, 0, { type: "stroke", stroke: { ...LINE, points: [1, 2, 3] } })).toThrow(/line/);
    expect(() => drawGuess.apply(s, 0, { type: "stroke", stroke: { ...LINE, color: CANVAS_COLORS.length } })).toThrow(/pens/);
    s = drawGuess.apply(s, 0, { type: "stroke", stroke: LINE });
    const theirs = drawGuess.view(s, 1);
    expect(theirs.canvas!.strokes).toEqual([LINE]);
    expect(theirs.canvas!.draw).toBeNull();
    expect(theirs.boards[0]!.rows[0]).toEqual(Array(5).fill({ letter: "", hidden: true }));
    expect(JSON.stringify(theirs)).not.toContain("house");
    const mine = drawGuess.view(s, 0);
    expect(mine.boards[0]!.rows[0]!.map((t) => t.letter).join("")).toBe("house");
    expect(mine.canvas!.draw).not.toBeNull();
    expect(mine.entry).toBeNull();
    s = drawGuess.apply(s, 0, { type: "undo" });
    expect(s.strokes).toEqual([]);
  });

  it("scores the guessers by how soon they got it, and the artist for each of them", () => {
    let s = chosen(4);
    s = drawGuess.apply(s, 1, { type: "guess", word: "tent" });
    expect(drawGuess.view(s, 2).words).toEqual([{ word: "tent", by: 1, note: "no" }]);
    s = drawGuess.apply(s, 2, { type: "guess", word: "House" });
    // Seat 2 sees the word now; seat 1 still doesn't.
    expect(drawGuess.view(s, 2).boards[0]!.rows[0]!.map((t) => t.letter).join("")).toBe("house");
    expect(drawGuess.view(s, 1).boards[0]!.rows[0]![0]).toEqual({ letter: "", hidden: true });
    expect(() => drawGuess.apply(s, 2, { type: "guess", word: "house" })).toThrow(/already/);
    s = drawGuess.apply(s, 1, { type: "guess", word: "house" });
    s = drawGuess.apply(s, 3, { type: "pass" });
    expect(s.phase).toBe("turn");
    expect(s.points).toEqual([6, 8, 10, 0]);
    expect(drawGuess.view(s, 3).words.at(-1)).toEqual({ word: "house", by: null, note: "It was" });
  });

  it("hands the pen round the table, and ends when everyone has drawn", () => {
    let s = newDrawGuess(drawRelaxed, 2, 1);
    for (let turn = 0; turn < 2; turn++) {
      expect(s.artist).toBe(turn);
      s = drawGuess.apply(s, turn, { type: "choose", index: 0 });
      s = drawGuess.apply(s, 1 - turn, { type: "guess", word: s.prompt });
      if (turn === 0) {
        expect(s.phase).toBe("turn");
        s = drawGuess.apply(drawGuess.apply(s, 0, { type: "next" }), 1, { type: "next" });
      }
    }
    expect(s.phase).toBe("finished");
    expect(s.points).toEqual([13, 13]);
  });

  it("ends the drawing when its time has gone", () => {
    let s = chosen();
    expect(drawGuess.deadline!(s)).toEqual({ seat: 0, after: 90_000, move: { type: "done" }, strict: true });
    s = drawGuess.apply(s, 0, { type: "stroke", stroke: LINE }, { elapsed: 60_000 });
    expect(drawGuess.deadline!(s)!.after).toBe(30_000);
    s = drawGuess.apply(s, 1, { type: "guess", word: "boat" }, { elapsed: 31_000 });
    expect(s.phase).toBe("turn");
    expect(s.narration).toContain("Time's up");
    expect(() => drawGuess.apply(s, 0, { type: "stroke", stroke: LINE })).toThrow(GameError);
  });
});

it("every drawing prompt is a word", () => {
  expect(DRAW_PROMPTS.filter((w) => w.length <= 8 && !isWord(w))).toEqual([]);
});
