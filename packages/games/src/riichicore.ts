// The hand maths under Riichi, apart from any table: tiles as 34 kinds, a hand as a count of each,
// whether it's complete, how far from complete (shanten), and which tiles it is waiting for. Nothing
// here knows about scoring or turns.
//
// Kinds are numbered 0 to 33 in the order of `PLAIN_KINDS`: dots 1 to 9 (0 to 8), bamboo (9 to 17),
// characters (18 to 26), the winds East, South, West, North (27 to 30), then the dragons red (31),
// green (32) and white (33). A physical tile is an id from 0 to 135, four to a kind, and
// `kindOfId(id)` says which kind it is.
import { PLAIN_KINDS, tileGlyph, tileName, type MahjongTile } from "./mahjongtiles.js";

export const KINDS = 34;
export type Counts = number[];

export const kindOfId = (id: number) => Math.floor(id / 4);
export const tileOfId = (id: number): MahjongTile => ({ ...PLAIN_KINDS[kindOfId(id)]!, copy: (id % 4) + 1 });
export const emptyCounts = (): Counts => new Array<number>(KINDS).fill(0);
export const countsOf = (kinds: number[]): Counts => {
  const c = emptyCounts();
  for (const k of kinds) c[k]!++;
  return c;
};

export const isHonor = (k: number) => k >= 27;
export const isDragon = (k: number) => k >= 31;
export const isWind = (k: number) => k >= 27 && k <= 30;
export const isTerminal = (k: number) => k < 27 && (k % 9 === 0 || k % 9 === 8);
export const isTerminalOrHonor = (k: number) => isHonor(k) || isTerminal(k);
export const isSimple = (k: number) => !isTerminalOrHonor(k);
export const suitOf = (k: number) => (k < 27 ? Math.floor(k / 9) : 3);
/** Position in a suit, 0 to 8. */
export const rankOf = (k: number) => k % 9;
/** A sequence can start here (1 to 7 of a suit). */
export const canStartSequence = (k: number) => k < 27 && rankOf(k) <= 6;
export const kindName = (k: number) => tileName({ ...PLAIN_KINDS[k]!, copy: 1 });
export const kindGlyph = (k: number) => tileGlyph({ ...PLAIN_KINDS[k]!, copy: 1 });
/** The 13 terminals and honors a thirteen orphans hand needs. */
export const ORPHANS = Array.from({ length: KINDS }, (_, k) => k).filter(isTerminalOrHonor);

/** The kind a dora indicator makes the dora: the next number, wind or dragon, wrapping round. */
export function doraAfter(k: number): number {
  if (k < 27) return rankOf(k) === 8 ? k - 8 : k + 1;
  if (k <= 30) return k === 30 ? 27 : k + 1;
  // white, green, red, round again: 33, 32, 31.
  return k === 31 ? 33 : k - 1;
}

// ---- Complete hands ----------------------------------------------------------------------------

/** A group in a complete hand: a sequence (named by its lowest kind), a triplet, or the pair. */
export interface Group {
  type: "seq" | "trip" | "pair";
  kind: number;
}

/**
 * Every way to split these tiles into `melds` sequences and triplets plus a pair. The counts are
 * the concealed tiles only (called melds are not in them).
 */
export function decompose(counts: Counts, melds: number): Group[][] {
  const total = counts.reduce((a, b) => a + b, 0);
  if (total !== melds * 3 + 2) return [];
  const out = new Map<string, Group[]>();
  const c = [...counts];
  const walk = (i: number, left: number, acc: Group[], pair: Group) => {
    while (i < KINDS && c[i] === 0) i++;
    if (i >= KINDS) {
      if (left === 0) {
        const all = [...acc, pair].sort((a, b) => a.kind - b.kind || a.type.localeCompare(b.type));
        out.set(all.map((g) => `${g.type}${g.kind}`).join(","), all);
      }
      return;
    }
    if (left === 0) return;
    if (c[i]! >= 3) {
      c[i]! -= 3;
      walk(i, left - 1, [...acc, { type: "trip", kind: i }], pair);
      c[i]! += 3;
    }
    if (canStartSequence(i) && c[i + 1]! > 0 && c[i + 2]! > 0) {
      c[i]!--;
      c[i + 1]!--;
      c[i + 2]!--;
      walk(i, left - 1, [...acc, { type: "seq", kind: i }], pair);
      c[i]!++;
      c[i + 1]!++;
      c[i + 2]!++;
    }
  };
  for (let k = 0; k < KINDS; k++) {
    if (c[k]! < 2) continue;
    c[k]! -= 2;
    walk(0, melds, [], { type: "pair", kind: k });
    c[k]! += 2;
  }
  return [...out.values()];
}

/** Seven different pairs. */
export const isSevenPairs = (counts: Counts) => counts.reduce((a, b) => a + b, 0) === 14 && counts.every((n) => n === 0 || n === 2) && counts.filter((n) => n === 2).length === 7;
/** One of each terminal and honor, and one of them twice. */
export const isThirteenOrphans = (counts: Counts) => counts.reduce((a, b) => a + b, 0) === 14 && ORPHANS.every((k) => counts[k]! >= 1) && ORPHANS.some((k) => counts[k] === 2) && counts.every((n, k) => isTerminalOrHonor(k) || n === 0);

/** Whether the concealed tiles, with `melds` called melds beside them, make a complete hand. */
export function isComplete(counts: Counts, melds: number): boolean {
  const total = counts.reduce((a, b) => a + b, 0);
  if (total !== 14 - melds * 3) return false;
  if (melds === 0 && (isSevenPairs(counts) || isThirteenOrphans(counts))) return true;
  return decompose(counts, 4 - melds).length > 0;
}

// ---- How close, and what to wait for -----------------------------------------------------------

/** Shanten of the ordinary shape: the number of tiles short of tenpai (-1 is a complete hand). `called` melds are already made. */
function regularShanten(c: Counts, called: number): number {
  let best = 8;
  const run = (pair: number) => {
    let local = 99;
    const rec = (i: number, m: number, t: number) => {
      while (i < KINDS && c[i] === 0) i++;
      if (i >= KINDS) {
        const mm = m + called;
        const tt = Math.min(t, 4 - mm);
        local = Math.min(local, 8 - 2 * mm - tt - pair);
        return;
      }
      if (c[i]! >= 3) {
        c[i]! -= 3;
        rec(i, m + 1, t);
        c[i]! += 3;
      }
      if (canStartSequence(i) && c[i + 1]! > 0 && c[i + 2]! > 0) {
        c[i]!--;
        c[i + 1]!--;
        c[i + 2]!--;
        rec(i, m + 1, t);
        c[i]!++;
        c[i + 1]!++;
        c[i + 2]!++;
      }
      if (c[i]! >= 2) {
        c[i]! -= 2;
        rec(i, m, t + 1);
        c[i]! += 2;
      }
      if (i < 27 && rankOf(i) <= 7 && c[i + 1]! > 0) {
        c[i]!--;
        c[i + 1]!--;
        rec(i, m, t + 1);
        c[i]!++;
        c[i + 1]!++;
      }
      if (i < 27 && rankOf(i) <= 6 && c[i + 2]! > 0) {
        c[i]!--;
        c[i + 2]!--;
        rec(i, m, t + 1);
        c[i]!++;
        c[i + 2]!++;
      }
      c[i]!--;
      rec(i, m, t);
      c[i]!++;
    };
    rec(0, 0, 0);
    return local;
  };
  best = Math.min(best, run(0));
  for (let k = 0; k < KINDS; k++) {
    if (c[k]! < 2) continue;
    c[k]! -= 2;
    best = Math.min(best, run(1));
    c[k]! += 2;
  }
  return best;
}

const sevenPairsShanten = (c: Counts) => {
  const pairs = c.filter((n) => n >= 2).length;
  const kinds = c.filter((n) => n >= 1).length;
  return 6 - pairs + Math.max(0, 7 - kinds);
};
const orphansShanten = (c: Counts) => {
  const kinds = ORPHANS.filter((k) => c[k]! >= 1).length;
  const pair = ORPHANS.some((k) => c[k]! >= 2) ? 1 : 0;
  return 13 - kinds - pair;
};

/** Tiles short of a complete hand: -1 when it is one, 0 at tenpai. Counts any hand size of 13 or 14 tiles less 3 a called meld. */
export function shanten(counts: Counts, called = 0): number {
  const c = [...counts];
  let s = regularShanten(c, called);
  if (called === 0) s = Math.min(s, sevenPairsShanten(c), orphansShanten(c));
  return s;
}

/** The kinds that would complete a hand of 13 tiles (less 3 per called meld). */
export function waits(counts: Counts, called = 0): number[] {
  const out: number[] = [];
  const c = [...counts];
  for (let k = 0; k < KINDS; k++) {
    if (c[k]! >= 4) continue;
    c[k]!++;
    if (isComplete(c, called)) out.push(k);
    c[k]!--;
  }
  return out;
}
