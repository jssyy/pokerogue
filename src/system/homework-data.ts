import { HomeworkSubject } from "#enums/homework-subject";
import { HomeworkTaskStatus } from "#enums/homework-task-status";
import {
  CAREFUL_DAY_BONUS,
  CAREFUL_DAY_MIN_AVERAGE,
  DAY_COMPLETE_BONUS,
  DEFAULT_PARENT_PIN,
  HOMEWORK_SAVE_VERSION,
  LATE_GRACE_DAYS,
  LATE_STAMINA_MULTIPLIER,
  LEDGER_LIMIT,
  MAX_STARS,
  STAR_STAMINA,
  STREAK_BONUS_CAP_DAYS,
  STREAK_BONUS_PER_DAY,
} from "#system/homework-config";
import { addDays, daysBetween, isDateKey, todayKey } from "#system/homework-date";
import type {
  HomeworkDateKey,
  HomeworkLedgerEntry,
  HomeworkSaveData,
  HomeworkScoreResult,
  HomeworkTask,
  StarRating,
} from "#types/homework-types";
import { SHA256 } from "crypto-js";

/** Upper bound on the streak scan, so corrupt data can never spin the loop forever. */
const MAX_STREAK_SCAN_DAYS = 400;

/** Arguments accepted when the parent plans a new task. */
export interface NewTaskOptions {
  date: HomeworkDateKey;
  title: string;
  subject?: HomeworkSubject;
  required?: boolean;
}

/** Options accepted when the parent grades a task. */
export interface ScoreTaskOptions {
  note?: string;
  /** The day the grading happens on; defaults to today. Injectable for tests. */
  today?: HomeworkDateKey;
}

/** Hashes a parent PIN for storage. Not real security - just enough that a child cannot read it. */
function hashPin(pin: string): string {
  return SHA256(pin).toString();
}

let taskIdCounter = 0;

function nextTaskId(): string {
  taskIdCounter++;
  return `t${Date.now().toString(36)}${taskIdCounter.toString(36)}`;
}

/**
 * The homework plan, the child's stamina balance, and every rule that moves stamina around.
 *
 * @remarks
 * Deliberately free of any Phaser, scene or storage dependency: {@linkcode HomeworkManager} owns
 * persistence and {@linkcode HomeworkData} owns the rules, which keeps the economy unit-testable.
 */
export class HomeworkData {
  /** The child's spendable score. */
  public stamina = 0;
  public totalEarned = 0;
  public totalSpent = 0;
  public tasks: HomeworkTask[] = [];
  public pinHash: string | null = null;
  /** Whether playing costs stamina at all. */
  public gateEnabled = true;
  /** A single day on which the parent lifted the stamina requirement. */
  public freePassDate: HomeworkDateKey | null = null;
  public settledDates: HomeworkDateKey[] = [];
  public ledger: HomeworkLedgerEntry[] = [];

  // #region Queries

  public getTask(id: string): HomeworkTask | undefined {
    return this.tasks.find(t => t.id === id);
  }

  /** All tasks planned for a day, required ones first and otherwise in the order they were added. */
  public getTasksForDate(date: HomeworkDateKey): HomeworkTask[] {
    return this.tasks
      .filter(t => t.date === date)
      .sort((a, b) => Number(b.required) - Number(a.required) || a.createdAt - b.createdAt);
  }

  public getRequiredTasksForDate(date: HomeworkDateKey): HomeworkTask[] {
    return this.getTasksForDate(date).filter(t => t.required);
  }

  /** Tasks the child has reported as done that the parent has not graded yet, oldest first. */
  public getTasksAwaitingGrading(): HomeworkTask[] {
    return this.tasks
      .filter(t => t.status === HomeworkTaskStatus.SUBMITTED)
      .sort((a, b) => (a.submittedAt ?? 0) - (b.submittedAt ?? 0));
  }

  /** A day counts as complete once it has required tasks and every one of them has been graded. */
  public isDayComplete(date: HomeworkDateKey): boolean {
    const required = this.getRequiredTasksForDate(date);
    return required.length > 0 && required.every(t => t.status === HomeworkTaskStatus.SCORED);
  }

  /** Mean star rating of a day's graded required tasks, or `0` when none were graded. */
  public getDayAverageStars(date: HomeworkDateKey): number {
    const scored = this.getRequiredTasksForDate(date).filter(t => t.stars != null);
    if (scored.length === 0) {
      return 0;
    }
    return scored.reduce((sum, t) => sum + (t.stars ?? 0), 0) / scored.length;
  }

  /**
   * Length of the run of completed days ending at `today`.
   *
   * @remarks
   * A day that has no required tasks planned is neutral: it neither extends nor breaks the streak,
   * so a weekend with no plan does not punish the child. Today itself is only counted once it is
   * complete, so an unfinished today does not wipe out the streak earned so far.
   */
  public getStreak(today: HomeworkDateKey = todayKey()): number {
    const earliest = this.tasks.reduce<HomeworkDateKey | null>(
      (min, t) => (min == null || t.date < min ? t.date : min),
      null,
    );
    if (earliest == null) {
      return 0;
    }

    let cursor = this.isDayComplete(today) ? today : addDays(today, -1);
    let streak = 0;
    for (let scanned = 0; scanned < MAX_STREAK_SCAN_DAYS && daysBetween(earliest, cursor) >= 0; scanned++) {
      if (this.isDayComplete(cursor)) {
        streak++;
      } else if (this.getRequiredTasksForDate(cursor).length > 0) {
        // The day had a plan that was never finished, so the run of completed days stops here.
        break;
      }
      cursor = addDays(cursor, -1);
    }
    return streak;
  }

  // #endregion Queries

  // #region Planning (parent)

  public addTask({ date, title, subject = HomeworkSubject.OTHER, required = true }: NewTaskOptions): HomeworkTask {
    const task: HomeworkTask = {
      id: nextTaskId(),
      date,
      title: title.trim().slice(0, 40),
      subject,
      required,
      status: HomeworkTaskStatus.PLANNED,
      createdAt: Date.now(),
    };
    this.tasks.push(task);
    return task;
  }

  public removeTask(id: string): boolean {
    const index = this.tasks.findIndex(t => t.id === id);
    if (index < 0) {
      return false;
    }
    this.tasks.splice(index, 1);
    return true;
  }

  public setTaskRequired(id: string, required: boolean): boolean {
    const task = this.getTask(id);
    if (!task) {
      return false;
    }
    task.required = required;
    return true;
  }

  /**
   * Copies a day's plan onto another day, skipping titles that day already has.
   * @returns The number of tasks copied.
   */
  public copyDay(from: HomeworkDateKey, to: HomeworkDateKey): number {
    const existingTitles = new Set(this.getTasksForDate(to).map(t => t.title));
    const source = this.getTasksForDate(from).filter(t => !existingTitles.has(t.title));
    for (const task of source) {
      this.addTask({ date: to, title: task.title, subject: task.subject, required: task.required });
    }
    return source.length;
  }

  // #endregion Planning (parent)

  // #region Doing (child)

  /** The child reports a task as done. Grading - and therefore stamina - stays with the parent. */
  public submitTask(id: string): boolean {
    const task = this.getTask(id);
    if (!task || task.status !== HomeworkTaskStatus.PLANNED) {
      return false;
    }
    task.status = HomeworkTaskStatus.SUBMITTED;
    task.submittedAt = Date.now();
    return true;
  }

  /** Undoes a mis-tapped submission. Graded tasks cannot be walked back by the child. */
  public withdrawTask(id: string): boolean {
    const task = this.getTask(id);
    if (!task || task.status !== HomeworkTaskStatus.SUBMITTED) {
      return false;
    }
    task.status = HomeworkTaskStatus.PLANNED;
    task.submittedAt = undefined;
    return true;
  }

  // #endregion Doing (child)

  // #region Grading (parent)

  /**
   * Grades a task, paying out its stars plus any day-completion bonus this grading unlocks.
   *
   * Re-grading an already graded task only pays out the difference and never re-pays the day bonus.
   * @returns The stamina breakdown, or `null` if the task does not exist or the rating is invalid.
   */
  public scoreTask(id: string, stars: StarRating, options: ScoreTaskOptions = {}): HomeworkScoreResult | null {
    const task = this.getTask(id);
    if (!task || !Number.isInteger(stars) || stars < 1 || stars > MAX_STARS) {
      return null;
    }

    const today = options.today ?? todayKey();
    const late = daysBetween(task.date, today) > LATE_GRACE_DAYS;
    const award = late ? Math.max(1, Math.floor(STAR_STAMINA[stars] * LATE_STAMINA_MULTIPLIER)) : STAR_STAMINA[stars];

    const regraded = task.status === HomeworkTaskStatus.SCORED;
    const previousAward = regraded ? (task.awarded ?? 0) : 0;

    task.stars = stars;
    task.awarded = award;
    task.status = HomeworkTaskStatus.SCORED;
    task.scoredAt = Date.now();
    task.submittedAt ??= task.scoredAt;
    if (options.note != null) {
      task.note = options.note.trim().slice(0, 60) || undefined;
    }

    const delta = award - previousAward;
    if (delta > 0) {
      this.earn(delta, regraded ? "regrade" : late ? "taskScoredLate" : "taskScored", { title: task.title, stars });
    } else if (delta < 0) {
      // A downgrade takes back what it can without ever pushing the child into debt.
      this.spend(Math.min(-delta, this.stamina), "regrade", { title: task.title, stars });
    }

    return {
      taskStamina: delta,
      bonusStamina: regraded ? 0 : this.settleDay(task.date),
      late,
      streak: this.getStreak(today),
      regraded,
    };
  }

  /**
   * Pays the once-per-day completion bonus if `date` just became complete.
   * @returns The bonus paid, or `0` if there was nothing to pay.
   */
  private settleDay(date: HomeworkDateKey): number {
    if (this.settledDates.includes(date) || !this.isDayComplete(date)) {
      return 0;
    }
    this.settledDates.push(date);

    const streak = this.getStreak(date);
    let bonus = DAY_COMPLETE_BONUS;
    if (this.getDayAverageStars(date) >= CAREFUL_DAY_MIN_AVERAGE) {
      bonus += CAREFUL_DAY_BONUS;
    }
    bonus += Math.min(streak, STREAK_BONUS_CAP_DAYS) * STREAK_BONUS_PER_DAY;

    this.earn(bonus, "dayComplete", { streak });
    return bonus;
  }

  // #endregion Grading (parent)

  // #region Economy

  public earn(amount: number, reason: string, reasonArgs?: Record<string, string | number>): void {
    if (amount <= 0) {
      return;
    }
    this.stamina += amount;
    this.totalEarned += amount;
    this.pushLedger({ at: Date.now(), kind: "earn", amount, reason, reasonArgs });
  }

  /**
   * Deducts stamina if the child can afford it.
   * @returns Whether the charge went through.
   */
  public spend(amount: number, reason: string, reasonArgs?: Record<string, string | number>): boolean {
    if (amount <= 0) {
      return true;
    }
    if (this.stamina < amount) {
      return false;
    }
    this.stamina -= amount;
    this.totalSpent += amount;
    this.pushLedger({ at: Date.now(), kind: "spend", amount, reason, reasonArgs });
    return true;
  }

  private pushLedger(entry: HomeworkLedgerEntry): void {
    this.ledger.unshift(entry);
    if (this.ledger.length > LEDGER_LIMIT) {
      this.ledger.length = LEDGER_LIMIT;
    }
  }

  // #endregion Economy

  // #region Gate

  /** Whether the parent waived the stamina requirement for `today`. */
  public hasFreePass(today: HomeworkDateKey = todayKey()): boolean {
    return this.freePassDate === today;
  }

  /** Whether playing currently costs stamina. */
  public isGateActive(today: HomeworkDateKey = todayKey()): boolean {
    return this.gateEnabled && !this.hasFreePass(today);
  }

  /**
   * Charges `cost` stamina for a play action.
   * @returns Whether play may proceed - always `true` while the gate is off.
   */
  public payToPlay(cost: number, reason: string, today: HomeworkDateKey = todayKey()): boolean {
    if (!this.isGateActive(today)) {
      return true;
    }
    return this.spend(cost, reason);
  }

  /** How much stamina is still missing to afford `cost`. */
  public missingStamina(cost: number, today: HomeworkDateKey = todayKey()): number {
    if (!this.isGateActive(today)) {
      return 0;
    }
    return Math.max(0, cost - this.stamina);
  }

  // #endregion Gate

  // #region Parent PIN

  public hasCustomPin(): boolean {
    return this.pinHash != null;
  }

  public verifyPin(pin: string): boolean {
    return this.pinHash == null ? pin === DEFAULT_PARENT_PIN : hashPin(pin) === this.pinHash;
  }

  public setPin(pin: string): void {
    this.pinHash = hashPin(pin);
  }

  // #endregion Parent PIN

  // #region Serialization

  public toSaveData(): HomeworkSaveData {
    return {
      version: HOMEWORK_SAVE_VERSION,
      stamina: this.stamina,
      totalEarned: this.totalEarned,
      totalSpent: this.totalSpent,
      tasks: this.tasks,
      pinHash: this.pinHash,
      gateEnabled: this.gateEnabled,
      freePassDate: this.freePassDate,
      settledDates: this.settledDates,
      ledger: this.ledger,
    };
  }

  /**
   * Rebuilds homework data from a parsed save payload, dropping anything malformed.
   *
   * @remarks
   * The payload lives in local storage, so it has to be treated as untrusted: a corrupt file
   * should cost at most the affected entries, never the ability to open the planner.
   */
  public static fromSaveData(raw: unknown): HomeworkData {
    const data = new HomeworkData();
    if (raw == null || typeof raw !== "object") {
      return data;
    }
    const source = raw as Partial<HomeworkSaveData>;

    data.stamina = toCount(source.stamina);
    data.totalEarned = toCount(source.totalEarned);
    data.totalSpent = toCount(source.totalSpent);
    data.pinHash = typeof source.pinHash === "string" ? source.pinHash : null;
    data.gateEnabled = source.gateEnabled !== false;
    data.freePassDate = isDateKey(source.freePassDate) ? source.freePassDate : null;
    data.settledDates = Array.isArray(source.settledDates) ? source.settledDates.filter(isDateKey) : [];
    data.tasks = Array.isArray(source.tasks) ? source.tasks.filter(isValidTask) : [];
    data.ledger = Array.isArray(source.ledger) ? source.ledger.filter(isValidLedgerEntry).slice(0, LEDGER_LIMIT) : [];

    return data;
  }

  // #endregion Serialization
}

function toCount(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}

function isValidTask(value: unknown): value is HomeworkTask {
  if (value == null || typeof value !== "object") {
    return false;
  }
  const task = value as HomeworkTask;
  return (
    typeof task.id === "string"
    && typeof task.title === "string"
    && isDateKey(task.date)
    && Object.values(HomeworkSubject).includes(task.subject)
    && Object.values(HomeworkTaskStatus).includes(task.status)
    && typeof task.required === "boolean"
    && typeof task.createdAt === "number"
  );
}

function isValidLedgerEntry(value: unknown): value is HomeworkLedgerEntry {
  if (value == null || typeof value !== "object") {
    return false;
  }
  const entry = value as HomeworkLedgerEntry;
  return (
    typeof entry.at === "number"
    && typeof entry.amount === "number"
    && typeof entry.reason === "string"
    && (entry.kind === "earn" || entry.kind === "spend")
  );
}
