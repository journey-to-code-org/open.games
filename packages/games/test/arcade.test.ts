// Every arcade game on the kit, the way kit.test.ts checks every card game: computer pilots play
// with every preset at every crew size, the same seed and inputs always give the same game to the
// bit, a log replays to the same score, a stored game carries on where it left off, nothing in a
// state is anything but a whole number, and controls from outside can't break a step.
import { mulberry32 } from "@journey-to-code/rules";
import { describe, expect, it } from "vitest";
import { ARCADE_GAMES, arcadeGame, isArcadeGame, isKitGame, recorder, replay, snapshot, verifyScore, type ArcadeGame, type ArcadeView } from "../src/index.js";

const STYLES = [{ skill: 1, sloppy: 0 }, { skill: 0.3, sloppy: 0.3 }, {}, { skill: 0.7, sloppy: 0.05 }];

/** Computer pilots fly for `ticks` (or until it's over), with seeded carelessness. Returns the state and the log. */
function fly(game: ArcadeGame<any, any, any>, rules: unknown, seats: number, seed: number, ticks: number) {
  const state = game.newGame(game.normalize(rules), seats, seed);
  const rand = mulberry32(seed ^ 0x5eed);
  const rec = recorder(game, seats);
  for (let t = 0; t < ticks && !game.summary(state).over; t++) {
    const inputs = Array.from({ length: seats }, (_, seat) => game.bot(state, seat, STYLES[seat % STYLES.length]!, rand));
    game.step(state, rec.tick(inputs));
  }
  return { state, log: rec.log };
}

function checkView(game: ArcadeGame<any, any, any>, v: ArcadeView, seats: number) {
  expect(v.game).toBe(game.id);
  expect(v.rate).toBe(game.rate);
  expect(v.seats).toBe(seats);
  expect(v.pilots).toHaveLength(seats);
  expect(v.field.width).toBeGreaterThan(0);
  expect(v.field.height).toBeGreaterThan(0);
  const ids = new Set<number>();
  for (const t of v.things) {
    expect(ids.has(t.id), `two things with id ${t.id}`).toBe(false);
    ids.add(t.id);
    expect(t.kind).toBeTruthy();
    expect(t.r).toBeGreaterThan(0);
    expect(Number.isFinite(t.x) && Number.isFinite(t.y)).toBe(true);
    if (t.health !== undefined) expect(t.health >= 0 && t.health <= 1000).toBe(true);
    if (t.seat !== undefined) expect(t.seat >= 0 && t.seat < seats).toBe(true);
  }
  expect(v.stage).toBeTruthy();
}

/** Every number anywhere in a state is whole: nothing that could round differently on another machine. */
function expectWhole(value: unknown, path = "state") {
  if (typeof value === "number") expect(Number.isSafeInteger(value), `${path} = ${value}`).toBe(true);
  else if (Array.isArray(value)) value.forEach((v, i) => expectWhole(v, `${path}[${i}]`));
  else if (value && typeof value === "object") for (const [k, v] of Object.entries(value)) expectWhole(v, `${path}.${k}`);
}

describe("the arcade registry", () => {
  it("knows its games, and keeps them apart from the turn-taking ones", () => {
    for (const game of ARCADE_GAMES) {
      expect(isArcadeGame(game.id)).toBe(true);
      expect(arcadeGame(game.id)).toBe(game);
      expect(isKitGame(game.id)).toBe(false);
      expect(game.category).toBe("arcade");
    }
    expect(isArcadeGame("hearts")).toBe(false);
    expect(arcadeGame("nope")).toBeUndefined();
  });
});

describe.each(ARCADE_GAMES.map((g) => [g.name, g] as const))("%s", (_name, game) => {
  const sizes = Array.from({ length: game.seats.max - game.seats.min + 1 }, (_, i) => game.seats.min + i);

  it("describes itself", () => {
    expect(game.name && game.emoji && game.blurb && game.tagline).toBeTruthy();
    expect(game.rate).toBeGreaterThan(0);
    expect(game.controls.length).toBeGreaterThan(0);
    expect(game.presets.length).toBeGreaterThan(0);
    for (const preset of game.presets) {
      expect(game.validate(preset)).toEqual([]);
      expect(game.normalize(preset)).toEqual(preset);
      expect(game.describe(preset).length).toBeGreaterThan(0);
    }
    expect(game.normalize(null)).toEqual(game.presets[0]);
    expect(game.normalize({ id: game.presets.at(-1)!.id })).toEqual(game.presets.at(-1));
    const keys = Object.keys(game.presets[0]!);
    for (const field of game.fields) expect(keys).toContain(field.key);
  });

  it.each(game.presets.flatMap((p) => sizes.map((n) => [p.name, n, p] as const)))("computer pilots fly %s with a crew of %i", (_preset, seats, preset) => {
    const state = game.newGame(game.normalize(preset), seats, 11 + seats);
    const rand = mulberry32(99);
    for (let t = 0; t < game.rate * 45 && !game.summary(state).over; t++) {
      game.step(state, Array.from({ length: seats }, (_, seat) => game.bot(state, seat, STYLES[(seat + 1) % STYLES.length]!, rand)));
      if (t % 97 === 0) checkView(game, game.view(state), seats);
    }
    const sum = game.summary(state);
    expect(sum.seats).toBe(seats);
    expect(sum.scores).toHaveLength(seats);
    expect([...sum.order].sort()).toEqual(Array.from({ length: seats }, (_, i) => i));
    expect(sum.score).toBeGreaterThan(0);
    expect(sum.scoreLine).toBeTruthy();
    expect(game.view(state).score).toBe(sum.score);
    expectWhole(state);
    // Plain data: it survives being stored.
    expect(JSON.parse(JSON.stringify(state))).toEqual(state);
  });

  it("gives the same game for the same seed and inputs, and a different one for a different seed", () => {
    for (const seats of sizes) {
      const a = fly(game, game.presets[0], seats, 7, game.rate * 30);
      const b = fly(game, game.presets[0], seats, 7, game.rate * 30);
      expect(b.state).toEqual(a.state);
      expect(b.log).toEqual(a.log);
      const c = fly(game, game.presets[0], seats, 8, game.rate * 30);
      expect(c.state).not.toEqual(a.state);
    }
  });

  it("replays a log to the same game, and can tell an earned score from a claimed one", () => {
    const seats = game.seats.max;
    const { state, log } = fly(game, game.presets[0], seats, 21, game.rate * 40);
    // The log is far shorter than a line a tick.
    expect(log.changes.length).toBeLessThan(log.ticks * seats);
    const again = replay(game, game.presets[0], seats, 21, JSON.parse(JSON.stringify(log)));
    expect(again).toEqual(state);
    const score = game.summary(state).score;
    expect(verifyScore(game, game.presets[0], seats, 21, log, score)).toBe(true);
    expect(verifyScore(game, game.presets[0], seats, 21, log, score + 10)).toBe(false);
    expect(verifyScore(game, game.presets[0], seats, 22, log, score)).toBe(false);
    expect(verifyScore(game, game.presets[0], seats, 21, { changes: [], ticks: -1 }, 0)).toBe(false);
    expect(verifyScore(game, game.presets[0], seats, 21, { changes: [], ticks: 1e12 }, 0)).toBe(false);
  });

  it("carries on from a stored game exactly as it would have", () => {
    const seats = game.seats.max;
    const { state } = fly(game, game.presets[0], seats, 5, game.rate * 15);
    const stored = JSON.parse(JSON.stringify(state));
    const kept = snapshot(state);
    const randA = mulberry32(3);
    const randB = mulberry32(3);
    for (let t = 0; t < game.rate * 15; t++) {
      game.step(state, Array.from({ length: seats }, (_, seat) => game.bot(state, seat, STYLES[0]!, randA)));
      game.step(stored, Array.from({ length: seats }, (_, seat) => game.bot(stored, seat, STYLES[0]!, randB)));
    }
    expect(stored).toEqual(state);
    // And the snapshot is still where it was.
    expect(kept).not.toEqual(state);
  });

  it("ends when nobody touches the controls, and stays ended", () => {
    for (const preset of game.presets) {
      const state = game.newGame(game.normalize(preset), 1, 3);
      let ticks = 0;
      while (!game.summary(state).over && ticks++ < game.rate * 60 * 20) game.step(state, []);
      expect(game.summary(state).over, preset.name).toBe(true);
      expect(game.view(state).over).toBe(true);
      const after = snapshot(state);
      game.step(state, [game.idle]);
      expect(state).toEqual(after);
    }
  });

  it("makes controls from outside safe", () => {
    const junk: unknown[] = [null, undefined, 7, "left", [], {}, { dx: "9", dy: NaN, fire: 1, bomb: "yes" }, { dx: Infinity, dy: -Infinity }, { dx: 1e9, dy: -1e9, fire: true, bomb: true }, { dx: 0.5, dy: -0.5 }];
    for (const given of junk) {
      const input = game.input(given);
      expectWhole(input, "input");
      expect(game.input(input)).toEqual(input);
    }
    expect(game.input(null)).toEqual(game.idle);
    expect(game.input(game.idle)).toEqual(game.idle);
    const state = game.newGame(game.normalize(null), game.seats.max, 9);
    for (let t = 0; t < game.rate * 5; t++) game.step(state, junk.slice(t % junk.length) as never);
    expectWhole(state);
  });
});
