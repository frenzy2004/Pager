import { describe, expect, it } from "vitest";

import { fitImageWithin, selectCaptureQuality } from "./image-policy";

describe("capture image policy", () => {
  it("keeps small images and scales large images to a 1600px edge", () => {
    expect(fitImageWithin(1200, 800)).toEqual({
      width: 1200,
      height: 800,
    });
    expect(fitImageWithin(3000, 2000)).toEqual({
      width: 1600,
      height: 1067,
    });
    expect(fitImageWithin(1200, 2400)).toEqual({
      width: 800,
      height: 1600,
    });
  });

  it("steps JPEG quality down for bounded capture storage", () => {
    expect(selectCaptureQuality(400_000)).toBe(0.82);
    expect(selectCaptureQuality(700_000)).toBe(0.68);
    expect(selectCaptureQuality(840_000)).toBe(0.54);
    expect(selectCaptureQuality(900_000)).toBe(0.42);
  });
});
