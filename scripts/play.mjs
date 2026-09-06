/**
 * Starts everything needed to play: the account service and the game, from one command.
 *
 * Two commands in two terminals is a step that gets half-done - the service left over from
 * yesterday, or only the game started and every sign-in failing - and neither failure says what is
 * wrong. This starts both, stops a leftover service first, and prints one address for each so there
 * is no guessing which port is which.
 */

import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { stopAccountService, stopViteDevServer } from "./lib/port-utils.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const ACCOUNT_PORT = Number(process.env.PORT ?? 8001);
const GAME_PORT = 8000;

const colour = { service: "\x1b[36m", game: "\x1b[35m", dim: "\x1b[2m", off: "\x1b[0m" };

/** Tags every line so two interleaved logs stay tellable apart. */
function pipe(stream, label, tint) {
  let rest = "";
  stream.on("data", chunk => {
    const lines = (rest + chunk.toString()).split("\n");
    rest = lines.pop() ?? "";
    for (const line of lines) {
      if (line.trim()) {
        console.log(`${tint}[${label}]${colour.off} ${line}`);
      }
    }
  });
}

/** Clears one leftover, or refuses to start if the port belongs to something unrecognised. */
async function claim(port, stop, what) {
  const state = await stop(port);
  if (state === "stopped") {
    console.log(`${colour.dim}停掉了上次留下的${what}${colour.off}`);
  } else if (state === "foreign") {
    console.error(`端口 ${port} 被别的程序占着，而且它不是${what}，没有动它。`);
    console.error(`先确认那是什么：  netstat -ano | findstr :${port}`);
    process.exit(1);
  }
}

// Both ports are claimed before anything starts. Vite otherwise walks to the next free one, and the
// address in the terminal stops being the address anybody expects.
await claim(ACCOUNT_PORT, stopAccountService, "账号服务");
await claim(GAME_PORT, stopViteDevServer, "游戏服务");

const children = new Set();

/** How long to wait before bringing a half back, and how often that may happen before giving up. */
const RESTART_DELAY_MS = 1000;
const RESTART_WINDOW_MS = 60_000;
const MAX_RESTARTS = 5;

/**
 * Starts one half and keeps it running.
 *
 * A half that dies used to take the other with it. That is tidy for a build script and wrong for
 * something a child is playing on: the account service going down mid-run is what produced
 * "服务器连接失败" and lost the run. It comes back on its own instead. Something that dies over and
 * over is a real fault rather than a hiccup, so after {@link MAX_RESTARTS} in a minute it stops and
 * says so rather than looping silently.
 */
function start(command, args, label, tint) {
  const restarts = [];

  const launch = () => {
    // No shell: `shell: true` concatenates arguments instead of escaping them, and Node warns about
    // it. Running Vite's own entry point through this Node keeps it to one process either way.
    const child = spawn(command, args, { cwd: ROOT, stdio: ["ignore", "pipe", "pipe"] });
    pipe(child.stdout, label, tint);
    pipe(child.stderr, label, tint);
    children.add(child);

    child.on("exit", code => {
      children.delete(child);
      if (closing) {
        return;
      }

      const now = Date.now();
      while (restarts.length > 0 && now - restarts[0] > RESTART_WINDOW_MS) {
        restarts.shift();
      }
      if (restarts.length >= MAX_RESTARTS) {
        console.error(`${tint}[${label}]${colour.off} 反复退出（代码 ${code}），不再重启。上面的日志是原因。`);
        shutdown(code ?? 1);
        return;
      }

      restarts.push(now);
      console.log(`${tint}[${label}]${colour.off} 退出了（代码 ${code}），正在重启…`);
      setTimeout(launch, RESTART_DELAY_MS);
    });
  };

  launch();
}

let closing = false;
/** Stops everything, on Ctrl+C or when one half turns out to be genuinely broken. */
function shutdown(code) {
  if (closing) {
    return;
  }
  closing = true;
  for (const child of children) {
    child.kill();
  }
  process.exit(code);
}

process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));

start(process.execPath, ["--experimental-sqlite", join(ROOT, "server", "src", "index.ts")], "账号", colour.service);
start(
  process.execPath,
  [join(ROOT, "node_modules", "vite", "bin", "vite.js"), "--mode", "family"],
  "游戏",
  colour.game,
);

console.log("");
console.log(`  ${colour.game}游戏${colour.off}      http://localhost:${GAME_PORT}        孩子在这里玩`);
console.log(`  ${colour.service}账号管理${colour.off}  http://localhost:${ACCOUNT_PORT}        家长在这里建号、改密码`);
console.log(`  ${colour.dim}按 Ctrl+C 一起停掉${colour.off}`);
console.log("");
