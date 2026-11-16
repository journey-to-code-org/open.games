// Delbie's own rules: what a hustle is worth and what it does to the counter, hiring and training,
// each of the crew's habits, tabs and who collects them, payroll, and the report of a night away.
import { describe, expect, it } from "vitest";
import { DELBIES_CREW, delbies, dollars, type DelbiesCrewId, type DelbiesState, type IdleClock } from "../src/index.js";

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
    expect(lines(s).some((l) => l.includes("restroom") || l.includes("Sunburned feet"))).toBe(true);
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

  it("names nobody by anything but a nickname", () => {
    expect(DELBIES_CREW).toHaveLength(12);
    expect(new Set(DELBIES_CREW.map((c) => c.id)).size).toBe(12);
    for (const member of DELBIES_CREW) expect(member.name && member.title && member.blurb && member.quirk).toBeTruthy();
    expect(DELBIES_CREW.filter((c) => c.role === "counter").map((c) => c.name)).toEqual(["Tommy Two-Shoes", "Pluto", "B-Rice", "Ricky Roost", "McMikey", "Dubs"]);
    expect(DELBIES_CREW.filter((c) => c.role === "driver").map((c) => c.name)).toEqual(["Storytime", "Wheels", "Ears", "Red"]);
  });
});
