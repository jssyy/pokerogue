/**
 * Stops the account service if one is already running, then starts a fresh one.
 *
 * Starting twice is the easiest mistake to make with a service left running between sessions, and
 * the failure it produces says nothing useful. This makes "just restart it" a single command.
 *
 * See `scripts/lib/port-utils.mjs` for why the kill is narrow: only something answering as this
 * service is stopped.
 */

import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { stopAccountService } from "../../scripts/lib/port-utils.mjs";

const SERVER_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const PORT = Number(process.env.PORT ?? 8001);

const state = await stopAccountService(PORT);
if (state === "stopped") {
  console.log("已停止上次留下的账号服务");
} else if (state === "foreign") {
  console.error(`端口 ${PORT} 被别的程序占着，而且它不是本服务，没有动它。`);
  console.error(`先确认那是什么：  netstat -ano | findstr :${PORT}`);
  process.exit(1);
}

spawn(process.execPath, ["--experimental-sqlite", join(SERVER_ROOT, "src", "index.ts")], {
  stdio: "inherit",
}).on("exit", code => process.exit(code ?? 0));
