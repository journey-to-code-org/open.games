// Every game sits on exactly one shelf of the picker, and the shelves between them hold every game.
import { describe, expect, it } from "vitest";
import { ALL_GAMES, GAME_CATEGORIES, gamesIn, isGameCategory, kitGame } from "../src/index.js";

describe("categories", () => {
  it("gives every game a known category", () => {
    for (const game of ALL_GAMES) expect(isGameCategory(game.category), game.id).toBe(true);
  });

  it("puts every game on one shelf", () => {
    const shelved = GAME_CATEGORIES.flatMap((c) => gamesIn(c.id).map((g) => g.id));
    expect([...shelved].sort()).toEqual(ALL_GAMES.map((g) => g.id).sort());
  });

  it("goes by what the game is, not the kit it is built on", () => {
    expect(kitGame("yacht")!.category).toBe("dice");
    expect(gamesIn("dice").map((g) => g.id)).toEqual(["yacht", "pig", "tenthousand", "shipcaptaincrew", "shutthebox", "liarsdice"]);
    expect(kitGame("hearts")!.category).toBe("cards");
    expect(kitGame("chess")!.category).toBe("board");
    expect(kitGame("bowling")!.category).toBe("sports");
    expect(gamesIn("words").map((g) => g.id)).toEqual(["secretword", "anagrams", "hangman", "wordhunt", "crisscross"]);
    expect(gamesIn("party").map((g) => g.id)).toEqual(["drawguess", "readtheroom", "telephone"]);
    expect(gamesIn("arcade").map((g) => g.id)).toEqual(["overthehill", "skyfire", "bulwark", "chipstack", "pinkslips", "airhockey", "zubraquest", "counter", "delbies"]);
  });

  it("refuses a category it doesn't know", () => {
    expect(isGameCategory("puzzles")).toBe(false);
    expect(isGameCategory(undefined)).toBe(false);
  });
});
