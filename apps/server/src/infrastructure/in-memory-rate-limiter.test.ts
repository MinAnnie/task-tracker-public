import { describe, expect, it } from "vitest";
import { createInMemoryRateLimiter } from "./in-memory-rate-limiter.ts";

describe("createInMemoryRateLimiter", () => {
  const setup = () => {
    let clock = 1_000_000;
    const limiter = createInMemoryRateLimiter({ limit: 3, windowMs: 60_000, now: () => clock });
    return { limiter, advance: (ms: number) => (clock += ms) };
  };

  it("allows up to the limit per window and key", () => {
    const { limiter } = setup();
    expect([1, 2, 3].map(() => limiter.hit("a").allowed)).toEqual([true, true, true]);
    expect(limiter.hit("a")).toEqual({ allowed: false, retryAfterSeconds: 60 });
    expect(limiter.hit("b").allowed).toBe(true);
  });

  it("reports the seconds left in the window, rounded up", () => {
    const { limiter, advance } = setup();
    for (let i = 0; i < 3; i += 1) limiter.hit("a");
    advance(59_001);
    expect(limiter.hit("a")).toEqual({ allowed: false, retryAfterSeconds: 1 });
  });

  it("starts a new window once the previous one ends", () => {
    const { limiter, advance } = setup();
    for (let i = 0; i < 4; i += 1) limiter.hit("a");
    advance(60_000);
    expect(limiter.hit("a").allowed).toBe(true);
  });

  it("forgets keys whose window ended, so memory stays bounded", () => {
    const { limiter, advance } = setup();
    for (let i = 0; i < 100; i += 1) limiter.hit(`k${i}`);
    advance(60_000);
    limiter.hit("fresh");
    expect(limiter.size()).toBe(1);
  });
});
