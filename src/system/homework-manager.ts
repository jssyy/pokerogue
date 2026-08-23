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
function getStorageKey(childId: number | null = null): string {
  const owner = loggedInUser?.username ?? "guest";
  // A parent looking at a child's plan must not read or write their own. Without the child in the
  // key, switching to a child showed the parent their own plan and then pushed it over the child's.
  return childId == null ? `homeworkQuest_${owner}` : `homeworkQuest_${owner}_child${childId}`;
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
   * Keys whose plan has been reconciled with the service in this session.
   *
   * Signing in on a new device starts with nothing in local storage, and an empty plan saved before
   * the service has answered would be pushed up and overwrite the real one. Nothing leaves this
   * device for a plan that has not been read back first.
   */
  private readonly syncedKeys = new Set<string>();

  /**
   * The active homework data, loaded from local storage on first use.
   *
   * @remarks
   * The storage key depends on the logged-in user, which is only known once login has resolved.
   * Reloading whenever the key changes keeps one account's plan from being written over another's.
   */
  public get(): HomeworkData {
    if (this.data == null || this.loadedKey !== getStorageKey(this.activeChildId)) {
      this.load();
    }
    return this.data!;
  }

  public load(): void {
    const key = getStorageKey(this.activeChildId);
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
      this.save();
      return;
    }
    // Signed in with nothing stored here, this empty plan is a placeholder until the service
    // answers. Saving it would schedule a push, and that push would overwrite the real plan with
    // nothing - which is exactly what a first sign-in on a new device looks like.
    this.saveLocalOnly();
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
    // Nothing is sent for a plan the service has not been read for yet; see `syncedKeys`.
    if (!this.syncedKeys.has(this.loadedKey ?? "")) {
      return;
    }
    if (this.pushTimer != null) {
      clearTimeout(this.pushTimer);
    }
    const target = this.activeChildId ?? undefined;
    this.pushTimer = setTimeout(() => {
      this.pushTimer = null;
      // Read at send time. Capturing it when the timer was set would send the plan as it looked
      // before the edits that arrived during the wait.
      if (this.data != null) {
        void pushHomework(JSON.stringify(this.data.toSaveData()), target);
      }
    }, PUSH_DELAY_MS);
  }

  /**
   * Sends any pending change now rather than on the timer.
   *
   * Signing out drops the account this plan belongs to, so a change made in the last second and a
   * half would be pushed against nobody. Waiting for this is the difference between "graded, then
   * switched accounts" keeping the grade and losing it.
   */
  public async flushPush(): Promise<void> {
    if (this.pushTimer != null) {
      clearTimeout(this.pushTimer);
      this.pushTimer = null;
    }
    if (!isSignedIn() || this.data == null || !this.syncedKeys.has(this.loadedKey ?? "")) {
      return;
    }
    await pushHomework(JSON.stringify(this.data.toSaveData()), this.activeChildId ?? undefined);
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
    // A parent opening a child's plan wants the child's plan, not whatever this browser last held
    // for them, so the service copy is taken outright. For one's own plan it is only taken when
    // there is nothing here to lose, which is the case this exists for: a first sign-in on a device
    // that has never seen the plan.
    const takeRemote = this.activeChildId != null || (data.tasks.length === 0 && data.ledger.length === 0);
    if (remote.data && takeRemote) {
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
    // Reconciled: from here this plan may be sent back up. See `syncedKeys`.
    this.syncedKeys.add(this.loadedKey ?? getStorageKey(this.activeChildId));
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
