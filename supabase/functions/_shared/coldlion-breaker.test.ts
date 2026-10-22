import { ColdLionBreaker } from "./coldlion-breaker.ts";

describe("ColdLionBreaker", () => {
  it("is closed until a failure, then fails fast for the cooldown", () => {
    let t = 1_000;
    const b = new ColdLionBreaker(60_000, () => t);
    expect(() => b.assertClosed("x")).not.toThrow();
    b.recordFailure("Signal timed out.");
    expect(b.isOpen()).toBe(true);
    expect(() => b.assertClosed("05/CW001")).toThrow(/breaker open.*Signal timed out/);
    t += 59_999;
    expect(b.isOpen()).toBe(true);
    t += 1;
    expect(() => b.assertClosed("x")).not.toThrow();
  });

  it("closes on success", () => {
    const b = new ColdLionBreaker(60_000, () => 0);
    b.recordFailure("boom");
    b.recordSuccess();
    expect(b.isOpen()).toBe(false);
  });
});
