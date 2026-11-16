import { describe, expect, it } from "vitest";
import { countsOf, decompose, doraAfter, isComplete, shanten, waits } from "../src/riichicore.js";
import { payment, scoreHand, type WinContext } from "../src/riichiscore.js";

/** "234m567p..." with m characters, p dots, s bamboo and z honors (1 to 4 winds, 5 white, 6 green, 7 red). */
const k = (s: string): number[] => {
  const out: number[] = [];
  let nums: number[] = [];
  for (const ch of s) {
    if (/\d/.test(ch)) nums.push(Number(ch));
    else {
      for (const n of nums) out.push(ch === "m" ? 18 + n - 1 : ch === "p" ? n - 1 : ch === "s" ? 9 + n - 1 : n <= 4 ? 27 + n - 1 : n === 5 ? 33 : n === 6 ? 32 : 31);
      nums = [];
    }
  }
  return out;
};
const ctx = (over: Partial<WinContext> & { hand: string; win: string }): WinContext => ({
  concealed: countsOf(k(over.hand)),
  melds: [],
  winKind: k(over.win)[0]!,
  tsumo: false,
  seatWind: 1,
  roundWind: 0,
  riichi: false,
  doubleRiichi: false,
  ippatsu: false,
  haitei: false,
  houtei: false,
  rinshan: false,
  chankan: false,
  tenhou: false,
  chiihou: false,
  doraKinds: [],
  uraKinds: [],
  reds: 0,
  kuitan: true,
  kazoe: true,
  ...over,
});
const names = (s: ReturnType<typeof scoreHand>) => s!.yaku.map((y) => y.name).concat(s!.yakuman.map((y) => y.name));

describe("complete hands and waits", () => {
  it("knows complete hands, seven pairs and thirteen orphans", () => {
    expect(isComplete(countsOf(k("123m456p789s11z222z")), 0)).toBe(true);
    expect(isComplete(countsOf(k("1133m2255p7799s11z")), 0)).toBe(true);
    expect(isComplete(countsOf(k("19m19p19s12345677z")), 0)).toBe(true);
    expect(isComplete(countsOf(k("123m456p789s11z223z")), 0)).toBe(false);
    expect(isComplete(countsOf(k("123m456p11z")), 2)).toBe(true); // two melds called already
  });
  it("lists every split of a hand", () => {
    expect(decompose(countsOf(k("111222333m77p")), 3)).toHaveLength(2); // three triplets or three runs
  });
  it("works out shanten and waits", () => {
    expect(shanten(countsOf(k("123m456p789s1122z")))).toBe(0);
    expect(shanten(countsOf(k("123m456p789s11z222z")))).toBe(-1);
    expect(shanten(countsOf(k("1357m1357p1357s11z")))).toBe(3); // a pair and six loose pairs of tiles: three short
    expect(shanten(countsOf(k("114477m1155p22s9s")))).toBe(0); // seven pairs, one short
    expect(shanten(countsOf(k("19m19p19s1234567z")))).toBe(0); // thirteen orphans, waiting on a pair
    expect(waits(countsOf(k("123m456p789s1122z")))).toEqual([27, 28]);
    expect(waits(countsOf(k("1112345678999m")))).toHaveLength(9);
    expect(waits(countsOf(k("23m456p789s11122z")))).toEqual([18, 21]);
  });
  it("points the dora indicator at the next tile", () => {
    expect([doraAfter(8), doraAfter(26), doraAfter(30), doraAfter(33), doraAfter(32), doraAfter(31)]).toEqual([0, 18, 27, 32, 31, 33]);
  });
});

describe("scoring", () => {
  const pinfuTanyao = "234m567m345p67p22s";
  it("riichi, pinfu and all simples on a discard is 3 han 30 fu: 3900", () => {
    const s = scoreHand(ctx({ hand: pinfuTanyao + "8p", win: "8p", riichi: true }))!;
    expect(names(s)).toEqual(["Riichi", "All simples", "Pinfu"]);
    expect([s.han, s.fu, s.basic]).toEqual([3, 30, 960]);
    expect(payment(s.basic, false, false, 0).ron).toBe(3900);
  });
  it("adding a self-draw is 4 han 20 fu: 1300 and 2600", () => {
    const s = scoreHand(ctx({ hand: pinfuTanyao + "8p", win: "8p", riichi: true, tsumo: true }))!;
    expect([s.han, s.fu]).toEqual([4, 20]);
    expect(payment(s.basic, false, true, 0).tsumo).toEqual({ dealer: 2600, other: 1300 });
  });
  it("is 25 fu for seven pairs: riichi seven pairs on a discard is 3200", () => {
    const s = scoreHand(ctx({ hand: "1133m2255p7799s11z", win: "1z", riichi: true }))!;
    expect(names(s)).toContain("Seven pairs");
    expect([s.han, s.fu]).toEqual([3, 25]);
    expect(payment(s.basic, false, false, 0).ron).toBe(3200);
  });
  it("scores a triplet of dragons as a yaku, and an open hand without a yaku as none", () => {
    const withDragon = scoreHand(ctx({ hand: "234m567p22s", win: "2s", melds: [{ type: "pon", kind: 31 }, { type: "chi", kind: 9 + 2 }] }));
    expect(names(withDragon)).toContain("Dragon triplet");
    expect(scoreHand(ctx({ hand: "234m567p22s", win: "2s", melds: [{ type: "chi", kind: 0 }, { type: "chi", kind: 11 }] }))).toBeNull();
  });
  it("counts an open all-simples hand only when kuitan is on", () => {
    const base = { hand: "234m567p22s", win: "2s", melds: [{ type: "chi" as const, kind: 2 }, { type: "pon" as const, kind: 12 }] };
    expect(scoreHand(ctx({ ...base, kuitan: true }))).not.toBeNull();
    expect(scoreHand(ctx({ ...base, kuitan: false }))).toBeNull();
  });
  it("gives a closed hand fu for concealed triplets and a wait", () => {
    // 111m concealed terminals (8) + 444p and 555s concealed simples (4 each) + 678s and a 99m pair,
    // a kanchan win on 7s by self-draw: 20 + 2 (self-draw) + 8 + 4 + 4 + 2 (the wait) = 40.
    const s = scoreHand(ctx({ hand: "111m444p678s555s99m", win: "7s", tsumo: true, riichi: true }))!;
    expect(s.fu).toBe(40);
  });
  it("counts dora, ura dora and red fives, but not as a yaku on their own", () => {
    // A plain ron with no riichi has no yaku, however much dora it holds.
    expect(scoreHand(ctx({ hand: "123m456p789s234p55m", win: "3m", doraKinds: [19, 19, 19] }))).toBeNull();
    // The pair of 2 bamboo is two dora, there is no 2 of dots for the ura, and the red five is one more.
    const s = scoreHand(ctx({ hand: pinfuTanyao + "8p", win: "8p", riichi: true, doraKinds: [10], uraKinds: [1], reds: 1 }))!;
    expect([s.dora, s.ura, s.red, s.han, s.limit]).toEqual([2, 0, 1, 6, "Haneman"]);
  });
  it("scores yakuman", () => {
    const koku = scoreHand(ctx({ hand: "19m19p19s12345677z", win: "1z" }))!;
    expect(names(koku)).toEqual(["Thirteen orphans"]);
    expect(names(scoreHand(ctx({ hand: "19m19p19s12345677z", win: "7z" })))).toEqual(["Thirteen orphans, thirteen-sided wait"]);
    expect(payment(koku.basic, false, false, 0).ron).toBe(32000);
    const dai = scoreHand(ctx({ hand: "55m", win: "5m", melds: [{ type: "pon", kind: 31 }, { type: "pon", kind: 32 }, { type: "pon", kind: 33 }, { type: "chi", kind: 0 }] }))!;
    expect(names(dai)).toContain("Big three dragons");
    const four = scoreHand(ctx({ hand: "111m444p777s999p55z", win: "5z", tsumo: true }))!;
    expect(four.yakuman).toEqual([{ name: "Four concealed triplets", times: 2 }]); // a single wait on the pair is a double
    expect(payment(four.basic, false, true, 0).tsumo).toEqual({ dealer: 32000, other: 16000 });
  });
  it("reaches the limits", () => {
    const man = scoreHand(ctx({ hand: pinfuTanyao + "8p", win: "8p", riichi: true, doraKinds: [4] }))!; // 5p x1: 4 han 30 fu = 1920 -> not yet
    expect(man.limit).toBeNull();
    const m = scoreHand(ctx({ hand: pinfuTanyao + "8p", win: "8p", riichi: true, reds: 2 }))!;
    expect([m.han, m.limit]).toEqual([5, "Mangan"]);
    expect(payment(m.basic, false, false, 0).ron).toBe(8000);
    expect(payment(m.basic, true, false, 0).ron).toBe(12000);
    expect(payment(2000, true, true, 0).tsumo).toEqual({ dealer: 4000, other: 4000 });
  });
  it("adds 300 a honba", () => {
    expect(payment(960, false, false, 2).ron).toBe(3900 + 600);
    expect(payment(1280, false, true, 1).tsumo).toEqual({ dealer: 2700, other: 1400 });
  });
});
