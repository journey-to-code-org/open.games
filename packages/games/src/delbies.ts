// Delbie's Daycare & Geriatrics: the first game on the idle kit. You are Delbie, who owns a parts
// store, works harder than everyone in it put together, and cannot say no to anyone. The counter
// crew (the Daycare) needs watching; the delivery drivers (the Geriatrics) need dispatching; the
// customers want everything on account.
//
// This is the game's first phase, the part everything else stands on:
//   - Hustle: every click is Delbie doing something himself. It brings in money, quietens the
//     counter, and winds him up. Wound up all the way, he is Living That Dream: half a minute in
//     which a click is worth three.
//   - The crew: thirteen hires, each bringing in money every second and each with a habit. One is
//     in the restroom nearly half the time. One takes extra days off. One only works until half
//     past two.
//   - Tabs: customers ask for parts on account. Saying yes builds the store's name and the money
//     is owed, not lost, but it only comes back while the one person who chases invoices is on the
//     clock. Let the tabs reach their ceiling and payroll panic halves everything.
//   - Chaos: the counter gets rowdier by the second unless Delbie is on it. Past halfway it eats
//     into the takings.
//   - Payroll: every ten minutes, whether the money is there or not.
//   - It carries on while you are away, and tells you what they got up to.
//
// Money is in cents and meters in ten-thousandths, so every number is whole. Still to come: the
// crew's hazards and mini-games, relics, the store move, the breakroom grid, and other stores.
import { clockAt, dollars, safeClock, type IdleClock, type IdleGame, type IdleReport, type IdleResult } from "./idle.js";
import { nextRandom } from "./table.js";

const VERSION = 1;
/** Twelve hours: longer away than that and the rest is not played. */
const AWAY_CAP = 12 * 60 * 60;
const CEILING = 9_000_000_000_000_000;
const FULL = 10_000;
const PAYROLL_EVERY = 600;
const FEVER_SECONDS = 30;
const DISPUTE_EVERY = 600;
const MAX_LEVEL = 25;
/** Half past six until half past two, in minutes since midnight. */
const CLOCK_IN = 6 * 60 + 30;
const CLOCK_OUT = 14 * 60 + 30;
const CLICKS_A_SECOND = 15;
const PHONE_COSTS = [5_000, 40_000, 320_000, 2_500_000, 20_000_000, 160_000_000, 1_300_000_000];

export type DelbiesCrewId = "tommy" | "pluto" | "storytime" | "brice" | "ricky" | "wheels" | "mcmikey" | "twothirty" | "ears" | "dubs" | "red" | "snowcap";
export type DelbiesRole = "counter" | "driver" | "office";

interface Hire {
  id: DelbiesCrewId;
  name: string;
  title: string;
  role: DelbiesRole;
  /** What hiring costs, in cents. */
  cost: number;
  /** What they bring in a second at level 1, in cents. */
  sales: number;
  /** How much rowdier (or calmer) they make the counter each second. */
  chaos: number;
  blurb: string;
  quirk: string;
}

/** The crew, in the order they can be afforded. Counter people are the Daycare; drivers are the Geriatrics. */
export const DELBIES_CREW: Hire[] = [
  { id: "tommy", name: "Tommy Two-Shoes", title: "The Goody-Two-Shoes", role: "counter", cost: 5_000, sales: 50, chaos: 1, blurb: "First one in on Saturday, checking in the freight.", quirk: "Follows Delbie about like a puppy: every click of yours is worth half as much again." },
  { id: "pluto", name: "Pluto", title: "The Veteran", role: "counter", cost: 20_000, sales: 200, chaos: 5, blurb: "Been through every store move. Knows where every part ever was.", quirk: "Does not answer the phone. Or you. Breeds rabbits." },
  { id: "storytime", name: "Storytime", title: "The Storyteller", role: "driver", cost: 60_000, sales: 500, chaos: 0, blurb: "Slowest delivery in the fleet.", quirk: "Stays forty minutes telling stories, and they love him for it: the store's name grows with every run." },
  { id: "brice", name: "B-Rice", title: "The Heavy Hitter", role: "counter", cost: 150_000, sales: 900, chaos: -8, blurb: "Pulls up in the white Crown Vic. Runs on leftover pasta.", quirk: "Keeps the counter chill: calms the chaos every second." },
  { id: "ricky", name: "Ricky Roost", title: "The Phantom Tech", role: "counter", cost: 400_000, sales: 4_000, chaos: 3, blurb: "Former garage mechanic with great diagnostic tips.", quirk: "When he is at the counter. He is in the restroom nearly half the time, tending chickens on his phone." },
  { id: "wheels", name: "Wheels", title: "The Reluctant Driver", role: "driver", cost: 1_500_000, sales: 6_000, chaos: 0, blurb: "Hates driving. Drives anyway.", quirk: "Nothing on the road rattles him: steady money, every second." },
  { id: "mcmikey", name: "McMikey", title: "The Tech Wizard", role: "counter", cost: 6_000_000, sales: 8_000, chaos: 3, blurb: "Remoted into his home PC, asking an AI to fix the spreadsheets.", quirk: "Never technically wrong: turning a tab down costs the store's name nothing. Can dispute what is owed and get some of it back." },
  { id: "twothirty", name: "Two-Thirty", title: "HR & Billing", role: "office", cost: 15_000_000, sales: 0, chaos: -6, blurb: "The only sane person in the building.", quirk: "Chases down tabs from 6:30 until 2:30, by your clock. At 2:30 she is gone, and the counter knows it." },
  { id: "ears", name: "Ears", title: "The Speed Demon", role: "driver", cost: 80_000_000, sales: 40_000, chaos: 0, blurb: "Fastest driver there is.", quirk: "Nobody understands a word he says on the radio. The parts get there anyway." },
  { id: "dubs", name: "Dubs", title: "The VW Whisperer", role: "counter", cost: 600_000_000, sales: 120_000, chaos: 3, blurb: "Former Volkswagen tech. If it is European, it is his.", quirk: "Costs double on payday. Delbie says that is where the weight went." },
  { id: "red", name: "Red", title: "The Vacation Sniper", role: "driver", cost: 4_000_000_000, sales: 250_000, chaos: 0, blurb: "Tall, red hair, perfect beard. Customers ask for him.", quirk: "Takes extra days off for sunburned feet, usually when Delbie had plans." },
  { id: "snowcap", name: "Snowcap", title: "Warranty & Returns", role: "office", cost: 25_000_000_000, sales: 0, chaos: 0, blurb: "Tall, snow-white hair, friendly until you bring back a part you fitted wrong.", quirk: "No more returns eating into the takings, and everything brings in 15% more." },
];
const HIRE = Object.fromEntries(DELBIES_CREW.map((h) => [h.id, h])) as Record<DelbiesCrewId, Hire>;
const IDS = DELBIES_CREW.map((h) => h.id);

export type DelbiesCommand =
  | { cmd: "none" }
  | { cmd: "hustle" }
  | { cmd: "hire"; who: DelbiesCrewId }
  | { cmd: "train"; who: DelbiesCrewId }
  | { cmd: "tab"; approve: boolean }
  | { cmd: "dispute" }
  | { cmd: "forklift" }
  | { cmd: "phones" };

interface Member {
  hired: boolean;
  level: number;
  /** Seconds until they are back: the restroom, or days off. */
  away: number;
}

/** What is counted while time is played, for the report when it has been a while. */
interface Tally {
  earned: number;
  restroom: number;
  daysOff: number;
  delbieYes: number;
  delbieYesAmount: number;
  collected: number;
  paid: number;
  short: number;
  returns: number;
  saturdays: number;
}

export interface DelbiesState {
  v: number;
  rng: number;
  /** The second this state is up to date to. */
  t: number;
  /** When the store opened. */
  born: number;
  /** In cents, like every amount below. */
  cash: number;
  /** Everything ever taken in. */
  earned: number;
  /** The store's name: built by putting parts on account and by deliveries. */
  rep: number;
  /** What customers owe. */
  tabs: number;
  /** 0 to 10,000. */
  chaos: number;
  stress: number;
  /** Seconds of Living That Dream left. */
  fever: number;
  /** How full the back room is, 0 to 10,000. */
  clutter: number;
  /** How many notches Delbie has tightened his belt. */
  belt: number;
  phones: number;
  crew: Record<DelbiesCrewId, Member>;
  /** Someone asking for parts on account, and the second they give up. */
  request: { amount: number; until: number } | null;
  nextRequest: number;
  payrollAt: number;
  disputeAt: number;
  /** Clicks this second, so that no more than fifteen count. */
  clicks: number;
  hustles: number;
  /** The last things that happened, newest last. */
  log: { at: number; text: string }[];
}

const clamp = (n: number, low: number, high: number) => (n < low ? low : n > high ? high : n);
const repLevel = (s: DelbiesState) => Math.floor(Math.sqrt(s.rep / 20));
const present = (m: Member) => m.hired && m.away === 0;
const onTheClock = (clock: IdleClock) => clock.minute >= CLOCK_IN && clock.minute < CLOCK_OUT;
const note = (s: DelbiesState, text: string) => {
  s.log.push({ at: s.t, text });
  if (s.log.length > 40) s.log.shift();
};

/** What the store takes in a second as things stand, in cents. */
function income(s: DelbiesState): number {
  let base = 0;
  for (const id of IDS) if (present(s.crew[id])) base += HIRE[id].sales * s.crew[id].level;
  let percent = 100 + 3 * repLevel(s);
  if (s.crew.snowcap.hired) percent += 15;
  let total = Math.floor((base * percent) / 100);
  // Past halfway, chaos eats into the takings: down to half when the counter is in uproar.
  if (s.chaos > FULL / 2) total = Math.floor((total * (FULL - (s.chaos - FULL / 2))) / FULL);
  if (panicking(s)) total = Math.floor(total / 2);
  if (s.clutter >= FULL) total = Math.floor((total * 7) / 10);
  return Math.min(CEILING / 100_000, total);
}
/** The most customers can owe before the books can't take it: half an hour of takings, and never less than $500. */
function tabCeiling(s: DelbiesState): number {
  let base = 0;
  for (const id of IDS) if (s.crew[id].hired) base += HIRE[id].sales * s.crew[id].level;
  return Math.max(50_000, base * 1800);
}
const panicking = (s: DelbiesState) => s.tabs >= tabCeiling(s);
function clickWorth(s: DelbiesState): number {
  // A couple of dollars (doubled by every set of better phones) and a twentieth of a second's takings.
  let worth = 200 * (1 << s.phones) + Math.floor(income(s) / 20);
  if (s.crew.tommy.hired) worth += Math.floor(worth / 2);
  return s.fever > 0 ? worth * 3 : worth;
}
function payroll(s: DelbiesState): number {
  let due = 0;
  for (const id of IDS) {
    const m = s.crew[id];
    if (!m.hired) continue;
    // A minute of what they bring in; the office is paid a flat rate for the store's size.
    const wage = HIRE[id].sales ? HIRE[id].sales * m.level * 60 : Math.floor(HIRE[id].cost / 200) * m.level;
    due += id === "dubs" ? wage * 2 : wage;
  }
  return due;
}
/** Training costs half as much again each time: the first costs what hiring did. */
function trainCost(id: DelbiesCrewId, level: number): number {
  let cost = HIRE[id].cost;
  for (let i = 1; i < level; i++) cost = Math.ceil((cost * 3) / 2);
  return cost;
}
const forkliftCost = (s: DelbiesState) => Math.max(5_000, income(s) * 30);
function take(s: DelbiesState, cents: number, tally?: Tally) {
  s.cash = Math.min(CEILING, s.cash + cents);
  s.earned = Math.min(CEILING, s.earned + cents);
  if (tally) tally.earned += cents;
}

/** One second of the store. */
function second(s: DelbiesState, clock: IdleClock, rand: () => number, tally: Tally) {
  s.t = clock.now;
  s.clicks = 0;
  const crew = s.crew;

  // Who has wandered off, and who is back.
  for (const id of IDS) if (crew[id].away > 0) crew[id].away--;
  if (crew.ricky.hired) {
    if (crew.ricky.away > 0) tally.restroom++;
    else if (rand() < 1 / 220) {
      crew.ricky.away = 180;
      note(s, "Ricky Roost has gone to the restroom. He took his phone.");
    }
  }
  if (crew.red.hired && crew.red.away === 0 && rand() < 1 / 2400) {
    crew.red.away = 420;
    tally.daysOff++;
    note(s, "Red is taking an extra week off. Sunburned feet.");
  }

  const coming = income(s);
  if (coming > 0) take(s, coming, tally);
  // Storytime's deliveries are slow, and every one of them makes the store's name.
  if (present(crew.storytime) && s.t % 40 === 0) s.rep += crew.storytime.level;

  // The counter gets rowdier, unless someone is keeping it in hand.
  let rowdier = 2;
  for (const id of IDS) if (present(crew[id]) && id !== "twothirty") rowdier += HIRE[id].chaos;
  if (crew.twothirty.hired) rowdier += onTheClock(clock) ? HIRE.twothirty.chaos : 4;
  if (s.fever === 0) s.chaos = clamp(s.chaos + rowdier, 0, FULL);
  if (s.fever > 0) {
    if (--s.fever === 0) note(s, "Delbie stops for breath. Still smiling.");
  } else if (s.stress > 0) s.stress = Math.max(0, s.stress - 5);

  // Parts on account.
  if (s.request && s.t >= s.request.until) {
    // Nobody answered. It is Delbie: more often than not he says yes on his way past.
    if (rand() < 0.6 && s.tabs < tabCeiling(s)) {
      approve(s, s.request.amount);
      tally.delbieYes++;
      tally.delbieYesAmount += s.request.amount;
      note(s, `Delbie couldn't say no: ${dollars(s.request.amount)} more on account.`);
    }
    s.request = null;
  }
  if (!s.request && s.t >= s.nextRequest) {
    const amount = Math.max(2_000, Math.floor((coming * 25) / 100) * 100);
    s.request = { amount, until: s.t + 30 };
    s.nextRequest = s.t + 40 + Math.floor(rand() * 50);
  }
  // Some of them do pay Friday: a hundredth of what is owed comes in each minute by itself.
  if (s.tabs > 0 && s.t % 60 === 0) {
    const paid = Math.max(1, Math.floor(s.tabs / 100));
    s.tabs -= Math.min(s.tabs, paid);
    take(s, Math.min(s.tabs + paid, paid), tally);
  }
  if (crew.twothirty.hired && onTheClock(clock) && s.tabs > 0) {
    const got = Math.min(s.tabs, Math.max(100, Math.floor((s.tabs * crew.twothirty.level) / 250)));
    s.tabs -= got;
    take(s, got, tally);
    tally.collected += got;
  }
  if (crew.twothirty.hired && clock.minute === CLOCK_OUT && s.t % 60 === 0) note(s, "2:30. Two-Thirty has left the building.");

  // The back room fills up once there are enough of them selling out of it.
  if (IDS.filter((id) => crew[id].hired).length >= 4) s.clutter = Math.min(FULL, s.clutter + 8);

  // Returns, a minute's worth at a time, until someone is hired to stare them down.
  if (!crew.snowcap.hired && s.t % 60 === 0 && coming > 0) {
    const back = Math.min(s.cash, Math.floor((coming * 12) / 10));
    s.cash -= back;
    tally.returns += back;
  }

  // Saturday, six in the morning: Tommy has the freight checked in before anyone else is awake.
  if (crew.tommy.hired && clock.day === 6 && clock.minute === 360 && s.t % 60 === 0) {
    take(s, coming * 300, tally);
    tally.saturdays++;
    note(s, "Tommy Two-Shoes checked in the Saturday freight before anyone else woke up.");
  }

  if (s.t >= s.payrollAt) {
    s.payrollAt = s.t + PAYROLL_EVERY;
    const due = payroll(s);
    if (due > 0) {
      if (s.cash >= due) {
        s.cash -= due;
        tally.paid++;
      } else {
        s.cash = 0;
        s.chaos = Math.min(FULL, s.chaos + 3000);
        s.belt++;
        tally.short++;
        note(s, "Payroll came up short. Delbie made up the difference and tightened his belt a notch.");
      }
    }
  }
}

function approve(s: DelbiesState, amount: number) {
  s.tabs = Math.min(CEILING, s.tabs + amount);
  // A favour is a favour, whatever it cost: the store's name grows the same for each.
  s.rep += 10;
}

function emptyTally(): Tally {
  return { earned: 0, restroom: 0, daysOff: 0, delbieYes: 0, delbieYesAmount: 0, collected: 0, paid: 0, short: 0, returns: 0, saturdays: 0 };
}

const span = (seconds: number) => {
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} ${minutes === 1 ? "minute" : "minutes"}`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return `${hours} ${hours === 1 ? "hour" : "hours"}${rest ? ` and ${rest} ${rest === 1 ? "minute" : "minutes"}` : ""}`;
};

/** What the time away came to, as the store would tell it. */
function incidentLog(s: DelbiesState, seconds: number, tally: Tally): string[] {
  const lines = [`While you were out (${span(seconds)}), the store took in ${dollars(tally.earned)}.`];
  if (tally.restroom >= 60) lines.push(`Ricky Roost spent ${span(tally.restroom)} in the restroom.`);
  if (s.crew.pluto.hired) {
    const calls = Math.floor(seconds / 45);
    const rabbits = Math.floor(seconds / 7200);
    lines.push(`Pluto ignored ${calls} phone ${calls === 1 ? "call" : "calls"}${rabbits ? ` and bred ${rabbits === 1 ? "a champion rabbit" : `${rabbits} champion rabbits`} behind Monitor 2` : ""}.`);
  }
  if (tally.delbieYes) lines.push(`Delbie couldn't say no ${tally.delbieYes === 1 ? "once" : `${tally.delbieYes} times`}: another ${dollars(tally.delbieYesAmount)} went out on account.`);
  if (tally.collected) lines.push(`Two-Thirty chased down ${dollars(tally.collected)} of tabs.`);
  if (tally.daysOff) lines.push(`Red took ${tally.daysOff === 1 ? "an extra week" : `${tally.daysOff} extra weeks`} off for sunburned feet.`);
  if (tally.saturdays) lines.push("Tommy Two-Shoes checked in the Saturday freight before anyone else woke up.");
  if (tally.returns) lines.push(`${dollars(tally.returns)} of parts came back, fitted wrong.`);
  if (tally.short) lines.push(`Payroll came up short ${tally.short === 1 ? "once" : `${tally.short} times`}. Delbie is down ${tally.short === 1 ? "a belt notch" : `${tally.short} belt notches`}.`);
  else if (tally.paid) lines.push(`Payroll went out ${tally.paid === 1 ? "once" : `${tally.paid} times`}, on time.`);
  if (s.chaos >= FULL * 0.9) lines.push("Nobody was watching the counter. It shows.");
  return lines;
}

function advance(s: DelbiesState, given: IdleClock): IdleReport {
  const clock = safeClock(given);
  const behind = clock.now - s.t;
  if (behind <= 0) return { seconds: 0, skipped: 0, lines: [], earned: 0 };
  const seconds = Math.min(behind, AWAY_CAP);
  const skipped = behind - seconds;
  // Time that is not played is simply gone: the store picks up from where the clock is now.
  if (skipped > 0) {
    s.payrollAt += skipped;
    s.nextRequest += skipped;
    s.disputeAt += skipped;
    if (s.request) s.request.until += skipped;
    s.t += skipped;
  }
  const rand = nextRandom(s);
  const tally = emptyTally();
  for (let at = s.t + 1; at <= clock.now; at++) second(s, clockAt(clock, at), rand, tally);
  return { seconds, skipped, earned: tally.earned, lines: seconds >= 300 ? incidentLog(s, seconds, tally) : [] };
}

function safeCommand(given: unknown): DelbiesCommand {
  const g = (given && typeof given === "object" ? given : {}) as Record<string, unknown>;
  const who = IDS.includes(g.who as DelbiesCrewId) ? (g.who as DelbiesCrewId) : null;
  switch (g.cmd) {
    case "hustle":
    case "dispute":
    case "forklift":
    case "phones":
      return { cmd: g.cmd };
    case "hire":
    case "train":
      return who ? { cmd: g.cmd, who } : { cmd: "none" };
    case "tab":
      return { cmd: "tab", approve: g.approve === true };
    default:
      return { cmd: "none" };
  }
}

function act(s: DelbiesState, given: DelbiesCommand, clock: IdleClock): IdleResult {
  advance(s, clock);
  const command = safeCommand(given);
  const pay = (cents: number) => {
    if (s.cash < cents) return false;
    s.cash -= cents;
    return true;
  };
  switch (command.cmd) {
    case "none":
      return { ok: false };
    case "hustle": {
      if (s.clicks >= CLICKS_A_SECOND) return { ok: false };
      s.clicks++;
      s.hustles++;
      take(s, clickWorth(s));
      s.chaos = Math.max(0, s.chaos - 150);
      if (s.fever === 0) {
        s.stress = Math.min(FULL, s.stress + 60);
        if (s.stress >= FULL) {
          s.stress = 0;
          s.fever = FEVER_SECONDS;
          note(s, "Delbie is Living That Dream.");
          return { ok: true, message: "Living That Dream!" };
        }
      }
      return { ok: true };
    }
    case "hire": {
      const m = s.crew[command.who];
      if (m.hired) return { ok: false, message: "Already on the payroll." };
      if (!pay(HIRE[command.who].cost)) return { ok: false, message: "Not enough in the till." };
      m.hired = true;
      m.level = 1;
      note(s, `${HIRE[command.who].name} starts today.`);
      return { ok: true, message: `${HIRE[command.who].name} starts today.` };
    }
    case "train": {
      const m = s.crew[command.who];
      if (!m.hired) return { ok: false, message: "Not on the payroll." };
      if (m.level >= MAX_LEVEL) return { ok: false, message: "Knows everything there is to know." };
      if (!pay(trainCost(command.who, m.level))) return { ok: false, message: "Not enough in the till." };
      m.level++;
      return { ok: true };
    }
    case "tab": {
      if (!s.request) return { ok: false, message: "Nobody is asking." };
      const { amount } = s.request;
      if (!command.approve) {
        s.request = null;
        if (!s.crew.mcmikey.hired) s.rep = Math.max(0, s.rep - 2);
        return { ok: true, message: s.crew.mcmikey.hired ? "McMikey told them something that was not quite a no." : "They left without it. Word gets round." };
      }
      if (s.tabs >= tabCeiling(s)) return { ok: false, message: "The books can't take another tab." };
      s.request = null;
      approve(s, amount);
      return { ok: true, message: `${dollars(amount)} on account. They swore they'd pay Friday.` };
    }
    case "dispute": {
      if (!s.crew.mcmikey.hired) return { ok: false, message: "Nobody here knows how." };
      if (s.t < s.disputeAt) return { ok: false, message: "McMikey is still on hold with the last one." };
      if (s.tabs <= 0) return { ok: false, message: "Nothing is owed." };
      const got = Math.floor((s.tabs * 15) / 100);
      s.tabs -= got;
      take(s, got);
      s.disputeAt = s.t + DISPUTE_EVERY;
      note(s, `McMikey disputed his way to ${dollars(got)}, and explained three fallacies nobody asked about.`);
      return { ok: true, message: `${dollars(got)} back.` };
    }
    case "forklift": {
      if (s.clutter < FULL * 0.3) return { ok: false, message: "The back room is fine." };
      if (!pay(forkliftCost(s))) return { ok: false, message: "Not enough in the till." };
      s.clutter = 0;
      note(s, "A forklift nobody was driving cleared the back room in five seconds.");
      return { ok: true, message: "The back room is clear." };
    }
    case "phones": {
      const cost = PHONE_COSTS[s.phones];
      if (cost === undefined) return { ok: false, message: "No better phones are made." };
      if (!pay(cost)) return { ok: false, message: "Not enough in the till." };
      s.phones++;
      return { ok: true };
    }
  }
}

// ---- The view ------------------------------------------------------------------------------------

export interface DelbiesView {
  cash: number;
  perSecond: number;
  perClick: number;
  earned: number;
  rep: number;
  repLevel: number;
  /** Meters, in thousandths. */
  chaos: number;
  stress: number;
  clutter: number;
  /** Seconds of Living That Dream left. */
  fever: number;
  /** Tabs are at their ceiling: everything is halved until some are paid. */
  panic: boolean;
  tabs: number;
  tabCeiling: number;
  belt: number;
  /** What Delbie is saying. */
  shout: string;
  request: { amount: number; secondsLeft: number } | null;
  payroll: { due: number; inSeconds: number };
  /** The billing desk: whether anyone is at it, and how long until that changes. */
  desk: { hired: boolean; on: boolean; minutes: number };
  crew: { id: DelbiesCrewId; name: string; title: string; role: DelbiesRole; blurb: string; quirk: string; hired: boolean; level: number; maxed: boolean; cost: number; can: boolean; perSecond: number; status: string }[];
  actions: { key: "dispute" | "forklift" | "phones"; label: string; hint: string; cost: number; can: boolean; waitSeconds: number }[];
  log: { at: number; text: string }[];
}

function view(s: DelbiesState, given: IdleClock): DelbiesView {
  const clock = safeClock(given);
  const on = onTheClock(clock);
  const hiredCount = IDS.filter((id) => s.crew[id].hired).length;
  // The next two hires are always in sight: something to save for.
  let unhiredShown = 0;
  const crew: DelbiesView["crew"] = [];
  for (const h of DELBIES_CREW) {
    const m = s.crew[h.id];
    if (!m.hired && ++unhiredShown > 2) continue;
    const cost = m.hired ? trainCost(h.id, m.level) : h.cost;
    let status = "";
    if (m.hired && m.away > 0) status = h.id === "ricky" ? "In the restroom" : "Off: sunburned feet";
    else if (m.hired && h.id === "twothirty") status = on ? "On the clock" : "Clocked out";
    crew.push({ id: h.id, name: h.name, title: h.title, role: h.role, blurb: h.blurb, quirk: h.quirk, hired: m.hired, level: m.level, maxed: m.hired && m.level >= MAX_LEVEL, cost, can: s.cash >= cost && !(m.hired && m.level >= MAX_LEVEL), perSecond: m.hired ? h.sales * m.level : h.sales, status });
  }
  const actions: DelbiesView["actions"] = [];
  const phoneCost = PHONE_COSTS[s.phones];
  if (phoneCost !== undefined) actions.push({ key: "phones", label: `Better phones ${s.phones + 1}`, hint: "Doubles what Delbie's own hustle is worth", cost: phoneCost, can: s.cash >= phoneCost, waitSeconds: 0 });
  if (s.crew.mcmikey.hired) actions.push({ key: "dispute", label: "PayPal dispute", hint: "McMikey gets back 15% of what is owed, and rants", cost: 0, can: s.tabs > 0 && s.t >= s.disputeAt, waitSeconds: Math.max(0, s.disputeAt - s.t) });
  if (hiredCount >= 4) actions.push({ key: "forklift", label: "Summon the Forklift Ghost", hint: "Clears the back room. A full back room costs 30% of the takings", cost: forkliftCost(s), can: s.clutter >= FULL * 0.3 && s.cash >= forkliftCost(s), waitSeconds: 0 });
  const minutes = on ? CLOCK_OUT - clock.minute : (CLOCK_IN - clock.minute + 1440) % 1440;
  return {
    cash: s.cash,
    perSecond: income(s),
    perClick: clickWorth(s),
    earned: s.earned,
    rep: s.rep,
    repLevel: repLevel(s),
    chaos: Math.round(s.chaos / 10),
    stress: Math.round(s.stress / 10),
    clutter: Math.round(s.clutter / 10),
    fever: s.fever,
    panic: panicking(s),
    tabs: s.tabs,
    tabCeiling: tabCeiling(s),
    belt: s.belt,
    shout: s.fever > 0 ? "Living that dream!" : s.chaos >= FULL / 2 ? "What are YOOOOOOU doing?!" : panicking(s) ? "Somebody call somebody who owes us." : "Living that dream.",
    request: s.request ? { amount: s.request.amount, secondsLeft: Math.max(0, s.request.until - s.t) } : null,
    payroll: { due: payroll(s), inSeconds: Math.max(0, s.payrollAt - s.t) },
    desk: { hired: s.crew.twothirty.hired, on, minutes },
    crew,
    actions,
    log: s.log.slice(-12),
  };
}

// ---- A new store, and one out of storage -----------------------------------------------------------

function newGame(seed: number, given: IdleClock): DelbiesState {
  const clock = safeClock(given);
  return {
    v: VERSION,
    rng: seed >>> 0,
    t: clock.now,
    born: clock.now,
    cash: 0,
    earned: 0,
    rep: 0,
    tabs: 0,
    chaos: 0,
    stress: 0,
    fever: 0,
    clutter: 0,
    belt: 0,
    phones: 0,
    crew: Object.fromEntries(IDS.map((id) => [id, { hired: false, level: 1, away: 0 }])) as Record<DelbiesCrewId, Member>,
    request: null,
    nextRequest: clock.now + 45,
    payrollAt: clock.now + PAYROLL_EVERY,
    disputeAt: clock.now,
    clicks: 0,
    hustles: 0,
    log: [],
  };
}

function load(saved: unknown): DelbiesState | null {
  if (!saved || typeof saved !== "object") return null;
  const g = saved as Record<string, unknown>;
  if (g.v !== VERSION) return null;
  const whole = (value: unknown, low: number, high: number): number | null => (typeof value === "number" && Number.isSafeInteger(value) && value >= low && value <= high ? value : null);
  const t = whole(g.t, 0, 9_000_000_000);
  if (t === null) return null;
  const s = newGame(0, { now: t, minute: 0, day: 0 });
  const amounts: [keyof DelbiesState, number][] = [["rng", 2 ** 32 - 1], ["born", 9_000_000_000], ["cash", CEILING], ["earned", CEILING], ["rep", CEILING], ["tabs", CEILING], ["chaos", FULL], ["stress", FULL], ["fever", FEVER_SECONDS], ["clutter", FULL], ["belt", 1_000_000], ["phones", PHONE_COSTS.length], ["nextRequest", 9_100_000_000], ["payrollAt", 9_100_000_000], ["disputeAt", 9_100_000_000], ["clicks", CLICKS_A_SECOND], ["hustles", CEILING]];
  for (const [key, high] of amounts) {
    const value = whole(g[key], 0, high);
    if (value === null) return null;
    (s[key] as number) = value;
  }
  const crew = (g.crew && typeof g.crew === "object" ? g.crew : {}) as Record<string, unknown>;
  for (const id of IDS) {
    const m = (crew[id] && typeof crew[id] === "object" ? crew[id] : {}) as Record<string, unknown>;
    s.crew[id] = { hired: m.hired === true, level: whole(m.level, 1, MAX_LEVEL) ?? 1, away: whole(m.away, 0, 100_000) ?? 0 };
  }
  const request = g.request as Record<string, unknown> | null | undefined;
  if (request && typeof request === "object") {
    const amount = whole(request.amount, 0, CEILING);
    const until = whole(request.until, 0, 9_100_000_000);
    if (amount !== null && until !== null) s.request = { amount, until };
  }
  if (Array.isArray(g.log)) {
    for (const entry of g.log.slice(-40)) {
      if (!entry || typeof entry !== "object") continue;
      const e = entry as Record<string, unknown>;
      const at = whole(e.at, 0, 9_100_000_000);
      if (at !== null && typeof e.text === "string") s.log.push({ at, text: e.text.slice(0, 200) });
    }
  }
  return s;
}

export const delbies: IdleGame<DelbiesState, DelbiesCommand, DelbiesView> = {
  id: "delbies",
  name: "Delbie's Daycare & Geriatrics",
  emoji: "🔧",
  category: "arcade",
  blurb: "Run the parts store. Mind the counter. Never say no",
  tagline: "You are Delbie: hardest-working man in the building, owner of a parts store, unable to turn anyone down. Babysit the counter, dispatch the drivers, and keep the lights on. It carries on while you are away.",
  seats: { min: 1, max: 1, default: 1 },
  teams: false,
  version: VERSION,
  awayCap: AWAY_CAP,
  newGame,
  advance,
  command: safeCommand,
  act,
  view,
  load,
  score: (s) => Math.floor(s.earned / 100),
};
