// Scoring a winning Riichi hand: which yaku it has, how many fu, and what that is worth. It knows
// nothing about turns or tables; give it the concealed tiles (with the winning tile in them), the
// called melds and the facts about the win, and it says what the hand scores, or null when it has
// no yaku (a hand with only dora cannot win).
//
// Done: riichi, double riichi, ippatsu, tsumo, tanyao, pinfu, iipeikou, ryanpeikou, yakuhai, haitei,
// houtei, rinshan, chankan, chiitoitsu, sanshoku doujun and doukou, ittsu, chanta, junchan, toitoi,
// sanankou, sankantsu, honroutou, shousangen, honitsu, chinitsu; the yakuman thirteen orphans, four
// concealed triplets, big three dragons, little and big four winds, all honors, all terminals, all
// green, nine gates, four kans, and the heavenly and earthly hands; dora, ura dora and red fives.
// Not done: renhou, nagashi mangan, double yakuman for thirteen-sided waits and pure nine gates.
import { canStartSequence, decompose, doraAfter, isDragon, isHonor, isSevenPairs, isSimple, isTerminal, isTerminalOrHonor, isThirteenOrphans, isWind, KINDS, rankOf, suitOf, type Counts, type Group } from "./riichicore.js";

export interface CalledMeld {
  type: "chi" | "pon" | "daiminkan" | "kakan" | "ankan";
  /** The lowest kind of a chi, the kind of a pon or a kan. */
  kind: number;
}

export interface WinContext {
  /** The concealed tiles, with the winning tile in them. Called melds are not. */
  concealed: Counts;
  melds: CalledMeld[];
  winKind: number;
  tsumo: boolean;
  /** 0 East, 1 South, 2 West, 3 North. */
  seatWind: number;
  roundWind: number;
  riichi: boolean;
  doubleRiichi: boolean;
  ippatsu: boolean;
  /** Won on the last tile of the wall, or on the last discard. */
  haitei: boolean;
  houtei: boolean;
  rinshan: boolean;
  chankan: boolean;
  /** The dealer won on the first draw, or a non-dealer on theirs with no calls. */
  tenhou: boolean;
  chiihou: boolean;
  /** The kinds the dora indicators point at (and under them, for riichi). */
  doraKinds: number[];
  uraKinds: number[];
  /** Red fives in the hand. */
  reds: number;
  /** An open hand may win on tanyao. */
  kuitan: boolean;
  /** Thirteen han or more counts as a yakuman. */
  kazoe: boolean;
}

export interface Scored {
  yaku: { name: string; han: number }[];
  yakuman: { name: string; times: number }[];
  /** Han from yaku alone. */
  yakuHan: number;
  dora: number;
  ura: number;
  red: number;
  /** All of it: yaku and dora. */
  han: number;
  fu: number;
  /** The basic points payments are worked out from. */
  basic: number;
  /** "Mangan", "Haneman", "Yakuman", … or null for an ordinary hand. */
  limit: string | null;
}

const ceil100 = (n: number) => Math.ceil(n / 100) * 100;

const WIND_KIND = (w: number) => 27 + w;

interface SetInfo {
  type: "seq" | "trip" | "kan";
  kind: number;
  /** A called set (not concealed). */
  open: boolean;
  /** Counts as concealed for four-concealed-triplets: a triplet made in the hand, not by calling or by ron. */
  hidden: boolean;
}

const tilesOf = (s: SetInfo): number[] => (s.type === "seq" ? [s.kind, s.kind + 1, s.kind + 2] : [s.kind]);

/** One reading of the hand: sets, a pair, and which one the winning tile completed. */
interface Reading {
  sets: SetInfo[];
  pair: number;
  /** "ryanmen", "kanchan", "penchan", "shanpon" or "tanki". */
  wait: string;
}

function readings(ctx: WinContext): Reading[] {
  const fixed: SetInfo[] = ctx.melds.map((m) => ({ type: m.type === "chi" ? "seq" : m.type === "pon" ? "trip" : "kan", kind: m.kind, open: m.type !== "ankan", hidden: m.type === "ankan" }));
  const out: Reading[] = [];
  for (const groups of decompose(ctx.concealed, 4 - ctx.melds.length)) {
    const pair = groups.find((g) => g.type === "pair")!;
    const rest = groups.filter((g) => g !== pair);
    // The winning tile completed any group that has it; each is a different reading.
    const tried = new Set<string>();
    const consider = (g: Group | null, wait: string) => {
      const key = `${g ? g.type + g.kind : "pair"}/${wait}`;
      if (tried.has(key)) return;
      tried.add(key);
      const sets: SetInfo[] = [
        ...fixed,
        ...rest.map((x): SetInfo => ({ type: x.type as "seq" | "trip", kind: x.kind, open: false, hidden: x.type === "trip" && !(g === x && !ctx.tsumo) })),
      ];
      out.push({ sets, pair: pair.kind, wait });
    };
    if (pair.kind === ctx.winKind) consider(null, "tanki");
    for (const g of rest) {
      if (g.type === "trip" && g.kind === ctx.winKind) consider(g, "shanpon");
      if (g.type === "seq" && ctx.winKind >= g.kind && ctx.winKind <= g.kind + 2) {
        const at = ctx.winKind - g.kind;
        consider(g, at === 1 ? "kanchan" : (at === 0 && rankOf(g.kind) === 6) || (at === 2 && rankOf(g.kind) === 0) ? "penchan" : "ryanmen");
      }
    }
  }
  return out;
}

function fuOf(ctx: WinContext, r: Reading, pinfu: boolean, closed: boolean): number {
  if (pinfu) return ctx.tsumo ? 20 : 30;
  let fu = 20 + (closed && !ctx.tsumo ? 10 : 0) + (ctx.tsumo ? 2 : 0);
  for (const s of r.sets) {
    if (s.type === "seq") continue;
    const base = isTerminalOrHonor(s.kind) ? 4 : 2;
    // A triplet finished by someone's discard is an open one.
    fu += base * (s.hidden ? 2 : 1) * (s.type === "kan" ? 4 : 1);
  }
  if (isDragon(r.pair)) fu += 2;
  if (r.pair === WIND_KIND(ctx.seatWind)) fu += 2;
  if (r.pair === WIND_KIND(ctx.roundWind)) fu += 2;
  if (r.wait === "kanchan" || r.wait === "penchan" || r.wait === "tanki") fu += 2;
  if (!closed && fu === 20) return 30;
  return Math.ceil(fu / 10) * 10;
}

/** What these tiles make beyond the winning shape: flushes, all-green and so on. `kinds` is every tile's kind, kan tiles counted once. */
function wholeHandYakuman(ctx: WinContext, allKinds: number[], sets: SetInfo[], closed: boolean): { name: string; times: number }[] {
  const out: { name: string; times: number }[] = [];
  const set = new Set(allKinds);
  if ([...set].every(isHonor)) out.push({ name: "All honors", times: 1 });
  if ([...set].every(isTerminal)) out.push({ name: "All terminals", times: 1 });
  const GREEN = new Set([10, 11, 12, 14, 16, 32]);
  if ([...set].every((k) => GREEN.has(k))) out.push({ name: "All green", times: 1 });
  if (closed) {
    // Nine gates: one suit, 1112345678999 and one more.
    const suits = new Set(allKinds.map(suitOf));
    if (suits.size === 1 && !suits.has(3) && ctx.melds.length === 0) {
      const s = [...suits][0]!;
      const need = [3, 1, 1, 1, 1, 1, 1, 1, 3];
      if (need.every((n, i) => ctx.concealed[s * 9 + i]! >= n)) out.push({ name: "Nine gates", times: 1 });
    }
  }
  void sets;
  return out;
}

interface Option {
  yaku: { name: string; han: number }[];
  yakuman: { name: string; times: number }[];
  fu: number;
}

function evaluate(ctx: WinContext, r: Reading): Option {
  const closed = ctx.melds.every((m) => m.type === "ankan");
  const yaku: { name: string; han: number }[] = [];
  const yakuman: { name: string; times: number }[] = [];
  const add = (name: string, closedHan: number, openHan = closedHan) => {
    const han = closed ? closedHan : openHan;
    if (han > 0) yaku.push({ name, han });
  };
  const { sets } = r;
  const trips = sets.filter((s) => s.type !== "seq");
  const seqs = sets.filter((s) => s.type === "seq");
  const allTiles = [...sets.flatMap(tilesOf), r.pair];
  const kinds = new Set(allTiles);

  // Yakuman first; they replace everything else.
  const hidden = sets.filter((s) => s.type !== "seq" && s.hidden).length;
  if (hidden === 4) yakuman.push({ name: "Four concealed triplets", times: r.wait === "tanki" ? 2 : 1 });
  const dragons = trips.filter((s) => isDragon(s.kind)).length;
  if (dragons === 3) yakuman.push({ name: "Big three dragons", times: 1 });
  const windTrips = trips.filter((s) => isWind(s.kind)).length;
  if (windTrips === 4) yakuman.push({ name: "Big four winds", times: 2 });
  else if (windTrips === 3 && isWind(r.pair)) yakuman.push({ name: "Little four winds", times: 1 });
  if (sets.filter((s) => s.type === "kan").length === 4) yakuman.push({ name: "Four kans", times: 1 });
  yakuman.push(...wholeHandYakuman(ctx, allTiles, sets, closed));
  if (ctx.tenhou) yakuman.push({ name: "Heavenly hand", times: 1 });
  if (ctx.chiihou) yakuman.push({ name: "Earthly hand", times: 1 });
  if (yakuman.length) return { yaku: [], yakuman, fu: 0 };

  if (ctx.riichi && !ctx.doubleRiichi) add("Riichi", 1, 0);
  if (ctx.doubleRiichi) add("Double riichi", 2, 0);
  if (ctx.riichi && ctx.ippatsu) add("Ippatsu", 1, 0);
  if (ctx.tsumo) add("Fully concealed hand", 1, 0);
  if (ctx.haitei) add("Last tile from the wall", 1);
  if (ctx.houtei) add("Last discard", 1);
  if (ctx.rinshan) add("After a kan", 1);
  if (ctx.chankan) add("Robbing a kan", 1);
  if ([...kinds].every(isSimple) && (closed || ctx.kuitan)) add("All simples", 1);

  const isPinfu = closed && trips.length === 0 && r.wait === "ryanmen" && !isDragon(r.pair) && r.pair !== WIND_KIND(ctx.seatWind) && r.pair !== WIND_KIND(ctx.roundWind);
  if (isPinfu) add("Pinfu", 1, 0);

  // Identical sequences.
  const seqKinds = seqs.map((s) => s.kind);
  const dup = new Map<number, number>();
  for (const k of seqKinds) dup.set(k, (dup.get(k) ?? 0) + 1);
  const pairsOfSeq = [...dup.values()].reduce((n, c) => n + Math.floor(c / 2), 0);
  if (closed && pairsOfSeq >= 2) add("Two sets of identical sequences", 3, 0);
  else if (closed && pairsOfSeq === 1) add("Identical sequences", 1, 0);

  // Honor triplets.
  for (const s of trips) {
    if (isDragon(s.kind)) add(`Dragon triplet`, 1);
    if (s.kind === WIND_KIND(ctx.seatWind)) add("Seat wind", 1);
    if (s.kind === WIND_KIND(ctx.roundWind)) add("Round wind", 1);
  }

  // Runs and matching sets.
  for (let rk = 0; rk <= 6; rk++) if ([0, 1, 2].every((s) => seqKinds.includes(s * 9 + rk))) add("Same sequence in three suits", 2, 1);
  for (let s = 0; s < 3; s++) if ([0, 3, 6].every((o) => seqKinds.includes(s * 9 + o))) add("Straight", 2, 1);
  for (let rk = 0; rk <= 8; rk++) if ([0, 1, 2].every((s) => trips.some((t) => t.kind === s * 9 + rk))) add("Same triplet in three suits", 2);

  // Terminals and honors in every set.
  const touchesEnd = (s: SetInfo) => (s.type === "seq" ? rankOf(s.kind) === 0 || rankOf(s.kind) === 6 : isTerminalOrHonor(s.kind));
  const everySet = sets.every(touchesEnd) && isTerminalOrHonor(r.pair);
  const anyHonor = [...kinds].some(isHonor);
  if (trips.length === 4 || (seqs.length === 0 && everySet)) {
    // All triplets (or all terminals and honors with no run).
  }
  if (everySet && seqs.length > 0) add(anyHonor ? "Terminal or honor in every set" : "Terminal in every set", anyHonor ? 2 : 3, anyHonor ? 1 : 2);
  if (everySet && seqs.length === 0 && [...kinds].every(isTerminalOrHonor)) add("All terminals and honors", 2);
  if (trips.length === 4) add("All triplets", 2);
  if (hidden === 3) add("Three concealed triplets", 2);
  if (sets.filter((s) => s.type === "kan").length === 3) add("Three kans", 2);
  if (dragons === 2 && isDragon(r.pair)) add("Little three dragons", 2);

  // One suit.
  const suits = new Set([...kinds].filter((k) => !isHonor(k)).map(suitOf));
  if (suits.size === 1) add(anyHonor ? "Half flush" : "Full flush", anyHonor ? 3 : 6, anyHonor ? 2 : 5);

  const han = yaku.reduce((n, y) => n + y.han, 0);
  return { yaku, yakuman: [], fu: han ? fuOf(ctx, r, isPinfu, closed) : 0 };
}

/** The winning shapes that aren't four sets and a pair. */
function special(ctx: WinContext): Option | null {
  if (ctx.melds.length) return null;
  if (isThirteenOrphans(ctx.concealed)) {
    const times = ctx.concealed[ctx.winKind] === 2 ? 2 : 1;
    return { yaku: [], yakuman: [{ name: times === 2 ? "Thirteen orphans, thirteen-sided wait" : "Thirteen orphans", times }, ...(ctx.tenhou ? [{ name: "Heavenly hand", times: 1 }] : []), ...(ctx.chiihou ? [{ name: "Earthly hand", times: 1 }] : [])], fu: 0 };
  }
  if (!isSevenPairs(ctx.concealed)) return null;
  const kinds = ctx.concealed.flatMap((n, k) => (n ? [k] : []));
  const yaku: { name: string; han: number }[] = [{ name: "Seven pairs", han: 2 }];
  if (ctx.riichi && !ctx.doubleRiichi) yaku.push({ name: "Riichi", han: 1 });
  if (ctx.doubleRiichi) yaku.push({ name: "Double riichi", han: 2 });
  if (ctx.riichi && ctx.ippatsu) yaku.push({ name: "Ippatsu", han: 1 });
  if (ctx.tsumo) yaku.push({ name: "Fully concealed hand", han: 1 });
  if (ctx.haitei) yaku.push({ name: "Last tile from the wall", han: 1 });
  if (ctx.houtei) yaku.push({ name: "Last discard", han: 1 });
  if (kinds.every(isSimple)) yaku.push({ name: "All simples", han: 1 });
  if (kinds.every(isTerminalOrHonor)) yaku.push({ name: "All terminals and honors", han: 2 });
  const suits = new Set(kinds.filter((k) => !isHonor(k)).map(suitOf));
  const honors = kinds.some(isHonor);
  if (suits.size === 1) yaku.push(honors ? { name: "Half flush", han: 3 } : { name: "Full flush", han: 6 });
  const yakuman: { name: string; times: number }[] = [];
  if (kinds.every(isHonor)) yakuman.push({ name: "All honors", times: 1 });
  if (ctx.tenhou) yakuman.push({ name: "Heavenly hand", times: 1 });
  if (ctx.chiihou) yakuman.push({ name: "Earthly hand", times: 1 });
  return { yaku: yakuman.length ? [] : yaku, yakuman, fu: 25 };
}

/** The basic points for han and fu, and the name of the limit if it reaches one. */
export function basicPoints(han: number, fu: number, kazoe: boolean): { basic: number; limit: string | null } {
  if (han >= 13 && kazoe) return { basic: 8000, limit: "Yakuman" };
  if (han >= 11) return { basic: 6000, limit: "Sanbaiman" };
  if (han >= 8) return { basic: 4000, limit: "Baiman" };
  if (han >= 6) return { basic: 3000, limit: "Haneman" };
  const raw = fu * 2 ** (han + 2);
  if (han >= 5 || raw >= 2000) return { basic: 2000, limit: "Mangan" };
  return { basic: raw, limit: null };
}

/** How many dora, ura dora and red fives a hand holds. */
export function countDora(ctx: WinContext): { dora: number; ura: number; red: number } {
  const have = ctx.concealed.map((n) => n);
  for (const m of ctx.melds) {
    if (m.type === "chi") for (let i = 0; i < 3; i++) have[m.kind + i]!++;
    else have[m.kind]! += m.type === "pon" ? 3 : 4;
  }
  const dora = ctx.doraKinds.reduce((n, k) => n + have[k]!, 0);
  const ura = ctx.riichi ? ctx.uraKinds.reduce((n, k) => n + have[k]!, 0) : 0;
  return { dora, ura, red: ctx.reds };
}

/** What the hand scores, or null when it has no yaku. */
export function scoreHand(ctx: WinContext): Scored | null {
  const options: Option[] = [];
  const sp = special(ctx);
  if (sp) options.push(sp);
  for (const r of readings(ctx)) options.push(evaluate(ctx, r));
  const { dora, ura, red } = countDora(ctx);
  let best: Scored | null = null;
  for (const o of options) {
    const times = o.yakuman.reduce((n, y) => n + y.times, 0);
    const yakuHan = o.yaku.reduce((n, y) => n + y.han, 0);
    if (!times && !yakuHan) continue;
    const han = yakuHan + dora + ura + red;
    const fu = o.fu;
    const bp = times ? { basic: 8000 * times, limit: times > 1 ? `${times === 2 ? "Double" : "Triple"} yakuman` : "Yakuman" } : basicPoints(han, fu, ctx.kazoe);
    const scored: Scored = { yaku: o.yaku, yakuman: o.yakuman, yakuHan: times ? 0 : yakuHan, dora: times ? 0 : dora, ura: times ? 0 : ura, red: times ? 0 : red, han: times ? 13 * times : han, fu, basic: bp.basic, limit: bp.limit };
    if (!best || scored.basic > best.basic || (scored.basic === best.basic && (scored.han > best.han || (scored.han === best.han && scored.fu > best.fu)))) best = scored;
  }
  return best;
}

export interface Payment {
  /** On a discard: what the discarder pays. */
  ron: number | null;
  /** On a self-draw: what the dealer pays, and what each other seat pays. (A dealer's win has both the same.) */
  tsumo: { dealer: number; other: number } | null;
  /** Total the winner collects (before riichi sticks). */
  total: number;
}

/** What each side pays, with the extra 300 a honba counter is worth. */
export function payment(basic: number, dealer: boolean, tsumo: boolean, honba: number): Payment {
  if (!tsumo) {
    const ron = ceil100(basic * (dealer ? 6 : 4)) + 300 * honba;
    return { ron, tsumo: null, total: ron };
  }
  if (dealer) {
    const each = ceil100(basic * 2) + 100 * honba;
    return { ron: null, tsumo: { dealer: each, other: each }, total: each * 3 };
  }
  const d = ceil100(basic * 2) + 100 * honba;
  const o = ceil100(basic) + 100 * honba;
  return { ron: null, tsumo: { dealer: d, other: o }, total: d + 2 * o };
}

/** The dora kinds for these indicator kinds. */
export const doraKindsOf = (indicators: number[]) => indicators.map(doraAfter);
export { canStartSequence, KINDS };
