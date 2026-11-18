// Crokinole's own rules. The shared sport tests (sport.test.ts) play whole games of it; these put
// a few discs on the board and look at what a flick does and what a round is worth.
import { validateWorld } from "@journey-to-code/physics";
import { describe, expect, it } from "vitest";
import { crokinole, crokinole100, crokinole50, crokinoleCount, crokinoleWorth, GameError, newCrokinole, type CrokinoleState } from "../src/index.js";

const C = 3600;
const UP = 27000;
const disc = (s: CrokinoleState, id: string) => s.world.bodies.find((b) => b.id === id)!;
const on = (s: CrokinoleState) => s.world.bodies.filter((b) => !b.fixed && b.out === undefined && b.pocketed === undefined).map((b) => b.id).sort();
/** How hard to flick for a disc to stop `d` away. */
const powerTo = (d: number) => Math.round((Math.sqrt(2 * 4000 * d) / 9000) * 1000);
const flick = (s: CrokinoleState, seat: number, body: string, power: number, at = C, angle = UP) => crokinole.apply(s, seat, { type: "shot", body, angle, power, at });

/** A round with these discs already at rest on the board, and black's next disc on its line. */
function board(discs: Record<string, [number, number]>, change: Partial<CrokinoleState> = {}): CrokinoleState {
  const s = newCrokinole(crokinole100, 2, 1);
  const thrown: [number, number] = [0, 0];
  disc(s, "k1").out = "tray";
  for (const [id, [x, y]] of Object.entries(discs)) {
    const b = disc(s, id);
    delete b.out;
    b.x = x;
    b.y = y;
    const side = id[0] === "k" ? 0 : 1;
    thrown[side] = Math.max(thrown[side], Number(id.slice(1)));
  }
  const next = disc(s, `k${thrown[0] + 1}`);
  delete next.out;
  next.x = C;
  next.y = C + 2900;
  expect(validateWorld({ ...s.world, bodies: s.world.bodies.filter((b) => b.out === undefined) })).toEqual([]);
  return { ...s, thrown, turn: 0, shots: thrown[0] + thrown[1], ...change };
}

describe("crokinole", () => {
  it("starts with black's first disc on its line, eight pegs standing and the rest waiting", () => {
    const s = newCrokinole(crokinole100, 2, 1);
    expect(on(s)).toEqual(["k1"]);
    expect(s.world.bodies.filter((b) => b.fixed)).toHaveLength(8);
    expect(validateWorld({ ...s.world, bodies: s.world.bodies.filter((b) => b.out === undefined) })).toEqual([]);
    const v = crokinole.view(s, 0);
    expect(v.shoot).toMatchObject({ body: "k1", place: { y: C + 2900, min: C - 1100, max: C + 1100 } });
    expect(crokinole.view(s, 1).shoot).toBeNull();
    expect(v.table.ghosts).toHaveLength(15);
    expect(v.table.look.marks?.map((m) => m.text)).toEqual(["15", "10", "5", "5"]);
    expect(newCrokinole(crokinole50, 2, 1).world.bodies.filter((b) => !b.fixed)).toHaveLength(12);
  });

  it("values a disc by the ring it lies wholly inside", () => {
    expect(crokinoleWorth(500)).toBe(15);
    expect(crokinoleWorth(855)).toBe(15);
    // Touching the 15 line: the lower ring.
    expect(crokinoleWorth(856)).toBe(10);
    expect(crokinoleWorth(1871)).toBe(10);
    expect(crokinoleWorth(1872)).toBe(5);
    expect(crokinoleWorth(3139)).toBe(5);
    // Touching the outer line: the ditch.
    expect(crokinoleWorth(3140)).toBe(0);
  });

  it("drops a slow disc in the hole for 20, and gold flicks next from the other side", () => {
    const s = flick(newCrokinole(crokinole100, 2, 1), 0, "k1", powerTo(2960));
    expect(disc(s, "k1").pocketed).toBe("twenty");
    expect(s.twenties).toEqual([1, 0]);
    expect(s.narration).toMatch(/drops it in the hole: 20!/);
    expect(s.turn).toBe(1);
    expect(crokinole.view(s, 1).shoot).toMatchObject({ body: "g1", place: { y: C - 2900 } });
    expect(crokinoleCount(s.world.bodies, s.twenties, "g1")).toEqual([20, 0]);
  });

  it("takes off a disc that stops outside the 15 line when there was nothing of theirs to hit", () => {
    const s = flick(newCrokinole(crokinole100, 2, 1), 0, "k1", powerTo(1200));
    expect(disc(s, "k1").out).toBe("foul");
    expect(s.narration).toMatch(/stops outside the 15 line and comes off/);
    expect(on(s)).toEqual(["g1"]);
  });

  it("leaves a disc that stops touching the 15 line", () => {
    // 2900 from the middle, to stop about 1100 from it: its edge is inside the line.
    const s = flick(newCrokinole(crokinole100, 2, 1), 0, "k1", powerTo(1800), C - 700, 27000 + 1400);
    const k1 = disc(s, "k1");
    if (k1.out === undefined && k1.pocketed === undefined) expect(Math.hypot(k1.x - C, k1.y - C) - 160).toBeLessThanOrEqual(1016);
    else expect(k1.out).toBe("foul");
  });

  it("makes you hit one of theirs when they have one out there", () => {
    const start = board({ g1: [C + 900, C + 1500] });
    // Straight up the middle misses it: the disc comes off wherever it stopped.
    const miss = flick(start, 0, "k1", powerTo(1500));
    expect(disc(miss, "k1").out).toBe("foul");
    expect(miss.narration).toMatch(/misses gold: the disc comes off/);
    expect(on(miss)).toContain("g1");
    // From straight below it, hard: it is hit, and goes to the ditch or stays, but the flick stands.
    const hit = flick(start, 0, "k1", 700, C + 900);
    expect(disc(hit, "k1").out).not.toBe("foul");
    expect(hit.narration).not.toMatch(/misses/);
    expect(Math.hypot(disc(hit, "g1").x - (C + 900), disc(hit, "g1").y - (C + 1500))).toBeGreaterThan(100);
  });

  it("takes your own knocked disc off with the flicked one when theirs is missed", () => {
    const start = board({ g1: [C - 2000, C], k1: [C, C + 1700] });
    const s = flick(start, 0, "k2", 500);
    expect(disc(s, "k2").out).toBe("foul");
    expect(disc(s, "k1").out).toBe("foul");
    expect(s.narration).toMatch(/2 discs come off/);
  });

  it("counts the round when every disc is flicked, and the better side scores the difference", () => {
    const rules = { ...crokinole100, discs: 6 };
    let s = newCrokinole(rules, 2, 1);
    // All but the last disc already gone: black has banked two 20s, and gold has a disc in the 10.
    for (const b of s.world.bodies) if (!b.fixed && b.id !== "g6") b.out = "gone";
    const g5 = disc(s, "g5");
    delete g5.out;
    g5.x = C + 1500;
    g5.y = C;
    const g6 = disc(s, "g6");
    delete g6.out;
    g6.x = C;
    g6.y = C - 2900;
    s = { ...s, thrown: [6, 5], twenties: [2, 0], turn: 1 };
    // Gold's last has nothing of black's to hit, and stops short of the middle: it comes off.
    const done = crokinole.apply(s, 1, { type: "shot", body: "g6", angle: 9000, power: powerTo(800), at: C });
    expect(done.phase).toBe("round");
    expect(done.points).toEqual([30, 0]);
    expect(done.result?.rows.find((r) => r.label === "This round")?.values).toEqual(["+30", ""]);
    expect(() => crokinole.apply(done, 0, { type: "shot", body: "k1", angle: UP, power: 300 })).toThrow(GameError);
    const next = crokinole.apply(crokinole.apply(done, 0, { type: "next" }), 1, { type: "next" });
    // The other side flicks first in the next round.
    expect(next).toMatchObject({ phase: "playing", hand: 2, turn: 1, first: 1, thrown: [0, 0], twenties: [0, 0] });
    expect(on(next)).toEqual(["g1"]);
  });

  it("refuses a flick out of turn, of the wrong disc, or put down off the line", () => {
    const s = newCrokinole(crokinole100, 2, 1);
    expect(() => flick(s, 1, "g1", 300)).toThrow(/not your flick/);
    expect(() => flick(s, 0, "k2", 300)).toThrow(/own next disc/);
    expect(() => flick(s, 0, "k1", 300, C + 1200)).toThrow(/on your line/);
    expect(() => flick(s, 0, "k1", 2000)).toThrow(/too soft or too hard/);
  });

  it("does not change the state it is given", () => {
    const s = newCrokinole(crokinole100, 2, 1);
    const copy = JSON.stringify(s);
    flick(s, 0, "k1", 600);
    expect(JSON.stringify(s)).toBe(copy);
  });
});
