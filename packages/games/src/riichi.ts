// Mahjong Riichi: the Japanese four-player game. Draw a tile, throw a tile, and race to a complete
// hand of four sets and a pair (or seven pairs, or thirteen orphans) that has at least one yaku.
// Others may take your discard to finish their own hand (ron), or make a set with it (pon, kan, and
// chi for the next seat only). A closed hand that is one tile from done can declare riichi.
//
// What it plays: 136 tiles, a dead wall of 14 with dora, ura dora and kan dora, red fives, riichi
// with ippatsu and double riichi, chi, pon, open and closed kans (and an added kan that can be
// robbed), furiten (your own discards, a pass on a ron this go-round, and a missed ron in riichi),
// tsumo and ron, exhaustive draws with tenpai payments, honba and riichi sticks, the dealer staying
// on a win or a tenpai draw, and a hanchan, a tonpuusen or a single hand. Scoring is in
// riichiscore.ts. Head bump decides when two players could ron the same tile.
//
// What it leaves out: three-player Sanma, double and triple ron, the abortive draws (nine
// terminals, four winds, four riichi, four kans by different players, triple ron), nagashi mangan,
// pao (paying for a big yakuman someone else fed), renhou, and sudden-death extra hands.
import type { PlayStyle } from "@journey-to-code/rules";
import { clone, GameError, markReady, nextHandChoices, nextRandom, shuffled, who, type BaseRules, type CardGame, type Choices, type KCard, type KitView, type Meld as KitMeld, type RoundResult } from "./kit.js";
import { canStartSequence, countsOf, doraAfter, isComplete, isDragon, isSimple, isWind, kindGlyph, kindName, kindOfId, rankOf, shanten, suitOf, tileOfId, waits, KINDS, type Counts } from "./riichicore.js";
import { basicPoints, payment, scoreHand, type CalledMeld, type Scored, type WinContext } from "./riichiscore.js";

void basicPoints;

export type RiichiLength = "hanchan" | "tonpuu" | "single";
export interface RiichiRules extends BaseRules {
  length: RiichiLength;
  /** The three red fives (one in each suit) are in the wall and count as dora. */
  redFives: boolean;
  /** An open hand may win on tanyao (all simples). */
  kuitan: boolean;
  /** Thirteen han or more is a yakuman. */
  kazoe: boolean;
  /** The game ends as soon as someone goes below zero. */
  bust: boolean;
  /** Seconds a player has to claim a discard before it counts as a pass; 0 waits as long as it takes. */
  claimSeconds: number;
}

const BASE: Omit<RiichiRules, "id" | "name"> = { length: "hanchan", redFives: true, kuitan: true, kazoe: true, bust: true, claimSeconds: 15 };
export const riichiHanchan: RiichiRules = { id: "hanchan", name: "Hanchan", ...BASE };
export const riichiTonpuu: RiichiRules = { id: "tonpuu", name: "Tonpuusen", ...BASE, length: "tonpuu" };
export const riichiSingle: RiichiRules = { id: "single", name: "Single hand", ...BASE, length: "single" };
const PRESETS = [riichiHanchan, riichiTonpuu, riichiSingle];
const LENGTHS: [RiichiLength, string][] = [
  ["hanchan", "Hanchan (east and south)"],
  ["tonpuu", "Tonpuusen (east only)"],
  ["single", "One hand"],
];
const START = 25000;
const WINDS = ["East", "South", "West", "North"];

// ---- State -------------------------------------------------------------------------------------

type MeldType = CalledMeld["type"];
interface Meld {
  type: MeldType;
  tiles: number[];
  /** The lowest kind of a chi; the kind of a pon or a kan. */
  kind: number;
  from: number | null;
}
interface River {
  id: number;
  riichi: boolean;
  claimed: boolean;
}
interface Seat {
  /** Concealed tiles by id, sorted, with the tile just drawn (if any) among them. */
  hand: number[];
  drawn: number | null;
  melds: Meld[];
  river: River[];
  riichi: boolean;
  doubleRiichi: boolean;
  ippatsu: boolean;
  /** Missed a ron while in riichi: furiten for good. */
  furiten: boolean;
  /** Passed on a ron: furiten until this seat discards. */
  passed: boolean;
  /** Kinds this seat may not throw now (it just called one of them). */
  noDiscard: number[];
}
interface Options {
  ron: boolean;
  pon: boolean;
  kan: boolean;
  /** The lowest kind of each sequence the tile can make. */
  chi: number[];
}
interface Claim {
  /** A discard, or a tile added to a pon (which can be robbed with ron). */
  type: "discard" | "kakan";
  from: number;
  tile: number;
  options: (Options | null)[];
  answers: (Record<string, unknown> | null)[];
}
interface Round {
  wall: number[];
  dead: number[];
  /** Dora indicators showing (the first is dead[4], then every second tile). */
  revealed: number;
  /** Indicators to turn over after the next discard (an open kan). */
  pending: number;
  /** Replacement tiles drawn from the dead wall. */
  rinshan: number;
  kans: number;
  /** Calls made by anyone: ends the hopes of a heavenly or earthly hand and of double riichi. */
  calls: number;
  seats: Seat[];
  turn: number;
  step: "discard" | "claim";
  claim: Claim | null;
  /** The tile this seat holds was a replacement after a kan. */
  afterKan: boolean;
  /** A seat that threw its tile sideways: riichi stands when the discard gets through. */
  riichiPending: number | null;
  last: { seat: number; index: number } | null;
}
interface Outcome {
  title: string;
  deltas: number[];
  yaku: string[];
  hands: string[];
  fuHan: string[];
}
export interface RiichiState {
  /** Rooms tell a game's states apart by this. */
  game: "mahjongriichi";
  rules: RiichiRules;
  seats: 4;
  rng: number;
  scores: number[];
  dealer: number;
  /** 0 east, 1 south. */
  wind: number;
  /** How many times the deal has passed on in this wind. */
  turns: number;
  honba: number;
  sticks: number;
  hands: number;
  phase: "play" | "result" | "finished";
  round: Round;
  outcome: Outcome | null;
  ready: boolean[];
  /** When the result is cleared: who deals next, and whether the game is over. */
  next: { dealer: number; wind: number; turns: number; honba: number; end: boolean } | null;
  narration: string | null;
}

type Move = Record<string, unknown>;

// ---- Tiles and counts --------------------------------------------------------------------------

const RED_KINDS = [4, 13, 22];
const isRed = (id: number, rules: RiichiRules) => rules.redFives && id % 4 === 0 && RED_KINDS.includes(kindOfId(id));
const cardOf = (id: number, rules: RiichiRules): KCard => ({ kind: "tile", tile: tileOfId(id), ...(isRed(id, rules) ? { red: true } : {}), id: `t${id}` }) as KCard;
const idOfCard = (card: unknown): number => {
  const m = /^t(\d+)$/.exec(String(card));
  if (!m) throw new GameError("That isn't a tile.");
  return Number(m[1]);
};
const glyph = (id: number) => kindGlyph(kindOfId(id));
const tileText = (id: number, rules: RiichiRules) => `${glyph(id)} ${isRed(id, rules) ? "red " : ""}${kindName(kindOfId(id))}`.replace(/\s+/g, " ");
const kindsOf = (ids: number[]) => ids.map(kindOfId);
const countsFor = (ids: number[]): Counts => countsOf(kindsOf(ids));
const seatWind = (s: RiichiState, seat: number) => (seat - s.dealer + 4) % 4;
const sorted = (ids: number[]) => ids.sort((a, b) => a - b);
const closed = (st: Seat) => st.melds.every((m) => m.type === "ankan");
const without = (ids: number[], remove: number[]) => {
  const out = [...ids];
  for (const id of remove) out.splice(out.indexOf(id), 1);
  return out;
};
/** Pick `n` tiles of a kind from a hand. */
const takeKind = (hand: number[], kind: number, n: number): number[] => hand.filter((id) => kindOfId(id) === kind).slice(0, n);

/** Every tile showing on the table, by kind: rivers (what wasn't taken), melds and dora indicators. */
function seen(r: Round): Counts {
  const c = countsOf([]);
  for (const st of r.seats) {
    for (const t of st.river) if (!t.claimed) c[kindOfId(t.id)]!++;
    for (const m of st.melds) for (const id of m.tiles) c[kindOfId(id)]!++;
  }
  for (let i = 0; i < r.revealed; i++) c[kindOfId(r.dead[4 + 2 * i]!)]!++;
  return c;
}

// ---- Winning -----------------------------------------------------------------------------------

function winContext(s: RiichiState, r: Round, seat: number, tsumo: boolean, winId: number, chankan: boolean): WinContext {
  const st = r.seats[seat]!;
  const ids = tsumo ? st.hand : [...st.hand, winId];
  const reds = [...ids, ...st.melds.flatMap((m) => m.tiles)].filter((id) => isRed(id, s.rules)).length;
  const doraKinds: number[] = [];
  const uraKinds: number[] = [];
  for (let i = 0; i < r.revealed; i++) {
    doraKinds.push(doraAfter(kindOfId(r.dead[4 + 2 * i]!)));
    uraKinds.push(doraAfter(kindOfId(r.dead[5 + 2 * i]!)));
  }
  const first = st.river.length === 0 && r.calls === 0;
  return {
    concealed: countsFor(ids),
    melds: st.melds.map((m) => ({ type: m.type, kind: m.kind })),
    winKind: kindOfId(winId),
    tsumo,
    seatWind: seatWind(s, seat),
    roundWind: s.wind,
    riichi: st.riichi,
    doubleRiichi: st.doubleRiichi,
    ippatsu: st.riichi && st.ippatsu,
    haitei: tsumo && r.wall.length === 0 && !r.afterKan,
    houtei: !tsumo && r.wall.length === 0 && !chankan,
    rinshan: tsumo && r.afterKan,
    chankan,
    tenhou: tsumo && first && seat === s.dealer,
    chiihou: tsumo && first && seat !== s.dealer,
    doraKinds,
    uraKinds,
    reds,
    kuitan: s.rules.kuitan,
    kazoe: s.rules.kazoe,
  };
}

/** What the hand would score if it won on this tile, or null when it can't win (not complete, or no yaku). */
function scoreWin(s: RiichiState, r: Round, seat: number, tsumo: boolean, winId: number, chankan = false): Scored | null {
  const ctx = winContext(s, r, seat, tsumo, winId, chankan);
  if (!isComplete(ctx.concealed, ctx.melds.length)) return null;
  return scoreHand(ctx);
}

const canTsumo = (s: RiichiState, r: Round, seat: number) => {
  const st = r.seats[seat]!;
  return st.drawn !== null && scoreWin(s, r, seat, true, st.drawn) !== null;
};

/** The kinds this seat waits on, with 13 tiles (less 3 a meld). */
const waitsOf = (st: Seat, hand = st.hand) => waits(countsFor(hand), st.melds.length);
const inFuriten = (st: Seat) => st.furiten || st.passed || waitsOf(st).some((k) => st.river.some((t) => kindOfId(t.id) === k));

// ---- Dealing and drawing -----------------------------------------------------------------------

function newSeat(hand: number[]): Seat {
  return { hand: sorted(hand), drawn: null, melds: [], river: [], riichi: false, doubleRiichi: false, ippatsu: false, furiten: false, passed: false, noDiscard: [] };
}

function deal(s: RiichiState): Round {
  const rand = nextRandom(s);
  const ids = shuffled(Array.from({ length: 136 }, (_, i) => i), rand);
  const r: Round = {
    wall: ids.slice(66),
    dead: ids.slice(52, 66),
    revealed: 1,
    pending: 0,
    rinshan: 0,
    kans: 0,
    calls: 0,
    seats: [0, 1, 2, 3].map((i) => newSeat(ids.slice(i * 13, i * 13 + 13))),
    turn: s.dealer,
    step: "discard",
    claim: null,
    afterKan: false,
    riichiPending: null,
    last: null,
  };
  drawTile(r, s.dealer, false);
  return r;
}

function drawTile(r: Round, seat: number, fromDead: boolean) {
  let id: number;
  if (fromDead) {
    id = r.dead[r.rinshan++]!;
    r.wall.pop();
  } else id = r.wall.shift()!;
  const st = r.seats[seat]!;
  st.hand.push(id);
  st.drawn = id;
  r.afterKan = fromDead;
}

// ---- Claims ------------------------------------------------------------------------------------

function chiOptions(st: Seat, kind: number): number[] {
  if (kind >= 27) return [];
  const have = countsFor(st.hand);
  const out: number[] = [];
  for (const low of [kind - 2, kind - 1, kind]) {
    if (low < 0 || rankOf(low) > 6) continue;
    let ok = true;
    for (let i = 0; i < 3; i++) if (low + i !== kind && have[low + i]! < 1) ok = false;
    if (ok) out.push(low);
  }
  return out;
}

/** Who can do what with this tile; null for a seat with nothing to do. */
function claimOptions(s: RiichiState, r: Round, from: number, tile: number, type: Claim["type"]): (Options | null)[] {
  const kind = kindOfId(tile);
  return r.seats.map((st, seat) => {
    if (seat === from) return null;
    const o: Options = { ron: false, pon: false, kan: false, chi: [] };
    if (!inFuriten(st) && scoreWin(s, r, seat, false, tile, type === "kakan") !== null) o.ron = true;
    if (type === "discard" && r.wall.length > 0 && !st.riichi) {
      const have = st.hand.filter((id) => kindOfId(id) === kind).length;
      o.pon = have >= 2;
      o.kan = have >= 3 && r.kans < 4;
      if (seat === (from + 1) % 4) o.chi = chiOptions(st, kind);
    }
    return o.ron || o.pon || o.kan || o.chi.length ? o : null;
  });
}

const anyOptions = (c: Claim) => c.options.some(Boolean);

/** Seats still to answer. */
const pending = (c: Claim) => c.options.map((o, i) => (o && !c.answers[i] ? i : -1)).filter((i) => i >= 0);

function establishRiichi(s: RiichiState, r: Round) {
  if (r.riichiPending === null) return;
  const st = r.seats[r.riichiPending]!;
  st.riichi = true;
  st.ippatsu = true;
  st.doubleRiichi = st.river.length === 1 && r.calls === 0;
  s.scores[r.riichiPending]! -= 1000;
  s.sticks++;
  r.riichiPending = null;
}

// ---- Ending a hand -----------------------------------------------------------------------------

const signed = (n: number) => (n > 0 ? `+${n}` : String(n));

function handText(st: Seat, extra: number | null): string {
  const tiles = st.hand.map((id) => glyph(id)).join("");
  const melds = st.melds.map((m) => m.tiles.map((id) => glyph(id)).join("")).join(" ");
  return [tiles, extra !== null ? `+ ${glyph(extra)}` : "", melds].filter(Boolean).join(" ");
}

/** Work out who deals next and whether that is the end of the game. */
function planNext(s: RiichiState, dealerStays: boolean, honbaUp: boolean): NonNullable<RiichiState["next"]> {
  let { dealer, wind, turns, honba } = s;
  honba = honbaUp ? honba + 1 : 0;
  const lastWind = s.rules.length === "hanchan" ? 1 : 0;
  const top = s.scores.indexOf(Math.max(...s.scores));
  let end = s.rules.length === "single" || (s.rules.bust && s.scores.some((p) => p < 0)) || s.hands >= 24;
  if (dealerStays) {
    // The last hand of the game: the dealer on top ends it rather than going round again.
    if (wind === lastWind && turns === 3 && dealer === top) end = true;
  } else {
    dealer = (dealer + 1) % 4;
    turns++;
    if (turns === 4) {
      turns = 0;
      wind++;
    }
    if (wind > lastWind) end = true;
  }
  return { dealer, wind, turns, honba, end };
}

function finishHand(s: RiichiState, outcome: Outcome, dealerStays: boolean, honbaUp: boolean) {
  for (let i = 0; i < 4; i++) s.scores[i]! += outcome.deltas[i]!;
  s.hands++;
  s.outcome = outcome;
  s.next = planNext(s, dealerStays, honbaUp);
  s.phase = "result";
  s.ready = [false, false, false, false];
  s.narration = outcome.title;
}

function win(s: RiichiState, r: Round, winner: number, scored: Scored, tsumo: boolean, from: number | null, winId: number) {
  const dealerWins = winner === s.dealer;
  const pay = payment(scored.basic, dealerWins, tsumo, s.honba);
  const deltas = [0, 0, 0, 0];
  if (tsumo) {
    for (let o = 0; o < 4; o++) {
      if (o === winner) continue;
      const each = o === s.dealer ? pay.tsumo!.dealer : pay.tsumo!.other;
      deltas[o]! -= each;
      deltas[winner]! += each;
    }
  } else {
    deltas[from!]! -= pay.ron!;
    deltas[winner]! += pay.ron!;
  }
  deltas[winner]! += s.sticks * 1000;
  s.sticks = 0;
  const list = [...scored.yakuman.map((y) => (y.times > 1 ? `${y.name} ×${y.times}` : y.name)), ...scored.yaku.map((y) => `${y.name} ${y.han}`)];
  if (scored.dora) list.push(`Dora ${scored.dora}`);
  if (scored.ura) list.push(`Ura dora ${scored.ura}`);
  if (scored.red) list.push(`Red five ${scored.red}`);
  const how = tsumo ? "tsumo" : `ron on ${who(from!)}`;
  const size = scored.yakuman.length ? "" : `${scored.han} han ${scored.fu} fu`;
  const st = r.seats[winner]!;
  const outcome: Outcome = {
    title: `${who(winner)} wins by ${how}${scored.limit ? `: ${scored.limit}` : ""}${size ? ` (${size})` : ""}`,
    deltas,
    yaku: [0, 1, 2, 3].map((i) => (i === winner ? list.join(", ") : "")),
    hands: [0, 1, 2, 3].map((i) => (i === winner ? handText(st, tsumo ? null : winId) : "")),
    fuHan: [0, 1, 2, 3].map((i) => (i === winner ? (size || scored.limit || "") : "")),
  };
  finishHand(s, outcome, dealerWins, dealerWins);
}

function exhaustive(s: RiichiState, r: Round) {
  const tenpai = r.seats.map((st) => waitsOf(st).length > 0);
  const n = tenpai.filter(Boolean).length;
  const deltas = [0, 0, 0, 0];
  if (n > 0 && n < 4) for (let i = 0; i < 4; i++) deltas[i] = tenpai[i] ? 3000 / n : -3000 / (4 - n);
  const names = tenpai.map((t, i) => (t ? who(i) : "")).filter(Boolean);
  const outcome: Outcome = {
    title: `The wall is empty: ${n === 0 ? "nobody is in tenpai" : n === 4 ? "everyone is in tenpai" : `${names.join(" and ")} in tenpai`}`,
    deltas,
    yaku: ["", "", "", ""],
    hands: tenpai.map((t, i) => (t ? handText(r.seats[i]!, null) : "")),
    fuHan: ["", "", "", ""],
  };
  finishHand(s, outcome, tenpai[s.dealer]!, true);
}

// ---- Turn flow ---------------------------------------------------------------------------------

/** Nobody wanted the discard (or the added kan): play goes on. */
function moveOn(s: RiichiState, r: Round) {
  r.claim = null;
  r.step = "discard";
  const c = r.last;
  if (c && r.seats[c.seat]!.river.length && r.riichiPending !== null) establishRiichi(s, r);
  if (r.wall.length === 0) {
    exhaustive(s, r);
    return;
  }
  r.turn = (r.turn + 1) % 4;
  drawTile(r, r.turn, false);
}

function openClaim(s: RiichiState, r: Round, from: number, tile: number, type: Claim["type"]) {
  const options = claimOptions(s, r, from, tile, type);
  if (!options.some(Boolean)) {
    if (type === "discard") moveOn(s, r);
    else kanDraw(r, from);
    return;
  }
  r.step = "claim";
  r.claim = { type, from, tile, options, answers: options.map(() => null) };
}

function kanDraw(r: Round, seat: number) {
  r.claim = null;
  r.step = "discard";
  r.turn = seat;
  drawTile(r, seat, true);
}

function cancelIppatsu(r: Round) {
  for (const st of r.seats) st.ippatsu = false;
}

function resolve(s: RiichiState, r: Round) {
  const c = r.claim!;
  const order = [1, 2, 3].map((d) => (c.from + d) % 4);
  const pick = (type: string) => order.find((i) => c.answers[i]?.type === type);
  const ron = pick("ron");
  // Anyone who could have ron'd and didn't is in furiten for a while (for good, in riichi).
  for (const i of order) {
    if (c.options[i]?.ron && i !== ron) {
      const st = r.seats[i]!;
      if (st.riichi) st.furiten = true;
      else st.passed = true;
    }
  }
  if (ron !== undefined) {
    const scored = scoreWin(s, r, ron, false, c.tile, c.type === "kakan")!;
    r.riichiPending = null;
    win(s, r, ron, scored, false, c.from, c.tile);
    return;
  }
  if (c.type === "kakan") {
    kanDraw(r, c.from);
    return;
  }
  const kan = pick("kan");
  const pon = pick("pon");
  const chi = pick("chi");
  const who2 = kan ?? pon ?? chi;
  if (who2 === undefined) {
    moveOn(s, r);
    return;
  }
  establishRiichi(s, r);
  const st = r.seats[who2]!;
  const from = r.seats[c.from]!;
  const kind = kindOfId(c.tile);
  const taken = kan !== undefined ? takeKind(st.hand, kind, 3) : pon !== undefined ? takeKind(st.hand, kind, 2) : [];
  let meld: Meld;
  if (chi !== undefined) {
    const low = Number(c.answers[chi]!.low);
    const own = [low, low + 1, low + 2].filter((k) => k !== kind).flatMap((k) => takeKind(st.hand, k, 1));
    taken.push(...own);
    meld = { type: "chi", tiles: [...own, c.tile], kind: low, from: c.from };
    const forbid = [kind];
    if (kind === low && rankOf(low) + 3 <= 8) forbid.push(low + 3);
    if (kind === low + 2 && rankOf(low) >= 1) forbid.push(low - 1);
    st.noDiscard = forbid;
  } else {
    meld = { type: kan !== undefined ? "daiminkan" : "pon", tiles: [...taken, c.tile], kind, from: c.from };
    st.noDiscard = kan !== undefined ? [] : [kind];
  }
  st.hand = sorted(without(st.hand, taken));
  st.drawn = null;
  st.melds.push(meld);
  from.river[r.last!.index]!.claimed = true;
  cancelIppatsu(r);
  r.calls++;
  r.claim = null;
  r.step = "discard";
  r.turn = who2;
  if (kan !== undefined) {
    r.kans++;
    r.pending++;
    drawTile(r, who2, true);
  }
}

// ---- Moves -------------------------------------------------------------------------------------

/** Whether throwing this tile leaves the hand one away from done (and so may declare riichi). */
function riichiDiscards(s: RiichiState, r: Round, seat: number): number[] {
  const st = r.seats[seat]!;
  if (st.riichi || !closed(st) || s.scores[seat]! < 1000 || r.wall.length < 4) return [];
  const out: number[] = [];
  const done = new Set<number>();
  for (const id of st.hand) {
    const k = kindOfId(id);
    if (done.has(k)) continue;
    done.add(k);
    if (st.noDiscard.includes(k)) continue;
    if (waitsOf(st, without(st.hand, [id])).length) out.push(id);
  }
  return out;
}

function allowedDiscards(r: Round, seat: number): number[] {
  const st = r.seats[seat]!;
  if (st.riichi) return st.drawn !== null ? [st.drawn] : [];
  const ok = st.hand.filter((id) => !st.noDiscard.includes(kindOfId(id)));
  return ok.length ? ok : [...st.hand];
}

/** Kinds that can be declared as a closed kan now, and as an added kan. */
function kanChoices(r: Round, seat: number): { ankan: number[]; kakan: number[] } {
  const st = r.seats[seat]!;
  if (r.wall.length === 0 || r.kans >= 4 || st.drawn === null) return { ankan: [], kakan: [] };
  const have = countsFor(st.hand);
  let ankan: number[] = [];
  for (let k = 0; k < KINDS; k++) if (have[k] === 4) ankan.push(k);
  if (st.riichi) {
    // Only when it doesn't change what the hand waits on.
    const drawnKind = kindOfId(st.drawn);
    const before = waitsOf(st, without(st.hand, [st.drawn]));
    ankan = ankan.filter((k) => {
      if (k !== drawnKind) return false;
      const rest = countsFor(without(st.hand, takeKind(st.hand, k, 4)));
      const after = waits(rest, st.melds.length + 1);
      return after.length === before.length && after.every((w) => before.includes(w));
    });
  }
  const kakan = st.riichi ? [] : st.melds.filter((m) => m.type === "pon" && st.hand.some((id) => kindOfId(id) === m.kind)).map((m) => m.kind);
  return { ankan, kakan };
}

function discard(s: RiichiState, r: Round, seat: number, move: Move) {
  const st = r.seats[seat]!;
  const id = idOfCard(move.card);
  if (!st.hand.includes(id)) throw new GameError("You don't have that tile.");
  if (!allowedDiscards(r, seat).includes(id)) throw new GameError(st.riichi ? "In riichi you throw the tile you draw." : "You can't throw that tile right after calling it.");
  const riichi = move.riichi === true;
  if (riichi && !riichiDiscards(s, r, seat).some((x) => kindOfId(x) === kindOfId(id))) throw new GameError("You can't declare riichi with that tile.");
  const wasDrawn = st.drawn;
  st.hand = sorted(without(st.hand, [id]));
  void wasDrawn;
  st.drawn = null;
  st.noDiscard = [];
  st.passed = false;
  if (st.riichi) st.ippatsu = false;
  st.river.push({ id, riichi, claimed: false });
  r.last = { seat, index: st.river.length - 1 };
  r.revealed += r.pending;
  r.pending = 0;
  r.afterKan = false;
  r.riichiPending = riichi ? seat : null;
  s.narration = `${who(seat)} ${riichi ? "declares riichi and throws" : "threw"} ${tileText(id, s.rules)}`;
  openClaim(s, r, seat, id, "discard");
}

function answer(s: RiichiState, r: Round, seat: number, move: Move, type: string) {
  const c = r.claim;
  const o = c?.options[seat];
  if (!c || !o) throw new GameError("There is nothing for you to claim.");
  if (c.answers[seat]) throw new GameError("You have answered already.");
  if (type === "ron" && !o.ron) throw new GameError("That isn't a winning hand.");
  if (type === "pon" && !o.pon) throw new GameError("You can't pon that tile.");
  if (type === "kan" && !o.kan) throw new GameError("You can't kan that tile.");
  if (type === "chi" && !o.chi.includes(Number(move.low))) throw new GameError("You can't chi with those tiles.");
  c.answers[seat] = type === "chi" ? { type, low: Number(move.low) } : { type };
  const t = c.tile;
  if (type !== "pass") s.narration = `${who(seat)}: ${type === "ron" ? "Ron!" : type === "chi" ? "Chi" : type === "pon" ? "Pon" : "Kan"} on ${tileText(t, s.rules)}`;
  if (pending(c).length === 0) resolve(s, r);
}

function apply(state: RiichiState, seat: number, move: Move): RiichiState {
  const s = clone(state);
  const type = String(move.type);
  if (s.phase === "finished") throw new GameError("The game is over.");
  if (s.phase === "result") {
    if (type !== "next") throw new GameError("Waiting for the next hand.");
    if (markReady(s.ready, seat)) {
      const n = s.next!;
      if (n.end) {
        s.phase = "finished";
        const top = s.scores.indexOf(Math.max(...s.scores));
        s.scores[top]! += s.sticks * 1000;
        s.sticks = 0;
        return s;
      }
      s.dealer = n.dealer;
      s.wind = n.wind;
      s.turns = n.turns;
      s.honba = n.honba;
      s.outcome = null;
      s.next = null;
      s.round = deal(s);
      s.phase = "play";
      s.narration = null;
    }
    return s;
  }
  const r = s.round;
  if (r.step === "claim") {
    if (type !== "ron" && type !== "pon" && type !== "kan" && type !== "chi" && type !== "pass") throw new GameError("Claim the tile or pass.");
    answer(s, r, seat, move, type);
    return s;
  }
  if (r.turn !== seat) throw new GameError("It isn't your turn.");
  const st = r.seats[seat]!;
  switch (type) {
    case "discard":
      discard(s, r, seat, move);
      return s;
    case "tsumo": {
      if (st.drawn === null) throw new GameError("You have nothing to win with.");
      const scored = scoreWin(s, r, seat, true, st.drawn);
      if (!scored) throw new GameError("That hand can't win.");
      win(s, r, seat, scored, true, null, st.drawn);
      return s;
    }
    case "ankan": {
      const kind = Number(move.kind);
      if (!kanChoices(r, seat).ankan.includes(kind)) throw new GameError("You can't make that kan.");
      const tiles = takeKind(st.hand, kind, 4);
      st.hand = sorted(without(st.hand, tiles));
      st.drawn = null;
      st.melds.push({ type: "ankan", tiles, kind, from: null });
      r.kans++;
      r.calls++;
      r.revealed++;
      cancelIppatsu(r);
      drawTile(r, seat, true);
      s.narration = `${who(seat)} makes a closed kan of ${glyph(tiles[0]!)}`;
      return s;
    }
    case "kakan": {
      const kind = Number(move.kind);
      if (!kanChoices(r, seat).kakan.includes(kind)) throw new GameError("You can't add to that set.");
      const id = takeKind(st.hand, kind, 1)[0]!;
      const meld = st.melds.find((m) => m.type === "pon" && m.kind === kind)!;
      meld.type = "kakan";
      meld.tiles.push(id);
      st.hand = sorted(without(st.hand, [id]));
      st.drawn = null;
      r.kans++;
      r.calls++;
      r.pending++;
      cancelIppatsu(r);
      s.narration = `${who(seat)} adds ${glyph(id)} to a kan`;
      openClaim(s, r, seat, id, "kakan");
      return s;
    }
    default:
      throw new GameError("Throw a tile.");
  }
}

// ---- Views -------------------------------------------------------------------------------------

function ownChoices(s: RiichiState, r: Round, seat: number): Choices | null {
  const options: Choices["options"] = [];
  if (canTsumo(s, r, seat)) options.push({ label: "Tsumo", move: { type: "tsumo" }, primary: true });
  const seenKinds = new Set<number>();
  for (const id of riichiDiscards(s, r, seat)) {
    if (seenKinds.has(kindOfId(id))) continue;
    seenKinds.add(kindOfId(id));
    options.push({ label: `Riichi: throw ${glyph(id)}`, move: { type: "discard", card: `t${id}`, riichi: true } });
  }
  const kans = kanChoices(r, seat);
  for (const k of kans.ankan) options.push({ label: `Closed kan ${kindGlyph(k)}`, move: { type: "ankan", kind: k } });
  for (const k of kans.kakan) options.push({ label: `Add to kan ${kindGlyph(k)}`, move: { type: "kakan", kind: k } });
  return options.length ? { prompt: "Throw a tile, or:", options, layout: "grid" } : null;
}

function claimChoices(s: RiichiState, r: Round, seat: number): Choices | null {
  const c = r.claim;
  const o = c?.options[seat];
  if (!c || !o || c.answers[seat]) return null;
  const options: Choices["options"] = [];
  const g = glyph(c.tile);
  if (o.ron) options.push({ label: "Ron", move: { type: "ron" }, primary: true });
  if (o.kan) options.push({ label: `Kan ${g}`, move: { type: "kan" } });
  if (o.pon) options.push({ label: `Pon ${g}`, move: { type: "pon" } });
  for (const low of o.chi) options.push({ label: `Chi ${kindGlyph(low)}${kindGlyph(low + 1)}${kindGlyph(low + 2)}`, move: { type: "chi", low } });
  options.push({ label: "Pass", move: { type: "pass" } });
  return { prompt: c.type === "kakan" ? `${who(c.from)} adds ${tileText(c.tile, s.rules)} to a kan` : `${who(c.from)} threw ${tileText(c.tile, s.rules)}`, options, layout: "row" };
}

function ranking(s: RiichiState): number[] {
  return [0, 1, 2, 3].sort((a, b) => s.scores[b]! - s.scores[a]! || a - b);
}

function view(s: RiichiState, me: number): KitView {
  const r = s.round;
  const st = r.seats[me]!;
  const playing = s.phase === "play";
  const hand = [...st.hand.filter((id) => id !== st.drawn), ...(st.drawn !== null ? [st.drawn] : [])].map((id) => cardOf(id, s.rules));
  const mine = playing && r.step === "discard" && r.turn === me;
  const label = (m: Meld) => (m.type === "ankan" ? "Closed kan" : m.type === "kakan" || m.type === "daiminkan" ? "Kan" : m.type === "chi" ? "Chi" : "Pon");
  const melds: KitMeld[] = r.seats.flatMap((x, owner) => x.melds.map((m) => ({ owner, label: label(m), cards: m.tiles.map((id) => cardOf(id, s.rules)) })));
  const indicators = Array.from({ length: r.revealed }, (_, i) => cardOf(r.dead[4 + 2 * i]!, s.rules));
  const finished = s.phase === "finished";
  const rows = s.outcome;
  const result: RoundResult | null =
    s.phase === "result" && rows
      ? {
          key: `hand${s.hands}`,
          title: rows.title,
          sides: [[0], [1], [2], [3]],
          rows: [
            ...(rows.fuHan.some(Boolean) ? [{ label: "Value", values: rows.fuHan }] : []),
            ...(rows.yaku.some(Boolean) ? [{ label: "Yaku", values: rows.yaku }] : []),
            { label: "Hand", values: rows.hands },
            { label: "Points", values: rows.deltas.map(signed), tone: "score" as const },
            { label: "Score", values: s.scores.map(String), tone: "total" as const },
          ],
        }
      : null;
  const order = ranking(s);
  const top = order[0]!;
  return {
    game: "mahjongriichi",
    seats: 4,
    me,
    teams: false,
    phase: playing ? r.step : s.phase,
    turn: playing && r.step === "discard" ? r.turn : null,
    dealer: s.dealer,
    hand,
    tap: mine ? { type: "discard", cards: allowedDiscards(r, me).map((id) => `t${id}`) } : null,
    pick: null,
    choices: s.phase === "result" ? nextHandChoices(s.ready, me, s.next!.end) : mine ? ownChoices(s, r, me) : playing && r.step === "claim" ? claimChoices(s, r, me) : null,
    players: r.seats.map((x, i) => ({
      cards: x.hand.length,
      line: `${WINDS[seatWind(s, i)]} · ${s.scores[i]}`,
      dealer: i === s.dealer,
      ...(x.riichi ? { badge: "Riichi" } : {}),
    })),
    center: {
      kind: "rivers",
      rivers: r.seats.map((x, seat) => ({ seat, tiles: x.river.map((t) => ({ card: cardOf(t.id, s.rules), riichi: t.riichi, claimed: t.claimed })) })),
      indicators,
      wall: r.wall.length,
      last: playing ? r.last : null,
    },
    melds,
    info: [`${WINDS[s.wind]} ${s.turns + 1}`, `${s.honba} honba · ${s.sticks} riichi stick${s.sticks === 1 ? "" : "s"}`, `${r.wall.length} tiles in the wall`],
    narration: s.narration,
    scores: s.scores.map((value, i) => ({ seats: [i], value })),
    result,
    over: finished ? { winners: [top], title: `${who(top)} wins with ${s.scores[top]} points` } : null,
  };
}

// ---- The computer player -----------------------------------------------------------------------

const careless = (style: PlayStyle, rand: () => number) => rand() < (style.sloppy ?? 0) + (1 - (style.skill ?? 1)) * 0.2;

/** How much a tile is worth keeping when the hand is far from done: pairs and neighbours, dora and yakuhai. */
function keepValue(s: RiichiState, r: Round, seat: number, counts: Counts, k: number): number {
  let v = counts[k]! * 4;
  if (k >= 27) {
    const hai = isDragon(k) || k === 27 + seatWind(s, seat) || k === 27 + s.wind;
    return v + (hai ? 4 : 0) - (counts[k]! === 1 ? 3 : 0);
  }
  const rk = rankOf(k);
  for (const d of [-2, -1, 1, 2]) {
    const j = k + d;
    if (j < 0 || j >= 27 || suitOf(j) !== suitOf(k)) continue;
    v += counts[j]! * (Math.abs(d) === 1 ? 3 : 1.5);
  }
  if (rk === 0 || rk === 8) v -= 2;
  else if (rk === 1 || rk === 7) v -= 1;
  const dora = Array.from({ length: r.revealed }, (_, i) => doraAfter(kindOfId(r.dead[4 + 2 * i]!)));
  v += dora.filter((d) => d === k).length * 5;
  return v;
}

/** Kinds that are safe against a riichi: ones that player has already thrown. */
function safeKinds(r: Round, seat: number): Set<number> | null {
  const riichis = r.seats.filter((x, i) => i !== seat && x.riichi);
  if (!riichis.length) return null;
  const safe = new Set<number>();
  for (let k = 0; k < KINDS; k++) if (riichis.every((x) => x.river.some((t) => kindOfId(t.id) === k))) safe.add(k);
  return safe;
}

function botDiscard(s: RiichiState, r: Round, seat: number, style: PlayStyle, rand: () => number): Move {
  const st = r.seats[seat]!;
  if (canTsumo(s, r, seat)) return { type: "tsumo" };
  const m = st.melds.length;
  const counts = countsFor(st.hand);
  const base = shanten(counts, m);
  const clever = !careless(style, rand);
  // Kans that cost nothing.
  if (clever) {
    const kans = kanChoices(r, seat);
    for (const k of kans.ankan) {
      const after = [...counts];
      after[k] = 0;
      if (shanten(after, m + 1) <= base) return { type: "ankan", kind: k };
    }
    for (const k of kans.kakan) {
      const after = [...counts];
      after[k]!--;
      if (shanten(after, m) <= base) return { type: "kakan", kind: k };
    }
  }
  const allowed = allowedDiscards(r, seat);
  const kinds = [...new Set(allowed.map(kindOfId))];
  const idOf = (k: number) => allowed.find((id) => kindOfId(id) === k && id !== st.drawn) ?? allowed.find((id) => kindOfId(id) === k)!;
  if (kinds.length === 1) return { type: "discard", card: `t${idOf(kinds[0]!)}` };
  const safe = safeKinds(r, seat);
  const eyes = seen(r);
  const scored = kinds.map((k) => {
    const c = [...counts];
    c[k]!--;
    return { k, sh: shanten(c, m), c };
  });
  const best = Math.min(...scored.map((x) => x.sh));
  // Riichi when one tile away and the wait is worth having.
  const rd = riichiDiscards(s, r, seat);
  if (clever && best === 0 && rd.length) {
    let pick: { id: number; left: number } | null = null;
    for (const id of rd) {
      const k = kindOfId(id);
      const rest = without(st.hand, [id]);
      const left = waits(countsFor(rest), m).reduce((n, w) => n + Math.max(0, 4 - eyes[w]! - countsFor(rest)[w]! - (w === k ? 1 : 0)), 0);
      if (!pick || left > pick.left) pick = { id, left };
    }
    if (pick && pick.left >= 2) return { type: "discard", card: `t${pick.id}`, riichi: true };
  }
  let pool = scored.filter((x) => x.sh === best);
  // Against a riichi, with a hand that isn't close, throw what is safe.
  if (safe && clever && best >= 1) {
    const sure = scored.filter((x) => safe.has(x.k) && x.sh <= best + 1);
    if (sure.length) pool = sure.sort((a, b) => a.sh - b.sh);
  }
  if (pool.length === 1) return { type: "discard", card: `t${idOf(pool[0]!.k)}` };
  let choice = pool[0]!;
  let top = -Infinity;
  for (const x of pool) {
    let v: number;
    if (best >= 3 || !clever) v = -keepValue(s, r, seat, counts, x.k);
    else {
      // Tiles that bring the hand closer: the more of them left to draw, the better.
      let ukeire = 0;
      for (let j = 0; j < KINDS; j++) {
        if (x.c[j]! >= 4) continue;
        x.c[j]!++;
        if (shanten(x.c, m) < x.sh) ukeire += Math.max(0, 4 - eyes[j]! - x.c[j]! + 1 - (j === x.k ? 1 : 0));
        x.c[j]!--;
      }
      v = ukeire * 10 - keepValue(s, r, seat, counts, x.k) * 0.1;
    }
    if (v > top) {
      top = v;
      choice = x;
    }
  }
  return { type: "discard", card: `t${idOf(choice.k)}` };
}

function botClaim(s: RiichiState, r: Round, seat: number, style: PlayStyle, rand: () => number): Move {
  const c = r.claim!;
  const o = c.options[seat]!;
  if (o.ron) return { type: "ron" };
  if (careless(style, rand) && rand() < 0.5) return { type: "pass" };
  const st = r.seats[seat]!;
  const kind = kindOfId(c.tile);
  const m = st.melds.length;
  const counts = countsFor(st.hand);
  const before = shanten(counts, m);
  const hai = isDragon(kind) || kind === 27 + seatWind(s, seat) || kind === 27 + s.wind;
  // Only calls that keep a yaku: a yakuhai triplet, or an open hand of simples.
  const simplesOnly = (extra: number[]) => s.rules.kuitan && [...st.hand.map(kindOfId), ...st.melds.flatMap((x) => x.tiles.map(kindOfId)), ...extra].every(isSimple);
  if (o.pon) {
    const after = [...counts];
    after[kind]! -= 2;
    const sh = shanten(after, m + 1);
    if ((hai && sh <= before) || (simplesOnly([kind]) && sh < before)) return { type: "pon" };
  }
  for (const low of o.chi) {
    if (!simplesOnly([kind])) break;
    const after = [...counts];
    for (let i = 0; i < 3; i++) if (low + i !== kind) after[low + i]!--;
    if (shanten(after, m + 1) < before && canStartSequence(low)) return { type: "chi", low };
  }
  return { type: "pass" };
}

function bot(s: RiichiState, seat: number, style: PlayStyle, rand: () => number = Math.random): Move | null {
  if (s.phase === "finished") return null;
  if (s.phase === "result") return s.ready[seat] ? null : { type: "next" };
  const r = s.round;
  if (r.step === "claim") {
    const c = r.claim!;
    if (!c.options[seat] || c.answers[seat]) return null;
    return botClaim(s, r, seat, style, rand);
  }
  if (r.turn !== seat) return null;
  return botDiscard(s, r, seat, style, rand);
}

// ---- The game ----------------------------------------------------------------------------------

export function newRiichi(rules: RiichiRules, seats: number, seed: number): RiichiState {
  if (seats !== 4) throw new GameError("Riichi is a game for four.");
  const s = {
    game: "mahjongriichi",
    rules,
    seats: 4,
    rng: seed >>> 0,
    scores: [START, START, START, START],
    dealer: 0,
    wind: 0,
    turns: 0,
    honba: 0,
    sticks: 0,
    hands: 0,
    phase: "play",
    outcome: null,
    ready: [false, false, false, false],
    next: null,
    narration: null,
  } as unknown as RiichiState;
  s.round = deal(s);
  return s;
}

export const mahjongRiichi: CardGame<RiichiRules, RiichiState, Move> = {
  id: "mahjongriichi",
  name: "Mahjong Riichi",
  emoji: "🀄",
  category: "cards",
  blurb: "Japanese mahjong: riichi, dora and calls for four",
  tagline: "Build a hand of four sets and a pair, call discards, declare riichi, and win by tsumo or ron.",
  seats: { min: 4, max: 4, default: 4 },
  teams: false,
  presets: PRESETS,
  fields: [
    { key: "length", label: "Length", hint: "How many hands make a game.", kind: "choice", options: LENGTHS },
    { key: "redFives", label: "Red fives", hint: "One red five in each suit, each worth a dora.", kind: "toggle" },
    { key: "kuitan", label: "Open tanyao", hint: "A hand with calls may win on tanyao (all simples).", kind: "toggle" },
    { key: "kazoe", label: "Counted yakuman", hint: "Thirteen han or more counts as a yakuman.", kind: "toggle" },
    { key: "bust", label: "Game ends below zero", hint: "Someone going below zero points ends the game.", kind: "toggle" },
    { key: "claimSeconds", label: "Seconds to claim", hint: "How long a discard waits for a call before it counts as a pass. 0 waits as long as it takes.", kind: "number", min: 0, max: 60 },
  ],
  normalize(rules) {
    const given = (rules && typeof rules === "object" ? rules : {}) as Partial<RiichiRules>;
    const base = PRESETS.find((p) => p.id === given.id) ?? riichiHanchan;
    const flag = (v: unknown, d: boolean) => (v === undefined ? d : !!v);
    return {
      ...base,
      ...given,
      id: given.id ?? base.id,
      name: given.name ?? base.name,
      length: LENGTHS.some(([id]) => id === given.length) ? given.length! : base.length,
      redFives: flag(given.redFives, base.redFives),
      kuitan: flag(given.kuitan, base.kuitan),
      kazoe: flag(given.kazoe, base.kazoe),
      bust: flag(given.bust, base.bust),
      claimSeconds: given.claimSeconds === undefined ? base.claimSeconds : Math.max(0, Math.min(60, Math.round(Number(given.claimSeconds) || 0))),
    };
  },
  validate: (r) => [...(LENGTHS.some(([id]) => id === r.length) ? [] : ["Pick how long the game is."]), ...(r.claimSeconds >= 0 && r.claimSeconds <= 60 ? [] : ["Claim time goes from 0 to 60 seconds."])],
  describe(r) {
    return [
      `Four players, ${START} points each. Draw a tile and throw one. A complete hand is four sets (runs of three or triplets) and a pair, seven pairs, or thirteen orphans, and it needs at least one yaku.`,
      "Take a discard to finish your hand (ron), or make a pon or a kan with it; chi, a run, only from the player before you. Calling opens your hand.",
      "Riichi: with a closed hand one tile from done, pay 1000 points and throw a tile sideways. You can no longer change your hand, but you win ura dora and often ippatsu.",
      "Dora tiles, shown by the indicators, add han. " + (r.redFives ? "The three red fives are dora too." : "There are no red fives."),
      "You can't ron a tile you have thrown yourself, or one you passed on since your last turn (furiten). If two players could ron, the one next in turn wins.",
      r.length === "single" ? "One hand, then it is over." : r.length === "tonpuu" ? "Four hands, the east round. The dealer stays on a win or a tenpai draw." : "Eight hands, east then south rounds. The dealer stays on a win or a tenpai draw.",
      `${r.kuitan ? "Open hands may win on tanyao" : "Tanyao needs a closed hand"}. ${r.kazoe ? "Thirteen han is a yakuman." : "Thirteen han stays a sanbaiman."} ${r.bust ? "The game ends if anyone goes below zero." : ""}`.trim(),
      "Not played: three-player mahjong, double ron, abortive draws, nagashi mangan.",
    ];
  },
  newGame: newRiichi,
  apply,
  view,
  bot,
  heavy: (s, seat) => s.phase === "play" && s.round.step === "discard" && s.round.turn === seat,
  thinkingTime: (s, seat) => (s.phase === "play" && s.round.step === "discard" && s.round.turn === seat ? 1000 : 400),
  deadline(s) {
    if (s.phase !== "play" || s.round.step !== "claim" || !s.rules.claimSeconds) return null;
    const seat = pending(s.round.claim!)[0];
    return seat === undefined ? null : { after: s.rules.claimSeconds * 1000, seat, move: { type: "pass" } };
  },
  summary(s) {
    const over = s.phase === "finished";
    const order = ranking(s);
    return {
      game: "mahjongriichi",
      rules: s.rules.name,
      phase: s.phase,
      over,
      hand: s.hands + 1,
      scoreLine: s.scores.map((p, i) => `${who(i)} ${p}`).join(" · "),
      order: over ? order : null,
      winners: over ? [order[0]!] : null,
      teams: false,
      seats: 4,
    };
  },
};

void isWind;
