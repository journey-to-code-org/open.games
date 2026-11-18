// Every word game on the kit, the way board.test.ts checks every board game: computer players
// finish whole games with every preset at every table size, the same seed always starts the same
// game, every view is consistent with itself, a seat is offered a move exactly when the engine
// will take one from it, and refused moves change nothing.
import { mulberry32 } from "@journey-to-code/rules";
import { describe, expect, it } from "vitest";
import { GameError, KIT_GAMES, WORD_GAMES, compareWords, entryAllows, freeformAllows, placeAllows, strokeAllows, isBoardGame, isCardGame, isFieldGame, isSportGame, isWordGame, keysFrom, wordMovesOffered, type WordGame, type WordView } from "../src/index.js";

const STYLES = [{}, { skill: 0.3, sloppy: 0.3 }, { skill: 1, sloppy: 0 }];
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const TONES = ["hit", "near", "miss"];

/** A view makes sense on its own. */
export function checkWordView(v: WordView, seat: number) {
  expect(v.me).toBe(seat);
  expect(v.players).toHaveLength(v.seats);
  // Something is on the table: rows of tiles, a rack, a hand, a picture, a question, how it came out, or a choice to make.
  expect(v.boards.length + (v.rack ? 1 : 0) + (v.hand ? 1 : 0) + (v.canvas ? 1 : 0) + (v.question ? 1 : 0) + (v.room ? 1 : 0) + (v.choices?.options.length ?? 0)).toBeGreaterThan(0);
  expect(new Set(v.boards.map((b) => b.id)).size).toBe(v.boards.length);
  for (const b of v.boards) {
    expect(b.label).toBeTruthy();
    // A private board is only ever sent to the seat it belongs to.
    if (b.owner !== undefined) expect(b.owner).toBe(seat);
    for (const row of b.rows) {
      expect(row).toHaveLength(b.cols);
      for (const tile of row) {
        expect(tile.letter === "" || /^[a-z]$/.test(tile.letter)).toBe(true);
        if (tile.tone) expect(TONES).toContain(tile.tone);
        // A letter this seat may not see is not in the view at all.
        if (tile.hidden) expect(tile.letter).toBe("");
      }
    }
  }
  for (const [letter, tone] of Object.entries(v.keys)) expect([/^[a-z]$/.test(letter), TONES.includes(tone)]).toEqual([true, true]);
  if (v.rack) for (const letter of v.rack) expect(letter).toMatch(/^[a-z]$/);
  if (v.hand) for (const letter of v.hand) expect(letter).toMatch(/^[a-z]$/);
  if (v.values) for (const letter of [...(v.hand ?? []), ...(v.rack ?? [])]) expect(v.values[letter]).toBeGreaterThan(0);
  if (v.place) {
    expect(v.boards.some((b) => b.id === v.place!.board)).toBe(true);
    expect(v.hand?.length).toBeGreaterThan(0);
  }
  if (v.canvas) {
    for (const stroke of v.canvas.strokes) expect(strokeAllows({ canvas: { strokes: [], draw: { type: "s", prompt: "" } } }, { type: "s", stroke })).toBe(true);
  }
  if (v.entry) {
    expect(v.entry.type && v.entry.prompt).toBeTruthy();
    expect(v.entry.min >= 1 && v.entry.min <= v.entry.max).toBe(true);
    if (v.entry.pool) expect(v.entry.max).toBeLessThanOrEqual(v.entry.pool.length);
  }
  if (v.pick) {
    expect(v.pick.letters.length).toBeGreaterThan(0);
    expect(new Set(v.pick.letters).size).toBe(v.pick.letters.length);
    for (const letter of v.pick.letters) expect(letter).toMatch(/^[a-z]$/);
  }
  for (const w of v.words) {
    expect(w.word).toMatch(/^[a-z]+$/);
    if (w.by !== null) expect(Number.isInteger(w.by) && w.by >= 0 && w.by < v.seats).toBe(true);
  }
  for (const p of v.players) for (const row of p.marks ?? []) for (const tone of row) expect(TONES).toContain(tone);
  // In turn, only the seat whose go it is has anything to type or pick.
  if (v.turn !== null && v.turn !== seat) expect([v.entry, v.pick, v.place ?? null]).toEqual([null, null, null]);
  if (v.over) {
    expect(v.over.winners.length).toBeGreaterThan(0);
    expect([v.entry, v.pick, v.place ?? null, v.canvas?.draw ?? null]).toEqual([null, null, null, null]);
  }
}

/**
 * Typed words the engine should refuse: whatever the view says can't be typed (too short, too long,
 * not letters), and, where a typed word has to be a word, things that aren't. (A guess in a drawing
 * game needn't be a word: a wrong one is still a guess.)
 */
const badWords = (v: WordView) =>
  v.entry
    ? ["", "a", "zzzzzzzzzzzzzzzzzzzzzz", "it's", "né", 7, null, "q".repeat(v.entry.max), "x".repeat(v.entry.min)]
        .map((word) => ({ type: v.entry!.type, word }))
        .filter((move) => !entryAllows(v, move) || v.game !== "drawguess")
    : [];

/** Bots play until it's over. Along the way every view is checked, and a bot only does what its view offers. */
export function playOut(game: WordGame<any, any, any>, rules: unknown, seats: number, seed: number, limit = 3000) {
  const rand = mulberry32(seed * 31 + seats);
  let s = game.newGame(game.normalize(rules), seats, seed);
  let moves = 0;
  while (!game.summary(s).over) {
    let moved = false;
    for (let seat = 0; seat < seats; seat++) {
      const v = game.view(s, seat);
      checkWordView(v, seat);
      const before = JSON.stringify(s);
      // Every move that can be listed is one the engine takes; no typed nonsense is.
      for (const m of wordMovesOffered(v)) game.apply(s, seat, m);
      for (const m of badWords(v)) expect(() => game.apply(s, seat, m), `${game.id} took ${JSON.stringify(m)}`).toThrow(GameError);
      expect(JSON.stringify(s)).toBe(before);
      if (moved) continue;
      const move = game.bot(s, seat, STYLES[(seat + moves) % STYLES.length]!, rand);
      // A seat with nothing to type, pick or press has nothing to do, and the other way about.
      const offered = wordMovesOffered(v);
      expect(move !== null, `${game.id}: seat ${seat} ${move ? "moves with nothing offered" : "is offered a move and makes none"}`).toBe(!!v.entry || !!v.place || !!v.canvas?.draw || !!v.form || offered.length > 0);
      if (!move) continue;
      expect(freeformAllows(v, move) || offered.some((m) => same(m, move)), `${game.id}: the bot's move ${JSON.stringify(move)} isn't one the view offers`).toBe(true);
      s = game.apply(s, seat, move);
      moved = true;
      moves++;
    }
    if (!moved) throw new Error(`nobody can move in ${game.id} (phase ${game.summary(s).phase})`);
    if (moves > limit) throw new Error(`${game.id} went on too long`);
  }
  return { state: s, moves };
}

describe("the word kit's helpers", () => {
  it("marks a guess against a word, counting each letter only as often as the word has it", () => {
    expect(compareWords("crane", "crane")).toEqual(["hit", "hit", "hit", "hit", "hit"]);
    expect(compareWords("trace", "crane")).toEqual(["miss", "hit", "hit", "near", "hit"]);
    // One l to spare after the first: the second l is near, and the second a has nothing left.
    expect(compareWords("llama", "label")).toEqual(["hit", "near", "near", "miss", "miss"]);
    expect(compareWords("geese", "eerie")).toEqual(["miss", "hit", "near", "miss", "hit"]);
    expect(keysFrom(["trace", "blunt"], "crane")).toEqual({ t: "miss", r: "hit", a: "hit", c: "near", e: "hit", b: "miss", l: "miss", u: "miss", n: "hit" });
    // The best that was seen of a letter is kept.
    expect(keysFrom(["nanny", "crane"], "crane").n).toBe("hit");
  });

  it("says what a view lets be typed, picked and pressed", () => {
    const base = { entry: { type: "word", prompt: "Go", min: 3, max: 5, pool: ["t", "a", "l", "e", "s"] } };
    expect(entryAllows(base, { type: "word", word: "tale" })).toBe(true);
    for (const move of [{ type: "guess", word: "tale" }, { type: "word", word: "ta" }, { type: "word", word: "tallest" }, { type: "word", word: "tall" }, { type: "word", word: "Tale" }, { type: "word" }, null]) expect(entryAllows(base, move)).toBe(false);
    expect(entryAllows({ entry: { type: "guess", prompt: "Go", min: 5, max: 5 } }, { type: "guess", word: "zzzzz" })).toBe(true);
    expect(entryAllows({ entry: null }, { type: "guess", word: "crane" })).toBe(false);
    const v = WORD_GAMES.find((g) => g.id === "hangman")!.view(WORD_GAMES.find((g) => g.id === "hangman")!.newGame(WORD_GAMES.find((g) => g.id === "hangman")!.presets[0], 2, 1), 0);
    expect(wordMovesOffered(v)).toHaveLength(26);
    expect(wordMovesOffered(v)[0]).toEqual({ type: "letter", letter: "a" });
  });
});

describe("the registry", () => {
  it("lists every game once, as a card game, a board game, a word game, a table sport or a field game", () => {
    for (const { id } of KIT_GAMES) expect([isCardGame(id), isBoardGame(id), isWordGame(id), isSportGame(id), isFieldGame(id)].filter(Boolean), id).toHaveLength(1);
    // The word kit's games sit on the word shelf, or the party shelf if a room plays them for the fun of it.
    expect(WORD_GAMES.every((g) => g.category === "words" || g.category === "party")).toBe(true);
  });
});

for (const game of WORD_GAMES) {
  describe(game.id, () => {
    it("has valid presets that describe themselves", () => {
      expect(isWordGame(game.id)).toBe(true);
      expect(new Set(game.presets.map((p) => p.id)).size).toBe(game.presets.length);
      for (const p of game.presets) {
        expect(game.validate(game.normalize(p))).toEqual([]);
        expect(game.normalize(p)).toEqual(p);
        expect(game.describe(p).length).toBeGreaterThan(1);
        // A table's rules name is cut at 30 characters on the server: say it in fewer.
        expect(p.name.length).toBeLessThanOrEqual(30);
      }
      for (const junk of [null, 7, "x", {}, { id: "nope", length: "long", rounds: -3, misses: 99 }]) expect(game.validate(game.normalize(junk))).toEqual([]);
    });

    const sizes = [...new Set([game.seats.min, game.seats.default, game.seats.max])];
    for (const seats of sizes) {
      it(`bots play whole games with ${seats} player${seats === 1 ? "" : "s"}`, () => {
        for (const seed of [1, 7, 42]) {
          for (const preset of game.presets) {
            const { state } = playOut(game, preset, seats, seed);
            const summary = game.summary(state);
            expect(summary.over).toBe(true);
            expect(summary.winners!.length).toBeGreaterThan(0);
            expect([...summary.order!].sort()).toEqual(Array.from({ length: seats }, (_, i) => i));
            for (let seat = 0; seat < seats; seat++) {
              const v = game.view(state, seat);
              checkWordView(v, seat);
              expect(v.over!.winners).toEqual(summary.winners);
              // Nothing left to do on a finished table.
              expect([wordMovesOffered(v), v.entry]).toEqual([[], null]);
            }
          }
        }
      }, 120_000);
    }

    it("plays the same game from the same seed and the same dice", () => {
      for (const preset of game.presets) {
        const a = playOut(game, preset, game.seats.default, 99);
        const b = playOut(game, preset, game.seats.default, 99);
        expect(JSON.stringify(a.state)).toBe(JSON.stringify(b.state));
        expect(a.moves).toBe(b.moves);
        // And a different seed is a different word.
        expect(JSON.stringify(game.newGame(preset, 2, 5))).not.toBe(JSON.stringify(game.newGame(preset, 2, 6)));
      }
    }, 60_000);

    it("says the same things to every seat", () => {
      for (const preset of game.presets) {
        const s = game.newGame(preset, game.seats.max, 5);
        const views = Array.from({ length: game.seats.max }, (_, seat) => game.view(s, seat));
        for (const v of views) {
          expect(v.game).toBe(game.id);
          expect(v.seats).toBe(game.seats.max);
          expect([v.turn, v.phase, v.scores, v.over, v.rack, v.info]).toEqual([views[0]!.turn, views[0]!.phase, views[0]!.scores, views[0]!.over, views[0]!.rack, views[0]!.info]);
        }
      }
    });

    it("refuses nonsense and moves out of turn, and leaves the state alone", () => {
      const s = game.newGame(game.presets[0], game.seats.max, 5);
      const before = JSON.stringify(s);
      const idle = Array.from({ length: game.seats.max }, (_, i) => i).find((seat) => !game.view(s, seat).entry && !wordMovesOffered(game.view(s, seat)).length);
      const mover = game.view(s, 0).turn ?? 0;
      const can = wordMovesOffered(game.view(s, mover))[0];
      if (idle !== undefined && can) expect(() => game.apply(s, idle, can)).toThrow(GameError);
      for (const move of [{ type: "nonsense" }, {}, null, { type: "next" }, { type: "guess" }, { type: "word", word: 5 }, { type: "letter", letter: "ab" }, { type: "letter", letter: "é" }, { type: "letter" }]) expect(() => game.apply(s, mover, move), JSON.stringify(move)).toThrow(GameError);
      expect(() => game.apply(s, 99, { type: "next" })).toThrow(GameError);
      expect(JSON.stringify(s)).toBe(before);
    });
  });
}
