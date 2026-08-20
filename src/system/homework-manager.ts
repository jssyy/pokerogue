import { loggedInUser } from "#app/account";
import type { RemoteHomework } from "#system/family-session";
import { fetchHomework, isParentAccount, isSignedIn, pushHomework } from "#system/family-session";
import { WELCOME_STAMINA } from "#system/homework-config";
import { HomeworkData } from "#system/homework-data";
import { AES, enc } from "crypto-js";

/**
 * Key the homework payload is stored under.
 *
 * Homework data is kept in its own local-storage entry rather than inside the PokéRogue system
 * save, so that a cloud save overwriting the account data can never wipe the child's plan, and so
 * that PokéRogue's own save migrations never have to know about it.
 */
function getStorageKey(): string {
  return `homeworkQuest_${loggedInUser?.username ?? "guest"}`;
}

/**
 * How long to wait after a change before pushing it up.
 *
 * Grading a day's worth of tasks is a burst of edits; sending each one would be a request per key
 * press for no gain, since only the settled result matters.
 */
const PUSH_DELAY_MS = 1500;

/** Light obfuscation only - it keeps a curious child out of the balance, nothing more. */
const OBFUSCATION_KEY = "homework-quest";

function obfuscate(json: string): string {
  return AES.encrypt(json, OBFUSCATION_KEY).toString();
}

function deobfuscate(raw: string): unknown {
  try {
    const decrypted = AES.decrypt(raw, OBFUSCATION_KEY).toString(enc.Utf8);
    if (decrypted) {
      return JSON.parse(decrypted);
    }
  } catch {
    // Fall through and try the value as plain JSON, which is what hand-edited or pre-obfuscation
    // saves look like.
  }
  try {
    return JSON.parse(raw);
  } catch {
    console.warn("Homework save data could not be read; starting from an empty plan.");
    return null;
  }
}

/** Owns loading, saving and handing out the single active {@linkcode HomeworkData} instance. */
class HomeworkManager {
  private data: HomeworkData | null = null;
  /** The key {@linkcode data} was read from, so a change of account is noticed. */
  private loadedKey: string | null = null;
  /** Pending push to the service, so a burst of edits becomes one request. */
  private pushTimer: ReturnType<typeof setTimeout> | null = null;
  /** The child a parent session is editing. `null` means "my own plan". */
  private activeChildId: number | null = null;

  /**
   * The active homework data, loaded from local storage on first use.
   *
   * @remarks
   * The storage key depends on the logged-in user, which is only known once login has resolved.
   * Reloading whenever the key changes keeps one account's plan from being written over another's.
   */
  public get(): HomeworkData {
    if (this.data == null || this.loadedKey !== getStorageKey()) {
      this.load();
    }
    return this.data!;
  }

  public load(): void {
    const key = getStorageKey();
    const raw = localStorage.getItem(key);
    this.loadedKey = key;

    if (raw) {
      this.data = HomeworkData.fromSaveData(deobfuscate(raw));
      return;
    }

    this.data = new HomeworkData();
    // Signed in, the welcome balance was credited by the service when the account was created, so
    // granting it again here would let a child mint another by clearing their browser. Without an
    // account there is nobody to credit it, and a plan with nothing in it is a locked door.
    if (!isSignedIn()) {
      this.data.earn(WELCOME_STAMINA, "welcome");
    }
    this.save();
  }

  public save(): void {
    if (this.data == null) {
      return;
    }
    try {
      localStorage.setItem(this.loadedKey ?? getStorageKey(), obfuscate(JSON.stringify(this.data.toSaveData())));
    } catch (err) {
      console.error("Failed to save homework data:\n", err);
    }
    this.schedulePush();
  }

  /** Writes to local storage without scheduling a push, used when applying what the service sent. */
  private saveLocalOnly(): void {
    if (this.data == null) {
      return;
    }
    try {
      localStorage.setItem(this.loadedKey ?? getStorageKey(), obfuscate(JSON.stringify(this.data.toSaveData())));
    } catch (err) {
      console.error("Failed to save homework data:\n", err);
    }
  }

  /**
   * Sends the plan up, once the edits stop.
   *
   * Fire and forget on purpose: a plan that fails to reach the service is no reason to refuse the
   * change locally, and the next save carries it. Losing the round trip costs nothing the local copy
   * does not already hold.
   */
  private schedulePush(): void {
    if (!isSignedIn() || this.data == null) {
      return;
    }
    if (this.pushTimer != null) {
      clearTimeout(this.pushTimer);
    }
    const target = this.activeChildId ?? undefined;
    const payload = JSON.stringify(this.data.toSaveData());
    this.pushTimer = setTimeout(() => {
      this.pushTimer = null;
      void pushHomework(payload, target);
    }, PUSH_DELAY_MS);
  }

  /**
   * Brings the local copy in line with the service.
   *
   * The earned total always comes from the service - it is the number a child must not be able to
   * write, and it is the whole reason grading goes through an account. The plan itself is adopted
   * only when there is nothing local to lose, which covers the case this exists for: signing in on a
   * device that has never seen this plan.
   *
   * Two devices editing the same plan at once are not merged; the last to push wins. For one family
   * that is the honest trade against a merge engine nobody could reason about.
   */
  public applyRemote(remote: RemoteHomework): void {
    const data = this.get();
    if (remote.data && data.tasks.length === 0 && data.ledger.length === 0) {
      this.data = HomeworkData.fromSaveData(deobfuscate(remote.data));
    }
    const current = this.get();
    current.totalEarned = remote.earned;
    current.stamina = Math.max(0, remote.earned - current.totalSpent);
    this.saveLocalOnly();
  }

  /**
   * Pulls the plan for the signed-in account, or for the child a parent is looking at.
   *
   * @returns Whether the service answered; `false` just means playing on with the local copy
   */
  public async sync(): Promise<boolean> {
    if (!isSignedIn()) {
      return false;
    }
    const remote = await fetchHomework(this.activeChildId ?? undefined);
    if (remote == null) {
      return false;
    }
    this.applyRemote(remote);
    return true;
  }

  /**
   * Points the planner at one of the parent's children.
   *
   * A parent's own plan is empty and meaningless - they are not the one doing the homework - so a
   * parent session edits a child's, chosen here. Switching drops the in-memory copy so the next read
   * pulls that child's plan rather than showing the previous one.
   */
  public async viewChild(childId: number | null): Promise<boolean> {
    if (!isParentAccount()) {
      return false;
    }
    this.activeChildId = childId;
    this.data = null;
    this.loadedKey = null;
    return await this.sync();
  }

  /** Which child a parent session is working on, or `null` for one's own plan. */
  public get viewingChild(): number | null {
    return this.activeChildId;
  }

  /** Runs a change against the homework data and persists the result. */
  public mutate<T>(change: (data: HomeworkData) => T): T {
    const result = change(this.get());
    this.save();
    return result;
  }

  /** Drops the in-memory copy so the next access reloads it. */
  public invalidate(): void {
    this.data = null;
    this.loadedKey = null;
  }
}

export const homeworkManager = new HomeworkManager();
