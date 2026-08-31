import { describe, expect, it } from "vitest";
import { compileExpression } from "../lib/video/visuals/expr";

describe("compileExpression", () => {
  it("evaluates polynomial expressions", () => {
    const f = compileExpression("x^2 + 2*x + 1");
    expect(f(3)).toBeCloseTo(16, 6); // (x+1)^2
    expect(f(-1)).toBeCloseTo(0, 6);
  });

  it("respects operator precedence and parentheses", () => {
    expect(compileExpression("2 + 3 * 4")(0)).toBe(14);
    expect(compileExpression("(2 + 3) * 4")(0)).toBe(20);
    expect(compileExpression("-x^2")(2)).toBe(-4);
  });

  it("supports sin/cos/sqrt/abs and the constants pi/e", () => {
    expect(compileExpression("sin(0)")(0)).toBeCloseTo(0, 6);
    expect(compileExpression("cos(0)")(0)).toBeCloseTo(1, 6);
    expect(compileExpression("sqrt(x)")(9)).toBeCloseTo(3, 6);
    expect(compileExpression("abs(x)")(-5)).toBe(5);
    expect(compileExpression("sin(pi)")(0)).toBeCloseTo(0, 5);
  });

  it("throws on malformed expressions rather than silently returning NaN", () => {
    expect(() => compileExpression("x + ")(1)).toThrow();
    expect(() => compileExpression("2 x")(1)).toThrow();
    expect(() => compileExpression("unknownFn(x)")(1)).toThrow();
  });
});
