// The land Zubra Quest is played in: an overworld of screens, three dens and a keep under it, and
// the caves where people live. It is made from the game's seed, the same land for the same seed
// everywhere, and it is never part of a game's state: a state keeps only what has changed (a door
// unlocked, a chest opened) and asks for the land again by its seed.
//
// A land can always be finished. It is built so by construction, and `test/zubraquest.test.ts`
// walks hundreds of them tile by tile to prove it:
//
//   - The overworld is four regions. The meadow, where the game starts, has the first den. The
//     dunes are behind cracked rock that only a bomb opens, and the bombs are in the first den. The
//     marsh is across a river that only the hookshot crosses, and that is in the second den, in
//     the dunes. The crags are behind watching stones that only an arrow shuts, and the bow is in
//     the third den, in the marsh. The keep is in the crags, behind a gate that wants all three
//     Stripes.
//   - A den is a tree of rooms. Its locks are on the way to its boss, one behind the other, and
//     each key is in a room on the near side of its lock, so a key can never be spent on the wrong
//     door and leave the right one shut.
import { mulberry32 } from "@journey-to-code/rules";

/** A screen is this many tiles across and down. Every room in the land is one screen. */
export const QUEST_COLS = 16;
export const QUEST_ROWS = 11;
/** The overworld is this many screens across and down, and a den this many rooms. */
export const QUEST_OVER = { cols: 6, rows: 5 };
export const QUEST_DEN = { cols: 4, rows: 4 };

/** What a tile is. A screen decides what each looks like from this and the room's biome. */
export const QUEST_TILE = {
  ground: 0,
  /** Trees, rock or brick: nothing gets through. */
  wall: 1,
  /** A sword cuts it. It grows back when the screen is left. */
  bush: 2,
  /** A bomb opens it, for good. */
  crack: 3,
  water: 4,
  pit: 5,
  /** What a hookshot takes hold of. */
  post: 6,
  /** A small key opens it. */
  lock: 7,
  /** The den's big key opens it. */
  bossDoor: 8,
  chest: 9,
  opened: 10,
  /** Steps down into a cave. */
  stairs: 11,
  path: 12,
  flower: 13,
  /** A watching stone: an arrow shuts it, for good. */
  eye: 14,
  /** A door that stays shut while anything in the room is alive. */
  shutter: 15,
  /** The keep's gate: it opens for whoever carries all three Stripes. */
  gate: 16,
  torch: 17,
  block: 18,
  /** The way into a den. */
  doorway: 19,
} as const;
const T = QUEST_TILE;

/** Tiles a hero can stand on. */
export const questWalkable = (tile: number) => tile === T.ground || tile === T.path || tile === T.flower || tile === T.stairs || tile === T.doorway;
/** Tiles an arrow or a hookshot passes over. */
export const questOpen = (tile: number) => questWalkable(tile) || tile === T.water || tile === T.pit;

export type QuestBiome = "meadow" | "dunes" | "marsh" | "crags" | "bramble" | "vault" | "hollow" | "keep" | "cave";
export interface QuestSpot { room: number; tx: number; ty: number }
export interface QuestRoom {
  id: number;
  area: "over" | "den" | "cave";
  biome: QuestBiome;
  /** Which den it is part of (the keep is 3), or -1. */
  den: number;
  /** Where it is on its area's map. */
  gx: number;
  gy: number;
  tiles: number[];
  /** The rooms to the right, below, to the left and above, or -1. */
  exits: [number, number, number, number];
  /** Where walking out of the bottom of a cave, or of a den's first room, comes out. */
  out: QuestSpot | null;
  /** Steps and doorways, by tile, and where each leads. */
  warps: Record<number, QuestSpot>;
  /** What is in each chest, by tile. */
  loot: Record<number, string>;
  /** What lives here. */
  spawns: { kind: string; tx: number; ty: number }[];
  /** People, and what they say. */
  folk: { kind: string; tx: number; ty: number; say: string }[];
  /** Things for sale. */
  wares: { key: string; tx: number; ty: number; cost: number }[];
  /** Its doors shut until it is cleared. */
  shut: boolean;
}
export interface QuestWorld {
  rooms: QuestRoom[];
  start: QuestSpot;
  dens: { name: string; boss: string; entrance: number; rooms: number[] }[];
}

export const QUEST_DENS = [
  { name: "Bramble Den", biome: "bramble", boss: "maw", bossName: "Bramble Maw", item: "bombs", guard: "crack", rooms: 7, foes: ["slime", "skitter", "bat", "spitter"] },
  { name: "Dune Vault", biome: "vault", boss: "tusker", bossName: "Dune Tusker", item: "hook", guard: "island", rooms: 8, foes: ["spitter", "charger", "bat", "skitter"] },
  { name: "Gloom Hollow", biome: "hollow", boss: "gloom", bossName: "The Gloom", item: "bow", guard: "eye", rooms: 9, foes: ["wisp", "knight", "bat", "charger"] },
  { name: "Quagg's Keep", biome: "keep", boss: "quagg", bossName: "Quagg the Stripe Thief", item: "coins50", guard: "eye", rooms: 10, foes: ["knight", "wisp", "charger", "spitter"] },
] as const;
const OVER_BIOMES: QuestBiome[] = ["meadow", "dunes", "marsh", "crags"];
const OVER_FOES = [["slime", "skitter"], ["spitter", "charger", "skitter"], ["slime", "bat", "spitter"], ["knight", "charger", "bat"]];

const C = QUEST_COLS;
const R = QUEST_ROWS;
const at = (tx: number, ty: number) => ty * C + tx;
type Rand = () => number;
const pick = (rand: Rand, n: number) => Math.floor(rand() * n);
const shuffle = <X>(rand: Rand, items: X[]): X[] => {
  for (let i = items.length - 1; i > 0; i--) {
    const j = pick(rand, i + 1);
    [items[i], items[j]] = [items[j]!, items[i]!];
  }
  return items;
};
/** Right, down, left, up. */
const DX = [1, 0, -1, 0];
const DY = [0, 1, 0, -1];

/** A way out of a screen: which side, where along it, how wide, and what stands in it. */
interface Opening { side: number; at: number; width: number; fill: number }
const openingTiles = (o: Opening): [number, number][] =>
  Array.from({ length: o.width }, (_, i) => (o.side === 0 ? [C - 1, o.at + i] : o.side === 2 ? [0, o.at + i] : o.side === 1 ? [o.at + i, R - 1] : [o.at + i, 0]) as [number, number]);
/** The tile just inside an opening. */
const inside = (o: Opening): [number, number] => {
  const [tx, ty] = openingTiles(o)[0]!;
  return [tx - DX[o.side]!, ty - DY[o.side]!];
};

/** Every tile that can be walked to from one, with a sword in hand: bushes do not count as in the way. */
function reach(tiles: number[], from: [number, number]): Set<number> {
  const seen = new Set<number>();
  const todo = [at(from[0], from[1])];
  while (todo.length) {
    const i = todo.pop()!;
    if (seen.has(i)) continue;
    const tile = tiles[i]!;
    if (!questWalkable(tile) && tile !== T.bush) continue;
    seen.add(i);
    const tx = i % C;
    const ty = (i - tx) / C;
    for (let d = 0; d < 4; d++) {
      const nx = tx + DX[d]!;
      const ny = ty + DY[d]!;
      if (nx >= 0 && ny >= 0 && nx < C && ny < R) todo.push(at(nx, ny));
    }
  }
  return seen;
}

type Guard = "none" | "crack" | "eye" | "island" | "gate";
interface Feature { kind: "stairs" | "doorway" | "chest"; guard: Guard; cx: number; cy: number }

/**
 * Put a feature down and say where it is come at from (its hub). A chest behind something stands
 * in a nook that opens downwards; a chest on an island has water (or a pit) below it and a post at
 * each end of the crossing.
 */
function stamp(tiles: number[], f: Feature, moat: number): [number, number] {
  const set = (tx: number, ty: number, tile: number) => { tiles[at(tx, ty)] = tile; };
  const { cx, cy } = f;
  if (f.kind !== "chest") {
    for (const [dx, dy] of [[-1, -1], [0, -1], [1, -1], [-1, 0], [1, 0]]) set(cx + dx!, cy + dy!, T.wall);
    set(cx, cy, f.kind === "stairs" ? T.stairs : T.doorway);
    if (f.guard !== "gate") return [cx, cy + 1];
    set(cx, cy + 1, T.gate);
    set(cx - 1, cy + 1, T.wall);
    set(cx + 1, cy + 1, T.wall);
    return [cx, cy + 2];
  }
  if (f.guard === "none") {
    set(cx, cy, T.chest);
    return [cx, cy + 1];
  }
  if (f.guard === "island") {
    // Down the column: post, landing, two of moat, the near bank, post. The chest is beside the landing.
    set(cx, cy - 1, T.post);
    set(cx + 1, cy - 1, T.wall);
    set(cx - 1, cy, T.wall);
    set(cx, cy, T.ground);
    set(cx + 1, cy, T.chest);
    set(cx + 2, cy, T.wall);
    for (const dy of [1, 2]) {
      set(cx - 1, cy + dy, T.wall);
      set(cx, cy + dy, moat);
      set(cx + 1, cy + dy, T.wall);
    }
    for (const dx of [-1, 0, 1]) set(cx + dx, cy + 3, T.ground);
    set(cx, cy + 4, T.post);
    return [cx, cy + 3];
  }
  for (const dy of [-1, 0, 1]) {
    set(cx - 1, cy + dy, T.wall);
    set(cx + 1, cy + dy, T.wall);
  }
  set(cx, cy - 1, T.wall);
  set(cx, cy, T.chest);
  set(cx, cy + 1, f.guard === "crack" ? T.crack : T.eye);
  set(cx, cy + 2, T.ground);
  return [cx, cy + 2];
}

/** Clear a way from one tile to another: down or up first, then across. */
function carve(tiles: number[], from: [number, number], to: [number, number], floor: number) {
  let [tx, ty] = from;
  const clear = () => {
    const tile = tiles[at(tx, ty)]!;
    if (tx > 0 && ty > 0 && tx < C - 1 && ty < R - 1 && !questWalkable(tile)) tiles[at(tx, ty)] = floor;
  };
  clear();
  while (ty !== to[1]) { ty += Math.sign(to[1] - ty); clear(); }
  while (tx !== to[0]) { tx += Math.sign(to[0] - tx); clear(); }
}

interface ScreenSpec {
  biome: QuestBiome;
  openings: Opening[];
  /** A river crossing at the top of the screen: the column of its near post. */
  river: number | null;
  feature: Omit<Feature, "cx" | "cy"> | null;
  /** How many things live here. */
  foes: string[];
  count: number;
}
interface Built { tiles: number[]; feature: Feature | null; hub: [number, number]; spawns: QuestRoom["spawns"] }

/** One screen of the overworld. Tried again until every way out can be walked to from its middle. */
function buildScreen(rand: Rand, spec: ScreenSpec): Built {
  for (let attempt = 0; ; attempt++) {
    const bare = attempt >= 40;
    const tiles = new Array<number>(C * R).fill(T.ground);
    for (let tx = 0; tx < C; tx++) for (let ty = 0; ty < R; ty++) if (tx === 0 || ty === 0 || tx === C - 1 || ty === R - 1) tiles[at(tx, ty)] = T.wall;
    if (!bare) scatter(rand, tiles, spec.biome);
    let feature: Feature | null = null;
    let hub: [number, number] = [4 + pick(rand, 8), 4 + pick(rand, 3)];
    if (spec.river !== null) hub = [spec.river, 6];
    const island = spec.feature?.guard === "island";
    if (spec.feature) feature = { ...spec.feature, cx: bare ? 7 : 3 + pick(rand, 9), cy: island ? 2 + pick(rand, 3) : bare ? 4 : 2 + pick(rand, 4) };
    // Where the feature's hub will be, so the ways in can be cleared to it before it is put down.
    if (feature) hub = [feature.cx, feature.cy + (feature.kind !== "chest" ? (feature.guard === "gate" ? 2 : 1) : feature.guard === "none" ? 1 : feature.guard === "island" ? 3 : 2)];
    const floor = spec.biome === "dunes" || spec.biome === "crags" ? T.path : T.ground;
    for (const o of spec.openings) carve(tiles, inside(o), hub, floor);
    if (spec.river !== null) {
      const c = spec.river;
      const set = (tx: number, ty: number, tile: number) => { tiles[at(tx, ty)] = tile; };
      for (const ty of [1, 2, 3]) { set(c - 1, ty, T.wall); set(c + 2, ty, T.wall); }
      set(c, 1, T.ground); set(c + 1, 1, T.ground);
      for (const ty of [2, 3]) { set(c, ty, T.water); set(c + 1, ty, T.water); }
      for (const tx of [c - 1, c, c + 1, c + 2]) set(tx, 4, T.ground);
      set(c, 5, T.ground); set(c, 6, T.ground);
      set(c + 1, 5, T.post);
    }
    if (feature) stamp(tiles, feature, T.water);
    for (const o of spec.openings) for (const [tx, ty] of openingTiles(o)) tiles[at(tx, ty)] = o.fill;
    if (spec.river !== null) tiles[at(spec.river, 0)] = T.post;
    const got = reach(tiles, hub);
    const river = spec.river;
    const ok = spec.openings.every((o) => (river !== null && o.side === 3 && o.at === river + 1 ? true : got.has(at(...inside(o))))) && (river === null || (got.has(at(river, 4)) && got.has(at(river + 1, 4))));
    if (!ok && !bare) continue;
    if (!ok) throw new Error("A screen that cannot be crossed");
    // Somewhere for each thing that lives here: open ground, away from the ways in.
    const spots = shuffle(rand, [...got].filter((i) => {
      const tx = i % C;
      const ty = (i - tx) / C;
      if (tiles[i] === T.bush || tx < 2 || ty < 2 || tx > C - 3 || ty > R - 3) return false;
      if (Math.abs(tx - hub[0]) + Math.abs(ty - hub[1]) < 3) return false;
      return spec.openings.every((o) => { const [ix, iy] = inside(o); return Math.abs(tx - ix) + Math.abs(ty - iy) >= 4; });
    }));
    const spawns = spots.slice(0, spec.count).map((i) => ({ kind: spec.foes[pick(rand, spec.foes.length)]!, tx: i % C, ty: (i - (i % C)) / C }));
    return { tiles, feature, hub, spawns };
  }
}

/** Trees, rocks, bushes, flowers and ponds, by the kind of country. */
function scatter(rand: Rand, tiles: number[], biome: QuestBiome) {
  const [blobs, bushes, soft, ponds] = biome === "meadow" ? [4, 10, 9, pick(rand, 2)] : biome === "dunes" ? [5, 5, 14, 0] : biome === "marsh" ? [3, 7, 5, 2 + pick(rand, 2)] : [7, 2, 8, 0];
  const inner = (): [number, number] => [1 + pick(rand, C - 2), 1 + pick(rand, R - 2)];
  for (let b = 0; b < blobs; b++) {
    let [tx, ty] = inner();
    for (let n = 1 + pick(rand, 4); n > 0; n--) {
      tiles[at(tx, ty)] = T.wall;
      const d = pick(rand, 4);
      tx = Math.min(C - 2, Math.max(1, tx + DX[d]!));
      ty = Math.min(R - 2, Math.max(1, ty + DY[d]!));
    }
  }
  for (let p = 0; p < ponds; p++) {
    const [tx, ty] = [2 + pick(rand, C - 5), 2 + pick(rand, R - 5)];
    for (const [dx, dy] of [[0, 0], [1, 0], [0, 1], [1, 1]]) tiles[at(tx + dx!, ty + dy!)] = T.water;
    if (rand() < 0.5) tiles[at(tx + 2, ty)] = T.water;
  }
  for (let b = 0; b < bushes; b++) {
    const [tx, ty] = inner();
    if (tiles[at(tx, ty)] === T.ground) tiles[at(tx, ty)] = T.bush;
  }
  for (let s = 0; s < soft; s++) {
    const [tx, ty] = inner();
    if (tiles[at(tx, ty)] === T.ground) tiles[at(tx, ty)] = biome === "dunes" || biome === "crags" ? T.path : T.flower;
  }
}

const blankRoom = (id: number, area: QuestRoom["area"], biome: QuestBiome, den: number, gx: number, gy: number): QuestRoom => ({
  id, area, biome, den, gx, gy, tiles: [], exits: [-1, -1, -1, -1], out: null, warps: {}, loot: {}, spawns: [], folk: [], wares: [], shut: false,
});

/** A cave: four walls and a way out at the bottom. */
function caveRoom(id: number, out: QuestSpot): QuestRoom {
  const room = blankRoom(id, "cave", "cave", -1, 0, 0);
  room.tiles = new Array<number>(C * R).fill(T.ground);
  for (let tx = 0; tx < C; tx++) for (let ty = 0; ty < R; ty++) if (tx === 0 || ty === 0 || tx === C - 1 || ty === R - 1) room.tiles[at(tx, ty)] = T.wall;
  room.tiles[at(7, R - 1)] = T.ground;
  room.tiles[at(8, R - 1)] = T.ground;
  for (const [tx, ty] of [[2, 2], [13, 2]]) room.tiles[at(tx!, ty!)] = T.torch;
  room.out = out;
  return room;
}

/** The gaps a den's room has in its walls, by side, and the tile just inside each. */
const GAPS: [number, number][][] = [[[C - 1, 5]], [[7, R - 1], [8, R - 1]], [[0, 5]], [[7, 0], [8, 0]]];
const GAP_IN: [number, number][] = [[C - 2, 5], [7, R - 2], [1, 5], [7, 1]];

interface DenCell { gx: number; gy: number; parent: DenCell | null; side: number; depth: number; room: number; chests: { loot: string; guard: Guard }[]; fill: number[] }

/** A den: a tree of rooms grown from its door, with its locks, keys, prize and boss. */
function buildDen(rand: Rand, tier: number, rooms: QuestRoom[], out: QuestSpot): number[] {
  const den = QUEST_DENS[tier]!;
  const G = QUEST_DEN;
  const cells: DenCell[] = [];
  const cellAt = (gx: number, gy: number) => cells.find((c) => c.gx === gx && c.gy === gy);
  const first: DenCell = { gx: pick(rand, G.cols), gy: G.rows - 1, parent: null, side: -1, depth: 0, room: 0, chests: [], fill: [T.ground, T.ground, T.ground, T.ground] };
  cells.push(first);
  let last = first;
  const free = (c: DenCell) => [0, 1, 2, 3].filter((d) => {
    const gx = c.gx + DX[d]!;
    const gy = c.gy + DY[d]!;
    return gx >= 0 && gy >= 0 && gx < G.cols && gy < G.rows && !cellAt(gx, gy);
  });
  while (cells.length < den.rooms) {
    let base = rand() < 0.7 ? last : cells[pick(rand, cells.length)]!;
    if (!free(base).length) base = shuffle(rand, cells.filter((c) => free(c).length))[0]!;
    const sides = free(base);
    const side = sides[pick(rand, sides.length)]!;
    last = { gx: base.gx + DX[side]!, gy: base.gy + DY[side]!, parent: base, side, depth: base.depth + 1, room: 0, chests: [], fill: [T.ground, T.ground, T.ground, T.ground] };
    cells.push(last);
  }
  const under = (c: DenCell, root: DenCell) => { for (let p: DenCell | null = c; p; p = p.parent) if (p === root) return true; return false; };
  const boss = cells.reduce((best, c) => (c.depth >= best.depth && c !== first ? c : best), cells[1]!);
  const path: DenCell[] = [];
  for (let p: DenCell | null = boss; p; p = p.parent) path.unshift(p);
  // A room takes two chests at most.
  const put = (from: DenCell[], loot: string, guard: Guard) => {
    const roomy = (list: DenCell[]) => shuffle(rand, list.filter((c) => c.chests.length < 2));
    const cell = roomy(from.filter((c) => c !== first))[0] ?? roomy(from)[0] ?? roomy(cells.filter((c) => c !== boss))[0]!;
    cell.chests.push({ loot, guard });
  };
  boss.parent!.fill[boss.side] = T.bossDoor;
  // The locks, nearest first. Each key is on the near side of its own lock and the far side of the one before.
  const k = path.length - 1;
  let before: DenCell | null = null;
  if (k >= 2) {
    const one = 1 + pick(rand, k - 1);
    const stops = tier >= 1 && one < k - 1 ? [one, one + 1 + pick(rand, k - 1 - one)] : [one];
    for (const stop of stops) {
      const door = path[stop]!;
      door.parent!.fill[door.side] = T.lock;
      put(cells.filter((c) => !under(c, door) && (!before || under(c, before))), "key", "none");
      before = door;
    }
  }
  const others = cells.filter((c) => c !== boss);
  put(others, den.item, "none");
  put(others, "bosskey", den.guard);
  put(others.filter((c) => c !== first), "coins20", "none");

  const ids: number[] = [];
  for (const cell of cells) {
    cell.room = rooms.length;
    ids.push(cell.room);
    rooms.push(blankRoom(cell.room, "den", den.biome, tier, cell.gx, cell.gy));
  }
  for (const cell of cells) {
    const room = rooms[cell.room]!;
    const gaps: Opening[] = [];
    if (cell.parent) {
      room.exits[(cell.side + 2) % 4] = cell.parent.room;
      gaps.push({ side: (cell.side + 2) % 4, at: 0, width: 0, fill: T.ground });
    }
    for (const child of cells) if (child.parent === cell) {
      room.exits[child.side] = child.room;
      gaps.push({ side: child.side, at: 0, width: 0, fill: cell.fill[child.side]! });
    }
    if (cell === first) {
      room.out = out;
      gaps.push({ side: 1, at: 0, width: 0, fill: T.ground });
    }
    const isBoss = cell === boss;
    for (let attempt = 0; ; attempt++) {
      const tiles = new Array<number>(C * R).fill(T.ground);
      for (let tx = 0; tx < C; tx++) for (let ty = 0; ty < R; ty++) if (tx === 0 || ty === 0 || tx === C - 1 || ty === R - 1) tiles[at(tx, ty)] = T.wall;
      const set = (tx: number, ty: number, tile: number) => { tiles[at(tx, ty)] = tile; };
      const plan = isBoss || attempt >= 12 ? 0 : pick(rand, 5);
      if (plan === 0) for (const [tx, ty] of [[1, 1], [C - 2, 1], [1, R - 2], [C - 2, R - 2]]) set(tx!, ty!, T.torch);
      if (plan === 1) for (const [tx, ty] of [[5, 4], [10, 4], [5, 7], [10, 7]]) set(tx!, ty!, T.block);
      if (plan === 2) for (let tx = 6; tx <= 9; tx++) for (let ty = 4; ty <= 6; ty++) set(tx, ty, T.pit);
      if (plan === 3) for (const tx of [3, 4, 5, 10, 11, 12]) set(tx, 7, T.block);
      if (plan === 4) for (const tx of [5, 10]) for (const ty of [6, 7, 8]) set(tx, ty, T.pit);
      const hubs: [number, number][] = [];
      cell.chests.forEach((chest, n) => {
        const f: Feature = { kind: "chest", guard: chest.guard, cx: n === 0 ? 3 : 11, cy: 2 };
        hubs.push(stamp(tiles, f, T.pit));
        room.loot[at(chest.guard === "island" ? f.cx + 1 : f.cx, f.cy)] = chest.loot;
      });
      for (const g of gaps) for (const [tx, ty] of GAPS[g.side]!) set(tx, ty, g.fill);
      const got = reach(tiles, GAP_IN[gaps[0]!.side]!);
      if (!gaps.every((g) => got.has(at(...GAP_IN[g.side]!))) || !hubs.every((h) => got.has(at(...h)))) continue;
      room.tiles = tiles;
      if (isBoss) {
        room.spawns = [{ kind: `boss:${den.boss}`, tx: 8, ty: 4 }];
        room.shut = true;
      } else if (cell !== first) {
        const spots = shuffle(rand, [...got].filter((i) => { const tx = i % C; const ty = (i - tx) / C; return tx >= 3 && ty >= 2 && tx <= C - 4 && ty <= R - 3 && !hubs.some((h) => h[0] === tx && h[1] === ty); }));
        room.spawns = spots.slice(0, 2 + pick(rand, 2) + (tier > 1 ? 1 : 0)).map((i) => ({ kind: den.foes[pick(rand, den.foes.length)]!, tx: i % C, ty: (i - (i % C)) / C }));
        room.shut = room.spawns.length > 0 && rand() < 0.45;
      }
      break;
    }
  }
  return ids;
}

/** The land for a seed. */
export function buildQuestWorld(seed: number): QuestWorld {
  const rand = mulberry32((seed ^ 0x2b7a) >>> 0);
  const O = QUEST_OVER;
  const count = O.cols * O.rows;
  const id = (gx: number, gy: number) => gy * O.cols + gx;
  const region = (gx: number, gy: number) => (gy >= 2 ? (gx < 3 ? 0 : 1) : gx < 3 ? 2 : 3);
  const openings: Opening[][] = Array.from({ length: count }, () => []);
  const links: number[][] = Array.from({ length: count }, () => []);
  const join = (a: number, b: number, side: number, where: number, width: number, fill: number) => {
    openings[a]!.push({ side, at: where, width, fill });
    openings[b]!.push({ side: (side + 2) % 4, at: where, width, fill: T.ground });
    links[a]!.push(b);
    links[b]!.push(a);
  };
  // Inside a region every screen can be walked to: a tree of ways through, and some more besides.
  const group = Array.from({ length: count }, (_, i) => i);
  const find = (i: number): number => (group[i] === i ? i : (group[i] = find(group[i]!)));
  const pairs: [number, number, number][] = [];
  for (let gy = 0; gy < O.rows; gy++) for (let gx = 0; gx < O.cols; gx++) {
    if (gx + 1 < O.cols && region(gx, gy) === region(gx + 1, gy)) pairs.push([id(gx, gy), id(gx + 1, gy), 0]);
    if (gy + 1 < O.rows && region(gx, gy) === region(gx, gy + 1)) pairs.push([id(gx, gy), id(gx, gy + 1), 1]);
  }
  for (const [a, b, side] of shuffle(rand, pairs)) {
    const tree = find(a) !== find(b);
    if (!tree && rand() >= 0.45) continue;
    group[find(a)] = find(b);
    join(a, b, side, side === 0 ? 2 + pick(rand, 6) : 2 + pick(rand, 11), 2, T.ground);
  }
  // Between regions there is one way each, and something in it.
  const crackY = 2 + pick(rand, 3);
  const riverX = pick(rand, 3);
  const riverC = 3 + pick(rand, 9);
  const eyeY = pick(rand, 2);
  const crackA = id(2, crackY);
  const riverA = id(riverX, 2);
  const eyeA = id(2, eyeY);
  join(crackA, id(3, crackY), 0, 2 + pick(rand, 6), 2, T.crack);
  join(riverA, id(riverX, 1), 3, riverC + 1, 1, T.ground);
  join(eyeA, id(3, eyeY), 0, 2 + pick(rand, 6), 2, T.eye);

  const far = (from: number, among: number[]) => {
    const dist = new Map([[from, 0]]);
    const todo = [from];
    for (let n = 0; n < todo.length; n++) for (const next of links[todo[n]!]!) if (!dist.has(next) && region(next % O.cols, Math.floor(next / O.cols)) === region(from % O.cols, Math.floor(from / O.cols))) { dist.set(next, dist.get(todo[n]!)! + 1); todo.push(next); }
    return among.reduce((best, s) => ((dist.get(s) ?? 0) > (dist.get(best) ?? 0) ? s : best), among[0]!);
  };
  const start = id(1, 3);
  const inRegion = (r: number, without: number[]) => shuffle(rand, Array.from({ length: count }, (_, i) => i).filter((i) => region(i % O.cols, Math.floor(i / O.cols)) === r && !without.includes(i)));
  type Want = Omit<Feature, "cx" | "cy"> & { what: string };
  const wants = new Map<number, Want>();
  const place = (pool: number[], want: Want, screen = pool[0]) => {
    if (screen === undefined) return;
    pool.splice(pool.indexOf(screen), 1);
    wants.set(screen, want);
  };
  wants.set(start, { kind: "stairs", guard: "none", what: "elder" });
  const meadow = inRegion(0, [start, crackA, riverA]);
  place(meadow, { kind: "doorway", guard: "none", what: "den0" }, far(start, meadow));
  place(meadow, { kind: "stairs", guard: "none", what: "shop0" });
  place(meadow, { kind: "chest", guard: "crack", what: "vessel" });
  place(meadow, { kind: "chest", guard: "none", what: "coins20" });
  const dunes = inRegion(1, []);
  place(dunes, { kind: "doorway", guard: "none", what: "den1" }, far(id(3, crackY), dunes));
  place(dunes, { kind: "stairs", guard: "none", what: "shop1" });
  place(dunes, { kind: "chest", guard: "island", what: "vessel" });
  place(dunes, { kind: "chest", guard: "none", what: "coins50" });
  const marsh = inRegion(2, [eyeA]);
  place(marsh, { kind: "doorway", guard: "none", what: "den2" }, far(id(riverX, 1), marsh));
  place(marsh, { kind: "chest", guard: "eye", what: "vessel" });
  place(marsh, { kind: "chest", guard: "none", what: "coins50" });
  const crags = inRegion(3, [id(3, eyeY)]);
  place(crags, { kind: "doorway", guard: "gate", what: "den3" }, far(id(3, eyeY), crags));
  place(crags, { kind: "chest", guard: "none", what: "coins50" });

  const rooms: QuestRoom[] = [];
  const built: Built[] = [];
  for (let i = 0; i < count; i++) {
    const gx = i % O.cols;
    const gy = Math.floor(i / O.cols);
    const r = region(gx, gy);
    const room = blankRoom(i, "over", OVER_BIOMES[r]!, -1, gx, gy);
    const want = wants.get(i);
    const b = buildScreen(rand, {
      biome: room.biome,
      // The first screen is hedged in: the way on is cut with the sword from the elder's cave.
      openings: openings[i]!.map((o) => (i === start && o.fill === T.ground ? { ...o, fill: T.bush } : o)),
      river: i === riverA ? riverC : null,
      feature: want ? { kind: want.kind, guard: want.guard } : null,
      foes: OVER_FOES[r]!,
      count: i === start ? 0 : 2 + pick(rand, 3),
    });
    room.tiles = b.tiles;
    room.spawns = b.spawns;
    for (const o of openings[i]!) room.exits[o.side] = i + DX[o.side]! + DY[o.side]! * O.cols;
    if (want && b.feature && want.kind === "chest") room.loot[at(want.guard === "island" ? b.feature.cx + 1 : b.feature.cx, b.feature.cy)] = want.what;
    rooms.push(room);
    built.push(b);
  }
  const world: QuestWorld = { rooms, start: { room: start, tx: built[start]!.hub[0], ty: built[start]!.hub[1] }, dens: [] };
  // Under the land: the caves, then the dens in the order they are played.
  const order = [...wants.entries()].filter(([, w]) => w.kind !== "chest").sort((a, b) => (a[1].what < b[1].what ? -1 : 1));
  for (const [screen, want] of order) {
    const f = built[screen]!.feature!;
    const out: QuestSpot = { room: screen, tx: f.cx, ty: f.cy + 1 };
    if (want.kind === "stairs") {
      const cave = caveRoom(rooms.length, out);
      rooms.push(cave);
      rooms[screen]!.warps[at(f.cx, f.cy)] = { room: cave.id, tx: 7, ty: R - 2 };
      if (want.what === "elder") {
        cave.tiles[at(5, 4)] = T.chest;
        cave.loot[at(5, 4)] = "sword";
        cave.folk.push({ kind: "elder", tx: 9, ty: 3, say: "Quagg stole our three Stripes! Take this blade, Zub, and bring them home." });
      } else {
        const second = want.what === "shop1";
        cave.folk.push({ kind: "keeper", tx: 7, ty: 2, say: second ? "Bru's Dune Goods. Walk into what you want." : "Bru's Goods. Walk into what you want." });
        cave.wares = [{ key: "potion", cost: 10 }, { key: "bombs", cost: 15 }, { key: "arrows", cost: 15 }, second ? { key: "blade", cost: 150 } : { key: "vessel", cost: 100 }].map((w, n) => ({ ...w, tx: 3 + n * 3, ty: 5 }));
      }
    } else {
      const tier = Number(want.what.slice(3));
      const ids = buildDen(rand, tier, rooms, out);
      rooms[screen]!.warps[at(f.cx, f.cy)] = { room: ids[0]!, tx: 7, ty: R - 2 };
      world.dens.push({ name: QUEST_DENS[tier]!.name, boss: QUEST_DENS[tier]!.boss, entrance: ids[0]!, rooms: ids });
    }
  }
  return world;
}

const kept = new Map<number, QuestWorld>();
/** The land for a seed, built once and kept: a game asks for it every tick. */
export function questWorld(seed: number): QuestWorld {
  let world = kept.get(seed);
  if (!world) {
    if (kept.size >= 8) kept.delete(kept.keys().next().value!);
    world = buildQuestWorld(seed);
    kept.set(seed, world);
  }
  return world;
}
