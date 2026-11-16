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
// The second phase is what the crew does to you:
//   - B-Rice runs on leftover pasta. Unfed for two hours, he stops keeping the counter calm. What
//     is in the fridge changes; give him anything but pasta and Pluto is too shocked to work.
//   - A cinnamon roll turns up in the breakroom now and then. Ricky will not come near the counter
//     until someone throws it out.
//   - Delbie can take an afternoon off. The store does better without him hovering. Red takes the
//     same days.
//   - Pluto shoves McMikey on his way past. McMikey drops whatever he was doing.
//   - Ears radios in. Nobody can tell what he said: guess which garage he was at for a bonus, or
//     let Tommy walk up behind you and solve it.
//   - Lost & Found: four relics, each earned by doing something often enough, each making one of
//     the crew better for good.
//   - The Store Move: when this building has taken in enough, pack everyone up and move down the
//     road. The till, the crew and the tabs start again; the bigger building, a new department
//     and Pluto's Old Timer badge are for keeps.
//
// The third phase is the floor plan: six squares by four, with a terminal for each of the counter
// crew, the bathroom, the microwave, the warranty desk and the drivers' bench to arrange round the
// front door and Delbie's office, which stay where they are. Who sits next to what changes real
// numbers: `DELBIES_FLOOR_RULES` is the whole list, one line each. A new store's layout sets none
// of them off, and the layout goes with the store when it moves.
//
// The inspector comes by every so often, once there are a couple of people to inspect. Somebody
// sees his car a minute before he walks in; he is on the floor for twenty seconds, and what he
// writes down is how four things stand as he leaves: the counter, the back room, the breakroom and
// the books. Nothing wrong is a clean sheet (a sticker in the window, and everything brings in a
// tenth more while it is fresh); one thing he lets go; two or more is a fine.
//
// Money is in cents and meters in ten-thousandths, so every number is whole. Still to come: other
// stores.
import { clockAt, dollars, safeClock, type IdleClock, type IdleGame, type IdleReport, type IdleResult } from "./idle.js";
import { nextRandom } from "./table.js";

const VERSION = 5;
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
/** How long B-Rice goes between meals, and how long with his Tupperware. */
const HUNGRY_AFTER = 2 * 60 * 60;
const HUNGRY_AFTER_TUPPERWARE = 4 * 60 * 60;
const FRIDGE = ["pasta", "pizza", "salad", "pasta", "gas-station sushi", "pasta"] as const;
const FRIDGE_EVERY = 600;
const SHOCK_SECONDS = 600;
const CINNAMON_LASTS = 2 * 60 * 60;
const VACATION_SECONDS = 120;
const VACATION_EVERY = 60 * 60;
const RADIO_SECONDS = 60;
const RESCUE_EVERY = 15 * 60;
/** What the first building has to take in before the store can move, in cents. Each move after takes eight times as much. */
// The Parts Network: a hotshot run to another store, and the tabs sold on to one.
/** The inspector: how long before he walks in his car is seen, how long he is on the floor, when the first one is, and how long a clean sheet's sticker lasts. */
const INSPECT_WARNING = 60;
const INSPECT_SECONDS = 20;
const INSPECT_FIRST = 900;
const STICKER_SECONDS = 600;
const HOTSHOT_SECONDS = 300;
const HOTSHOT_EVERY = 900;
const PAPER_SECONDS = 600;
const LIST_AT_LEAST = 10_000;

const FIRST_MOVE = 2_500_000_000;
const MOVE_NEEDS = [1, 8, 64, 512, 4096, 32768, 262144, 2097152].map((times) => FIRST_MOVE * times);
const GARAGES = ["Hank's Tire & Lube", "Mountain State Muffler", "Three Rivers Transmission", "Dale's Diesel", "Blue Ridge Body Shop", "Pinewood Auto Repair", "Coalfield Customs", "Shady Lane Service", "Big Bend Brake & Clutch", "Ridgeline Radiator"];
const DEPARTMENTS = ["Machine Shop", "European Import Wing", "Paint Counter", "Hydraulic Hose Bench", "Performance Parts Wall", "Fleet Accounts Desk", "Tractor & Ag Annex", "Second Warehouse"];

export const DELBIES_FLOOR = { cols: 6, rows: 4 };
const SQUARES = DELBIES_FLOOR.cols * DELBIES_FLOOR.rows;
export type DelbiesPieceId = "door" | "office" | "tommy" | "pluto" | "brice" | "ricky" | "mcmikey" | "dubs" | "bathroom" | "microwave" | "warranty" | "bench";
/** What stands on the floor. The door and the office are part of the building; the rest can be moved. */
export const DELBIES_PIECES: { id: DelbiesPieceId; label: string; emoji: string; fixed: boolean; /** Whose terminal it is, when it is one. */ crew?: DelbiesCrewId; /** Where it stands in a new store. */ square: number }[] = [
  { id: "door", label: "Front door", emoji: "🚪", fixed: true, square: 18 },
  { id: "office", label: "Delbie's office", emoji: "🗄️", fixed: true, square: 5 },
  { id: "tommy", label: "Tommy's terminal", emoji: "🖥️", fixed: false, crew: "tommy", square: 0 },
  { id: "pluto", label: "Pluto's terminal", emoji: "🖥️", fixed: false, crew: "pluto", square: 2 },
  { id: "ricky", label: "Ricky's terminal", emoji: "🖥️", fixed: false, crew: "ricky", square: 7 },
  { id: "mcmikey", label: "McMikey's terminal", emoji: "🖥️", fixed: false, crew: "mcmikey", square: 9 },
  { id: "brice", label: "B-Rice's terminal", emoji: "🖥️", fixed: false, crew: "brice", square: 12 },
  { id: "warranty", label: "Warranty desk", emoji: "📦", fixed: false, crew: "snowcap", square: 14 },
  { id: "bench", label: "Drivers' bench", emoji: "🪑", fixed: false, square: 16 },
  { id: "microwave", label: "Pasta microwave", emoji: "🍝", fixed: false, square: 20 },
  { id: "bathroom", label: "Bathroom", emoji: "🚻", fixed: false, square: 22 },
  { id: "dubs", label: "Dubs' terminal", emoji: "🖥️", fixed: false, crew: "dubs", square: 23 },
];
const PIECE_IDS = DELBIES_PIECES.map((p) => p.id);

export type DelbiesFloorRuleId = "shoving" | "company" | "walkouts" | "reach" | "shortwalk" | "firstthing" | "behind" | "busy" | "smell";
/**
 * What the floor plan does: when the two things are on squares that share a side (and whoever it is
 * about has been hired), the rule is in effect. One line each; the numbers are in the code that reads them.
 */
export const DELBIES_FLOOR_RULES: { id: DelbiesFloorRuleId; a: DelbiesPieceId; b: DelbiesPieceId[]; good: boolean; label: string; does: string; hint: string; needs: DelbiesCrewId[] }[] = [
  { id: "shoving", a: "pluto", b: ["mcmikey"], good: false, label: "Shoving distance", does: "Pluto shoves McMikey three times as often, and each brings in a fifth less.", hint: "Pluto next to McMikey", needs: ["pluto", "mcmikey"] },
  { id: "company", a: "pluto", b: ["brice", "bench"], good: true, label: "Good company", does: "Pluto brings in half as much again.", hint: "Pluto next to B-Rice or the drivers' bench", needs: ["pluto"] },
  { id: "walkouts", a: "dubs", b: ["door"], good: true, label: "Nobody walks out", does: "Returns are halved.", hint: "Dubs next to the front door", needs: ["dubs"] },
  { id: "reach", a: "brice", b: ["microwave"], good: true, label: "Pasta within reach", does: "B-Rice goes half as long again between meals.", hint: "B-Rice next to the microwave", needs: ["brice"] },
  { id: "shortwalk", a: "ricky", b: ["bathroom"], good: true, label: "A short walk", does: "Ricky's trips to the restroom take half as long.", hint: "Ricky next to the bathroom", needs: ["ricky"] },
  { id: "firstthing", a: "warranty", b: ["door"], good: true, label: "First thing they see", does: "Snowcap is worth 25% on everything instead of 15%.", hint: "The warranty desk next to the front door", needs: ["snowcap"] },
  { id: "behind", a: "tommy", b: ["office"], good: true, label: "Right behind him", does: "Tommy adds another half to every click of yours.", hint: "Tommy next to Delbie's office", needs: ["tommy"] },
  { id: "busy", a: "mcmikey", b: ["office"], good: true, label: "Looking busy", does: "Delbie can see his screen: McMikey brings in a quarter more.", hint: "McMikey next to Delbie's office", needs: ["mcmikey"] },
  { id: "smell", a: "microwave", b: ["bathroom"], good: false, label: "Nobody wants that", does: "The counter gets rowdier, faster.", hint: "The microwave next to the bathroom", needs: [] },
];

export type DelbiesRelicId = "tupperware" | "backpack" | "keys" | "iou";
/** The Lost & Found: what each relic is, what it does, how it is come by, and how many times that has to happen. */
export const DELBIES_RELICS: { id: DelbiesRelicId; name: string; does: string; how: string; needs: number }[] = [
  { id: "tupperware", name: "The Tupperware of Penne", does: "B-Rice goes four hours between meals instead of two.", how: "Feed B-Rice pasta", needs: 5 },
  { id: "backpack", name: "The Mystery Backpack", does: "Nobody argues with Dubs: returns are halved, even without Snowcap.", how: "Put parts on a tab yourself", needs: 40 },
  { id: "keys", name: "The Saturday Keys", does: "Tommy doubles your hustle instead of adding half.", how: "Let Tommy rescue you on the radio", needs: 3 },
  { id: "iou", name: "The IOU That Got Away", does: "The books can take half as much again in tabs.", how: "Guess where Ears was", needs: 10 },
];

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
  | { cmd: "phones" }
  /** Give B-Rice whatever is in the fridge. */
  | { cmd: "feed" }
  /** Throw the cinnamon roll out. */
  | { cmd: "toss" }
  | { cmd: "vacation" }
  /** Guess which garage Ears was at: 0, 1 or 2. */
  | { cmd: "radio"; pick: number }
  /** Let Tommy answer the radio. */
  | { cmd: "rescue" }
  | { cmd: "move" }
  /** Send a driver on a hotshot run to another store. Who gets it is for whoever joins the stores up. */
  | { cmd: "hotshot" }
  /** Put everything owed on account up for another store to buy, or take it back. */
  | { cmd: "list" }
  | { cmd: "unlist" }
  /** Buy another store's tabs: paid for now, collected over the next ten minutes. */
  | { cmd: "buy"; from: string }
  /** Something from another store has arrived: their driver with a part, or the money for the tabs they bought. */
  | { cmd: "receive"; what: "hotshot" | "sold"; from: string }
  /** Put a piece of the floor plan on a square. Whatever stood there swaps places with it. */
  | { cmd: "place"; piece: DelbiesPieceId; square: number };

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
  hungry: number;
  cinnamon: number;
  shoves: number;
  radios: number;
  sheets: number;
  noted: number;
  fines: number;
  fined: number;
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
  /** When B-Rice last ate. */
  fedAt: number;
  /** What is in the fridge (a place in the list), and when it changes. */
  fridge: number;
  fridgeAt: number;
  /** Seconds Pluto is still too shocked to work properly. */
  shock: number;
  /** The second the cinnamon roll in the breakroom goes by itself, or 0 when there is none. */
  cinnamon: number;
  /** Seconds of Delbie's afternoon off left, and when he can take another. */
  vacation: number;
  vacationAt: number;
  /** Ears on the radio: the three garages it might have been, which it was, and when he gives up. */
  radio: { options: [number, number, number]; answer: number; until: number } | null;
  nextRadio: number;
  rescueAt: number;
  /** How many times each relic's deed has been done. */
  deeds: Record<DelbiesRelicId, number>;
  /** Store moves so far, and what this building has taken in. */
  moves: number;
  here: number;
  /** The floor plan: which square each piece stands on. */
  floor: Record<DelbiesPieceId, number>;
  /** Seconds a driver is still out on a hotshot run, what it pays when he is back, and when the next can go. */
  hotshot: number;
  hotshotPay: number;
  hotshotAt: number;
  /** Tabs put up for another store to buy: off the books until they sell or are taken back. */
  listed: number;
  /** Another store's tabs, bought: what is still to collect, and how much of it comes in a second. */
  paper: number;
  paperRate: number;
  /** The inspector: the second he next walks in, the seconds he is still on the floor, the seconds a clean sheet's sticker is still fresh, and how many clean sheets there have been. */
  inspectAt: number;
  inspecting: number;
  sticker: number;
  sheets: number;
  /** The last things that happened, newest last. */
  log: { at: number; text: string }[];
}

const clamp = (n: number, low: number, high: number) => (n < low ? low : n > high ? high : n);
const repLevel = (s: DelbiesState) => Math.floor(Math.sqrt(s.rep / 20));
const has = (s: DelbiesState, relic: DelbiesRelicId) => s.deeds[relic] >= DELBIES_RELICS.find((r) => r.id === relic)!.needs;
/** Whether two squares share a side. */
function beside(a: number, b: number): boolean {
  const { cols } = DELBIES_FLOOR;
  const dc = Math.abs((a % cols) - (b % cols));
  const dr = Math.abs(Math.floor(a / cols) - Math.floor(b / cols));
  return dc + dr === 1;
}
/** Whether a rule of the floor plan is in effect. */
function floorRule(s: DelbiesState, id: DelbiesFloorRuleId): boolean {
  const rule = DELBIES_FLOOR_RULES.find((r) => r.id === id)!;
  return rule.needs.every((who) => s.crew[who].hired) && rule.b.some((other) => beside(s.floor[rule.a], s.floor[other]));
}
const hungryAfter = (s: DelbiesState) => {
  const base = has(s, "tupperware") ? HUNGRY_AFTER_TUPPERWARE : HUNGRY_AFTER;
  return floorRule(s, "reach") ? base + base / 2 : base;
};
const hungry = (s: DelbiesState) => s.crew.brice.hired && s.t - s.fedAt >= hungryAfter(s);
const moveNeeds = (s: DelbiesState) => MOVE_NEEDS[Math.min(s.moves, MOVE_NEEDS.length - 1)]!;
const present = (m: Member) => m.hired && m.away === 0;
/** One of the crew is at work: hired, not wandered off, and not kept away by something. */
const working = (s: DelbiesState, id: DelbiesCrewId) => present(s.crew[id]) && !(id === "ricky" && s.cinnamon > 0) && !(id === "red" && s.vacation > 0);
const onTheClock = (clock: IdleClock) => clock.minute >= CLOCK_IN && clock.minute < CLOCK_OUT;
const note = (s: DelbiesState, text: string) => {
  s.log.push({ at: s.t, text });
  if (s.log.length > 40) s.log.shift();
};

/** What the store takes in a second as things stand, in cents. */
function income(s: DelbiesState): number {
  let base = 0;
  for (const id of IDS) {
    if (!working(s, id)) continue;
    let sales = HIRE[id].sales * s.crew[id].level;
    // Pluto has been through every move, and it shows; unless he has just seen B-Rice eat a salad.
    if (id === "pluto") {
      sales = Math.floor((sales * (1 + s.moves)) / (s.shock > 0 ? 2 : 1));
      if (floorRule(s, "company")) sales += Math.floor(sales / 2);
    }
    if (id === "mcmikey" && floorRule(s, "busy")) sales += Math.floor(sales / 4);
    if ((id === "pluto" || id === "mcmikey") && floorRule(s, "shoving")) sales -= Math.floor(sales / 5);
    base += sales;
  }
  let percent = 100 + 3 * repLevel(s) + 50 * s.moves;
  if (s.crew.snowcap.hired) percent += floorRule(s, "firstthing") ? 25 : 15;
  // The store does better without him hovering.
  if (s.vacation > 0) percent += 50;
  let total = Math.floor((base * percent) / 100);
  // Past halfway, chaos eats into the takings: down to half when the counter is in uproar.
  if (s.chaos > FULL / 2) total = Math.floor((total * (FULL - (s.chaos - FULL / 2))) / FULL);
  if (panicking(s)) total = Math.floor(total / 2);
  if (s.clutter >= FULL) total = Math.floor((total * 7) / 10);
  // A clean sheet's sticker in the window.
  if (s.sticker > 0) total += Math.floor(total / 10);
  return Math.min(CEILING / 100_000, total);
}
/** The most customers can owe before the books can't take it: half an hour of takings, and never less than $500. */
function tabCeiling(s: DelbiesState): number {
  let base = 0;
  for (const id of IDS) if (s.crew[id].hired) base += HIRE[id].sales * s.crew[id].level;
  const ceiling = Math.max(50_000, base * 1800);
  return has(s, "iou") ? Math.floor((ceiling * 3) / 2) : ceiling;
}
const panicking = (s: DelbiesState) => s.tabs >= tabCeiling(s);
function clickWorth(s: DelbiesState): number {
  // A couple of dollars (doubled by every set of better phones) and a twentieth of a second's takings.
  let worth = 200 * (1 << s.phones) + Math.floor(income(s) / 20);
  if (s.crew.tommy.hired) {
    const own = worth;
    worth += has(s, "keys") ? own : Math.floor(own / 2);
    if (floorRule(s, "behind")) worth += Math.floor(own / 2);
  }
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
/** What a hotshot run costs to send, and what it pays when the driver is back. */
const hotshotCost = (s: DelbiesState) => Math.max(2_000, income(s) * 30);
const hotshotPays = (s: DelbiesState) => Math.max(8_000, income(s) * 120);
/** What a part off another store's truck is worth here. */
const hotshotWorth = (s: DelbiesState) => Math.max(5_000, income(s) * 300);
/** What another store's tabs cost here; they pay twice that. */
const paperCost = (s: DelbiesState) => Math.max(5_000, income(s) * 300);
const DRIVERS = DELBIES_CREW.filter((h) => h.role === "driver").map((h) => h.id);
const forkliftCost = (s: DelbiesState) => Math.max(5_000, income(s) * 30);
function take(s: DelbiesState, cents: number, tally?: Tally) {
  s.cash = Math.min(CEILING, s.cash + cents);
  s.earned = Math.min(CEILING, s.earned + cents);
  s.here = Math.min(CEILING, s.here + cents);
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
    else if (rand() < 1 / 220) crew.ricky.away = floorRule(s, "shortwalk") ? 90 : 180;
    if (s.cinnamon > 0) tally.cinnamon++;
  }

  // The breakroom: what is in the fridge, who has eaten, and what somebody left on the table.
  if (s.t >= s.fridgeAt) {
    s.fridge = (s.fridge + 1 + Math.floor(rand() * (FRIDGE.length - 1))) % FRIDGE.length;
    s.fridgeAt = s.t + FRIDGE_EVERY;
  }
  if (hungry(s)) {
    tally.hungry++;
    if (s.t - s.fedAt === hungryAfter(s)) note(s, "B-Rice has not eaten in hours. The counter can tell.");
  }
  if (s.shock > 0) s.shock--;
  // The Parts Network: the driver out on a hotshot, and another store's tabs coming in.
  if (s.hotshot > 0 && --s.hotshot === 0) {
    take(s, s.hotshotPay, tally);
    s.rep += 5;
    note(s, `The hotshot driver is back, with ${dollars(s.hotshotPay)} and a story about the other store's parking lot.`);
    s.hotshotPay = 0;
  }
  if (s.paper > 0) {
    const got = Math.min(s.paper, Math.max(1, s.paperRate));
    s.paper -= got;
    take(s, got, tally);
    if (s.paper === 0) s.paperRate = 0;
  }
  if (s.cinnamon > 0 && s.t >= s.cinnamon) s.cinnamon = 0;
  if (s.cinnamon === 0 && crew.ricky.hired && rand() < 1 / 5400) {
    s.cinnamon = s.t + CINNAMON_LASTS;
    note(s, "Somebody left a cinnamon roll in the breakroom. Ricky Roost will not come near the counter.");
  }
  if (s.vacation > 0 && --s.vacation === 0) note(s, "Delbie is back from his afternoon off. So is Red, as it happens.");
  // On his way past, Pluto shoves McMikey, who drops whatever he was doing.
  if (present(crew.pluto) && present(crew.mcmikey) && rand() < (floorRule(s, "shoving") ? 1 / 300 : 1 / 900)) {
    crew.mcmikey.away = 60;
    s.disputeAt = Math.max(s.disputeAt, s.t) + 120;
    tally.shoves++;
  }
  // Ears on the radio.
  if (s.radio && s.t >= s.radio.until) s.radio = null;
  if (crew.ears.hired && !s.radio && s.t >= s.nextRadio) {
    const first = Math.floor(rand() * GARAGES.length);
    const options: [number, number, number] = [first, (first + 1 + Math.floor(rand() * 3)) % GARAGES.length, (first + 5 + Math.floor(rand() * 3)) % GARAGES.length];
    s.radio = { options, answer: Math.floor(rand() * 3), until: s.t + RADIO_SECONDS };
    s.nextRadio = s.t + 300 + Math.floor(rand() * 400);
    tally.radios++;
  }
  if (crew.red.hired && crew.red.away === 0 && rand() < 1 / 2400) {
    crew.red.away = 420;
    tally.daysOff++;
    note(s, "Red is taking an extra week off. Sunburned feet.");
  }

  // The inspector: seen a minute out, on the floor for twenty seconds, and gone with his verdict.
  if (s.sticker > 0) s.sticker--;
  if (s.inspecting > 0) {
    if (--s.inspecting === 0) verdict(s, tally);
  } else if (s.t >= s.inspectAt) {
    // With nobody much to inspect he drives on, and tries again in ten minutes.
    if (!inspectable(s)) s.inspectAt = s.t + 600;
    else {
      s.inspecting = INSPECT_SECONDS;
      // (When the next one is goes by the clock, not by chance: it is between 25 and 50 minutes off.)
      s.inspectAt = s.t + 1500 + ((s.t * 7919) % 1500);
      note(s, "The inspector is in the building, clipboard out.");
    }
  } else if (s.inspectAt - s.t === INSPECT_WARNING && inspectable(s)) note(s, crew.wheels.hired ? "Wheels saw the inspector's car at the gas station. He is a minute out." : "A county car just pulled in across the road. The inspector is a minute out.");

  const coming = income(s);
  if (coming > 0) take(s, coming, tally);
  // Storytime's deliveries are slow, and every one of them makes the store's name.
  if (present(crew.storytime) && s.t % 40 === 0) s.rep += crew.storytime.level;

  // The counter gets rowdier, unless someone is keeping it in hand.
  let rowdier = 2;
  for (const id of IDS) if (working(s, id) && id !== "twothirty" && !(id === "brice" && hungry(s))) rowdier += HIRE[id].chaos;
  if (crew.twothirty.hired) rowdier += onTheClock(clock) ? HIRE.twothirty.chaos : 4;
  if (floorRule(s, "smell")) rowdier += 3;
  if (s.fever === 0 && s.vacation === 0) s.chaos = clamp(s.chaos + rowdier, 0, FULL);
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
    const tenths = (crew.dubs.hired && has(s, "backpack") ? 6 : 12) / (floorRule(s, "walkouts") ? 2 : 1);
    const back = Math.min(s.cash, Math.floor((coming * tenths) / 10));
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

/** The inspector only bothers with a store that has a couple of people in it. */
const inspectable = (s: DelbiesState) => IDS.filter((id) => s.crew[id].hired).length >= 2;
/** What the inspector looks at, and how each stands this second. */
function inspection(s: DelbiesState): { key: "counter" | "backroom" | "breakroom" | "books"; label: string; fix: string; ok: boolean }[] {
  return [
    { key: "counter", label: "The counter is under control", fix: "Get the counter chaos under half", ok: s.chaos < FULL / 2 },
    { key: "backroom", label: "There is a way through the back room", fix: "Clear the back room", ok: s.clutter < (FULL * 7) / 10 },
    { key: "breakroom", label: "The breakroom would pass for clean", fix: s.cinnamon > 0 ? "Throw the cinnamon roll out" : "Move the microwave away from the bathroom", ok: s.cinnamon === 0 && !floorRule(s, "smell") },
    { key: "books", label: "The books are not on fire", fix: "Get the tabs under their ceiling", ok: !panicking(s) },
  ];
}
/** The inspector leaves: a clean sheet, one thing let go, or a fine for each thing wrong. */
function verdict(s: DelbiesState, tally: Tally) {
  const wrong = inspection(s).filter((c) => !c.ok);
  if (wrong.length === 0) {
    s.sticker = STICKER_SECONDS;
    s.sheets = Math.min(CEILING, s.sheets + 1);
    s.rep += 30;
    tally.sheets++;
    note(s, "A clean sheet from the inspector. He put a sticker in the window, and Delbie has not stopped pointing at it.");
  } else if (wrong.length === 1) {
    s.rep += 5;
    tally.noted++;
    note(s, `The inspector wrote one thing down and let it go: ${wrong[0]!.label.toLowerCase()}, he says not.`);
  } else {
    // A minute of takings for each thing wrong, and never more than is in the till.
    const fine = Math.min(s.cash, income(s) * 60 * wrong.length);
    s.cash -= fine;
    s.chaos = Math.min(FULL, s.chaos + 1000);
    tally.fines++;
    tally.fined += fine;
    note(s, `The inspector found ${wrong.length} things wrong and left a fine of ${dollars(fine)}. Delbie offered him a coffee anyway.`);
  }
}

function approve(s: DelbiesState, amount: number) {
  s.tabs = Math.min(CEILING, s.tabs + amount);
  // A favour is a favour, whatever it cost: the store's name grows the same for each.
  s.rep += 10;
}

function emptyTally(): Tally {
  return { earned: 0, restroom: 0, daysOff: 0, delbieYes: 0, delbieYesAmount: 0, collected: 0, paid: 0, short: 0, returns: 0, saturdays: 0, hungry: 0, cinnamon: 0, shoves: 0, radios: 0, sheets: 0, noted: 0, fines: 0, fined: 0 };
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
  if (tally.hungry >= 600) lines.push(`B-Rice went ${span(tally.hungry)} without pasta. Nobody kept the counter calm.`);
  if (tally.cinnamon >= 600) lines.push(`A cinnamon roll sat in the breakroom for ${span(tally.cinnamon)}. Ricky Roost stayed well away.`);
  if (tally.shoves) lines.push(`Pluto shoved McMikey ${tally.shoves === 1 ? "once" : `${tally.shoves} times`} on his way past.`);
  if (tally.radios >= 2) lines.push(`Ears radioed in ${tally.radios} times. Nobody understood a word.`);
  if (tally.daysOff) lines.push(`Red took ${tally.daysOff === 1 ? "an extra week" : `${tally.daysOff} extra weeks`} off for sunburned feet.`);
  if (tally.saturdays) lines.push("Tommy Two-Shoes checked in the Saturday freight before anyone else woke up.");
  if (tally.returns) lines.push(`${dollars(tally.returns)} of parts came back, fitted wrong.`);
  if (tally.short) lines.push(`Payroll came up short ${tally.short === 1 ? "once" : `${tally.short} times`}. Delbie is down ${tally.short === 1 ? "a belt notch" : `${tally.short} belt notches`}.`);
  else if (tally.paid) lines.push(`Payroll went out ${tally.paid === 1 ? "once" : `${tally.paid} times`}, on time.`);
  if (tally.sheets) lines.push(`The inspector came by and found nothing wrong${tally.sheets === 1 ? "" : `, ${tally.sheets} times`}. There is a sticker in the window.`);
  if (tally.noted) lines.push(`The inspector wrote ${tally.noted === 1 ? "one thing" : `something`} down${tally.noted === 1 ? "" : ` on ${tally.noted} visits`} and let it go.`);
  if (tally.fines) lines.push(`The inspector left ${tally.fines === 1 ? "a fine" : `${tally.fines} fines`}: ${dollars(tally.fined)} in all.`);
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
    s.fedAt += skipped;
    s.fridgeAt += skipped;
    s.nextRadio += skipped;
    s.vacationAt += skipped;
    s.rescueAt += skipped;
    s.hotshotAt += skipped;
    s.inspectAt += skipped;
    if (s.cinnamon > 0) s.cinnamon += skipped;
    if (s.radio) s.radio.until += skipped;
    if (s.request) s.request.until += skipped;
    s.t += skipped;
  }
  const rand = nextRandom(s);
  const tally = emptyTally();
  for (let at = s.t + 1; at <= clock.now; at++) second(s, clockAt(clock, at), rand, tally);
  return { seconds, skipped, earned: tally.earned, lines: seconds >= 300 ? incidentLog(s, seconds, tally) : [] };
}

/** Another store's name, as given: kept short and to one line. */
function nameOf(given: unknown): string {
  const name = typeof given === "string" ? given.replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, 24) : "";
  return name || "Another store";
}

function safeCommand(given: unknown): DelbiesCommand {
  const g = (given && typeof given === "object" ? given : {}) as Record<string, unknown>;
  const who = IDS.includes(g.who as DelbiesCrewId) ? (g.who as DelbiesCrewId) : null;
  switch (g.cmd) {
    case "hustle":
    case "dispute":
    case "forklift":
    case "phones":
    case "feed":
    case "toss":
    case "vacation":
    case "rescue":
    case "move":
    case "hotshot":
    case "list":
    case "unlist":
      return { cmd: g.cmd };
    case "buy":
      return { cmd: "buy", from: nameOf(g.from) };
    case "receive":
      return g.what === "hotshot" || g.what === "sold" ? { cmd: "receive", what: g.what, from: nameOf(g.from) } : { cmd: "none" };
    case "place":
      return PIECE_IDS.includes(g.piece as DelbiesPieceId) && typeof g.square === "number" && Number.isFinite(g.square) ? { cmd: "place", piece: g.piece as DelbiesPieceId, square: clamp(Math.trunc(g.square), 0, SQUARES - 1) } : { cmd: "none" };
    case "radio":
      return { cmd: "radio", pick: typeof g.pick === "number" && Number.isFinite(g.pick) ? clamp(Math.trunc(g.pick), 0, 2) : 0 };
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
      if (s.vacation > 0) return { ok: false, message: "Delbie is off this afternoon. For once." };
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
      const found = deed(s, "backpack");
      return { ok: true, message: found ?? `${dollars(amount)} on account. They swore they'd pay Friday.` };
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
    case "feed": {
      if (!s.crew.brice.hired) return { ok: false, message: "Nobody here is hungry." };
      const food = FRIDGE[s.fridge]!;
      s.fedAt = s.t;
      // Whatever it was, it is eaten: the fridge has something else in it now.
      s.fridge = (s.fridge + 1) % FRIDGE.length;
      s.fridgeAt = s.t + FRIDGE_EVERY;
      if (food === "pasta") return { ok: true, message: deed(s, "tupperware") ?? "B-Rice has his pasta. All is well at the counter." };
      if (s.crew.pluto.hired) {
        s.shock = SHOCK_SECONDS;
        note(s, `B-Rice ate ${food}. Pluto has not been the same since.`);
        return { ok: true, message: `B-Rice ate ${food}. Pluto is visibly shocked.` };
      }
      return { ok: true, message: `B-Rice ate ${food}. It was not pasta, but it was food.` };
    }
    case "toss": {
      if (s.cinnamon === 0) return { ok: false, message: "The breakroom is clear." };
      s.cinnamon = 0;
      return { ok: true, message: "Gone. Ricky Roost is back at the counter." };
    }
    case "vacation": {
      if (s.vacation > 0) return { ok: false, message: "He is already gone." };
      if (s.t < s.vacationAt) return { ok: false, message: "Delbie just had an afternoon off. He feels bad enough about that one." };
      s.vacation = VACATION_SECONDS;
      s.vacationAt = s.t + VACATION_EVERY;
      s.stress = 0;
      note(s, s.crew.red.hired ? "Delbie took the afternoon off. Red had already booked the same days." : "Delbie took the afternoon off. The store did not burn down.");
      return { ok: true, message: s.crew.red.hired ? "Delbie is off. So is Red, who booked it first." : "Delbie is off. Everything brings in half as much again." };
    }
    case "radio":
    case "rescue": {
      if (!s.radio) return { ok: false, message: "The radio is quiet." };
      const rescued = command.cmd === "rescue";
      if (rescued) {
        if (!s.crew.tommy.hired) return { ok: false, message: "Nobody is standing behind you." };
        if (s.t < s.rescueAt) return { ok: false, message: "Tommy is still checking in freight." };
        s.rescueAt = s.t + RESCUE_EVERY;
      }
      const right = rescued || (command.cmd === "radio" && command.pick === s.radio.answer);
      const garage = GARAGES[s.radio.options[s.radio.answer]!]!;
      s.radio = null;
      if (!right) return { ok: true, message: `It was ${garage}. Ears said so, clearly, according to Ears.` };
      const bonus = Math.max(5_000, income(s) * 120);
      take(s, bonus);
      s.rep += 5;
      const found = deed(s, rescued ? "keys" : "iou");
      return { ok: true, message: found ?? (rescued ? `Tommy came up from behind: "${garage}." ${dollars(bonus)}, and a slightly bruised ego.` : `${garage} it was. ${dollars(bonus)} for knowing.`) };
    }
    case "place": {
      const piece = DELBIES_PIECES.find((p) => p.id === command.piece)!;
      const partOfBuilding = (p: { id: DelbiesPieceId; label: string }) => `${p.id === "office" ? p.label : `The ${p.label.toLowerCase()}`} is part of the building.`;
      if (piece.fixed) return { ok: false, message: partOfBuilding(piece) };
      const from = s.floor[piece.id];
      if (from === command.square) return { ok: false };
      const there = DELBIES_PIECES.find((p) => s.floor[p.id] === command.square);
      if (there?.fixed) return { ok: false, message: partOfBuilding(there) };
      const before = DELBIES_FLOOR_RULES.filter((r) => floorRule(s, r.id)).map((r) => r.id);
      s.floor[piece.id] = command.square;
      if (there) s.floor[there.id] = from;
      // Say what the move set off, if anything: the first rule that is in effect now and was not before.
      const now = DELBIES_FLOOR_RULES.find((r) => floorRule(s, r.id) && !before.includes(r.id));
      return { ok: true, ...(now ? { message: `${now.label}: ${now.does}` } : {}) };
    }
    case "hotshot": {
      if (!DRIVERS.some((id) => working(s, id))) return { ok: false, message: DRIVERS.some((id) => s.crew[id].hired) ? "No driver is in." : "There is nobody to send. Hire a driver." };
      if (s.hotshot > 0) return { ok: false, message: "The hotshot driver is still out." };
      if (s.t < s.hotshotAt) return { ok: false, message: "The truck needs a minute." };
      if (!pay(hotshotCost(s))) return { ok: false, message: "Not enough in the till for the gas." };
      s.hotshotPay = hotshotPays(s);
      s.hotshot = HOTSHOT_SECONDS;
      s.hotshotAt = s.t + HOTSHOT_EVERY;
      note(s, "A driver left on a hotshot run to another store. He took the long way.");
      return { ok: true, message: "He is on his way." };
    }
    case "list": {
      if (s.listed > 0) return { ok: false, message: "There are tabs up for sale already." };
      if (s.tabs < LIST_AT_LEAST) return { ok: false, message: `Nobody buys less than ${dollars(LIST_AT_LEAST)} of tabs.` };
      s.listed = s.tabs;
      s.tabs = 0;
      note(s, `${dollars(s.listed)} of tabs went up for sale. They are somebody else's problem, if somebody else wants them.`);
      return { ok: true, message: `${dollars(s.listed)} of tabs are up for sale.` };
    }
    case "unlist": {
      if (s.listed <= 0) return { ok: false, message: "Nothing is up for sale." };
      s.tabs = Math.min(CEILING, s.tabs + s.listed);
      s.listed = 0;
      return { ok: true, message: "The tabs are back on the books." };
    }
    case "buy": {
      const cost = paperCost(s);
      if (!pay(cost)) return { ok: false, message: "Not enough in the till." };
      s.paper = Math.min(CEILING, s.paper + cost * 2);
      s.paperRate = Math.max(s.paperRate, Math.ceil(s.paper / PAPER_SECONDS));
      note(s, `Bought ${command.from}'s tabs for ${dollars(cost)}. McMikey says their customers pay better than ours.`);
      return { ok: true, message: `${dollars(cost * 2)} to collect over the next ten minutes.` };
    }
    case "receive": {
      if (command.what === "sold") {
        if (s.listed <= 0) return { ok: false, message: "Nothing was up for sale." };
        const got = Math.floor((s.listed * 7) / 10);
        s.listed = 0;
        take(s, got);
        note(s, `${command.from} bought the tabs: ${dollars(got)} in the till, and not one phone call to make.`);
        return { ok: true, message: `${command.from} bought your tabs for ${dollars(got)}.` };
      }
      const worth = hotshotWorth(s);
      take(s, worth);
      s.rep += 10;
      s.chaos = Math.max(0, s.chaos - 2_000);
      note(s, `${command.from}'s driver dropped off the one part nobody had. ${dollars(worth)} sale, and the counter calmed down.`);
      return { ok: true, message: `A hotshot from ${command.from}: ${dollars(worth)}.` };
    }
    case "move": {
      if (s.here < moveNeeds(s)) return { ok: false, message: `This building has ${dollars(moveNeeds(s) - s.here)} more to take in before it is worth moving.` };
      const department = DEPARTMENTS[s.moves % DEPARTMENTS.length]!;
      s.moves++;
      s.here = 0;
      s.cash = 0;
      s.tabs = 0;
      s.rep = 0;
      s.chaos = 0;
      s.stress = 0;
      s.fever = 0;
      s.clutter = 0;
      s.phones = 0;
      s.shock = 0;
      s.cinnamon = 0;
      s.vacation = 0;
      s.radio = null;
      s.request = null;
      s.hotshot = 0;
      s.hotshotPay = 0;
      s.listed = 0;
      s.paper = 0;
      s.paperRate = 0;
      // The inspector has a new building to find: a quarter of an hour's grace, and the old sticker stays on the old window.
      s.inspecting = 0;
      s.sticker = 0;
      s.inspectAt = s.t + INSPECT_FIRST;
      for (const id of IDS) s.crew[id] = { hired: false, level: 1, away: 0 };
      s.fedAt = s.t;
      s.payrollAt = s.t + PAYROLL_EVERY;
      s.nextRequest = s.t + 45;
      s.nextRadio = s.t + 300;
      s.log = [];
      note(s, `Store Move #${s.moves}. Everything went down the road in the delivery truck. The new building has a ${department}.`);
      return { ok: true, message: `Store Move #${s.moves}: a bigger building, a ${department}, and an Old Timer badge for Pluto.` };
    }
  }
}

/** One more of a relic's deed done. Says so when that is the one that finds it. */
function deed(s: DelbiesState, relic: DelbiesRelicId): string | undefined {
  const r = DELBIES_RELICS.find((x) => x.id === relic)!;
  if (s.deeds[relic] >= r.needs) return undefined;
  if (++s.deeds[relic] < r.needs) return undefined;
  note(s, `Found in the Lost & Found: ${r.name}.`);
  return `Found in the Lost & Found: ${r.name}. ${r.does}`;
}

/** What Ears said, as it came over the radio: most of the letters did not make it. */
function garble(name: string, seed: number): string {
  let out = "";
  let n = seed % 2147483648;
  for (const ch of name) {
    n = (n * 48271 + 12345) % 2147483647;
    if (ch === " ") out += " ";
    else if (ch === "&" || ch === "'") continue;
    else if (n % 100 < 42) out += ch.toLowerCase();
    else if (n % 100 < 70) out += "mrhnuh"[n % 6]!;
    else if (n % 100 < 85) out += "-";
  }
  return `"${out.replace(/ +/g, " ").trim()}... over."`;
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
  actions: { key: "dispute" | "forklift" | "phones" | "vacation"; label: string; hint: string; cost: number; can: boolean; waitSeconds: number }[];
  /** The breakroom: whether B-Rice needs feeding and what there is to feed him, and whether there is a cinnamon roll to throw out. */
  breakroom: { brice: boolean; hungry: boolean; hungryInSeconds: number; fridge: string; fridgeChangesIn: number; plutoShocked: number; cinnamon: boolean };
  /** Seconds of Delbie's afternoon off left. */
  vacation: number;
  /** Ears on the radio: what it sounded like, what it might have been, and whether Tommy can answer it for you. */
  radio: { heard: string; options: string[]; secondsLeft: number; rescue: boolean; rescueInSeconds: number } | null;
  relics: { id: DelbiesRelicId; name: string; does: string; how: string; done: number; needs: number; found: boolean }[];
  /** The floor plan: where everything stands, and every rule with whether it is in effect. */
  floor: { cols: number; rows: number; pieces: { id: DelbiesPieceId; label: string; emoji: string; square: number; fixed: boolean; /** A terminal nobody sits at yet. */ empty: boolean }[]; rules: { id: DelbiesFloorRuleId; label: string; does: string; hint: string; good: boolean; active: boolean }[] };
  /** The Store Move: how far this building is towards it, and what the next one brings. */
  move: { moves: number; here: number; needs: number; can: boolean; bonusPercent: number; nextDepartment: string; departments: string[] };
  /** The Parts Network: what this store can do with other stores. Joining stores up is for whoever runs the game. */
  network: {
    hotshot: { hasDriver: boolean; can: boolean; cost: number; pays: number; outSeconds: number; waitSeconds: number; worthHere: number };
    tabs: { listed: number; canList: boolean; listAtLeast: number; sellsFor: number; buyCost: number; buyPays: number; canBuy: boolean; collecting: number };
  };
  /**
   * The inspector, from when his car is seen until he leaves: whether he is in the building yet,
   * the seconds until he walks in (or, once he has, until he goes), and the four things he looks
   * at as each stands now, with what would put a wrong one right. Null when he is nowhere about.
   */
  inspector: { here: boolean; seconds: number; checks: { key: "counter" | "backroom" | "breakroom" | "books"; label: string; fix: string; ok: boolean }[] } | null;
  /** Seconds a clean sheet's sticker is still fresh (everything brings in a tenth more), and how many clean sheets there have been. */
  sticker: number;
  sheets: number;
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
    if (m.hired && h.id === "ricky" && s.cinnamon > 0) status = "Avoiding the breakroom";
    else if (m.hired && h.id === "red" && s.vacation > 0) status = "Off: same days as Delbie";
    else if (m.hired && m.away > 0) status = h.id === "ricky" ? "In the restroom" : h.id === "mcmikey" ? "Picking things up" : "Off: sunburned feet";
    else if (m.hired && h.id === "twothirty") status = on ? "On the clock" : "Clocked out";
    else if (m.hired && h.id === "brice" && hungry(s)) status = "Hungry";
    else if (m.hired && h.id === "pluto" && s.shock > 0) status = "Shocked";
    const title = h.id === "pluto" && s.moves > 0 ? `${h.title} · Old Timer${s.moves > 1 ? ` ×${s.moves}` : ""}` : h.title;
    const each = h.id === "pluto" ? h.sales * (1 + s.moves) : h.sales;
    crew.push({ id: h.id, name: h.name, title, role: h.role, blurb: h.blurb, quirk: h.quirk, hired: m.hired, level: m.level, maxed: m.hired && m.level >= MAX_LEVEL, cost, can: s.cash >= cost && !(m.hired && m.level >= MAX_LEVEL), perSecond: m.hired ? each * m.level : each, status });
  }
  const actions: DelbiesView["actions"] = [];
  const phoneCost = PHONE_COSTS[s.phones];
  if (phoneCost !== undefined) actions.push({ key: "phones", label: `Better phones ${s.phones + 1}`, hint: "Doubles what Delbie's own hustle is worth", cost: phoneCost, can: s.cash >= phoneCost, waitSeconds: 0 });
  if (s.crew.mcmikey.hired) actions.push({ key: "dispute", label: "PayPal dispute", hint: "McMikey gets back 15% of what is owed, and rants", cost: 0, can: s.tabs > 0 && s.t >= s.disputeAt, waitSeconds: Math.max(0, s.disputeAt - s.t) });
  if (hiredCount >= 4) actions.push({ key: "forklift", label: "Summon the Forklift Ghost", hint: "Clears the back room. A full back room costs 30% of the takings", cost: forkliftCost(s), can: s.clutter >= FULL * 0.3 && s.cash >= forkliftCost(s), waitSeconds: 0 });
  actions.push({ key: "vacation", label: "Take the afternoon off", hint: "Two minutes without Delbie: half as much again comes in and the counter holds. Red takes the same days", cost: 0, can: s.vacation === 0 && s.t >= s.vacationAt, waitSeconds: s.vacation > 0 ? s.vacation : Math.max(0, s.vacationAt - s.t) });
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
    shout: s.vacation > 0 ? "Gone fishing." : s.fever > 0 ? "Living that dream!" : s.chaos >= FULL / 2 ? "What are YOOOOOOU doing?!" : panicking(s) ? "Somebody call somebody who owes us." : "Living that dream.",
    request: s.request ? { amount: s.request.amount, secondsLeft: Math.max(0, s.request.until - s.t) } : null,
    payroll: { due: payroll(s), inSeconds: Math.max(0, s.payrollAt - s.t) },
    desk: { hired: s.crew.twothirty.hired, on, minutes },
    crew,
    actions,
    breakroom: { brice: s.crew.brice.hired, hungry: hungry(s), hungryInSeconds: s.crew.brice.hired ? Math.max(0, s.fedAt + hungryAfter(s) - s.t) : 0, fridge: FRIDGE[s.fridge] ?? "pasta", fridgeChangesIn: Math.max(0, s.fridgeAt - s.t), plutoShocked: s.shock, cinnamon: s.cinnamon > 0 },
    vacation: s.vacation,
    radio: s.radio ? { heard: garble(GARAGES[s.radio.options[s.radio.answer]!]!, s.radio.until), options: s.radio.options.map((g) => GARAGES[g]!), secondsLeft: Math.max(0, s.radio.until - s.t), rescue: s.crew.tommy.hired && s.t >= s.rescueAt, rescueInSeconds: Math.max(0, s.rescueAt - s.t) } : null,
    relics: DELBIES_RELICS.map((r) => ({ id: r.id, name: r.name, does: r.does, how: r.how, done: Math.min(s.deeds[r.id], r.needs), needs: r.needs, found: has(s, r.id) })),
    floor: {
      ...DELBIES_FLOOR,
      pieces: DELBIES_PIECES.map((p) => ({ id: p.id, label: p.label, emoji: p.emoji, square: s.floor[p.id], fixed: p.fixed, empty: !!p.crew && !s.crew[p.crew].hired })),
      rules: DELBIES_FLOOR_RULES.map((r) => ({ id: r.id, label: r.label, does: r.does, hint: r.hint, good: r.good, active: floorRule(s, r.id) })),
    },
    move: { moves: s.moves, here: s.here, needs: moveNeeds(s), can: s.here >= moveNeeds(s), bonusPercent: 50 * s.moves, nextDepartment: DEPARTMENTS[s.moves % DEPARTMENTS.length]!, departments: Array.from({ length: Math.min(s.moves, DEPARTMENTS.length) }, (_, i) => DEPARTMENTS[i]!) },
    network: {
      hotshot: { hasDriver: DRIVERS.some((id) => s.crew[id].hired), can: DRIVERS.some((id) => working(s, id)) && s.hotshot === 0 && s.t >= s.hotshotAt && s.cash >= hotshotCost(s), cost: hotshotCost(s), pays: s.hotshot > 0 ? s.hotshotPay : hotshotPays(s), outSeconds: s.hotshot, waitSeconds: Math.max(0, s.hotshotAt - s.t), worthHere: hotshotWorth(s) },
      tabs: { listed: s.listed, canList: s.listed === 0 && s.tabs >= LIST_AT_LEAST, listAtLeast: LIST_AT_LEAST, sellsFor: Math.floor(((s.listed || s.tabs) * 7) / 10), buyCost: paperCost(s), buyPays: paperCost(s) * 2, canBuy: s.cash >= paperCost(s), collecting: s.paper },
    },
    inspector:
      s.inspecting > 0
        ? { here: true, seconds: s.inspecting, checks: inspection(s).map(({ key, label, fix, ok }) => ({ key, label, fix, ok })) }
        : inspectable(s) && s.inspectAt - s.t <= INSPECT_WARNING
          ? { here: false, seconds: Math.max(0, s.inspectAt - s.t), checks: inspection(s).map(({ key, label, fix, ok }) => ({ key, label, fix, ok })) }
          : null,
    sticker: s.sticker,
    sheets: s.sheets,
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
    fedAt: clock.now,
    fridge: 0,
    fridgeAt: clock.now + FRIDGE_EVERY,
    shock: 0,
    cinnamon: 0,
    vacation: 0,
    vacationAt: clock.now,
    radio: null,
    nextRadio: clock.now + 300,
    rescueAt: clock.now,
    deeds: { tupperware: 0, backpack: 0, keys: 0, iou: 0 },
    moves: 0,
    here: 0,
    floor: Object.fromEntries(DELBIES_PIECES.map((p) => [p.id, p.square])) as Record<DelbiesPieceId, number>,
    hotshot: 0,
    hotshotPay: 0,
    hotshotAt: clock.now,
    listed: 0,
    paper: 0,
    paperRate: 0,
    inspectAt: clock.now + INSPECT_FIRST,
    inspecting: 0,
    sticker: 0,
    sheets: 0,
    log: [],
  };
}

function load(saved: unknown): DelbiesState | null {
  if (!saved || typeof saved !== "object") return null;
  const g = saved as Record<string, unknown>;
  // A store from before the breakroom, the radio and the move is brought up to date: what it lacks starts as new.
  if (g.v !== VERSION && g.v !== 1 && g.v !== 2 && g.v !== 3 && g.v !== 4) return null;
  const old = g.v === 1;
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
  if (old) s.here = s.earned;
  else {
    const later: [keyof DelbiesState, number][] = [["fedAt", 9_100_000_000], ["fridge", FRIDGE.length - 1], ["fridgeAt", 9_100_000_000], ["shock", SHOCK_SECONDS], ["cinnamon", 9_100_000_000], ["vacation", VACATION_SECONDS], ["vacationAt", 9_100_000_000], ["nextRadio", 9_100_000_000], ["rescueAt", 9_100_000_000], ["moves", 1_000], ["here", CEILING]];
    for (const [key, high] of later) {
      const value = whole(g[key], 0, high);
      if (value === null) return null;
      (s[key] as number) = value;
    }
    const deeds = (g.deeds && typeof g.deeds === "object" ? g.deeds : {}) as Record<string, unknown>;
    for (const r of DELBIES_RELICS) s.deeds[r.id] = whole(deeds[r.id], 0, r.needs) ?? 0;
    const radio = g.radio as Record<string, unknown> | null | undefined;
    if (radio && typeof radio === "object" && Array.isArray(radio.options) && radio.options.length === 3) {
      const options = radio.options.map((o) => whole(o, 0, GARAGES.length - 1));
      const answer = whole(radio.answer, 0, 2);
      const until = whole(radio.until, 0, 9_100_000_000);
      if (options.every((o) => o !== null) && answer !== null && until !== null) s.radio = { options: options as [number, number, number], answer, until };
    }
  }
  // The Parts Network came last: a store from before it has no driver out and nothing up for sale.
  if (g.v === 4 || g.v === VERSION) {
    const network: [keyof DelbiesState, number][] = [["hotshot", HOTSHOT_SECONDS], ["hotshotPay", CEILING], ["hotshotAt", 9_100_000_000], ["listed", CEILING], ["paper", CEILING], ["paperRate", CEILING]];
    for (const [key, high] of network) {
      const value = whole(g[key], 0, high);
      if (value === null) return null;
      (s[key] as number) = value;
    }
  }
  // The inspector came after that: a store from before him gets its first visit a quarter of an hour on.
  if (g.v === VERSION) {
    const visits: [keyof DelbiesState, number][] = [["inspectAt", 9_100_000_000], ["inspecting", INSPECT_SECONDS], ["sticker", STICKER_SECONDS], ["sheets", CEILING]];
    for (const [key, high] of visits) {
      const value = whole(g[key], 0, high);
      if (value === null) return null;
      (s[key] as number) = value;
    }
  }
  // The floor plan: taken as it was only if every piece is on a square of its own and the building is where it should be.
  const floor = (g.floor && typeof g.floor === "object" ? g.floor : null) as Record<string, unknown> | null;
  if (floor) {
    const squares = PIECE_IDS.map((id) => whole(floor[id], 0, SQUARES - 1));
    const sound = squares.every((q) => q !== null) && new Set(squares).size === PIECE_IDS.length && DELBIES_PIECES.every((p, i) => !p.fixed || squares[i] === p.square);
    if (sound) PIECE_IDS.forEach((id, i) => (s.floor[id] = squares[i]!));
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
