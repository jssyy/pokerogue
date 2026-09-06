/**
 * A small flight recorder, so a problem seen once can still be diagnosed afterwards.
 *
 * The bugs worth catching here are the ones that leave no stack trace: a run that bounces back to
 * the home screen, a menu that stops responding. What identifies those is not the failure itself but
 * the sequence leading up to it - which screen, which button, which phase - so this records that
 * trail continuously and keeps the last {@linkcode LOG_LIMIT} entries.
 *
 * It is written to `localStorage` after every entry, because the failures worth recording are
 * exactly the ones where the page never gets a chance to flush anything on the way out.
 */

const STORAGE_KEY = "homeworkQuest_bugLog";

/** How many entries to keep. Roughly a few minutes of play, and well inside the storage quota. */
const LOG_LIMIT = 300;

/** Kinds of entry, kept short because every one of them is written to storage. */
export type BugLogKind = "error" | "reject" | "mode" | "input" | "phase" | "note";

interface BugLogEntry {
  /** Milliseconds since the log started, which reads better than a wall clock in a trace. */
  t: number;
  kind: BugLogKind;
  text: string;
}

let entries: BugLogEntry[] = [];
let started = Date.now();
let installed = false;

/** Writes the buffer out. A full or unavailable store must never take the game down with it. */
function persist(): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ started, entries }));
  } catch {
    // Storage full or blocked: keep playing, keep the in-memory trail.
  }
}

/**
 * Appends one entry to the trail.
 *
 * @param kind - What sort of event this is
 * @param text - A short description; long ones are clipped so one entry cannot fill the store
 */
export function logBug(kind: BugLogKind, text: string): void {
  entries.push({ t: Date.now() - started, kind, text: text.slice(0, 300) });
  if (entries.length > LOG_LIMIT) {
    entries = entries.slice(-LOG_LIMIT);
  }
  persist();
}

/**
 * Starts recording, and picks up anything the browser reports.
 *
 * Safe to call more than once; only the first call takes effect.
 */
export function installBugLog(): void {
  if (installed) {
    return;
  }
  installed = true;

  // Carry over whatever a previous session left behind: the report is more useful when it spans the
  // reload that a crash usually causes.
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored) as { started?: number; entries?: BugLogEntry[] };
      if (Array.isArray(parsed.entries)) {
        entries = parsed.entries.slice(-LOG_LIMIT);
        started = typeof parsed.started === "number" ? parsed.started : started;
      }
    }
  } catch {
    // A corrupt log is not worth refusing to start over.
  }

  window.addEventListener("error", event => {
    const where = event.filename ? ` @ ${event.filename.split("/").pop()}:${event.lineno}` : "";
    logBug("error", `${event.message}${where}`);
  });
  window.addEventListener("unhandledrejection", event => {
    const reason = event.reason as { stack?: string } | string | undefined;
    logBug("reject", typeof reason === "string" ? reason : (reason?.stack ?? String(reason)));
  });

  logBug("note", `session start · ${navigator.userAgent}`);
}

/** The whole trail as plain text, newest last, ready to be read or handed over. */
export function dumpBugLog(): string {
  const header = [
    "作业勇者 问题日志",
    `导出时间：${new Date().toLocaleString()}`,
    `记录起点：${new Date(started).toLocaleString()}`,
    `条目：${entries.length}`,
    "",
  ].join("\n");
  const body = entries.map(e => `${(e.t / 1000).toFixed(1).padStart(8)}s  ${e.kind.padEnd(6)}  ${e.text}`).join("\n");
  return `${header}${body}\n`;
}

/** How many entries are held, so a menu can say whether there is anything worth exporting. */
export function bugLogSize(): number {
  return entries.length;
}

/** Clears the trail, for when a report has been handed over and the next one should start clean. */
export function clearBugLog(): void {
  entries = [];
  started = Date.now();
  persist();
  logBug("note", "log cleared");
}

/**
 * Offers the trail as a file.
 *
 * A download rather than a copy to the clipboard: the person exporting this is a parent on a tablet
 * as often as not, and a file survives being mailed on where a clipboard does not.
 */
export function downloadBugLog(): void {
  const blob = new Blob([dumpBugLog()], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `作业勇者-问题日志-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "")}.txt`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  // Revoking immediately can cancel the download in some browsers; a tick later is safe.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
