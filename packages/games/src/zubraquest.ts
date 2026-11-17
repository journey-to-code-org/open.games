// Zubra Quest: the sixth game on the arcade kit, and the first that is an adventure. One hero, Zub,
// walks a land of screens seen from above: he cuts brush with a sword, opens chests, buys from his
// brother Bru, and goes down into three dens for the three Great Stripes that Quagg stole. Each den
// has keys, locked doors, a prize that opens more of the land (bombs, a hookshot, a bow) and a boss.
// With all three Stripes the keep's gate opens, and Quagg is at the end of it.
//
// The land is made from the seed (`zubraquestworld.ts`) and is not in the state. The state has the
// hero, what is alive on the screen he is on, and everything that has changed for good.
//
// A seat's controls are a direction, two buttons and which tool the second button uses. A button
// does its thing on the tick it goes down, so a held button is one swing, and a log replays.
//
// Everything in the state is a whole number. A tile is 256 of the state's units across (sixteen to
// a pixel of a sixteen-pixel tile), so a hero can walk a pixel and a half a tick. A step uses only
// addition, multiplication, division, `Math.sqrt`, `Math.round` and `Math.trunc`.
//
// An adventure has no clock, and a game on the kit must end, so a hero left alone for five minutes
// lies down and goes to sleep. A screen that stops stepping while nobody is there never sees it.
import type { PlayStyle } from "@journey-to-code/rules";
import { points, toward, type ArcadeEvent, type ArcadeGame, type ArcadeRealm, type ArcadeSummary, type ArcadeThing, type ArcadeView } from "./arcade.js";
import { nextRandom, type BaseRules } from "./table.js";
import { QUEST_COLS, QUEST_DEN, QUEST_DENS, QUEST_OVER, QUEST_ROWS, QUEST_TILE, questOpen, questWalkable, questWorld, type QuestRoom, type QuestSpot } from "./zubraquestworld.js";

export const QUEST_RATE = 60;
/** The state's units to a tile. */
export const QUEST_UNIT = 256;
export const QUEST_FIELD = { width: QUEST_COLS * QUEST_UNIT, height: QUEST_ROWS * QUEST_UNIT };
/** The tools the second button uses, in the order a seat picks them by. */
export const QUEST_TOOLS = ["bow", "bombs", "hook"] as const;
/** Ticks a hero may be left alone before he goes to sleep and the game ends. */
export const QUEST_SLEEP = QUEST_RATE * 60 * 5;

const T = QUEST_TILE;
const C = QUEST_COLS;
const R = QUEST_ROWS;
const U = QUEST_UNIT;
const W = QUEST_FIELD.width;
const H = QUEST_FIELD.height;
/** Right, down, left, up. */
const DX = [1, 0, -1, 0];
const DY = [0, 1, 0, -1];
/** Half the hero's width where it meets the ground, and how fast he walks. */
const HALF = 88;
const WALK = 24;
const SWING = 16;
const MOST_HEALTH = 20;
const BIT = { sword: 1, bow: 2, bombs: 4, hook: 8 } as const;
const REGIONS = ["The Meadow", "The Dunes", "The Marsh", "The Crags"];

export interface QuestRules extends BaseRules {
  /** Hearts to start with. */
  hearts: number;
  /** How hard things hit. */
  foes: "mild" | "fair" | "fierce";
  /** How many times the hero may get back up, or 0 for as often as it takes. */
  continues: number;
}
export const QUEST_PRESETS: QuestRules[] = [
  { id: "quest", name: "The Quest", hearts: 3, foes: "fair", continues: 0 },
  { id: "gentle", name: "Gentle", hearts: 5, foes: "mild", continues: 0 },
  { id: "hero", name: "Hero's road", hearts: 3, foes: "fierce", continues: 3 },
];

/** What a seat's controls are doing. */
export interface QuestInput {
  /** Which way the stick is pushed: -1, 0 or 1 each. */
  dx: number;
  dy: number;
  /** The sword. */
  a: boolean;
  /** The tool. */
  b: boolean;
  /** Which tool, as a place in `QUEST_TOOLS`. */
  tool: number;
}
const IDLE: QuestInput = { dx: 0, dy: 0, a: false, b: false, tool: 0 };

interface Foe {
  id: number;
  kind: string;
  x: number;
  y: number;
  hp: number;
  /** A timer, what it is doing, which way it faces, and a count of its own. */
  t: number;
  mode: number;
  d: number;
  n: number;
  /** Where it is going, a tick. */
  vx: number;
  vy: number;
  /** Ticks it cannot be hurt for, and the push it is still feeling. */
  inv: number;
  kx: number;
  ky: number;
  kt: number;
}
interface Shot { id: number; kind: "arrow" | "seed" | "orb" | "bomb" | "blast"; x: number; y: number; vx: number; vy: number; t: number; d: number }
interface Drop { id: number; kind: string; x: number; y: number; t: number }

export interface QuestState {
  rules: QuestRules;
  seats: number;
  seed: number;
  rng: number;
  tick: number;
  phase: "play" | "won" | "lost" | "asleep";
  room: number;
  /** The tiles of the screen the hero is on, as they stand. */
  tiles: number[];
  /** Tiles changed for good, as "room:tile". */
  perm: Record<string, number>;
  /** Rooms that have been walked into, and rooms under the ground that have been cleared. */
  seen: number[];
  cleared: number[];
  /** Things bought that are sold once, as "room:what". */
  bought: string[];
  hero: {
    x: number;
    y: number;
    face: number;
    /** In half hearts. */
    hp: number;
    max: number;
    inv: number;
    kx: number;
    ky: number;
    kt: number;
    /** Ticks left of a swing, and ticks before the tool can be used again. */
    swing: number;
    cool: number;
    walking: number;
    coins: number;
    /** Small keys and big keys, by den. */
    keys: number[];
    big: number[];
    relics: number;
    /** What he carries, as bits, and how many arrows and bombs. */
    items: number;
    arrows: number;
    bombs: number;
    /** How much better than the first sword. */
    blade: number;
    tool: number;
  };
  /** The hookshot's head while it is out: where, which way, and whether it is going, pulling or coming back. */
  hook: { x: number; y: number; d: number; mode: number; tx: number; ty: number } | null;
  foes: Foe[];
  shots: Shot[];
  drops: Drop[];
  nextId: number;
  /** Ticks the world stands still for: a screen changing, something found. */
  freeze: number;
  /** Words on the screen, and the ticks they have left. */
  msg: string;
  msgT: number;
  /** Ticks before a shop or a person speaks again. */
  shopT: number;
  /** Whether there was something to fight on this screen, and whether its doors are shut. */
  fight: number;
  shut: number;
  /** Which buttons were down last tick: 1 for the sword, 2 for the tool. */
  held: number;
  /** Ticks since the controls were last touched. */
  quiet: number;
  /** Where the hero gets back up. */
  back: QuestSpot;
  score: number;
  kills: number;
  deaths: number;
  events: ArcadeEvent[];
}

// ---- The beasts -----------------------------------------------------------------------------------

interface Beast { hp: number; r: number; speed: number; touch: number; points: number; name?: string }
const BEASTS: Record<string, Beast> = {
  slime: { hp: 2, r: 104, speed: 8, touch: 1, points: 20 },
  skitter: { hp: 2, r: 96, speed: 28, touch: 1, points: 30 },
  bat: { hp: 2, r: 96, speed: 16, touch: 1, points: 30 },
  spitter: { hp: 4, r: 112, speed: 6, touch: 1, points: 50 },
  charger: { hp: 6, r: 120, speed: 8, touch: 2, points: 80 },
  knight: { hp: 6, r: 120, speed: 10, touch: 2, points: 100 },
  wisp: { hp: 4, r: 104, speed: 7, touch: 1, points: 60 },
  "boss:maw": { hp: 20, r: 300, speed: 0, touch: 2, points: 1000, name: QUEST_DENS[0].bossName },
  "boss:tusker": { hp: 24, r: 280, speed: 6, touch: 3, points: 1500, name: QUEST_DENS[1].bossName },
  "boss:gloom": { hp: 24, r: 240, speed: 5, touch: 2, points: 2000, name: QUEST_DENS[2].bossName },
  "boss:quagg": { hp: 48, r: 200, speed: 12, touch: 3, points: 5000, name: QUEST_DENS[3].bossName },
};
const beast = (kind: string) => BEASTS[kind] ?? BEASTS.slime!;
const isBoss = (kind: string) => kind.startsWith("boss:");

// ---- Small things ---------------------------------------------------------------------------------

const world = (s: QuestState) => questWorld(s.seed);
const roomOf = (s: QuestState): QuestRoom => world(s).rooms[s.room]!;
const tileAt = (s: QuestState, x: number, y: number) => (x < 0 || y < 0 || x >= W || y >= H ? -1 : s.tiles[Math.trunc(y / U) * C + Math.trunc(x / U)]!);
const centre = (t: number) => t * U + U / 2;
const say = (s: QuestState, kind: string, x: number, y: number, more: Partial<ArcadeEvent> = {}) => { s.events.push({ kind, x, y, ...more }); };
const tell = (s: QuestState, text: string, ticks = 150) => { s.msg = text; s.msgT = ticks; };
const harm = (s: QuestState, base: number) => (s.rules.foes === "mild" ? 1 : s.rules.foes === "fierce" ? base + 1 : base);
const has = (s: QuestState, item: keyof typeof BIT) => (s.hero.items & BIT[item]) !== 0;

/** Whether a box stands on anything it may not. Off the screen counts as open for the hero, who can walk off it, and shut for everything else. */
function stuck(s: QuestState, x: number, y: number, half: number, pass: (tile: number) => boolean, hero: boolean): boolean {
  for (const cx of [x - half, x + half]) for (const cy of [y - half, y + half]) {
    const tile = tileAt(s, cx, cy);
    if (tile === -1) { if (!hero) return true; } else if (!pass(tile)) return true;
  }
  return false;
}
/** Move a box, one way at a time, as far as it can go. Says whether anything stopped it. */
function slide(s: QuestState, o: { x: number; y: number }, dx: number, dy: number, half: number, pass: (tile: number) => boolean, hero = false): boolean {
  let hit = false;
  if (dx !== 0) { if (stuck(s, o.x + dx, o.y, half, pass, hero)) hit = true; else o.x += dx; }
  if (dy !== 0) { if (stuck(s, o.x, o.y + dy, half, pass, hero)) hit = true; else o.y += dy; }
  return hit;
}
const groundOnly = (tile: number) => tile === T.ground || tile === T.path || tile === T.flower;
const passFor = (kind: string) => (kind === "bat" ? questOpen : kind === "wisp" || kind === "boss:gloom" ? () => true : groundOnly);
/** Things that live on a screen keep off its edge, so they never stand in a way out. */
function roam(s: QuestState, f: Foe, dx: number, dy: number): boolean {
  const half = isBoss(f.kind) ? 200 : 80;
  const before = { x: f.x, y: f.y };
  const hit = slide(s, f, dx, dy, half, passFor(f.kind));
  const low = U + half;
  if (f.x < low || f.x > W - low || f.y < low || f.y > H - low) { f.x = before.x; f.y = before.y; return true; }
  return hit;
}

function setTile(s: QuestState, i: number, tile: number, forGood: boolean) {
  s.tiles[i] = tile;
  if (forGood) s.perm[`${s.room}:${i}`] = tile;
}
/** Open a tile for good, and any like it beside it: a door two tiles wide opens as one. */
function openAll(s: QuestState, i: number, kind: number) {
  const todo = [i];
  while (todo.length) {
    const j = todo.pop()!;
    if (s.tiles[j] !== kind) continue;
    setTile(s, j, T.ground, true);
    const tx = j % C;
    if (tx > 0) todo.push(j - 1);
    if (tx < C - 1) todo.push(j + 1);
    if (j >= C) todo.push(j - C);
    if (j < C * (R - 1)) todo.push(j + C);
  }
}

/** Walk into a room: its tiles as they stand, whatever lives there, and its doors shut if it is that kind of room. */
function enter(s: QuestState, room: number, x: number, y: number, side: number) {
  const next = world(s).rooms[room]!;
  s.room = room;
  s.hero.x = x;
  s.hero.y = y;
  s.hero.swing = 0;
  s.hero.kt = 0;
  s.hook = null;
  s.tiles = next.tiles.slice();
  const mine = `${room}:`;
  for (const key in s.perm) if (key.startsWith(mine)) s.tiles[Number(key.slice(mine.length))] = s.perm[key]!;
  s.foes = [];
  s.shots = [];
  s.drops = [];
  if (!s.seen.includes(room)) {
    s.seen.push(room);
    s.score += 20;
    if (next.area === "den" && next.out) tell(s, QUEST_DENS[next.den]!.name);
  }
  if (next.area === "over" || !s.cleared.includes(room)) {
    for (const spawn of next.spawns) {
      const b = beast(spawn.kind);
      s.foes.push({ id: s.nextId++, kind: spawn.kind, x: centre(spawn.tx), y: centre(spawn.ty), hp: b.hp, t: 30, mode: 0, d: 1, n: 0, vx: 0, vy: 0, inv: 0, kx: 0, ky: 0, kt: 0 });
    }
  }
  s.fight = s.foes.length ? 1 : 0;
  s.shut = 0;
  if (next.shut && s.fight) {
    s.shut = 1;
    for (let i = 0; i < s.tiles.length; i++) {
      const tx = i % C;
      const ty = (i - tx) / C;
      if ((tx === 0 || ty === 0 || tx === C - 1 || ty === R - 1) && questWalkable(s.tiles[i]!)) s.tiles[i] = T.shutter;
    }
  }
  s.freeze = 16;
  say(s, "enter", x, y, { amount: side });
}

/** Put the screen's tiles back as they should be, once its doors open. */
function unshut(s: QuestState) {
  s.shut = 0;
  for (let i = 0; i < s.tiles.length; i++) if (s.tiles[i] === T.shutter) s.tiles[i] = T.ground;
  say(s, "open", s.hero.x, s.hero.y);
}

// ---- The hero -------------------------------------------------------------------------------------

function hurtHero(s: QuestState, base: number, fromX: number, fromY: number) {
  const h = s.hero;
  if (h.inv > 0 || s.hook?.mode === 1) return;
  h.hp -= harm(s, base);
  h.inv = 60;
  [h.kx, h.ky] = toward(fromX, fromY, h.x, h.y, 40);
  h.kt = 8;
  h.swing = 0;
  say(s, "hurt", h.x, h.y, { seat: 0 });
  if (h.hp > 0) return;
  h.hp = 0;
  s.deaths++;
  say(s, "down", h.x, h.y, { seat: 0 });
  if (s.rules.continues > 0 && s.deaths > s.rules.continues) {
    s.phase = "lost";
    tell(s, "The quest ends here.", 600);
    say(s, "over", h.x, h.y);
    return;
  }
  enter(s, s.back.room, centre(s.back.tx), centre(s.back.ty), -1);
  h.hp = Math.min(h.max, 6);
  h.inv = 120;
  h.face = 1;
  s.freeze = 70;
  tell(s, "Zub gets back up.", 120);
}

/** What is in a chest, a shop or a boss's leavings, given to the hero. */
function give(s: QuestState, what: string, x: number, y: number) {
  const h = s.hero;
  const den = roomOf(s).den;
  let words = "";
  if (what === "sword") { h.items |= BIT.sword; words = "You got the Horn Blade! It cuts brush, and worse."; }
  else if (what === "bombs") { h.items |= BIT.bombs; h.bombs = Math.max(h.bombs, 10); words = "You got the bomb bag! Cracked rock will not stand up to it."; }
  else if (what === "hook") { h.items |= BIT.hook; words = "You got the hookshot! It pulls you to any post."; }
  else if (what === "bow") { h.items |= BIT.bow; h.arrows = Math.max(h.arrows, 20); words = "You got the bow! Watching stones shut when shot."; }
  else if (what === "key") { h.keys[den] = (h.keys[den] ?? 0) + 1; words = "A small key."; }
  else if (what === "bosskey") { h.big[den] = 1; words = "The big key! It opens the den's last door."; }
  else if (what === "vessel") { h.max = Math.min(MOST_HEALTH, h.max + 2); h.hp = h.max; words = "A heart vessel! One more heart."; }
  else if (what === "blade") { h.blade = 1; words = "The blade is tempered: it bites half as hard again."; }
  else if (what === "stripe") { h.relics++; words = h.relics >= 3 ? "The third Great Stripe! The keep's gate will open now." : `A Great Stripe! That is ${h.relics} of 3.`; }
  else if (what.startsWith("coins")) { const n = Number(what.slice(5)); h.coins = Math.min(999, h.coins + n); words = `${n} acorns.`; }
  s.score += what === "stripe" ? 1000 : what.startsWith("coins") || what === "key" ? 50 : 200;
  tell(s, words);
  s.freeze = Math.max(s.freeze, what === "key" || what.startsWith("coins") ? 30 : 70);
  say(s, what === "key" || what.startsWith("coins") ? "chest" : "get", x, y, { text: what });
}

/** What happens when the hero pushes against the tile in front of him. */
function push(s: QuestState) {
  const h = s.hero;
  const fx = h.x + DX[h.face]! * (HALF + 48);
  const fy = h.y + DY[h.face]! * (HALF + 48);
  const tile = tileAt(s, fx, fy);
  if (tile === -1) return;
  const i = Math.trunc(fy / U) * C + Math.trunc(fx / U);
  const den = roomOf(s).den;
  if (tile === T.chest) {
    setTile(s, i, T.opened, true);
    give(s, roomOf(s).loot[i] ?? "coins20", centre(i % C), centre(Math.trunc(i / C)));
  } else if (tile === T.lock) {
    if ((h.keys[den] ?? 0) > 0) { h.keys[den]!--; openAll(s, i, T.lock); say(s, "unlock", fx, fy); }
    else if (s.msgT === 0) tell(s, "Locked. It wants a small key.", 90);
  } else if (tile === T.bossDoor) {
    if (h.big[den]) { openAll(s, i, T.bossDoor); say(s, "unlock", fx, fy); }
    else if (s.msgT === 0) tell(s, "This door wants the big key.", 90);
  } else if (tile === T.gate) {
    if (h.relics >= 3) { openAll(s, i, T.gate); say(s, "unlock", fx, fy); tell(s, "The Stripes shine. The gate opens."); }
    else if (s.msgT === 0) tell(s, "The gate wants all three Great Stripes.", 90);
  }
}

/** The sword's reach this tick: a box in front of the hero. */
function swingBox(s: QuestState): [x: number, y: number, hw: number, hh: number] {
  const h = s.hero;
  const flat = h.face === 0 || h.face === 2;
  return [h.x + DX[h.face]! * (HALF + 144), h.y + DY[h.face]! * (HALF + 144), flat ? 168 : 184, flat ? 184 : 168];
}

function cut(s: QuestState, x: number, y: number) {
  if (tileAt(s, x, y) !== T.bush) return;
  const i = Math.trunc(y / U) * C + Math.trunc(x / U);
  setTile(s, i, T.ground, false);
  say(s, "cut", centre(i % C), centre(Math.trunc(i / C)));
  leave(s, centre(i % C), centre(Math.trunc(i / C)), 40);
}

/** Something left behind, some of the time: a heart, an acorn, or more of what the hero carries. */
function leave(s: QuestState, x: number, y: number, chance: number) {
  const rand = nextRandom(s);
  if (Math.floor(rand() * 100) >= chance) return;
  const roll = Math.floor(rand() * 100);
  const kind = roll < 30 ? "heart" : roll < 70 ? "coin" : roll < 80 ? "gem" : roll < 90 && has(s, "bow") ? "arrows" : roll >= 90 && has(s, "bombs") ? "bombs" : "coin";
  s.drops.push({ id: s.nextId++, kind, x, y, t: 600 });
}

function useTool(s: QuestState) {
  const h = s.hero;
  const owned = QUEST_TOOLS.filter((tool) => has(s, tool));
  if (!owned.length || h.cool > 0) return;
  const tool = has(s, QUEST_TOOLS[h.tool]!) ? QUEST_TOOLS[h.tool]! : owned[0]!;
  const dx = DX[h.face]!;
  const dy = DY[h.face]!;
  if (tool === "bow") {
    if (h.arrows <= 0) { say(s, "empty", h.x, h.y); h.cool = 20; return; }
    h.arrows--;
    s.shots.push({ id: s.nextId++, kind: "arrow", x: h.x + dx * 96, y: h.y + dy * 96, vx: dx * 80, vy: dy * 80, t: 60, d: h.face });
    h.cool = 24;
    say(s, "arrow", h.x, h.y);
  } else if (tool === "bombs") {
    if (h.bombs <= 0) { say(s, "empty", h.x, h.y); h.cool = 20; return; }
    h.bombs--;
    s.shots.push({ id: s.nextId++, kind: "bomb", x: h.x + dx * 224, y: h.y + dy * 224, vx: 0, vy: 0, t: 90, d: 0 });
    h.cool = 40;
    say(s, "set", h.x, h.y);
  } else if (!s.hook) {
    s.hook = { x: h.x, y: h.y, d: h.face, mode: 0, tx: 0, ty: 0 };
    h.cool = 20;
    say(s, "hook", h.x, h.y);
  }
}

function stepHook(s: QuestState) {
  const k = s.hook!;
  const h = s.hero;
  const dx = DX[k.d]!;
  const dy = DY[k.d]!;
  if (k.mode === 0) {
    k.x += dx * 96;
    k.y += dy * 96;
    const tile = tileAt(s, k.x, k.y);
    const far = Math.abs(k.x - h.x) + Math.abs(k.y - h.y) > U * 8;
    if (tile === T.post) {
      // Pulled to the tile this side of the post, if there is ground there to land on.
      const tx = Math.trunc(k.x / U) - dx;
      const ty = Math.trunc(k.y / U) - dy;
      if (questWalkable(s.tiles[ty * C + tx] ?? -1)) { k.mode = 1; k.tx = centre(tx); k.ty = centre(ty); say(s, "latch", k.x, k.y); }
      else k.mode = 2;
    } else if (tile === -1 || !questOpen(tile) || far) k.mode = 2;
    else for (const f of s.foes) if (Math.abs(f.x - k.x) < beast(f.kind).r && Math.abs(f.y - k.y) < beast(f.kind).r) { f.inv = Math.max(f.inv, 1); f.t += 40; k.mode = 2; say(s, "clink", k.x, k.y); break; }
  } else if (k.mode === 1) {
    const [vx, vy] = toward(h.x, h.y, k.tx, k.ty, 96);
    if (Math.abs(k.tx - h.x) + Math.abs(k.ty - h.y) <= 96) { h.x = k.tx; h.y = k.ty; s.hook = null; h.inv = Math.max(h.inv, 10); }
    else { h.x += vx; h.y += vy; }
  } else {
    k.x -= dx * 128;
    k.y -= dy * 128;
    if ((k.x - h.x) * dx + (k.y - h.y) * dy <= 0) s.hook = null;
  }
}

function stepHero(s: QuestState, input: QuestInput) {
  const h = s.hero;
  const room = roomOf(s);
  if (h.inv > 0) h.inv--;
  if (h.cool > 0) h.cool--;
  h.tool = input.tool;
  const pressedA = input.a && !(s.held & 1);
  const pressedB = input.b && !(s.held & 2);
  h.walking = 0;
  if (s.hook) { stepHook(s); return; }
  if (h.kt > 0) {
    h.kt--;
    slide(s, h, h.kx, h.ky, HALF, questWalkable, true);
  } else if (h.swing > 0) {
    h.swing--;
  } else {
    if (input.dx !== 0 || input.dy !== 0) {
      // He turns to face the way he is pushed, and keeps facing a way he is still being pushed.
      const along = h.face % 2 === 0 ? input.dx === DX[h.face] : input.dy === DY[h.face];
      if (!along) h.face = input.dx !== 0 ? (input.dx > 0 ? 0 : 2) : input.dy > 0 ? 1 : 3;
      const speed = input.dx !== 0 && input.dy !== 0 ? 17 : WALK;
      const was = { x: h.x, y: h.y };
      const hit = slide(s, h, input.dx * speed, input.dy * speed, HALF, questWalkable, true);
      if (hit && (input.dx === 0) !== (input.dy === 0)) {
        // Stopped by a corner with open ground beside it: ease round it.
        const tx = Math.trunc(h.x / U);
        const ty = Math.trunc(h.y / U);
        const ahead = s.tiles[(ty + input.dy) * C + tx + input.dx];
        if (ahead !== undefined && questWalkable(ahead)) {
          if (input.dx !== 0) slide(s, h, 0, Math.sign(centre(ty) - h.y) * Math.min(WALK, Math.abs(centre(ty) - h.y)), HALF, questWalkable, true);
          else slide(s, h, Math.sign(centre(tx) - h.x) * Math.min(WALK, Math.abs(centre(tx) - h.x)), 0, HALF, questWalkable, true);
        }
        if (h.x === was.x && h.y === was.y) push(s);
      }
      h.walking = 1;
    }
    if (pressedA && has(s, "sword") && s.freeze === 0) {
      h.swing = SWING;
      say(s, "swing", h.x, h.y, { seat: 0 });
      const [bx, by, hw, hh] = swingBox(s);
      cut(s, bx, by);
      cut(s, bx - (hw > hh ? 0 : 112), by - (hw > hh ? 112 : 0));
      cut(s, bx + (hw > hh ? 0 : 112), by + (hw > hh ? 112 : 0));
    } else if (pressedB && s.freeze === 0) useTool(s);
  }
  if (h.swing > 4) {
    const [bx, by, hw, hh] = swingBox(s);
    for (const f of [...s.foes]) if (Math.abs(f.x - bx) <= hw + Math.trunc(beast(f.kind).r / 2) && Math.abs(f.y - by) <= hh + Math.trunc(beast(f.kind).r / 2)) strike(s, f, 2 + h.blade, h.face);
    s.shots = s.shots.filter((shot) => {
      const stopped = shot.kind === "seed" && Math.abs(shot.x - bx) <= hw && Math.abs(shot.y - by) <= hh;
      if (stopped) say(s, "clink", shot.x, shot.y);
      return !stopped;
    });
  }
  // Steps down, and doors in.
  const under = tileAt(s, h.x, h.y);
  if (under === T.stairs || under === T.doorway) {
    const to = room.warps[Math.trunc(h.y / U) * C + Math.trunc(h.x / U)];
    if (to) {
      if (under === T.doorway) s.back = { ...to };
      h.face = 3;
      enter(s, to.room, centre(to.tx), centre(to.ty), 4);
      return;
    }
  }
  // Off the edge of the screen: the next one.
  const side = h.x >= W ? 0 : h.y >= H ? 1 : h.x < 0 ? 2 : h.y < 0 ? 3 : -1;
  if (side === -1) return;
  const next = room.exits[side]!;
  if (side === 1 && room.out) {
    if (room.area === "den") s.back = { ...world(s).start };
    h.face = 1;
    enter(s, room.out.room, centre(room.out.tx), centre(room.out.ty), 5);
  } else if (next >= 0) {
    const inner = world(s).rooms[next]!.area === "den";
    const edge = inner ? U + U / 2 : U / 2;
    if (side === 0) enter(s, next, edge, inner ? centre(5) : h.y, side);
    else if (side === 2) enter(s, next, W - edge, inner ? centre(5) : h.y, side);
    else if (side === 1) enter(s, next, inner ? Math.min(9 * U - HALF - 8, Math.max(7 * U + HALF + 8, h.x)) : h.x, edge, side);
    else enter(s, next, inner ? Math.min(9 * U - HALF - 8, Math.max(7 * U + HALF + 8, h.x)) : h.x, H - edge, side);
  } else {
    h.x = Math.min(W - 1, Math.max(0, h.x));
    h.y = Math.min(H - 1, Math.max(0, h.y));
  }
}

// ---- Fighting -------------------------------------------------------------------------------------

/** Hurt something, if it can be hurt from there. `from` is the way the blow travels, or -1 for a blast, which gets round any armour. */
function strike(s: QuestState, f: Foe, damage: number, from: number): boolean {
  if (f.inv > 0) return false;
  if (f.kind === "boss:gloom" && f.mode !== 0) return false;
  if (f.kind === "boss:quagg" && f.mode === 3) return false;
  const armoured = from >= 0 && ((f.kind === "knight" && from === (f.d + 2) % 4) || (f.kind === "boss:maw" && f.mode !== 2) || (f.kind === "boss:tusker" && f.mode !== 3));
  if (armoured) {
    f.inv = 10;
    say(s, "clink", f.x, f.y);
    return false;
  }
  f.hp -= damage;
  f.inv = 16;
  if (!isBoss(f.kind) && from >= 0) { f.kx = DX[from]! * 40; f.ky = DY[from]! * 40; f.kt = 8; }
  say(s, "hit", f.x, f.y);
  if (f.hp <= 0) kill(s, f);
  return true;
}

function kill(s: QuestState, f: Foe) {
  const b = beast(f.kind);
  s.foes = s.foes.filter((other) => other !== f);
  s.kills++;
  s.score += b.points;
  say(s, isBoss(f.kind) ? "bigboom" : "boom", f.x, f.y, { amount: b.points, text: `+${b.points}` });
  if (!isBoss(f.kind)) { leave(s, f.x, f.y, 45); return; }
  // A boss takes its brood with it.
  s.foes = [];
  s.shots = s.shots.filter((shot) => shot.kind === "bomb" || shot.kind === "blast");
  if (f.kind === "boss:quagg") {
    s.phase = "won";
    s.score += 5000 + Math.max(0, 6000 - Math.trunc(s.tick / QUEST_RATE) * 2);
    tell(s, "Quagg is beaten. The Stripes are home!", 600);
    say(s, "over", f.x, f.y);
    return;
  }
  s.drops.push({ id: s.nextId++, kind: "item:vessel", x: centre(6), y: centre(5), t: -1 });
  s.drops.push({ id: s.nextId++, kind: "item:stripe", x: centre(9), y: centre(5), t: -1 });
}

function fire(s: QuestState, kind: "seed" | "orb", x: number, y: number, vx: number, vy: number) {
  s.shots.push({ id: s.nextId++, kind, x, y, vx, vy, t: 240, d: 0 });
}
function ring(s: QuestState, kind: "seed" | "orb", x: number, y: number, speed: number) {
  const slant = Math.round((speed * 7) / 10);
  for (const [vx, vy] of [[speed, 0], [-speed, 0], [0, speed], [0, -speed], [slant, slant], [-slant, slant], [slant, -slant], [-slant, -slant]]) fire(s, kind, x, y, vx!, vy!);
  say(s, "spit", x, y);
}
/** The straight way from something to the hero that covers the most ground. */
const facing = (s: QuestState, f: { x: number; y: number }) => {
  const dx = s.hero.x - f.x;
  const dy = s.hero.y - f.y;
  return Math.abs(dx) >= Math.abs(dy) ? (dx >= 0 ? 0 : 2) : dy >= 0 ? 1 : 3;
};
/** Somewhere open to stand, well away from the hero. */
function elsewhere(s: QuestState, rand: () => number): [number, number] {
  for (let n = 0; n < 40; n++) {
    const tx = 2 + Math.floor(rand() * (C - 4));
    const ty = 2 + Math.floor(rand() * (R - 4));
    if (groundOnly(s.tiles[ty * C + tx]!) && Math.abs(centre(tx) - s.hero.x) + Math.abs(centre(ty) - s.hero.y) > U * 4) return [centre(tx), centre(ty)];
  }
  return [W / 2, centre(3)];
}

function stepFoe(s: QuestState, f: Foe) {
  const b = beast(f.kind);
  const h = s.hero;
  const rand = nextRandom(s);
  const pick = (n: number) => Math.floor(rand() * n);
  if (f.inv > 0) f.inv--;
  if (f.kt > 0) { f.kt--; roam(s, f, f.kx, f.ky); return; }
  f.t--;
  switch (f.kind) {
    case "slime":
    case "spitter": {
      if (f.t <= 0) { f.mode = pick(5); f.t = 40 + pick(50); if (f.mode < 4) f.d = f.mode; }
      if (f.mode < 4 && roam(s, f, DX[f.mode]! * b.speed, DY[f.mode]! * b.speed)) f.t = 0;
      if (f.kind === "spitter" && --f.n <= 0) {
        f.n = 20;
        if (Math.abs(h.x - f.x) < 160 || Math.abs(h.y - f.y) < 160) {
          f.d = facing(s, f);
          fire(s, "seed", f.x, f.y, DX[f.d]! * 32, DY[f.d]! * 32);
          say(s, "spit", f.x, f.y);
          f.n = 110;
        }
      }
      break;
    }
    case "skitter": {
      if (f.mode === 0 && f.t <= 0) { f.mode = 1; f.t = 18; f.d = pick(10) < 6 ? facing(s, f) : pick(4); }
      else if (f.mode === 1 && (f.t <= 0 || roam(s, f, DX[f.d]! * b.speed, DY[f.d]! * b.speed))) { f.mode = 0; f.t = 30 + pick(30); }
      break;
    }
    case "bat": {
      if (f.mode === 0 && f.t <= 0) { f.mode = 1; f.t = 80; }
      else if (f.mode === 1) {
        if (f.t % 20 === 0) { [f.vx, f.vy] = toward(f.x, f.y, h.x, h.y, b.speed); f.vx += pick(17) - 8; f.vy += pick(17) - 8; f.d = f.vx >= 0 ? 0 : 2; }
        roam(s, f, f.vx, f.vy);
        if (f.t <= 0) { f.mode = 0; f.t = 40 + pick(40); }
      }
      break;
    }
    case "charger": {
      if (f.mode === 0) {
        if (f.t <= 0) { f.n = pick(5); f.t = 40 + pick(50); if (f.n < 4) f.d = f.n; }
        if (f.n < 4 && roam(s, f, DX[f.n]! * b.speed, DY[f.n]! * b.speed)) f.t = 0;
        if (Math.abs(h.x - f.x) < 144 || Math.abs(h.y - f.y) < 144) { f.mode = 1; f.t = 20; f.d = facing(s, f); say(s, "tell", f.x, f.y); }
      } else if (f.mode === 1) { if (f.t <= 0) { f.mode = 2; f.t = 90; } }
      else if (f.mode === 2) { if (roam(s, f, DX[f.d]! * 44, DY[f.d]! * 44) || f.t <= 0) { f.mode = 3; f.t = 50; } }
      else if (f.t <= 0) { f.mode = 0; f.t = 30; f.n = 4; }
      break;
    }
    case "knight": {
      if (f.t <= 0) { f.t = 30; f.d = facing(s, f); if (pick(4) === 0) f.d = pick(4); }
      if (roam(s, f, DX[f.d]! * b.speed, DY[f.d]! * b.speed)) { f.d = (f.d + 1 + pick(3)) % 4; f.t = 20; }
      break;
    }
    case "wisp": {
      [f.vx, f.vy] = toward(f.x, f.y, h.x, h.y, b.speed);
      f.d = f.vx >= 0 ? 0 : 2;
      roam(s, f, f.vx, f.vy);
      break;
    }
    case "boss:maw": {
      // Shut, then a warning, then open: seeds all round, twice, and that is when it can be hurt.
      if (f.mode === 0 && f.t <= 0) { f.mode = 1; f.t = 30; say(s, "tell", f.x, f.y); }
      else if (f.mode === 1 && f.t <= 0) { f.mode = 2; f.t = 110; ring(s, "seed", f.x, f.y, 28); }
      else if (f.mode === 2) {
        if (f.t === 55) ring(s, "seed", f.x, f.y, 36);
        if (f.t <= 0) {
          f.mode = 0;
          f.t = f.hp <= 10 ? 70 : 120;
          if (++f.n % 2 === 0 && s.foes.length < 4) s.foes.push({ id: s.nextId++, kind: "slime", x: f.x, y: f.y + 400, hp: 2, t: 30, mode: 4, d: 1, n: 0, vx: 0, vy: 0, inv: 0, kx: 0, ky: 0, kt: 0 });
        }
      }
      break;
    }
    case "boss:tusker": {
      // Stalks, paws the ground, then runs until something stops it, and is dazed when it does.
      if (f.mode === 0) {
        if (f.t % 20 === 0) f.d = facing(s, f);
        roam(s, f, DX[f.d]! * b.speed, DY[f.d]! * b.speed);
        if (f.t <= 0) { f.mode = 1; f.t = f.hp <= 12 ? 18 : 30; f.d = facing(s, f); say(s, "tell", f.x, f.y); }
      } else if (f.mode === 1) { if (f.t <= 0) { f.mode = 2; f.t = 120; } }
      else if (f.mode === 2) { if (roam(s, f, DX[f.d]! * 56, DY[f.d]! * 56) || f.t <= 0) { f.mode = 3; f.t = 100; say(s, "quake", f.x, f.y); } }
      else if (f.t <= 0) { f.mode = 0; f.t = 70; }
      break;
    }
    case "boss:gloom": {
      // Seen, and then it can be hurt; it throws three lights, fades, and comes back somewhere else.
      if (f.mode === 0) {
        [f.vx, f.vy] = toward(f.x, f.y, h.x, h.y, b.speed);
        roam(s, f, f.vx, f.vy);
        if (f.t === 60) {
          const [ax, ay] = toward(f.x, f.y, h.x, h.y, 30);
          fire(s, "orb", f.x, f.y, ax, ay);
          fire(s, "orb", f.x, f.y, ax - Math.round(ay / 3), ay + Math.round(ax / 3));
          fire(s, "orb", f.x, f.y, ax + Math.round(ay / 3), ay - Math.round(ax / 3));
          say(s, "spit", f.x, f.y);
        }
        if (f.t <= 0) { f.mode = 1; f.t = 30; }
      } else if (f.mode === 1) { if (f.t <= 0) { f.mode = 2; f.t = f.hp <= 12 ? 20 : 40; } }
      else if (f.mode === 2) { if (f.t <= 0) { [f.x, f.y] = elsewhere(s, rand); f.mode = 3; f.t = 20; say(s, "tell", f.x, f.y); } }
      else if (f.t <= 0) { f.mode = 0; f.t = 130; }
      break;
    }
    case "boss:quagg": {
      // Comes on, winds up, then a rush or a ring of lights. Hurt enough, he is quicker and will not stay put.
      const wild = f.hp <= 24;
      if (f.mode === 0) {
        [f.vx, f.vy] = toward(f.x, f.y, h.x, h.y, wild ? 16 : b.speed);
        f.d = facing(s, f);
        roam(s, f, f.vx, f.vy);
        if (f.t <= 0) { f.mode = 1; f.t = 24; f.n = pick(2); say(s, "tell", f.x, f.y); }
      } else if (f.mode === 1) {
        if (f.t <= 0) {
          f.mode = 2;
          f.t = 30;
          if (f.n === 0) [f.vx, f.vy] = toward(f.x, f.y, h.x, h.y, 56);
          else { f.vx = 0; f.vy = 0; ring(s, "orb", f.x, f.y, wild ? 34 : 26); }
        }
      } else if (f.mode === 2) {
        if (f.n === 0 && roam(s, f, f.vx, f.vy)) { f.vx = 0; f.vy = 0; }
        if (f.t <= 0) { f.mode = wild ? 3 : 0; f.t = wild ? 40 : 110; }
      } else {
        if (f.t === 20) [f.x, f.y] = elsewhere(s, rand);
        if (f.t <= 0) { f.mode = 0; f.t = 80; }
      }
      break;
    }
  }
}

function blast(s: QuestState, shot: Shot) {
  shot.kind = "blast";
  shot.t = 18;
  say(s, "blast", shot.x, shot.y);
  for (let i = 0; i < s.tiles.length; i++) {
    const tx = i % C;
    const ty = (i - tx) / C;
    const dx = centre(tx) - shot.x;
    const dy = centre(ty) - shot.y;
    if (dx * dx + dy * dy > 480 * 480) continue;
    if (s.tiles[i] === T.crack) { setTile(s, i, T.ground, true); say(s, "crumble", centre(tx), centre(ty)); s.score += 30; }
    else if (s.tiles[i] === T.bush) setTile(s, i, T.ground, false);
  }
  for (const f of [...s.foes]) {
    const reach = 448 + beast(f.kind).r;
    if ((f.x - shot.x) * (f.x - shot.x) + (f.y - shot.y) * (f.y - shot.y) <= reach * reach) strike(s, f, 4, -1);
  }
  const h = s.hero;
  if ((h.x - shot.x) * (h.x - shot.x) + (h.y - shot.y) * (h.y - shot.y) <= 400 * 400) hurtHero(s, 2, shot.x, shot.y);
}

function stepShots(s: QuestState) {
  const h = s.hero;
  for (const shot of [...s.shots]) {
    if (s.phase !== "play") return;
    shot.t--;
    let gone = shot.t <= 0;
    if (shot.kind === "bomb") { if (gone) { blast(s, shot); gone = false; } }
    else if (shot.kind !== "blast") {
      shot.x += shot.vx;
      shot.y += shot.vy;
      const tile = tileAt(s, shot.x, shot.y);
      if (tile === -1) gone = true;
      else if (shot.kind === "arrow") {
        if (tile === T.eye) { openAll(s, Math.trunc(shot.y / U) * C + Math.trunc(shot.x / U), T.eye); say(s, "unlock", shot.x, shot.y); s.score += 30; gone = true; }
        else if (!questOpen(tile)) { say(s, "clink", shot.x, shot.y); gone = true; }
        else for (const f of s.foes) if (Math.abs(f.x - shot.x) <= beast(f.kind).r && Math.abs(f.y - shot.y) <= beast(f.kind).r) { strike(s, f, 2, shot.d); gone = true; break; }
      } else if (!questOpen(tile)) gone = true;
      else if (Math.abs(h.x - shot.x) < 136 && Math.abs(h.y - shot.y) < 136 && h.inv === 0) { hurtHero(s, shot.kind === "orb" ? 2 : 1, shot.x, shot.y); gone = true; }
    }
    if (gone) s.shots = s.shots.filter((other) => other !== shot);
  }
}

function stepDrops(s: QuestState) {
  const h = s.hero;
  for (const drop of [...s.drops]) {
    if (drop.t > 0 && --drop.t === 0) { s.drops = s.drops.filter((d) => d !== drop); continue; }
    if (Math.abs(h.x - drop.x) > 200 || Math.abs(h.y - drop.y) > 200) continue;
    s.drops = s.drops.filter((d) => d !== drop);
    if (drop.kind === "heart") h.hp = Math.min(h.max, h.hp + 2);
    else if (drop.kind === "coin") h.coins = Math.min(999, h.coins + 1);
    else if (drop.kind === "gem") h.coins = Math.min(999, h.coins + 5);
    else if (drop.kind === "arrows") h.arrows = Math.min(30, h.arrows + 5);
    else if (drop.kind === "bombs") h.bombs = Math.min(20, h.bombs + 3);
    else {
      const what = drop.kind.slice(5);
      give(s, what, drop.x, drop.y);
      if (what === "stripe") {
        // A Stripe carries its finder back up into the daylight.
        const out = world(s).rooms[world(s).dens[roomOf(s).den]!.entrance]!.out!;
        s.back = { ...world(s).start };
        h.face = 1;
        enter(s, out.room, centre(out.tx), centre(out.ty), 5);
        s.freeze = 90;
        return;
      }
      continue;
    }
    if (drop.kind === "coin" || drop.kind === "gem") s.score += drop.kind === "gem" ? 5 : 1;
    say(s, "pick", drop.x, drop.y, { text: drop.kind });
  }
}

/** The people and the shops of a cave. */
function stepCave(s: QuestState) {
  const h = s.hero;
  const room = roomOf(s);
  if (s.shopT > 0) { s.shopT--; return; }
  for (const who of room.folk) if (Math.abs(h.x - centre(who.tx)) < 400 && Math.abs(h.y - centre(who.ty)) < 400 && s.msgT === 0) { tell(s, who.say, 210); s.shopT = 400; return; }
  for (const ware of room.wares) {
    if (Math.abs(h.x - centre(ware.tx)) > 150 || Math.abs(h.y - centre(ware.ty)) > 150) continue;
    s.shopT = 50;
    const once = `${s.room}:${ware.key}`;
    const use = ware.key === "potion" ? h.hp < h.max : ware.key === "bombs" ? has(s, "bombs") && h.bombs < 20 : ware.key === "arrows" ? has(s, "bow") && h.arrows < 30 : !s.bought.includes(once) && (ware.key !== "blade" || has(s, "sword"));
    if (!use) { tell(s, ware.key === "potion" ? "You are in good health already." : s.bought.includes(once) ? "Sold out." : "You have no use for that yet.", 90); return; }
    if (h.coins < ware.cost) { tell(s, `That is ${ware.cost} acorns.`, 90); say(s, "empty", h.x, h.y); return; }
    h.coins -= ware.cost;
    if (ware.key === "potion") { h.hp = h.max; tell(s, "Good as new.", 90); }
    else if (ware.key === "bombs") { h.bombs = Math.min(20, h.bombs + 5); tell(s, "Five bombs.", 90); }
    else if (ware.key === "arrows") { h.arrows = Math.min(30, h.arrows + 10); tell(s, "Ten arrows.", 90); }
    else { s.bought.push(once); give(s, ware.key, h.x, h.y); }
    say(s, "buy", h.x, h.y);
    return;
  }
}

function step(s: QuestState, inputs: readonly (QuestInput | null | undefined)[]) {
  if (s.phase !== "play") return;
  // Made safe again here: a step must not be thrown by whatever it is handed.
  const input = safe(inputs[0]);
  s.tick++;
  s.events = [];
  const touched = input.dx !== 0 || input.dy !== 0 || input.a || input.b;
  s.quiet = touched ? 0 : s.quiet + 1;
  if (s.quiet >= QUEST_SLEEP) {
    s.phase = "asleep";
    tell(s, "Zub lies down in the grass and goes to sleep.", 600);
    say(s, "over", s.hero.x, s.hero.y);
    return;
  }
  if (s.msgT > 0 && --s.msgT === 0) s.msg = "";
  const held = (input.a ? 1 : 0) | (input.b ? 2 : 0);
  if (s.freeze > 0) { s.freeze--; s.held = held; return; }
  const before = s.room;
  stepHero(s, input);
  s.held = held;
  if (s.room !== before || s.phase !== "play") return;
  for (const f of [...s.foes]) if (s.foes.includes(f)) stepFoe(s, f);
  stepShots(s);
  if (s.room !== before || s.phase !== "play") return;
  const h = s.hero;
  for (const f of s.foes) {
    const b = beast(f.kind);
    const fading = (f.kind === "boss:gloom" && f.mode !== 0) || (f.kind === "boss:quagg" && f.mode === 3);
    const near = b.r + 72;
    if (!fading && (f.x - h.x) * (f.x - h.x) + (f.y - h.y) * (f.y - h.y) <= near * near) { hurtHero(s, b.touch, f.x, f.y); break; }
  }
  if (s.room !== before || s.phase !== "play") return;
  stepDrops(s);
  if (s.room !== before) return;
  if (roomOf(s).area === "cave") stepCave(s);
  if (s.fight && s.foes.length === 0) {
    s.fight = 0;
    if (roomOf(s).area !== "over" && !s.cleared.includes(s.room)) { s.cleared.push(s.room); s.score += 100; }
    if (s.shut) unshut(s);
  }
}

// ---- What everyone sees ---------------------------------------------------------------------------

const placeName = (s: QuestState) => {
  const room = roomOf(s);
  if (room.area === "den") return QUEST_DENS[room.den]!.name;
  if (room.area === "cave") return room.wares.length ? "Bru's Goods" : "The Elder's Cave";
  return REGIONS[room.gy >= 2 ? (room.gx < 3 ? 0 : 1) : room.gx < 3 ? 2 : 3]!;
};

function view(s: QuestState): ArcadeView {
  const h = s.hero;
  const room = roomOf(s);
  const things: ArcadeThing[] = [];
  room.folk.forEach((who, n) => things.push({ id: 10 + n, kind: `folk:${who.kind}`, x: centre(who.tx), y: centre(who.ty), r: 128 }));
  room.wares.forEach((ware, n) => { if (!s.bought.includes(`${s.room}:${ware.key}`)) things.push({ id: 20 + n, kind: `ware:${ware.key}`, x: centre(ware.tx), y: centre(ware.ty), r: 112, level: ware.cost }); });
  for (const drop of s.drops) things.push({ id: drop.id, kind: drop.kind.startsWith("item:") ? drop.kind : `drop:${drop.kind}`, x: drop.x, y: drop.y, r: 80, ghost: drop.t > 0 && drop.t < 120 });
  for (const f of s.foes) {
    const b = beast(f.kind);
    const mark = f.kind === "boss:maw" ? ["shut", "tell", "open"][f.mode] : f.kind === "boss:gloom" || (f.kind === "boss:quagg" && f.mode === 3) ? ["", "fade", "gone", "fade"][f.mode] : f.kind === "charger" || f.kind === "boss:tusker" || f.kind === "boss:quagg" ? ["", "tell", "rush", "dazed"][f.mode] : f.kind === "bat" || f.kind === "skitter" ? ["rest", "move"][f.mode] : "";
    things.push({ id: f.id, kind: isBoss(f.kind) ? f.kind : `foe:${f.kind}`, x: f.x, y: f.y, r: b.r, angle: f.d * 9000, health: Math.max(0, Math.round((f.hp * 1000) / b.hp)), ghost: f.inv > 0, ...(mark ? { mark } : {}) });
  }
  for (const shot of s.shots) things.push({ id: shot.id, kind: `shot:${shot.kind}`, x: shot.x, y: shot.y, r: shot.kind === "blast" ? 448 : shot.kind === "bomb" ? 96 : 56, angle: shot.d * 9000, level: shot.t });
  if (s.hook) things.push({ id: 2, kind: "shot:hook", x: s.hook.x, y: s.hook.y, r: 48, angle: s.hook.d * 9000 });
  things.push({ id: 1, kind: "hero", x: h.x, y: h.y, r: 128, seat: 0, angle: h.face * 9000, ghost: h.inv > 0, mark: h.swing > 0 ? "swing" : s.hook ? "hook" : h.walking ? "walk" : "stand", level: h.swing });
  const onMap = room.area === "cave" ? null : room.area === "over" ? { ...QUEST_OVER, rooms: world(s).rooms.slice(0, QUEST_OVER.cols * QUEST_OVER.rows) } : { ...QUEST_DEN, rooms: world(s).dens[room.den]!.rooms.map((id) => world(s).rooms[id]!) };
  const boss = s.foes.find((f) => isBoss(f.kind));
  const realm: ArcadeRealm = {
    cols: C,
    rows: R,
    tile: U,
    room: s.room,
    area: room.area,
    biome: room.biome,
    place: placeName(s),
    tiles: s.tiles,
    hero: {
      facing: h.face, health: h.hp, maxHealth: h.max, coins: h.coins, keys: room.den >= 0 ? h.keys[room.den] ?? 0 : 0, bigKey: room.den >= 0 && !!h.big[room.den],
      arrows: h.arrows, bombs: h.bombs, relics: h.relics, blade: h.blade,
      items: (Object.keys(BIT) as (keyof typeof BIT)[]).filter((item) => has(s, item)),
      tool: has(s, QUEST_TOOLS[h.tool]!) ? QUEST_TOOLS[h.tool]! : QUEST_TOOLS.find((tool) => has(s, tool)) ?? null,
    },
    map: onMap && { cols: onMap.cols, rows: onMap.rows, here: room.gy * onMap.cols + room.gx, seen: onMap.rooms.filter((r) => s.seen.includes(r.id)).map((r) => r.gy * onMap.cols + r.gx) },
    message: s.msg,
    still: s.freeze > 0,
    outcome: s.phase === "play" ? null : s.phase,
  };
  return {
    game: "zubraquest",
    tick: s.tick,
    rate: QUEST_RATE,
    seats: 1,
    field: QUEST_FIELD,
    things,
    pilots: [{ seat: 0, playing: s.phase === "play", score: s.score, lives: Math.ceil(h.hp / 2), stats: [{ key: "stripes", label: "Stripes", value: h.relics, max: 3 }, { key: "acorns", label: "Acorns", value: h.coins }] }],
    score: s.score,
    stage: placeName(s),
    ...(boss ? { boss: { name: beast(boss.kind).name ?? "", health: Math.max(0, Math.round((boss.hp * 1000) / beast(boss.kind).hp)) } } : {}),
    realm,
    events: s.events,
    over: s.phase !== "play",
  };
}

// ---- A computer player ----------------------------------------------------------------------------

/**
 * It has no plan for the land: it fights what is near, opens chests, goes down steps it has not
 * been down, and otherwise walks to a way out, a new one if there is one. Enough to see a game
 * played, and to earn a score.
 */
function bot(s: QuestState, _seat: number, style: PlayStyle, rand: () => number = Math.random): QuestInput {
  if (s.phase !== "play") return IDLE;
  if (rand() < (style.sloppy ?? 0.1) * 0.05) return IDLE;
  const h = s.hero;
  const room = roomOf(s);
  const sword = has(s, "sword");
  const hx = Math.min(C - 1, Math.max(0, Math.trunc(h.x / U)));
  const hy = Math.min(R - 1, Math.max(0, Math.trunc(h.y / U)));
  const tap = s.tick % 16 < 8;
  // Something close enough to hit: face it and swing.
  for (const f of s.foes) {
    const dx = f.x - h.x;
    const dy = f.y - h.y;
    if (sword && Math.abs(dx) + Math.abs(dy) < 420 + beast(f.kind).r) return { dx: Math.abs(dx) >= Math.abs(dy) ? Math.sign(dx) : 0, dy: Math.abs(dx) >= Math.abs(dy) ? 0 : Math.sign(dy), a: tap, b: false, tool: 0 };
  }
  // How far every tile is, on foot.
  const from = new Array<number>(C * R).fill(-1);
  const steps = new Array<number>(C * R).fill(-1);
  const todo = [hy * C + hx];
  steps[hy * C + hx] = 0;
  for (let n = 0; n < todo.length; n++) {
    const i = todo[n]!;
    for (let d = 0; d < 4; d++) {
      const tx = (i % C) + DX[d]!;
      const ty = Math.trunc(i / C) + DY[d]!;
      if (tx < 0 || ty < 0 || tx >= C || ty >= R) continue;
      const j = ty * C + tx;
      const tile = s.tiles[j]!;
      if (steps[j] !== -1 || !(questWalkable(tile) || (sword && tile === T.bush))) continue;
      steps[j] = steps[i]! + 1;
      from[j] = i;
      todo.push(j);
    }
  }
  let goal = -1;
  let towards = -1;
  const better = (i: number) => steps[i]! >= 0 && (goal === -1 || steps[i]! < steps[goal]!);
  for (let i = 0; i < C * R && sword; i++) for (const f of s.foes) if (Math.trunc(f.y / U) * C + Math.trunc(f.x / U) === i && steps[i]! <= 6 && better(i)) goal = i;
  if (goal === -1) for (let i = 0; i < C * R; i++) if (s.tiles[i] === T.chest) for (let d = 0; d < 4; d++) { const j = i - DX[d]! - DY[d]! * C; if (j >= 0 && j < C * R && better(j)) { goal = j; towards = d; } }
  if (goal === -1) for (const drop of s.drops) { const i = Math.trunc(drop.y / U) * C + Math.trunc(drop.x / U); if (better(i)) goal = i; }
  if (goal === -1) for (const key in room.warps) if (!s.seen.includes(room.warps[key]!.room) && better(Number(key))) goal = Number(key);
  if (goal === -1) {
    // A way out: one not taken yet for choice, and otherwise a different one every so often.
    const ways: number[] = [];
    for (let i = 0; i < C * R; i++) {
      const tx = i % C;
      const ty = Math.trunc(i / C);
      const side = tx === C - 1 ? 0 : ty === R - 1 ? 1 : tx === 0 ? 2 : ty === 0 ? 3 : -1;
      if (side === -1 || steps[i]! < 0) continue;
      const next = side === 1 && room.out ? room.out.room : room.exits[side]!;
      if (next < 0) continue;
      if (!s.seen.includes(next)) { if (goal === -1) { goal = i; towards = side; } } else ways.push(i * 4 + side);
    }
    if (goal === -1 && ways.length) { const way = ways[(Math.trunc(s.tick / 900) + s.room) % ways.length]!; goal = way >> 2; towards = way & 3; }
  }
  if (goal === -1) return { ...IDLE, a: tap };
  // The first step of the way there.
  let next = goal;
  while (from[next] !== -1 && from[next] !== hy * C + hx) next = from[next]!;
  if (next === hy * C + hx) {
    if (towards === -1) return IDLE;
    return { dx: DX[towards]!, dy: DY[towards]!, a: false, b: false, tool: 0 };
  }
  const dx = centre(next % C) - h.x;
  const dy = centre(Math.trunc(next / C)) - h.y;
  const brush = s.tiles[next] === T.bush;
  return { dx: Math.abs(dx) > 24 ? Math.sign(dx) : 0, dy: Math.abs(dy) > 24 ? Math.sign(dy) : 0, a: brush && tap, b: false, tool: 0 };
}

// ---- The game -------------------------------------------------------------------------------------

const whole = (n: unknown, low: number, high: number, or: number) => (typeof n === "number" && Number.isFinite(n) ? Math.min(high, Math.max(low, Math.trunc(n))) : or);

function safe(given: unknown): QuestInput {
  const g = (given && typeof given === "object" ? given : {}) as Partial<Record<keyof QuestInput, unknown>>;
  return { dx: whole(g.dx, -1, 1, 0) + 0, dy: whole(g.dy, -1, 1, 0) + 0, a: g.a === true, b: g.b === true, tool: whole(g.tool, 0, QUEST_TOOLS.length - 1, 0) };
}

function normalize(rules: unknown): QuestRules {
  const given = (rules && typeof rules === "object" ? rules : {}) as Partial<QuestRules>;
  const preset = QUEST_PRESETS.find((p) => p.id === given.id) ?? QUEST_PRESETS[0]!;
  return {
    id: typeof given.id === "string" ? given.id : preset.id,
    name: typeof given.name === "string" && given.name ? given.name : preset.name,
    hearts: whole(given.hearts, 1, 6, preset.hearts),
    foes: given.foes === "mild" || given.foes === "fair" || given.foes === "fierce" ? given.foes : preset.foes,
    continues: whole(given.continues, 0, 9, preset.continues),
  };
}

function summary(s: QuestState): ArcadeSummary {
  return {
    game: "zubraquest",
    rules: s.rules.name,
    phase: s.phase,
    over: s.phase !== "play",
    seats: 1,
    ticks: s.tick,
    score: s.score,
    scores: [s.score],
    scoreLine: `${s.phase === "won" ? "Quagg beaten" : `${s.hero.relics} of 3 Stripes`} · ${points(s.score)}`,
    order: [0],
  };
}

export const zubraQuest: ArcadeGame<QuestRules, QuestState, QuestInput> = {
  id: "zubraquest",
  name: "Zubra Quest",
  emoji: "🗡️",
  category: "arcade",
  blurb: "A sixteen-bit adventure: a sword, three dens, three stolen Stripes and the thief who took them.",
  tagline: "Quagg stole the herd's three Great Stripes. Zub is going to get them back.",
  seats: { min: 1, max: 1, default: 1 },
  teams: false,
  presets: QUEST_PRESETS,
  fields: [
    { key: "hearts", label: "Hearts", hint: "How many the hero starts with", kind: "number", min: 1, max: 6 },
    { key: "foes", label: "Foes", hint: "How hard things hit", kind: "choice", options: [["mild", "Mild"], ["fair", "Fair"], ["fierce", "Fierce"]] },
    { key: "continues", label: "Continues", hint: "How many times the hero gets back up. 0 is as often as it takes", kind: "number", min: 0, max: 9 },
  ],
  normalize,
  validate(rules) {
    const problems: string[] = [];
    if (!Number.isInteger(rules.hearts) || rules.hearts < 1 || rules.hearts > 6) problems.push("A hero starts with 1 to 6 hearts.");
    if (!["mild", "fair", "fierce"].includes(rules.foes)) problems.push("Foes are mild, fair or fierce.");
    if (!Number.isInteger(rules.continues) || rules.continues < 0 || rules.continues > 9) problems.push("Continues are 0 (no limit) to 9.");
    return problems;
  },
  describe(rules) {
    return [
      "Find the sword, then the three dens. Each has a prize that opens more of the land, and a Great Stripe behind its boss.",
      "With all three Stripes the keep's gate opens. Beat Quagg to win.",
      `${rules.hearts} ${rules.hearts === 1 ? "heart" : "hearts"} to start, and ${rules.foes} foes.`,
      rules.continues === 0 ? "Fall, and Zub gets back up at the last door he came in by, as often as it takes." : `Zub gets back up ${rules.continues} ${rules.continues === 1 ? "time" : "times"}, and then the quest is over.`,
      "The land is different for every game.",
    ];
  },
  controls: [
    "Arrow keys, WASD or the pad: walk",
    "Z, J or the A button: the sword",
    "X, K or the B button: the tool in hand (the bow, a bomb, the hookshot)",
    "C, L or a tap on the tool: change tool",
    "Walk into a chest, a locked door or something for sale to open it or buy it",
  ],
  rate: QUEST_RATE,
  newGame(rules, _seats, seed) {
    const land = questWorld(seed >>> 0);
    const s: QuestState = {
      rules, seats: 1, seed: seed >>> 0, rng: (seed ^ 0x51ed) >>> 0, tick: 0, phase: "play", room: land.start.room, tiles: [], perm: {}, seen: [], cleared: [], bought: [],
      hero: { x: 0, y: 0, face: 1, hp: rules.hearts * 2, max: rules.hearts * 2, inv: 0, kx: 0, ky: 0, kt: 0, swing: 0, cool: 0, walking: 0, coins: 0, keys: [0, 0, 0, 0], big: [0, 0, 0, 0], relics: 0, items: 0, arrows: 0, bombs: 0, blade: 0, tool: 0 },
      hook: null, foes: [], shots: [], drops: [], nextId: 100, freeze: 0, msg: "", msgT: 0, shopT: 0, fight: 0, shut: 0, held: 0, quiet: 0, back: { ...land.start }, score: 0, kills: 0, deaths: 0, events: [],
    };
    enter(s, land.start.room, centre(land.start.tx), centre(land.start.ty), -1);
    s.events = [];
    s.freeze = 0;
    tell(s, "The elder is calling from his cave.", 240);
    return s;
  },
  idle: IDLE,
  input: safe,
  step,
  view,
  bot,
  summary,
};
