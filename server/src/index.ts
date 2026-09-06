import { createServer } from "node:http";
import { copyFileSync, mkdirSync, readdirSync, readFileSync, unlinkSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { openDb } from "./db.ts";
import { accountRoutes } from "./routes/account.ts";
import { savedataRoutes } from "./routes/savedata.ts";
import { familyRoutes } from "./routes/family.ts";
import { homeworkRoutes } from "./routes/homework.ts";
import type { Ctx } from "./http.ts";
import { applyCors, readBody, Router, text } from "./http.ts";

const PORT = Number(process.env.PORT ?? 8001);
/**
 * Where the database lives.
 *
 * Resolved against this file rather than the working directory, so `npm start` from `server/` and
 * `pnpm start:server` from the repository root both reach the same data. Keying it to the cwd meant
 * the second one quietly created an empty second database.
 */
const SERVER_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DATA_DIR = process.env.DATA_DIR ?? join(SERVER_ROOT, "data");
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
  .post("/family/child/rename", family.rename)
  .post("/family/child/delete", family.remove)
  .get("/homework/get", homework.get)
  .post("/homework/update", homework.update)
  .post("/homework/credit", homework.credit)
  .get("/homework/credits", homework.credits)
  // Whether anyone has registered yet, so the management page knows to offer the one-time setup.
  .get("/family/bootstrap", ctx => {
    const count = db.prepare("SELECT COUNT(*) AS n FROM accounts").get() as { n: number };
    ctx.res.writeHead(200, { "Content-Type": "application/json" });
    ctx.res.end(JSON.stringify({ empty: count.n === 0 }));
  })
  // The management page. Creating an account is a typing job, and a web page does that far better
  // than a pixel-art dialog in the game would.
  .get("/", ctx => {
    try {
      const page = readFileSync(join(SERVER_ROOT, "public", "admin.html"));
      ctx.res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      ctx.res.end(page);
    } catch {
      text(ctx, "管理页缺失", 500);
    }
  })
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

/**
 * Says what happened, rather than letting an unhandled `error` event print a stack trace.
 *
 * A port already in use is the most likely way to fail to start - a service left running from
 * earlier - and a twenty line dump about `listenInCluster` buries the one sentence that helps.
 */
server.on("error", (err: NodeJS.ErrnoException) => {
  if (err.code === "EADDRINUSE") {
    console.error(`端口 ${PORT} 已经被占用了 —— 多半是已经有一个账号服务在跑，不用再起第二个。`);
    console.error(`想确认是谁占着：  npx kill-port ${PORT}   或者  netstat -ano | findstr :${PORT}`);
    process.exit(1);
  }
  console.error("服务启动失败", err);
  process.exit(1);
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
