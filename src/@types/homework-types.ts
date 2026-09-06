import type { HomeworkSubject } from "#enums/homework-subject";
import type { HomeworkTaskStatus } from "#enums/homework-task-status";

/** A local calendar day in `YYYY-MM-DD` form. */
export type HomeworkDateKey = string;

/** The star rating a parent may award to a task. */
export type StarRating = 1 | 2 | 3 | 4 | 5;

/** A single homework item the parent planned for one specific day. */
export interface HomeworkTask {
  id: string;
  /** The day this task is planned for. */
  date: HomeworkDateKey;
  title: string;
  subject: HomeworkSubject;
  /**
   * Required tasks gate the day's completion bonus and the streak.
   * Optional ones only ever pay out their own stars.
   */
  required: boolean;
  status: HomeworkTaskStatus;
  /** Only set once the parent has graded the task. */
  stars?: StarRating | undefined;
  /** Stamina actually credited on grading, after the late-submission penalty. */
  awarded?: number | undefined;
  /** Free-form parent comment shown to the child. */
  note?: string | undefined;
  createdAt: number;
  submittedAt?: number | undefined;
  scoredAt?: number | undefined;
}

/** Whether a ledger entry added or removed stamina. */
export type HomeworkLedgerKind = "earn" | "spend";

/** One line in the stamina ledger, kept so both child and parent can audit the balance. */
export interface HomeworkLedgerEntry {
  at: number;
  kind: HomeworkLedgerKind;
  amount: number;
  /** Key under the `homework:ledger` i18n namespace describing why stamina moved. */
  reason: string;
  /** Interpolation values for {@linkcode reason}. */
  reasonArgs?: Record<string, string | number> | undefined;
}

/** The result of grading a task, used to tell the child what they just earned. */
export interface HomeworkScoreResult {
  /** Stamina paid out for the stars themselves. */
  taskStamina: number;
  /** Extra stamina paid out because this grading completed the day. */
  bonusStamina: number;
  /** Whether the late-submission penalty was applied to {@linkcode taskStamina}. */
  late: boolean;
  /** The child's day streak after this grading. */
  streak: number;
  /** Whether this replaced an earlier grade, in which case {@linkcode taskStamina} is the difference. */
  regraded: boolean;
}

/** Everything persisted for the homework mini-game. */
export interface HomeworkSaveData {
  version: number;
  /** The child's current stamina balance - the score, spendable on playing and on the shop. */
  stamina: number;
  totalEarned: number;
  totalSpent: number;
  tasks: HomeworkTask[];
  /** SHA-256 of the parent PIN, or `null` while no PIN has been set. */
  pinHash: string | null;
  /** Whether stamina is required to play at all. */
  gateEnabled: boolean;
  /** A day on which the parent waived the stamina requirement entirely. */
  freePassDate: HomeworkDateKey | null;
  /** Days whose completion bonus has already been paid, so it is never paid twice. */
  settledDates: HomeworkDateKey[];
  ledger: HomeworkLedgerEntry[];
}
