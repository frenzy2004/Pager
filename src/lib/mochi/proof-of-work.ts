export function countLeadingZeroBits(bytes: Uint8Array) {
  let bits = 0;
  for (const byte of bytes) {
    if (byte === 0) {
      bits += 8;
      continue;
    }
    bits += Math.clz32(byte) - 24;
    break;
  }
  return bits;
}

export async function solveProofOfWork(
  challengeToken: string,
  difficulty: number,
  maxAttempts = 4_194_304,
) {
  if (!Number.isInteger(difficulty) || difficulty < 0 || difficulty > 24) {
    throw new Error("Mochi received an invalid connector challenge.");
  }
  const encoder = new TextEncoder();
  for (let solution = 0; solution < maxAttempts; solution += 1) {
    const digest = new Uint8Array(
      await crypto.subtle.digest(
        "SHA-256",
        encoder.encode(`${challengeToken}:${solution}`),
      ),
    );
    if (countLeadingZeroBits(digest) >= difficulty) {
      return String(solution);
    }
  }
  throw new Error("Mochi could not solve the connector challenge.");
}
