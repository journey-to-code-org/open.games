// The idle kit: games that carry on while nobody is looking. A shop that sells while you are away, a
// crew that gets up to things overnight, a number that is bigger when you come back.
//
// An arcade game is driven by ticks and is over in minutes. An idle game is driven by the clock on
// the wall and is never over. So its contract is different:
//
//   - The state remembers the second it was last brought up to date. `advance(state, clock)` plays
//     every second between then and now, in order, and says what happened in them. It makes no
//     difference whether those seconds are played one at a time with the page open or eight hours
//     at once when the player comes back: the same seconds give the same state. That is the whole
//     of "offline progress", and `test/idle.test.ts` holds every idle game to it.
//   - The player's moves are commands: `act(state, command, clock)` brings the state up to date
//     and then carries the command out, or says why not.
//   - The clock is handed in, never read. An engine is still pure: no `Date`, no `Math.random`.
//     The clock says what second it is and what time of day it is where the player is, because an
//     idle game may care (someone who clocks out at half past two does so on the player's wall).
//
// A state is plain data and every number in it is whole, like every other state in the package, so
// it can be stored as it is and loaded again with `load`, which trusts nothing it is given.
import type { GameCategory } from "./table.js";

/** The games that carry on while nobody is looking. */
export type IdleGameId = "delbies";

/** What time it is, as the game is told it. */
export interface IdleClock {
  /** Seconds since 1970, in whole seconds. */
  now: number;
  /** Minutes since midnight where the player is, 0 to 1439, at `now`. */
  minute: number;
  /** The day of the week where the player is, at `now`: 0 is Sunday. */
  day: number;
}

/** What happened while a state was brought up to date. */
export interface IdleReport {
  /** How many seconds were played. */
  seconds: number;
  /** Seconds that were asked for and not played, because it had been away too long. */
  skipped: number;
  /** What the time away came to, in a few sentences, when it was long enough to be worth telling. */
  lines: string[];
  /** What came in while away, in the game's own money, for a headline. */
  earned: number;
}

/** How a command went. */
export interface IdleResult {
  ok: boolean;
  /** Why not, or what came of it, in words for the player. */
  message?: string;
}

/**
 * An idle game. `S` is its state (plain data, whole numbers), `C` a command, `V` what the player
 * sees.
 */
export interface IdleGame<S = unknown, C = unknown, V = unknown> {
  id: IdleGameId;
  name: string;
  emoji: string;
  /** The shelf it sits on in a game picker. */
  category: GameCategory;
  blurb: string;
  tagline: string;
  /** One player to a game: here so a picker can treat every game alike. */
  seats: { min: 1; max: 1; default: 1 };
  teams: false;
  /** What a saved state is marked with. `load` refuses any other. */
  version: number;
  /** The longest time away that is played, in seconds. The rest is skipped. */
  awayCap: number;
  /** A new game, begun at the clock's second. */
  newGame(seed: number, clock: IdleClock): S;
  /**
   * Play every second from where the state was left to the clock's `now`. **Changes the state it is
   * given.** A clock that is behind the state changes nothing.
   */
  advance(state: S, clock: IdleClock): IdleReport;
  /** A command from outside, made safe. */
  command(given: unknown): C;
  /** Bring the state up to date, then carry the command out. **Changes the state it is given.** */
  act(state: S, command: C, clock: IdleClock): IdleResult;
  /** What the player sees. Does not change the state: call `advance` first. */
  view(state: S, clock: IdleClock): V;
  /** A state from storage, checked: null when it is not one of this game's, or is from another version. */
  load(saved: unknown): S | null;
  /** The number a leaderboard would rank by. */
  score(state: S): number;
}

/** The clock a second of the past had, worked back from the clock of now. */
export function clockAt(clock: IdleClock, second: number): IdleClock {
  const back = clock.now - second;
  const seconds = clock.minute * 60 + (clock.now % 60) - back;
  const days = Math.floor(seconds / 86400);
  const inDay = seconds - days * 86400;
  return { now: second, minute: Math.floor(inDay / 60), day: (((clock.day + days) % 7) + 7) % 7 };
}

/** A clock made safe: whole numbers, in range. */
export function safeClock(given: unknown): IdleClock {
  const g = (given && typeof given === "object" ? given : {}) as Record<string, unknown>;
  const whole = (n: unknown, low: number, high: number) => (typeof n === "number" && Number.isFinite(n) ? Math.min(high, Math.max(low, Math.trunc(n))) : low);
  return { now: whole(g.now, 0, 9_000_000_000), minute: whole(g.minute, 0, 1439), day: whole(g.day, 0, 6) };
}

/** Money kept in cents, written for people: $1,204.50, $12.4K, $3.21M. */
export function dollars(cents: number): string {
  const sign = cents < 0 ? "−" : "";
  const c = Math.abs(Math.trunc(cents));
  if (c < 1_000_000) return `${sign}$${String(Math.floor(c / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, ",")}${c < 100_000 && c % 100 ? `.${String(c % 100).padStart(2, "0")}` : ""}`;
  const units: [number, string][] = [[1e17, "Qa"], [1e14, "T"], [1e11, "B"], [1e8, "M"], [1e5, "K"]];
  for (const [size, mark] of units) {
    if (c >= size) {
      const value = c / size;
      return `${sign}$${value >= 100 ? value.toFixed(0) : value >= 10 ? value.toFixed(1) : value.toFixed(2)}${mark}`;
    }
  }
  return `${sign}$${Math.floor(c / 100)}`;
}
