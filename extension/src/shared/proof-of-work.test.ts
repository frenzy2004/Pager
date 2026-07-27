import { describe, expect, it } from "vitest";

import {
  countLeadingZeroBits,
  solveProofOfWork,
} from "./proof-of-work";

describe("connector proof of work", () => {
  it("counts whole and partial zero bytes", () => {
    expect(countLeadingZeroBits(new Uint8Array([0, 0, 0b0001_0000]))).toBe(19);
    expect(countLeadingZeroBits(new Uint8Array([0b1000_0000]))).toBe(0);
  });

  it("finds a verifiable bounded solution", async () => {
    const solution = await solveProofOfWork("signed-challenge", 8, 100_000);
    const digest = new Uint8Array(
      await crypto.subtle.digest(
        "SHA-256",
        new TextEncoder().encode(`signed-challenge:${solution}`),
      ),
    );

    expect(countLeadingZeroBits(digest)).toBeGreaterThanOrEqual(8);
  });
});
