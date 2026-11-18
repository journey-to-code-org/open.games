// Over the Hill's own rules: the shells are shared out or chosen in turn, a hit scores what it
// took and a shell on your own head costs you, a tank may drive a few times, the wind changes with
// every shot, and the game is over when the last shell has landed.
import { mulberry32 } from "@journey-to-code/rules";
import { describe, expect, it } from "vitest";
import { GameError, HILL_SHELLS, flyField, hillBangs, hillDraft, hillKnockout, hillLand, hillMoon, hillQuick, hillStandard, hillWindy, kitGame, overTheHill as game, type FieldView, type OverTheHillState } from "../src/index.js";

const start = (rules = hillStandard, seats = 2, seed = 11) => game.newGame(rules, seats, seed);
const total = (bag: Record<string, number>) => Object.values(bag).reduce((a, b) => a + b, 0);
/** A level field with the tanks where the test wants them, and plenty of plain shot. */
function level(s: OverTheHillState, xs: number[]): OverTheHillState {
  const next = structuredClone(s);
  next.land = next.land.map(() => 400);
  next.tanks.forEach((t, i) => Object.assign(t, { x: xs[i]!, y: 400 }));
  next.bags = next.bags.map(() => ({ shot: 3 }));
  next.wind = 0;
  return next;
}
/** The power that lands a plain shot at 45° nearest to `x`, found by trying them all. */
function powerFor(s: OverTheHillState, seat: number, x: number, angle = 45): number {
  const shell = HILL_SHELLS.find((h) => h.id === "shot")!;
  let best = 1;
  let off = Infinity;
  for (let power = 1; power <= 100; power++) {
    const flight = flyField({ land: { width: 2000, step: 10, heights: s.land }, pieces: s.tanks.map((t, i) => ({ id: `tank${i}`, x: t.x, y: t.y })), wind: 0 }, { piece: `tank${seat}`, shell, angle, power });
    const landed = flight.events.at(-1)?.x ?? Infinity;
    if (Math.abs(landed - x) < off) [best, off] = [power, Math.abs(landed - x)];
  }
  return best;
}

describe("Over the Hill", () => {
  it("is on the kit, on the arcade shelf, for two to four", () => {
    expect(kitGame("overthehill")).toBe(game);
    expect(game.category).toBe("arcade");
    expect(game.seats).toEqual({ min: 2, max: 4, default: 2 });
  });

  it("hands everyone the same bag, with some plain shot in it", () => {
    for (const seats of [2, 3, 4]) {
      const s = start(hillStandard, seats, 5 + seats);
      expect(s.phase).toBe("playing");
      for (const bag of s.bags) {
        expect(bag).toEqual(s.bags[0]);
        expect(total(bag)).toBe(10);
        expect(bag.shot).toBeGreaterThanOrEqual(2);
      }
    }
    expect(total(start(hillQuick).bags[0]!)).toBe(5);
  });

  it("puts every tank on the field, on the ground, apart from the others", () => {
    for (let seed = 1; seed <= 40; seed++) for (const seats of [2, 3, 4]) {
      const s = start(hillStandard, seats, seed);
      const xs = s.tanks.map((t) => t.x);
      expect([...xs].sort((a, b) => a - b)).toEqual(xs);
      for (let i = 0; i < seats; i++) {
        expect(xs[i]! >= 60 && xs[i]! <= 1940).toBe(true);
        expect(s.tanks[i]!.y).toBe(s.land[xs[i]! / 10]);
        if (i) expect(xs[i]! - xs[i - 1]!).toBeGreaterThan(250);
      }
      // Barrels start pointing inward.
      expect(s.tanks[0]!.angle).toBeLessThan(90);
      expect(s.tanks.at(-1)!.angle).toBeGreaterThan(90);
    }
  });

  it("makes the land asked for, the same from the same seed, in whole numbers", () => {
    for (const shape of ["hills", "valley", "peak", "flats", "canyon", "steps"] as const) {
      const a = hillLand(shape, mulberry32(3));
      expect(a).toEqual(hillLand(shape, mulberry32(3)));
      expect(a).not.toEqual(hillLand(shape, mulberry32(4)));
      expect(a).toHaveLength(201);
      expect(a.every((h) => Number.isInteger(h) && h >= 120 && h <= 860)).toBe(true);
      expect(game.newGame({ ...hillStandard, land: shape }, 2, 9).shape).toBe(shape);
    }
    const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
    const [valley, peak, flats] = [hillLand("valley", mulberry32(8)), hillLand("peak", mulberry32(8)), hillLand("flats", mulberry32(8))];
    expect(mean(valley.slice(85, 115))).toBeLessThan(mean(valley.slice(0, 30)));
    expect(mean(peak.slice(85, 115))).toBeGreaterThan(mean(peak.slice(0, 30)) + 200);
    expect(Math.max(...flats) - Math.min(...flats)).toBeLessThan(300);
    const canyon = hillLand("canyon", mulberry32(8));
    expect(mean(canyon.slice(85, 115))).toBeLessThan(mean(canyon.slice(0, 30)) - 200);
  });

  it("scores a hit for what it took, and passes the turn", () => {
    let s = level(start(), [400, 1800]);
    s.turn = 0;
    const power = powerFor(s, 0, 1800);
    const after = game.apply(s, 0, { type: "fire", shell: "shot", angle: 45, power });
    expect(after.points[0]).toBeGreaterThan(15);
    expect(after.points[1]).toBe(0);
    expect(after.best[0]).toBe(after.points[0]);
    expect(after.last!.hits).toEqual([{ piece: "tank1", damage: after.points[0] }]);
    expect(after.turn).toBe(1);
    expect(after.bags[0]).toEqual({ shot: 2 });
    expect(after.narration).toBe(`{0}'s Plain Shot hits {1} for ${after.points[0]}.`);
    // The hole is there for good, and the tank that was hit has dropped into it.
    expect(after.land[180]).toBeLessThan(400);
    expect(after.tanks[1]!.y).toBe(after.land[180]);
    expect(after.tanks[0]).toMatchObject({ angle: 45, power });
    // The state it was given is as it was.
    expect(s.points).toEqual([0, 0]);
    expect(s.land[180]).toBe(400);
    s = after;
    const miss = game.apply(s, 1, { type: "fire", shell: "shot", angle: 90, power: 1 });
    expect(miss.narration).toMatch(/catches \{1\} for \d+\.$/);
  });

  it("takes a shell on your own head off your score, but never below nothing", () => {
    let s = level(start(), [400, 1800]);
    s.turn = 0;
    s.points = [12, 0];
    s = game.apply(s, 0, { type: "fire", shell: "shot", angle: 90, power: 20 });
    expect(s.last!.hits[0]!.piece).toBe("tank0");
    expect(s.last!.hits[0]!.damage).toBeGreaterThan(12);
    expect(s.points).toEqual([0, 0]);
    expect(s.best[0]).toBe(0);
  });

  it("says a miss is a miss", () => {
    const s = level(start(), [400, 1800]);
    s.turn = 0;
    const after = game.apply(s, 0, { type: "fire", shell: "shot", angle: 45, power: powerFor(s, 0, 1100) });
    expect(after.points).toEqual([0, 0]);
    expect(after.last!.hits).toEqual([]);
    expect(after.narration).toBe("{0}'s Plain Shot misses.");
  });

  it("only fires what you have, and uses it up", () => {
    const s = level(start(), [400, 1800]);
    s.turn = 0;
    s.bags[0] = { big: 1 };
    expect(() => game.apply(s, 0, { type: "fire", shell: "shot", angle: 45, power: 50 })).toThrow(GameError);
    const after = game.apply(s, 0, { type: "fire", shell: "big", angle: 45, power: 50 });
    expect(after.bags[0]).toEqual({ big: 0 });
    expect(game.view(after, 0).players[0]!.shells).toEqual([]);
  });

  it("lays the shells out to be chosen in turn, then starts the firing", () => {
    let s = start(hillDraft, 3, 21);
    expect(s.phase).toBe("draft");
    expect(total(s.pool!)).toBe(30);
    expect(s.bags.every((bag) => total(bag) === 0)).toBe(true);
    const first = s.turn;
    const v = game.view(s, first);
    expect(v.pick!.options).toEqual(v.pool);
    expect(v.aim).toBeNull();
    expect(game.view(s, (first + 1) % 3).pick).toBeNull();
    expect(() => game.apply(s, first, { type: "fire", shell: "shot", angle: 45, power: 50 })).toThrow(GameError);
    expect(() => game.apply(s, first, { type: "pick", shell: "no such shell" })).toThrow(GameError);
    const order: number[] = [];
    while (s.phase === "draft") {
      order.push(s.turn);
      s = game.apply(s, s.turn, { type: "pick", shell: game.view(s, s.turn).pick!.options[0]!.shell });
    }
    expect(order).toHaveLength(30);
    expect(order.slice(0, 6)).toEqual([first, (first + 1) % 3, (first + 2) % 3, first, (first + 1) % 3, (first + 2) % 3]);
    expect(s.pool).toBeNull();
    expect(s.bags.map(total)).toEqual([10, 10, 10]);
    expect(s.turn).toBe(first);
    expect(game.view(s, first).aim).not.toBeNull();
    expect(() => game.apply(s, first, { type: "pick", shell: "shot" })).toThrow(GameError);
  });

  it("lets a tank drive a few times without using its turn, where there is room", () => {
    let s = level(start({ ...hillStandard, moves: 2 }), [400, 1800]);
    s.turn = 0;
    expect(game.view(s, 0).aim!.move).toEqual({ left: 2, ways: [-1, 1] });
    s = game.apply(s, 0, { type: "move", way: 1 });
    expect(s.tanks[0]).toMatchObject({ x: 520, y: 400, moves: 1 });
    expect(s.turn).toBe(0);
    s = game.apply(s, 0, { type: "move", way: -1 });
    expect(s.tanks[0]!.x).toBe(400);
    expect(game.view(s, 0).aim!.move).toEqual({ left: 0, ways: [] });
    expect(() => game.apply(s, 0, { type: "move", way: 1 })).toThrow("no moves left");
    // Not off the field, and not up against another tank.
    const edge = level(start(), [100, 250]);
    edge.turn = 0;
    expect(game.view(edge, 0).aim!.move!.ways).toEqual([]);
    expect(() => game.apply(edge, 0, { type: "move", way: -1 })).toThrow("no room");
    // A game with no moves doesn't offer any.
    const none = start({ ...hillStandard, moves: 0 });
    expect(game.view(none, none.turn).aim!.move).toBeNull();
  });

  it("drives onto whatever ground is there", () => {
    const s = level(start(), [400, 1800]);
    s.turn = 0;
    for (let i = 50; i <= 54; i++) s.land[i] = 400 + (i - 50) * 30;
    for (let i = 55; i < 201; i++) s.land[i] = 520;
    const after = game.apply(s, 0, { type: "move", way: 1 });
    expect(after.tanks[0]!.y).toBe(after.land[52]);
  });

  it("has no wind unless asked, and then one that changes", () => {
    let calm = start();
    expect(calm.wind).toBe(0);
    expect(game.view(calm, 0).info.join()).not.toMatch(/wind/i);
    let s = start(hillWindy, 2, 3);
    const winds = new Set<number>();
    while (s.phase === "playing") {
      winds.add(s.wind);
      expect(s.wind >= -5 && s.wind <= 5).toBe(true);
      expect(game.view(s, 0).info.some((line) => /wind/i.test(line))).toBe(true);
      s = game.apply(s, s.turn, { type: "fire", shell: game.view(s, s.turn).aim!.shells[0]!.shell, angle: 90, power: 100 });
    }
    expect(winds.size).toBeGreaterThan(5);
    calm = game.apply(calm, calm.turn, { type: "fire", shell: "shot", angle: 60, power: 40 });
    expect(calm.wind).toBe(0);
    // A gale blows harder than a breeze ever does.
    let gale = start({ ...hillWindy, wind: "gale" }, 2, 3);
    let hardest = 0;
    while (gale.phase === "playing") {
      hardest = Math.max(hardest, Math.abs(gale.wind));
      gale = game.apply(gale, gale.turn, { type: "fire", shell: game.view(gale, gale.turn).aim!.shells[0]!.shell, angle: 90, power: 100 });
    }
    expect(hardest).toBeGreaterThan(5);
    expect(hardest).toBeLessThanOrEqual(10);
  });

  it("ends when the last shell has landed: most points wins, and level is a tie", () => {
    let s = level(start(hillQuick), [400, 1800]);
    s.bags = [{ shot: 1 }, { shot: 1 }];
    s.turn = 0;
    s = game.apply(s, 0, { type: "fire", shell: "shot", angle: 45, power: powerFor(s, 0, 1800) });
    expect(s.phase).toBe("playing");
    s = game.apply(s, 1, { type: "fire", shell: "shot", angle: 135, power: 3 });
    expect(s.phase).toBe("finished");
    expect(s.winners).toEqual([0]);
    expect(game.summary(s)).toMatchObject({ over: true, winners: [0], order: [0, 1], scoreLine: `${s.points[0]} to 0` });
    const v = game.view(s, 1);
    expect(v.over).toEqual({ winners: [0], title: s.over });
    expect(v.over!.title).toMatch(/^\{0\} wins with \d+!$/);
    expect(v.result!.rows.map((r) => r.label)).toEqual(["Best shot", "Points"]);
    expect(v.aim).toBeNull();
    expect(() => game.apply(s, 0, { type: "fire", shell: "shot", angle: 45, power: 50 })).toThrow("over");

    let t = level(start(hillQuick, 3), [300, 1000, 1700]);
    t.bags = [{ shot: 1 }, { shot: 1 }, { shot: 1 }];
    t.turn = 0;
    for (const seat of [0, 1, 2]) t = game.apply(t, seat, { type: "fire", shell: "shot", angle: 90, power: 100 });
    expect(t.winners).toEqual([0, 1, 2]);
    expect(t.over).toBe("All square at 0.");
  });

  it("gives a computer player a shot that lands near somebody, and an answer at once when asked for one", () => {
    const s = level(start(), [400, 1800]);
    s.turn = 0;
    const dice = mulberry32(2);
    const move = game.bot(s, 0, { skill: 1, sloppy: 0 }, dice)!;
    expect(move.type).toBe("fire");
    const after = game.apply(s, 0, move);
    const burst = flyField({ land: { width: 2000, step: 10, heights: s.land }, pieces: [{ id: "tank0", x: 400, y: 400 }, { id: "tank1", x: 1800, y: 400 }], wind: 0 }, { piece: "tank0", shell: HILL_SHELLS[0]!, angle: after.last!.angle, power: after.last!.power }).events.at(-1)!;
    expect(Math.abs(burst.x - 1800)).toBeLessThan(260);
    const quick = game.bot(s, 0, { skill: 0, sloppy: 0 }, mulberry32(2), { ms: 10 })!;
    expect(quick.type).toBe("fire");
    expect(game.bot(s, 1, {}, dice)).toBeNull();
    expect(game.heavy!(s, 0)).toBe(true);
    expect(game.heavy!(s, 1)).toBe(false);
    // Choosing a shell is quick, and takes one that is there.
    const d = start(hillDraft);
    expect(game.heavy!(d, d.turn)).toBe(false);
    const pick = game.bot(d, d.turn, {}, dice)!;
    expect(pick.type === "pick" && d.pool![pick.shell]! > 0).toBe(true);
  });

  it("has shells that each do something of their own", () => {
    expect(new Set(HILL_SHELLS.map((s) => s.id)).size).toBe(HILL_SHELLS.length);
    expect(new Set(HILL_SHELLS.map((s) => s.name)).size).toBe(HILL_SHELLS.length);
    for (const shell of HILL_SHELLS) expect(shell.blurb.length > 10 && shell.blurb.length < 70 && shell.often > 0, shell.id).toBe(true);
    const views = game.view(start(), 0).shells;
    expect(views.map((s) => s.id)).toEqual(HILL_SHELLS.map((s) => s.id));
    expect(JSON.stringify(views)).not.toMatch(/often|"kind"/);
    expect(HILL_SHELLS.length).toBeGreaterThanOrEqual(30);
    // Every kind of bag has enough in it to be worth choosing.
    for (const kind of ["classic", "bang", "trick", "earth"] as const) expect(HILL_SHELLS.filter((s) => s.kind === kind).length).toBeGreaterThanOrEqual(6);
  });

  it("fills the bags from the mix asked for, with plain shot besides", () => {
    const kinds = Object.fromEntries(HILL_SHELLS.map((s) => [s.id, s.kind]));
    for (const [mix, kind] of [["classic", "classic"], ["bangs", "bang"], ["tricks", "trick"], ["earth", "earth"]] as const) for (let seed = 1; seed <= 10; seed++) {
      const s = start({ ...hillStandard, mix, shells: 20 }, 2, seed);
      for (const id of Object.keys(s.bags[0]!)) expect(id === "shot" || kinds[id] === kind, `${mix}: ${id}`).toBe(true);
      expect(Object.keys(s.bags[0]!).length).toBeGreaterThan(3);
    }
    expect(start(hillBangs).rules.mix).toBe("bangs");
    const d = start({ ...hillDraft, mix: "earth" }, 2, 4);
    for (const id of Object.keys(d.pool!)) expect(id === "shot" || kinds[id] === "earth").toBe(true);
  });

  it("is played in the place asked for, and things fall slowly on the moon", () => {
    for (const scene of ["meadow", "dusk", "desert", "snow", "moon"] as const) {
      const v = game.view(start({ ...hillStandard, scene }), 0) as FieldView;
      expect(v.field.scene).toBe(scene);
      expect(v.field.gravity).toBe(scene === "moon" ? 45 : 100);
    }
    const places = new Set<string>();
    for (let seed = 1; seed <= 40; seed++) places.add(start(hillStandard, 2, seed).scene);
    expect([...places].sort()).toEqual(["desert", "dusk", "meadow", "snow"]);
    // The same shot goes much further there.
    const far = (rules = hillStandard) => {
      const s = level(start(rules), [300, 1900]);
      s.turn = 0;
      return game.apply(s, 0, { type: "fire", shell: "shot", angle: 45, power: 40 });
    };
    const hole = (s: OverTheHillState) => s.land.findIndex((h) => h < 400);
    expect(hole(far(hillMoon))).toBeGreaterThan(hole(far()) + 30);
    expect(game.view(start(hillMoon), 0).info).toContain("Low gravity");
    expect(game.describe(hillMoon).join(" ")).toMatch(/moon/);
  });

  it("played to the last tank: armour comes off, a tank with none is out, and the last one in wins", () => {
    let s = level(start(hillKnockout, 3), [300, 1000, 1700]);
    s.bags = s.bags.map(() => ({ shot: 15 }));
    s.turn = 0;
    expect((game.view(s, 0) as FieldView).field.pieces.map((p) => p.armour)).toEqual([100, 100, 100]);
    const power = powerFor(s, 0, 1000);
    s = game.apply(s, 0, { type: "fire", shell: "shot", angle: 45, power });
    const took = s.last!.hits[0]!.damage;
    expect(s.tanks[1]!.armour).toBe(150 - took);
    expect(s.points[0]).toBe(took);
    expect(game.view(s, 0).players[1]!.line).toBe(`Armour ${Math.ceil(((150 - took) * 100) / 150)}% · 15 shells`);
    // Down to its last scrap, the next hit puts it out.
    s.tanks[1]!.armour = 1;
    s.turn = 0;
    s = game.apply(s, 0, { type: "fire", shell: "shot", angle: 45, power: powerFor(s, 0, 1000) });
    expect(s.tanks[1]).toMatchObject({ armour: 0, out: true });
    expect(s.bags[1]).toEqual({});
    expect(s.narration).toMatch(/\{1\} is out!$/);
    expect(s.phase).toBe("playing");
    // The turn passes over it, shells pass over it, and it is shown as a wreck.
    expect(s.turn).toBe(2);
    const v = game.view(s, 2) as FieldView;
    expect(v.field.pieces[1]).toMatchObject({ out: true, armour: 0 });
    expect(v.players[1]).toMatchObject({ line: "Out", done: true });
    const over = game.apply(s, 2, { type: "fire", shell: "shot", angle: 135, power: powerFor(s, 2, 1000, 135) });
    expect(over.last!.hits).toEqual([]);
    expect(over.last!.from.pieces.map((p) => p.id)).toEqual(["tank0", "tank2"]);
    // One left: that's the game, whatever the points say.
    s.tanks[0]!.armour = 1;
    s.points = [0, 0, 0];
    const end = game.apply(s, 2, { type: "fire", shell: "shot", angle: 135, power: powerFor(s, 2, 300, 135) });
    expect(end.phase).toBe("finished");
    expect(end.winners).toEqual([2]);
    expect(end.over).toBe("{2} is the last tank standing!");
    expect(game.summary(end).order![0]).toBe(2);
    expect(game.view(end, 0).result!.rows[0]).toEqual({ label: "Armour left", values: ["Out", "Out", "100%"] });
  });

  it("played to the last tank and out of shells: most armour left wins", () => {
    let s = level(start(hillKnockout), [400, 1800]);
    s.bags = [{ shot: 1 }, { shot: 1 }];
    s.turn = 0;
    s = game.apply(s, 0, { type: "fire", shell: "shot", angle: 45, power: powerFor(s, 0, 1800) });
    s = game.apply(s, 1, { type: "fire", shell: "shot", angle: 90, power: 100 });
    expect(s.phase).toBe("finished");
    expect(s.winners).toEqual([0]);
    expect(s.over).toBe("{0} wins with the most armour left!");
    // A game for points never puts anyone out.
    const points = level(start(), [400, 1800]);
    points.turn = 0;
    expect((game.view(points, 0) as FieldView).field.pieces[0]!.armour).toBeUndefined();
  });

  it("sets a tank down where its Jump Jets land", () => {
    const s = level(start(), [400, 1800]);
    s.turn = 0;
    s.bags[0] = { jump: 1, shot: 1 };
    const after = game.apply(s, 0, { type: "fire", shell: "jump", angle: 45, power: 40 });
    expect(after.tanks[0]!.x).toBeGreaterThan(700);
    expect(after.tanks[0]!.y).toBe(400);
    expect(after.points).toEqual([0, 0]);
    expect(after.narration).toBe("{0}'s Jump Jets set the tank down somewhere new.");
    expect(after.turn).toBe(1);
    expect((game.view(after, 0) as FieldView).field.pieces[0]!.x).toBe(after.tanks[0]!.x);
  });
});
