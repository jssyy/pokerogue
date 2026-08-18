import { loggedInUser } from "#app/account";
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

    // A brand new plan gets one run's worth of stamina, and is saved straight away so the gift
    // cannot be farmed by reloading the page.
    this.data = new HomeworkData();
    this.data.earn(WELCOME_STAMINA, "welcome");
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
