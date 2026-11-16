import { describe, expect, it } from "vitest";
import { GameError, mahjongRiichi as game, riichiSingle, type RiichiState } from "../src/index.js";
import { playOut } from "./kit.test.js";

const fresh = (seed = 3) => game.newGame(game.normalize(riichiSingle), 4, seed) as RiichiState;
const total = (s: RiichiState) => s.scores.reduce((a, b) => a + b, 0) + s.sticks * 1000;

describe("mahjongriichi", () => {
  it("deals 13 tiles, the dealer draws a 14th, and 70 tiles are left less that draw", () => {
    const s = fresh();
    expect(s.round.seats.map((x) => x.hand.length)).toEqual([14, 13, 13, 13]);
    expect(s.round.wall.length).toBe(69);
    expect(s.round.dead.length).toBe(14);
  });

  it("only seats four", () => {
    expect(() => game.newGame(game.normalize(riichiSingle), 3, 1)).toThrow(GameError);
  });

  it("shows only your own hand", () => {
    const s = fresh();
    expect(game.view(s, 0).hand).toHaveLength(14);
    expect(game.view(s, 1).hand).toHaveLength(13);
    expect(game.view(s, 1).tap).toBeNull();
    expect(game.view(s, 0).tap!.cards.length).toBeGreaterThan(0);
  });

  it("refuses a tile you don't have and a move out of turn, leaving the state alone", () => {
    const s = fresh();
    const before = JSON.stringify(s);
    expect(() => game.apply(s, 0, { type: "discard", card: "t999" })).toThrow(GameError);
    expect(() => game.apply(s, 1, { type: "discard", card: `t${s.round.seats[1]!.hand[0]}` })).toThrow(GameError);
    expect(JSON.stringify(s)).toBe(before);
  });

  it("keeps the points constant over whole games", () => {
    for (const seed of [1, 2, 3, 4, 5]) {
      const { state } = playOut(game, riichiSingle, 4, seed);
      expect(total(state as RiichiState)).toBe(100000);
    }
  });

  it("plays hanchans and tonpuusen to the end", () => {
    for (const preset of game.presets.slice(0, 2)) {
      const { state, moves } = playOut(game, preset, 4, 11);
      expect(game.summary(state).over).toBe(true);
      expect(moves).toBeGreaterThan(100);
    }
  });

  it("offers riichi, and a riichi hand throws what it draws", () => {
    let seen = false;
    for (let seed = 1; seed < 40 && !seen; seed++) {
      let s = fresh(seed);
      for (let i = 0; i < 200 && s.phase === "play"; i++) {
        const seat = [0, 1, 2, 3].find((x) => game.bot(s, x, { skill: 1, sloppy: 0 }));
        if (seat === undefined) break;
        const m = game.bot(s, seat, { skill: 1, sloppy: 0 })!;
        if (m.riichi) {
          seen = true;
          const next = game.apply(s, seat, m) as RiichiState;
          expect(next.round.seats[seat]!.river.at(-1)!.riichi).toBe(true);
          break;
        }
        s = game.apply(s, seat, m) as RiichiState;
      }
    }
    expect(seen).toBe(true);
  });

  it("is deterministic: the same moves give the same game", () => {
    const rules = game.normalize(riichiSingle);
    let a = game.newGame(rules, 4, 8) as RiichiState;
    let b = game.newGame(rules, 4, 8) as RiichiState;
    for (let i = 0; i < 2000 && a.phase !== "finished"; i++) {
      const seat = [0, 1, 2, 3].find((x) => game.bot(a, x, { skill: 1, sloppy: 0 }))!;
      const move = game.bot(a, seat, { skill: 1, sloppy: 0 })!;
      a = game.apply(a, seat, move) as RiichiState;
      b = game.apply(b, seat, move) as RiichiState;
    }
    expect(a.phase).toBe("finished");
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});
