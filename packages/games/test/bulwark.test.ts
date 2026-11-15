// Bulwark's own rules: the road it lays, what a command does and that it is done once, what each
// tower is good at, what gets through the gate, the clock between waves, and where the gold comes from.
import { describe, expect, it } from "vitest";
import { BULWARK_FIELD, BULWARK_GRID, BULWARK_PRESETS, BULWARK_TOWERS, bulwark, type BulwarkInput, type BulwarkState, type TowerKind } from "../src/index.js";

const STANDARD = BULWARK_PRESETS[0]!;
const { cols: COLS, rows: ROWS, cell: CELL } = BULWARK_GRID;
let n = 0;
const cmd = (c: BulwarkInput["cmd"], col = 0, row = 0, kind: TowerKind = "dart"): BulwarkInput => ({ n: ++n, cmd: c, col, row, kind });
const kinds = (s: BulwarkState) => s.events.map((e) => e.kind);
const game = (seats = 1, rules = STANDARD, seed = 1) => bulwark.newGame(rules, seats, seed);
/** A square that isn't road, as near the road's `at`th cell as there is. */
function beside(s: BulwarkState, at: number): [number, number] {
  const cell = s.road[at]!;
  const col = cell % COLS;
  const row = Math.floor(cell / COLS);
  for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1]] as const) {
    const c = col + dc;
    const r = row + dr;
    if (c >= 0 && c < COLS && r >= 0 && r < ROWS && !s.road.includes(r * COLS + c) && !s.towers.some((t) => t.col === c && t.row === r)) return [c, r];
  }
  throw new Error("no room beside the road");
}
/** A creep put straight on the road, `d` units along it. */
const creep = (s: BulwarkState, kind: "grunt" | "flyer" | "brute" | "swarm" | "boss" = "grunt", d = 0, hp = 100) => {
  const c = { id: s.nextId++, kind, d, hp, max: hp, slow: 0, slowTo: 10, bounty: 5 };
  s.creeps.push(c);
  return c;
};
/** Hold the waves off, so a test has the road to itself. */
const quiet = (s: BulwarkState) => {
  bulwark.step(s, []);
  s.next!.at = 1e9;
  return s;
};

describe("Tower of Ryan (bulwark)", () => {
  it("lays a different road every game, unbroken from the top of the field to the bottom, with room to build", () => {
    const seen = new Set<string>();
    for (let seed = 1; seed <= 200; seed++) {
      const s = game(1, STANDARD, seed);
      seen.add(s.road.join(","));
      expect(Math.floor(s.road[0]! / COLS)).toBe(0);
      expect(Math.floor(s.road.at(-1)! / COLS)).toBe(ROWS - 1);
      expect(new Set(s.road).size).toBe(s.road.length);
      for (let i = 1; i < s.road.length; i++) {
        const a = s.road[i - 1]!;
        const b = s.road[i]!;
        expect(Math.abs((a % COLS) - (b % COLS)) + Math.abs(Math.floor(a / COLS) - Math.floor(b / COLS))).toBe(1);
      }
      expect(s.road.length).toBeGreaterThan(30);
      expect(COLS * ROWS - s.road.length).toBeGreaterThan(100);
    }
    expect(seen.size).toBeGreaterThan(150);
    expect(game(1, STANDARD, 7).road).toEqual(game(1, STANDARD, 7).road);
  });

  it("builds where there is room and gold, and says why not otherwise", () => {
    const s = quiet(game());
    const [col, row] = beside(s, 5);
    bulwark.step(s, [cmd("build", col, row, "dart")]);
    expect(s.towers).toHaveLength(1);
    expect(s.bank).toBe(STANDARD.gold - 50);
    expect(kinds(s)).toContain("built");
    bulwark.step(s, [cmd("build", col, row, "frost")]);
    expect(s.events.find((e) => e.kind === "nope")?.text).toBe("Something is there");
    const road = s.road[3]!;
    bulwark.step(s, [cmd("build", road % COLS, Math.floor(road / COLS))]);
    expect(s.events.find((e) => e.kind === "nope")?.text).toBe("That's the road");
    s.bank = 10;
    const [c2, r2] = beside(s, 12);
    bulwark.step(s, [cmd("build", c2, r2, "tesla")]);
    expect(s.events.find((e) => e.kind === "nope")?.text).toBe("Not enough gold");
    expect(s.towers).toHaveLength(1);
    expect(s.bank).toBe(10);
  });

  it("carries a command out once, however long it is held", () => {
    const s = quiet(game());
    s.bank = 5000;
    const [col, row] = beside(s, 5);
    bulwark.step(s, [cmd("build", col, row)]);
    const up = cmd("upgrade", col, row);
    for (let t = 0; t < 30; t++) bulwark.step(s, [up]);
    expect(s.towers[0]!.level).toBe(2);
    bulwark.step(s, [cmd("upgrade", col, row)]);
    expect(s.towers[0]!.level).toBe(3);
    bulwark.step(s, [cmd("upgrade", col, row)]);
    expect(s.events.find((e) => e.kind === "nope")?.text).toBe("As good as it gets");
    // Sold for 70% of what went into it: 50 + 50 + 110.
    bulwark.step(s, [cmd("sell", col, row)]);
    expect(s.towers).toHaveLength(0);
    expect(s.bank).toBe(5000 - 210 + 147);
    bulwark.step(s, [cmd("sell", col, row)]);
    expect(s.events.find((e) => e.kind === "nope")?.text).toBe("Nothing there");
  });

  it("walks the road cell by cell, and what reaches the end costs lives", () => {
    const s = quiet(game());
    const c = creep(s, "grunt", 0, 1e6);
    const view = () => bulwark.view(s).things.find((t) => t.id === c.id)!;
    bulwark.step(s, []);
    const first = s.road[0]!;
    expect(view().x).toBe((first % COLS) * CELL + CELL / 2);
    expect(view().y).toBeLessThan(0);
    // Every step it takes is along the road: never off it by more than half a cell.
    for (let t = 0; t < 600; t++) {
      bulwark.step(s, []);
      const { x, y } = view();
      if (y < 0 || y > BULWARK_FIELD.height) continue;
      expect(s.road.includes(Math.floor(y / CELL) * COLS + Math.floor(x / CELL))).toBe(true);
    }
    c.d = (s.road.length + 1) * CELL - 5;
    creep(s, "boss", (s.road.length + 1) * CELL - 5);
    bulwark.step(s, []);
    expect(s.lives).toBe(STANDARD.lives - 1 - 10);
    expect(s.leaked).toBe(2);
    expect(kinds(s)).toContain("leak");
  });

  it("ends when the last life is gone", () => {
    const s = quiet(game(2, BULWARK_PRESETS.find((p) => p.id === "lastgate")!));
    s.scores = [300, 800];
    creep(s, "grunt", (s.road.length + 1) * CELL - 5);
    bulwark.step(s, []);
    const sum = bulwark.summary(s);
    expect(sum.over).toBe(true);
    expect(sum.order).toEqual([1, 0]);
    expect(sum.score).toBe(1100);
    expect(bulwark.view(s).banner).toBe("The gate has fallen");
    expect(bulwark.view(s).build!.next).toBeNull();
    expect(bulwark.bot(s, 0, {})).toEqual(bulwark.idle);
  });

  it("pays a bounty to the bank and points to whoever's tower did it", () => {
    const s = quiet(game(2));
    const [col, row] = beside(s, 6);
    bulwark.step(s, [bulwark.idle, cmd("build", col, row, "dart")]);
    const bank = s.bank;
    creep(s, "grunt", 6 * CELL + CELL, 5);
    for (let t = 0; t < 30 && s.creeps.length; t++) bulwark.step(s, []);
    expect(s.creeps).toHaveLength(0);
    expect(s.bank).toBe(bank + 5);
    expect(s.scores).toEqual([0, 50]);
    expect(s.kills).toBe(1);
  });

  it("gives each tower its own job", () => {
    const at = 8;
    const d = at * CELL + CELL;
    const withTower = (kind: TowerKind) => {
      const s = quiet(game());
      s.bank = 1000;
      const [col, row] = beside(s, at);
      bulwark.step(s, [cmd("build", col, row, kind)]);
      return s;
    };
    // A mortar hits everything near where it lands, and nothing in the air.
    let s = withTower("mortar");
    const crowd = [creep(s, "grunt", d, 1000), creep(s, "grunt", d + 100, 1000), creep(s, "grunt", d - 100, 1000)];
    const flyer = creep(s, "flyer", 2000, 1000);
    bulwark.step(s, []);
    expect(crowd.every((c) => c.hp < 1000)).toBe(true);
    expect(flyer.hp).toBe(1000);
    expect(kinds(s)).toContain("shell");
    s = withTower("mortar");
    creep(s, "flyer", 2000, 1000);
    for (let t = 0; t < 200; t++) bulwark.step(s, []);
    expect(kinds(s)).not.toContain("shell");
    expect(s.creeps.every((c) => c.hp === 1000) || s.creeps.length === 0).toBe(true);

    // Frost slows everything in reach, and barely hurts.
    s = withTower("frost");
    const cold = creep(s, "grunt", d, 1000);
    const far = creep(s, "grunt", 0, 1000);
    bulwark.step(s, []);
    expect(cold.slow).toBeGreaterThan(0);
    expect(far.slow).toBe(0);
    expect(bulwark.view(s).things.find((t) => t.id === cold.id)!.mark).toBe("slowed");
    const before = cold.d;
    bulwark.step(s, []);
    expect(cold.d - before).toBeLessThan(14);
    expect(cold.hp).toBeGreaterThan(990);

    // Armour takes most of a dart, and none of the lightning.
    s = withTower("dart");
    const tank = creep(s, "brute", d, 1000);
    bulwark.step(s, []);
    expect(1000 - tank.hp).toBe(1);
    s = withTower("tesla");
    const tank2 = creep(s, "brute", d, 1000);
    const near = creep(s, "grunt", d + 200, 1000);
    bulwark.step(s, []);
    expect(1000 - tank2.hp).toBeGreaterThanOrEqual(11);
    expect(near.hp).toBeLessThan(1000);
    expect(s.events.filter((e) => e.kind === "zap").length).toBe(2);
    expect(s.events.find((e) => e.kind === "zap")!.to).toBeDefined();

    // A sniper picks the strongest, not the first.
    s = withTower("sniper");
    const weak = creep(s, "grunt", d + 300, 50);
    const strong = creep(s, "grunt", d, 900);
    bulwark.step(s, []);
    expect(strong.hp).toBe(810);
    expect(weak.hp).toBe(50);
  });

  it("brings the next wave on a clock, shows what is in it, and pays for sending it early", () => {
    const s = game();
    bulwark.step(s, []);
    const next = bulwark.view(s).build!.next!;
    expect(next.wave).toBe(1);
    expect(next.inTicks).toBe(bulwark.rate * 20);
    expect(next.preview).toMatch(/^\d+ grunts$/);
    expect(next.bonus).toBeGreaterThan(0);
    const bank = s.bank;
    bulwark.step(s, [cmd("send")]);
    expect(s.wave).toBe(1);
    expect(s.bank).toBeGreaterThan(bank);
    expect(s.scores[0]).toBeGreaterThan(0);
    expect(kinds(s)).toEqual(expect.arrayContaining(["send", "wave"]));
    expect(bulwark.view(s).build!.next).toBeNull();
    // Left alone, it comes by itself, and nothing is paid for that.
    const t = game();
    for (let i = 0; i <= bulwark.rate * 20; i++) bulwark.step(t, []);
    expect(t.wave).toBe(1);
    expect(t.bank).toBe(STANDARD.gold);
    bulwark.step(t, []);
    expect(t.creeps.length).toBeGreaterThan(0);
    // The clock for the wave after starts once the last of this one has come on.
    while (t.queue.length) bulwark.step(t, []);
    bulwark.step(t, []);
    expect(bulwark.view(t).build!.next).toMatchObject({ wave: 2 });
  });

  it("pays for each wave held, and interest on what is in the bank", () => {
    const wave = (rules = STANDARD) => {
      const s = game(1, rules);
      bulwark.step(s, []);
      s.wave = 3;
      s.next = { wave: 4, at: s.tick + 1, spawns: [{ at: 0, kind: "grunt" }] };
      s.bank = 1000;
      bulwark.step(s, []);
      return s;
    };
    const s = wave();
    // 20 + 5 a wave for holding wave 3, then 4% of what is banked.
    expect(s.bank).toBe(1000 + 35 + Math.floor(1035 / 25));
    expect(kinds(s)).toEqual(expect.arrayContaining(["pay", "interest"]));
    expect(s.scores[0]).toBe(150);
    expect(wave({ ...STANDARD, interest: false }).bank).toBe(1035);
    // Interest stops at 150.
    const rich = game();
    bulwark.step(rich, []);
    rich.wave = 3;
    rich.next = { wave: 4, at: rich.tick + 1, spawns: [] };
    rich.bank = 100_000;
    bulwark.step(rich, []);
    expect(rich.bank).toBe(100_000 + 35 + 150);
  });

  it("gets tougher every wave, with a boss every tenth", () => {
    const hpAt = (waveNo: number) => {
      const s = game();
      bulwark.step(s, []);
      s.wave = waveNo - 1;
      s.next = { wave: waveNo, at: s.tick + 1, spawns: [{ at: 0, kind: "grunt" }] };
      bulwark.step(s, []);
      bulwark.step(s, []);
      return s.creeps[0]!.max;
    };
    expect(hpAt(1)).toBe(60);
    expect(hpAt(10)).toBeGreaterThan(hpAt(5));
    expect(hpAt(30)).toBeGreaterThan(hpAt(10) * 4);
    const s = game();
    bulwark.step(s, []);
    s.wave = 9;
    s.next = null;
    s.queue = [];
    bulwark.step(s, []);
    expect(bulwark.view(s).build!.next!.preview).toContain("1 boss");
    s.next!.at = s.tick + 1;
    bulwark.step(s, []);
    expect(bulwark.view(s).stage).toBe("Wave 10 · Boss");
    expect(bulwark.summary(s).phase).toBe("boss");
  });

  it("describes the ground and the shop for whoever draws it", () => {
    const s = quiet(game());
    const [col, row] = beside(s, 5);
    bulwark.step(s, [cmd("build", col, row, "sniper")]);
    const build = bulwark.view(s).build!;
    expect(build).toMatchObject({ cols: COLS, rows: ROWS, cell: CELL, bank: STANDARD.gold - 140, lives: STANDARD.lives });
    expect(build.shop.map((i) => i.key)).toEqual(BULWARK_TOWERS);
    expect(build.shop.every((i) => i.cost > 0 && i.range > 0 && i.hint && i.label)).toBe(true);
    expect(build.closed).toEqual(s.road);
    expect(build.road).toHaveLength(s.road.length + 2);
    expect(build.built).toEqual([{ id: s.towers[0]!.id, col, row, key: "sniper", label: "Sniper", level: 1, maxLevel: 3, upgrade: 140, sell: 98, range: 3200, seat: 0 }]);
    const thing = bulwark.view(s).things.find((t) => t.kind === "tower:sniper")!;
    expect(thing).toMatchObject({ level: 1, range: 3200, seat: 0 });
  });

  it("is the same game however many are playing: one bank, one gate", () => {
    const solo = game(1);
    const four = game(4);
    expect(four.road).toEqual(solo.road);
    expect(four.bank).toBe(solo.bank);
    for (let t = 0; t < bulwark.rate * 30; t++) {
      bulwark.step(solo, []);
      bulwark.step(four, []);
    }
    expect(four.creeps.map((c) => [c.kind, c.d, c.max])).toEqual(solo.creeps.map((c) => [c.kind, c.d, c.max]));
  });
});
