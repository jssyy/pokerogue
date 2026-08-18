/**
 * The school subject a homework task belongs to.
 *
 * @remarks
 * These are string values rather than the numeric enums used elsewhere in the codebase because
 * they get written into the player's homework save data; string values survive members being
 * reordered or inserted later on.
 */
export enum HomeworkSubject {
  CHINESE = "chinese",
  MATH = "math",
  ENGLISH = "english",
  READING = "reading",
  SCIENCE = "science",
  CHORE = "chore",
  OTHER = "other",
}
