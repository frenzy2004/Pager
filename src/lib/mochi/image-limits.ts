// Eight encoded captures plus metadata must remain below Vercel's 4.5 MB
// request-body ceiling.
export const MAX_ANALYSIS_BODY_BYTES = 4_000_000;
export const MAX_SCREENSHOT_DATA_URL_LENGTH = 400_000;
