/**
 * Lifecycle of a single homework task.
 *
 * @remarks
 * String values are deliberate - see {@linkcode HomeworkSubject}.
 */
export enum HomeworkTaskStatus {
  /** Planned by the parent; the child has not reported it as done yet. */
  PLANNED = "planned",
  /** The child marked it as done and it is waiting for the parent to grade it. */
  SUBMITTED = "submitted",
  /** The parent gave it a star rating, and stamina has been paid out. */
  SCORED = "scored",
}
