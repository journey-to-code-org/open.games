// The arcade kit: games of reflexes played against the game itself, in real time, by one pilot or
// several at once. A shoot-'em-up, a tower defence, an idle clicker.
//
// The other kits are turn-based: a seat makes a move and the engine answers. An arcade game has a
// clock instead. It runs in ticks (`rate` of them a second), and each tick the engine is handed
// what every seat's controls are doing and moves the whole world on by one step. It is still pure
// and deterministic: the same rules, seats, seed and inputs give the same game to the bit,
// everywhere. That is what the rest is built on:
//
//   - A score can be checked. A run is its seed and a log of when the controls changed; `replay`
//     plays it again and the score either comes out the same or it was not earned.
//   - People can play together live. A room hands every browser the same inputs for the same tick
//     (lockstep), each one steps its own copy of the game, and they cannot drift apart.
//   - A game can be watched, or shown again later, from the log alone.
//
// So an engine keeps to whole numbers for anything that feeds back into the game (positions,
// speeds, timers), takes its randomness from `nextRandom(state)`, and never looks at a clock.
// `@journey-to-code/physics`' `direction` gives exact directions for whole-number angles, and
// `Math.sqrt` and `Math.round` are exactly specified; `Math.sin`, `Math.cos` and `Math.atan2` are
// not, and have no place in a step.
//
// One thing is different from a `TableGame`, for speed: `step` changes the state it is given. A
// world of hundreds of bullets is stepped sixty times a second, and copying it each time would
// cost more than the game. Use `clone` to keep a state from before.
//
// What everyone sees is one shape, an `ArcadeView`: a field, the things on it (each a circle with
// a kind and a tone), every pilot's numbers, and what happened this tick. One screen draws every
// arcade game from it, and decides for itself what a "foe:drone" looks like. Nothing is hidden
// from anyone: every seat sees the same view.
import type { PlayStyle } from "@journey-to-code/rules";
import { clone, type BaseRules, type GameCategory, type RuleField } from "./table.js";

/** The games that are played in real time against the game itself. */
export type ArcadeGameId = "skyfire" | "bulwark" | "chipstack";

/** One thing on the field. Positions are in the field's own whole-number units, y down the screen. */
export interface ArcadeThing {
  /** Stable for as long as the thing lives, so a screen can follow it between ticks. */
  id: number;
  /** What it is, for drawing: "ship", "shot", "bullet", "foe:drone", "drop:power"… */
  kind: string;
  x: number;
  y: number;
  /** How big it is drawn (what can be hit may be smaller: see `core`). */
  r: number;
  /** The part that can be hit, when it is smaller than the thing looks. */
  core?: number;
  /** A colour by name ("red", "blue", "gold"…): the screen decides the shade. */
  tone?: string;
  /** Which way it points or travels, in hundredths of a degree (0 along +x, 9000 down the screen). */
  angle?: number;
  /** How much of it is left, in thousandths, for things worth a health bar. */
  health?: number;
  /** The seat it belongs to: a ship, or a shot. */
  seat?: number;
  /** Drawn faded and flickering: it cannot be hurt just now. */
  ghost?: boolean;
  /** How far it has been improved, from 1, for things that are built and upgraded. */
  level?: number;
  /** How far it reaches, for things that have a reach worth drawing when they are picked out. */
  range?: number;
  /** A passing condition, for a tint: "slowed". */
  mark?: string;
}

/** One pilot's numbers, for the screen's corners. */
export interface ArcadePilot {
  seat: number;
  /** In the game: false once the last life is gone. */
  playing: boolean;
  score: number;
  lives: number;
  /** A row of small counters with names: bombs, power, a multiplier. */
  stats: { key: string; label: string; value: number; max?: number }[];
}

/** Something that happened this tick, for sounds, flashes and shakes. Gone the tick after. */
export interface ArcadeEvent {
  kind: string;
  x: number;
  y: number;
  seat?: number;
  /** How big, or how many points. */
  amount?: number;
  /** Words to float up from the spot: "+500", "×4". */
  text?: string;
  /** Where it went, when it is a shot or a spark from one place to another. */
  to?: [x: number, y: number];
  /** A colour by name, when the event has one of its own. */
  tone?: string;
}

/**
 * For a game where things are built on a grid (a tower defence): the ground, what can be bought,
 * what stands, and what is coming. A screen draws the grid and the road from it and offers the
 * shop; what a seat sends back is up to the game's own input.
 */
export interface ArcadeBuild {
  cols: number;
  rows: number;
  /** A cell's side, in field units. */
  cell: number;
  /** The road, as points in field units, in the order it is walked. */
  road: [x: number, y: number][];
  /** Cells nothing can be built on, as row × cols + col. */
  closed: number[];
  /** What there is to spend. */
  bank: number;
  /** How many more can get through before the game is lost. */
  lives: number;
  shop: { key: string; label: string; cost: number; hint: string; range: number; tone: string }[];
  built: { id: number; col: number; row: number; key: string; label: string; level: number; maxLevel: number; /** What the next level costs, or null at the top. */ upgrade: number | null; sell: number; range: number; seat: number }[];
  /** The wave to come: when it comes by itself, what sending it now pays, and what is in it. Null while one is still coming on. */
  next: { wave: number; inTicks: number; bonus: number; preview: string } | null;
}

/**
 * For a game with things to buy that are not built anywhere (an idle clicker): what is in the
 * bank, what it earns, and everything on offer. A screen lists the items and sends back whichever
 * the game's own input takes; `key` is the game's name for the item.
 */
export interface ArcadeMarket {
  bank: number;
  /** What comes in by itself each second, as things stand. */
  perSecond: number;
  /** What one tap is worth now. */
  perTap: number;
  items: {
    key: string;
    /** Items of a group are listed together under its name: "Earners", "Boosts". */
    group: string;
    label: string;
    hint: string;
    cost: number;
    /** How many are owned, for things that can be bought again and again. */
    owned?: number;
    /** Whether the bank covers it now. */
    can: boolean;
  }[];
  /** Ticks left, when the game is played against the clock. */
  ticksLeft?: number;
  /** A row of things that are running, for badges: "Frenzy ×7", "3 stars". */
  badges: { key: string; label: string; tone: string; /** Ticks left of it, when it runs out. */ ticksLeft?: number }[];
}

export interface ArcadeView {
  game: ArcadeGameId;
  tick: number;
  /** Ticks a second, so a screen can turn ticks into time. */
  rate: number;
  seats: number;
  field: { width: number; height: number };
  things: ArcadeThing[];
  pilots: ArcadePilot[];
  /** The score everyone is playing for: one pilot's, or the crew's together. */
  score: number;
  /** Where the game has got to: "Wave 7". */
  stage: string;
  /** A big enemy with its own health bar across the top. */
  boss?: { name: string; health: number };
  /** Words across the middle for a moment: "Wave 5", "Warning". */
  banner?: string;
  /** The building side of a game that has one. */
  build?: ArcadeBuild;
  /** The buying side of a game that has one. */
  market?: ArcadeMarket;
  events: ArcadeEvent[];
  over: boolean;
}

/** A finished or running game, in a few words, for lobbies and leaderboards. */
export interface ArcadeSummary {
  game: ArcadeGameId;
  rules: string;
  phase: string;
  over: boolean;
  seats: number;
  /** How long it has run, in ticks. */
  ticks: number;
  /** The score a leaderboard ranks by. */
  score: number;
  /** Each seat's own score. */
  scores: number[];
  /** "Wave 12 · 1,204,500". */
  scoreLine: string;
  /** Seats best to worst. */
  order: number[];
}

/**
 * An arcade game. `R` is its house rules, `S` its state (plain data: it can be stored and sent),
 * `I` what one seat's controls are doing during a tick.
 */
export interface ArcadeGame<R extends BaseRules = BaseRules, S = unknown, I = unknown> {
  id: ArcadeGameId;
  name: string;
  emoji: string;
  /** The shelf it sits on in a game picker. */
  category: GameCategory;
  /** For the game picker. */
  blurb: string;
  /** For the setup screen's heading. */
  tagline: string;
  /** How many can play at once, on the same field. */
  seats: { min: number; max: number; default: number };
  /** Always false: everyone on the field is on the same side. Here so a picker can treat every game alike. */
  teams: false;
  presets: R[];
  fields: RuleField<R>[];
  /** Rules from storage or a page: anything missing comes from the first preset. */
  normalize(rules: unknown): R;
  validate(rules: R): string[];
  /** The rules in plain sentences. */
  describe(rules: R): string[];
  /** How to play, a line per control, for the setup screen. */
  controls: string[];
  /** Ticks a second. */
  rate: number;
  /** A deterministic start. */
  newGame(rules: R, seats: number, seed: number): S;
  /** The controls at rest: what a seat does when nobody is touching anything. */
  idle: I;
  /**
   * Controls from outside (a browser, a room, a log), made safe: whatever is given, what comes back
   * is an input `step` will take, with anything missing or out of range put right.
   */
  input(given: unknown): I;
  /**
   * One tick: every seat's controls in, the world moved on. **Changes the state it is given.** A
   * seat with no input given is idle. Does nothing once the game is over.
   */
  step(state: S, inputs: readonly (I | null | undefined)[]): void;
  /** What everyone sees. */
  view(state: S): ArcadeView;
  /**
   * What a computer pilot does with its controls this tick. It decides from the view like anyone
   * else. `rand` is where a careless one gets its carelessness (default `Math.random`).
   */
  bot(state: S, seat: number, style: PlayStyle, rand?: () => number): I;
  summary(state: S): ArcadeSummary;
}

// ---- Logs and replays ----------------------------------------------------------------------------

/**
 * A run, written down: every time a seat's controls changed, and on which tick. Controls stay as
 * they are until they change, so a log is short: a pilot holding left for a second is one entry.
 */
export interface ArcadeLog<I = unknown> {
  /** [tick, seat, input], in order of tick. The input is what the seat does from that tick on. */
  changes: [tick: number, seat: number, input: I][];
  /** How many ticks were played. */
  ticks: number;
}

/** Writes a log as a game is played: hand it each tick's inputs before the step. */
export function recorder<I>(game: ArcadeGame<any, any, I>, seats: number) {
  const held: string[] = Array.from({ length: seats }, () => JSON.stringify(game.idle));
  const log: ArcadeLog<I> = { changes: [], ticks: 0 };
  return {
    log,
    /** Note this tick's inputs. Returns them made safe, ready for `step`. */
    tick(inputs: readonly unknown[]): I[] {
      const safe = Array.from({ length: seats }, (_, seat) => game.input(inputs[seat] ?? game.idle));
      safe.forEach((input, seat) => {
        const text = JSON.stringify(input);
        if (text !== held[seat]) {
          held[seat] = text;
          log.changes.push([log.ticks, seat, input]);
        }
      });
      log.ticks++;
      return safe;
    },
  };
}

/**
 * Play a log again from the start: the game as it stood when the log ended. Every input is made
 * safe on the way in, so a log from anywhere can be replayed. `limit` (in ticks) refuses a log that
 * claims to be longer than any game could be.
 */
export function replay<R extends BaseRules, S, I>(game: ArcadeGame<R, S, I>, rules: unknown, seats: number, seed: number, log: ArcadeLog<unknown>, limit = game.rate * 60 * 60 * 4): S {
  if (!Number.isInteger(log.ticks) || log.ticks < 0 || log.ticks > limit) throw new RangeError("That log is not a game's length");
  const state = game.newGame(game.normalize(rules), seats, seed);
  const held: I[] = Array.from({ length: seats }, () => game.idle);
  let next = 0;
  for (let tick = 0; tick < log.ticks; tick++) {
    while (next < log.changes.length && log.changes[next]![0] <= tick) {
      const [, seat, input] = log.changes[next++]!;
      if (Number.isInteger(seat) && seat >= 0 && seat < seats) held[seat] = game.input(input);
    }
    game.step(state, held);
  }
  return state;
}

/** Whether a claimed score is what the log really earns. */
export function verifyScore<R extends BaseRules, S, I>(game: ArcadeGame<R, S, I>, rules: unknown, seats: number, seed: number, log: ArcadeLog<unknown>, claimed: number): boolean {
  try {
    return game.summary(replay(game, rules, seats, seed, log)).score === claimed;
  } catch {
    return false;
  }
}

/** A copy of a state, to keep while the original is stepped on. */
export const snapshot = <S>(state: S): S => clone(state);

// ---- Whole-number helpers for engines ----------------------------------------------------------

/** A vector of the given length pointing from one spot to another, in whole numbers. Straight down when they are the same spot. */
export function toward(fromX: number, fromY: number, toX: number, toY: number, length: number): [number, number] {
  const dx = toX - fromX;
  const dy = toY - fromY;
  const d = Math.sqrt(dx * dx + dy * dy);
  if (d === 0) return [0, length];
  // Adding 0 turns a rounded "minus nothing" into plain 0.
  return [Math.round((dx * length) / d) + 0, Math.round((dy * length) / d) + 0];
}

/** A heading for drawing, to the nearest eighth of a turn, in hundredths of a degree. Nothing in a game should depend on it. */
export function heading8(vx: number, vy: number): number {
  const ax = Math.abs(vx);
  const ay = Math.abs(vy);
  if (ay > ax * 2) return vy > 0 ? 9000 : 27000;
  if (ax > ay * 2) return vx > 0 ? 0 : 18000;
  return vx > 0 ? (vy > 0 ? 4500 : 31500) : vy > 0 ? 13500 : 22500;
}

/** Whether two circles touch. */
export const touching = (ax: number, ay: number, ar: number, bx: number, by: number, br: number) => (ax - bx) * (ax - bx) + (ay - by) * (ay - by) <= (ar + br) * (ar + br);

/** A big number written short, for people: 950, 12.4K, 3.21M, 7.05B, 1.2T. */
export function shortly(n: number): string {
  const whole = Math.trunc(n);
  if (Math.abs(whole) < 10_000) return points(whole);
  const units: [number, string][] = [[1e15, "Qa"], [1e12, "T"], [1e9, "B"], [1e6, "M"], [1e3, "K"]];
  for (const [size, mark] of units) {
    if (Math.abs(whole) >= size) {
      const value = whole / size;
      return `${value >= 100 ? value.toFixed(0) : value >= 10 ? value.toFixed(1) : value.toFixed(2)}${mark}`;
    }
  }
  return points(whole);
}

/** A number written for people: 1,204,500. */
export const points = (n: number): string => String(Math.trunc(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
