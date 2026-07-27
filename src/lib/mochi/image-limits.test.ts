import { describe, expect, it } from "vitest";

import {
  MAX_ANALYSIS_BODY_BYTES,
  MAX_SCREENSHOT_DATA_URL_LENGTH,
} from "@/lib/mochi/image-limits";

describe("analysis image limits", () => {
  it("keeps eight normalized captures safely below Vercel's request ceiling", () => {
    expect(MAX_SCREENSHOT_DATA_URL_LENGTH * 8).toBeLessThan(
      MAX_ANALYSIS_BODY_BYTES,
    );
    expect(MAX_ANALYSIS_BODY_BYTES).toBeLessThan(4_500_000);
  });
});
