// Flick Football's own rules. The shared sport tests (sport.test.ts) play whole games of it; these
// put the football somewhere and look at what one flick does.
import { validateWorld } from "@journey-to-code/physics";
import { describe, expect, it } from "vitest";
import { flickFootball, flickFootball14, flickFootball21, flickFootballTouchdown, newFlickFootball, type FlickFootballState } from "../src/index.js";

const UP = 27000;
const DOWN = 9000;
const ball = (s: FlickFootballState) => s.world.bodies.find((b) => b.id === "ball")!;
/** How hard to flick for the football to stop `d` away. */
const powerTo = (d: number) => Math.round((Math.sqrt(2 * 3500 * d) / 9000) * 1000);
const flick = (s: FlickFootballState, seat: number, power: number, angle: number, at?: number) => flickFootball.apply(s, seat, { type: "shot", body: "ball", angle, power, ...(at === undefined ? {} : { at }) });
/** The football lying at rest here, for this seat to flick. */
const lying = (x: number, y: number, turn: number, change: Partial<FlickFootballState> = {}): FlickFootballState => {
  const s = newFlickFootball(flickFootball21, 2, 1);
  return { ...s, mode: "flick", turn, world: { ...s.world, bodies: [{ id: "ball", x, y, r: 260 }] }, ...change };
};

describe("flick football", () => {
  it("starts with a kickoff from the bottom end", () => {
    const s = newFlickFootball(flickFootball21, 2, 1);
    expect(s).toMatchObject({ mode: "kickoff", turn: 0, points: [0, 0] });
    expect(ball(s)).toMatchObject({ x: 2250, y: 8300 });
    expect(validateWorld(s.world)).toEqual([]);
    const v = flickFootball.view(s, 0);
    expect(v.shoot).toMatchObject({ body: "ball", place: { y: 8300, min: 600, max: 3900 } });
    expect(flickFootball.view(s, 1).shoot).toBeNull();
    expect(flickFootball.seats).toEqual({ min: 2, max: 2, default: 2 });
  });

  it("knows a touchdown: on the table, its middle past the end line", () => {
    expect(flickFootballTouchdown(259, 0)).toBe(true);
    expect(flickFootballTouchdown(0, 0)).toBe(true);
    expect(flickFootballTouchdown(260, 0)).toBe(false);
    expect(flickFootballTouchdown(-1, 0)).toBe(false);
    expect(flickFootballTouchdown(8741, 1)).toBe(true);
    expect(flickFootballTouchdown(8740, 1)).toBe(false);
    expect(flickFootballTouchdown(100, 1)).toBe(false);
  });

  it("leaves a flick that stops on the table where it lies, for the other player", () => {
    const s = flick(newFlickFootball(flickFootball21, 2, 1), 0, powerTo(4000), UP, 1500);
    expect(s).toMatchObject({ mode: "flick", turn: 1, flicks: 1, strikes: [0, 0] });
    expect(ball(s).x).toBe(1500);
    expect(ball(s).y).toBeGreaterThan(4000);
    expect(ball(s).y).toBeLessThan(4600);
    // From where it lies: it can't be picked up and put down.
    expect(flickFootball.view(s, 1).shoot?.place).toBeUndefined();
    expect(() => flick(s, 1, 300, DOWN, 2000)).toThrow(/from where it lies/);
  });

  it("scores a touchdown for a football hanging over the far edge, then a kick for the extra point", () => {
    const td = flick(lying(2000, 1000, 0), 0, powerTo(880), UP);
    expect(td.points).toEqual([6, 0]);
    expect(td).toMatchObject({ mode: "kick", worth: 1, turn: 0 });
    expect(td.narration).toMatch(/Touchdown/);
    expect(td.world.bodies.map((b) => b.id)).toEqual(["ball", "post-l", "post-r"]);
    expect(validateWorld(td.world)).toEqual([]);
    expect(flickFootball.view(td, 0).shoot).toMatchObject({ place: { y: 5000 } });
    // Straight between the posts and off the end: good, and the other player kicks off from the top.
    const good = flick(td, 0, 950, UP);
    expect(good.points).toEqual([7, 0]);
    expect(good).toMatchObject({ mode: "kickoff", turn: 1 });
    expect(ball(good)).toMatchObject({ x: 2250, y: 700 });
    expect(good.world.bodies).toHaveLength(1);
    // Wide of the posts, or short of them: no good.
    expect(flick(td, 0, 950, UP + 1500).points).toEqual([6, 0]);
    expect(flick(td, 0, 300, UP).points).toEqual([6, 0]);
    // The kick is not a flick.
    expect(good.flicks).toBe(td.flicks);
  });

  it("scores at the bottom for the player at the top", () => {
    const td = flick(lying(2000, 8000, 1), 1, powerTo(880), DOWN);
    expect(td.points).toEqual([0, 6]);
    expect(td.world.bodies.find((b) => b.id === "post-l")?.y).toBe(8880);
    expect(flick(td, 1, 950, DOWN).points).toEqual([0, 7]);
  });

  it("counts a strike for a football flicked off the table, and gives a kick for 3 on the third", () => {
    const one = flick(lying(2000, 1000, 0), 0, 900, UP);
    expect(one).toMatchObject({ strikes: [1, 0], mode: "kickoff", turn: 1, points: [0, 0] });
    const three = flick(lying(2000, 1000, 0, { strikes: [2, 1] }), 0, 900, UP);
    expect(three).toMatchObject({ strikes: [0, 1], mode: "kick", worth: 3, turn: 1 });
    const good = flick(three, 1, 950, DOWN);
    expect(good.points).toEqual([0, 3]);
    // Whoever struck out kicks off.
    expect(good).toMatchObject({ mode: "kickoff", turn: 0 });
  });

  it("ends at the target, after the extra point is tried", () => {
    const td = flick(lying(2000, 1000, 0, { rules: flickFootball14, points: [7, 0] }), 0, powerTo(880), UP);
    expect(td.phase).toBe("playing");
    const done = flick(td, 0, 950, UP);
    expect(done).toMatchObject({ phase: "finished", points: [14, 0], winners: [0] });
    expect(() => flick(done, 1, 300, DOWN)).toThrow(/over/);
  });

  it("ends when the flicks run out, and whoever is ahead wins", () => {
    const done = flick(lying(2000, 5000, 1, { flicks: 59, points: [6, 3] }), 1, 200, DOWN);
    expect(done).toMatchObject({ phase: "finished", winners: [0] });
    expect(done.over).toMatch(/last flick/);
  });

  it("does not change the state it is given", () => {
    const s = newFlickFootball(flickFootball21, 2, 1);
    const copy = JSON.stringify(s);
    flick(s, 0, 600, UP);
    expect(JSON.stringify(s)).toBe(copy);
  });
});
