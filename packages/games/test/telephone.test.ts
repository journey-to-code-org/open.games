import { describe, expect, it } from "vitest";
import { GameError, passThePicture as game, type PassState, type WordStroke } from "../src/index.js";

const line: WordStroke = { points: [100, 100, 400, 400], color: 0, size: 1 };
const start = (seats = 3, rules: unknown = { id: "round" }) => game.newGame(game.normalize(rules), seats, 7);
const all = (s: PassState, move: (seat: number) => Record<string, unknown>[]) => {
  for (let seat = 0; seat < s.seats; seat++) for (const m of move(seat)) s = game.apply(s, seat, m as never);
  return s;
};

describe("Pass the Picture", () => {
  it("passes each chain round the table, words and drawings in turn", () => {
    let s = start(3);
    s = all(s, (seat) => [{ type: "write", text: ["  a cat   on a skateboard ", "pie", "a horse"][seat]! }]);
    // Step 2: each seat draws the words of the seat before it.
    expect(game.view(s, 1).question).toBe("Draw this: “a cat on a skateboard”");
    expect(game.view(s, 0).question).toBe("Draw this: “a horse”");
    // Nobody sees anyone else's drawing while it's being made.
    s = game.apply(s, 1, { type: "stroke", stroke: line });
    expect(game.view(s, 1).canvas!.strokes).toHaveLength(1);
    expect(game.view(s, 2).canvas!.strokes).toHaveLength(0);
    expect(() => game.apply(s, 0, { type: "done" })).toThrow("Draw something first.");
    s = all(s, (seat) => (seat === 1 ? [{ type: "done" }] : [{ type: "stroke", stroke: line }, { type: "done" }]));
    // Step 3: say what the drawing is, shown the drawing and not the words.
    const v = game.view(s, 2);
    expect(v.question).toBe("What's this a picture of?");
    expect(v.canvas).toEqual({ strokes: [line], draw: null });
    expect(JSON.stringify(v)).not.toContain("skateboard");
    s = all(s, () => [{ type: "guess", text: "a dog" }]);
    expect(s.phase).toBe("reveal");
    expect(s.chains[0]!.map((step) => step.by)).toEqual([0, 1, 2]);
  });

  it("waits for everyone, and says who it's waiting for", () => {
    let s = start(3);
    s = game.apply(s, 0, { type: "write", text: "pie" });
    expect(game.view(s, 0).question).toBe("Waiting for {1}, {2}");
    expect(game.view(s, 0).form).toBeNull();
    expect(() => game.apply(s, 0, { type: "write", text: "more pie" })).toThrow("wait for the others");
    expect(s.hand).toBe(1);
  });

  it("gives an idea when asked, from the rules' list", () => {
    let s = start(3, { id: "thanksgiving" });
    s = game.apply(s, 0, { type: "idea" });
    expect(s.chains[0]![0]!.text).toMatch(/\w/);
    expect(() => game.apply(start(3), 0, { type: "write", text: "x".repeat(61) })).toThrow(GameError);
    expect(() => game.apply(start(3), 0, { type: "write", text: "   " })).toThrow(GameError);
  });

  it("lets whoever started a chain turn it over, a step at a time, then the next chain", () => {
    let s = start(3);
    s = all(s, () => [{ type: "write", text: "pie" }]);
    s = all(s, () => [{ type: "stroke", stroke: line }, { type: "done" }]);
    s = all(s, () => [{ type: "guess", text: "a hat" }]);
    expect(game.view(s, 1).chain).toMatchObject({ owner: 0, index: 1, of: 3, length: 3, steps: [{ by: 0, text: "pie" }] });
    expect(game.view(s, 1).choices).toBeNull();
    expect(() => game.apply(s, 1, { type: "show", at: 1 })).toThrow("{0} is showing this one.");
    s = game.apply(s, 0, { type: "show", at: 1 });
    // A second press of the same button does nothing twice.
    expect(() => game.apply(s, 0, { type: "show", at: 1 })).toThrow("shown already");
    s = game.apply(s, 0, { type: "show", at: 2 });
    expect(game.view(s, 2).chain!.steps.map((x) => x.text ?? "drawing")).toEqual(["pie", "drawing", "a hat"]);
    expect(game.view(s, 0).choices!.options[0]!.label).toBe("Next chain");
    s = game.apply(s, 0, { type: "show", at: 3 });
    expect(s.reveal).toEqual({ chain: 1, shown: 1 });
    for (const seat of [1, 2]) for (let at = 1; at <= 3; at++) s = game.apply(s, seat, { type: "show", at });
    expect(s.phase).toBe("finished");
    expect(game.summary(s).over).toBe(true);
  });

  it("stops at five steps in quick chains", () => {
    expect(start(8, { id: "quick" }).steps).toBe(5);
    expect(start(4, { id: "quick" }).steps).toBe(4);
    expect(start(8, { id: "round" }).steps).toBe(8);
  });
});
