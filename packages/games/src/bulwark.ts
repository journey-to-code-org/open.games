// Bulwark: a tower defence, the second game on the arcade kit. A road winds down the field, a
// different one every game; wave after wave walks it; whatever reaches the bottom costs a life.
// You build towers beside the road with the gold the fallen leave, and the waves never stop: they
// get tougher until the last life is gone, and the score is what you play for.
//
// What makes it a game of nerve:
//   - The next wave comes on a clock, whether the last is dealt with or not. Sending it early
//     pays gold and points for every second you gave up.
//   - Gold kept in the bank earns interest at the start of each wave, so everything spent now is
//     a little less later.
//   - Each tower is good at one thing. Darts are cheap, mortars hit crowds but not the air, frost
//     slows, tesla jumps between the small and ignores armour, snipers reach across the field.
//
// One to four people play the same field from one bank and one set of lives. More hands make
// nothing easier or harder but the arguing: the waves and the gold are the same.
//
// Everything in the state is a whole number: positions in field units (6000 by 8000, cells of
// 500), timers in ticks. A seat's input is a command with a number on it, and a command is carried
// out once: when its number is new. So an input can be held for as long as a room likes without
// anything being built twice.
import type { PlayStyle } from "@journey-to-code/rules";
import { heading8, points, type ArcadeBuild, type ArcadeEvent, type ArcadeGame, type ArcadeSummary, type ArcadeThing, type ArcadeView } from "./arcade.js";
import { nextRandom, who, type BaseRules } from "./table.js";

export const BULWARK_FIELD = { width: 6000, height: 8000 };
export const BULWARK_GRID = { cols: 12, rows: 16, cell: 500 };
const W = BULWARK_FIELD.width;
const H = BULWARK_FIELD.height;
const { cols: COLS, rows: ROWS, cell: CELL } = BULWARK_GRID;
const RATE = 60;
const MAX_CREEPS = 320;
/** Ticks between the last of one wave coming on and the next wave starting by itself. */
const BREATH = RATE * 12;
const FIRST_BREATH = RATE * 20;
const TONES = ["blue", "red", "green", "gold"];

export interface BulwarkRules extends BaseRules {
  /** How many may get through. */
  lives: number;
  /** Gold to start with. */
  gold: number;
  /** How much the waves can take, as a percentage. */
  toughness: number;
  /** Gold in the bank earns 4% at the start of each wave (150 at most). */
  interest: boolean;
}

export const BULWARK_PRESETS: BulwarkRules[] = [
  { id: "standard", name: "Standard", lives: 20, gold: 220, toughness: 100, interest: true },
  { id: "gentle", name: "Gentle", lives: 30, gold: 300, toughness: 80, interest: true },
  { id: "grim", name: "Grim", lives: 10, gold: 200, toughness: 125, interest: true },
  { id: "lastgate", name: "Last gate", lives: 1, gold: 260, toughness: 100, interest: false },
];

export type TowerKind = "dart" | "mortar" | "frost" | "tesla" | "sniper";
export const BULWARK_TOWERS: TowerKind[] = ["dart", "mortar", "frost", "tesla", "sniper"];

/** What a seat asks for. It is carried out on the tick its `n` is first seen, and not again. */
export interface BulwarkInput {
  /** A number that is different for every command a seat gives: one more each time will do. */
  n: number;
  cmd: "none" | "build" | "upgrade" | "sell" | "send";
  /** The cell: for building, where; for upgrading and selling, whose. */
  col: number;
  row: number;
  /** For building: what. */
  kind: TowerKind;
}

interface Level {
  cost: number;
  range: number;
  dmg: number;
  /** Ticks between shots. */
  cool: number;
  /** Mortar: how far the blast reaches. Tesla: how many it jumps to. Frost: speed left, in tenths. */
  extra: number;
}
const TOWERS: Record<TowerKind, { label: string; hint: string; tone: string; levels: [Level, Level, Level] }> = {
  dart: {
    label: "Dart",
    hint: "Cheap and quick, one target at a time. Armour shrugs most of it off.",
    tone: "green",
    levels: [
      { cost: 50, range: 1400, dmg: 9, cool: 18, extra: 0 },
      { cost: 50, range: 1500, dmg: 17, cool: 16, extra: 0 },
      { cost: 110, range: 1700, dmg: 32, cool: 13, extra: 0 },
    ],
  },
  mortar: {
    label: "Mortar",
    hint: "A slow shell that hits everything near where it lands. Cannot hit flyers.",
    tone: "orange",
    levels: [
      { cost: 120, range: 1800, dmg: 38, cool: 84, extra: 550 },
      { cost: 120, range: 2000, dmg: 70, cool: 78, extra: 600 },
      { cost: 250, range: 2200, dmg: 130, cool: 70, extra: 700 },
    ],
  },
  frost: {
    label: "Frost",
    hint: "Slows everything in reach, flyers too. Hardly hurts.",
    tone: "teal",
    levels: [
      { cost: 90, range: 1100, dmg: 2, cool: 30, extra: 6 },
      { cost: 90, range: 1300, dmg: 4, cool: 30, extra: 5 },
      { cost: 190, range: 1500, dmg: 8, cool: 30, extra: 4 },
    ],
  },
  tesla: {
    label: "Tesla",
    hint: "Lightning that jumps from one to the next, straight through armour.",
    tone: "purple",
    levels: [
      { cost: 160, range: 1300, dmg: 14, cool: 26, extra: 3 },
      { cost: 160, range: 1400, dmg: 22, cool: 24, extra: 4 },
      { cost: 330, range: 1500, dmg: 34, cool: 22, extra: 6 },
    ],
  },
  sniper: {
    label: "Sniper",
    hint: "Reaches across the field and picks the strongest. Slow to reload.",
    tone: "gold",
    levels: [
      { cost: 140, range: 3200, dmg: 90, cool: 110, extra: 0 },
      { cost: 140, range: 3600, dmg: 180, cool: 104, extra: 0 },
      { cost: 290, range: 4000, dmg: 360, cool: 96, extra: 0 },
    ],
  },
};

type CreepKind = "grunt" | "runner" | "swarm" | "brute" | "flyer" | "boss";
const CREEPS: Record<CreepKind, { hp: number; speed: number; bounty: number; armour: number; r: number; lives: number; tone: string; from: number; plural: string }> = {
  grunt: { hp: 60, speed: 14, bounty: 6, armour: 0, r: 150, lives: 1, tone: "red", from: 1, plural: "grunts" },
  runner: { hp: 36, speed: 26, bounty: 6, armour: 0, r: 120, lives: 1, tone: "orange", from: 2, plural: "runners" },
  swarm: { hp: 16, speed: 19, bounty: 3, armour: 0, r: 90, lives: 1, tone: "pink", from: 3, plural: "swarmers" },
  brute: { hp: 340, speed: 9, bounty: 22, armour: 4, r: 210, lives: 2, tone: "grey", from: 5, plural: "brutes" },
  flyer: { hp: 70, speed: 18, bounty: 10, armour: 0, r: 140, lives: 1, tone: "blue", from: 7, plural: "flyers" },
  boss: { hp: 3200, speed: 7, bounty: 220, armour: 5, r: 320, lives: 10, tone: "crimson", from: 10, plural: "bosses" },
};

interface Tower {
  id: number;
  kind: TowerKind;
  col: number;
  row: number;
  /** 1 to 3. */
  level: number;
  /** Ticks until it can fire again. */
  cool: number;
  /** All the gold put into it. */
  spent: number;
  seat: number;
  /** Which way it last fired, for drawing. */
  aim: number;
}
interface Creep {
  id: number;
  kind: CreepKind;
  /** How far along its way it is, in field units. */
  d: number;
  hp: number;
  max: number;
  /** Ticks of slowing left, and the speed it leaves, in tenths. */
  slow: number;
  slowTo: number;
  bounty: number;
}
interface Spawn {
  at: number;
  kind: CreepKind;
}

export interface BulwarkState {
  rules: BulwarkRules;
  seats: number;
  rng: number;
  tick: number;
  phase: "play" | "over";
  /** The road, as cells (row × 12 + col), from the top of the field to the bottom. */
  road: number[];
  /** The wave that is on now, or the last that was. */
  wave: number;
  /** What is still to come on of the wave that is on. */
  queue: Spawn[];
  /** The wave after: what is in it, and the tick it starts by itself. Null while one is coming on. */
  next: { wave: number; at: number; spawns: Spawn[] } | null;
  bank: number;
  lives: number;
  towers: Tower[];
  creeps: Creep[];
  nextId: number;
  /** Each seat's score: what its own towers brought down, and its share of the bonuses. */
  scores: number[];
  /** The last command number seen from each seat. */
  seen: number[];
  leaked: number;
  kills: number;
  banner: { text: string; until: number } | null;
  events: ArcadeEvent[];
}

const IDLE: BulwarkInput = { n: 0, cmd: "none", col: 0, row: 0, kind: "dart" };
const clamp = (n: number, low: number, high: number) => (n < low ? low : n > high ? high : n);
const whole = (n: unknown) => (typeof n === "number" && Number.isFinite(n) ? Math.trunc(n) + 0 : 0);
const CMDS = ["none", "build", "upgrade", "sell", "send"];

function safeInput(given: unknown): BulwarkInput {
  if (!given || typeof given !== "object") return IDLE;
  const g = given as Record<string, unknown>;
  const cmd = CMDS.includes(g.cmd as string) ? (g.cmd as BulwarkInput["cmd"]) : "none";
  return {
    n: clamp(whole(g.n), 0, 2 ** 31 - 1),
    cmd,
    col: clamp(whole(g.col), 0, COLS - 1),
    row: clamp(whole(g.row), 0, ROWS - 1),
    kind: BULWARK_TOWERS.includes(g.kind as TowerKind) ? (g.kind as TowerKind) : "dart",
  };
}

function say(s: BulwarkState, kind: string, x: number, y: number, more: Partial<ArcadeEvent> = {}) {
  if (s.events.length < 120) s.events.push({ kind, x, y, ...more });
}
const centre = (col: number, row: number): [number, number] => [col * CELL + CELL / 2, row * CELL + CELL / 2];
const towerAt = (s: BulwarkState, col: number, row: number) => s.towers.find((t) => t.col === col && t.row === row);
const levelOf = (t: Tower) => TOWERS[t.kind].levels[t.level - 1]!;

// ---- The road ------------------------------------------------------------------------------------

/**
 * A road from the top of the field to the bottom, winding from side to side: down a little, across
 * to the far side, down a little more, back again. Runs across are at least three rows apart, so
 * there is always ground between them to build on.
 */
function layRoad(rand: () => number): number[] {
  const pick = (low: number, high: number) => low + Math.floor(rand() * (high - low + 1));
  const cells: number[] = [];
  let col = pick(2, COLS - 3);
  let row = 0;
  let left = rand() < 0.5;
  let turn = pick(1, 2);
  cells.push(col);
  while (true) {
    while (row < Math.min(turn, ROWS - 1)) cells.push(++row * COLS + col);
    if (row >= ROWS - 1 || turn > ROWS - 3) break;
    const to = left ? pick(0, 2) : pick(COLS - 3, COLS - 1);
    while (col !== to) {
      col += to > col ? 1 : -1;
      cells.push(row * COLS + col);
    }
    left = !left;
    turn += pick(3, 4);
  }
  while (row < ROWS - 1) cells.push(++row * COLS + col);
  return cells;
}

/** The road as points to walk: in above the first cell, through every cell's middle, out below the last. */
function waypoints(road: readonly number[]): [number, number][] {
  const first = road[0]!;
  const last = road[road.length - 1]!;
  return [[(first % COLS) * CELL + CELL / 2, -CELL / 2], ...road.map((c) => centre(c % COLS, Math.floor(c / COLS))), [(last % COLS) * CELL + CELL / 2, H + CELL / 2]];
}
const roadLength = (road: readonly number[]) => (road.length + 1) * CELL;
/** The straight line a flyer takes, from where the road comes in to where it goes out. */
function flightLength(wp: readonly [number, number][]) {
  const [ax, ay] = wp[0]!;
  const [bx, by] = wp[wp.length - 1]!;
  return Math.round(Math.sqrt((bx - ax) * (bx - ax) + (by - ay) * (by - ay)));
}

/** Where a creep is. Walkers are on the road; flyers go straight over everything. */
function place(c: Creep, wp: readonly [number, number][], flight: number): [number, number] {
  if (c.kind === "flyer") {
    const [ax, ay] = wp[0]!;
    const [bx, by] = wp[wp.length - 1]!;
    const d = Math.min(c.d, flight);
    return [ax + Math.round(((bx - ax) * d) / flight), ay + Math.round(((by - ay) * d) / flight)];
  }
  const i = Math.min(Math.floor(c.d / CELL), wp.length - 2);
  const part = c.d - i * CELL;
  const [ax, ay] = wp[i]!;
  const [bx, by] = wp[i + 1]!;
  // Every stretch is one cell long and straight along x or y, so this is exact.
  return [ax + Math.sign(bx - ax) * Math.min(part, CELL), ay + Math.sign(by - ay) * Math.min(part, CELL)];
}

// ---- Waves ---------------------------------------------------------------------------------------

/** What the wave after `wave - 1` holds: worked out when its clock starts, so it can be shown. */
function composeWave(s: BulwarkState, wave: number): Spawn[] {
  const rand = nextRandom(s);
  const spawns: Spawn[] = [];
  const row = (kind: CreepKind, count: number, gap: number, from: number) => {
    for (let i = 0; i < count; i++) spawns.push({ at: from + i * gap, kind });
    return from + count * gap;
  };
  if (wave % 10 === 0) {
    const end = row("grunt", 8 + Math.floor(wave / 2), 22, 0);
    row("boss", wave / 10, 150, end + 40);
    row("runner", 6 + Math.floor(wave / 3), 16, end + 120);
  } else {
    const open = (Object.keys(CREEPS) as CreepKind[]).filter((k) => k !== "boss" && CREEPS[k].from <= wave);
    const main = open[Math.floor(rand() * open.length)]!;
    const size: Record<CreepKind, number> = { grunt: 8 + wave, runner: 7 + wave, swarm: 16 + wave * 2, brute: 2 + Math.floor(wave / 3), flyer: 5 + Math.floor(wave / 2), boss: 0 };
    const gap: Record<CreepKind, number> = { grunt: 28, runner: 20, swarm: 9, brute: 70, flyer: 30, boss: 0 };
    let end = row(main, size[main], Math.max(6, gap[main] - Math.floor(wave / 4)), 0);
    if (wave >= 4) {
      const side = open[Math.floor(rand() * open.length)]!;
      end = row(side, Math.round(size[side] / 2), Math.max(6, gap[side] - Math.floor(wave / 4)), Math.floor(end / 2));
    }
  }
  return spawns.sort((a, b) => a.at - b.at);
}

/** "12 grunts, 6 runners". */
function preview(spawns: readonly Spawn[]): string {
  const count = new Map<CreepKind, number>();
  for (const sp of spawns) count.set(sp.kind, (count.get(sp.kind) ?? 0) + 1);
  return [...count].map(([kind, n]) => (n === 1 ? `1 ${kind}` : `${n} ${CREEPS[kind].plural}`)).join(", ");
}

const sendBonus = (s: BulwarkState) => (s.next ? Math.max(0, Math.floor(((s.next.at - s.tick) * (4 + s.next.wave)) / (RATE * 4))) : 0);

function startWave(s: BulwarkState, early: boolean, seat = 0) {
  if (!s.next) return;
  const mid: [number, number] = [W / 2, H / 2];
  if (early) {
    const bonus = sendBonus(s);
    if (bonus > 0) {
      s.bank += bonus;
      s.scores[seat] = s.scores[seat]! + bonus * 5;
      say(s, "send", ...mid, { seat, amount: bonus, text: `Sent early +${bonus}` });
    }
  }
  if (s.wave > 0) {
    // A wave seen off: pay for the bank, and points for everyone still watching the gate.
    const pay = 20 + 5 * s.wave;
    s.bank += pay;
    const share = s.wave * 50;
    s.scores = s.scores.map((n) => n + share);
    say(s, "pay", W / 2, H - 1000, { amount: pay, text: `Wave ${s.wave} held +${pay}` });
  }
  if (s.rules.interest && s.next.wave > 1) {
    const earned = Math.min(150, Math.floor(s.bank / 25));
    if (earned > 0) {
      s.bank += earned;
      say(s, "interest", W / 2, H - 700, { amount: earned, text: `Interest +${earned}` });
    }
  }
  s.wave = s.next.wave;
  s.queue = s.next.spawns.map((sp) => ({ at: s.tick + 1 + sp.at, kind: sp.kind }));
  s.next = null;
  s.banner = { text: s.wave % 10 === 0 ? "Boss wave" : `Wave ${s.wave}`, until: s.tick + 110 };
  say(s, "wave", ...mid, { amount: s.wave });
}

function spawn(s: BulwarkState, kind: CreepKind) {
  if (s.creeps.length >= MAX_CREEPS) return;
  const base = CREEPS[kind];
  const n = s.wave - 1;
  // Tougher every wave, and faster than the gold comes in: sooner or later the gate falls.
  const hp = Math.max(1, Math.round((base.hp * (100 + 12 * n + 2 * n * n) * s.rules.toughness) / 10_000));
  s.creeps.push({ id: s.nextId++, kind, d: 0, hp, max: hp, slow: 0, slowTo: 10, bounty: base.bounty + Math.floor((base.bounty * n) / 12) });
}

// ---- Commands ------------------------------------------------------------------------------------

function obey(s: BulwarkState, seat: number, input: BulwarkInput) {
  const [x, y] = centre(input.col, input.row);
  const refuse = (text: string) => say(s, "nope", x, y, { seat, text });
  if (input.cmd === "send") {
    if (s.next) startWave(s, true, seat);
    return;
  }
  const standing = towerAt(s, input.col, input.row);
  if (input.cmd === "build") {
    const level = TOWERS[input.kind].levels[0];
    if (s.road.includes(input.row * COLS + input.col)) return refuse("That's the road");
    if (standing) return refuse("Something is there");
    if (s.bank < level.cost) return refuse("Not enough gold");
    s.bank -= level.cost;
    s.towers.push({ id: s.nextId++, kind: input.kind, col: input.col, row: input.row, level: 1, cool: 0, spent: level.cost, seat, aim: 27000 });
    say(s, "built", x, y, { seat, tone: TOWERS[input.kind].tone });
  } else if (input.cmd === "upgrade") {
    if (!standing) return refuse("Nothing there");
    const level = TOWERS[standing.kind].levels[standing.level];
    if (!level) return refuse("As good as it gets");
    if (s.bank < level.cost) return refuse("Not enough gold");
    s.bank -= level.cost;
    standing.level++;
    standing.spent += level.cost;
    say(s, "upgraded", x, y, { seat, amount: standing.level, tone: TOWERS[standing.kind].tone });
  } else if (input.cmd === "sell") {
    if (!standing) return refuse("Nothing there");
    const back = sellValue(standing);
    s.bank += back;
    s.towers = s.towers.filter((t) => t !== standing);
    say(s, "sold", x, y, { seat, amount: back, text: `+${back}` });
  }
}
const sellValue = (t: Tower) => Math.floor((t.spent * 7) / 10);

// ---- A tick --------------------------------------------------------------------------------------

function hurt(s: BulwarkState, c: Creep, dmg: number, piercing: boolean, seat: number) {
  if (c.hp <= 0) return;
  const through = piercing ? dmg : Math.max(1, dmg - CREEPS[c.kind].armour * 2);
  c.hp -= through;
  if (c.hp <= 0) {
    s.bank += c.bounty;
    s.kills++;
    s.scores[seat] = s.scores[seat]! + c.bounty * 10;
  }
}

function step(s: BulwarkState, inputs: readonly (BulwarkInput | null | undefined)[]) {
  if (s.phase === "over") return;
  s.tick++;
  s.events = [];
  if (s.banner && s.tick > s.banner.until) s.banner = null;

  for (let seat = 0; seat < s.seats; seat++) {
    const input = safeInput(inputs[seat]);
    if (input.n === s.seen[seat]) continue;
    s.seen[seat] = input.n;
    if (input.cmd !== "none") obey(s, seat, input);
  }

  // The wave: what is due comes on. Once the last has, the clock starts for the next.
  while (s.queue.length && s.queue[0]!.at <= s.tick) spawn(s, s.queue.shift()!.kind);
  if (!s.queue.length && !s.next) s.next = { wave: s.wave + 1, at: s.tick + (s.wave === 0 ? FIRST_BREATH : BREATH), spawns: composeWave(s, s.wave + 1) };
  if (s.next && s.tick >= s.next.at) startWave(s, false);

  const wp = waypoints(s.road);
  const flight = flightLength(wp);
  const walk = roadLength(s.road);

  // Everything walks, or flies. What gets to the end is through the gate.
  const spots = new Map<Creep, [number, number]>();
  s.creeps = s.creeps.filter((c) => {
    const speed = CREEPS[c.kind].speed;
    c.d += c.slow > 0 ? Math.max(1, Math.floor((speed * c.slowTo) / 10)) : speed;
    if (c.slow > 0) c.slow--;
    if (c.d >= (c.kind === "flyer" ? flight : walk)) {
      s.lives -= CREEPS[c.kind].lives;
      s.leaked++;
      say(s, "leak", wp[wp.length - 1]![0], H - 150, { amount: CREEPS[c.kind].lives, text: `−${CREEPS[c.kind].lives}` });
      return false;
    }
    spots.set(c, place(c, wp, flight));
    return true;
  });

  // The towers.
  for (const t of s.towers) {
    if (t.cool > 0) {
      t.cool--;
      continue;
    }
    const level = levelOf(t);
    const [tx, ty] = centre(t.col, t.row);
    const reach = level.range * level.range;
    const inReach = (c: Creep) => {
      const [x, y] = spots.get(c)!;
      return c.hp > 0 && (x - tx) * (x - tx) + (y - ty) * (y - ty) <= reach;
    };
    if (t.kind === "frost") {
      let any = false;
      for (const c of s.creeps) {
        if (!inReach(c)) continue;
        any = true;
        // The coldest tower in reach is the one that counts.
        c.slowTo = Math.min(c.slow > 0 ? c.slowTo : 10, level.extra);
        c.slow = 45;
        hurt(s, c, level.dmg, true, t.seat);
      }
      if (any) {
        t.cool = level.cool;
        say(s, "frost", tx, ty, { amount: level.range });
      }
      continue;
    }
    // Who to fire at: the one furthest along, or for a sniper the one with most left in it.
    let target: Creep | null = null;
    for (const c of s.creeps) {
      if (!inReach(c) || (t.kind === "mortar" && c.kind === "flyer")) continue;
      if (!target || (t.kind === "sniper" ? c.hp > target.hp || (c.hp === target.hp && c.d > target.d) : c.d > target.d)) target = c;
    }
    if (!target) continue;
    t.cool = level.cool;
    const [x, y] = spots.get(target)!;
    t.aim = heading8(x - tx, y - ty);
    const tone = TOWERS[t.kind].tone;
    if (t.kind === "mortar") {
      const blast = level.extra * level.extra;
      for (const c of s.creeps) {
        if (c.kind === "flyer" || c.hp <= 0) continue;
        const [cx, cy] = spots.get(c)!;
        if ((cx - x) * (cx - x) + (cy - y) * (cy - y) <= blast) hurt(s, c, level.dmg, false, t.seat);
      }
      say(s, "shell", tx, ty, { to: [x, y], amount: level.extra, tone });
    } else if (t.kind === "tesla") {
      // It jumps from one to the nearest it hasn't touched, a little weaker each time.
      const struck = new Set<Creep>();
      let from: [number, number] = [tx, ty];
      let at: Creep | null = target;
      let dmg = level.dmg;
      for (let jump = 0; at && jump < level.extra; jump++) {
        struck.add(at);
        const here: [number, number] = spots.get(at)!;
        hurt(s, at, dmg, true, t.seat);
        say(s, "zap", from[0], from[1], { to: here, tone });
        from = here;
        dmg = Math.max(1, Math.floor((dmg * 8) / 10));
        let nearest: Creep | null = null;
        let nearestD = 800 * 800;
        for (const c of s.creeps) {
          if (struck.has(c) || c.hp <= 0) continue;
          const [cx, cy] = spots.get(c)!;
          const dist = (cx - here[0]) * (cx - here[0]) + (cy - here[1]) * (cy - here[1]);
          if (dist < nearestD || (dist === nearestD && nearest && c.id < nearest.id)) {
            nearestD = dist;
            nearest = c;
          }
        }
        at = nearest;
      }
    } else {
      hurt(s, target, level.dmg, false, t.seat);
      say(s, t.kind === "sniper" ? "snipe" : "shot", tx, ty, { to: [x, y], tone });
    }
  }

  s.creeps = s.creeps.filter((c) => {
    if (c.hp > 0) return true;
    const [x, y] = spots.get(c)!;
    say(s, c.kind === "boss" ? "boss-down" : "pop", x, y, { amount: CREEPS[c.kind].r, tone: CREEPS[c.kind].tone, ...(c.bounty >= 8 ? { text: `+${c.bounty}` } : {}) });
    return false;
  });

  if (s.lives <= 0) {
    s.lives = 0;
    s.phase = "over";
    s.banner = { text: "The gate has fallen", until: Number.MAX_SAFE_INTEGER };
    say(s, "over", W / 2, H / 2);
  }
}

// ---- The view ------------------------------------------------------------------------------------

const crew = (s: BulwarkState) => s.scores.reduce((sum, n) => sum + n, 0);

function buildOf(s: BulwarkState): ArcadeBuild {
  return {
    cols: COLS,
    rows: ROWS,
    cell: CELL,
    road: waypoints(s.road),
    closed: s.road,
    bank: s.bank,
    lives: s.lives,
    shop: BULWARK_TOWERS.map((key) => ({ key, label: TOWERS[key].label, cost: TOWERS[key].levels[0].cost, hint: TOWERS[key].hint, range: TOWERS[key].levels[0].range, tone: TOWERS[key].tone })),
    built: s.towers.map((t) => ({ id: t.id, col: t.col, row: t.row, key: t.kind, label: TOWERS[t.kind].label, level: t.level, maxLevel: 3, upgrade: TOWERS[t.kind].levels[t.level]?.cost ?? null, sell: sellValue(t), range: levelOf(t).range, seat: t.seat })),
    next: s.next && s.phase === "play" ? { wave: s.next.wave, inTicks: Math.max(0, s.next.at - s.tick), bonus: sendBonus(s), preview: preview(s.next.spawns) } : null,
  };
}

function view(s: BulwarkState): ArcadeView {
  const wp = waypoints(s.road);
  const flight = flightLength(wp);
  const things: ArcadeThing[] = [];
  for (const t of s.towers) {
    const [x, y] = centre(t.col, t.row);
    things.push({ id: t.id, kind: `tower:${t.kind}`, x, y, r: 200, tone: TOWERS[t.kind].tone, angle: t.aim, level: t.level, range: levelOf(t).range, seat: t.seat });
  }
  // Walkers first, flyers over them, the ones nearest the gate on top.
  for (const c of [...s.creeps].sort((a, b) => Number(a.kind === "flyer") - Number(b.kind === "flyer") || a.d - b.d)) {
    const [x, y] = place(c, wp, flight);
    things.push({ id: c.id, kind: `creep:${c.kind}`, x, y, r: CREEPS[c.kind].r, tone: CREEPS[c.kind].tone, health: Math.max(0, Math.round((c.hp * 1000) / c.max)), ...(c.slow > 0 ? { mark: "slowed" } : {}) });
  }
  const boss = s.creeps.find((c) => c.kind === "boss");
  return {
    game: "bulwark",
    tick: s.tick,
    rate: RATE,
    seats: s.seats,
    field: BULWARK_FIELD,
    things,
    pilots: s.scores.map((score, seat) => ({
      seat,
      playing: s.phase === "play",
      score,
      lives: s.lives,
      stats: [
        { key: "gold", label: "Gold", value: s.bank },
        { key: "towers", label: "Towers", value: s.towers.filter((t) => t.seat === seat).length },
      ],
    })),
    score: crew(s),
    stage: s.wave === 0 ? "Get ready" : s.wave % 10 === 0 ? `Wave ${s.wave} · Boss` : `Wave ${s.wave}`,
    ...(boss ? { boss: { name: "The Ram", health: Math.max(0, Math.round((boss.hp * 1000) / boss.max)) } } : {}),
    ...(s.banner ? { banner: s.banner.text } : {}),
    build: buildOf(s),
    events: s.events,
    over: s.phase === "over",
  };
}

// ---- The computer player -------------------------------------------------------------------------

/** What it builds, in order, round and round. */
const PLAN: TowerKind[] = ["dart", "dart", "frost", "mortar", "dart", "tesla", "sniper", "mortar", "tesla"];

/**
 * A computer player: it builds down a list of towers, each where it covers the most road that is
 * least covered already, upgrades once the field is filling up, and sends the next wave early
 * when nothing is left on the road. It gives one command at a time and waits for it to be seen.
 */
function bot(s: BulwarkState, seat: number, style: PlayStyle, rand: () => number = Math.random): BulwarkInput {
  if (s.phase === "over" || seat >= s.seats) return IDLE;
  const held = { ...IDLE, n: s.seen[seat] ?? 0 };
  // It thinks a few times a second, not every tick, and each seat on its own beat.
  if ((s.tick + seat * 7) % 20 !== 0) return held;
  const skill = style.skill ?? 0.7;
  const act = (cmd: BulwarkInput["cmd"], col = 0, row = 0, kind: TowerKind = "dart"): BulwarkInput => ({ n: (s.seen[seat] ?? 0) + 1, cmd, col, row, kind });
  if (rand() < (style.sloppy ?? 0.05) * 0.5) return held;

  const wp = waypoints(s.road);
  const mine = s.towers.filter((t) => t.seat === seat);
  const kind = PLAN[s.towers.length % PLAN.length]!;
  const wantUpgrades = s.towers.length >= 5 + Math.floor(s.wave / 2) || s.towers.length >= 26;
  if (!wantUpgrades && s.bank >= TOWERS[kind].levels[0].cost) {
    const range = TOWERS[kind].levels[0].range;
    let best = -1;
    let bestScore = -Infinity;
    for (let cell = 0; cell < COLS * ROWS; cell++) {
      const col = cell % COLS;
      const row = Math.floor(cell / COLS);
      if (s.road.includes(cell) || towerAt(s, col, row)) continue;
      const [x, y] = centre(col, row);
      let score = 0;
      for (const [px, py] of wp) if ((px - x) * (px - x) + (py - y) * (py - y) <= range * range) score += 10;
      // Spread out: a spot already watched by its own kind is worth less.
      for (const t of s.towers) {
        const [ox, oy] = centre(t.col, t.row);
        const near = Math.abs(ox - x) + Math.abs(oy - y);
        if (near < 1600) score -= t.kind === kind ? 14 : 3;
      }
      score += rand() * (1.2 - skill) * 30;
      if (score > bestScore) {
        bestScore = score;
        best = cell;
      }
    }
    if (best >= 0) return act("build", best % COLS, Math.floor(best / COLS), kind);
  }
  if (wantUpgrades || s.bank >= 400) {
    const can = (mine.length ? mine : s.towers).filter((t) => t.level < 3 && s.bank >= TOWERS[t.kind].levels[t.level]!.cost);
    const pick = can.sort((a, b) => TOWERS[a.kind].levels[a.level]!.cost - TOWERS[b.kind].levels[b.level]!.cost || a.id - b.id)[0];
    if (pick) return act("upgrade", pick.col, pick.row);
    if (wantUpgrades && s.towers.length < 60 && s.bank >= TOWERS[kind].levels[0].cost + 200) {
      // Everything it can afford to improve is improved: back to building.
      for (let cell = 0; cell < COLS * ROWS; cell++) {
        const col = cell % COLS;
        const row = Math.floor(cell / COLS);
        if (s.road.includes(cell) || towerAt(s, col, row)) continue;
        const [x, y] = centre(col, row);
        if (wp.some(([px, py]) => Math.abs(px - x) + Math.abs(py - y) <= CELL)) return act("build", col, row, kind);
      }
    }
  }
  if (s.next && !s.creeps.length && s.next.at - s.tick > 90 && skill >= 0.5 && s.towers.length >= 2 && seat === 0) return act("send");
  return held;
}

// ---- The game ------------------------------------------------------------------------------------

function summary(s: BulwarkState): ArcadeSummary {
  const score = crew(s);
  return {
    game: "bulwark",
    rules: s.rules.name,
    phase: s.phase === "over" ? "over" : s.wave === 0 ? "building" : s.wave % 10 === 0 ? "boss" : "wave",
    over: s.phase === "over",
    seats: s.seats,
    ticks: s.tick,
    score,
    scores: [...s.scores],
    scoreLine: s.seats > 1 ? `Wave ${s.wave} · ${points(score)} (${s.scores.map((n, seat) => `${who(seat)} ${points(n)}`).join(" · ")})` : `Wave ${s.wave} · ${points(score)}`,
    order: s.scores.map((n, seat) => ({ n, seat })).sort((a, b) => b.n - a.n || a.seat - b.seat).map((e) => e.seat),
  };
}

function normalize(rules: unknown): BulwarkRules {
  const given = (rules && typeof rules === "object" ? rules : {}) as Partial<BulwarkRules>;
  const preset = BULWARK_PRESETS.find((p) => p.id === given.id) ?? BULWARK_PRESETS[0]!;
  const number = (value: unknown, fallback: number, low: number, high: number) => (typeof value === "number" && Number.isFinite(value) ? clamp(Math.round(value), low, high) : fallback);
  return {
    id: typeof given.id === "string" ? given.id : preset.id,
    name: typeof given.name === "string" && given.name ? given.name : preset.name,
    lives: number(given.lives, preset.lives, 1, 50),
    gold: number(given.gold, preset.gold, 100, 1000),
    toughness: number(given.toughness, preset.toughness, 50, 200),
    interest: typeof given.interest === "boolean" ? given.interest : preset.interest,
  };
}

export const bulwark: ArcadeGame<BulwarkRules, BulwarkState, BulwarkInput> = {
  id: "bulwark",
  name: "Bulwark",
  emoji: "🏯",
  category: "arcade",
  blurb: "Build towers, hold the road, send the next wave if you dare",
  tagline: "A tower defence with no end: a new road every game, waves on a clock, and gold that grows if you can bear not to spend it. Hold the gate alone or with up to four.",
  seats: { min: 1, max: 4, default: 1 },
  teams: false,
  presets: BULWARK_PRESETS,
  fields: [
    { key: "lives", label: "Lives", hint: "How many may get through the gate", kind: "number", min: 1, max: 50 },
    { key: "gold", label: "Starting gold", kind: "choice", options: [[200, "200"], [220, "220"], [260, "260"], [300, "300"], [400, "400"]] },
    { key: "toughness", label: "Waves", kind: "choice", options: [[80, "Softer"], [100, "Normal"], [125, "Tougher"], [150, "Brutal"]] },
    { key: "interest", label: "Interest", hint: "Gold in the bank earns 4% at the start of each wave, 150 at most", kind: "toggle" },
  ],
  normalize,
  validate(rules) {
    const problems: string[] = [];
    if (!Number.isInteger(rules.lives) || rules.lives < 1 || rules.lives > 50) problems.push("Lives must be between 1 and 50.");
    if (!Number.isInteger(rules.gold) || rules.gold < 100 || rules.gold > 1000) problems.push("Starting gold must be between 100 and 1,000.");
    if (!Number.isInteger(rules.toughness) || rules.toughness < 50 || rules.toughness > 200) problems.push("Toughness must be between 50% and 200%.");
    return problems;
  },
  describe(rules) {
    return [
      `${rules.lives === 1 ? "One life: the first through the gate ends it" : `${rules.lives} lives: each one through the gate costs one, a brute two and a boss ten`}. You start with ${rules.gold} gold.`,
      rules.toughness === 100 ? "Waves are as tough as usual, and tougher every wave." : `Waves are ${rules.toughness}% as tough as usual, and tougher every wave.`,
      "The next wave comes on a clock. Sending it early pays gold and points for the time you gave up.",
      rules.interest ? "Gold in the bank earns 4% at the start of each wave, 150 at most." : "No interest on gold in the bank.",
      "Every wave you hold pays gold, more each time. Every tower can be upgraded twice, and sold for 70% of what went into it.",
      "Every tenth wave is a boss. Flyers ignore the road, and mortars cannot hit them.",
    ];
  },
  controls: [
    "Pick a tower from the shop, then tap or click a square beside the road to build it there.",
    "Tap a tower to see its reach, upgrade it or sell it.",
    "Keys 1 to 5 pick a tower, U upgrades, S sells, Space sends the next wave early.",
    "The road is different every game. Flyers go straight from where it starts to where it ends.",
  ],
  rate: RATE,
  newGame(rules, seats, seed) {
    const count = clamp(Math.trunc(seats) || 1, 1, 4);
    const s: BulwarkState = {
      rules,
      seats: count,
      rng: seed >>> 0,
      tick: 0,
      phase: "play",
      road: [],
      wave: 0,
      queue: [],
      next: null,
      bank: rules.gold,
      lives: rules.lives,
      towers: [],
      creeps: [],
      nextId: 1,
      scores: Array.from({ length: count }, () => 0),
      seen: Array.from({ length: count }, () => 0),
      leaked: 0,
      kills: 0,
      banner: null,
      events: [],
    };
    s.road = layRoad(nextRandom(s));
    return s;
  },
  idle: IDLE,
  input: safeInput,
  step,
  view,
  bot,
  summary,
};
