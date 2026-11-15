// Skyfire: a shoot-'em-up, the first game on the arcade kit. One to four ships at the bottom of a
// tall field, wave after wave coming down it, a boss every fifth wave, and no end: the game gets
// harder until the last ship is gone, and the score is what you play for.
//
// What makes a score:
//   - Every kill is worth its points times the pilot's multiplier. The multiplier climbs with a
//     chain of kills and falls back to ×1 when the chain's timer runs out or the ship is hit.
//   - Grazing (letting a bullet pass close without being hit) scores a little and keeps the chain
//     alive, so the brave way through a pattern is also the richer one.
//   - Medals fall from what you destroy. Each one picked up is worth more than the last, up to
//     10,000; let one fall off the bottom and the next is back to 100.
//   - A wave with nothing left alive and nothing escaped pays a bonus.
//
// Everything that feeds back into the game is a whole number: positions and speeds in field units
// (the field is 6000 wide and 8000 tall), timers in ticks. Aiming uses Math.sqrt and the physics
// core's exact `direction`, so the same seed and inputs give the same game to the bit everywhere.
import { direction } from "@journey-to-code/physics";
import type { PlayStyle } from "@journey-to-code/rules";
import { points, touching, toward, type ArcadeEvent, type ArcadeGame, type ArcadeSummary, type ArcadeThing, type ArcadeView } from "./arcade.js";
import { nextRandom, who, type BaseRules } from "./table.js";

export const SKYFIRE_FIELD = { width: 6000, height: 8000 };
const W = SKYFIRE_FIELD.width;
const H = SKYFIRE_FIELD.height;
const RATE = 60;

/** The furthest a ship moves in a tick. */
export const SKYFIRE_SPEED = 72;
const SHIP_R = 230;
/** The part of a ship that a bullet has to touch. */
const CORE = 42;
const GRAZE = 250;
const PICKUP = 420;
const MAGNET = 1150;
const HOME_Y = 6900;
const MAX_POWER = 5;
const MAX_BOMBS = 6;
const MAX_LIVES = 9;
const MAX_BULLETS = 700;
const MAX_FOES = 90;
const CHAIN_TICKS = 150;
const BOMB_TICKS = 55;
const GHOST_TICKS = 150;
const DOWN_TICKS = 70;
const MEDALS = [100, 200, 300, 500, 800, 1000, 1500, 2000, 3000, 5000, 7500, 10000];
const TONES = ["blue", "red", "green", "gold"];

export interface SkyfireRules extends BaseRules {
  /** Ships each pilot starts with. */
  lives: number;
  /** Bombs each pilot starts with, and has again after losing a ship. */
  bombs: number;
  /** How fast bullets fly, as a percentage. */
  bulletSpeed: number;
  /** Extra ships at 300,000 points, at a million, and every million and a half after. */
  extends: boolean;
}

export const SKYFIRE_PRESETS: SkyfireRules[] = [
  { id: "arcade", name: "Arcade", lives: 3, bombs: 3, bulletSpeed: 100, extends: true },
  { id: "cadet", name: "Cadet", lives: 5, bombs: 4, bulletSpeed: 80, extends: true },
  { id: "ace", name: "Ace", lives: 2, bombs: 2, bulletSpeed: 120, extends: true },
  { id: "oneship", name: "One ship", lives: 1, bombs: 2, bulletSpeed: 100, extends: false },
];

/** What a pilot's controls are doing during a tick. */
export interface SkyfireInput {
  /** How far to move this tick, in field units: up to `SKYFIRE_SPEED` in any direction. Less is a careful, slow move. */
  dx: number;
  dy: number;
  fire: boolean;
  /** A bomb goes off when this turns from false to true. */
  bomb: boolean;
}

type FoeKind = "drone" | "dart" | "gunship" | "spinner" | "carrier" | "boss";
type DropKind = "power" | "bomb" | "medal";

interface Pilot {
  x: number;
  y: number;
  lives: number;
  bombs: number;
  power: number;
  /** Ticks left in which nothing can hurt it. */
  ghost: number;
  /** Ticks until the next ship flies in, after losing one. */
  down: number;
  /** No ships left. */
  out: boolean;
  /** Ticks until the guns fire again. */
  cool: number;
  /** Ticks of bomb still burning. */
  bombing: number;
  bombHeld: boolean;
  score: number;
  chain: number;
  chainTimer: number;
  kills: number;
  grazes: number;
}
interface Shot {
  id: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  seat: number;
  dmg: number;
}
interface Foe {
  id: number;
  kind: FoeKind;
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  hp: number;
  max: number;
  /** Ticks since it appeared. */
  t: number;
  /** Two numbers each kind uses its own way: a height to stop at, an angle that turns, a side to leave by. */
  a: number;
  b: number;
  /** Ticks until it fires again. */
  cool: number;
  worth: number;
  wave: number;
}
interface Bullet {
  id: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  tone: string;
  /** A bit per seat that has already grazed it. */
  grazed: number;
}
interface Drop {
  id: number;
  kind: DropKind;
  x: number;
  y: number;
}
interface Spawn {
  at: number;
  kind: FoeKind;
  x: number;
  vx: number;
  vy: number;
  a: number;
  b: number;
}

export interface SkyfireState {
  rules: SkyfireRules;
  seats: number;
  rng: number;
  tick: number;
  phase: "play" | "over";
  wave: number;
  /** Foes still to come in this wave. */
  queue: Spawn[];
  /** The tick after which the next wave starts whatever is still flying. */
  waveDeadline: number;
  /** The tick the field was first found empty, or 0: the next wave follows a breath later. */
  clearedAt: number;
  waveSpawned: number;
  waveKilled: number;
  waveEscaped: number;
  pilots: Pilot[];
  shots: Shot[];
  foes: Foe[];
  bullets: Bullet[];
  drops: Drop[];
  nextId: number;
  /** How far up the medal ladder the crew is. */
  medal: number;
  /** The crew's score at which the next extra ship comes. */
  nextExtend: number;
  banner: { text: string; until: number } | null;
  events: ArcadeEvent[];
}

const IDLE: SkyfireInput = { dx: 0, dy: 0, fire: false, bomb: false };
const clamp = (n: number, low: number, high: number) => (n < low ? low : n > high ? high : n);
const whole = (n: unknown) => (typeof n === "number" && Number.isFinite(n) ? Math.trunc(n) + 0 : 0);

function safeInput(given: unknown): SkyfireInput {
  if (!given || typeof given !== "object") return IDLE;
  const g = given as Record<string, unknown>;
  let dx = clamp(whole(g.dx), -SKYFIRE_SPEED, SKYFIRE_SPEED);
  let dy = clamp(whole(g.dy), -SKYFIRE_SPEED, SKYFIRE_SPEED);
  const far = dx * dx + dy * dy;
  if (far > SKYFIRE_SPEED * SKYFIRE_SPEED) {
    // A diagonal is no faster than a straight line.
    const d = Math.sqrt(far);
    dx = Math.trunc((dx * SKYFIRE_SPEED) / d) + 0;
    dy = Math.trunc((dy * SKYFIRE_SPEED) / d) + 0;
  }
  return { dx, dy, fire: g.fire === true, bomb: g.bomb === true };
}

const startX = (seat: number, seats: number) => Math.round((W * (seat + 1)) / (seats + 1));
const multiplier = (p: Pilot) => 1 + Math.min(15, Math.floor(p.chain / 6));
const rank = (s: SkyfireState) => s.wave - 1;
const crewScore = (s: SkyfireState) => s.pilots.reduce((sum, p) => sum + p.score, 0);
const flying = (p: Pilot) => !p.out && p.down === 0;

/** A bullet's speed here and now: the base, the house rule, and a little more every wave. */
const bulletSpeed = (s: SkyfireState, base: number) => Math.max(8, Math.round((base * s.rules.bulletSpeed * (100 + Math.min(90, 4 * rank(s)))) / 10000));

function say(s: SkyfireState, kind: string, x: number, y: number, more: Partial<ArcadeEvent> = {}) {
  if (s.events.length < 80) s.events.push({ kind, x, y, ...more });
}

function addBullet(s: SkyfireState, x: number, y: number, vx: number, vy: number, tone: string, r = 70) {
  if (s.bullets.length >= MAX_BULLETS) return;
  if (vx === 0 && vy === 0) vy = 1;
  // Adding 0 turns a rounded "minus nothing" into plain 0, which is what it becomes when a state is stored.
  s.bullets.push({ id: s.nextId++, x, y, vx: vx + 0, vy: vy + 0, r, tone, grazed: 0 });
}

/** The pilot a foe aims at: the nearest one flying, or straight down when nobody is. */
function nearestPilot(s: SkyfireState, x: number, y: number): Pilot | null {
  let best: Pilot | null = null;
  let bestD = Infinity;
  for (const p of s.pilots) {
    if (!flying(p)) continue;
    const d = (p.x - x) * (p.x - x) + (p.y - y) * (p.y - y);
    if (d < bestD) {
      bestD = d;
      best = p;
    }
  }
  return best;
}

/** A fan of `count` bullets aimed at the nearest pilot, `spread` hundredths of a degree apart. */
function fireFan(s: SkyfireState, x: number, y: number, count: number, spread: number, speed: number, tone: string, r = 70) {
  const target = nearestPilot(s, x, y);
  const tx = target ? target.x - x : 0;
  const ty = target ? target.y - y : 1;
  const d = Math.sqrt(tx * tx + ty * ty);
  const ux = d === 0 ? 0 : tx / d;
  const uy = d === 0 ? 1 : ty / d;
  for (let i = 0; i < count; i++) {
    const [c, sn] = direction(Math.round((i - (count - 1) / 2) * spread));
    addBullet(s, x, y, Math.round((ux * c - uy * sn) * speed), Math.round((ux * sn + uy * c) * speed), tone, r);
  }
}

/** A ring of bullets all the way round, starting at `offset`, leaving out `gap` of them from `gapAt`. */
function fireRing(s: SkyfireState, x: number, y: number, count: number, offset: number, speed: number, tone: string, gapAt = -1, gap = 0) {
  for (let i = 0; i < count; i++) {
    if (gap > 0 && (i - gapAt + count) % count < gap) continue;
    const [c, sn] = direction(offset + Math.round((36000 * i) / count));
    addBullet(s, x, y, Math.round(c * speed), Math.round(sn * speed), tone);
  }
}

// ---- Waves ---------------------------------------------------------------------------------------

const FOES: Record<FoeKind, { r: number; hp: number; worth: number }> = {
  drone: { r: 200, hp: 40, worth: 100 },
  dart: { r: 170, hp: 30, worth: 150 },
  gunship: { r: 340, hp: 600, worth: 800 },
  spinner: { r: 290, hp: 450, worth: 600 },
  carrier: { r: 540, hp: 3200, worth: 3000 },
  boss: { r: 720, hp: 22000, worth: 20000 },
};

function nextWave(s: SkyfireState) {
  const rand = nextRandom(s);
  const pick = (low: number, high: number) => low + Math.floor(rand() * (high - low + 1));
  // The wave before: a bonus when nothing got away and nothing is left.
  if (s.wave > 0 && s.waveSpawned > 0 && s.waveEscaped === 0 && s.waveKilled === s.waveSpawned) {
    const bonus = 1000 * s.wave;
    for (const p of s.pilots) if (!p.out) p.score += bonus;
    say(s, "perfect", W / 2, H / 2, { amount: bonus, text: `Perfect wave +${points(bonus)}` });
  }
  s.wave++;
  s.waveSpawned = s.waveKilled = s.waveEscaped = 0;
  s.clearedAt = 0;
  const wave = s.wave;
  const start = s.tick + 100;
  const queue: Spawn[] = [];
  const add = (at: number, kind: FoeKind, x: number, vx = 0, vy = 0, a = 0, b = 0) => queue.push({ at, kind, x: clamp(Math.round(x), 250, W - 250), vx: vx + 0, vy, a, b });
  if (wave % 5 === 0) {
    s.banner = { text: "Warning", until: s.tick + 150 };
    add(start + 60, "boss", W / 2, 0, 22, 1500, 0);
    s.waveDeadline = start + 60 + RATE * 80;
  } else {
    s.banner = { text: `Wave ${wave}`, until: s.tick + 110 };
    let budget = 6 + wave * 3 + (s.seats - 1) * 3;
    let at = start;
    const gap = () => pick(60, 105) - Math.min(45, wave * 3);
    while (budget > 0) {
      const options: [cost: number, from: number, make: () => void][] = [
        [2, 1, () => {
          // A column of drones, one behind the other, drifting towards the middle.
          const x = pick(700, W - 700);
          const drift = x < W / 2 ? pick(0, 5) : -pick(0, 5);
          for (let i = 0; i < 5; i++) add(at + i * 14, "drone", x, drift, 34, 0, 0);
        }],
        [2, 1, () => {
          // A row of drones swaying from side to side.
          const n = pick(5, 7);
          for (let i = 0; i < n; i++) add(at + (i % 2) * 10, "drone", (W * (i + 1)) / (n + 1), 0, 24, 1, i % 2 ? 16 : -16);
        }],
        [3, 1, () => {
          // Drones from both edges that dip and peel away across the field.
          const depth = pick(2200, 3600);
          for (let i = 0; i < 4; i++) {
            add(at + i * 16, "drone", 500, 6, 40, 2, depth);
            add(at + i * 16 + 8, "drone", W - 500, -6, 40, 2, -depth);
          }
        }],
        [3, 2, () => {
          const n = pick(3, 4) + Math.min(3, Math.floor(wave / 6));
          for (let i = 0; i < n; i++) add(at + i * 22, "dart", pick(500, W - 500));
        }],
        [4, 3, () => {
          const n = wave >= 9 ? 2 : 1;
          for (let i = 0; i < n; i++) add(at + i * 30, "gunship", n === 1 ? pick(1200, W - 1200) : i ? W - 1400 : 1400, 0, 30, pick(1200, 2400), rand() < 0.5 ? 8 : -8);
        }],
        [4, 4, () => {
          const n = wave >= 11 ? 2 : 1;
          for (let i = 0; i < n; i++) add(at + i * 40, "spinner", pick(900, W - 900), 0, 10, pick(0, 35999), 0);
        }],
        [9, 7, () => add(at, "carrier", pick(1800, W - 1800), 0, 20, 1500, rand() < 0.5 ? 5 : -5)],
      ];
      const open = options.filter(([cost, from]) => from <= wave && cost <= budget + 1);
      const [cost, , make] = open[Math.floor(rand() * open.length)] ?? options[0]!;
      make();
      budget -= cost;
      at += gap();
    }
    s.waveDeadline = at + RATE * 7;
  }
  queue.sort((p, q) => p.at - q.at);
  s.queue = queue;
}

function spawn(s: SkyfireState, sp: Spawn) {
  if (s.foes.length >= MAX_FOES) return;
  const base = FOES[sp.kind];
  let hp = base.hp;
  if (sp.kind === "boss") hp = Math.round((base.hp + 9000 * (s.wave / 5 - 1)) * (10 + 6 * (s.seats - 1))) / 10;
  else hp = Math.round((hp * (100 + 6 * rank(s)) * (100 + 50 * (s.seats - 1))) / 10000);
  hp = Math.max(1, Math.round(hp));
  const rand = nextRandom(s);
  s.foes.push({ id: s.nextId++, kind: sp.kind, x: sp.x, y: -base.r, vx: sp.vx, vy: sp.vy, r: base.r, hp, max: hp, t: 0, a: sp.a, b: sp.b, cool: 30 + Math.floor(rand() * 90), worth: base.worth, wave: s.wave });
  s.waveSpawned++;
  if (sp.kind === "boss") say(s, "boss", sp.x, 0);
}

// ---- Foes ----------------------------------------------------------------------------------------

/** Move one foe and let it fire. Returns false when it has left the field. */
function moveFoe(s: SkyfireState, f: Foe): boolean {
  f.t++;
  const r = rank(s);
  const onField = f.y > 150 && f.y < 5600;
  switch (f.kind) {
    case "drone": {
      if (f.a === 1) f.x += Math.floor(f.t / 45) % 2 ? -f.b : f.b;
      else if (f.a === 2 && f.y >= Math.abs(f.b)) {
        // Peel away: sideways faster and faster, and back up the field.
        f.vx = clamp(f.vx + (f.b > 0 ? 2 : -2), -64, 64);
        f.vy = Math.max(-26, f.vy - 2);
      }
      f.x += f.vx;
      f.y += f.vy;
      if (--f.cool <= 0 && onField) {
        fireFan(s, f.x, f.y, r >= 12 ? 3 : 1, 900, bulletSpeed(s, 38), "pink");
        f.cool = Math.max(38, 130 - r * 6) + ((f.id * 37) % 40);
      }
      break;
    }
    case "dart": {
      if (f.t < 46) f.y += 46 - f.t;
      else if (f.t === 46) {
        const target = nearestPilot(s, f.x, f.y);
        [f.vx, f.vy] = toward(f.x, f.y, target ? target.x : f.x, target ? target.y : H, Math.min(130, 92 + r * 2));
        say(s, "dive", f.x, f.y);
      } else {
        f.x += f.vx;
        f.y += f.vy;
      }
      break;
    }
    case "gunship": {
      if (f.t > 760) f.y -= 26;
      else if (f.y < f.a) f.y += f.vy;
      else {
        f.x += f.b;
        if (f.x < 500 || f.x > W - 500) f.b = -f.b;
        if (--f.cool <= 0) {
          fireFan(s, f.x, f.y + 200, r >= 10 ? 7 : r >= 4 ? 5 : 3, 1200, bulletSpeed(s, 42), "pink", 80);
          f.cool = Math.max(34, 84 - r * 2);
        }
      }
      break;
    }
    case "spinner": {
      f.y += f.vy;
      if (--f.cool <= 0 && f.y > 100 && f.y < 6200) {
        fireRing(s, f.x, f.y, 8 + Math.min(10, r), f.a, bulletSpeed(s, 27), "blue");
        f.a = (f.a + 1700) % 36000;
        f.cool = Math.max(16, 26 - (r >> 2));
      }
      break;
    }
    case "carrier": {
      if (f.t > 1500) f.y -= 20;
      else if (f.y < f.a) f.y += f.vy;
      else {
        f.x += f.b;
        if (f.x < 900 || f.x > W - 900) f.b = -f.b;
        const beat = f.t % 240;
        if (beat < 60 && beat % 6 === 0) fireFan(s, f.x, f.y + 300, 1, 0, bulletSpeed(s, 54), "gold", 60);
        if (beat === 120 && s.foes.length < MAX_FOES - 2) {
          for (const side of [-1, 1]) {
            const base = FOES.dart;
            s.foes.push({ id: s.nextId++, kind: "dart", x: f.x + side * 450, y: f.y, vx: 0, vy: 0, r: base.r, hp: base.hp, max: base.hp, t: 30, a: 0, b: 0, cool: 0, worth: base.worth, wave: -1 });
          }
        }
        if (beat === 180) fireRing(s, f.x, f.y, 14 + Math.min(10, r), (f.t * 53) % 36000, bulletSpeed(s, 24), "blue");
      }
      break;
    }
    case "boss": {
      if (f.t > RATE * 75) {
        // Out of time: it leaves, and takes its reward with it.
        f.y -= 30;
        break;
      }
      if (f.y < f.a) {
        f.y += f.vy;
        break;
      }
      if (f.b === 0) f.b = 14;
      f.x += f.b;
      if (f.x < 1400 || f.x > W - 1400) f.b = -f.b;
      const left = (f.hp * 3) / f.max;
      const loop = Math.max(0, Math.floor(s.wave / 5) - 1);
      const mouth = f.y + 350;
      if (left > 2) {
        if (f.t % 44 === 0) fireFan(s, f.x, mouth, 5 + Math.min(4, loop * 2), 1100, bulletSpeed(s, 36), "pink", 80);
        if (f.t % 100 === 50) fireRing(s, f.x, f.y, 18 + loop * 4, (f.t * 91) % 36000, bulletSpeed(s, 24), "blue");
      } else if (left > 1) {
        // Two spirals turning against each other.
        if (f.t % 4 === 0) {
          f.cool = (f.cool + 1300) % 36000;
          for (const angle of [f.cool, 36000 - f.cool, f.cool + 18000]) {
            const [c, sn] = direction(angle);
            const speed = bulletSpeed(s, 28);
            addBullet(s, f.x, f.y, Math.round(c * speed), Math.round(sn * speed), "blue");
          }
        }
        if (f.t % 110 === 0) fireFan(s, f.x, mouth, 3, 700, bulletSpeed(s, 50), "gold", 60);
      } else {
        // Walls with one way through, and a stream to keep the ship moving.
        if (f.t % 52 === 0) {
          const count = 30 + loop * 4;
          fireRing(s, f.x, f.y, count, (f.t * 67) % 36000, bulletSpeed(s, 27), "blue", (f.t / 52) % count | 0, 5);
        }
        if (f.t % 9 === 0) fireFan(s, f.x, mouth, 1, 0, bulletSpeed(s, 50), "gold", 60);
      }
      break;
    }
  }
  return f.y < H + 700 && f.y > -1400 && f.x > -900 && f.x < W + 900;
}

function dropFrom(s: SkyfireState, f: Foe) {
  const rand = nextRandom(s);
  const put = (kind: DropKind, spread: number) => s.drops.push({ id: s.nextId++, kind, x: clamp(f.x + Math.floor((rand() - 0.5) * spread), 200, W - 200), y: f.y + Math.floor((rand() - 0.5) * spread) });
  switch (f.kind) {
    case "drone":
    case "dart":
      if (rand() < 0.3) put("medal", 0);
      break;
    case "gunship":
      put(rand() < 0.6 ? "power" : "medal", 0);
      put("medal", 500);
      break;
    case "spinner":
      for (let i = 0; i < 3; i++) put("medal", 600);
      if (rand() < 0.08) put("bomb", 0);
      break;
    case "carrier":
      put("power", 300);
      put("bomb", 300);
      for (let i = 0; i < 5; i++) put("medal", 1000);
      break;
    case "boss":
      put("power", 500);
      put("power", 500);
      put("bomb", 500);
      for (let i = 0; i < 10; i++) put("medal", 1800);
      break;
  }
}

function kill(s: SkyfireState, f: Foe, seat: number) {
  const p = s.pilots[seat]!;
  p.chain++;
  p.chainTimer = CHAIN_TICKS;
  p.kills++;
  const worth = f.kind === "boss" ? f.worth * Math.floor(s.wave / 5) : f.worth;
  const gain = worth * multiplier(p);
  p.score += gain;
  if (f.wave === s.wave) s.waveKilled++;
  say(s, f.kind === "boss" ? "boss-down" : f.r > 300 ? "big-boom" : "boom", f.x, f.y, { seat, amount: f.r, text: `+${points(gain)}` });
  dropFrom(s, f);
  // From the eighth wave the small ones get a last shot off as they go, unless they went in your face.
  if ((f.kind === "drone" || f.kind === "dart") && s.wave >= 8 && f.y < p.y - 1500 && (f.id & 1 || s.wave >= 14)) fireFan(s, f.x, f.y, 1, 0, bulletSpeed(s, 44), "gold", 60);
  if (f.kind === "boss") {
    // Its bullets go with it.
    for (const b of s.bullets) say(s, "fizz", b.x, b.y);
    s.bullets = [];
  }
}

// ---- A tick --------------------------------------------------------------------------------------

/** The guns at each power: where a shot leaves the ship and how it flies. */
const GUNS: [offset: number, vx: number][][] = [
  [[-80, 0], [80, 0]],
  [[-130, 0], [0, 0], [130, 0]],
  [[-130, 0], [0, 0], [130, 0], [-170, -24], [170, 24]],
  [[-190, 0], [-65, 0], [65, 0], [190, 0], [-210, -24], [210, 24]],
  [[-190, 0], [-65, 0], [65, 0], [190, 0], [-210, -24], [210, 24], [-230, -52], [230, 52]],
];

function loseShip(s: SkyfireState, p: Pilot, seat: number) {
  p.lives--;
  p.chain = 0;
  p.chainTimer = 0;
  p.bombing = 0;
  say(s, "down", p.x, p.y, { seat });
  // The blast takes the bullets round it, and some of the ship's power is left behind to pick up.
  s.bullets = s.bullets.filter((b) => !touching(b.x, b.y, b.r, p.x, p.y, 900));
  if (p.power > 1) {
    p.power--;
    s.drops.push({ id: s.nextId++, kind: "power", x: p.x, y: Math.max(400, p.y - 900) });
  }
  if (p.lives <= 0) {
    p.lives = 0;
    p.out = true;
  } else {
    p.down = DOWN_TICKS;
    p.bombs = s.rules.bombs;
  }
}

function flyIn(s: SkyfireState, p: Pilot, seat: number) {
  p.x = startX(seat, s.seats);
  p.y = HOME_Y;
  p.ghost = GHOST_TICKS;
  p.down = 0;
  p.out = false;
}

function step(s: SkyfireState, inputs: readonly (SkyfireInput | null | undefined)[]) {
  if (s.phase === "over") return;
  s.tick++;
  s.events = [];
  if (s.banner && s.tick > s.banner.until) s.banner = null;

  // Pilots: the next ship in, moving, the bomb, the guns.
  s.pilots.forEach((p, seat) => {
    if (p.out) return;
    if (p.down > 0) {
      if (--p.down === 0) flyIn(s, p, seat);
      return;
    }
    const input = safeInput(inputs[seat]);
    p.x = clamp(p.x + input.dx, 200, W - 200);
    p.y = clamp(p.y + input.dy, 500, H - 300);
    if (p.ghost > 0) p.ghost--;
    if (input.bomb && !p.bombHeld && p.bombs > 0 && p.bombing === 0) {
      p.bombs--;
      p.bombing = BOMB_TICKS;
      p.ghost = Math.max(p.ghost, GHOST_TICKS);
      say(s, "bomb", p.x, p.y, { seat });
    }
    p.bombHeld = input.bomb;
    if (p.cool > 0) p.cool--;
    if (input.fire && p.cool === 0) {
      p.cool = 4;
      for (const [offset, vx] of GUNS[p.power - 1]!) s.shots.push({ id: s.nextId++, x: p.x + offset, y: p.y - 150, vx, vy: -190, seat, dmg: 10 });
      say(s, "shoot", p.x, p.y, { seat });
    }
    if (p.chainTimer > 0 && --p.chainTimer === 0) p.chain = 0;
  });

  // The wave: what is due comes on; when the field is empty, or time is up, the next one starts.
  while (s.queue.length && s.queue[0]!.at <= s.tick) spawn(s, s.queue.shift()!);
  if (s.wave === 0) nextWave(s);
  else if (!s.queue.length) {
    if (!s.foes.length && !s.clearedAt) s.clearedAt = s.tick;
    if ((s.clearedAt && s.tick - s.clearedAt >= 70) || s.tick > s.waveDeadline) nextWave(s);
  }

  // Foes.
  const bombing = s.pilots.findIndex((p) => p.bombing > 0);
  s.foes = s.foes.filter((f) => {
    if (moveFoe(s, f)) return true;
    if (f.wave === s.wave) s.waveEscaped++;
    return false;
  });
  if (bombing >= 0) {
    // What a bomb finishes off belongs to whoever set it off.
    for (const f of s.foes) {
      if (f.hp <= 0 || f.y <= -f.r) continue;
      f.hp -= f.kind === "boss" ? 14 : 9;
      if (f.hp <= 0) kill(s, f, bombing);
    }
  }

  // Shots, and what they hit.
  s.shots = s.shots.filter((shot) => {
    shot.x += shot.vx;
    shot.y += shot.vy;
    if (shot.y < -200 || shot.x < -200 || shot.x > W + 200) return false;
    for (const f of s.foes) {
      if (f.hp <= 0 || f.y < -f.r / 2) continue;
      // A shot is long: it covers the ground it flew over this tick.
      if (Math.abs(shot.x - f.x) <= f.r + 70 && shot.y <= f.y + f.r + 70 && shot.y + 190 >= f.y - f.r - 70) {
        f.hp -= shot.dmg;
        s.pilots[shot.seat]!.score += 10;
        if (f.hp <= 0) kill(s, f, shot.seat);
        else if ((shot.id & 3) === 0) say(s, "hit", shot.x, f.y + f.r);
        return false;
      }
    }
    return true;
  });
  s.foes = s.foes.filter((f) => f.hp > 0);

  // Bullets: a bomb turns them to nothing; otherwise they graze, or they hit.
  if (bombing >= 0) {
    for (const b of s.bullets) say(s, "fizz", b.x, b.y);
    s.bullets = [];
  }
  s.bullets = s.bullets.filter((b) => {
    b.x += b.vx;
    b.y += b.vy;
    if (b.x < -300 || b.x > W + 300 || b.y < -300 || b.y > H + 300) return false;
    for (let seat = 0; seat < s.pilots.length; seat++) {
      const p = s.pilots[seat]!;
      if (!flying(p) || !touching(b.x, b.y, b.r, p.x, p.y, GRAZE)) continue;
      if (p.ghost === 0 && touching(b.x, b.y, b.r, p.x, p.y, CORE)) {
        loseShip(s, p, seat);
        return false;
      }
      if (!(b.grazed & (1 << seat))) {
        b.grazed |= 1 << seat;
        p.grazes++;
        p.score += 20 * multiplier(p);
        if (p.chain > 0) p.chainTimer = Math.min(CHAIN_TICKS, p.chainTimer + 10);
        say(s, "graze", p.x, p.y, { seat });
      }
    }
    return true;
  });

  // Flying into a foe costs a ship too.
  s.pilots.forEach((p, seat) => {
    if (!flying(p) || p.ghost > 0) return;
    for (const f of s.foes) {
      if (touching(f.x, f.y, Math.round(f.r * 0.7), p.x, p.y, CORE)) {
        loseShip(s, p, seat);
        return;
      }
    }
  });

  // What was dropped: it falls, it is drawn to a ship close by, it is picked up or lost.
  s.drops = s.drops.filter((d) => {
    let near: Pilot | null = null;
    let nearSeat = -1;
    let nearD = MAGNET * MAGNET;
    s.pilots.forEach((p, seat) => {
      if (!flying(p)) return;
      const dist = (p.x - d.x) * (p.x - d.x) + (p.y - d.y) * (p.y - d.y);
      if (dist < nearD) {
        nearD = dist;
        near = p;
        nearSeat = seat;
      }
    });
    if (near) {
      const p = near as Pilot;
      if (nearD <= PICKUP * PICKUP) {
        collect(s, d, p, nearSeat);
        return false;
      }
      const [vx, vy] = toward(d.x, d.y, p.x, p.y, 80);
      d.x += vx;
      d.y += vy;
    } else d.y += 13;
    if (d.y > H + 200) {
      if (d.kind === "medal" && s.medal > 0) {
        s.medal = 0;
        say(s, "medal-lost", d.x, H - 200, { text: "Medal chain lost" });
      }
      return false;
    }
    return true;
  });

  for (const p of s.pilots) if (p.bombing > 0) p.bombing--;

  // Extra ships, for the crew's score: to whoever is out first, then whoever has fewest.
  if (s.rules.extends && crewScore(s) >= s.nextExtend) {
    s.nextExtend = s.nextExtend < 1_000_000 ? 1_000_000 : s.nextExtend + 1_500_000;
    const order = s.pilots.map((p, seat) => ({ p, seat })).sort((a, b) => a.p.lives - b.p.lives || a.seat - b.seat);
    const { p, seat } = order[0]!;
    if (p.lives < MAX_LIVES) {
      p.lives++;
      if (p.out) {
        flyIn(s, p, seat);
        p.bombs = Math.max(p.bombs, s.rules.bombs);
      }
      say(s, "extend", p.x, p.y, { seat, text: "Extra ship" });
    }
  }

  if (s.pilots.every((p) => p.out)) {
    s.phase = "over";
    s.banner = { text: "Game over", until: Number.MAX_SAFE_INTEGER };
    say(s, "over", W / 2, H / 2);
  }
}

function collect(s: SkyfireState, d: Drop, p: Pilot, seat: number) {
  if (d.kind === "medal") {
    const value = MEDALS[Math.min(s.medal, MEDALS.length - 1)]!;
    s.medal++;
    p.score += value;
    say(s, "medal", d.x, d.y, { seat, amount: value, text: `+${points(value)}` });
  } else if (d.kind === "power") {
    if (p.power < MAX_POWER) {
      p.power++;
      say(s, "power", d.x, d.y, { seat, text: p.power === MAX_POWER ? "Full power" : "Power up" });
    } else {
      p.score += 2000;
      say(s, "power", d.x, d.y, { seat, amount: 2000, text: "+2,000" });
    }
  } else if (p.bombs < MAX_BOMBS) {
    p.bombs++;
    say(s, "bomb-up", d.x, d.y, { seat, text: "Bomb" });
  } else {
    p.score += 2000;
    say(s, "bomb-up", d.x, d.y, { seat, amount: 2000, text: "+2,000" });
  }
}

// ---- The view ------------------------------------------------------------------------------------

const BOSS_NAMES = ["Thunderhead", "Ironclad", "Nightglass", "Red Comet", "Leviathan"];
const FOE_TONE: Record<FoeKind, string> = { drone: "red", dart: "orange", gunship: "purple", spinner: "teal", carrier: "grey", boss: "crimson" };

function view(s: SkyfireState): ArcadeView {
  const things: ArcadeThing[] = [];
  for (const d of s.drops) things.push({ id: d.id, kind: `drop:${d.kind}`, x: d.x, y: d.y, r: 150, tone: d.kind === "medal" ? "gold" : d.kind === "power" ? "red" : "green" });
  for (const f of s.foes) {
    const moving = f.kind === "dart" && f.t > 46;
    things.push({ id: f.id, kind: `foe:${f.kind}`, x: f.x, y: f.y, r: f.r, tone: FOE_TONE[f.kind], ...(f.max >= 200 ? { health: Math.max(0, Math.round((f.hp * 1000) / f.max)) } : {}), ...(moving ? { angle: headingOf(f.vx, f.vy) } : {}) });
  }
  for (const shot of s.shots) things.push({ id: shot.id, kind: "shot", x: shot.x, y: shot.y, r: 70, tone: TONES[shot.seat % TONES.length]!, seat: shot.seat });
  s.pilots.forEach((p, seat) => {
    if (!flying(p)) return;
    things.push({ id: -1 - seat, kind: "ship", x: p.x, y: p.y, r: SHIP_R, core: CORE, tone: TONES[seat % TONES.length]!, seat, ...(p.ghost > 0 ? { ghost: true } : {}) });
    if (p.bombing > 0) things.push({ id: -101 - seat, kind: "blast", x: p.x, y: p.y, r: Math.round(((BOMB_TICKS - p.bombing + 1) * 9000) / BOMB_TICKS), tone: "white", seat });
  });
  for (const b of s.bullets) things.push({ id: b.id, kind: "bullet", x: b.x, y: b.y, r: b.r, tone: b.tone });
  const boss = s.foes.find((f) => f.kind === "boss");
  return {
    game: "skyfire",
    tick: s.tick,
    rate: RATE,
    seats: s.seats,
    field: SKYFIRE_FIELD,
    things,
    pilots: s.pilots.map((p, seat) => ({
      seat,
      playing: !p.out,
      score: p.score,
      lives: p.lives,
      stats: [
        { key: "bombs", label: "Bombs", value: p.bombs, max: MAX_BOMBS },
        { key: "power", label: "Power", value: p.power, max: MAX_POWER },
        { key: "multiplier", label: "Multiplier", value: multiplier(p), max: 16 },
        { key: "chain", label: "Chain", value: Math.round((p.chainTimer * 1000) / CHAIN_TICKS), max: 1000 },
      ],
    })),
    score: crewScore(s),
    stage: s.wave % 5 === 0 && s.wave > 0 ? `Wave ${s.wave} · Boss` : `Wave ${Math.max(1, s.wave)}`,
    ...(boss ? { boss: { name: BOSS_NAMES[(Math.floor(s.wave / 5) - 1) % BOSS_NAMES.length]!, health: Math.max(0, Math.round((boss.hp * 1000) / boss.max)) } } : {}),
    ...(s.banner ? { banner: s.banner.text } : {}),
    events: s.events,
    over: s.phase === "over",
  };
}

/** A heading for drawing, to the nearest eighth of a turn: nothing in the game depends on it. */
function headingOf(vx: number, vy: number): number {
  const ax = Math.abs(vx);
  const ay = Math.abs(vy);
  const steep = ay > ax * 2;
  const flat = ax > ay * 2;
  if (steep) return vy > 0 ? 9000 : 27000;
  if (flat) return vx > 0 ? 0 : 18000;
  return vx > 0 ? (vy > 0 ? 4500 : 31500) : vy > 0 ? 13500 : 22500;
}

// ---- The computer pilot --------------------------------------------------------------------------

const MOVES: [number, number][] = [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, 1], [1, -1], [-1, -1]];

/**
 * A computer pilot: it looks a little way ahead at where the bullets round it will be, and takes
 * the move that keeps it clearest, leaning towards whatever it wants to shoot or pick up. Skill
 * is how far ahead it looks; a sloppy one sometimes doesn't look at all.
 */
function bot(s: SkyfireState, seat: number, style: PlayStyle, rand: () => number = Math.random): SkyfireInput {
  const p = s.pilots[seat];
  if (!p || !flying(p) || s.phase === "over") return IDLE;
  const skill = style.skill ?? 0.7;
  if (rand() < (style.sloppy ?? 0.05)) return { dx: 0, dy: 0, fire: true, bomb: false };
  const horizon = 5 + Math.round(skill * 13);
  const reach = SKYFIRE_SPEED * horizon + 900;
  const threats: { x: number; y: number; vx: number; vy: number; r: number }[] = [];
  for (const b of s.bullets) if (Math.abs(b.x - p.x) < reach && Math.abs(b.y - p.y) < reach + 600) threats.push(b);
  for (const f of s.foes) {
    if (Math.abs(f.x - p.x) >= reach + f.r || Math.abs(f.y - p.y) >= reach + f.r + 600) continue;
    const diving = f.kind === "dart" && f.t > 46;
    const falling = f.kind === "drone" || f.kind === "spinner";
    threats.push({ x: f.x, y: f.y, vx: diving ? f.vx : 0, vy: diving || falling ? f.vy : 0, r: f.r });
  }

  // Where it would like to be: under something to shoot, or on its way to something to pick up.
  let wantX = W / 2;
  let wantY = HOME_Y;
  let lowest = -Infinity;
  for (const f of s.foes) {
    if (f.y > lowest && f.y < p.y - 300 && f.y > 0) {
      lowest = f.y;
      wantX = f.x;
    }
  }
  let nearDrop = 3000 * 3000;
  for (const d of s.drops) {
    const dist = (d.x - p.x) * (d.x - p.x) + (d.y - p.y) * (d.y - p.y);
    if (dist < nearDrop && d.y > 2600) {
      nearDrop = dist;
      wantX = d.x;
      wantY = clamp(d.y, 3200, H - 400);
    }
  }

  let best = IDLE;
  let bestCost = Infinity;
  let bestHit = Infinity;
  for (const pace of [SKYFIRE_SPEED, SKYFIRE_SPEED >> 1]) {
    for (const [mx, my] of MOVES) {
      if (pace !== SKYFIRE_SPEED && mx === 0 && my === 0) continue;
      const input = safeInput({ dx: mx * pace, dy: my * pace });
      let x = p.x;
      let y = p.y;
      let cost = 0;
      let hitAt = Infinity;
      for (let k = 1; k <= horizon; k++) {
        // It commits to a move for a few ticks, then thinks again.
        if (k <= 5) {
          x = clamp(x + input.dx, 200, W - 200);
          y = clamp(y + input.dy, 500, H - 300);
        }
        for (const t of threats) {
          const dx = t.x + t.vx * k - x;
          const dy = t.y + t.vy * k - y;
          const gap = Math.sqrt(dx * dx + dy * dy) - t.r - CORE;
          if (gap < 45) {
            if (k < hitAt) hitAt = k;
            cost += 2_000_000 / k;
          } else if (gap < 420) cost += ((420 - gap) * 6) / k;
        }
      }
      cost += Math.abs(x - wantX) * 0.6 + Math.abs(y - wantY) * 0.5 + (mx || my ? 0 : -20);
      if (cost < bestCost) {
        bestCost = cost;
        bestHit = hitAt;
        best = input;
      }
    }
  }
  const trapped = p.ghost === 0 && bestHit <= 4 && skill >= 0.3;
  return { dx: best.dx, dy: best.dy, fire: true, bomb: trapped && p.bombs > 0 && !p.bombHeld };
}

// ---- The game ------------------------------------------------------------------------------------

function summary(s: SkyfireState): ArcadeSummary {
  const scores = s.pilots.map((p) => p.score);
  const score = crewScore(s);
  return {
    game: "skyfire",
    rules: s.rules.name,
    phase: s.phase === "over" ? "over" : s.wave % 5 === 0 && s.wave > 0 ? "boss" : "wave",
    over: s.phase === "over",
    seats: s.seats,
    ticks: s.tick,
    score,
    scores,
    scoreLine: s.seats > 1 ? `Wave ${Math.max(1, s.wave)} · ${points(score)} (${scores.map((n, seat) => `${who(seat)} ${points(n)}`).join(" · ")})` : `Wave ${Math.max(1, s.wave)} · ${points(score)}`,
    order: scores.map((n, seat) => ({ n, seat })).sort((a, b) => b.n - a.n || a.seat - b.seat).map((e) => e.seat),
  };
}

function normalize(rules: unknown): SkyfireRules {
  const base = SKYFIRE_PRESETS[0]!;
  const given = (rules && typeof rules === "object" ? rules : {}) as Partial<SkyfireRules>;
  const preset = SKYFIRE_PRESETS.find((p) => p.id === given.id) ?? base;
  const number = (value: unknown, fallback: number, low: number, high: number) => (typeof value === "number" && Number.isFinite(value) ? clamp(Math.round(value), low, high) : fallback);
  return {
    id: typeof given.id === "string" ? given.id : preset.id,
    name: typeof given.name === "string" && given.name ? given.name : preset.name,
    lives: number(given.lives, preset.lives, 1, MAX_LIVES),
    bombs: number(given.bombs, preset.bombs, 0, MAX_BOMBS),
    bulletSpeed: number(given.bulletSpeed, preset.bulletSpeed, 60, 150),
    extends: typeof given.extends === "boolean" ? given.extends : preset.extends,
  };
}

export const skyfire: ArcadeGame<SkyfireRules, SkyfireState, SkyfireInput> = {
  id: "skyfire",
  name: "Skyfire",
  emoji: "🚀",
  category: "arcade",
  blurb: "Dodge the bullets, chain the kills, beat your score",
  tagline: "A shoot-'em-up with no end: wave after wave, a boss every fifth, and a score to beat. Fly alone or with a crew of up to four.",
  seats: { min: 1, max: 4, default: 1 },
  teams: false,
  presets: SKYFIRE_PRESETS,
  fields: [
    { key: "lives", label: "Ships", hint: "How many each pilot starts with", kind: "number", min: 1, max: MAX_LIVES },
    { key: "bombs", label: "Bombs", hint: "How many each ship carries. A bomb clears the bullets and keeps you safe for a moment", kind: "number", min: 0, max: MAX_BOMBS },
    { key: "bulletSpeed", label: "Bullet speed", kind: "choice", options: [[80, "Slow"], [100, "Normal"], [120, "Fast"], [140, "Very fast"]] },
    { key: "extends", label: "Extra ships", hint: "One at 300,000 points, one at a million and one every million and a half after, to whoever needs it most", kind: "toggle" },
  ],
  normalize,
  validate(rules) {
    const problems: string[] = [];
    if (!Number.isInteger(rules.lives) || rules.lives < 1 || rules.lives > MAX_LIVES) problems.push(`Ships must be between 1 and ${MAX_LIVES}.`);
    if (!Number.isInteger(rules.bombs) || rules.bombs < 0 || rules.bombs > MAX_BOMBS) problems.push(`Bombs must be between 0 and ${MAX_BOMBS}.`);
    if (!Number.isInteger(rules.bulletSpeed) || rules.bulletSpeed < 60 || rules.bulletSpeed > 150) problems.push("Bullet speed must be between 60% and 150%.");
    return problems;
  },
  describe(rules) {
    return [
      `Each pilot has ${rules.lives === 1 ? "one ship" : `${rules.lives} ships`} and ${rules.bombs === 1 ? "one bomb" : `${rules.bombs} bombs`} a ship.`,
      rules.bulletSpeed === 100 ? "Bullets fly at their usual speed." : `Bullets fly at ${rules.bulletSpeed}% of their usual speed.`,
      "Kills in a chain raise your multiplier, up to ×16. Being hit, or leaving it too long between kills, puts it back to ×1.",
      "Each medal is worth more than the last, up to 10,000. Let one fall and the next is worth 100 again.",
      "A wave with nothing left and nothing escaped pays a bonus. Every fifth wave is a boss.",
      rules.extends ? "An extra ship at 300,000 points, at a million, and every million and a half after." : "No extra ships.",
    ];
  },
  controls: [
    "Move with the arrow keys or WASD, or drag anywhere on a touch screen: the ship follows your finger.",
    "Hold Shift to move slowly through a tight gap.",
    "Hold Z or Space to fire. On a touch screen the guns fire by themselves.",
    "Press X for a bomb, or tap with a second finger.",
    "Only the small light in the middle of your ship can be hit.",
  ],
  rate: RATE,
  newGame(rules, seats, seed) {
    const count = clamp(Math.trunc(seats) || 1, 1, 4);
    return {
      rules,
      seats: count,
      rng: seed >>> 0,
      tick: 0,
      phase: "play",
      wave: 0,
      queue: [],
      waveDeadline: 0,
      clearedAt: 0,
      waveSpawned: 0,
      waveKilled: 0,
      waveEscaped: 0,
      pilots: Array.from({ length: count }, (_, seat) => ({ x: startX(seat, count), y: HOME_Y, lives: rules.lives, bombs: rules.bombs, power: 1, ghost: 90, down: 0, out: false, cool: 0, bombing: 0, bombHeld: false, score: 0, chain: 0, chainTimer: 0, kills: 0, grazes: 0 })),
      shots: [],
      foes: [],
      bullets: [],
      drops: [],
      nextId: 1,
      medal: 0,
      nextExtend: 300_000,
      banner: null,
      events: [],
    };
  },
  idle: IDLE,
  input: safeInput,
  step,
  view,
  bot,
  summary,
};
