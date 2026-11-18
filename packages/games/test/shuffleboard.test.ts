// Shuffleboard's own rules. The shared sport tests (sport.test.ts) play whole games of it; these
// put a few pucks on the board and look at what a slide does and what a round is worth.
import { validateWorld } from "@journey-to-code/physics";
import { describe, expect, it } from "vitest";
import { GameError, newShuffleboard, shuffleboard, shuffleboard11, shuffleboard15, shuffleboardCount, shuffleboardZone, type ShuffleboardMove, type ShuffleboardState } from "../src/index.js";

const puck = (s: ShuffleboardState, id: string) => s.world.bodies.find((b) => b.id === id)!;
const on = (s: ShuffleboardState) => s.world.bodies.filter((b) => b.out === undefined).map((b) => b.id).sort();
const UP = 27000;
/** How hard to slide for a puck to stop `y` from the far edge, straight up the board. */
const powerTo = (y: number) => Math.round((Math.sqrt(2 * 3500 * (11200 - y)) / 11000) * 1000);
const slide = (s: ShuffleboardState, seat: number, body: string, power: number, at = 2000, angle = UP) => shuffleboard.apply(s, seat, { type: "shot", body, angle, power, at });

/** A round with these pucks already at rest on the board, and so already slid. Whose slide it is follows from the count. */
function board(pucks: Record<string, [number, number]>, rules = shuffleboard15, change: Partial<ShuffleboardState> = {}): ShuffleboardState {
  const s = newShuffleboard(rules, 2, 1);
  // Start from all in their trays, then put down the ones asked for.
  puck(s, "r1").out = "tray";
  const thrown: [number, number] = [0, 0];
  for (const [id, [x, y]] of Object.entries(pucks)) {
    const b = puck(s, id);
    delete b.out;
    b.x = x;
    b.y = y;
    thrown[id[0] === "r" ? 0 : 1] = Math.max(thrown[id[0] === "r" ? 0 : 1], Number(id[1]));
  }
  const turn = thrown[0] <= thrown[1] ? 0 : 1;
  const next = puck(s, `${turn === 0 ? "r" : "b"}${thrown[turn]! + 1}`);
  delete next.out;
  next.x = 2000;
  next.y = 11200;
  expect(validateWorld({ ...s.world, bodies: s.world.bodies.filter((b) => b.out === undefined) })).toEqual([]);
  return { ...s, thrown, turn, shots: thrown[0] + thrown[1], ...change };
}

describe("shuffleboard", () => {
  it("starts with red's first puck on the line and the rest in their trays", () => {
    const s = newShuffleboard(shuffleboard15, 2, 1);
    expect(s.turn).toBe(0);
    expect(on(s)).toEqual(["r1"]);
    expect(puck(s, "r1")).toMatchObject({ x: 2000, y: 11200 });
    const v = shuffleboard.view(s, 0);
    expect(v.shoot).toMatchObject({ body: "r1", place: { y: 11200, min: 500, max: 3500 } });
    expect(shuffleboard.view(s, 1).shoot).toBeNull();
    // The seven still waiting are drawn beside the board, and are no part of it.
    expect(v.table.ghosts.map((g) => g.id).sort()).toEqual(["tray-b1", "tray-b2", "tray-b3", "tray-b4", "tray-r2", "tray-r3", "tray-r4"]);
    expect(v.table.ghosts.every((g) => g.x < 0 || g.x > 4000)).toBe(true);
    expect(v.table.bodies.find((b) => b.id === "b1")).toMatchObject({ kind: "puck", tone: "blue" });
  });

  it("scores a puck by the zone it lies wholly inside", () => {
    expect(shuffleboardZone(600)).toBe(3);
    expect(shuffleboardZone(950)).toBe(3);
    // On the line between the 3 and the 2: the lower.
    expect(shuffleboardZone(951)).toBe(2);
    expect(shuffleboardZone(2150)).toBe(2);
    expect(shuffleboardZone(2151)).toBe(1);
    expect(shuffleboardZone(5350)).toBe(1);
    // Not wholly past the foul line: nothing, and it comes off.
    expect(shuffleboardZone(5351)).toBe(0);
    // Hanging over the far edge.
    expect(shuffleboardZone(249)).toBe(4);
    expect(shuffleboardZone(249, false)).toBe(3);
    expect(shuffleboardZone(250)).toBe(3);
  });

  it("slides a puck up the board to where the power takes it, and the other side slides next", () => {
    const s = slide(newShuffleboard(shuffleboard15, 2, 1), 0, "r1", powerTo(600), 1500);
    const r1 = puck(s, "r1");
    expect(r1.x).toBe(1500);
    expect(r1.y).toBeGreaterThan(300);
    expect(r1.y).toBeLessThan(950);
    expect(s.narration).toMatch(/\{0\}'s puck stops in the 3\./);
    expect(s.turn).toBe(1);
    expect(on(s)).toEqual(["b1", "r1"]);
    expect(s.thrown).toEqual([1, 0]);
    // The shot is there to be played again by a browser.
    expect(s.last).toMatchObject({ n: 1, seat: 0, shot: { body: "r1", angle: UP } });
  });

  it("takes off a puck that stops short of the foul line, and one that slides off the end", () => {
    const short = slide(newShuffleboard(shuffleboard15, 2, 1), 0, "r1", powerTo(7000));
    expect(puck(short, "r1").out).toBe("short");
    expect(short.narration).toMatch(/stops short of the foul line/);
    const long = slide(newShuffleboard(shuffleboard15, 2, 1), 0, "r1", 1000);
    expect(puck(long, "r1").out).toBe("bounds");
    expect(long.narration).toMatch(/slides off the board/);
    // Off a side, too.
    const wide = slide(newShuffleboard(shuffleboard15, 2, 1), 0, "r1", 700, 3500, 30000);
    expect(puck(wide, "r1").out).toBe("bounds");
    // Either way the turn passes and the puck is spent.
    for (const s of [short, long, wide]) expect([s.turn, s.thrown, on(s)]).toEqual([1, [1, 0], ["b1"]]);
  });

  it("knocks a puck off the end, and leaves the one that hit it near where it was", () => {
    const s = board({ r1: [2000, 600] });
    expect(s.turn).toBe(1);
    const after = slide(s, 1, "b1", Math.round(powerTo(600) * 1.25));
    expect(puck(after, "r1").out).toBe("bounds");
    expect(after.narration).toMatch(/1 red puck is knocked off/);
    expect(puck(after, "b1").out).toBeUndefined();
    expect(puck(after, "b1").y).toBeLessThan(2400);
  });

  it("takes off any puck that is not wholly past the foul line when a slide comes to rest", () => {
    // Red's puck has been left straddling the line (moved there by hand here, as a knock would).
    const s = board({ r1: [2000, 5300] });
    puck(s, "r1").y = 5400;
    const after = slide(s, 1, "b1", powerTo(600), 3000);
    expect(puck(after, "r1").out).toBe("short");
    expect(after.narration).toMatch(/1 red puck is knocked off/);
    expect(on(after)).toEqual(["b1", "r2"]);
  });

  it("counts only the side that is furthest down, for its pucks beyond the other side's best", () => {
    const bodies = (pucks: Record<string, number>) => Object.entries(pucks).map(([id, y]) => ({ id, x: 2000, y, r: 250 }));
    // Red has the best two; blue's best beats red's third.
    expect(shuffleboardCount(bodies({ r1: 500, r2: 1500, b1: 1800, r3: 3000, b2: 4000 }))).toEqual({ side: 0, pucks: [{ id: "r1", worth: 3 }, { id: "r2", worth: 2 }], points: 5 });
    expect(shuffleboardCount(bodies({ b1: 200, r1: 500 }))).toMatchObject({ side: 1, points: 4 });
    expect(shuffleboardCount(bodies({ b1: 200, r1: 500 }), false)).toMatchObject({ side: 1, points: 3 });
    // One side alone on the board scores for everything it has.
    expect(shuffleboardCount(bodies({ b1: 600, b2: 1700, b3: 3000 }))).toMatchObject({ side: 1, points: 6 });
    // Nothing on the board, or the two best level: nobody.
    expect(shuffleboardCount([])).toEqual({ side: null, pucks: [], points: 0 });
    expect(shuffleboardCount(bodies({ r1: 800, b1: 800 }))).toMatchObject({ side: null, points: 0 });
    // A puck off the board counts for nothing.
    expect(shuffleboardCount([{ id: "r1", x: 2000, y: 500, r: 250, out: "bounds" }, { id: "b1", x: 2000, y: 3000, r: 250 }])).toMatchObject({ side: 1, points: 1 });
  });

  it("ends the round when all eight are slid, and whoever scored slides first in the next", () => {
    const s = board({ r1: [600, 3000], b1: [1200, 3200], r2: [1800, 700], b2: [2400, 3400], r3: [3000, 3600], b3: [3400, 3800], r4: [900, 4500] });
    expect(s.turn).toBe(1);
    expect(shuffleboard.view(s, 1).players[1]!.badge).toBe("The hammer");
    // Blue's last, the hammer, goes off the end and changes nothing.
    const after = slide(s, 1, "b4", 1000, 3400);
    expect(after.phase).toBe("round");
    // Red's best (the 3) and its puck at 3000 both lie beyond blue's best at 3200.
    expect(after.points).toEqual([4, 0]);
    expect(after.result).toMatchObject({ title: "Round 1 to Red", rows: [{ values: ["3 + 1", ""] }, { values: ["+4", ""] }, { values: ["4", "0"] }] });
    const v = shuffleboard.view(after, 0);
    expect(v.shoot).toBeNull();
    expect(v.choices?.options[0]).toMatchObject({ move: { type: "next" } });
    expect(() => slide(after, 0, "r1", 500)).toThrow(GameError);
    // Both move on: round 2, with red (who scored) first, so blue has the hammer again.
    const next = shuffleboard.apply(shuffleboard.apply(after, 0, { type: "next" }), 1, { type: "next" });
    expect(next).toMatchObject({ phase: "playing", hand: 2, turn: 0, thrown: [0, 0], first: 0 });
    expect(on(next)).toEqual(["r1"]);
    expect(shuffleboard.view(next, 0).table.key).toBe("shuffleboard/2");
  });

  it("gives the first slide to the other side when nobody scored", () => {
    const s = board({}, shuffleboard15, { thrown: [4, 3], turn: 1 });
    for (const b of s.world.bodies) b.out = b.id === "b4" ? undefined : "bounds";
    delete puck(s, "b4").out;
    Object.assign(puck(s, "b4"), { x: 2000, y: 11200 });
    const after = slide(s, 1, "b4", 1000);
    expect(after).toMatchObject({ phase: "round", points: [0, 0] });
    expect(after.result?.title).toBe("Round 1: nobody scores");
    const next = shuffleboard.apply(shuffleboard.apply(after, 0, { type: "next" }), 1, { type: "next" });
    expect(next).toMatchObject({ first: 1, turn: 1 });
    expect(on(next)).toEqual(["b1"]);
  });

  it("is won by the side that reaches the target", () => {
    const s = board({ r1: [600, 3000], b1: [1200, 3200], r2: [1800, 700], b2: [2400, 3400], r3: [3000, 3600], b3: [3400, 3800], r4: [900, 4500] }, shuffleboard11, { points: [8, 9] });
    const after = slide(s, 1, "b4", 1000, 3400);
    expect(after.phase).toBe("finished");
    expect(after.points).toEqual([12, 9]);
    expect(after.winners).toEqual([0]);
    expect(after.over).toMatch(/\{0\} wins, 12 to 9!/);
    expect(shuffleboard.summary(after)).toMatchObject({ over: true, winners: [0], scoreLine: "12 to 9", order: [0, 1] });
    expect(shuffleboard.view(after, 1).over).toMatchObject({ winners: [0] });
  });

  it("refuses a slide that isn't yours, your next puck, or on the line", () => {
    const s = newShuffleboard(shuffleboard15, 2, 1);
    const shot = (over: Partial<Extract<ShuffleboardMove, { type: "shot" }>>): ShuffleboardMove => ({ type: "shot", body: "r1", angle: UP, power: 600, ...over });
    expect(() => shuffleboard.apply(s, 1, shot({ body: "b1" }))).toThrow(/not your slide/);
    expect(() => shuffleboard.apply(s, 0, shot({ body: "r2" }))).toThrow(/your own next puck/);
    expect(() => shuffleboard.apply(s, 0, shot({ body: "b1" }))).toThrow(/your own next puck/);
    expect(() => shuffleboard.apply(s, 0, shot({ at: 400 }))).toThrow(/on the line/);
    expect(() => shuffleboard.apply(s, 0, shot({ at: 3501 }))).toThrow(/on the line/);
    expect(() => shuffleboard.apply(s, 0, shot({ power: 20 }))).toThrow(/too soft or too hard/);
    expect(() => shuffleboard.apply(s, 0, shot({ angle: 36000 }))).toThrow(/Aim/);
    expect(() => shuffleboard.apply(s, 0, shot({ spin: 300 }))).toThrow(/no spin/);
    expect(() => shuffleboard.apply(s, 0, { type: "next" })).toThrow(/isn't finished/);
    // And it never changes the state it was given.
    const before = JSON.stringify(s);
    shuffleboard.apply(s, 0, shot({}));
    expect(JSON.stringify(s)).toBe(before);
  });

  it("has partners take turns with their side's pucks", () => {
    let s = newShuffleboard(shuffleboard15, 4, 1);
    const order: number[] = [];
    for (let i = 0; i < 8; i++) {
      order.push(s.turn);
      const side = s.turn % 2;
      s = slide(s, s.turn, `${side === 0 ? "r" : "b"}${s.thrown[side]! + 1}`, powerTo(3000 + i * 250), 800 + i * 350);
    }
    // Red is seats 0 and 2, blue 1 and 3: each slides two of its side's four.
    expect(order).toEqual([0, 1, 2, 3, 0, 1, 2, 3]);
    expect(s.phase).toBe("round");
    expect(shuffleboard.view(s, 2).teams).toBe(true);
  });

  it("gives a computer player slides that score", () => {
    let s = newShuffleboard(shuffleboard15, 2, 3);
    let n = 7;
    const rand = () => ((n = (n * 1103515245 + 12345) & 0x7fffffff) / 0x80000000);
    for (let i = 0; i < 400 && s.phase !== "finished"; i++) {
      for (let seat = 0; seat < 2; seat++) {
        const move = shuffleboard.bot(s, seat, { skill: 0.9 }, rand);
        if (move) s = shuffleboard.apply(s, seat, move);
      }
    }
    expect(s.phase).toBe("finished");
    expect(s.points[0] + s.points[1]).toBeGreaterThan(10);
  });
});
