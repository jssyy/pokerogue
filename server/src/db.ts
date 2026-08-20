import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

/**
 * The whole store: one SQLite file, opened once.
 *
 * SQLite rather than a server database because the thing this has to guarantee is that a child's
 * progress is never lost, and a single file is the easiest thing in the world to back up - copy it
 * and you are done. There is no operational story to get wrong.
 */
export type Db = DatabaseSync;

/**
 * How many past versions of each save to keep.
 *
 * The client is authoritative and overwrites its save wholesale, so a bad write - a corrupted upload,
 * a device that was behind - would otherwise be final. Keeping a short history turns "the save is
 * gone" into "roll back one version", which is the actual requirement here.
 */
export const SAVE_HISTORY_DEPTH = 20;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS accounts (
  id            INTEGER PRIMARY KEY,
  username      TEXT    NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT    NOT NULL,
  -- A parent manages children; a child only plays. There are no other kinds.
  role          TEXT    NOT NULL CHECK (role IN ('parent', 'child')),
  -- Set for children, null for the parent. This is the pairing.
  parent_id     INTEGER REFERENCES accounts(id) ON DELETE CASCADE,
  display_name  TEXT    NOT NULL,
  disabled      INTEGER NOT NULL DEFAULT 0,
  -- Which save slot the client was last in, so "continue" works on a fresh device.
  last_slot     INTEGER NOT NULL DEFAULT -1,
  created_at    TEXT    NOT NULL,
  last_seen     TEXT
);

CREATE TABLE IF NOT EXISTS sessions (
  token      TEXT    PRIMARY KEY,
  account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  created_at TEXT    NOT NULL,
  last_seen  TEXT    NOT NULL
);
CREATE INDEX IF NOT EXISTS sessions_account ON sessions(account_id);

CREATE TABLE IF NOT EXISTS saves (
  account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  -- 'system' is the account-wide progress (dex, candy, eggs); 'session' is one run in one slot.
  kind       TEXT    NOT NULL CHECK (kind IN ('system', 'session')),
  slot       INTEGER NOT NULL,
  data       TEXT    NOT NULL,
  updated_at TEXT    NOT NULL,
  PRIMARY KEY (account_id, kind, slot)
);

CREATE TABLE IF NOT EXISTS save_history (
  id         INTEGER PRIMARY KEY,
  account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  kind       TEXT    NOT NULL,
  slot       INTEGER NOT NULL,
  data       TEXT    NOT NULL,
  saved_at   TEXT    NOT NULL
);
CREATE INDEX IF NOT EXISTS save_history_key ON save_history(account_id, kind, slot, id DESC);

CREATE TABLE IF NOT EXISTS homework (
  account_id INTEGER PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
  data       TEXT    NOT NULL,
  updated_at TEXT    NOT NULL
);
`;

/**
 * Opens the store, creating it and its schema if this is the first run.
 *
 * @param file - Path to the SQLite file; its directory is created if missing
 */
export function openDb(file: string): Db {
  mkdirSync(dirname(file), { recursive: true });
  const db = new DatabaseSync(file);

  // Write-ahead logging so a reader never blocks the write that is saving a run, and so an abrupt
  // power cut on a home machine leaves a recoverable file rather than a truncated one.
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA foreign_keys = ON");
  // FULL rather than NORMAL: losing the last few seconds of progress is exactly the failure this
  // service exists to prevent, and the write rate here is a handful per minute.
  db.exec("PRAGMA synchronous = FULL");
  db.exec(SCHEMA);
  return db;
}

/** Current time in a form that sorts correctly as text. */
export function now(): string {
  return new Date().toISOString();
}
