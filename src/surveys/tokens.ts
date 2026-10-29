import { createHash, randomBytes } from "node:crypto";

/** 32 random bytes, base64url: 43 URL-safe characters. */
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

/**
 * Only the hash is stored. A leaked database backup then contains no working
 * survey links, the same reason passwords are hashed.
 */
export function issueToken(): { token: string; hash: string } {
  const token = randomBytes(32).toString("base64url");
  return { token, hash: hashToken(token) };
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function isWellFormedToken(token: string): boolean {
  return TOKEN_PATTERN.test(token);
}
