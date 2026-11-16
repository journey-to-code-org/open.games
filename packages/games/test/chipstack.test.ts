// Chip Stack's own rules: what a tap is worth, what buying does to the price and the income, that a
// command is done once, heat, the golden chip, cashing out for stars, and the clock that ends it.
import { describe, expect, it } from "vitest";
import { CHIPSTACK_PRESETS, chipStack, type ChipStackInput, type ChipStackState } from "../src/index.js";

const CLASSIC = CHIPSTACK_PRESETS[0]!;
const PURIST = CHIPSTACK_PRESETS.find((p) => p.id === "purist")!;
let n = 0;
const cmd = (c: ChipStackInput["cmd"], item = 0): ChipStackInput => ({ n: ++n, cmd: c, item });
const game = (rules = PURIST, seats = 1) => chipStack.newGame(rules, seats, 1);
const chips = (s: ChipStackState) => Math.floor(s.bank / 60);
const kinds = (s: ChipStackState) => s.events.map((e) => e.kind);
const market = (s: ChipStackState) => chipStack.view(s).market!;
const give = (s: ChipStackState, amount: number) => (s.bank += amount * 60);

describe("Chip Stack", () => {
  it("earns a chip a tap to begin with, and no more than fifteen taps a second count", () => {
    const s = game();
    chipStack.step(s, [cmd("tap")]);
    expect(chips(s)).toBe(1);
    expect(kinds(s)).toContain("tap");
    for (let t = 0; t < 59; t++) chipStack.step(s, [cmd("tap")]);
    expect(s.taps[0]).toBe(15);
    expect(chips(s)).toBe(15);
    expect(chipStack.summary(s).score).toBe(15);
  });

  it("carries a command out once, however long it is held", () => {
    const s = game();
    give(s, 1000);
    const buy = cmd("buy", 0);
    for (let t = 0; t < 30; t++) chipStack.step(s, [buy]);
    expect(s.earners[0]!.count).toBe(1);
  });

  it("puts the price up 15% each time, and pays out what it says a second", () => {
    const s = game();
    give(s, 100);
    chipStack.step(s, [cmd("buy", 0)]);
    expect(s.earners[0]).toMatchObject({ count: 1, cost: 18 });
    chipStack.step(s, [cmd("buy", 0)]);
    expect(s.earners[0]).toMatchObject({ count: 2, cost: 21 });
    expect(market(s).perSecond).toBe(2);
    const before = s.bank;
    for (let t = 0; t < 60; t++) chipStack.step(s, []);
    // Exactly two chips in a second: the bank is in sixtieths, so nothing is rounded.
    expect(s.bank - before).toBe(2 * 60);
    s.bank = 0;
    chipStack.step(s, [cmd("buy", 1)]);
    expect(s.events.find((e) => e.kind === "nope")?.text).toBe("Not enough chips");
    expect(s.earners[1]!.count).toBe(0);
  });

  it("doubles an earner once enough are owned, and the chip you tap with each power-up", () => {
    const s = game();
    give(s, 1_000_000);
    chipStack.step(s, [cmd("boost", 0)]);
    expect(s.events.find((e) => e.kind === "nope")?.text).toBe("Needs 10 of them");
    for (let i = 0; i < 10; i++) chipStack.step(s, [cmd("buy", 0)]);
    expect(market(s).perSecond).toBe(10);
    expect(market(s).items.some((i) => i.key === "boost:0")).toBe(true);
    chipStack.step(s, [cmd("boost", 0)]);
    expect(market(s).perSecond).toBe(20);
    expect(market(s).perTap).toBe(1);
    chipStack.step(s, [cmd("power")]);
    chipStack.step(s, [cmd("power")]);
    expect(s.power).toBe(2);
    expect(market(s).perTap).toBe(4);
    // A tap is also worth a hundredth of what comes in each second.
    for (let i = 0; i < 20; i++) chipStack.step(s, [cmd("buy", 2)]);
    expect(market(s).perTap).toBe(4 + Math.floor(market(s).perSecond / 100));
  });

  it("shows the next earner once the one before is owned, so the list grows with the stack", () => {
    const s = game();
    const earners = () => market(s).items.filter((i) => i.group === "Earners").map((i) => i.label);
    expect(earners()).toEqual(["Card shark"]);
    give(s, 100);
    chipStack.step(s, [cmd("buy", 0)]);
    expect(earners()).toEqual(["Card shark", "Dice table"]);
    expect(market(s).items[0]).toMatchObject({ key: "buy:0", owned: 1, cost: 18, can: true });
  });

  it("builds heat with fast tapping, up to three times a tap, and lets it cool", () => {
    const s = game(CLASSIC);
    s.nextGolden = 1e9;
    for (let t = 0; t < 120; t++) chipStack.step(s, [cmd("tap")]);
    expect(s.heat).toBeGreaterThan(80);
    expect(market(s).perTap).toBe(2);
    s.heat = 100;
    expect(market(s).perTap).toBe(3);
    expect(market(s).badges.some((b) => b.key === "heat")).toBe(true);
    for (let t = 0; t < 220; t++) chipStack.step(s, []);
    expect(s.heat).toBe(0);
    // And not at all when the house rules say so.
    const cold = game(PURIST);
    for (let t = 0; t < 120; t++) chipStack.step(cold, [cmd("tap")]);
    expect(cold.heat).toBe(0);
  });

  it("offers a golden chip for a few seconds: a frenzy or a windfall for whoever catches it", () => {
    const seen = new Set<string>();
    for (let seed = 1; seed <= 12; seed++) {
      const s = chipStack.newGame(CLASSIC, 1, seed);
      give(s, 10_000);
      for (let i = 0; i < 10; i++) chipStack.step(s, [cmd("buy", 1)]);
      while (!s.golden) chipStack.step(s, []);
      expect(kinds(s)).toContain("golden");
      expect(chipStack.view(s).things.some((t) => t.kind === "golden")).toBe(true);
      const before = s.earned;
      const income = market(s).perSecond;
      chipStack.step(s, [cmd("catch")]);
      expect(s.golden).toBeNull();
      if (kinds(s).includes("frenzy")) {
        seen.add("frenzy");
        expect(market(s).perSecond).toBe(income * 7);
        expect(market(s).badges.find((b) => b.key === "frenzy")?.ticksLeft).toBeGreaterThan(0);
        for (let t = 0; t < 60 * 12; t++) chipStack.step(s, []);
        expect(market(s).perSecond).toBe(income);
      } else {
        seen.add("lucky");
        expect(s.earned - before).toBeGreaterThanOrEqual(income * 60 * 40);
      }
    }
    expect(seen).toEqual(new Set(["frenzy", "lucky"]));
    // Left alone it goes, and nothing is caught after that.
    const s = chipStack.newGame(CLASSIC, 1, 3);
    while (!s.golden) chipStack.step(s, []);
    for (let t = 0; t < 60 * 9; t++) chipStack.step(s, []);
    expect(s.golden).toBeNull();
    chipStack.step(s, [cmd("catch")]);
    expect(s.caught).toBe(0);
    // And none turn up when the house rules say so.
    const pure = game(PURIST);
    for (let t = 0; t < 60 * 120; t++) chipStack.step(pure, []);
    expect(pure.golden).toBeNull();
  });

  it("cashes out for stars: everything sold, and a tenth more on everything for each", () => {
    const s = game();
    chipStack.step(s, [cmd("cashout")]);
    expect(s.events.find((e) => e.kind === "nope")?.text).toContain("first");
    expect(market(s).items.some((i) => i.key === "cashout")).toBe(false);
    give(s, 5000);
    for (let i = 0; i < 10; i++) chipStack.step(s, [cmd("buy", 0)]);
    s.sinceCash = 1_000_000 * 60;
    s.earned = 1_000_000 * 60;
    expect(market(s).items.find((i) => i.key === "cashout")?.label).toBe("Cash out for 2 stars");
    chipStack.step(s, [cmd("cashout")]);
    expect(s.stars).toBe(2);
    expect(s.bank).toBe(0);
    expect(s.earners.every((e) => e.count === 0)).toBe(true);
    expect(s.earners[0]!.cost).toBe(15);
    // The score is every chip earned in the run: cashing out doesn't spend it.
    expect(chipStack.summary(s).score).toBe(1_000_000);
    give(s, 15);
    chipStack.step(s, [cmd("buy", 0)]);
    for (let i = 0; i < 9; i++) {
      give(s, 100);
      chipStack.step(s, [cmd("buy", 0)]);
    }
    // Ten card sharks at a chip a second, and two stars: twelve.
    expect(market(s).perSecond).toBe(12);
    expect(market(s).badges.find((b) => b.key === "stars")?.label).toContain("+20%");
  });

  it("ends when the clock runs out, and counts down to it", () => {
    const s = game(CHIPSTACK_PRESETS.find((p) => p.id === "sprint")!);
    expect(market(s).ticksLeft).toBe(3 * 60 * 60);
    expect(chipStack.view(s).stage).toBe("3:00");
    for (let t = 0; t < 3 * 60 * 60 - 1; t++) chipStack.step(s, t % 4 ? [] : [cmd("tap")]);
    expect(chipStack.summary(s).over).toBe(false);
    chipStack.step(s, []);
    expect(chipStack.summary(s).over).toBe(true);
    expect(chipStack.view(s).banner).toBe("Time!");
    const score = chipStack.summary(s).score;
    chipStack.step(s, [cmd("tap")]);
    expect(chipStack.summary(s).score).toBe(score);
    expect(chipStack.summary(s).scoreLine).toContain("chips");
  });

  it("shares one bank between everyone, and scores each by their own taps", () => {
    const s = game(PURIST, 3);
    chipStack.step(s, [cmd("tap"), chipStack.idle, cmd("tap")]);
    for (let t = 0; t < 4; t++) chipStack.step(s, []);
    chipStack.step(s, [chipStack.idle, chipStack.idle, cmd("tap")]);
    expect(chips(s)).toBe(3);
    const sum = chipStack.summary(s);
    expect(sum.scores).toEqual([1, 0, 2]);
    expect(sum.order).toEqual([2, 0, 1]);
    expect(sum.score).toBe(3);
  });

  it("never holds a number a machine can't keep exactly, however rich the run", () => {
    const s = game(CHIPSTACK_PRESETS.find((p) => p.id === "marathon")!);
    s.stars = 5000;
    for (const e of s.earners) e.count = 400;
    for (const e of s.earners) e.boosts = 3;
    s.power = 8;
    s.frenzy = 600;
    for (let t = 0; t < 600; t++) chipStack.step(s, [cmd("tap")]);
    for (const value of [s.bank, s.earned, s.sinceCash, s.tapped[0]!]) expect(Number.isSafeInteger(value)).toBe(true);
    expect(JSON.parse(JSON.stringify(s))).toEqual(s);
  });
});
