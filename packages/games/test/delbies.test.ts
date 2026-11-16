// Delbie's own rules: what a hustle is worth and what it does to the counter, hiring and training,
// each of the crew's habits, tabs and who collects them, payroll, and the report of a night away.
import { describe, expect, it } from "vitest";
import { DELBIES_CREW, DELBIES_FLOOR, DELBIES_FLOOR_RULES, DELBIES_PIECES, delbies, dollars, type DelbiesCrewId, type DelbiesFloorRuleId, type DelbiesPieceId, type DelbiesState, type IdleClock } from "../src/index.js";

const START = 1_800_000_000 - (1_800_000_000 % 86400);
/** `hour` o'clock where the player is, on a Tuesday, and `on` seconds after. */
const at = (on: number, hour = 9): IdleClock => {
  const local = hour * 3600 + on;
  return { now: START + on, minute: Math.floor(local / 60) % 1440, day: (2 + Math.floor(local / 86400)) % 7 };
};
const store = (hour = 9) => delbies.newGame(1, at(0, hour));
const hire = (s: DelbiesState, ...who: DelbiesCrewId[]) => who.forEach((id) => (s.crew[id].hired = true));
const lines = (s: DelbiesState) => s.log.map((l) => l.text);

describe("Delbie's Daycare & Geriatrics", () => {
  it("starts with nothing but Delbie: every dollar is a click", () => {
    const s = store();
    const v = delbies.view(s, at(0));
    expect(v).toMatchObject({ cash: 0, perSecond: 0, perClick: 200, shout: "Living that dream." });
    // The first two hires are in sight, and no more.
    expect(v.crew.map((c) => c.id)).toEqual(["tommy", "pluto"]);
    expect(delbies.act(s, { cmd: "hustle" }, at(1))).toEqual({ ok: true });
    expect(s.cash).toBe(200);
    // No more than fifteen clicks count in a second.
    for (let i = 0; i < 40; i++) delbies.act(s, { cmd: "hustle" }, at(1));
    expect(s.hustles).toBe(15);
    expect(delbies.score(s)).toBe(30);
  });

  it("hires and trains, each time for more", () => {
    const s = store();
    expect(delbies.act(s, { cmd: "hire", who: "tommy" }, at(1))).toMatchObject({ ok: false, message: "Not enough in the till." });
    s.cash = 100_000;
    expect(delbies.act(s, { cmd: "hire", who: "tommy" }, at(1)).ok).toBe(true);
    expect(s.cash).toBe(95_000);
    expect(delbies.act(s, { cmd: "hire", who: "tommy" }, at(1)).message).toBe("Already on the payroll.");
    expect(delbies.act(s, { cmd: "train", who: "pluto" }, at(1)).message).toBe("Not on the payroll.");
    expect(delbies.view(s, at(1)).perSecond).toBe(50);
    delbies.act(s, { cmd: "train", who: "tommy" }, at(1));
    delbies.act(s, { cmd: "train", who: "tommy" }, at(1));
    // 5,000 to hire; training costs that, then half as much again.
    expect(s.cash).toBe(95_000 - 5_000 - 7_500);
    expect(s.crew.tommy.level).toBe(3);
    expect(delbies.view(s, at(1)).perSecond).toBe(150);
    // A second of the store: what they bring in comes in.
    const before = s.cash;
    delbies.advance(s, at(2));
    expect(s.cash - before).toBe(150);
    // Tommy follows Delbie about: a click is worth half as much again.
    expect(delbies.view(s, at(2)).perClick).toBe(Math.floor((200 + Math.floor(150 / 20)) * 1.5));
  });

  it("lets the counter get rowdier until Delbie is on it, and takes it out of the till past halfway", () => {
    const s = store();
    hire(s, "pluto", "ricky", "mcmikey");
    const quiet = delbies.view(s, at(0)).perSecond;
    delbies.advance(s, at(120));
    expect(s.chaos).toBeGreaterThan(1000);
    s.chaos = 10_000;
    s.crew.ricky.away = 0;
    expect(delbies.view(s, at(120)).perSecond).toBe(Math.floor(quiet / 2));
    expect(delbies.view(s, at(120)).shout).toBe("What are YOOOOOOU doing?!");
    const loud = s.chaos;
    delbies.act(s, { cmd: "hustle" }, at(121));
    expect(s.chaos).toBeLessThan(loud);
    // B-Rice keeps it chill.
    const calm = store();
    hire(calm, "pluto", "brice");
    calm.chaos = 5000;
    delbies.advance(calm, at(60));
    expect(calm.chaos).toBeLessThan(5000);
  });

  it("winds Delbie up until he is Living That Dream: thirty seconds of triple hustle and a quiet counter", () => {
    const s = store();
    hire(s, "pluto");
    let second = 0;
    let result = { ok: true } as { ok: boolean; message?: string };
    while (s.fever === 0 && second < 60) {
      second++;
      for (let i = 0; i < 10 && s.fever === 0; i++) result = delbies.act(s, { cmd: "hustle" }, at(second));
    }
    expect(result.message).toBe("Living That Dream!");
    expect(s.fever).toBe(30);
    expect(s.stress).toBe(0);
    const v = delbies.view(s, at(second));
    expect(v.shout).toBe("Living that dream!");
    expect(v.perClick).toBe((200 + Math.floor(v.perSecond / 20)) * 3);
    const chaos = s.chaos;
    delbies.advance(s, at(second + 29));
    expect(s.chaos).toBe(chaos);
    delbies.advance(s, at(second + 31));
    expect(s.fever).toBe(0);
    expect(lines(s)).toContain("Delbie stops for breath. Still smiling.");
  });

  it("puts parts on account: the store's name grows, and the money is owed, not lost", () => {
    const s = store();
    hire(s, "pluto");
    delbies.advance(s, at(46));
    const request = delbies.view(s, at(46)).request!;
    expect(request.amount).toBe(5000);
    expect(request.secondsLeft).toBeGreaterThan(25);
    const cash = s.cash;
    expect(delbies.act(s, { cmd: "tab", approve: true }, at(46)).message).toContain("on account");
    expect(s.tabs).toBe(5000);
    expect(s.rep).toBe(10);
    expect(s.cash).toBe(cash);
    expect(delbies.act(s, { cmd: "tab", approve: true }, at(46)).message).toBe("Nobody is asking.");
    // Turning one down costs the store's name, unless McMikey is there to not quite say no.
    s.request = { amount: 5000, until: s.t + 30 };
    delbies.act(s, { cmd: "tab", approve: false }, at(47));
    expect(s.rep).toBe(8);
    hire(s, "mcmikey");
    s.request = { amount: 5000, until: s.t + 30 };
    expect(delbies.act(s, { cmd: "tab", approve: false }, at(48)).message).toContain("McMikey");
    expect(s.rep).toBe(8);
    // Some of them do pay Friday: a hundredth a minute.
    const quiet = store();
    quiet.tabs = 100_000;
    quiet.nextRequest = 1e10;
    delbies.advance(quiet, at(60 - (quiet.t % 60)));
    expect(quiet.tabs).toBe(99_000);
    expect(quiet.cash).toBe(1000);
  });

  it("halves everything when the tabs reach their ceiling, and won't take another", () => {
    const s = store();
    hire(s, "pluto");
    const v = delbies.view(s, at(0));
    expect(v.tabCeiling).toBe(200 * 1800);
    s.tabs = v.tabCeiling;
    const panic = delbies.view(s, at(0));
    expect(panic.panic).toBe(true);
    expect(panic.perSecond).toBe(100);
    s.request = { amount: 5000, until: s.t + 30 };
    expect(delbies.act(s, { cmd: "tab", approve: true }, at(1))).toMatchObject({ ok: false, message: "The books can't take another tab." });
  });

  it("has Two-Thirty chase the tabs from 6:30 until 2:30 by the player's clock, and not a minute after", () => {
    const working = store(9);
    hire(working, "twothirty");
    working.tabs = 1_000_000;
    working.nextRequest = 1e10;
    delbies.advance(working, at(10, 9));
    expect(working.tabs).toBeLessThan(1_000_000 - 30_000);
    expect(delbies.view(working, at(10, 9)).desk).toEqual({ hired: true, on: true, minutes: 5 * 60 + 30 });
    expect(delbies.view(working, at(10, 9)).crew.find((c) => c.id === "twothirty")!.status).toBe("On the clock");

    const late = store(15);
    hire(late, "twothirty", "pluto");
    late.tabs = 1_000_000;
    late.nextRequest = 1e10;
    delbies.advance(late, at(10, 15));
    expect(late.tabs).toBe(1_000_000);
    expect(delbies.view(late, at(10, 15)).desk).toMatchObject({ on: false });
    // After hours the counter knows it: rowdier than it would be without her.
    const without = store(15);
    hire(without, "pluto");
    delbies.advance(without, at(10, 15));
    expect(late.chaos).toBeGreaterThan(without.chaos);
    // She clocks out on the dot.
    const closing = store(14);
    hire(closing, "twothirty");
    delbies.advance(closing, at(31 * 60, 14));
    expect(lines(closing)).toContain("2:30. Two-Thirty has left the building.");
  });

  it("gets some of what is owed back when McMikey disputes it, once every ten minutes", () => {
    const s = store();
    expect(delbies.act(s, { cmd: "dispute" }, at(1)).message).toBe("Nobody here knows how.");
    hire(s, "mcmikey");
    expect(delbies.act(s, { cmd: "dispute" }, at(1)).message).toBe("Nothing is owed.");
    s.tabs = 100_000;
    const cash = s.cash;
    expect(delbies.act(s, { cmd: "dispute" }, at(2)).ok).toBe(true);
    expect(s.tabs).toBe(85_000);
    // 15% of what was owed, and the second of McMikey's own takings that went by.
    expect(s.cash - cash).toBe(15_000 + 8_000);
    expect(delbies.act(s, { cmd: "dispute" }, at(3)).message).toContain("on hold");
    expect(delbies.view(s, at(3)).actions.find((a) => a.key === "dispute")!.waitSeconds).toBeGreaterThan(590);
    expect(delbies.act(s, { cmd: "dispute" }, at(603)).ok).toBe(true);
  });

  it("loses Ricky to the restroom nearly half the time, and Red to sunburned feet now and then", () => {
    const s = store();
    hire(s, "ricky", "red");
    s.nextRequest = 1e10;
    let out = 0;
    let off = 0;
    for (let second = 1; second <= 6 * 3600; second++) {
      delbies.advance(s, at(second));
      if (s.crew.ricky.away > 0) out++;
      if (s.crew.red.away > 0) off++;
    }
    expect(out / (6 * 3600)).toBeGreaterThan(0.3);
    expect(out / (6 * 3600)).toBeLessThan(0.6);
    expect(off).toBeGreaterThan(0);
    expect(lines(s).some((l) => l.includes("Sunburned feet"))).toBe(true);
    // While he is out he brings in nothing.
    const t = store();
    hire(t, "ricky");
    const there = delbies.view(t, at(0)).perSecond;
    t.crew.ricky.away = 100;
    const v = delbies.view(t, at(0));
    expect(there).toBe(4000);
    expect(v.perSecond).toBe(0);
    expect(v.crew.find((c) => c.id === "ricky")!.status).toBe("In the restroom");
  });

  it("pays everyone every ten minutes, Dubs double, and tightens Delbie's belt when it can't", () => {
    const s = store();
    hire(s, "pluto", "dubs");
    s.nextRequest = 1e10;
    expect(delbies.view(s, at(0)).payroll).toEqual({ due: 200 * 60 + 120_000 * 60 * 2, inSeconds: 600 });
    const short = store();
    hire(short, "twothirty");
    short.nextRequest = 1e10;
    delbies.advance(short, at(600));
    expect(short.belt).toBe(1);
    expect(short.cash).toBe(0);
    expect(short.chaos).toBeGreaterThan(2500);
    expect(lines(short).some((l) => l.includes("tightened his belt"))).toBe(true);
    // With the money there, it goes out and nobody notices.
    const fine = store();
    hire(fine, "pluto");
    fine.nextRequest = 1e10;
    delbies.advance(fine, at(600));
    expect(fine.belt).toBe(0);
  });

  it("takes returns out of the till every minute until Snowcap is hired, who is worth 15% besides", () => {
    const s = store();
    hire(s, "wheels");
    s.nextRequest = 1e10;
    delbies.advance(s, at(60));
    expect(s.cash).toBe(6000 * 60 - 7200);
    const t = store();
    hire(t, "wheels", "snowcap");
    t.nextRequest = 1e10;
    expect(delbies.view(t, at(0)).perSecond).toBe(6900);
    delbies.advance(t, at(60));
    expect(t.cash).toBe(6900 * 60);
  });

  it("fills the back room once there are four of them, until the forklift nobody drives clears it", () => {
    const s = store();
    hire(s, "tommy", "pluto", "storytime", "wheels");
    s.nextRequest = 1e10;
    expect(delbies.act(s, { cmd: "forklift" }, at(1)).message).toBe("The back room is fine.");
    s.clutter = 10_000;
    s.chaos = 0;
    const full = delbies.view(s, at(1));
    s.clutter = 0;
    expect(full.perSecond).toBe(Math.floor((delbies.view(s, at(1)).perSecond * 7) / 10));
    s.clutter = 10_000;
    s.cash = 100_000_000;
    expect(delbies.act(s, { cmd: "forklift" }, at(2)).ok).toBe(true);
    expect(s.clutter).toBe(0);
    expect(lines(s).some((l) => l.includes("forklift nobody was driving"))).toBe(true);
  });

  it("has Tommy check in the Saturday freight at six, before anyone else is awake", () => {
    // Friday, eleven at night: seven hours on is six on Saturday morning.
    const friday = (on: number): IdleClock => {
      const local = 23 * 3600 + on;
      return { now: START + on, minute: Math.floor(local / 60) % 1440, day: (5 + Math.floor(local / 86400)) % 7 };
    };
    const s = delbies.newGame(1, friday(0));
    hire(s, "tommy");
    const report = delbies.advance(s, friday(7 * 3600 + 120));
    expect(report.lines).toContain("Tommy Two-Shoes checked in the Saturday freight before anyone else woke up.");
  });

  it("tells you what they got up to while you were out", () => {
    const s = store(22);
    hire(s, "tommy", "pluto", "ricky", "twothirty", "mcmikey");
    s.cash = 100_000_000;
    const report = delbies.advance(s, at(10 * 3600, 22));
    expect(report.seconds).toBe(10 * 3600);
    expect(report.lines[0]).toBe(`While you were out (10 hours), the store took in ${dollars(report.earned)}.`);
    const told = report.lines.join(" ");
    expect(told).toMatch(/Ricky Roost spent \d+ hours? and \d+ minutes? in the restroom\./);
    expect(told).toContain("Pluto ignored 800 phone calls and bred 5 champion rabbits behind Monitor 2.");
    expect(told).toMatch(/Delbie couldn't say no \d+ times: another \$[\d.,KM]+ went out on account\./);
    expect(told).toContain("Two-Thirty chased down");
    expect(told).toContain("Payroll went out 60 times, on time.");
    expect(told).toContain("Nobody was watching the counter. It shows.");
  });

  it("needs B-Rice fed: two hours without pasta and he stops keeping the counter calm", () => {
    const s = store();
    hire(s, "brice", "pluto");
    s.nextRequest = 1e10;
    expect(delbies.view(s, at(0)).breakroom).toMatchObject({ brice: true, hungry: false, hungryInSeconds: 7200, fridge: "pasta" });
    delbies.advance(s, at(7200));
    expect(delbies.view(s, at(7200)).breakroom.hungry).toBe(true);
    expect(delbies.view(s, at(7200)).crew.find((c) => c.id === "brice")!.status).toBe("Hungry");
    expect(lines(s)).toContain("B-Rice has not eaten in hours. The counter can tell.");
    // Hungry, he calms nothing: the counter gets rowdier as if he weren't there.
    s.chaos = 5000;
    delbies.advance(s, at(7260));
    expect(s.chaos).toBeGreaterThan(5000);
    s.fridge = 0;
    expect(delbies.act(s, { cmd: "feed" }, at(7261)).message).toContain("pasta");
    expect(delbies.view(s, at(7261)).breakroom.hungry).toBe(false);
    s.chaos = 5000;
    delbies.advance(s, at(7321));
    expect(s.chaos).toBeLessThan(5000);
  });

  it("shocks Pluto into half his work when B-Rice is given anything but pasta", () => {
    const s = store();
    hire(s, "brice", "pluto");
    s.nextRequest = 1e10;
    const before = delbies.view(s, at(0)).perSecond;
    s.fridge = 2;
    expect(delbies.view(s, at(0)).breakroom.fridge).toBe("salad");
    expect(delbies.act(s, { cmd: "feed" }, at(1)).message).toBe("B-Rice ate salad. Pluto is visibly shocked.");
    const v = delbies.view(s, at(1));
    expect(v.perSecond).toBe(before - 100);
    expect(v.crew.find((c) => c.id === "pluto")!.status).toBe("Shocked");
    expect(v.breakroom.plutoShocked).toBe(600);
    delbies.advance(s, at(602));
    expect(delbies.view(s, at(602)).perSecond).toBe(before);
    // What is in the fridge changes by itself every ten minutes.
    const fridge = delbies.view(s, at(602)).breakroom.fridge;
    const seen = new Set([fridge]);
    for (let i = 1; i <= 12; i++) {
      delbies.advance(s, at(602 + i * 600));
      seen.add(delbies.view(s, at(602 + i * 600)).breakroom.fridge);
    }
    expect(seen.size).toBeGreaterThan(1);
    expect(delbies.act(store(), { cmd: "feed" }, at(1)).message).toBe("Nobody here is hungry.");
  });

  it("keeps Ricky away from the counter while a cinnamon roll is in the breakroom", () => {
    const s = store();
    hire(s, "ricky");
    expect(delbies.act(s, { cmd: "toss" }, at(1)).message).toBe("The breakroom is clear.");
    s.cinnamon = s.t + 7200;
    const v = delbies.view(s, at(1));
    expect(v.perSecond).toBe(0);
    expect(v.breakroom.cinnamon).toBe(true);
    expect(v.crew.find((c) => c.id === "ricky")!.status).toBe("Avoiding the breakroom");
    expect(delbies.act(s, { cmd: "toss" }, at(2)).ok).toBe(true);
    s.crew.ricky.away = 0;
    expect(delbies.view(s, at(2)).perSecond).toBe(4000);
    // Left alone, somebody eats it in the end.
    s.cinnamon = s.t + 7200;
    s.nextRequest = 1e10;
    delbies.advance(s, at(2 + 7200));
    expect(s.cinnamon === 0 || s.cinnamon > s.t).toBe(true);
    // And one turns up by itself sooner or later.
    const t = store();
    hire(t, "ricky");
    let turned = false;
    for (let hour = 1; hour <= 12 && !turned; hour++) {
      delbies.advance(t, at(hour * 3600));
      turned = lines(t).some((l) => l.includes("cinnamon roll"));
    }
    expect(turned).toBe(true);
  });

  it("gives Delbie an afternoon off: more comes in, the counter holds, and Red takes the same days", () => {
    const s = store();
    hire(s, "wheels", "red", "pluto");
    s.nextRequest = 1e10;
    const before = delbies.view(s, at(0)).perSecond;
    expect(delbies.act(s, { cmd: "vacation" }, at(1)).message).toBe("Delbie is off. So is Red, who booked it first.");
    const v = delbies.view(s, at(1));
    expect(v.vacation).toBe(120);
    expect(v.shout).toBe("Gone fishing.");
    expect(v.crew.find((c) => c.id === "red")!.status).toBe("Off: same days as Delbie");
    // Red's money is gone and the rest is half as much again.
    expect(v.perSecond).toBe(Math.floor(((before - 250_000) * 150) / 100));
    expect(delbies.act(s, { cmd: "hustle" }, at(2))).toEqual({ ok: false, message: "Delbie is off this afternoon. For once." });
    const chaos = s.chaos;
    delbies.advance(s, at(100));
    expect(s.chaos).toBe(chaos);
    delbies.advance(s, at(122));
    expect(s.vacation).toBe(0);
    expect(delbies.act(s, { cmd: "vacation" }, at(123)).message).toContain("just had an afternoon off");
    expect(delbies.view(s, at(123)).actions.find((a) => a.key === "vacation")!.waitSeconds).toBeGreaterThan(3400);
    expect(delbies.act(s, { cmd: "vacation" }, at(3602)).ok).toBe(true);
  });

  it("has Pluto shove McMikey on his way past, now and then", () => {
    const s = store(22);
    hire(s, "pluto", "mcmikey");
    const report = delbies.advance(s, at(6 * 3600, 22));
    expect(report.lines.join(" ")).toMatch(/Pluto shoved McMikey (once|\d+ times) on his way past\./);
  });

  it("puts Ears on the radio: guess the garage for a bonus, or let Tommy answer it", () => {
    const s = store();
    hire(s, "ears", "tommy");
    s.nextRequest = 1e10;
    expect(delbies.act(s, { cmd: "radio", pick: 0 }, at(1)).message).toBe("The radio is quiet.");
    delbies.advance(s, at(301));
    const radio = delbies.view(s, at(301)).radio!;
    expect(radio.options).toHaveLength(3);
    expect(new Set(radio.options).size).toBe(3);
    expect(radio.heard).toMatch(/^".*\.\.\. over\."$/);
    expect(radio.options.some((o) => radio.heard.includes(o))).toBe(false);
    expect(radio.rescue).toBe(true);
    // A wrong guess costs nothing but the bonus.
    const wrong = (s.radio!.answer + 1) % 3;
    const cash = s.cash;
    expect(delbies.act(s, { cmd: "radio", pick: wrong }, at(302)).message).toContain("It was ");
    expect(s.cash - cash).toBeLessThan(200_000);
    expect(s.radio).toBeNull();
    // A right one pays two minutes of takings.
    s.radio = { options: [0, 1, 5], answer: 1, until: s.t + 60 };
    const before = s.cash;
    const per = delbies.view(s, at(302)).perSecond;
    expect(delbies.act(s, { cmd: "radio", pick: 1 }, at(303)).message).toContain("Mountain State Muffler it was.");
    expect(s.cash - before).toBeGreaterThanOrEqual(per * 120);
    // Tommy solves one from behind, once every fifteen minutes.
    s.radio = { options: [0, 1, 5], answer: 2, until: s.t + 60 };
    expect(delbies.act(s, { cmd: "rescue" }, at(304)).message).toContain("Tommy came up from behind");
    s.radio = { options: [0, 1, 5], answer: 2, until: s.t + 60 };
    expect(delbies.act(s, { cmd: "rescue" }, at(305)).message).toBe("Tommy is still checking in freight.");
    // Unanswered, he gives up.
    delbies.advance(s, at(400));
    expect(s.radio).toBeNull();
  });

  it("finds each relic in the Lost & Found by doing its deed often enough, for good", () => {
    const s = store();
    hire(s, "brice", "tommy", "wheels", "dubs");
    s.nextRequest = 1e10;
    expect(delbies.view(s, at(0)).relics.map((r) => [r.id, r.found])).toEqual([["tupperware", false], ["backpack", false], ["keys", false], ["iou", false]]);
    // Pasta, five times: the Tupperware, and four hours between meals.
    let said = "";
    for (let i = 0; i < 5; i++) {
      s.fridge = 0;
      said = delbies.act(s, { cmd: "feed" }, at(1 + i)).message!;
    }
    expect(said).toContain("The Tupperware of Penne");
    expect(delbies.view(s, at(5)).breakroom.hungryInSeconds).toBe(4 * 3600);
    // Forty tabs yourself: the Backpack, and returns are halved.
    for (let i = 0; i < 40; i++) {
      s.request = { amount: 1000, until: s.t + 30 };
      s.tabs = 0;
      said = delbies.act(s, { cmd: "tab", approve: true }, at(5)).message!;
    }
    expect(said).toContain("The Mystery Backpack");
    // Three rescues: the Keys, and Tommy doubles a click.
    for (let i = 0; i < 3; i++) {
      s.radio = { options: [0, 1, 5], answer: 0, until: s.t + 60 };
      s.rescueAt = 0;
      said = delbies.act(s, { cmd: "rescue" }, at(5)).message!;
    }
    expect(said).toContain("The Saturday Keys");
    const v = delbies.view(s, at(5));
    expect(v.perClick).toBe((200 + Math.floor(v.perSecond / 20)) * 2);
    // Ten right guesses: the IOU, and the books take half as much again.
    const ceiling = v.tabCeiling;
    for (let i = 0; i < 10; i++) {
      s.radio = { options: [0, 1, 5], answer: 2, until: s.t + 60 };
      said = delbies.act(s, { cmd: "radio", pick: 2 }, at(5)).message!;
    }
    expect(said).toContain("The IOU That Got Away");
    expect(delbies.view(s, at(5)).tabCeiling).toBe(Math.floor((ceiling * 3) / 2));
    expect(delbies.view(s, at(5)).relics.every((r) => r.found && r.done === r.needs)).toBe(true);
    expect(lines(s).filter((l) => l.startsWith("Found in the Lost & Found")).length).toBe(4);
  });

  it("moves the store when the building has taken in enough: everything starts again but what was earned for good", () => {
    const s = store();
    hire(s, "pluto", "tommy", "wheels");
    s.crew.pluto.level = 4;
    s.deeds.tupperware = 5;
    expect(delbies.view(s, at(0)).move).toMatchObject({ moves: 0, can: false, needs: 2_500_000_000, bonusPercent: 0, nextDepartment: "Machine Shop", departments: [] });
    expect(delbies.act(s, { cmd: "move" }, at(1)).message).toContain("more to take in");
    s.here = 2_500_000_000;
    s.cash = 9_999_999;
    s.tabs = 5000;
    s.rep = 800;
    expect(delbies.act(s, { cmd: "move" }, at(2)).message).toBe("Store Move #1: a bigger building, a Machine Shop, and an Old Timer badge for Pluto.");
    expect(s).toMatchObject({ moves: 1, here: 0, cash: 0, tabs: 0, rep: 0, phones: 0 });
    expect(Object.values(s.crew).every((m) => !m.hired && m.level === 1)).toBe(true);
    expect(s.deeds.tupperware).toBe(5);
    const v = delbies.view(s, at(2));
    expect(v.move).toMatchObject({ moves: 1, needs: 20_000_000_000, bonusPercent: 50, nextDepartment: "European Import Wing", departments: ["Machine Shop"] });
    // Pluto is worth twice what he was, and everything brings in half as much again.
    hire(s, "pluto");
    const after = delbies.view(s, at(2));
    expect(after.crew.find((c) => c.id === "pluto")).toMatchObject({ title: "The Veteran · Old Timer", perSecond: 400 });
    expect(after.perSecond).toBe(600);
    // The score is everything ever taken in: a move does not spend it.
    expect(delbies.score(s)).toBeGreaterThan(0);
  });

  it("opens a store saved before any of this, and brings it up to date", () => {
    const s = store();
    hire(s, "pluto", "brice");
    s.cash = 12_345;
    s.earned = 99_999;
    const old = JSON.parse(JSON.stringify(s));
    for (const key of ["fedAt", "fridge", "fridgeAt", "shock", "cinnamon", "vacation", "vacationAt", "radio", "nextRadio", "rescueAt", "deeds", "moves", "here"]) delete old[key];
    old.v = 1;
    const loaded = delbies.load(old)!;
    expect(loaded).not.toBeNull();
    expect(loaded.v).toBe(4);
    expect(loaded).toMatchObject({ cash: 12_345, earned: 99_999, here: 99_999, moves: 0, fedAt: s.t, deeds: { tupperware: 0, backpack: 0, keys: 0, iou: 0 } });
    expect(loaded.crew.pluto.hired).toBe(true);
    // And it plays on.
    delbies.advance(loaded, at(600));
    expect(loaded.cash).toBeGreaterThan(12_345);
    expect(delbies.load({ ...old, v: 4 })).toBeNull();
  });

  describe("the floor plan", () => {
    const active = (s: DelbiesState) => delbies.view(s, at(0)).floor.rules.filter((r) => r.active).map((r) => r.id);
    const everyone = (s: DelbiesState) => hire(s, ...DELBIES_CREW.map((c) => c.id));
    /** A free square beside where a piece stands. */
    const next = (s: DelbiesState, to: DelbiesPieceId): number => {
      const taken = new Set(Object.values(s.floor));
      const here = s.floor[to];
      const { cols, rows } = DELBIES_FLOOR;
      const around = [here - cols, here + cols, here % cols > 0 ? here - 1 : -1, here % cols < cols - 1 ? here + 1 : -1].filter((q) => q >= 0 && q < cols * rows);
      const free = around.find((q) => !taken.has(q));
      if (free === undefined) throw new Error(`no room beside ${to}`);
      return free;
    };
    const put = (s: DelbiesState, piece: DelbiesPieceId, beside: DelbiesPieceId) => delbies.act(s, { cmd: "place", piece, square: next(s, beside) }, at(0));

    it("starts every store with a layout that sets nothing off, everything on a square of its own", () => {
      const s = store();
      everyone(s);
      expect(active(s)).toEqual([]);
      const squares = Object.values(s.floor);
      expect(new Set(squares).size).toBe(DELBIES_PIECES.length);
      expect(squares.every((q) => q >= 0 && q < DELBIES_FLOOR.cols * DELBIES_FLOOR.rows)).toBe(true);
      const v = delbies.view(s, at(0)).floor;
      expect(v.pieces).toHaveLength(12);
      expect(v.rules.map((r) => r.id)).toEqual(DELBIES_FLOOR_RULES.map((r) => r.id));
      // A terminal nobody sits at yet says so.
      expect(delbies.view(store(), at(0)).floor.pieces.find((p) => p.id === "pluto")).toMatchObject({ empty: true, fixed: false });
    });

    it("moves a piece to a square, swapping with whatever stood there, and never the building", () => {
      const s = store();
      const tommy = s.floor.tommy;
      const pluto = s.floor.pluto;
      expect(delbies.act(s, { cmd: "place", piece: "tommy", square: 1 }, at(0))).toEqual({ ok: true });
      expect(s.floor.tommy).toBe(1);
      expect(delbies.act(s, { cmd: "place", piece: "tommy", square: pluto }, at(0)).ok).toBe(true);
      expect(s.floor).toMatchObject({ tommy: pluto, pluto: 1 });
      expect(delbies.act(s, { cmd: "place", piece: "door", square: 3 }, at(0)).message).toBe("The front door is part of the building.");
      expect(delbies.act(s, { cmd: "place", piece: "tommy", square: s.floor.office }, at(0)).message).toBe("Delbie's office is part of the building.");
      expect(delbies.act(s, { cmd: "place", piece: "tommy", square: s.floor.tommy }, at(0))).toEqual({ ok: false });
      expect(new Set(Object.values(s.floor)).size).toBe(DELBIES_PIECES.length);
      expect(tommy).not.toBe(s.floor.tommy);
      // Junk from outside goes nowhere.
      expect(delbies.command({ cmd: "place", piece: "fridge", square: 2 })).toEqual({ cmd: "none" });
      expect(delbies.command({ cmd: "place", piece: "tommy", square: 999 })).toEqual({ cmd: "place", piece: "tommy", square: 23 });
    });

    it("puts each rule in effect when its two things share a side, and only once whoever it is about is hired", () => {
      const pairs: [DelbiesFloorRuleId, DelbiesPieceId, DelbiesPieceId][] = [["shoving", "mcmikey", "pluto"], ["company", "bench", "pluto"], ["walkouts", "dubs", "door"], ["reach", "microwave", "brice"], ["shortwalk", "bathroom", "ricky"], ["firstthing", "warranty", "door"], ["behind", "tommy", "office"], ["busy", "mcmikey", "office"], ["smell", "microwave", "bathroom"]];
      for (const [rule, piece, beside] of pairs) {
        const s = store();
        const said = put(s, piece, beside);
        // Nobody hired: only the rule that is about no one is in effect.
        expect(active(s), rule).toEqual(rule === "smell" ? ["smell"] : []);
        everyone(s);
        expect(active(s), rule).toEqual([rule]);
        if (rule === "smell") expect(said.message).toBe("Nobody wants that: The counter gets rowdier, faster.");
      }
      // Sharing a corner is not sharing a side.
      const s = store();
      everyone(s);
      delbies.act(s, { cmd: "place", piece: "dubs", square: s.floor.door - DELBIES_FLOOR.cols + 1 }, at(0));
      expect(active(s)).toEqual([]);
      // And the far end of one row is not beside the start of the next.
      delbies.act(s, { cmd: "place", piece: "tommy", square: 6 }, at(0));
      expect(active(s)).toEqual([]);
    });

    it("changes real numbers", () => {
      // Good company: Pluto brings in half as much again. Shoving distance: a fifth less from both.
      let s = store();
      hire(s, "pluto", "mcmikey");
      expect(delbies.view(s, at(0)).perSecond).toBe(200 + 8000);
      put(s, "bench", "pluto");
      expect(delbies.view(s, at(0)).perSecond).toBe(300 + 8000);
      put(s, "mcmikey", "pluto");
      expect(delbies.view(s, at(0)).perSecond).toBe(240 + 6400);
      // Looking busy: a quarter more from McMikey.
      s = store();
      hire(s, "mcmikey");
      put(s, "mcmikey", "office");
      expect(delbies.view(s, at(0)).perSecond).toBe(10_000);
      // Right behind him: another half on a click.
      s = store();
      hire(s, "tommy");
      expect(delbies.view(s, at(0)).perClick).toBe(300 + 3);
      put(s, "tommy", "office");
      expect(delbies.view(s, at(0)).perClick).toBe(200 + 2 + 101 + 101);
      // First thing they see: 25% from Snowcap instead of 15%.
      s = store();
      hire(s, "wheels", "snowcap");
      put(s, "warranty", "door");
      expect(delbies.view(s, at(0)).perSecond).toBe(7500);
      // Nobody walks out: returns halved.
      s = store();
      hire(s, "wheels", "dubs");
      s.crew.dubs.away = 1e5;
      s.nextRequest = 1e10;
      const plain = store();
      hire(plain, "wheels", "dubs");
      plain.crew.dubs.away = 1e5;
      plain.nextRequest = 1e10;
      put(s, "dubs", "door");
      delbies.advance(s, at(60));
      delbies.advance(plain, at(60));
      expect(6000 * 60 - s.cash).toBe((6000 * 60 - plain.cash) / 2);
      // Pasta within reach: three hours between meals instead of two.
      s = store();
      hire(s, "brice");
      put(s, "microwave", "brice");
      expect(delbies.view(s, at(0)).breakroom.hungryInSeconds).toBe(3 * 3600);
      // Nobody wants that: the counter gets rowdier, faster.
      s = store();
      const calm = store();
      put(s, "microwave", "bathroom");
      s.nextRequest = calm.nextRequest = 1e10;
      delbies.advance(s, at(100));
      delbies.advance(calm, at(100));
      expect(s.chaos - calm.chaos).toBe(300);
    });

    it("halves Ricky's trips when the bathroom is beside him", () => {
      const share = (near: boolean) => {
        const s = store();
        hire(s, "ricky");
        s.nextRequest = 1e10;
        if (near) put(s, "bathroom", "ricky");
        let out = 0;
        for (let second = 1; second <= 4 * 3600; second++) {
          delbies.advance(s, at(second));
          if (s.crew.ricky.away > 0) out++;
        }
        return out / (4 * 3600);
      };
      expect(share(true)).toBeLessThan(share(false) * 0.8);
    });

    it("goes with the store when it moves, and comes back from storage as it was", () => {
      const s = store();
      put(s, "tommy", "office");
      put(s, "dubs", "door");
      const floor = { ...s.floor };
      s.here = 2_500_000_000;
      expect(delbies.act(s, { cmd: "move" }, at(1)).ok).toBe(true);
      expect(s.floor).toEqual(floor);
      expect(delbies.load(JSON.parse(JSON.stringify(s)))!.floor).toEqual(floor);
      // A floor plan that could not be (two things on one square, or the door moved) is put back as new.
      const fresh = store().floor;
      const doubled = JSON.parse(JSON.stringify(s));
      doubled.floor.tommy = doubled.floor.pluto;
      expect(delbies.load(doubled)!.floor).toEqual(fresh);
      const moved = JSON.parse(JSON.stringify(s));
      moved.floor.door = 1;
      moved.floor.tommy = 18;
      expect(delbies.load(moved)!.floor).toEqual(fresh);
      // A store from the phase before has none: it gets the one that sets nothing off.
      const before = JSON.parse(JSON.stringify(s));
      delete before.floor;
      before.v = 2;
      expect(delbies.load(before)!.floor).toEqual(fresh);
    });
  });

  it("names nobody by anything but a nickname", () => {
    expect(DELBIES_CREW).toHaveLength(12);
    expect(new Set(DELBIES_CREW.map((c) => c.id)).size).toBe(12);
    for (const member of DELBIES_CREW) expect(member.name && member.title && member.blurb && member.quirk).toBeTruthy();
    expect(DELBIES_CREW.filter((c) => c.role === "counter").map((c) => c.name)).toEqual(["Tommy Two-Shoes", "Pluto", "B-Rice", "Ricky Roost", "McMikey", "Dubs"]);
    expect(DELBIES_CREW.filter((c) => c.role === "driver").map((c) => c.name)).toEqual(["Storytime", "Wheels", "Ears", "Red"]);
  });
  it("sends a driver on a hotshot run, and is paid when he is back", () => {
    const s = store();
    expect(delbies.act(s, { cmd: "hotshot" }, at(1)).message).toBe("There is nobody to send. Hire a driver.");
    hire(s, "wheels");
    s.nextRequest = 1e10;
    s.crew.wheels.away = 50;
    expect(delbies.act(s, { cmd: "hotshot" }, at(1)).message).toBe("No driver is in.");
    s.crew.wheels.away = 0;
    expect(delbies.act(s, { cmd: "hotshot" }, at(2)).message).toBe("Not enough in the till for the gas.");
    s.cash = 1_000_000;
    const before = delbies.view(s, at(2)).network.hotshot;
    expect(before).toMatchObject({ hasDriver: true, can: true, cost: 6_000 * 30, pays: 6_000 * 120, outSeconds: 0 });
    expect(delbies.act(s, { cmd: "hotshot" }, at(2)).ok).toBe(true);
    expect(s.cash).toBe(1_000_000 - before.cost);
    expect(delbies.act(s, { cmd: "hotshot" }, at(3)).message).toBe("The hotshot driver is still out.");
    expect(delbies.view(s, at(3)).network.hotshot).toMatchObject({ can: false, outSeconds: 299, pays: before.pays });
    const rep = s.rep;
    delbies.advance(s, at(301));
    expect(s.hotshot).toBe(1);
    const cash = s.cash;
    delbies.advance(s, at(302));
    expect(s.hotshot).toBe(0);
    expect(s.cash).toBeGreaterThanOrEqual(cash + before.pays);
    expect(s.rep).toBeGreaterThanOrEqual(rep + 5);
    expect(lines(s).some((l) => l.startsWith("The hotshot driver is back"))).toBe(true);
    // The truck needs a while before it goes again.
    expect(delbies.act(s, { cmd: "hotshot" }, at(303)).message).toBe("The truck needs a minute.");
    expect(delbies.act(s, { cmd: "hotshot" }, at(902)).ok).toBe(true);
  });

  it("takes a part off another store's truck", () => {
    const s = store();
    s.chaos = 5_000;
    expect(delbies.view(s, at(0)).network.hotshot.worthHere).toBe(5_000);
    expect(delbies.act(s, { cmd: "receive", what: "hotshot", from: "Dubs" }, at(0))).toEqual({ ok: true, message: "A hotshot from Dubs: $50." });
    expect(s).toMatchObject({ cash: 5_000, rep: 10, chaos: 3_000 });
    hire(s, "wheels");
    delbies.act(s, { cmd: "receive", what: "hotshot", from: "x".repeat(80) + "\n" }, at(0));
    expect(s.cash).toBe(5_000 + 6_000 * 300);
    expect(lines(s).at(-1)).toContain("x".repeat(24) + "'s driver");
    // A name that is not one is still somebody.
    expect(delbies.command({ cmd: "receive", what: "hotshot", from: 7 })).toEqual({ cmd: "receive", what: "hotshot", from: "Another store" });
    expect(delbies.command({ cmd: "receive", what: "pasta" })).toEqual({ cmd: "none" });
  });

  it("puts the tabs up for sale, takes them back, and is paid when they sell", () => {
    const s = store();
    s.nextRequest = 1e10;
    s.tabs = 9_999;
    expect(delbies.act(s, { cmd: "list" }, at(0)).message).toBe("Nobody buys less than $100 of tabs.");
    s.tabs = 40_000;
    expect(delbies.view(s, at(0)).network.tabs).toMatchObject({ listed: 0, canList: true, sellsFor: 28_000 });
    expect(delbies.act(s, { cmd: "list" }, at(0)).ok).toBe(true);
    expect(s).toMatchObject({ tabs: 0, listed: 40_000 });
    expect(delbies.act(s, { cmd: "list" }, at(0)).message).toBe("There are tabs up for sale already.");
    expect(delbies.view(s, at(0)).network.tabs).toMatchObject({ listed: 40_000, canList: false, sellsFor: 28_000 });
    // Back on the books, with whatever has been run up since.
    s.tabs = 500;
    expect(delbies.act(s, { cmd: "unlist" }, at(0)).ok).toBe(true);
    expect(s).toMatchObject({ tabs: 40_500, listed: 0 });
    expect(delbies.act(s, { cmd: "unlist" }, at(0)).ok).toBe(false);
    expect(delbies.act(s, { cmd: "receive", what: "sold", from: "Pluto" }, at(0)).message).toBe("Nothing was up for sale.");
    delbies.act(s, { cmd: "list" }, at(0));
    expect(delbies.act(s, { cmd: "receive", what: "sold", from: "Pluto" }, at(0)).message).toBe("Pluto bought your tabs for $283.50.");
    expect(s).toMatchObject({ tabs: 0, listed: 0, cash: 28_350, earned: 28_350 });
  });

  it("buys another store's tabs, and collects twice the price over ten minutes", () => {
    const s = store();
    s.nextRequest = 1e10;
    expect(delbies.act(s, { cmd: "buy", from: "Dubs" }, at(0)).message).toBe("Not enough in the till.");
    s.cash = 5_000;
    expect(delbies.view(s, at(0)).network.tabs).toMatchObject({ buyCost: 5_000, buyPays: 10_000, canBuy: true, collecting: 0 });
    expect(delbies.act(s, { cmd: "buy", from: "Dubs" }, at(0)).ok).toBe(true);
    expect(s).toMatchObject({ cash: 0, paper: 10_000, paperRate: 17 });
    delbies.advance(s, at(100));
    expect(s).toMatchObject({ cash: 1_700, paper: 8_300 });
    delbies.advance(s, at(700));
    expect(s).toMatchObject({ cash: 10_000, paper: 0, paperRate: 0 });
  });

  it("plays the network the same however the time is cut up, and keeps it through a save", () => {
    const run = (step: number) => {
      const s = store();
      hire(s, "wheels", "tommy");
      s.cash = 5_000_000;
      delbies.act(s, { cmd: "hotshot" }, at(1));
      delbies.act(s, { cmd: "buy", from: "Dubs" }, at(1));
      for (let t = 1 + step; t <= 1201; t += step) delbies.advance(s, at(t));
      return s;
    };
    expect(run(1)).toEqual(run(400));
    const s = store();
    hire(s, "wheels");
    s.cash = 5_000_000;
    s.tabs = 20_000;
    delbies.act(s, { cmd: "hotshot" }, at(1));
    delbies.act(s, { cmd: "buy", from: "Dubs" }, at(1));
    delbies.act(s, { cmd: "list" }, at(1));
    expect(delbies.load(JSON.parse(JSON.stringify(s)))).toEqual(s);
    // A store from before the network opens with none of it.
    const old = JSON.parse(JSON.stringify(s));
    for (const key of ["hotshot", "hotshotPay", "hotshotAt", "listed", "paper", "paperRate"]) delete old[key];
    old.v = 3;
    expect(delbies.load(old)).toMatchObject({ v: 4, hotshot: 0, listed: 0, paper: 0, hotshotAt: s.t });
    expect(delbies.load({ ...JSON.parse(JSON.stringify(s)), listed: -1 })).toBeNull();
    // A move leaves it all behind.
    s.here = 1e15;
    delbies.act(s, { cmd: "move" }, at(2));
    expect(s).toMatchObject({ hotshot: 0, hotshotPay: 0, listed: 0, paper: 0, paperRate: 0 });
  });
});
