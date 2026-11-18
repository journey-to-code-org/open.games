// Delbie's Counter's own rules. The shared arcade tests already work a shift with computer players;
// these check the till: what a ticket comes to, what each mistake is, the store's rules for a part
// brought back, patience, and that a customer only ever says what is needed and it is enough.
import { describe, expect, it } from "vitest";
import { COUNTER_PARTS, COUNTER_POLICY, COUNTER_PRESETS, COUNTER_RATE, COUNTER_VEHICLES, counterPart, counterRuling, counterTotals, delbiesCounter, type CounterInput, type CounterState } from "../src/index.js";

const game = delbiesCounter;
const fresh = (seed = 4, rules: unknown = null) => game.newGame(game.normalize(rules), 1, seed);
let n = 0;
const send = (s: CounterState, more: Partial<CounterInput>) => game.step(s, [{ ...game.idle, n: (n += 1) + s.seq, ...more }]);
const wait = (s: CounterState, ticks: number) => { for (let t = 0; t < ticks; t++) game.step(s, [{ ...game.idle, n: s.seq }]); };
/** Wait for somebody of a kind to be at the counter. */
function until(s: CounterState, ok: (who: CounterState["line"][number]) => boolean): CounterState["line"][number] {
  for (let t = 0; t < 5000 && s.phase === "open"; t++) {
    const who = s.line[0];
    if (who && s.pause === 0 && ok(who)) return who;
    if (who && s.pause === 0) send(s, { do: who.kind === "return" ? counterRuling(who.days, who.opened === 1, who.defective === 1) : "card" });
    else wait(s, 1);
  }
  throw new Error("Nobody like that came in");
}
/** Serve the customer at the counter exactly right. */
function serve(s: CounterState, change?: number) {
  const who = s.line[0]!;
  for (const want of who.wants) send(s, { do: "ring", sku: want.sku, qty: want.qty });
  send(s, { do: "core", on: who.coreBack === 1 });
  send(s, { do: "level", level: who.level });
  const due = who.tender - counterTotals(who.wants, who.coreBack === 1, who.level).total;
  send(s, who.cash ? { do: "cash", cents: change ?? due } : { do: "card" });
}
const long = { id: "long", name: "Long", shift: 600, rush: "steady", drawer: false };

describe("the shelf", () => {
  it("has every part for every car, in two grades, each under a number of its own", () => {
    expect(COUNTER_PARTS).toHaveLength(COUNTER_VEHICLES.length * 12 * 2);
    expect(new Set(COUNTER_PARTS.map((p) => p.sku)).size).toBe(COUNTER_PARTS.length);
    for (const part of COUNTER_PARTS) {
      expect(Number.isInteger(part.price) && part.price > 0).toBe(true);
      expect(counterPart(part.sku)).toBe(part);
    }
    // The good one always costs more than the cheap one.
    for (let i = 0; i < COUNTER_PARTS.length; i += 2) expect(COUNTER_PARTS[i + 1]!.price).toBeGreaterThan(COUNTER_PARTS[i]!.price);
  });

  it("adds a ticket up: the level comes off, the core goes on untaxed, and the tax is six cents on the dollar", () => {
    const battery = COUNTER_PARTS.find((p) => p.name === "Battery")!;
    const plain = counterTotals([{ sku: battery.sku, qty: 1 }], false, 0);
    expect(plain.subtotal).toBe(battery.price);
    expect(plain.core).toBe(2200);
    expect(plain.tax).toBe(Math.round(battery.price * 0.06));
    expect(plain.total).toBe(battery.price + 2200 + plain.tax);
    expect(counterTotals([{ sku: battery.sku, qty: 1 }], true, 0).core).toBe(0);
    const shop = counterTotals([{ sku: battery.sku, qty: 2 }], true, 1);
    expect(shop.discount).toBe(Math.floor((battery.price * 2 * 15) / 100));
    expect(shop.total).toBe(shop.subtotal - shop.discount + shop.tax);
    expect(counterTotals([], false, 0).total).toBe(0);
  });

  it("rules on a part brought back", () => {
    expect(counterRuling(5, false, false)).toBe("refund");
    expect(counterRuling(COUNTER_POLICY.refundDays, false, false)).toBe("refund");
    expect(counterRuling(COUNTER_POLICY.refundDays + 1, false, false)).toBe("refuse");
    expect(counterRuling(5, true, false)).toBe("refuse");
    expect(counterRuling(200, true, true)).toBe("exchange");
    expect(counterRuling(COUNTER_POLICY.warrantyDays + 1, true, true)).toBe("refuse");
  });
});

describe("Delbie's Counter", () => {
  it("opens with nobody in, and somebody walks in within a second or two", () => {
    const s = fresh();
    expect(game.view(s).counter!.line).toEqual([]);
    wait(s, 12);
    const c = game.view(s).counter!;
    expect(c.line).toHaveLength(1);
    expect(c.says.length).toBeGreaterThan(20);
    expect(c.asks).not.toBeNull();
  });

  it("says everything that is needed to serve them, and the screen is told nothing more", () => {
    const s = fresh(9, long);
    for (let served = 0; served < 25; served++) {
      const who = until(s, () => true);
      const c = game.view(s).counter!;
      const part = counterPart(who.wants[0]!.sku)!;
      const car = COUNTER_VEHICLES[part.vehicle]!;
      if (who.kind === "sale") {
        expect(c.says).toContain(`${car.year} ${car.make} ${car.model}`);
        expect(c.says).toContain(part.grade ? "good stuff" : "Cheapest");
        if (who.cash) expect(c.tender).toBe(who.tender); else expect(c.tender).toBeNull();
        if (who.level) expect(c.says).toMatch(/account/);
        if (who.wants.some((w) => counterPart(w.sku)!.core)) expect(c.says).toMatch(who.coreBack ? /old one right here/ : /bring the old one in later/);
        expect(c.returning).toBeNull();
      } else {
        expect(c.says).toContain(`${who.days} day`);
        expect(c.returning).toEqual({ sku: part.sku, name: part.name, days: who.days });
      }
      // What they want is not handed over anywhere but in their words.
      expect(JSON.stringify({ ...c, says: "", returning: null })).not.toContain(part.sku);
      expect(c.ticket.change).toBeNull();
    }
  });

  it("takes a sale that is right: the drawer fills, the streak grows, five stars for being quick", () => {
    const s = fresh(4, long);
    const who = until(s, (c) => c.kind === "sale");
    const total = counterTotals(who.wants, who.coreBack === 1, who.level).total;
    serve(s);
    expect(s.till).toBe(total);
    expect(s.served).toBe(1);
    expect(s.streak).toBe(1);
    expect(s.mistakes).toBe(0);
    expect(s.score).toBeGreaterThan(100);
    expect(s.last).toEqual({ ok: 1, stars: 5, notes: [] });
    expect(s.ticket.lines).toEqual([]);
    // The next one does not step up at once.
    expect(game.view(s).counter!.says).toBe("");
  });

  it("names each thing that was wrong, and takes points for it", () => {
    const wrong = (how: (s: CounterState, who: CounterState["line"][number]) => void, pick: (c: CounterState["line"][number]) => boolean, note: RegExp) => {
      const s = fresh(6, long);
      const who = until(s, pick);
      s.score = 500;
      how(s, who);
      expect(s.last!.ok, String(note)).toBe(0);
      expect(s.last!.notes.join(" ")).toMatch(note);
      expect(s.score).toBe(500 - 25 * s.last!.notes.length);
      expect(s.streak).toBe(0);
      expect(s.till).toBe(0);
    };
    const sale = (c: CounterState["line"][number]) => c.kind === "sale";
    wrong((s) => send(s, { do: "card" }), (c) => sale(c) && !c.cash, /not what was asked for/);
    wrong((s, who) => { send(s, { do: "ring", sku: who.wants[0]!.sku, qty: who.wants[0]!.qty + 1 }); send(s, { do: "card" }); }, sale, /not what was asked for/);
    wrong((s, who) => { for (const w of who.wants) send(s, { do: "ring", sku: w.sku, qty: w.qty }); send(s, { do: "core", on: !who.coreBack }); send(s, { do: "level", level: who.level }); send(s, { do: "card" }); }, (c) => sale(c) && !c.cash && c.wants.some((w) => counterPart(w.sku)!.core > 0), /core|old one/);
    wrong((s, who) => { for (const w of who.wants) send(s, { do: "ring", sku: w.sku, qty: w.qty }); send(s, { do: "core", on: who.coreBack === 1 }); send(s, { do: "level", level: 1 }); send(s, { do: "card" }); }, (c) => sale(c) && !c.cash && c.level === 0, /retail price/);
    wrong((s) => serve(s, 1), (c) => sale(c) && c.cash === 1, /The change was/);
    wrong((s, who) => { for (const w of who.wants) send(s, { do: "ring", sku: w.sku, qty: w.qty }); send(s, { do: "core", on: who.coreBack === 1 }); send(s, { do: "card" }); }, (c) => sale(c) && c.cash === 1, /paying cash/);
    wrong((s) => send(s, { do: "refund" }), sale, /came to buy/);
    wrong((s, who) => send(s, { do: counterRuling(who.days, who.opened === 1, who.defective === 1) === "refund" ? "refuse" : "refund" }), (c) => c.kind === "return", /refund|exchange|refused/);
  });

  it("handles a part brought back by the store's rules", () => {
    const s = fresh(11, long);
    for (let n = 0; n < 6; n++) {
      const who = until(s, (c) => c.kind === "return");
      const mistakes = s.mistakes;
      send(s, { do: counterRuling(who.days, who.opened === 1, who.defective === 1) });
      expect(s.mistakes).toBe(mistakes);
      expect(s.last!.ok).toBe(1);
      wait(s, 10);
    }
  });

  it("carries a command out once, on the tick its number changes", () => {
    const s = fresh(4, long);
    const who = until(s, (c) => c.kind === "sale");
    const want = who.wants[0]!;
    const input = { ...game.idle, n: s.seq + 1, do: "ring" as const, sku: want.sku, qty: 3 };
    for (let t = 0; t < 5; t++) game.step(s, [input]);
    expect(s.ticket.lines).toEqual([{ sku: want.sku, qty: 3 }]);
    // Rung again, a part's count is replaced, not added to; and it can be taken off.
    send(s, { do: "ring", sku: want.sku, qty: 2 });
    expect(s.ticket.lines).toEqual([{ sku: want.sku, qty: 2 }]);
    send(s, { do: "void", sku: want.sku });
    expect(s.ticket.lines).toEqual([]);
    send(s, { do: "ring", sku: "NOPE", qty: 2 });
    expect(s.ticket.lines).toEqual([]);
  });

  it("loses whoever is kept waiting too long, and their one star counts", () => {
    const s = fresh(4, { id: "t", name: "T", shift: 600, rush: "slammed", drawer: false });
    wait(s, 12);
    const first = s.line[0]!.id;
    wait(s, 900);
    expect(s.walked).toBeGreaterThan(0);
    expect(s.line.some((c) => c.id === first)).toBe(false);
    expect(game.view(s).counter!.stars).toBe(10);
    expect(s.line.length).toBeLessThanOrEqual(5);
  });

  it("works the change out on a slow Tuesday, and not on a Saturday", () => {
    const easy = fresh(4, { ...COUNTER_PRESETS[0], shift: 600 });
    const who = until(easy, (c) => c.kind === "sale" && c.cash === 1);
    for (const w of who.wants) send(easy, { do: "ring", sku: w.sku, qty: w.qty });
    send(easy, { do: "core", on: who.coreBack === 1 });
    const c = game.view(easy).counter!;
    expect(c.ticket.change).toBe(who.tender - c.ticket.total);
    expect(c.ticket.total).toBe(counterTotals(who.wants, who.coreBack === 1, 0).total);
  });

  it("closes when the shift is over, with the day's numbers", () => {
    const s = fresh(4);
    while (s.phase === "open") game.step(s, [game.bot(s, 0, { skill: 1, sloppy: 0 }, () => 0.9)]);
    expect(s.tick).toBe(180 * COUNTER_RATE);
    expect(s.served).toBeGreaterThan(5);
    expect(s.mistakes).toBe(0);
    expect(game.summary(s).scoreLine).toMatch(/served · \d+ walked out · \$[\d,.]+ in the drawer/);
    expect(s.events.some((e) => e.kind === "over" && e.text === "Living that dream.")).toBe(true);
  });
});
