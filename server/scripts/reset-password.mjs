/**
 * Sets an account's password directly in the database.
 *
 * The way back in when a password is forgotten. A child's password a parent can already reset from
 * the management page, but the parent's own had no path at all: registration closes after the first
 * account, and there is nobody above a parent to ask. Without this, one forgotten password would
 * mean a family locked out of their own progress for good.
 *
 * This is not a hole. It needs a shell on the machine and read-write access to the database file,
 * and anyone holding those can already read and rewrite every row in it. What it adds is a way to do
 * the one safe thing without hand-editing SQL.
 *
 * Usage:
 *   node --experimental-sqlite server/scripts/reset-password.mjs                     list accounts
 *   node --experimental-sqlite server/scripts/reset-password.mjs <用户名> <新密码>   set a password
 */

import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { hashPassword } from "../src/auth.ts";

const SERVER_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DB_FILE = join(process.env.DATA_DIR ?? join(SERVER_ROOT, "data"), "family.sqlite");

/** Same floor the management page enforces, so the two ways in cannot disagree. */
const MIN_PASSWORD = 4;

const [username, password] = process.argv.slice(2);

let db;
try {
  db = new DatabaseSync(DB_FILE);
} catch (err) {
  console.error(`打不开数据库：${DB_FILE}`);
  console.error(String(err));
  process.exit(1);
}

const accounts = db.prepare("SELECT id, username, display_name, role, disabled FROM accounts ORDER BY id").all();

if (accounts.length === 0) {
  console.error("这个数据库里还没有任何账号。是不是 DATA_DIR 指错了目录？");
  process.exit(1);
}

if (!username) {
  console.log(`数据库：${DB_FILE}\n`);
  console.log("账号一览：");
  for (const account of accounts) {
    const who = account.role === "parent" ? "家长" : "孩子";
    const state = account.disabled ? "（已停用）" : "";
    console.log(`  ${account.username}　${who}　${account.display_name || ""}${state}`);
  }
  console.log("\n改密码：");
  console.log("  node --experimental-sqlite server/scripts/reset-password.mjs <用户名> <新密码>");
  process.exit(0);
}

const target = accounts.find(account => account.username === username);
if (!target) {
  console.error(`没有叫「${username}」的账号。不带参数运行可以看到全部账号。`);
  process.exit(1);
}

if (!password || password.length < MIN_PASSWORD) {
  console.error(`密码至少 ${MIN_PASSWORD} 位。`);
  process.exit(1);
}

db.exec("PRAGMA foreign_keys = ON");
db.prepare("UPDATE accounts SET password_hash = ? WHERE id = ?").run(hashPassword(password), target.id);
// Same as the management page's reset: a changed password signs out every device that had the old
// one, so a device left logged in somewhere does not outlive the change.
const ended = db.prepare("DELETE FROM sessions WHERE account_id = ?").run(target.id);
db.close();

console.log(`「${target.username}」的密码已更新。`);
if (ended.changes > 0) {
  console.log(`已登出 ${ended.changes} 个仍在登录的设备，需要用新密码重新登录。`);
}
