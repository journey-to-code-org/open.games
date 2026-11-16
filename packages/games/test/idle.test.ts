// Every idle game on the kit. The promise an idle game makes is that time away is the same time:
// the seconds played all at once when you come back leave the store exactly where playing them one
// by one would have. This holds every registered idle game to that, and to the rest of the kit's
// rules: the same seed gives the same game, every number is whole, a stored game loads to the same
// state, and nothing from outside can break it.
import { describe, expect, it } from "vitest";
import { ALL_GAMES, IDLE_GAMES, clockAt, dollars, idleGame, isArcadeGame, isIdleGame, isKitGame, safeClock, type IdleClock, type IdleGame } from "../src/index.js";

/** A Tuesday, nine in the morning where the player is. */
const START = 1_800_000_000 - (1_800_000_000 % 86400);
const clock = (secondsOn: number): IdleClock => {
  const local = 9 * 3600 + secondsOn;
  return { now: START + secondsOn, minute: Math.floor(local / 60) % 1440, day: (2 + Math.floor(local / 86400)) % 7 };
};

function expectWhole(value: unknown, path = "state") {
  if (typeof value === "number") expect(Number.isSafeInteger(value), `${path} = ${value}`).toBe(true);
  else if (Array.isArray(value)) value.forEach((v, i) => expectWhole(v, `${path}[${i}]`));
  else if (value && typeof value === "object") for (const [k, v] of Object.entries(value)) expectWhole(v, `${path}.${k}`);
}

/** A few commands of every kind a game has, by asking it to make safe whatever it is handed. */
const pokes = (game: IdleGame<any, any, any>): unknown[] => [{ cmd: "hustle" }, { cmd: "tab", approve: true }, { cmd: "hire", who: "tommy" }, { cmd: "train", who: "tommy" }, { cmd: "phones" }, { cmd: "hire", who: "pluto" }, { cmd: "feed" }, { cmd: "radio", pick: 1 }, { cmd: "place", piece: "tommy", square: 4 }, { cmd: "place", piece: "bench", square: 3 }].map((c) => game.command(c));

describe("the clock", () => {
  it("works a past second's time of day back from now's", () => {
    const now = clock(0);
    expect(clockAt(now, now.now)).toEqual(now);
    expect(clockAt(now, now.now - 3600)).toEqual({ now: now.now - 3600, minute: 8 * 60, day: 2 });
    // Back past midnight is yesterday.
    expect(clockAt(now, now.now - 10 * 3600)).toEqual({ now: now.now - 10 * 3600, minute: 23 * 60, day: 1 });
    expect(clockAt({ now: now.now, minute: 30, day: 0 }, now.now - 3600)).toMatchObject({ minute: 23 * 60 + 30, day: 6 });
    // And forward past midnight is tomorrow.
    expect(clockAt(now, now.now + 16 * 3600)).toMatchObject({ minute: 60, day: 3 });
  });

  it("makes a clock from outside safe", () => {
    expect(safeClock(null)).toEqual({ now: 0, minute: 0, day: 0 });
    expect(safeClock({ now: 12.9, minute: 99999, day: -3 })).toEqual({ now: 12, minute: 1439, day: 0 });
    expect(safeClock({ now: NaN, minute: "noon", day: Infinity })).toEqual({ now: 0, minute: 0, day: 0 });
  });

  it("writes money for people", () => {
    expect(dollars(0)).toBe("$0");
    expect(dollars(1999)).toBe("$19.99");
    expect(dollars(120_000)).toBe("$1,200");
    expect(dollars(1_240_000)).toBe("$12.4K");
    expect(dollars(321_000_000)).toBe("$3.21M");
    expect(dollars(-500)).toBe("−$5");
  });
});

describe("the idle registry", () => {
  it("knows its games, and keeps them apart from the others", () => {
    for (const game of IDLE_GAMES) {
      expect(isIdleGame(game.id)).toBe(true);
      expect(idleGame(game.id)).toBe(game);
      expect(isKitGame(game.id)).toBe(false);
      expect(isArcadeGame(game.id)).toBe(false);
      expect(ALL_GAMES.some((g) => g.id === game.id)).toBe(true);
      expect(game.name && game.emoji && game.blurb && game.tagline).toBeTruthy();
    }
    expect(isIdleGame("hearts")).toBe(false);
  });
});

describe.each(IDLE_GAMES.map((g) => [g.name, g] as const))("%s", (_name, game) => {
  /** A store someone has played for a few minutes, so there is something going on in it. */
  function played(seed = 3) {
    const state = game.newGame(seed, clock(0));
    for (let s = 1; s <= 240; s++) for (const poke of pokes(game)) game.act(state, poke, clock(s));
    return state;
  }

  it("leaves the store in the same place whether time away is played at once or a second at a time", () => {
    const together = played();
    const apart = played();
    const inChunks = played();
    expect(apart).toEqual(together);
    const away = 3 * 3600 + 17;
    game.advance(together, clock(240 + away));
    for (let s = 241; s <= 240 + away; s++) game.advance(apart, clock(s));
    for (const stop of [300, 301, 2000, 7000, 240 + away]) game.advance(inChunks, clock(stop));
    expect(apart).toEqual(together);
    expect(inChunks).toEqual(together);
  });

  it("gives the same game for the same seed, and a different one for another", () => {
    const a = played(5);
    const b = played(5);
    const c = played(6);
    game.advance(a, clock(4000));
    game.advance(b, clock(4000));
    game.advance(c, clock(4000));
    expect(b).toEqual(a);
    expect(c).not.toEqual(a);
  });

  it("keeps every number whole, and comes back from storage the same", () => {
    const state = played();
    game.advance(state, clock(6 * 3600));
    expectWhole(state);
    const stored = JSON.parse(JSON.stringify(state));
    expect(stored).toEqual(state);
    const loaded = game.load(stored);
    expect(loaded).toEqual(state);
    // And carries on from there exactly as it would have.
    game.advance(state, clock(7 * 3600));
    game.advance(loaded, clock(7 * 3600));
    expect(loaded).toEqual(state);
    expect(game.score(state)).toBeGreaterThan(0);
  });

  it("refuses what is not one of its own from storage", () => {
    const state = played();
    for (const junk of [null, undefined, 7, "save", [], {}, { v: game.version + 1 }, { ...JSON.parse(JSON.stringify(state)), v: 0 }, { ...JSON.parse(JSON.stringify(state)), cash: -5 }, { ...JSON.parse(JSON.stringify(state)), cash: 1.5 }, { ...JSON.parse(JSON.stringify(state)), t: "now" }]) {
      expect(game.load(junk)).toBeNull();
    }
  });

  it("plays no more than its cap of time away, says so, and picks up at now", () => {
    const state = played();
    const report = game.advance(state, clock(240 + game.awayCap + 5000));
    expect(report.seconds).toBe(game.awayCap);
    expect(report.skipped).toBe(5000);
    expect(report.lines.length).toBeGreaterThan(0);
    expect(report.earned).toBeGreaterThan(0);
    // Up to date: nothing more to play at the same second, or an earlier one.
    expect(game.advance(state, clock(240 + game.awayCap + 5000))).toEqual({ seconds: 0, skipped: 0, lines: [], earned: 0 });
    const before = JSON.parse(JSON.stringify(state));
    game.advance(state, clock(100));
    expect(state).toEqual(before);
    // A moment away is not worth a report.
    expect(game.advance(state, clock(240 + game.awayCap + 5060)).lines).toEqual([]);
  });

  it("makes commands from outside safe, and a view never changes the state", () => {
    const state = played();
    for (const junk of [null, 7, "hire", {}, { cmd: "hire" }, { cmd: "hire", who: "nobody" }, { cmd: "explode" }, { cmd: "tab", approve: "yes" }]) {
      const command = game.command(junk);
      expect(game.command(command)).toEqual(command);
      expect(() => game.act(state, junk as never, clock(241))).not.toThrow();
    }
    expectWhole(state);
    const before = JSON.parse(JSON.stringify(state));
    const view = game.view(state, clock(241));
    expect(view).toBeTruthy();
    expect(state).toEqual(before);
  });
});
