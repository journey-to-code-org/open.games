// Every field game on the kit, the way sport.test.ts checks every table sport: computer players
// finish whole games with every preset at every table size, the same seed always starts the same
// game, every view is consistent with itself and with the flight (the shot a view carries really
// does end on the field the view shows), a seat is offered a shot or a pick exactly when the
// engine will take one from it, and refused moves change nothing.
import { mulberry32 } from "@journey-to-code/rules";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FIELD_GAMES, FIELD_VERSION, GameError, carveLand, fieldMovesOffered, fieldWorld, flightOf, flyField, heapLand, isFieldGame, isKitGame, landAt, muzzle, type FieldGame, type FieldLand, type FieldShell, type FieldView } from "../src/index.js";

const STYLES = [{}, { skill: 0.3, sloppy: 0.3 }, { skill: 1, sloppy: 0 }];
afterEach(() => vi.restoreAllMocks());
/** Computer players roll dice for their aim; the tests give them the same dice every time. */
const seededDice = (seed: number) => vi.spyOn(Math, "random").mockImplementation(mulberry32(seed));

/** A view makes sense on its own: its land is whole, everything stands on it, and everything it points at is there. */
export function checkFieldView(v: FieldView, seat: number) {
  expect(v.me).toBe(seat);
  expect(v.players).toHaveLength(v.seats);
  const f = v.field;
  expect(f.key && f.name).toBeTruthy();
  expect(f.land).toHaveLength(f.width / f.step + 1);
  expect(f.land.every((h) => Number.isInteger(h) && h > 0 && h < f.height)).toBe(true);
  const land: FieldLand = { width: f.width, step: f.step, heights: f.land };
  for (const p of f.pieces) {
    // A piece is on the field, on the ground, and somebody's.
    expect(Number.isInteger(p.x) && p.x >= 0 && p.x <= f.width, `${p.id} is off the field`).toBe(true);
    expect(p.y).toBe(Math.round(landAt(land, p.x)));
    expect(p.owner >= 0 && p.owner < v.seats && p.angle >= 0 && p.angle <= 180).toBe(true);
    expect(p.label && p.tone && p.kind).toBeTruthy();
  }
  expect(new Set(f.pieces.map((p) => p.id)).size).toBe(f.pieces.length);
  const shells = new Set(v.shells.map((s) => s.id));
  expect(shells.size).toBe(v.shells.length);
  for (const s of v.shells) expect(s.name && s.blurb && Number.isInteger(s.blast) && Number.isInteger(s.damage) && s.blast > 0 && s.damage >= 0, s.id).toBeTruthy();
  // A view is for any renderer: it names kinds and gives sizes, and never a colour or a pixel.
  expect(JSON.stringify([f.pieces, v.shells, v.players])).not.toMatch(/#[0-9a-f]{3,8}\b|rgb|px/i);
  for (const stock of [...(v.pool ?? []), ...(v.pick?.options ?? []), ...(v.aim?.shells ?? []), ...v.players.flatMap((p) => p.shells)]) expect(shells.has(stock.shell) && stock.left > 0).toBe(true);
  if (v.pick) {
    expect(v.turn).toBe(seat);
    expect(v.pick.options).toEqual(v.pool);
    expect(v.pick.options.length).toBeGreaterThan(0);
  }
  if (v.aim) {
    expect(v.turn).toBe(seat);
    expect(v.over).toBeNull();
    expect(f.pieces.find((p) => p.id === v.aim!.piece)?.owner).toBe(seat);
    expect(v.aim.shells).toEqual(v.players[seat]!.shells);
    expect(v.aim.shells.length).toBeGreaterThan(0);
    expect(v.aim.angle >= v.aim.minAngle && v.aim.angle <= v.aim.maxAngle && v.aim.power >= v.aim.minPower && v.aim.power <= v.aim.maxPower).toBe(true);
    if (v.aim.move) expect(v.aim.move.left > 0 || v.aim.move.ways.length === 0).toBe(true);
  }
  if (v.last) {
    // The heart of the kit: the shot a view carries, flown over the field it was fired on, leaves
    // the pieces where the view says, and the land as the view shows it.
    expect(v.last.version).toBe(FIELD_VERSION);
    const flight = flightOf(v)!;
    expect(flight).not.toBeNull();
    expect(flight.pieces).toEqual(v.last.rest);
    expect(flight.land).toEqual(f.land);
    expect(Object.entries(flight.damage).map(([piece, damage]) => ({ piece, damage }))).toEqual(expect.arrayContaining(v.last.hits));
    expect(Object.keys(flight.damage)).toHaveLength(v.last.hits.length);
    expect(v.last.n).toBeGreaterThan(0);
    // Played back, the last thing that changed the field left it as it ended.
    const changed = flight.events.filter((e) => e.land);
    if (changed.length) expect(changed.at(-1)!.land).toEqual(flight.land);
  }
  if (v.over) expect(v.over.winners.length).toBeGreaterThan(0);
}

/** Bots play until it's over. Along the way every seat's view is checked, and a seat can fire or pick exactly when its view says so. */
export function playOut(game: FieldGame<any, any, any>, rules: unknown, seats: number, seed: number, limit = 600) {
  seededDice(seed);
  let s = game.newGame(game.normalize(rules), seats, seed);
  let moves = 0;
  while (!game.summary(s).over) {
    let moved = false;
    for (let seat = 0; seat < seats; seat++) {
      const v = game.view(s, seat);
      checkFieldView(v, seat);
      const before = JSON.stringify(s);
      for (const m of fieldMovesOffered(v)) game.apply(s, seat, m);
      const shell = v.players[seat]!.shells[0]?.shell ?? v.shells[0]!.id;
      if (!v.aim) expect(() => game.apply(s, seat, { type: "fire", shell, angle: 45, power: 50 }), `${game.id}: seat ${seat} isn't offered a shot but may take one`).toThrow(GameError);
      if (!v.pick) expect(() => game.apply(s, seat, { type: "pick", shell: v.pool?.[0]?.shell ?? shell }), `${game.id}: seat ${seat} isn't offered a pick but may make one`).toThrow(GameError);
      // Trying moves never changes the state it was given.
      expect(JSON.stringify(s)).toBe(before);
      if (moved) continue;
      const move = game.bot(s, seat, STYLES[(seat + moves) % STYLES.length]!);
      if (!move) continue;
      // The computer player only does what its view offers.
      if (move.type === "fire") expect(v.aim && v.aim.shells.some((o) => o.shell === move.shell) && move.angle >= v.aim.minAngle && move.angle <= v.aim.maxAngle && move.power >= v.aim.minPower && move.power <= v.aim.maxPower, `${game.id}: the bot's shot isn't one the view offers`).toBeTruthy();
      else if (move.type === "pick") expect(v.pick?.options.some((o) => o.shell === move.shell)).toBe(true);
      else if (move.type === "move") expect(v.aim?.move?.ways).toContain(move.way);
      else expect(v.choices?.options.some((o) => JSON.stringify(o.move) === JSON.stringify(move))).toBe(true);
      s = game.apply(s, seat, move);
      moved = true;
      moves++;
    }
    if (!moved) throw new Error(`nobody can move in ${game.id} (phase ${game.summary(s).phase})`);
    if (moves > limit) throw new Error(`${game.id} went on too long`);
  }
  return { state: s, moves };
}

const flat = (h = 400): FieldLand => ({ width: 2400, step: 10, heights: Array<number>(241).fill(h) });
const plain: FieldShell = { id: "plain", name: "Plain", blurb: "A shell.", blast: 70, damage: 30 };

describe("the land", () => {
  it("is as high between two heights as a straight line between them, and as high as its edge beyond it", () => {
    const land: FieldLand = { width: 30, step: 10, heights: [100, 200, 200, 50] };
    expect([landAt(land, 0), landAt(land, 5), landAt(land, 10), landAt(land, 25), landAt(land, 30)]).toEqual([100, 150, 200, 125, 50]);
    expect([landAt(land, -50), landAt(land, 400)]).toEqual([100, 50]);
  });

  it("is left with a round hole by a blast, in whole numbers, and never below its floor", () => {
    const land = flat();
    carveLand(land, 1200, 400, 70);
    expect(land.heights[120]).toBe(330);
    expect(land.heights[113]).toBe(400);
    expect(land.heights[127]).toBe(400);
    expect(land.heights[117]! < 400 && land.heights[117]! > 330).toBe(true);
    expect(land.heights.every(Number.isInteger)).toBe(true);
    // The same either side of the middle.
    for (let i = 1; i <= 7; i++) expect(land.heights[120 - i]).toBe(land.heights[120 + i]);
    carveLand(land, 1200, 60, 400);
    expect(Math.min(...land.heights)).toBeGreaterThan(0);
  });

  it("lets the earth above a hole fall into it", () => {
    const land = flat(600);
    // A hole wholly under the surface: the ground above drops by the hole's height there.
    carveLand(land, 1200, 300, 50);
    expect(land.heights[120]).toBe(500);
    expect(land.heights[110]).toBe(600);
  });

  it("is heaped up by a load of earth", () => {
    const land = flat();
    heapLand(land, 1200, 100);
    expect(land.heights[120]).toBe(490);
    expect(land.heights[105]).toBe(400);
    expect(land.heights[125]! > 400 && land.heights[125]! < 490).toBe(true);
  });
});

describe("a flight", () => {
  const world = () => ({ land: flat(), pieces: [{ id: "a", x: 400, y: 400 }, { id: "b", x: 2000, y: 400 }], wind: 0 });

  it("leaves the barrel along the angle: flat right at 0, straight up at 90, flat left at 180", () => {
    const piece = { id: "a", x: 400, y: 400 };
    const [right, up, left] = [muzzle(piece, 0, 50), muzzle(piece, 90, 50), muzzle(piece, 180, 50)];
    expect(right.vy === 0 && right.vx > 0 && right.x > 400).toBe(true);
    expect(up.vx === 0 && up.vy > 0 && up.x === 400).toBe(true);
    expect(left.vy === 0 && left.vx === -right.vx).toBe(true);
  });

  it("goes further the harder it is fired, and the same shot lands in the same place", () => {
    const where = (power: number) => flyField(world(), { piece: "a", shell: plain, angle: 45, power }).events.at(-1)!.x;
    expect(where(30)).toBeLessThan(where(50));
    expect(where(50)).toBeLessThan(where(70));
    expect(where(50)).toBe(where(50));
    // The same from the other end, mirrored.
    const back = flyField(world(), { piece: "b", shell: plain, angle: 135, power: 50 }).events.at(-1)!.x;
    expect(2400 - back).toBeCloseTo(where(50), 6);
  });

  it("never changes the world it is given", () => {
    const w = world();
    const before = JSON.stringify(w);
    flyField(w, { piece: "a", shell: plain, angle: 45, power: 60 }, true);
    expect(JSON.stringify(w)).toBe(before);
  });

  it("hurts more the nearer the middle of the blast, and not at all beyond its reach", () => {
    const far = (x: number) => flyField({ land: flat(), pieces: [{ id: "a", x: 400, y: 400 }, { id: "b", x, y: 400 }], wind: 0 }, { piece: "a", shell: plain, angle: 45, power: 50 });
    const landed = far(2300).events.at(-1)!.x;
    const on = far(Math.round(landed)).damage.b!;
    const near = far(Math.round(landed) + 50).damage.b!;
    expect(on).toBeGreaterThan(near);
    expect(near).toBeGreaterThan(0);
    expect(far(Math.round(landed) + 200).damage.b).toBeUndefined();
  });

  it("drops a piece to what is left of the ground under it", () => {
    const w = world();
    const flight = flyField(w, { piece: "a", shell: { ...plain, blast: 150 }, angle: 90, power: 30 });
    // Straight up comes straight down: the tank that fired is caught, and sinks.
    expect(flight.damage.a).toBeGreaterThan(0);
    expect(flight.pieces[0]!.y).toBeLessThan(400);
    expect(flight.pieces[0]!.y).toBe(Math.round(landAt({ ...w.land, heights: flight.land }, 400)));
    expect(flight.pieces[1]!.y).toBe(400);
  });

  it("is pushed by the wind", () => {
    const where = (wind: number) => flyField({ ...world(), wind }, { piece: "a", shell: plain, angle: 60, power: 50 }).events.at(-1)!.x;
    expect(where(-8)).toBeLessThan(where(0));
    expect(where(0)).toBeLessThan(where(8));
  });

  it("fans, skips, rolls, digs, splits and heaps, as the shell says", () => {
    const fly = (shell: FieldShell, w = world()) => flyField(w, { piece: "a", shell, angle: 50, power: 50 }, true);
    const kinds = (shell: FieldShell) => fly(shell).events.map((e) => e.kind);
    expect(kinds({ ...plain, count: 3, spread: 4 }).filter((k) => k === "burst")).toHaveLength(3);
    expect(kinds({ ...plain, bounces: 2 })).toEqual(["skip", "skip", "burst"]);
    expect(kinds({ ...plain, dirt: true })).toEqual(["heap"]);
    expect(kinds({ ...plain, split: { at: "land", into: 5, blast: 40, damage: 10 } }).filter((k) => k === "burst")).toHaveLength(6);
    const top = kinds({ ...plain, split: { at: "top", into: 5, blast: 40, damage: 10 } });
    expect(top[0]).toBe("split");
    expect(top.filter((k) => k === "burst")).toHaveLength(5);
    const dug = fly({ ...plain, dig: 200 });
    expect(dug.events.filter((e) => e.kind === "bore").length).toBeGreaterThan(10);
    expect(dug.events.at(-1)!.y).toBeLessThan(400);
    // A roller on a slope down to the right ends up further on than where it landed, against whatever stops it.
    const slope: FieldLand = { width: 2400, step: 10, heights: Array.from({ length: 241 }, (_, i) => 800 - i * 2) };
    const pieces = [{ id: "a", x: 400, y: 720 }, { id: "b", x: 2000, y: 400 }];
    const landed = flyField({ land: slope, pieces, wind: 0 }, { piece: "a", shell: plain, angle: 50, power: 40 }).events.at(-1)!.x;
    const rolled = flyField({ land: slope, pieces, wind: 0 }, { piece: "a", shell: { ...plain, roll: true }, angle: 50, power: 40 }).events.at(-1)!.x;
    expect(rolled).toBeGreaterThan(landed + 100);
    // Heaped earth lifts whoever is under it.
    const heaped = flyField({ land: flat(), pieces: [{ id: "a", x: 400, y: 400 }, { id: "b", x: Math.round(fly(plain).events.at(-1)!.x), y: 400 }], wind: 0 }, { piece: "a", shell: { ...plain, dirt: true }, angle: 50, power: 50 });
    expect(heaped.pieces[1]!.y).toBeGreaterThan(400);
    expect(heaped.damage).toEqual({});
  });

  it("flies dead straight with no weight, further with little, and falls short with a lot", () => {
    const fly = (shell: FieldShell, angle = 45) => flyField(world(), { piece: "a", shell, angle, power: 50 });
    const straight = fly({ ...plain, weight: 0 }, 30).tracks[0]!.points;
    const [x0, y0] = straight[0]!;
    for (const [x, y] of straight.slice(1, 20)) expect((y - y0) / (x - x0)).toBeCloseTo((straight[1]![1] - y0) / (straight[1]![0] - x0), 6);
    const where = (weight: number) => fly({ ...plain, weight }).events.at(-1)!.x;
    expect(where(35)).toBeGreaterThan(where(100) + 300);
    expect(where(240)).toBeLessThan(where(100) - 200);
    // The same shot goes further where everything falls slowly.
    const moon = flyField({ ...world(), gravity: 45 }, { piece: "a", shell: plain, angle: 45, power: 40 }).events.at(-1)!.x;
    expect(moon).toBeGreaterThan(flyField(world(), { piece: "a", shell: plain, angle: 45, power: 40 }).events.at(-1)!.x + 300);
  });

  it("leans toward the nearest piece when it seeks", () => {
    const fly = (seek: number) => flyField(world(), { piece: "a", shell: { ...plain, seek }, angle: 60, power: 62 }).events.at(-1)!.x;
    // Both fall short of the tank at 2000; the one that seeks, less so.
    expect(fly(0)).toBeLessThan(2000);
    expect(fly(100)).toBeGreaterThan(fly(0) + 40);
  });

  it("burns without a hole, walks on along the ground, and builds a wall", () => {
    const burnt = flyField(world(), { piece: "a", shell: { ...plain, scorch: true }, angle: 45, power: 50 }, true);
    expect(burnt.events.map((e) => e.kind)).toEqual(["fire"]);
    expect(burnt.land).toEqual(world().land.heights);
    const hit = (x: number) => flyField({ land: flat(), pieces: [{ id: "a", x: 400, y: 400 }, { id: "b", x, y: 400 }], wind: 0 }, { piece: "a", shell: { ...plain, scorch: true }, angle: 45, power: 50 });
    expect(hit(Math.round(burnt.events[0]!.x)).damage.b).toBeGreaterThan(20);

    const marched = flyField(world(), { piece: "a", shell: { ...plain, walk: { steps: 4, gap: 80, blast: 50, damage: 10 } }, angle: 45, power: 40 });
    const xs = marched.events.filter((e) => e.kind === "burst").map((e) => e.x);
    expect(xs).toHaveLength(5);
    for (let i = 1; i < xs.length; i++) expect(xs[i]! - xs[i - 1]!).toBeCloseTo(80, 6);
    // Fired the other way, it marches the other way.
    const back = flyField(world(), { piece: "b", shell: { ...plain, walk: { steps: 2, gap: 80, blast: 50, damage: 10 } }, angle: 135, power: 40 }).events.map((e) => e.x);
    expect(back[1]!).toBeLessThan(back[0]!);

    const round = flat();
    const tall = flat();
    heapLand(round, 1200, 120);
    heapLand(tall, 1200, 120, true);
    expect(Math.max(...tall.heights)).toBeGreaterThan(Math.max(...round.heights) + 50);
    expect(tall.heights.filter((h) => h > 400).length).toBeLessThan(round.heights.filter((h) => h > 400).length / 2);
  });

  it("carries the piece that fired it to where it lands, if there is room", () => {
    const jump: FieldShell = { ...plain, blast: 10, damage: 0, carry: true };
    const flight = flyField(world(), { piece: "a", shell: jump, angle: 45, power: 40 }, true);
    expect(flight.events.map((e) => e.kind)).toEqual(["carry"]);
    expect(flight.pieces[0]!.x).toBe(Math.round(flight.events[0]!.x));
    expect(Number.isInteger(flight.pieces[0]!.x) && flight.pieces[0]!.y === 400).toBe(true);
    expect(flight.land).toEqual(world().land.heights);
    expect(flight.damage).toEqual({});
    // On top of somebody else: it stays where it was.
    const crowded = flyField({ land: flat(), pieces: [{ id: "a", x: 400, y: 400 }, { id: "b", x: Math.round(flight.events[0]!.x) + 40, y: 400 }], wind: 0 }, { piece: "a", shell: jump, angle: 45, power: 40 });
    expect(crowded.pieces[0]!.x).toBe(400);
    expect(crowded.events.map((e) => e.kind)).toEqual(["skip"]);
  });

  it("splits into pieces that do as they are told: rolling, skipping, burning, or earth", () => {
    const fly = (split: FieldShell["split"]) => flyField(world(), { piece: "a", shell: { ...plain, split }, angle: 50, power: 50 }, true);
    const kinds = (split: FieldShell["split"]) => fly(split).events.map((e) => e.kind);
    expect(kinds({ at: "top", into: 4, blast: 60, damage: 0, dirt: true }).filter((k) => k === "heap")).toHaveLength(4);
    expect(kinds({ at: "top", into: 3, blast: 40, damage: 5, bounces: 1 }).filter((k) => k === "skip")).toHaveLength(3);
    expect(kinds({ at: "land", into: 4, blast: 40, damage: 5, scorch: true }).filter((k) => k === "fire")).toHaveLength(4);
    const spread = (fan: number) => {
      const xs = fly({ at: "top", into: 5, blast: 40, damage: 5, fan }).events.filter((e) => e.kind === "burst").map((e) => e.x);
      return Math.max(...xs) - Math.min(...xs);
    };
    expect(spread(260)).toBeGreaterThan(spread(100) * 2);
    // Pieces that roll end up downhill of where they came down.
    const slope: FieldLand = { width: 2400, step: 10, heights: Array.from({ length: 241 }, (_, i) => 800 - i * 2) };
    const pieces = [{ id: "a", x: 400, y: 720 }, { id: "b", x: 2300, y: 340 }];
    const still = flyField({ land: slope, pieces, wind: 0 }, { piece: "a", shell: { ...plain, split: { at: "land", into: 3, blast: 40, damage: 5 } }, angle: 50, power: 40 });
    const rolled = flyField({ land: slope, pieces, wind: 0 }, { piece: "a", shell: { ...plain, split: { at: "land", into: 3, blast: 40, damage: 5, roll: true } }, angle: 50, power: 40 });
    const most = (f: typeof still) => Math.max(...f.events.map((e) => e.x));
    expect(most(rolled)).toBeGreaterThan(most(still) + 100);
  });

  it("ends, whatever is fired", () => {
    const odd: FieldShell = { ...plain, count: 3, spread: 10, bounces: 3, roll: true, dig: 300, seek: 100, walk: { steps: 4, gap: 60, blast: 40, damage: 5 }, split: { at: "land", into: 6, blast: 60, damage: 9, roll: true, bounces: 2, fan: 200 } };
    for (const angle of [0, 1, 45, 90, 135, 179, 180]) for (const power of [1, 50, 100]) for (const wind of [-10, 10]) for (const weight of [0, 35, 240]) {
      const flight = flyField({ ...world(), wind, gravity: 45 }, { piece: "a", shell: { ...odd, weight }, angle, power });
      expect(flight.ticks).toBeLessThanOrEqual(1200);
      expect(flight.land.every((h) => Number.isInteger(h) && h > 0)).toBe(true);
    }
    // A shot from nobody, or in fractions, is no shot at all.
    expect(flyField(world(), { piece: "nobody", shell: plain, angle: 45, power: 50 }).tracks).toEqual([]);
    expect(flyField(world(), { piece: "a", shell: plain, angle: 45.5, power: 50 }).tracks).toEqual([]);
  });
});

for (const game of FIELD_GAMES) {
  describe(game.id, () => {
    it("is a field game with valid presets that describe themselves", () => {
      expect(isFieldGame(game.id) && isKitGame(game.id)).toBe(true);
      expect(new Set(game.presets.map((p) => p.id)).size).toBe(game.presets.length);
      for (const p of game.presets) {
        expect(game.validate(game.normalize(p))).toEqual([]);
        expect(game.normalize(p)).toEqual(p);
        expect(game.describe(p).length).toBeGreaterThan(1);
        // A table's rules name is cut at 30 characters on the server: say it in fewer.
        expect(p.name.length).toBeLessThanOrEqual(30);
      }
      // Rules from anywhere come out as rules.
      for (const junk of [null, 7, "x", {}, { id: "nope", shells: "lots", moves: -3, land: 5, wind: "yes" }]) expect(game.validate(game.normalize(junk))).toEqual([]);
    });

    const sizes = [...new Set([game.seats.min, game.seats.default, game.seats.max])];
    for (const seats of sizes) {
      it(`bots play whole games with ${seats} players, every preset`, () => {
        for (const [i, preset] of game.presets.entries()) {
          const { state } = playOut(game, preset, seats, 7 + i * 35 + seats);
          const summary = game.summary(state);
          expect(summary.over).toBe(true);
          expect(summary.winners!.length).toBeGreaterThan(0);
          expect([...summary.order!].sort()).toEqual(Array.from({ length: seats }, (_, s) => s));
          for (let seat = 0; seat < seats; seat++) {
            const v = game.view(state, seat);
            checkFieldView(v, seat);
            expect(v.over!.winners).toEqual(summary.winners);
            // Nothing left to do on a finished table.
            expect(fieldMovesOffered(v)).toEqual([]);
          }
        }
      }, 120_000);
    }

    it("plays the same game from the same seed and the same dice", () => {
      for (const preset of game.presets.slice(0, 2)) {
        const a = playOut(game, preset, game.seats.default, 99);
        vi.restoreAllMocks();
        const b = playOut(game, preset, game.seats.default, 99);
        expect(JSON.stringify(a.state)).toBe(JSON.stringify(b.state));
        expect(a.moves).toBe(b.moves);
      }
      const a = game.newGame(game.presets[0], game.seats.max, 5);
      const b = game.newGame(game.presets[0], game.seats.max, 5);
      expect(JSON.stringify(a)).toBe(JSON.stringify(b));
      for (let seat = 0; seat < game.seats.max; seat++) expect(game.view(a, seat)).toEqual(game.view(b, seat));
    }, 60_000);

    it("says the same things to every seat, and offers a shot or a pick only to the seat whose turn it is", () => {
      for (const preset of game.presets) {
        const s = game.newGame(preset, game.seats.max, 5);
        const views = Array.from({ length: game.seats.max }, (_, seat) => game.view(s, seat));
        for (const v of views) {
          expect(v.game).toBe(game.id);
          expect(v.seats).toBe(game.seats.max);
          expect([v.turn, v.phase, v.scores, v.over, v.pool, v.field.land, v.field.pieces.map((p) => [p.id, p.x, p.y])]).toEqual([views[0]!.turn, views[0]!.phase, views[0]!.scores, views[0]!.over, views[0]!.pool, views[0]!.field.land, views[0]!.field.pieces.map((p) => [p.id, p.x, p.y])]);
        }
        expect(views.filter((v) => v.aim || v.pick).map((v) => v.me)).toEqual([views[0]!.turn]);
      }
    });

    it("refuses bad shots and moves out of turn, and leaves the state alone", () => {
      const s = game.newGame(game.presets[0], game.seats.max, 5);
      const before = JSON.stringify(s);
      const turn = game.view(s, 0).turn!;
      const v = game.view(s, turn);
      const shell = v.aim?.shells[0]?.shell ?? v.shells[0]!.id;
      const other = (turn + 1) % game.seats.max;
      const bad: [number, unknown][] = [
        [other, { type: "fire", shell, angle: 45, power: 50 }],
        [turn, { type: "fire", shell: "no such shell", angle: 45, power: 50 }],
        [turn, { type: "fire", shell, angle: 45.5, power: 50 }],
        [turn, { type: "fire", shell, angle: 181, power: 50 }],
        [turn, { type: "fire", shell, angle: -1, power: 50 }],
        [turn, { type: "fire", shell, angle: 45, power: 0 }],
        [turn, { type: "fire", shell, angle: 45, power: 101 }],
        [turn, { type: "fire", shell, angle: "45", power: 50 }],
        [turn, { type: "move", way: 2 }],
        [turn, { type: "dance" }],
        [turn, null],
        [-1, { type: "fire", shell, angle: 45, power: 50 }],
        [game.seats.max, { type: "fire", shell, angle: 45, power: 50 }],
      ];
      for (const [seat, move] of bad) expect(() => game.apply(s, seat, move as never), JSON.stringify(move)).toThrow(GameError);
      expect(JSON.stringify(s)).toBe(before);
    });

    it("keeps its state whole numbers, and safe to store and bring back", () => {
      const { state } = playOut(game, game.presets[0], game.seats.default, 41);
      const stored = JSON.parse(JSON.stringify(state));
      expect(stored).toEqual(state);
      expect(game.view(stored, 0)).toEqual(game.view(state, 0));
      const numbers: number[] = [];
      JSON.stringify(state, (_, value) => (typeof value === "number" && numbers.push(value), value));
      expect(numbers.every(Number.isInteger)).toBe(true);
    });
  });
}

describe("the view's own world", () => {
  it("is the field as the next shot will find it", () => {
    const game = FIELD_GAMES[0]!;
    const v = game.view(game.newGame(game.presets[0], 2, 3), 0);
    const world = fieldWorld(v);
    expect(world.land.heights).toBe(v.field.land);
    expect(world.pieces).toEqual(v.field.pieces.filter((p) => !p.out).map(({ id, x, y }) => ({ id, x, y })));
    expect(world.gravity).toBe(v.field.gravity);
    expect(flightOf(v)).toBeNull();
  });
});
