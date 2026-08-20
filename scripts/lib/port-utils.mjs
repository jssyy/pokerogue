/**
 * Finding out what is holding a port, and whether it is ours.
 *
 * Shared by the launcher and the account service's own restart, because both need the same two
 * answers and getting them wrong in either place means killing something that does not belong to us.
 */

import { execFileSync } from "node:child_process";

/**
 * Process ids listening on a port.
 *
 * Platform-specific because there is no portable way to ask. An empty list also covers "the tool
 * that answers this is missing", which is fine: both callers treat it as nothing to stop.
 */
export function listenersOn(port) {
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
    return [];
  }
}

/**
 * Whether the thing on the port is the account service.
 *
 * The check is its `/health` reply, which is what makes it safe to stop: anything else holding the
 * port is left alone, because freeing a port is never worth killing a program that is not ours.
 */
export async function isAccountService(port) {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(2000) });
    return response.ok && (await response.text()).trim() === "ok";
  } catch {
    return false;
  }
}

/**
 * Whether the thing on the port is a Vite dev server.
 *
 * `/@vite/client` is served by Vite and by essentially nothing else, which is enough of a signature
 * to be sure before stopping it.
 */
export async function isViteDevServer(port) {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/@vite/client`, { signal: AbortSignal.timeout(2000) });
    return response.ok && (response.headers.get("content-type") ?? "").includes("javascript");
  } catch {
    return false;
  }
}

/**
 * Stops a leftover Vite dev server so the game lands on its usual port.
 *
 * Same rule as the account service: identified first, and anything unrecognised is reported rather
 * than killed. Without this Vite quietly walks to the next free port, and the address in the terminal
 * stops matching the one everybody has bookmarked.
 *
 * @returns `"stopped"`, `"free"`, or `"foreign"`
 */
export async function stopViteDevServer(port) {
  if (await isViteDevServer(port)) {
    for (const pid of listenersOn(port)) {
      try {
        process.kill(pid, "SIGKILL");
      } catch {
        // Already gone between the listing and the kill.
      }
    }
    await new Promise(resolve => setTimeout(resolve, 500));
    return "stopped";
  }
  return listenersOn(port).length > 0 ? "foreign" : "free";
}

/**
 * Stops the account service on a port, if that is what is there.
 *
 * @returns `"stopped"`, `"free"` when nothing was listening, or `"foreign"` when something else has
 * it and was deliberately left running
 */
export async function stopAccountService(port) {
  if (await isAccountService(port)) {
    for (const pid of listenersOn(port)) {
      try {
        process.kill(pid, "SIGKILL");
      } catch {
        // Already gone between the listing and the kill; nothing to do.
      }
    }
    // The socket needs a moment to be released before a new listener can claim it.
    await new Promise(resolve => setTimeout(resolve, 500));
    return "stopped";
  }
  return listenersOn(port).length > 0 ? "foreign" : "free";
}
