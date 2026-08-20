import { createServer } from "node:http";
import { copyFileSync, mkdirSync, readdirSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { openDb } from "./db.ts";
import { accountRoutes } from "./routes/account.ts";
import { savedataRoutes } from "./routes/savedata.ts";
import { familyRoutes } from "./routes/family.ts";
import { homeworkRoutes } from "./routes/homework.ts";
import type { Ctx } from "./http.ts";
import { applyCors, readBody, Router, text } from "./http.ts";

const PORT = Number(process.env.PORT ?? 8001);
const DATA_DIR = process.env.DATA_DIR ?? "./data";
const DB_FILE = join(DATA_DIR, "family.sqlite");
const BACKUP_DIR = join(DATA_DIR, "backups");

/** A save is a few hundred kilobytes; a megabyte is generous and still bounds a bad request. */
const MAX_BODY = 4 * 1024 * 1024;

/** How often the database file is copied aside, and how many copies are kept. */
const BACKUP_INTERVAL_MS = 6 * 60 * 60 * 1000;
const BACKUP_KEEP = 28;

const db = openDb(DB_FILE);

const account = accountRoutes(db);
const savedata = savedataRoutes(db);
const family = familyRoutes(db);
const homework = homeworkRoutes(db);

const router = new Router()
  // The game client's own API. Matching it exactly is what lets accounts and cloud saves work
  // without touching a line of the client.
  .post("/account/login", account.login)
  .post("/account/register", account.register)
  .get("/account/info", account.info)
  .get("/account/logout", account.logout)
  .post("/account/changepw", account.changePassword)
  .get("/savedata/system/get", savedata.systemGet)
  .get("/savedata/system/verify", savedata.systemVerify)
  .post("/savedata/system/update", savedata.systemUpdate)
  .get("/savedata/session/get", savedata.sessionGet)
  .post("/savedata/session/update", savedata.sessionUpdate)
  .get("/savedata/session/delete", savedata.sessionDelete)
  .post("/savedata/session/clear", savedata.sessionClear)
  .post("/savedata/session/newclear", savedata.sessionNewClear)
  .post("/savedata/updateall", savedata.updateAll)
  // Endpoints of our own: the parent/child relationship, and the homework plan.
  .get("/family/children", family.list)
  .post("/family/child/create", family.create)
  .post("/family/child/password", family.setPassword)
  .post("/family/child/disabled", family.setDisabled)
  .get("/homework/get", homework.get)
  .post("/homework/update", homework.update)
  .post("/homework/credit", homework.credit)
  .get("/homework/credits", homework.credits)
  // Answered so a browser, a router check or a person can confirm the service is up.
  .get("/health", ctx => text(ctx, "ok"));

/**
 * Copies the database aside on a schedule.
 *
 * The requirement this service exists for is that a child's progress is never lost, and a database
 * that is only ever one file is one accident away from gone. SQLite in WAL mode can be copied while
 * in use, so this needs no downtime and no tooling.
 */
function backup(): void {
  try {
    mkdirSync(BACKUP_DIR, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    copyFileSync(DB_FILE, join(BACKUP_DIR, `family-${stamp}.sqlite`));

    const old = readdirSync(BACKUP_DIR)
      .filter(name => name.startsWith("family-"))
      .sort()
      .slice(0, -BACKUP_KEEP);
    for (const name of old) {
      unlinkSync(join(BACKUP_DIR, name));
    }
  } catch (err) {
    // A failed backup must never stop the service; it just means this copy did not happen.
    console.error("backup failed", err);
  }
}

const server = createServer(async (req, res) => {
  applyCors(req, res);

  // The browser asks permission before any request carrying an Authorization header.
  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  const url = new URL(req.url ?? "/", "http://localhost");
  const handler = router.find(req.method ?? "GET", url.pathname);
  if (!handler) {
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("no such endpoint");
    return;
  }

  let raw = "";
  try {
    raw = req.method === "GET" ? "" : await readBody(req, MAX_BODY);
  } catch {
    res.writeHead(413, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("请求体过大");
    return;
  }

  const ctx: Ctx = {
    req,
    res,
    path: url.pathname,
    query: url.searchParams,
    token: req.headers.authorization,
    raw,
  };

  try {
    await handler(ctx);
  } catch (err) {
    console.error(`${req.method} ${url.pathname} failed`, err);
    if (!res.headersSent) {
      res.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("服务器出错了");
    }
  }
});

server.listen(PORT, () => {
  const accounts = db.prepare("SELECT COUNT(*) AS n FROM accounts").get() as { n: number };
  console.log(`作业勇者账号服务 → http://localhost:${PORT}`);
  console.log(`数据库：${DB_FILE}　备份：每 ${BACKUP_INTERVAL_MS / 3600000} 小时一次，保留 ${BACKUP_KEEP} 份`);
  if (accounts.n === 0) {
    console.log("还没有任何账号：在游戏里注册的第一个账号会成为家长账号。");
  }
  backup();
  setInterval(backup, BACKUP_INTERVAL_MS);
});
