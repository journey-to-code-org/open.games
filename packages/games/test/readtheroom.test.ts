// Read the Room's own rules. The shared word tests already play it out with computer players;
// these check what each kind of question is worth, that nobody's answer is seen before all are
// in, and that the night ends with whoever read the room best.
import { describe, expect, it } from "vitest";
import { GameError, formAllows, readTheRoom, type RoomMove, type RoomState } from "../src/index.js";

const game = readTheRoom;
const fresh = (seats = 4, seed = 3, rules: unknown = null) => game.newGame(game.normalize(rules), seats, seed);
/** Go on to the first question of a kind, with everyone answering anything to get there. */
function upTo(s: RoomState, kind: string): RoomState {
  for (let guard = 0; guard < 400; guard++) {
    if (s.phase === "answer" && s.asked[s.hand - 1]!.kind === kind && s.answers.every((a) => !a)) return s;
    for (let seat = 0; seat < s.seats; seat++) {
      const move = game.bot(s, seat, { skill: 1, sloppy: 0 }, () => 0.4);
      if (move) { s = game.apply(s, seat, move); break; }
    }
  }
  throw new Error(`No ${kind} question came up`);
}
const all = (s: RoomState, moves: RoomMove[]) => moves.reduce((state, move, seat) => game.apply(state, seat, move), s);

describe("Read the Room", () => {
  it("asks the kinds of question in turn, and never the same one twice in a night", () => {
    const s = fresh(4, 9);
    expect(s.asked.map((q) => q.kind)).toEqual(["scale", "vote", "either", "three", "caption", "scale", "vote", "either", "three", "caption"]);
    expect(new Set(s.asked.map((q) => `${q.kind}:${q.at}:${q.pairs}`)).size).toBe(10);
    expect(fresh(4, 9, { id: "taps" }).asked.every((q) => q.kind === "scale" || q.kind === "vote" || q.kind === "either")).toBe(true);
    expect(game.newGame(game.normalize(null), 4, 9)).toEqual(s);
    expect(game.newGame(game.normalize(null), 4, 10).asked).not.toEqual(s.asked);
  });

  it("keeps an answer to its own seat until all are in", () => {
    let s = upTo(fresh(), "scale");
    s = game.apply(s, 0, { type: "answer", value: 91 });
    for (let seat = 0; seat < 4; seat++) {
      const v = game.view(s, seat);
      expect(JSON.stringify(v)).not.toContain("91");
      expect(v.room).toBeNull();
      expect(v.question).toBeTruthy();
      expect(!!v.form).toBe(seat !== 0);
      expect(v.players[0]!.done).toBe(true);
    }
    expect(() => game.apply(s, 0, { type: "answer", value: 10 })).toThrow(GameError);
  });

  it("scores a scale by how near the room's average each was", () => {
    let s = upTo(fresh(), "scale");
    s = all(s, [10, 50, 60, 80].map((value) => ({ type: "answer", value })));
    const room = game.view(s, 0).room!;
    expect(room.headline).toBe("The room said 50.");
    expect(room.gained).toEqual([0, 100, 60, 0]);
    expect(s.points).toEqual([0, 100, 60, 0]);
    expect(s.phase).toBe("room");
  });

  it("scores a vote for going with the most votes, and nobody votes for themselves", () => {
    let s = upTo(fresh(), "vote");
    expect(() => game.apply(s, 2, { type: "answer", pick: 2 })).toThrow(GameError);
    const before = [...s.points];
    s = all(s, [1, 2, 1, 1].map((pick) => ({ type: "answer", pick })));
    expect(s.gained).toEqual([100, 0, 100, 100]);
    expect(s.points).toEqual(before.map((p, i) => p + s.gained[i]!));
    expect(game.view(s, 0).room!.bars.find((bar) => bar.best)!.seats).toEqual([0, 2, 3]);
  });

  it("scores each either-or for the side most took, and a tie for everyone", () => {
    let s = upTo(fresh(), "either");
    s = all(s, [[true, true, false], [true, false, false], [true, true, true], [false, false, false]].map((flags) => ({ type: "answer", flags })));
    // First: three to one. Second: two each. Third: three to one the other way.
    expect(s.gained).toEqual([120, 120, 80, 80]);
    expect(game.view(s, 1).room!.bars).toHaveLength(6);
  });

  it("scores three answers for each one somebody else gave, however it was typed", () => {
    let s = upTo(fresh(), "three");
    s = all(s, [["Keys", "tape", "pens"], ["key", " TAPE ", "string"], ["glue", "coins", "Tape!"], ["a", "b", "c"]].map((tags) => ({ type: "answer", tags })));
    expect(s.gained).toEqual([60, 60, 30, 0]);
    expect(game.view(s, 0).room!.bars[0]).toMatchObject({ label: "tape", value: 3, best: true });
    expect(() => game.apply(upTo(fresh(), "three"), 0, { type: "answer", tags: ["one", "one", "two"] })).toThrow(/different/);
  });

  it("has a caption written, then starred by the others without their names, and scores ten a star", () => {
    let s = upTo(fresh(), "caption");
    s = all(s, ["Alpha line", "Bravo line", "Charlie line", "Delta line"].map((text) => ({ type: "answer", text })));
    expect(s.phase).toBe("rate");
    const form = game.view(s, 1).form!;
    expect(form.kind).toBe("rate");
    expect(form.items).toEqual(["Alpha line", "Charlie line", "Delta line"]);
    expect(formAllows({ form }, { type: "rate", stars: [5, 1, 3] })).toBe(true);
    expect(formAllows({ form }, { type: "rate", stars: [5, 1] })).toBe(false);
    expect(() => game.apply(s, 1, { type: "rate", stars: [6, 1, 1] })).toThrow(GameError);
    // Each gives the first of the others five and the rest one.
    s = all(s, [0, 1, 2, 3].map(() => ({ type: "rate", stars: [5, 1, 1] })));
    // Seat 0 is first for seats 1, 2 and 3; seat 1 is first for seat 0.
    expect(s.gained).toEqual([150, 70, 30, 30]);
    expect(game.view(s, 2).room!.headline).toBe("The room's favourite was {0}'s.");
  });

  it("moves on when everyone is ready, and ends with whoever has the most", () => {
    let s = fresh(3, 5, { id: "quick" });
    while (!game.summary(s).over) {
      for (let seat = 0; seat < 3; seat++) {
        const move = game.bot(s, seat, {}, () => 0.3);
        if (move) s = game.apply(s, seat, move);
      }
    }
    const sum = game.summary(s);
    expect(sum.hand).toBe(5);
    const best = Math.max(...s.points);
    expect(sum.winners).toEqual(s.points.flatMap((p, i) => (p === best ? [i] : [])));
    expect(game.view(s, 0).over!.winners).toEqual(sum.winners);
  });
});
