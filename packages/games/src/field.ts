// The field kit: what one seat sees of any game played side on, over land, by lobbing things at
// each other, in one shared shape, the way SportView is for the table sports. One table screen
// (FieldTable in the web app) draws every such game from it on a canvas, and the same room on the
// server runs them.
//
// These games are turn-based. A move is a shot in whole numbers (which shell, an angle in whole
// degrees, a power from 1 to 100). The engine flies the shot until everything has landed with
// `flyField` and keeps the land and the pieces as they were left; the view carries that shot and
// the field it was fired over, and each browser flies the very same shot to animate it, ending on
// the field the server already decided. The flight uses only operations the language pins down to
// the bit (adding, multiplying, dividing, square roots and the physics core's `direction`), so the
// animation is a replay and never a guess.
//
// The land is a row of heights, one every `step` across the field: there are no overhangs, so a
// hole blown under a ledge lets the earth above it fall, as it does in every game of this kind.
// What a shell does when it lands is data (`FieldShell`): how wide its blast is, whether it skips,
// rolls, digs, splits or leaves earth behind. A game is its own list of shells and its own rules
// for whose turn it is and what a hit is worth.
import { direction } from "@journey-to-code/physics";
import type { SportTone } from "./sport.js";
import type { BaseRules, Choices, FieldGameId, GameOver, RoundResult, Scores, TableGame } from "./table.js";

/** The flight's rules. A browser on another version shows a shot's result without flying it. */
export const FIELD_VERSION = 1;

/** Steps of a flight in a second, for whoever plays one back. */
export const FIELD_TICKS = 60;
/** How far a piece reaches from its middle: what a shell has to come within to hit it. */
export const PIECE_R = 30;
/** How far above the ground under it a piece's middle is. */
export const PIECE_UP = 18;
/** How far from a piece's middle its barrel ends, which is where a shell starts. */
export const BARREL = 46;
/** What every tick takes off a shell's climb. */
const GRAVITY = 0.25;
/** A shell's speed for each point of power, in units a tick. Full power at 45° carries a little further than a field is wide. */
const MUZZLE = 0.25;
/** What each point of wind adds to a shell's speed across, every tick. */
const WIND = 0.004;
/** The land is never blown away below this, nor heaped above the second. */
const FLOOR = 30;
const CEILING = 1000;
/** A flight is checked this many times a tick, so a fast shell can't step through a piece. */
const SUB = 4;
/** No flight lasts longer than this many ticks: whatever is still in the air is gone. */
const LONGEST = 1200;
/** A shell can't hit the piece that fired it until it has been in the air this long. */
const CLEAR = 14;

// ---- The field ----------------------------------------------------------------------------------

/** The land: `heights[i]` is how high the ground stands at `i * step` across. All whole numbers. */
export interface FieldLand {
  width: number;
  step: number;
  heights: number[];
}

/** Something standing on the land that a shell can hit: `x` across, and `y` the ground under it. */
export interface FieldPiece {
  id: string;
  x: number;
  y: number;
}

/** Everything a flight needs to know about the field it crosses. */
export interface FieldWorld {
  land: FieldLand;
  pieces: FieldPiece[];
  /** From -10 (hard to the left) to 10. */
  wind: number;
}

/**
 * What one kind of shell does. Every number is whole. A shell with none of the optional parts
 * flies until it meets the land or a piece and bursts there.
 */
export interface FieldShell {
  id: string;
  name: string;
  /** What it does, in a line, for whoever is choosing one. */
  blurb: string;
  /** How wide the hole it leaves is (its radius). */
  blast: number;
  /** What a piece at the very middle of the burst takes; less the further off it is. */
  damage: number;
  /** How many leave the barrel at once, fanned `spread` degrees apart. Left out: one. */
  count?: number;
  spread?: number;
  /** It leaves a heap of earth this size instead of a hole. */
  dirt?: boolean;
  /** It skips off the land this many times before it bursts. */
  bounces?: number;
  /** It rolls downhill from where it lands, and bursts when it meets a piece or a rise. */
  roll?: boolean;
  /** It bores on through the earth this far before it bursts. */
  dig?: number;
  /** It breaks into smaller shells, at the top of its flight or where it lands. */
  split?: { at: "top" | "land"; into: number; blast: number; damage: number };
}

/** A shot: the piece firing, with what, at what angle (whole degrees: 0 is flat to the right, 90 straight up, 180 flat to the left) and how hard (1 to 100). */
export interface FieldShot {
  piece: string;
  shell: FieldShell;
  angle: number;
  power: number;
}

/** The path of one thing through the air (or along the ground, or through it), a point a tick from `from`. */
export interface FieldTrack {
  id: string;
  from: number;
  points: [number, number][];
  /** A piece of a shell that split, drawn smaller. */
  small: boolean;
}

/** Something that happened in a flight, for whoever plays it back. */
export interface FieldEvent {
  tick: number;
  /** A burst, a heap of earth landing, a skip off the ground, a bore through it, or a shell breaking up in the air. */
  kind: "burst" | "heap" | "skip" | "bore" | "split";
  x: number;
  y: number;
  /** How wide. */
  r: number;
  /** What it did to each piece it reached. */
  hits: { piece: string; damage: number }[];
  /** The land and the pieces as this left them, when the flight was asked to keep them (see `flyField`). */
  land?: number[];
  pieces?: FieldPiece[];
}

/** A whole flight: where everything went, what happened, and the field it left. */
export interface FieldFlight {
  tracks: FieldTrack[];
  events: FieldEvent[];
  /** How many ticks it took. */
  ticks: number;
  /** The land as it was left. */
  land: number[];
  /** The pieces, each on the ground now under it. */
  pieces: FieldPiece[];
  /** What each piece took in all, by id. Pieces that took nothing are left out. */
  damage: Record<string, number>;
}

/** How high the ground stands at `x`, between the heights either side. Beyond an edge it is as high as the edge. */
export function landAt(land: FieldLand, x: number): number {
  const last = land.heights.length - 1;
  if (x <= 0) return land.heights[0]!;
  if (x >= last * land.step) return land.heights[last]!;
  const i = Math.floor(x / land.step);
  const t = (x - i * land.step) / land.step;
  return land.heights[i]! + (land.heights[i + 1]! - land.heights[i]!) * t;
}

/** Blow a round hole in the land. Earth above the hole falls into it. Changes `heights`. */
export function carveLand(land: FieldLand, x: number, y: number, r: number): void {
  const first = Math.max(0, Math.ceil((x - r) / land.step));
  const last = Math.min(land.heights.length - 1, Math.floor((x + r) / land.step));
  for (let i = first; i <= last; i++) {
    const dx = i * land.step - x;
    const d = Math.sqrt(Math.max(0, r * r - dx * dx));
    const h = land.heights[i]!;
    const low = y - d;
    if (h <= low) continue;
    const next = h <= y + d ? low : h - 2 * d;
    land.heights[i] = Math.max(FLOOR, Math.round(next));
  }
}

/** Drop a heap of earth on the land. Changes `heights`. */
export function heapLand(land: FieldLand, x: number, r: number): void {
  const first = Math.max(0, Math.ceil((x - r) / land.step));
  const last = Math.min(land.heights.length - 1, Math.floor((x + r) / land.step));
  for (let i = first; i <= last; i++) {
    const dx = i * land.step - x;
    const d = Math.sqrt(Math.max(0, r * r - dx * dx));
    land.heights[i] = Math.min(CEILING, Math.round(land.heights[i]! + d * 0.9));
  }
}

/** Where a shell leaves a piece's barrel, and how fast, for an angle and a power. */
export function muzzle(piece: FieldPiece, angle: number, power: number): { x: number; y: number; vx: number; vy: number } {
  const [c, s] = direction(angle * 100);
  return { x: piece.x + c * BARREL, y: piece.y + PIECE_UP + s * BARREL, vx: c * power * MUZZLE, vy: s * power * MUZZLE };
}

interface Flying {
  track: FieldTrack;
  mode: "fly" | "roll" | "dig";
  x: number;
  y: number;
  vx: number;
  vy: number;
  age: number;
  blast: number;
  damage: number;
  dirt: boolean;
  bounces: number;
  roll: boolean;
  dig: number;
  split: FieldShell["split"] | null;
  /** Rolling: which way, how much further, and whether it has turned back once already. */
  way: number;
  left: number;
  turned: boolean;
}

const ROLL_STEP = 9;
const ROLL_FOR = 90;
const DIG_SPEED = 9;
const BORE = 18;

/**
 * Fly a shot until everything has landed. The world it is given is left alone. `keep` puts the
 * land and the pieces into every event that changed them, which a screen playing the flight back
 * wants and a computer player trying shots in its head does not.
 */
export function flyField(world: FieldWorld, shot: FieldShot, keep = false): FieldFlight {
  const land: FieldLand = { ...world.land, heights: [...world.land.heights] };
  const pieces = world.pieces.map((p) => ({ ...p }));
  const tracks: FieldTrack[] = [];
  const events: FieldEvent[] = [];
  const damage: Record<string, number> = {};
  const flying: Flying[] = [];
  const shell = shot.shell;
  const gun = pieces.find((p) => p.id === shot.piece);
  let tick = 0;
  let made = 0;

  const launch = (x: number, y: number, vx: number, vy: number, part: Pick<Flying, "blast" | "damage" | "dirt" | "bounces" | "roll" | "dig" | "split">, small: boolean) => {
    const track: FieldTrack = { id: `s${made++}`, from: tick, points: [[x, y]], small };
    tracks.push(track);
    flying.push({ track, mode: "fly", x, y, vx, vy, age: 0, ...part, way: 1, left: 0, turned: false });
  };
  const settle = () => {
    for (const p of pieces) p.y = Math.round(landAt(land, p.x));
  };
  const event = (kind: FieldEvent["kind"], x: number, y: number, r: number, hits: FieldEvent["hits"], changed: boolean) => {
    events.push({ tick, kind, x, y, r, hits, ...(keep && changed ? { land: [...land.heights], pieces: pieces.map((p) => ({ ...p })) } : {}) });
  };
  const burst = (f: Flying) => {
    const hits: FieldEvent["hits"] = [];
    if (f.dirt) heapLand(land, f.x, f.blast);
    else {
      const reach = f.blast + PIECE_R;
      for (const p of pieces) {
        const dx = p.x - f.x;
        const dy = p.y + PIECE_UP - f.y;
        const d = Math.sqrt(dx * dx + dy * dy);
        if (f.damage > 0 && d < reach) {
          const took = Math.max(1, Math.round(f.damage * (1 - d / reach)));
          hits.push({ piece: p.id, damage: took });
          damage[p.id] = (damage[p.id] ?? 0) + took;
        }
      }
      carveLand(land, f.x, f.y, f.blast);
    }
    settle();
    event(f.dirt ? "heap" : "burst", f.x, f.y, f.blast, hits, true);
    if (f.split?.at === "land") {
      const n = f.split.into;
      const up = landAt(land, f.x) + 8;
      for (let i = 0; i < n; i++) launch(f.x, up, (i - (n - 1) / 2) * 2.4, 7.5 - Math.abs(i - (n - 1) / 2) * 0.6, { blast: f.split.blast, damage: f.split.damage, dirt: false, bounces: 0, roll: false, dig: 0, split: null }, true);
    }
  };
  /** Whether the thing is touching a piece. The piece that fired it doesn't count at first. */
  const touching = (f: Flying, reach: number) => pieces.some((p) => !(p === gun && f.age < CLEAR && !f.track.small) && (p.x - f.x) * (p.x - f.x) + (p.y + PIECE_UP - f.y) * (p.y + PIECE_UP - f.y) <= reach * reach);
  const gone = (f: Flying) => f.x < -400 || f.x > land.width + 400;

  if (gun && Number.isInteger(shot.angle) && Number.isInteger(shot.power)) {
    const n = shell.count ?? 1;
    for (let i = 0; i < n; i++) {
      // A fan is opened either side of the angle aimed at, and never below the ground's own level.
      const angle = Math.max(0, Math.min(180, shot.angle + Math.round((i - (n - 1) / 2) * (shell.spread ?? 0))));
      const m = muzzle(gun, angle, shot.power);
      launch(m.x, m.y, m.vx, m.vy, { blast: shell.blast, damage: shell.damage, dirt: !!shell.dirt, bounces: shell.bounces ?? 0, roll: !!shell.roll, dig: shell.dig ?? 0, split: shell.split ?? null }, false);
    }
  }

  while (flying.length && tick < LONGEST) {
    tick++;
    // Things launched during this tick (the pieces of a shell that split) start on the next.
    const now = flying.length;
    for (let k = 0; k < now; k++) {
      const f = flying[k]!;
      if (f.left < 0) continue;
      f.age++;
      let done = false;
      if (f.mode === "fly") {
        f.vx += world.wind * WIND;
        f.vy -= GRAVITY;
        if (f.split?.at === "top" && f.age >= 4 && f.vy <= 0) {
          const n = f.split.into;
          event("split", f.x, f.y, 0, [], false);
          for (let i = 0; i < n; i++) launch(f.x, f.y, f.vx + (i - (n - 1) / 2) * 1.5, 0, { blast: f.split.blast, damage: f.split.damage, dirt: false, bounces: 0, roll: false, dig: 0, split: null }, true);
          done = true;
        }
        for (let sub = 0; sub < SUB && !done; sub++) {
          f.x += f.vx / SUB;
          f.y += f.vy / SUB;
          if (gone(f)) done = true;
          else if (touching(f, PIECE_R)) {
            burst(f);
            done = true;
          } else if (f.y <= landAt(land, f.x)) {
            f.y = landAt(land, f.x);
            if (f.bounces > 0) {
              f.bounces--;
              event("skip", f.x, f.y, 0, [], false);
              f.y += 1;
              f.vy = Math.abs(f.vy) * 0.55 + 1;
              f.vx *= 0.8;
              break;
            } else if (f.roll) {
              f.mode = "roll";
              f.way = f.vx >= 0 ? 1 : -1;
              f.left = ROLL_FOR;
              break;
            } else if (f.dig > 0) {
              const speed = Math.sqrt(f.vx * f.vx + f.vy * f.vy);
              // A shell that has all but stopped bores straight down.
              f.vx = speed > 0.01 ? (f.vx / speed) * DIG_SPEED : 0;
              f.vy = speed > 0.01 ? (f.vy / speed) * DIG_SPEED : -DIG_SPEED;
              f.mode = "dig";
              f.left = Math.max(1, Math.round(f.dig / DIG_SPEED));
              break;
            } else {
              burst(f);
              done = true;
            }
          }
        }
      } else if (f.mode === "roll") {
        const next = f.x + f.way * ROLL_STEP;
        const rise = landAt(land, next) - landAt(land, f.x);
        if (next < 0 || next > land.width || f.left <= 0) {
          burst(f);
          done = true;
        } else if (rise > 10) {
          // Uphill: it rolls back the way it came once, and bursts the second time it is stopped.
          if (f.turned) {
            burst(f);
            done = true;
          } else {
            f.turned = true;
            f.way = -f.way;
          }
        } else {
          f.x = next;
          f.y = landAt(land, next) + 5;
          f.left--;
          if (touching(f, PIECE_R + 4)) {
            burst(f);
            done = true;
          }
        }
      } else {
        f.x += f.vx;
        f.y += f.vy;
        f.left--;
        if (gone(f) || f.y < FLOOR || f.left <= 0 || touching(f, PIECE_R + 6)) {
          burst(f);
          done = true;
        } else {
          carveLand(land, f.x, f.y, BORE);
          settle();
          event("bore", f.x, f.y, BORE, [], true);
        }
      }
      if (!done) f.track.points.push([f.x, f.y]);
      else {
        f.track.points.push([f.x, f.y]);
        f.left = -1;
      }
    }
    for (let k = flying.length - 1; k >= 0; k--) if (flying[k]!.left < 0) flying.splice(k, 1);
  }
  settle();
  return { tracks, events, ticks: tick, land: land.heights, pieces, damage };
}

// ---- What a seat sees ---------------------------------------------------------------------------

/** How one piece is drawn and whose it is. */
export interface FieldPieceLook extends FieldPiece {
  /** Whose it is (a seat). */
  owner: number;
  /** What it is, in the game's own words: "tank". */
  kind: string;
  tone: SportTone;
  /** What a screen reader says, the same to every seat: "{0}'s tank". */
  label: string;
  /** Where its barrel points, in whole degrees: the angle it last fired at. */
  angle: number;
}

/** How many of one shell there are: in a seat's own store, or on the table to be chosen from. */
export interface FieldStock {
  shell: string;
  left: number;
}

/** What a seat may fire now, and from where. */
export interface FieldAim {
  /** The piece that fires. */
  piece: string;
  /** What it may fire: every shell it has any of. */
  shells: FieldStock[];
  minAngle: number;
  maxAngle: number;
  minPower: number;
  maxPower: number;
  /** Where this seat's barrel and power were left, to start from. */
  angle: number;
  power: number;
  /** Moving the piece along the land before firing, where the game allows: how many moves are left and which ways are open. Sent as `{ type: "move", way }` with way -1 or 1. */
  move: { left: number; ways: (-1 | 1)[] } | null;
}

/** Choosing a shell from the ones on the table, before the firing starts. Sent as `{ type: "pick", shell }`. */
export interface FieldPick {
  prompt: string;
  options: FieldStock[];
}

/**
 * The shot just fired, enough for a browser to play it again: fly `shot` over `from` (see
 * `flightOf`), and it ends on the view's own land with the pieces at `rest`.
 */
export interface FieldLast {
  /** Counts the shots of a game from 1, so each is animated once. */
  n: number;
  seat: number;
  piece: string;
  /** The shell's id in the view's `shells`. */
  shell: string;
  angle: number;
  power: number;
  /** The field as it was when the shot was fired. */
  from: { land: number[]; pieces: FieldPiece[]; wind: number };
  /** Where the flight left the pieces. */
  rest: FieldPiece[];
  /** What each piece took. */
  hits: { piece: string; damage: number }[];
  /** The FIELD_VERSION that flew it. */
  version: number;
}

export interface FieldSeat {
  /** A short line under the name: "4 shells left". */
  line: string;
  tone: SportTone;
  /** What this seat has left to fire. Everyone's is on show. */
  shells: FieldStock[];
  /** Out of shells, or out of the game. */
  done?: boolean;
  badge?: string;
}

export interface FieldView {
  game: FieldGameId;
  seats: number;
  me: number;
  teams: boolean;
  phase: string;
  /** Whose turn it is (to choose a shell or to fire), or null when nobody's. */
  turn: number | null;
  field: {
    /** Changes when the field is a different one, so the screen fits it afresh. */
    key: string;
    name: string;
    width: number;
    /** How much sky the screen should show: shells may fly above it and come back. */
    height: number;
    step: number;
    /** The land at rest, as the next shot will find it. */
    land: number[];
    wind: number;
    pieces: FieldPieceLook[];
  };
  /** Every shell this game has, so a screen can name one and fly it. */
  shells: FieldShell[];
  /** The shells on the table still to be chosen, while they are being chosen; else null. */
  pool: FieldStock[] | null;
  /** What this seat may choose now, or null. */
  pick: FieldPick | null;
  /** What this seat may fire now, or null. */
  aim: FieldAim | null;
  /** The last shot that this seat should see played, or null. */
  last: FieldLast | null;
  /** Buttons: "Next round". */
  choices: Choices | null;
  players: FieldSeat[];
  /** Small facts for the table: "Wind 3 →". */
  info: string[];
  /** What just happened, in words. */
  narration: string | null;
  scores: Scores;
  result: RoundResult | null;
  /** `winners` is every seat when it's a tie. */
  over: GameOver | null;
}

/** A field game: an engine whose seats see a `FieldView`, and whose moves are shots, picks and buttons. */
export interface FieldGame<R extends BaseRules = BaseRules, S = unknown, M = Record<string, unknown>> extends TableGame<R, S, M, FieldView> {
  id: FieldGameId;
}

/** A shot as a move. Whole numbers, checked again by the engine. */
export interface FireMove {
  type: "fire";
  /** A shell's id. */
  shell: string;
  /** Whole degrees within the view's `aim` range. */
  angle: number;
  /** A whole number within the view's `aim` range. */
  power: number;
}

// ---- Helpers for engines, tables and tests ------------------------------------------------------

/** The view's field as a flight needs it. */
export function fieldWorld(view: Pick<FieldView, "field">): FieldWorld {
  const f = view.field;
  return { land: { width: f.width, step: f.step, heights: f.land }, pieces: f.pieces.map(({ id, x, y }) => ({ id, x, y })), wind: f.wind };
}

/**
 * The view's last shot flown again, with the land and pieces kept at every step for playing it
 * back; null when there is no last shot, or its shell isn't one the view knows.
 */
export function flightOf(view: Pick<FieldView, "field" | "last" | "shells">): FieldFlight | null {
  const last = view.last;
  const shell = last && view.shells.find((s) => s.id === last.shell);
  if (!last || !shell) return null;
  const world: FieldWorld = { land: { width: view.field.width, step: view.field.step, heights: last.from.land }, pieces: last.from.pieces, wind: last.from.wind };
  return flyField(world, { piece: last.piece, shell, angle: last.angle, power: last.power }, true);
}

/**
 * Some of what a seat can send from a view, as moves: every button and pick, every way it may
 * move, and when it may fire, a spread of shots with each shell it has. (The shared tests play
 * from these.)
 */
export function fieldMovesOffered(view: FieldView): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  for (const o of view.pick?.options ?? []) out.push({ type: "pick", shell: o.shell });
  if (view.aim) {
    const { minAngle, maxAngle, minPower, maxPower } = view.aim;
    for (const way of view.aim.move?.ways ?? []) out.push({ type: "move", way });
    for (const stock of view.aim.shells) for (const angle of [minAngle, 45, 90, 135, maxAngle]) for (const power of [minPower, Math.round((minPower + maxPower) / 2), maxPower]) out.push({ type: "fire", shell: stock.shell, angle, power });
  }
  for (const o of view.choices?.options ?? []) out.push(o.move);
  return out;
}
