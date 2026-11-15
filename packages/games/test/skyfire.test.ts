// Skyfire's own rules: what costs a ship and what doesn't, what a bomb does, how the score is made
// (chains, grazes, medals, perfect waves), extra ships, and that a boss turns up on the fifth wave.
import { mulberry32 } from "@journey-to-code/rules";
import { describe, expect, it } from "vitest";
import { SKYFIRE_FIELD, SKYFIRE_PRESETS, SKYFIRE_SPEED, skyfire, type SkyfireInput, type SkyfireState } from "../src/index.js";

const ARCADE = SKYFIRE_PRESETS[0]!;
const still: SkyfireInput = { dx: 0, dy: 0, fire: false, bomb: false };
/** A game with the opening wave held off, so a test has the field to itself. */
function quiet(seats = 1, rules = ARCADE): SkyfireState {
  const s = skyfire.newGame(rules, seats, 1);
  skyfire.step(s, []);
  s.queue = [];
  s.waveDeadline = 1e9;
  s.clearedAt = 0;
  s.waveSpawned = 1; // "something is still to come": the next wave doesn't start
  s.foes = [];
  for (const p of s.pilots) p.ghost = 0;
  // A far-off foe that does nothing keeps the wave open.
  s.foes.push({ id: 9000, kind: "gunship", x: 3000, y: -5000, vx: 0, vy: 0, r: 10, hp: 1e6, max: 1e6, t: -1e7, a: -5000, b: 0, cool: 1e9, worth: 0, wave: -1 });
  return s;
}
const bullet = (s: SkyfireState, x: number, y: number, vx = 0, vy = 0) => s.bullets.push({ id: s.nextId++, x, y, vx, vy, r: 70, tone: "pink", grazed: 0 });
const foe = (s: SkyfireState, x: number, y: number, hp = 10) => s.foes.push({ id: s.nextId++, kind: "drone", x, y, vx: 0, vy: 0, r: 200, hp, max: hp, t: 0, a: 0, b: 0, cool: 1e9, worth: 100, wave: -1 });
const kinds = (s: SkyfireState) => s.events.map((e) => e.kind);

describe("Shitstorm (skyfire)", () => {
  it("starts every pilot at the bottom, spread across the field", () => {
    const s = skyfire.newGame(ARCADE, 4, 1);
    expect(s.pilots.map((p) => p.x)).toEqual([1200, 2400, 3600, 4800]);
    expect(s.pilots.every((p) => p.lives === 3 && p.bombs === 3 && p.power === 1)).toBe(true);
    expect(skyfire.newGame(ARCADE, 9, 1).seats).toBe(4);
    expect(skyfire.newGame(ARCADE, 0, 1).seats).toBe(1);
  });

  it("moves no faster on a diagonal, and keeps the ship on the field", () => {
    const input = skyfire.input({ dx: 999, dy: 999 });
    expect(input.dx * input.dx + input.dy * input.dy).toBeLessThanOrEqual(SKYFIRE_SPEED * SKYFIRE_SPEED);
    expect(skyfire.input({ dx: 999, dy: 0 }).dx).toBe(SKYFIRE_SPEED);
    const s = quiet();
    for (let t = 0; t < 300; t++) skyfire.step(s, [{ dx: -SKYFIRE_SPEED, dy: SKYFIRE_SPEED, fire: false, bomb: false }]);
    const p = s.pilots[0]!;
    expect(p.x).toBeGreaterThanOrEqual(0);
    expect(p.y).toBeLessThanOrEqual(SKYFIRE_FIELD.height);
    for (let t = 0; t < 300; t++) skyfire.step(s, [{ dx: SKYFIRE_SPEED, dy: -SKYFIRE_SPEED, fire: false, bomb: false }]);
    expect(p.x).toBeLessThanOrEqual(SKYFIRE_FIELD.width);
    expect(p.y).toBeGreaterThanOrEqual(0);
  });

  it("costs a ship when a bullet reaches the middle of it, and only then", () => {
    const s = quiet();
    const p = s.pilots[0]!;
    bullet(s, p.x + 200, p.y); // inside the ship's outline, outside its core
    skyfire.step(s, [still]);
    expect(p.lives).toBe(3);
    bullet(s, p.x, p.y);
    skyfire.step(s, [still]);
    expect(p.lives).toBe(2);
    expect(kinds(s)).toContain("down");
    // The next ship flies in after a moment and can't be hurt at first.
    expect(skyfire.view(s).things.some((t) => t.kind === "ship")).toBe(false);
    for (let t = 0; t < 80; t++) skyfire.step(s, [still]);
    expect(p.down).toBe(0);
    expect(p.ghost).toBeGreaterThan(0);
    bullet(s, p.x, p.y);
    skyfire.step(s, [still]);
    expect(p.lives).toBe(2);
    expect(skyfire.view(s).things.find((t) => t.kind === "ship")?.ghost).toBe(true);
  });

  it("scores a graze once a bullet, and keeps a chain alive with it", () => {
    const s = quiet();
    const p = s.pilots[0]!;
    bullet(s, p.x + 200, p.y);
    skyfire.step(s, [still]);
    expect(p.grazes).toBe(1);
    expect(p.score).toBe(20);
    skyfire.step(s, [still]);
    expect(p.grazes).toBe(1);
    p.chain = 12; // ×3
    p.chainTimer = 50;
    bullet(s, p.x - 200, p.y);
    skyfire.step(s, [still]);
    expect(p.score).toBe(20 + 20 * 3);
    expect(p.chainTimer).toBeGreaterThan(50);
  });

  it("sets a bomb off once a press: it clears the bullets and keeps the ship safe", () => {
    const s = quiet();
    const p = s.pilots[0]!;
    for (let i = 0; i < 20; i++) bullet(s, 500 + i * 250, 3000, 0, 20);
    foe(s, 3000, 2000, 50);
    const press: SkyfireInput = { ...still, bomb: true };
    skyfire.step(s, [press]);
    expect(p.bombs).toBe(2);
    expect(s.bullets).toHaveLength(0);
    expect(kinds(s)).toContain("bomb");
    expect(skyfire.view(s).things.some((t) => t.kind === "blast")).toBe(true);
    bullet(s, p.x, p.y);
    for (let t = 0; t < 120; t++) skyfire.step(s, [press]); // still held: no second bomb
    expect(p.bombs).toBe(2);
    expect(p.lives).toBe(3);
    // The foe caught in it is the bomber's kill.
    expect(p.kills).toBe(1);
    skyfire.step(s, [still]);
    skyfire.step(s, [press]);
    expect(p.bombs).toBe(1);
    p.bombs = 0;
    p.bombing = 0;
    skyfire.step(s, [still]);
    skyfire.step(s, [press]);
    expect(kinds(s)).not.toContain("bomb");
  });

  it("builds a multiplier from a chain of kills, and loses it when the chain runs out or the ship is hit", () => {
    const s = quiet();
    const p = s.pilots[0]!;
    const fire: SkyfireInput = { ...still, fire: true };
    for (let n = 0; n < 12; n++) {
      foe(s, p.x, p.y - 1200);
      for (let t = 0; t < 12; t++) skyfire.step(s, [fire]);
    }
    expect(p.kills).toBe(12);
    expect(p.chain).toBe(12);
    const before = p.score;
    foe(s, p.x, p.y - 1200);
    for (let t = 0; t < 12 && p.kills < 13; t++) skyfire.step(s, [fire]);
    // The thirteenth kill, at ×3: 100 × 3, and 10 a hit.
    expect(p.score - before).toBeGreaterThanOrEqual(300);
    expect(skyfire.view(s).pilots[0]!.stats.find((st) => st.key === "multiplier")!.value).toBe(3);
    for (let t = 0; t < 160; t++) skyfire.step(s, [still]);
    expect(p.chain).toBe(0);
    p.chain = 30;
    p.chainTimer = 100;
    bullet(s, p.x, p.y);
    skyfire.step(s, [still]);
    expect(p.chain).toBe(0);
  });

  it("gives more guns for power, and leaves some behind when a ship is lost", () => {
    const s = quiet();
    const p = s.pilots[0]!;
    const shotsAt = (power: number) => {
      p.power = power;
      p.cool = 0;
      s.shots = [];
      skyfire.step(s, [{ ...still, fire: true }]);
      return s.shots.length;
    };
    expect([1, 2, 3, 4, 5].map(shotsAt)).toEqual([2, 3, 5, 6, 8]);
    s.shots = [];
    p.power = 2;
    s.drops.push({ id: s.nextId++, kind: "power", x: p.x, y: p.y });
    skyfire.step(s, [still]);
    expect(p.power).toBe(3);
    bullet(s, p.x, p.y);
    skyfire.step(s, [still]);
    expect(p.power).toBe(2);
    expect(s.drops.some((d) => d.kind === "power")).toBe(true);
    // At full power a pickup is points instead.
    const t = quiet();
    const q = t.pilots[0]!;
    q.power = 5;
    t.drops.push({ id: t.nextId++, kind: "power", x: q.x, y: q.y });
    skyfire.step(t, [still]);
    expect(q.power).toBe(5);
    expect(q.score).toBe(2000);
  });

  it("pays more for each medal in a row, and starts again when one falls", () => {
    const s = quiet();
    const p = s.pilots[0]!;
    const medal = (x: number, y: number) => s.drops.push({ id: s.nextId++, kind: "medal", x, y });
    for (let i = 0; i < 4; i++) {
      medal(p.x, p.y);
      skyfire.step(s, [still]);
    }
    expect(p.score).toBe(100 + 200 + 300 + 500);
    expect(s.medal).toBe(4);
    medal(200, SKYFIRE_FIELD.height + 190); // out of reach, about to fall off
    skyfire.step(s, [still]);
    expect(s.medal).toBe(0);
    expect(kinds(s)).toContain("medal-lost");
    medal(p.x, p.y);
    skyfire.step(s, [still]);
    expect(p.score).toBe(1100 + 100);
    // A drop close by is drawn to the ship.
    const far = { id: s.nextId++, kind: "medal" as const, x: p.x + 900, y: p.y };
    s.drops.push(far);
    skyfire.step(s, [still]);
    expect(far.x).toBeLessThan(p.x + 900);
  });

  it("costs a ship to fly into a foe", () => {
    const s = quiet();
    const p = s.pilots[0]!;
    foe(s, p.x, p.y, 1000);
    skyfire.step(s, [still]);
    expect(p.lives).toBe(2);
  });

  it("is over when the last ship is gone, with the crew ranked by score", () => {
    const s = quiet(2);
    const [a, b] = s.pilots as [SkyfireState["pilots"][number], SkyfireState["pilots"][number]];
    a.lives = b.lives = 1;
    a.score = 500;
    b.score = 900;
    bullet(s, a.x, a.y);
    skyfire.step(s, [still, still]);
    expect(a.out).toBe(true);
    expect(skyfire.summary(s).over).toBe(false);
    expect(skyfire.view(s).pilots.map((p) => p.playing)).toEqual([false, true]);
    bullet(s, b.x, b.y);
    skyfire.step(s, [still, still]);
    const sum = skyfire.summary(s);
    expect(sum.over).toBe(true);
    expect(sum.score).toBe(1400);
    expect(sum.order).toEqual([1, 0]);
    expect(sum.scoreLine).toContain("1,400");
    expect(kinds(s)).toContain("over");
    expect(skyfire.view(s).banner).toBe("Game over");
    expect(skyfire.bot(s, 0, {})).toEqual(skyfire.idle);
  });

  it("gives an extra ship for the crew's score, to whoever is out first", () => {
    const s = quiet(2);
    const [a, b] = s.pilots as [SkyfireState["pilots"][number], SkyfireState["pilots"][number]];
    a.out = true;
    a.lives = 0;
    b.score = 299_990;
    b.x = 3000;
    foe(s, b.x, b.y - 1200);
    for (let t = 0; t < 12; t++) skyfire.step(s, [still, { ...still, fire: true }]);
    expect(a.out).toBe(false);
    expect(a.lives).toBe(1);
    expect(a.ghost).toBeGreaterThan(0);
    expect(s.nextExtend).toBe(1_000_000);
    // And none when the house rules say so.
    const t = quiet(1, SKYFIRE_PRESETS.find((p) => p.id === "oneship")!);
    t.pilots[0]!.score = 5_000_000;
    skyfire.step(t, [still]);
    expect(t.pilots[0]!.lives).toBe(1);
  });

  it("pays a bonus for a wave with nothing left and nothing escaped", () => {
    const wave = (escaped: number) => {
      const s = skyfire.newGame(ARCADE, 2, 4);
      skyfire.step(s, []);
      s.queue = [];
      s.foes = [];
      s.wave = 3;
      s.waveSpawned = 12;
      s.waveKilled = 12 - escaped;
      s.waveEscaped = escaped;
      s.pilots[1]!.out = true;
      for (let t = 0; t < 80 && s.wave === 3; t++) skyfire.step(s, [still, still]);
      expect(s.wave).toBe(4);
      return s;
    };
    const perfect = wave(0);
    expect(kinds(perfect)).toContain("perfect");
    // 1,000 a wave, to everyone still flying.
    expect(perfect.pilots.map((p) => p.score)).toEqual([3000, 0]);
    const leaky = wave(1);
    expect(kinds(leaky)).not.toContain("perfect");
    expect(leaky.pilots[0]!.score).toBe(0);
  });

  it("sends a boss on the fifth wave, with its own health bar, and rewards whoever brings it down", () => {
    const s = skyfire.newGame(SKYFIRE_PRESETS.find((p) => p.id === "cadet")!, 1, 2);
    const rand = mulberry32(2);
    let seen = false;
    let down = false;
    for (let t = 0; t < 60 * 60 * 5 && !down; t++) {
      s.pilots[0]!.ghost = 5;
      skyfire.step(s, [skyfire.bot(s, 0, { skill: 1, sloppy: 0 }, rand)]);
      const v = s.tick % 30 === 0 ? skyfire.view(s) : null;
      if (v?.boss) {
        seen = true;
        expect(s.wave).toBe(5);
        expect(v.boss.name).toBeTruthy();
        expect(v.stage).toContain("Boss");
        expect(skyfire.summary(s).phase).toBe("boss");
      }
      down = kinds(s).includes("boss-down");
    }
    expect(seen).toBe(true);
    expect(down).toBe(true);
    expect(s.bullets).toHaveLength(0);
    expect(s.drops.length).toBeGreaterThanOrEqual(10);
  });

  it("gets harder: later waves bring more, and faster", () => {
    const count = (wave: number) => {
      const s = skyfire.newGame(ARCADE, 1, 6);
      skyfire.step(s, []);
      s.wave = wave - 1;
      s.queue = [];
      s.foes = [];
      s.clearedAt = 1;
      s.tick += 100;
      skyfire.step(s, []);
      expect(s.wave).toBe(wave);
      return s.queue.length + s.foes.length;
    };
    expect(count(12)).toBeGreaterThan(count(2));
  });
});
