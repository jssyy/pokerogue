import { HomeworkSubject } from "#enums/homework-subject";
import type { StarRating } from "#types/homework-types";

/** Current version of the homework save payload. */
export const HOMEWORK_SAVE_VERSION = 1;

/** Highest star rating a parent can award. */
export const MAX_STARS = 5;

/**
 * Stamina paid out per star.
 *
 * @remarks
 * The curve is deliberately convex: a 5-star pass is worth more than five 1-star passes, so
 * doing one task carefully beats rushing through several. This is the whole point of letting
 * only the parent grade - the child cannot farm stamina with sloppy work.
 */
export const STAR_STAMINA: Readonly<Record<StarRating, number>> = Object.freeze({
  1: 2,
  2: 5,
  3: 10,
  4: 18,
  5: 30,
});

/** Multiplier applied when a task is graded more than {@linkcode LATE_GRACE_DAYS} days after its planned day. */
export const LATE_STAMINA_MULTIPLIER = 0.5;

/** How many days after its planned date a task can still be graded at full value. */
export const LATE_GRACE_DAYS = 1;

/** Paid once when every required task of a day has been graded. */
export const DAY_COMPLETE_BONUS = 10;

/** Paid on top of {@linkcode DAY_COMPLETE_BONUS} when the day's required tasks averaged at least {@linkcode CAREFUL_DAY_MIN_AVERAGE} stars. */
export const CAREFUL_DAY_BONUS = 20;

/** Average star rating a day's required tasks must reach to count as a "careful" day. */
export const CAREFUL_DAY_MIN_AVERAGE = 4;

/** Bonus stamina per day of the current streak. */
export const STREAK_BONUS_PER_DAY = 3;

/** The streak length past which the streak bonus stops growing. */
export const STREAK_BONUS_CAP_DAYS = 7;

/**
 * Stamina a brand new plan starts with.
 *
 * @remarks
 * Enough for exactly one run. Without it a fresh install is a locked door: the parent has to plan
 * tasks, the child has to do them and the parent has to grade them before anyone can see the game
 * at all, which is a terrible first impression of a reward system.
 */
export const WELCOME_STAMINA = 30;

/**
 * Balance the header gauge treats as "full".
 *
 * @remarks
 * Set to roughly one careful homework day, so a full bar means "today's work is done and paid for"
 * rather than an arbitrary maximum.
 */
export const STAMINA_BAR_REFERENCE = 120;

/** Stamina charged to start a brand new run. */
export const COST_NEW_RUN = 30;

/** Stamina charged each time an existing run is resumed. */
export const COST_RESUME_RUN = 10;

/** Stamina charged every {@linkcode WAVE_TOLL_INTERVAL} waves while a run is in progress. */
export const COST_WAVE_TOLL = 10;

/** How many waves one payment of {@linkcode COST_WAVE_TOLL} covers. */
export const WAVE_TOLL_INTERVAL = 10;

/** Number of ledger entries kept; older ones are dropped. */
export const LEDGER_LIMIT = 60;

/** Default PIN used until a parent sets their own, so the parent menu is never unreachable. */
export const DEFAULT_PARENT_PIN = "1234";

/** Required length of the parent PIN. */
export const PARENT_PIN_LENGTH = 4;

/** Ready-made task titles offered to the parent per subject, to keep planning a few taps long. */
export const TASK_TEMPLATES: Readonly<Record<HomeworkSubject, readonly string[]>> = Object.freeze({
  [HomeworkSubject.CHINESE]: ["chineseCopy", "chineseRecite", "chineseWorkbook", "chineseDiary"],
  [HomeworkSubject.MATH]: ["mathOral", "mathWorkbook", "mathWordProblems", "mathReview"],
  [HomeworkSubject.ENGLISH]: ["englishWords", "englishListening", "englishReadAloud", "englishWorkbook"],
  [HomeworkSubject.READING]: ["reading20Min", "readingAloud", "readingNotes"],
  [HomeworkSubject.SCIENCE]: ["scienceObserve", "scienceWorkbook"],
  [HomeworkSubject.CHORE]: ["choreTidyDesk", "choreDishes", "choreTrash"],
  [HomeworkSubject.OTHER]: ["practiceInstrument", "exercise", "custom"],
});

/** Subjects in the order they are offered to the parent. */
export const SUBJECT_ORDER: readonly HomeworkSubject[] = Object.freeze([
  HomeworkSubject.CHINESE,
  HomeworkSubject.MATH,
  HomeworkSubject.ENGLISH,
  HomeworkSubject.READING,
  HomeworkSubject.SCIENCE,
  HomeworkSubject.CHORE,
  HomeworkSubject.OTHER,
]);
