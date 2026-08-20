/**
 * Stops whatever account service is already running, then starts a fresh one.
 *
 * Starting twice is the easiest mistake to make with a service you leave running between sessions,
 * and the failure it produces - an unhandled `EADDRINUSE` stack trace - says nothing useful. This
 * makes "just restart it" a single command.
 *
 * The kill is deliberately narrow. It only happens after the thing on the port answers `/health`
 * with `ok`, which is this service's own reply; anything else holding the port is left alone and
 * reported, because silently killing an unrelated program to free a port is never worth it.
 */

import { spawn } from "node:child_process";
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const SERVER_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const PORT = Number(process.env.PORT ?? 8001);

/** Whether the thing listening on the port is this service, rather than something else entirely. */
async function isOurService() {
  try {
    const response = await fetch(`http://127.0.0.1:${PORT}/health`, { signal: AbortSignal.timeout(2000) });
    return response.ok && (await response.text()).trim() === "ok";
  } catch {
    return false;
  }
}

/** Process ids listening on the port. Platform-specific because there is no portable way to ask. */
function listenersOn(port) {
  try {
    if (process.platform === "win32") {
      const out = execFileSync("netstat", ["-ano", "-p", "TCP"], { encoding: "utf-8" });
      return [
        ...new Set(
          out
            .split("\n")
            .filter(line => line.includes(`:${port} `) && line.includes("LISTENING"))
            .map(line => Number(line.trim().split(/\s+/).at(-1)))
            .filter(pid => Number.isInteger(pid) && pid > 0),
        ),
      ];
    }
    const out = execFileSync("lsof", ["-ti", `tcp:${port}`, "-sTCP:LISTEN"], { encoding: "utf-8" });
    return out.split("\n").map(Number).filter(Boolean);
  } catch {
    // No listener, or the tool is missing. Either way there is nothing to stop.
    return [];
  }
}

const running = await isOurService();
if (running) {
  const pids = listenersOn(PORT);
  for (const pid of pids) {
    try {
      process.kill(pid, "SIGKILL");
      console.log(`已停止旧的账号服务（进程 ${pid}）`);
    } catch (err) {
      console.error(`停不掉进程 ${pid}：`, err.message);
    }
  }
  // The socket needs a moment to be released before the new listener can claim it.
  await new Promise(resolve => setTimeout(resolve, 500));
} else if (listenersOn(PORT).length > 0) {
  console.error(`端口 ${PORT} 被别的程序占着，而且它不是本服务，没有动它。`);
  console.error(`先确认那是什么：  netstat -ano | findstr :${PORT}`);
  process.exit(1);
}

spawn(process.execPath, ["--experimental-sqlite", join(SERVER_ROOT, "src", "index.ts")], {
  stdio: "inherit",
}).on("exit", code => process.exit(code ?? 0));
