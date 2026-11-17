// Zubra Quest's own rules. The shared arcade tests already fly it with computer players; these
// check the land (every seed's can be finished, walked tile by tile) and the things a quest turns
// on: the sword and the brush, chests and keys, the three tools and what each opens, the bosses,
// the Stripes, the gate and the end.
import { describe, expect, it } from "vitest";
import { QUEST_COLS as C, QUEST_DENS, QUEST_ROWS as R, QUEST_SLEEP, QUEST_TILE as T, QUEST_UNIT as U, buildQuestWorld, questOpen, questWalkable, questWorld, zubraQuest, type QuestInput, type QuestRoom, type QuestState, type QuestWorld } from "../src/index.js";

const DX = [1, 0, -1, 0];
const DY = [0, 1, 0, -1];
const centre = (t: number) => t * U + U / 2;
const idle = zubraQuest.idle;
const fresh = (seed = 5, rules: unknown = null) => zubraQuest.newGame(zubraQuest.normalize(rules), 1, seed);
const run = (s: QuestState, ticks: number, input: Partial<QuestInput> = {}) => { for (let t = 0; t < ticks; t++) zubraQuest.step(s, [{ ...idle, ...input }]); };
/** Tap a button: down for a tick, then up. */
const tap = (s: QuestState, input: Partial<QuestInput>) => { run(s, 1, input); run(s, 1); };

/**
 * Walk a land the way a player could, without playing it: every tile that can be stood on, and
 * everything that can be opened from there with what has been found so far, until nothing more
 * opens. Says whether Quagg's room was reached, and what was found on the way.
 */
function solve(world: QuestWorld) {
  const tiles = world.rooms.map((room) => room.tiles.slice());
  const stood = world.rooms.map(() => new Set<number>());
  const bag = { sword: false, bombs: false, hook: false, bow: false, keys: [0, 0, 0, 0], big: [0, 0, 0, 0], relics: 0, vessels: 0, won: false };
  const beaten = new Set<number>();
  const order: string[] = [];
  const openAll = (room: number, i: number, kind: number) => {
    const todo = [i];
    while (todo.length) {
      const j = todo.pop()!;
      if (tiles[room]![j] !== kind) continue;
      tiles[room]![j] = T.ground;
      for (let d = 0; d < 4; d++) { const tx = (j % C) + DX[d]!; const ty = Math.trunc(j / C) + DY[d]!; if (tx >= 0 && ty >= 0 && tx < C && ty < R) todo.push(ty * C + tx); }
    }
  };
  const can = (tile: number) => questWalkable(tile) || (bag.sword && tile === T.bush);
  // Tiles still to look round from. Finding or opening anything means looking round from all of them again.
  let todo: [number, number][] = [];
  const again = () => { todo = stood.flatMap((set, room) => [...set].map((i) => [room, i] as [number, number])); };
  const stand = (room: number, tx: number, ty: number) => {
    const i = ty * C + tx;
    if (stood[room]!.has(i)) return;
    if (!can(tiles[room]![i]!)) throw new Error(`room ${room} is entered at (${tx},${ty}), which cannot be stood on`);
    stood[room]!.add(i);
    todo.push([room, i]);
  };
  stand(world.start.room, world.start.tx, world.start.ty);
  while (todo.length) {
    const [id, i] = todo.pop()!;
    const room = world.rooms[id]!;
    const mine = tiles[id]!;
    const tx = i % C;
    const ty = Math.trunc(i / C);
    if (room.spawns.some((spawn) => spawn.kind.startsWith("boss:")) && !beaten.has(id)) {
      beaten.add(id);
      order.push(`boss${room.den}`);
      if (room.den === 3) bag.won = true; else { bag.relics++; bag.vessels++; }
      again();
    }
    const warp = room.warps[i];
    if (warp && (mine[i] === T.stairs || mine[i] === T.doorway)) stand(warp.room, warp.tx, warp.ty);
    for (let d = 0; d < 4; d++) {
      const nx = tx + DX[d]!;
      const ny = ty + DY[d]!;
      if (nx < 0 || ny < 0 || nx >= C || ny >= R) {
        // Off the edge: the next room, where the game would put the hero down.
        if (d === 1 && room.out) stand(room.out.room, room.out.tx, room.out.ty);
        else if (room.exits[d]! >= 0) {
          const next = world.rooms[room.exits[d]!]!;
          if (next.area === "den") stand(next.id, d === 0 ? 1 : d === 2 ? C - 2 : tx, d === 1 ? 1 : d === 3 ? R - 2 : 5);
          else stand(next.id, d === 0 ? 0 : d === 2 ? C - 1 : tx, d === 1 ? 0 : d === 3 ? R - 1 : ty);
        }
        continue;
      }
      const j = ny * C + nx;
      const tile = mine[j]!;
      if (can(tile)) { stand(id, nx, ny); continue; }
      if (tile === T.chest) {
        mine[j] = T.opened;
        const loot = room.loot[j];
        if (!loot) throw new Error(`a chest in room ${id} with nothing in it`);
        if (loot === "sword" || loot === "bombs" || loot === "hook" || loot === "bow") bag[loot] = true;
        else if (loot === "key") bag.keys[room.den]!++;
        else if (loot === "bosskey") bag.big[room.den] = 1;
        else if (loot === "vessel") bag.vessels++;
        order.push(loot);
        again();
      } else if (tile === T.lock && bag.keys[room.den]! > 0) { bag.keys[room.den]!--; openAll(id, j, T.lock); again(); }
      else if (tile === T.bossDoor && bag.big[room.den]) { openAll(id, j, T.bossDoor); again(); }
      else if (tile === T.gate && bag.relics >= 3) { openAll(id, j, T.gate); again(); }
      else if (tile === T.crack && bag.bombs) { openAll(id, j, T.crack); again(); }
      // An arrow, and the hookshot, go on in a line over anything open.
      let ax = nx;
      let ay = ny;
      let far = 1;
      while (ax >= 0 && ay >= 0 && ax < C && ay < R && questOpen(mine[ay * C + ax]!) && far < 7) { ax += DX[d]!; ay += DY[d]!; far++; }
      if (ax < 0 || ay < 0 || ax >= C || ay >= R) continue;
      const end = mine[ay * C + ax]!;
      if (end === T.eye && bag.bow) { openAll(id, ay * C + ax, T.eye); again(); }
      if (end === T.post && bag.hook && far > 1 && questWalkable(mine[(ay - DY[d]!) * C + ax - DX[d]!]!)) stand(id, ax - DX[d]!, ay - DY[d]!);
    }
  }
  return { bag, order, stood, tiles };
}

describe("the land", () => {
  it("can be finished, for every seed, and only in the order it is meant to be", () => {
    for (let seed = 1; seed <= 150; seed++) {
      const world = buildQuestWorld(seed);
      const { bag, order, tiles } = solve(world);
      expect(bag.won, `seed ${seed}: ${order.join(" ")}`).toBe(true);
      // The sword first; each den's prize before its boss; the dens in turn; all three Stripes before the keep.
      const when = (what: string) => order.indexOf(what);
      expect(when("sword")).toBe(0);
      expect(when("bombs")).toBeLessThan(when("boss0"));
      expect(when("boss0")).toBeGreaterThan(-1);
      expect(when("bombs")).toBeLessThan(when("hook"));
      expect(when("hook")).toBeLessThan(when("bow"));
      expect(when("boss2")).toBeLessThan(when("boss3"));
      expect(bag.relics).toBe(3);
      // Every chest in the land can be opened: nothing is walled off for good.
      const left = world.rooms.flatMap((room, n) => Object.keys(room.loot).filter((i) => tiles[n]![Number(i)] === T.chest));
      expect(left, `seed ${seed}`).toEqual([]);
    }
  }, 120_000);

  it("is the same land for the same seed, and a different one for another", () => {
    expect(buildQuestWorld(42)).toEqual(buildQuestWorld(42));
    expect(buildQuestWorld(42)).not.toEqual(buildQuestWorld(43));
    expect(questWorld(42)).toBe(questWorld(42));
  });

  it("has every room the right size, with its chests where its loot is", () => {
    const world = buildQuestWorld(9);
    expect(world.dens.map((den) => den.name)).toEqual(QUEST_DENS.map((den) => den.name));
    for (const room of world.rooms) {
      expect(room.tiles).toHaveLength(C * R);
      for (const i of Object.keys(room.loot)) expect(room.tiles[Number(i)]).toBe(T.chest);
      for (const i of Object.keys(room.warps)) expect([T.stairs, T.doorway]).toContain(room.tiles[Number(i)]);
      for (const spawn of room.spawns) if (!spawn.kind.startsWith("boss:")) expect(questWalkable(room.tiles[spawn.ty * C + spawn.tx]!)).toBe(true);
    }
  });
});

/** Put the hero down in a room, as if he had walked in. */
function put(s: QuestState, room: number, tx: number, ty: number, face = 1) {
  s.room = room;
  const land = questWorld(s.seed).rooms[room]!;
  s.tiles = land.tiles.slice();
  s.foes = [];
  s.shots = [];
  s.drops = [];
  s.fight = 0;
  s.shut = 0;
  s.freeze = 0;
  s.hero.x = centre(tx);
  s.hero.y = centre(ty);
  s.hero.face = face;
  s.hero.inv = 0;
}
/** A room of the land that has a tile of a kind, the tile, and a tile to stand on next to it with the way to face it. */
function find(s: QuestState, kind: number, rooms: (room: QuestRoom) => boolean = () => true) {
  for (const room of questWorld(s.seed).rooms) if (rooms(room)) for (let i = 0; i < room.tiles.length; i++) if (room.tiles[i] === kind) for (let d = 0; d < 4; d++) {
    const tx = (i % C) - DX[d]!;
    const ty = Math.trunc(i / C) - DY[d]!;
    if (tx > 0 && ty > 0 && tx < C - 1 && ty < R - 1 && [T.ground, T.path, T.flower].includes(room.tiles[ty * C + tx]! as 0)) return { room: room.id, i, tx, ty, face: d };
  }
  throw new Error(`No tile ${kind} to stand beside`);
}
const realm = (s: QuestState) => zubraQuest.view(s).realm!;

describe("Zubra Quest", () => {
  it("starts in the meadow with nothing, hedged in until the sword is found", () => {
    const s = fresh();
    const v = zubraQuest.view(s);
    expect(v.realm!.area).toBe("over");
    expect(v.realm!.biome).toBe("meadow");
    expect(v.realm!.hero.items).toEqual([]);
    expect(v.realm!.hero.health).toBe(6);
    expect(v.realm!.tiles).toHaveLength(C * R);
    expect(v.things.find((t) => t.kind === "hero")).toBeTruthy();
    // Every way off the first screen is brush.
    const edge = s.tiles.filter((tile, i) => { const tx = i % C; const ty = Math.trunc(i / C); return (tx === 0 || ty === 0 || tx === C - 1 || ty === R - 1) && tile !== T.wall; });
    expect(edge.length).toBeGreaterThan(0);
    expect(edge.every((tile) => tile === T.bush)).toBe(true);
    // A swing without a sword cuts nothing.
    const bush = find(s, T.bush, (room) => room.id === s.room);
    put(s, bush.room, bush.tx, bush.ty, bush.face);
    tap(s, { a: true });
    expect(s.tiles[bush.i]).toBe(T.bush);
  });

  it("a computer player finds the sword and gets out of the first screen", () => {
    const s = fresh(12);
    for (let t = 0; t < 60 * 120 && s.seen.length < 4; t++) zubraQuest.step(s, [zubraQuest.bot(s, 0, { skill: 1, sloppy: 0 }, () => 0.5)]);
    expect(realm(s).hero.items).toContain("sword");
    expect(s.seen.length).toBeGreaterThanOrEqual(4);
  });

  it("walks, stops at walls, and goes from screen to screen", () => {
    const s = fresh();
    s.hero.items = 1;
    const x = s.hero.x;
    run(s, 10, { dx: 1 });
    expect(s.hero.x).toBeGreaterThan(x);
    expect(realm(s).hero.facing).toBe(0);
    // Into a wall: nowhere.
    const wall = find(s, T.wall, (room) => room.id === s.room);
    put(s, wall.room, wall.tx, wall.ty, wall.face);
    run(s, 40, { dx: DX[wall.face]!, dy: DY[wall.face]! });
    expect(Math.trunc(s.hero.x / U)).toBe(wall.tx);
    expect(Math.trunc(s.hero.y / U)).toBe(wall.ty);
    // Out through a gap in the edge: the next screen, on its near edge, and it counts as seen.
    const land = questWorld(s.seed);
    const here = land.rooms[land.start.room]!;
    const side = here.exits.findIndex((next) => next >= 0);
    const gap = here.tiles.findIndex((tile, i) => tile === T.bush && (side === 0 ? i % C === C - 1 : side === 2 ? i % C === 0 : side === 1 ? Math.trunc(i / C) === R - 1 : Math.trunc(i / C) === 0));
    put(s, here.id, gap % C, Math.trunc(gap / C), side);
    s.tiles[gap] = T.ground;
    run(s, 30, { dx: DX[side]!, dy: DY[side]! });
    expect(s.room).toBe(here.exits[side]);
    expect(s.seen).toContain(s.room);
    expect(questWalkable(s.tiles[Math.trunc(s.hero.y / U) * C + Math.trunc(s.hero.x / U)]!)).toBe(true);
  });

  it("cuts brush with the sword, and the brush is back when the screen is come back to", () => {
    const s = fresh();
    s.hero.items = 1;
    const bush = find(s, T.bush, (room) => room.id === s.room);
    put(s, bush.room, bush.tx, bush.ty, bush.face);
    tap(s, { a: true });
    expect(s.tiles[bush.i]).toBe(T.ground);
    expect(questWorld(s.seed).rooms[s.room]!.tiles[bush.i]).toBe(T.bush);
    expect(Object.keys(s.perm)).toEqual([]);
  });

  it("opens a chest by walking into it, once, and keeps what was in it", () => {
    const s = fresh();
    const chest = find(s, T.chest, (room) => room.area === "cave");
    put(s, chest.room, chest.tx, chest.ty, chest.face);
    run(s, 20, { dx: DX[chest.face]!, dy: DY[chest.face]! });
    expect(s.tiles[chest.i]).toBe(T.opened);
    expect(realm(s).hero.items).toEqual(["sword"]);
    expect(realm(s).message).toMatch(/Horn Blade/);
    expect(s.perm[`${chest.room}:${chest.i}`]).toBe(T.opened);
  });

  it("needs a key for a lock, the big key for the last door, and three Stripes for the gate", () => {
    const s = fresh(3);
    for (const [kind, give] of [[T.lock, (den: number) => { s.hero.keys[den] = 1; }], [T.bossDoor, (den: number) => { s.hero.big[den] = 1; }], [T.gate, () => { s.hero.relics = 3; }]] as const) {
      const door = find(s, kind);
      const den = questWorld(s.seed).rooms[door.room]!.den;
      put(s, door.room, door.tx, door.ty, door.face);
      run(s, 20, { dx: DX[door.face]!, dy: DY[door.face]! });
      expect(s.tiles[door.i], `tile ${kind} without what opens it`).toBe(kind);
      expect(realm(s).message).toBeTruthy();
      give(den);
      run(s, 2, { dx: DX[door.face]!, dy: DY[door.face]! });
      expect(s.tiles[door.i], `tile ${kind} with what opens it`).toBe(T.ground);
      expect(s.perm[`${door.room}:${door.i}`]).toBe(T.ground);
      if (kind === T.lock) expect(s.hero.keys[den]).toBe(0);
    }
  });

  it("opens cracked rock with a bomb, which hurts whoever stands too near", () => {
    const s = fresh(3);
    s.hero.items = 1 | 4;
    s.hero.bombs = 2;
    const crack = find(s, T.crack);
    put(s, crack.room, crack.tx, crack.ty, crack.face);
    tap(s, { b: true, tool: 1 });
    expect(s.hero.bombs).toBe(1);
    expect(s.shots.map((shot) => shot.kind)).toEqual(["bomb"]);
    run(s, 100);
    expect(s.tiles[crack.i]).toBe(T.ground);
    expect(s.perm[`${crack.room}:${crack.i}`]).toBe(T.ground);
    expect(s.hero.hp).toBeLessThan(6);
  });

  it("shuts a watching stone with an arrow", () => {
    const s = fresh(3);
    s.hero.items = 1 | 2;
    s.hero.arrows = 3;
    const eye = find(s, T.eye);
    put(s, eye.room, eye.tx, eye.ty, eye.face);
    tap(s, { b: true, tool: 0 });
    run(s, 10);
    expect(s.hero.arrows).toBe(2);
    expect(s.tiles[eye.i]).toBe(T.ground);
    // With none left the bow does nothing.
    s.hero.arrows = 0;
    s.hero.cool = 0;
    tap(s, { b: true, tool: 0 });
    expect(s.shots).toEqual([]);
  });

  it("crosses water on the hookshot, there and back", () => {
    const s = fresh(3);
    s.hero.items = 1 | 8;
    // The river between the meadow and the marsh: stand on the near bank, under the far post.
    const land = questWorld(s.seed);
    const river = land.rooms.find((room) => room.area === "over" && room.tiles.slice(0, C).includes(T.post))!;
    const c = river.tiles.indexOf(T.post);
    put(s, river.id, c, 4, 3);
    tap(s, { b: true, tool: 2 });
    run(s, 40);
    expect([Math.trunc(s.hero.x / U), Math.trunc(s.hero.y / U)]).toEqual([c, 1]);
    // And from the far bank, the post on the near side brings him back.
    put(s, river.id, c + 1, 1, 1);
    s.hero.cool = 0;
    tap(s, { b: true, tool: 2 });
    run(s, 40);
    expect([Math.trunc(s.hero.x / U), Math.trunc(s.hero.y / U)]).toEqual([c + 1, 4]);
    // Pointed at nothing, it comes back and he stays where he is.
    put(s, river.id, c, 4, 1);
    s.hero.cool = 0;
    tap(s, { b: true, tool: 2 });
    run(s, 60);
    expect(s.hook).toBeNull();
    expect(Math.trunc(s.hero.y / U)).toBe(4);
  });

  it("fights: a sword kills a slime, a slime hurts, and a knight's front turns a blade", () => {
    const s = fresh();
    s.hero.items = 1;
    put(s, s.room, 5, 5, 0);
    const foe = (kind: string, tx: number, d: number) => { s.foes = [{ id: 900, kind, x: centre(tx), y: centre(5), hp: kind === "knight" ? 6 : 2, t: 500, mode: 4, d, n: 500, vx: 0, vy: 0, inv: 0, kx: 0, ky: 0, kt: 0 }]; s.fight = 1; };
    foe("slime", 6, 1);
    const score = s.score;
    tap(s, { a: true });
    run(s, 12);
    expect(s.foes).toEqual([]);
    expect(s.score).toBeGreaterThan(score);
    expect(s.kills).toBe(1);
    // Touching one costs half a heart and throws him back.
    put(s, s.room, 5, 5, 0);
    foe("slime", 5, 1);
    run(s, 2);
    expect(s.hero.hp).toBe(5);
    expect(s.hero.inv).toBeGreaterThan(0);
    // A knight facing him is not hurt by the sword; a bomb does not care which way it faces.
    put(s, s.room, 5, 5, 0);
    foe("knight", 6, 2);
    s.foes[0]!.t = 500;
    tap(s, { a: true });
    expect(s.foes[0]!.hp).toBe(6);
  });

  it("falls and gets back up where he came in, unless the continues have run out", () => {
    const s = fresh();
    s.hero.hp = 1;
    put(s, s.room, 5, 5, 0);
    s.foes = [{ id: 900, kind: "slime", x: centre(5), y: centre(5), hp: 2, t: 500, mode: 4, d: 1, n: 0, vx: 0, vy: 0, inv: 0, kx: 0, ky: 0, kt: 0 }];
    run(s, 2);
    expect(s.deaths).toBe(1);
    expect(s.phase).toBe("play");
    expect(s.hero.hp).toBe(6);
    const land = questWorld(s.seed);
    expect([s.room, Math.trunc(s.hero.x / U)]).toEqual([land.start.room, land.start.tx]);
    const hard = fresh(5, { id: "hero", continues: 1 });
    for (let n = 0; n < 2; n++) {
      hard.hero.hp = 1;
      hard.hero.inv = 0;
      hard.freeze = 0;
      hard.foes = [{ id: 900 + n, kind: "slime", x: hard.hero.x, y: hard.hero.y, hp: 2, t: 500, mode: 4, d: 1, n: 0, vx: 0, vy: 0, inv: 0, kx: 0, ky: 0, kt: 0 }];
      run(hard, 2);
    }
    expect(hard.phase).toBe("lost");
    expect(zubraQuest.summary(hard).over).toBe(true);
  });

  it("shuts the doors of a room until it is cleared, and remembers that it was", () => {
    const s = fresh(3);
    s.hero.items = 1;
    const land = questWorld(s.seed);
    const room = land.rooms.find((r) => r.area === "den" && r.shut && !r.spawns.some((spawn) => spawn.kind.startsWith("boss:")))!;
    const from = land.rooms.find((r) => r.exits.includes(room.id))!;
    const side = from.exits.indexOf(room.id);
    put(s, from.id, side === 0 ? C - 1 : side === 2 ? 0 : 7, side === 1 ? R - 1 : side === 3 ? 0 : 5, side);
    s.tiles[Math.trunc(s.hero.y / U) * C + Math.trunc(s.hero.x / U)] = T.ground;
    run(s, 30, { dx: DX[side]!, dy: DY[side]! });
    expect(s.room).toBe(room.id);
    expect(s.tiles).toContain(T.shutter);
    expect(s.foes.length).toBe(room.spawns.length);
    for (const f of [...s.foes]) { f.hp = 0; }
    s.foes = [];
    run(s, 20);
    expect(s.tiles).not.toContain(T.shutter);
    expect(s.cleared).toContain(room.id);
  });

  it("gives a Stripe and a heart for a den's boss, and carries the hero back up", () => {
    const s = fresh(3);
    s.hero.items = 1;
    const land = questWorld(s.seed);
    const den = land.dens[0]!;
    const lair = land.rooms.find((r) => r.den === 0 && r.spawns.some((spawn) => spawn.kind === "boss:maw"))!;
    put(s, lair.id, 8, 8, 3);
    s.foes = [{ id: 900, kind: "boss:maw", x: centre(8), y: centre(4), hp: 1, t: 100, mode: 2, d: 1, n: 0, vx: 0, vy: 0, inv: 0, kx: 0, ky: 0, kt: 0 }];
    s.fight = 1;
    expect(zubraQuest.view(s).boss).toEqual({ name: "Bramble Maw", health: 50 });
    s.shots = [{ id: 901, kind: "bomb", x: centre(8), y: centre(5), vx: 0, vy: 0, t: 1, d: 0 }];
    run(s, 2);
    expect(s.foes).toEqual([]);
    expect(s.drops.map((drop) => drop.kind).sort()).toEqual(["item:stripe", "item:vessel"]);
    const vessel = s.drops.find((drop) => drop.kind === "item:vessel")!;
    s.hero.x = vessel.x;
    s.hero.y = vessel.y;
    run(s, 80);
    expect(s.hero.max).toBe(8);
    const stripe = s.drops.find((drop) => drop.kind === "item:stripe")!;
    s.hero.x = stripe.x;
    s.hero.y = stripe.y;
    run(s, 2);
    expect(s.hero.relics).toBe(1);
    expect(s.room).toBe(land.rooms[den.entrance]!.out!.room);
    expect(s.cleared).toContain(lair.id);
  });

  it("is won when Quagg is beaten", () => {
    const s = fresh(3);
    s.hero.items = 1;
    const land = questWorld(s.seed);
    const lair = land.rooms.find((r) => r.spawns.some((spawn) => spawn.kind === "boss:quagg"))!;
    put(s, lair.id, 8, 8, 3);
    s.foes = [{ id: 900, kind: "boss:quagg", x: centre(8), y: centre(4), hp: 1, t: 100, mode: 0, d: 1, n: 0, vx: 0, vy: 0, inv: 0, kx: 0, ky: 0, kt: 0 }];
    s.shots = [{ id: 901, kind: "bomb", x: centre(8), y: centre(5), vx: 0, vy: 0, t: 1, d: 0 }];
    const score = s.score;
    run(s, 2);
    expect(s.phase).toBe("won");
    expect(s.score).toBeGreaterThan(score + 5000);
    expect(zubraQuest.summary(s).scoreLine).toMatch(/Quagg beaten/);
    expect(realm(s).outcome).toBe("won");
  });

  it("every boss can be hurt, and only when it should be", () => {
    for (const [kind, safe, open] of [["boss:maw", 0, 2], ["boss:tusker", 0, 3], ["boss:gloom", 2, 0]] as const) {
      const s = fresh(3);
      s.hero.items = 1;
      put(s, s.room, 5, 5, 0);
      const make = (mode: number) => { s.foes = [{ id: 900, kind, x: centre(6) + 120, y: centre(5), hp: 20, t: 500, mode, d: 1, n: 0, vx: 0, vy: 0, inv: 0, kx: 0, ky: 0, kt: 0 }]; s.hero.inv = 600; s.hero.swing = 0; s.hero.x = centre(5); s.hero.y = centre(5); s.hero.kt = 0; };
      make(safe);
      tap(s, { a: true });
      expect(s.foes[0]!.hp, `${kind} when it is safe`).toBe(20);
      make(open);
      tap(s, { a: true });
      expect(s.foes[0]!.hp, `${kind} when it is open`).toBe(18);
    }
  });

  it("sells at Bru's: only what can be used, only what can be paid for", () => {
    const s = fresh(3);
    const land = questWorld(s.seed);
    const shop = land.rooms.find((room) => room.wares.length)!;
    const ware = (key: string) => shop.wares.find((w) => w.key === key)!;
    const walkTo = (key: string) => { put(s, shop.id, ware(key).tx, ware(key).ty + 1, 3); s.shopT = 0; s.msgT = 0; s.hero.y = centre(ware(key).ty) + 100; run(s, 1); };
    s.hero.coins = 5;
    s.hero.hp = 2;
    walkTo("potion");
    expect(s.hero.hp).toBe(2);
    expect(realm(s).message).toMatch(/acorns/);
    s.hero.coins = 200;
    walkTo("potion");
    expect(s.hero.hp).toBe(s.hero.max);
    expect(s.hero.coins).toBe(190);
    walkTo("bombs");
    expect(s.hero.coins).toBe(190);
    expect(realm(s).message).toMatch(/no use/);
    const once = shop.wares.find((w) => w.key === "vessel" || w.key === "blade")!;
    s.hero.items = 1;
    walkTo(once.key);
    run(s, 80);
    expect(s.hero.coins).toBe(190 - once.cost);
    walkTo(once.key);
    expect(s.hero.coins).toBe(190 - once.cost);
    expect(zubraQuest.view(s).things.some((t) => t.kind === `ware:${once.key}`)).toBe(false);
  });

  it("goes to sleep when left alone, and not while anyone is playing", () => {
    const s = fresh();
    run(s, QUEST_SLEEP - 1);
    expect(s.phase).toBe("play");
    run(s, 1, { dx: 1 });
    run(s, QUEST_SLEEP - 1);
    expect(s.phase).toBe("play");
    run(s, 1);
    expect(s.phase).toBe("asleep");
    expect(realm(s).outcome).toBe("asleep");
  });

  it("holds a button for one swing, not a swing a tick", () => {
    const s = fresh();
    s.hero.items = 1;
    run(s, 60, { a: true });
    expect(s.events.filter((e) => e.kind === "swing")).toEqual([]);
    const swings = (() => { const again = fresh(); again.hero.items = 1; let n = 0; for (let t = 0; t < 60; t++) { zubraQuest.step(again, [{ ...idle, a: true }]); n += again.events.filter((e) => e.kind === "swing").length; } return n; })();
    expect(swings).toBe(1);
  });
});
