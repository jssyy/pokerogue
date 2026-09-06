import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import type { Db } from "./db.ts";
import { now } from "./db.ts";

/**
 * Passwords are hashed with scrypt from `node:crypto`.
 *
 * scrypt rather than bcrypt or argon2 because it is built into Node and needs no compilation: this
 * service is meant to run on whatever machine is already switched on at home, and a native module
 * that fails to build on a Raspberry Pi is a service that does not start.
 */
const SCRYPT_KEYLEN = 64;
const SALT_BYTES = 16;

/** A stored hash is `scrypt$<salt hex>$<key hex>`, so the format is self-describing on inspection. */
export function hashPassword(password: string): string {
  const salt = randomBytes(SALT_BYTES);
  const key = scryptSync(password, salt, SCRYPT_KEYLEN);
  return `scrypt$${salt.toString("hex")}$${key.toString("hex")}`;
}

/** Whether `password` produced `stored`. Compared in constant time. */
export function verifyPassword(password: string, stored: string): boolean {
  const [scheme, saltHex, keyHex] = stored.split("$");
  if (scheme !== "scrypt" || !saltHex || !keyHex) {
    return false;
  }
  const expected = Buffer.from(keyHex, "hex");
  const actual = scryptSync(password, Buffer.from(saltHex, "hex"), expected.length);
  return timingSafeEqual(expected, actual);
}

export interface Account {
  id: number;
  username: string;
  role: "parent" | "child";
  parent_id: number | null;
  display_name: string;
  disabled: number;
  last_slot: number;
}

/**
 * Issues a session token.
 *
 * The token is the credential the game client sends on every later request, so it is 32 random
 * bytes rather than anything derived: nothing about the account should be recoverable from it.
 */
export function createSession(db: Db, accountId: number): string {
  const token = randomBytes(32).toString("hex");
  db.prepare("INSERT INTO sessions (token, account_id, created_at, last_seen) VALUES (?, ?, ?, ?)").run(
    token,
    accountId,
    now(),
    now(),
  );
  return token;
}

/**
 * The account behind a token, or `null` if there is none.
 *
 * Sessions do not expire. On a family network the cost of an expired session is a child who cannot
 * play until a parent helps, which is worse than the risk being defended against.
 */
export function accountForToken(db: Db, token: string | undefined): Account | null {
  if (!token) {
    return null;
  }
  const row = db
    .prepare(
      `SELECT a.id, a.username, a.role, a.parent_id, a.display_name, a.disabled, a.last_slot
       FROM sessions s JOIN accounts a ON a.id = s.account_id
       WHERE s.token = ?`,
    )
    .get(token) as Account | undefined;
  if (!row || row.disabled) {
    return null;
  }
  db.prepare("UPDATE sessions SET last_seen = ? WHERE token = ?").run(now(), token);
  return row;
}

/** Ends one session. Other devices signed in as the same account keep theirs. */
export function endSession(db: Db, token: string | undefined): void {
  if (token) {
    db.prepare("DELETE FROM sessions WHERE token = ?").run(token);
  }
}

/** Ends every session for an account, used when a parent changes a child's password. */
export function endAllSessions(db: Db, accountId: number): void {
  db.prepare("DELETE FROM sessions WHERE account_id = ?").run(accountId);
}
