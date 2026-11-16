import { describe, expect, it } from "vitest";
import { fullTileSet, GameError, LAYOUTS, mahjongShanghai as game, matchKey, shanghaiPyramid, shanghaiSolution, shanghaiStarter, shanghaiTurtle, tileGlyph, tileKey, tileName, type ShanghaiRules, type ShanghaiState } from "../src/index.js";

const tilesOf = (s: ShanghaiState, seat = 0) => {
  const v = game.view(s, seat);
  if (v.center.kind !== "tiles") throw new Error("not a tile table");
  return v.center;
};
const play = (s: ShanghaiState, move: Record<string, unknown>, seat = 0) => game.apply(s, seat, move as never);

describe("the tile set", () => {
  const set = fullTileSet();
  it("has 144 tiles: 34 kinds four times over, and eight bonus tiles", () => {
    expect(set).toHaveLength(144);
    const kinds = new Map<string, number>();
    for (const t of set) kinds.set(tileKey(t), (kinds.get(tileKey(t)) ?? 0) + 1);
    expect([...kinds.values()].filter((n) => n === 4)).toHaveLength(34);
    expect(set.filter((t) => t.family === "flower" || t.family === "season")).toHaveLength(8);
  });
  it("matches any flower with any flower and any season with any season", () => {
    const flowers = set.filter((t) => t.family === "flower").map(matchKey);
    expect(new Set(flowers).size).toBe(1);
    expect(matchKey(set.find((t) => t.family === "season")!)).not.toBe(flowers[0]);
  });
  it("names tiles and has a glyph for each", () => {
    expect(tileName({ family: "dragon", rank: 1, copy: 1 })).toBe("Red dragon");
    expect(tileName({ family: "dots", rank: 5, copy: 2 })).toBe("5 of dots");
    expect(new Set(set.map(tileGlyph)).size).toBe(42);
  });
});

describe("the layouts", () => {
  it("hold 52, 104 and 144 tiles", () => {
    expect(LAYOUTS.map((l) => tilesOf(game.newGame(game.normalize({ layout: l.id }), 1, 3)).tiles.length)).toEqual([52, 104, 144]);
  });
  it("start with some free tiles and some blocked ones", () => {
    const c = tilesOf(game.newGame(shanghaiTurtle, 1, 3));
    expect(c.tiles.filter((t) => t.free).length).toBeGreaterThan(4);
    expect(c.tiles.filter((t) => !t.free).length).toBeGreaterThan(100);
    // The tile on the very top is blocked from the side only by nothing, but covered by nothing: it is free.
    const top = c.tiles.find((t) => t.z === 4)!;
    expect(top.free).toBe(true);
    // A tile under it is covered.
    expect(c.tiles.find((t) => t.z === 3)!.free).toBe(false);
  });
  it("frees an end tile and keeps a tile between two others blocked", () => {
    const c = tilesOf(game.newGame(shanghaiTurtle, 1, 3));
    const at = (x: number, y: number, z: number) => c.tiles.find((t) => t.x === x && t.y === y && t.z === z)!;
    expect(at(0, 7, 0).free).toBe(true);
    expect(at(28, 7, 0).free).toBe(true);
    expect(at(26, 7, 0).free).toBe(false);
    expect(at(2, 0, 0).free).toBe(true);
    expect(at(6, 0, 0).free).toBe(false);
  });
});

describe("the deal", () => {
  it("can always be cleared: the recorded solution plays through to a win", () => {
    for (const rules of [shanghaiStarter, shanghaiPyramid, shanghaiTurtle]) {
      for (const seed of [1, 2, 3, 99, 12345]) {
        let s = game.newGame(rules, 1, seed);
        for (const [a, b] of shanghaiSolution(rules, seed)) s = play(s, { type: "match", a, b });
        expect(game.summary(s).over).toBe(true);
        expect(game.summary(s).winners).toEqual([0]);
        expect(game.view(s, 0).over!.title).toMatch(/Cleared/);
      }
    }
  });
  it("is the same deal for every seat", () => {
    const s = game.newGame(shanghaiTurtle, 3, 8);
    const [a, b, c] = [0, 1, 2].map((i) => JSON.stringify(tilesOf(s, i).tiles));
    expect(a).toBe(b);
    expect(b).toBe(c);
  });
  it("differs by seed", () => {
    const a = tilesOf(game.newGame(shanghaiTurtle, 1, 1)).tiles.map((t) => t.name).join();
    const b = tilesOf(game.newGame(shanghaiTurtle, 1, 2)).tiles.map((t) => t.name).join();
    expect(a).not.toBe(b);
  });
});

describe("taking tiles", () => {
  const rules: ShanghaiRules = { ...shanghaiStarter };
  const first = (s: ShanghaiState) => shanghaiSolution(rules, 4)[0]!;

  it("takes a pair with a match move", () => {
    const s = play(game.newGame(rules, 1, 4), { type: "match", a: first(null as never)[0], b: first(null as never)[1] });
    expect(tilesOf(s).tiles).toHaveLength(50);
  });
  it("picks a tile and then its match with taps", () => {
    let s = game.newGame(rules, 1, 4);
    const [a, b] = shanghaiSolution(rules, 4)[0]!;
    s = play(s, { type: "pick", tile: a });
    expect(tilesOf(s).tiles.find((t) => t.id === a)!.selected).toBe(true);
    s = play(s, { type: "pick", tile: b });
    expect(tilesOf(s).tiles).toHaveLength(50);
  });
  it("lets a second tap on the same tile put it down", () => {
    let s = game.newGame(rules, 1, 4);
    const [a] = shanghaiSolution(rules, 4)[0]!;
    s = play(play(s, { type: "pick", tile: a }), { type: "pick", tile: a });
    expect(tilesOf(s).tiles.some((t) => t.selected)).toBe(false);
  });
  it("moves the pick to a free tile that does not match", () => {
    const s0 = game.newGame(rules, 1, 4);
    const free = tilesOf(s0).tiles.filter((t) => t.free);
    const a = free[0]!;
    const other = free.find((t) => matchKey(t.tile) !== matchKey(a.tile))!;
    const s = play(play(s0, { type: "pick", tile: a.id }), { type: "pick", tile: other.id });
    expect(tilesOf(s).tiles).toHaveLength(52);
    expect(tilesOf(s).tiles.find((t) => t.id === other.id)!.selected).toBe(true);
  });
  it("refuses a blocked tile, a mismatch, the same tile twice and rubbish, and changes nothing", () => {
    const s = game.newGame(rules, 1, 4);
    const before = JSON.stringify(s);
    const c = tilesOf(s);
    const blocked = c.tiles.find((t) => !t.free)!;
    const free = c.tiles.filter((t) => t.free);
    const unlike = [free[0]!, free.find((t) => matchKey(t.tile) !== matchKey(free[0]!.tile))!];
    expect(() => play(s, { type: "pick", tile: blocked.id })).toThrow(GameError);
    expect(() => play(s, { type: "match", a: unlike[0]!.id, b: unlike[1]!.id })).toThrow(GameError);
    expect(() => play(s, { type: "match", a: free[0]!.id, b: free[0]!.id })).toThrow(GameError);
    expect(() => play(s, { type: "pick", tile: 9999 })).toThrow(GameError);
    expect(() => play(s, { type: "nonsense" })).toThrow(GameError);
    expect(() => game.apply(s, 3, { type: "shuffle" } as never)).toThrow(GameError);
    expect(JSON.stringify(s)).toBe(before);
  });
  it("only offers free tiles to tap", () => {
    const c = tilesOf(game.newGame(rules, 1, 4));
    expect(c.tap!.tiles.sort()).toEqual(c.tiles.filter((t) => t.free).map((t) => t.id).sort());
  });
});

describe("shuffle and undo", () => {
  it("shuffles what is left and always leaves a way through", () => {
    const rules: ShanghaiRules = { ...shanghaiStarter };
    for (const seed of [1, 2, 3, 4, 5]) {
      let s = game.newGame(rules, 1, seed);
      for (const [a, b] of shanghaiSolution(rules, seed).slice(0, 12)) s = play(s, { type: "match", a, b });
      const before = tilesOf(s).tiles.map((t) => matchKey(t.tile)).sort();
      s = play(s, { type: "shuffle" });
      const after = tilesOf(s);
      expect(after.tiles.map((t) => matchKey(t.tile)).sort()).toEqual(before);
      expect(after.matches).toBeGreaterThan(0);
      expect(solvable(s)).toBe(true);
    }
  });
  it("counts shuffles down and then refuses", () => {
    let s = game.newGame({ ...shanghaiStarter, shuffles: 1 }, 1, 2);
    s = play(s, { type: "shuffle" });
    expect(game.view(s, 0).choices!.options.some((o) => o.label.startsWith("Shuffle"))).toBe(false);
    expect(() => play(s, { type: "shuffle" })).toThrow(/No shuffles/);
  });
  it("puts a pair back with undo, alone only", () => {
    const [a, b] = shanghaiSolution(shanghaiStarter, 6)[0]!;
    let s = play(game.newGame(shanghaiStarter, 1, 6), { type: "match", a, b });
    s = play(s, { type: "undo" });
    expect(tilesOf(s).tiles).toHaveLength(52);
    expect(() => play(s, { type: "undo" })).toThrow(GameError);
    const race = game.newGame(shanghaiStarter, 2, 6);
    expect(() => play(play(race, { type: "match", a, b }), { type: "undo" })).toThrow(GameError);
    const noUndo = game.newGame({ ...shanghaiStarter, undo: false }, 1, 6);
    expect(() => play(play(noUndo, { type: "match", a, b }), { type: "undo" })).toThrow(GameError);
  });
  it("ends a game with no pair and no shuffle left", () => {
    let s = game.newGame({ ...shanghaiStarter, shuffles: 0 }, 1, 11);
    // Take pairs the careless way until stuck or cleared; the game must end either way.
    for (let i = 0; i < 100 && !game.summary(s).over; i++) s = play(s, game.bot(s, 0, { skill: 0, sloppy: 1 }, () => 0.37)!);
    expect(game.summary(s).over).toBe(true);
  });
});

describe("a race", () => {
  it("ends when one seat clears its board, and that seat wins", () => {
    let s = game.newGame(shanghaiStarter, 3, 5);
    for (const [a, b] of shanghaiSolution(shanghaiStarter, 5)) s = play(s, { type: "match", a, b }, 1);
    const summary = game.summary(s);
    expect(summary.over).toBe(true);
    expect(summary.winners).toEqual([1]);
    expect(summary.order![0]).toBe(1);
    expect(game.view(s, 0).over!.title).toMatch(/cleared the board first/);
    expect(() => play(s, { type: "shuffle" }, 0)).toThrow(GameError);
  });
  it("shows how the others are getting on, and nobody else's tiles", () => {
    let s = game.newGame(shanghaiStarter, 2, 5);
    const [a, b] = shanghaiSolution(shanghaiStarter, 5)[0]!;
    s = play(s, { type: "match", a, b }, 1);
    const v = game.view(s, 0);
    expect(v.players[1]!.line).toBe("50 tiles left");
    expect(v.players[0]!.line).toBe("52 tiles left");
    expect(tilesOf(s, 0).tiles).toHaveLength(52);
  });
  it("lets both seats move whenever they like: nobody has the turn", () => {
    const s = game.newGame(shanghaiStarter, 2, 5);
    expect(game.view(s, 0).turn).toBeNull();
    expect(game.bot(s, 0, {})).not.toBeNull();
    expect(game.bot(s, 1, {})).not.toBeNull();
  });
  it("ranks by tiles left when nobody clears", () => {
    let s = game.newGame({ ...shanghaiStarter, shuffles: 0 }, 2, 9);
    const [a, b] = shanghaiSolution({ ...shanghaiStarter, shuffles: 0 }, 9)[0]!;
    s = play(s, { type: "match", a, b }, 1);
    s = play(s, { type: "giveup" }, 0);
    s = play(s, { type: "giveup" }, 1);
    expect(game.summary(s).over).toBe(true);
    expect(game.summary(s).order).toEqual([1, 0]);
    expect(game.summary(s).winners).toEqual([1]);
  });
});

// Whether a position can be cleared at all, by searching every order (small positions only).
function solvable(s: ShanghaiState): boolean {
  const c = tilesOf(s);
  const rules = s.rules;
  const probe = (state: ShanghaiState, seen: Set<string>): boolean => {
    const cc = tilesOf(state);
    if (cc.tiles.length === 0) return true;
    const key = cc.tiles.map((t) => t.id).join(",");
    if (seen.has(key)) return false;
    seen.add(key);
    if (seen.size > 200000) return false;
    const free = cc.tiles.filter((t) => t.free);
    for (let i = 0; i < free.length; i++)
      for (let j = i + 1; j < free.length; j++)
        if (matchKey(free[i]!.tile) === matchKey(free[j]!.tile) && probe(play(state, { type: "match", a: free[i]!.id, b: free[j]!.id }), seen)) return true;
    return false;
  };
  void rules;
  void c;
  return probe(s, new Set());
}
