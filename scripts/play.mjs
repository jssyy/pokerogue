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

const children = [];

function start(command, args, label, tint) {
  // No shell: `shell: true` concatenates arguments instead of escaping them, and Node warns about
  // it. Running Vite's own entry point through this Node keeps it to one process either way.
  const child = spawn(command, args, { cwd: ROOT, stdio: ["ignore", "pipe", "pipe"] });
  pipe(child.stdout, label, tint);
  pipe(child.stderr, label, tint);
  child.on("exit", code => {
    console.log(`${tint}[${label}]${colour.off} 退出了（代码 ${code}）`);
    shutdown(code ?? 0);
  });
  children.push(child);
  return child;
}

let closing = false;
/** Takes the other half down too: half a stack running is the state that causes confusing failures. */
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
