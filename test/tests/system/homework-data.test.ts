import { HomeworkSubject } from "#enums/homework-subject";
import { HomeworkTaskStatus } from "#enums/homework-task-status";
import {
  CAREFUL_DAY_BONUS,
  COST_NEW_RUN,
  DAY_COMPLETE_BONUS,
  DEFAULT_PARENT_PIN,
  LATE_STAMINA_MULTIPLIER,
  STAR_STAMINA,
  STREAK_BONUS_CAP_DAYS,
  STREAK_BONUS_PER_DAY,
} from "#system/homework-config";
import { HomeworkData } from "#system/homework-data";
import { addDays } from "#system/homework-date";
import type { HomeworkDateKey, StarRating } from "#types/homework-types";
import { describe, expect, it } from "vitest";

/**
 * Unit tests for the homework economy in `src/system/homework-data.ts`.
 * @module
 */

const DAY: HomeworkDateKey = "2026-08-17";

/** Adds a task on `date` and returns its id. */
function plan(data: HomeworkData, date: HomeworkDateKey, required = true, title = "抄写生字"): string {
  return data.addTask({ date, title, subject: HomeworkSubject.CHINESE, required }).id;
}

/** Grades every task of a day with the same rating, as a parent would. */
function gradeAll(data: HomeworkData, date: HomeworkDateKey, stars: StarRating): void {
  for (const task of data.getTasksForDate(date)) {
    data.scoreTask(task.id, stars, { today: date });
  }
}

describe("Homework - data", () => {
  describe("grading", () => {
    it("pays out the star value, and only a parent's grade moves stamina", () => {
      const data = new HomeworkData();
      const id = plan(data, DAY);

      data.submitTask(id);
      expect(data.stamina).toBe(0);
      expect(data.getTask(id)!.status).toBe(HomeworkTaskStatus.SUBMITTED);

      const result = data.scoreTask(id, 4, { today: DAY })!;
      expect(result.taskStamina).toBe(STAR_STAMINA[4]);
      expect(data.stamina).toBe(STAR_STAMINA[4] + result.bonusStamina);
    });

    it("rewards one careful task more than several sloppy ones", () => {
      const careful = new HomeworkData();
      careful.scoreTask(plan(careful, DAY), 5, { today: DAY });

      const sloppy = new HomeworkData();
      for (let i = 0; i < 5; i++) {
        sloppy.scoreTask(plan(sloppy, DAY, true, `任务${i}`), 1, { today: DAY });
      }

      expect(STAR_STAMINA[5]).toBeGreaterThan(5 * STAR_STAMINA[1]);
      expect(careful.stamina).toBeGreaterThan(sloppy.stamina);
    });

    it("halves the payout when a task is graded long after its day", () => {
      const data = new HomeworkData();
      const id = plan(data, DAY);

      const result = data.scoreTask(id, 5, { today: addDays(DAY, 3) })!;

      expect(result.late).toBe(true);
      expect(result.taskStamina).toBe(Math.floor(STAR_STAMINA[5] * LATE_STAMINA_MULTIPLIER));
    });

    it("grades at full value one day late, inside the grace period", () => {
      const data = new HomeworkData();

      const result = data.scoreTask(plan(data, DAY), 3, { today: addDays(DAY, 1) })!;

      expect(result.late).toBe(false);
      expect(result.taskStamina).toBe(STAR_STAMINA[3]);
    });

    it("only pays the difference when a parent corrects a grade", () => {
      const data = new HomeworkData();
      const id = plan(data, DAY);

      data.scoreTask(id, 2, { today: DAY });
      const staminaAfterFirstGrade = data.stamina;
      const result = data.scoreTask(id, 4, { today: DAY })!;

      expect(result.regraded).toBe(true);
      expect(result.taskStamina).toBe(STAR_STAMINA[4] - STAR_STAMINA[2]);
      expect(data.stamina).toBe(staminaAfterFirstGrade + STAR_STAMINA[4] - STAR_STAMINA[2]);
    });

    it("takes stamina back on a downgrade without going into debt", () => {
      const data = new HomeworkData();
      const id = plan(data, DAY);

      data.scoreTask(id, 5, { today: DAY });
      data.spend(data.stamina, "newRun");
      data.scoreTask(id, 1, { today: DAY });

      expect(data.stamina).toBe(0);
    });

    it("rejects ratings outside 1-5", () => {
      const data = new HomeworkData();
      const id = plan(data, DAY);

      expect(data.scoreTask(id, 0 as StarRating, { today: DAY })).toBeNull();
      expect(data.scoreTask(id, 6 as StarRating, { today: DAY })).toBeNull();
      expect(data.stamina).toBe(0);
    });
  });

  describe("daily bonus", () => {
    it("pays the completion and careful-day bonus once the required tasks are graded", () => {
      const data = new HomeworkData();
      plan(data, DAY, true, "语文");
      plan(data, DAY, true, "数学");

      gradeAll(data, DAY, 5);

      const expectedBonus = DAY_COMPLETE_BONUS + CAREFUL_DAY_BONUS + STREAK_BONUS_PER_DAY;
      expect(data.isDayComplete(DAY)).toBe(true);
      expect(data.stamina).toBe(2 * STAR_STAMINA[5] + expectedBonus);
    });

    it("skips the careful bonus for a low-star day", () => {
      const data = new HomeworkData();
      plan(data, DAY);

      gradeAll(data, DAY, 2);

      expect(data.stamina).toBe(STAR_STAMINA[2] + DAY_COMPLETE_BONUS + STREAK_BONUS_PER_DAY);
    });

    it("never pays the same day's bonus twice", () => {
      const data = new HomeworkData();
      const id = plan(data, DAY);

      data.scoreTask(id, 3, { today: DAY });
      const staminaAfterBonus = data.stamina;
      data.scoreTask(id, 3, { today: DAY });

      expect(data.stamina).toBe(staminaAfterBonus);
    });

    it("ignores optional tasks when deciding whether a day is done", () => {
      const data = new HomeworkData();
      const required = plan(data, DAY, true, "必做");
      plan(data, DAY, false, "选做");

      data.scoreTask(required, 3, { today: DAY });

      expect(data.isDayComplete(DAY)).toBe(true);
    });

    it("does not treat a day with no plan as complete", () => {
      expect(new HomeworkData().isDayComplete(DAY)).toBe(false);
    });
  });

  describe("streak", () => {
    it("counts consecutive completed days", () => {
      const data = new HomeworkData();
      for (let offset = -2; offset <= 0; offset++) {
        const date = addDays(DAY, offset);
        plan(data, date);
        gradeAll(data, date, 4);
      }

      expect(data.getStreak(DAY)).toBe(3);
    });

    it("keeps yesterday's streak while today is still unfinished", () => {
      const data = new HomeworkData();
      const yesterday = addDays(DAY, -1);
      plan(data, yesterday);
      gradeAll(data, yesterday, 4);
      plan(data, DAY);

      expect(data.getStreak(DAY)).toBe(1);
    });

    it("breaks on a day whose plan was never finished", () => {
      const data = new HomeworkData();
      const twoDaysAgo = addDays(DAY, -2);
      plan(data, twoDaysAgo);
      gradeAll(data, twoDaysAgo, 4);
      plan(data, addDays(DAY, -1)); // planned, never graded
      plan(data, DAY);
      gradeAll(data, DAY, 4);

      expect(data.getStreak(DAY)).toBe(1);
    });

    it("treats a day with nothing planned as neutral", () => {
      const data = new HomeworkData();
      const twoDaysAgo = addDays(DAY, -2);
      plan(data, twoDaysAgo);
      gradeAll(data, twoDaysAgo, 4);
      plan(data, DAY);
      gradeAll(data, DAY, 4);

      expect(data.getStreak(DAY)).toBe(2);
    });

    it("caps the streak bonus", () => {
      const data = new HomeworkData();
      for (let offset = -(STREAK_BONUS_CAP_DAYS + 2); offset < 0; offset++) {
        const date = addDays(DAY, offset);
        plan(data, date);
        gradeAll(data, date, 3);
      }
      const staminaBeforeToday = data.stamina;

      plan(data, DAY);
      gradeAll(data, DAY, 3);

      const gained = data.stamina - staminaBeforeToday;
      expect(gained).toBe(STAR_STAMINA[3] + DAY_COMPLETE_BONUS + STREAK_BONUS_CAP_DAYS * STREAK_BONUS_PER_DAY);
    });
  });

  describe("stamina gate", () => {
    it("refuses to spend more than the balance", () => {
      const data = new HomeworkData();
      data.earn(10, "parentGrant");

      expect(data.spend(COST_NEW_RUN, "newRun")).toBe(false);
      expect(data.stamina).toBe(10);
      expect(data.missingStamina(COST_NEW_RUN)).toBe(COST_NEW_RUN - 10);
    });

    it("lets play through for free while the gate is off", () => {
      const data = new HomeworkData();
      data.gateEnabled = false;

      expect(data.isGateActive()).toBe(false);
      expect(data.payToPlay(COST_NEW_RUN, "newRun")).toBe(true);
      expect(data.stamina).toBe(0);
      expect(data.missingStamina(COST_NEW_RUN)).toBe(0);
    });

    it("honours a parent's free pass for that day only", () => {
      const data = new HomeworkData();
      data.freePassDate = DAY;

      expect(data.isGateActive(DAY)).toBe(false);
      expect(data.isGateActive(addDays(DAY, 1))).toBe(true);
    });
  });

  describe("planning", () => {
    it("copies a day's plan without duplicating titles", () => {
      const data = new HomeworkData();
      const tomorrow = addDays(DAY, 1);
      plan(data, DAY, true, "语文");
      plan(data, DAY, true, "数学");
      plan(data, tomorrow, true, "数学");

      expect(data.copyDay(DAY, tomorrow)).toBe(1);
      expect(
        data
          .getTasksForDate(tomorrow)
          .map(t => t.title)
          .sort(),
      ).toEqual(["数学", "语文"]);
    });

    it("lists required tasks before optional ones", () => {
      const data = new HomeworkData();
      plan(data, DAY, false, "选做");
      plan(data, DAY, true, "必做");

      expect(data.getTasksForDate(DAY)[0].title).toBe("必做");
    });

    it("lets a child undo a submission but not a grade", () => {
      const data = new HomeworkData();
      const id = plan(data, DAY);

      data.submitTask(id);
      expect(data.withdrawTask(id)).toBe(true);

      data.scoreTask(id, 3, { today: DAY });
      expect(data.withdrawTask(id)).toBe(false);
      expect(data.getTask(id)!.status).toBe(HomeworkTaskStatus.SCORED);
    });
  });

  describe("parent PIN", () => {
    it("accepts the default PIN until a parent sets their own", () => {
      const data = new HomeworkData();

      expect(data.hasCustomPin()).toBe(false);
      expect(data.verifyPin(DEFAULT_PARENT_PIN)).toBe(true);

      data.setPin("8613");

      expect(data.hasCustomPin()).toBe(true);
      expect(data.verifyPin(DEFAULT_PARENT_PIN)).toBe(false);
      expect(data.verifyPin("8613")).toBe(true);
    });

    it("never stores the PIN in the clear", () => {
      const data = new HomeworkData();
      data.setPin("8613");

      expect(JSON.stringify(data.toSaveData())).not.toContain("8613");
    });
  });

  describe("serialization", () => {
    it("round-trips the plan and the balance", () => {
      const data = new HomeworkData();
      const id = plan(data, DAY);
      data.scoreTask(id, 5, { today: DAY });
      data.setPin("8613");

      const restored = HomeworkData.fromSaveData(JSON.parse(JSON.stringify(data.toSaveData())));

      expect(restored.stamina).toBe(data.stamina);
      expect(restored.totalEarned).toBe(data.totalEarned);
      expect(restored.getTasksForDate(DAY)).toHaveLength(1);
      expect(restored.verifyPin("8613")).toBe(true);
      expect(restored.isDayComplete(DAY)).toBe(true);
    });

    it("drops malformed entries instead of failing to load", () => {
      const restored = HomeworkData.fromSaveData({
        version: 1,
        stamina: Number.NaN,
        tasks: [
          {
            id: "ok",
            date: DAY,
            title: "语文",
            subject: HomeworkSubject.MATH,
            required: true,
            status: "planned",
            createdAt: 1,
          },
          {
            id: "bad-date",
            date: "not-a-date",
            title: "x",
            subject: HomeworkSubject.MATH,
            required: true,
            status: "planned",
            createdAt: 1,
          },
          {
            id: "bad-status",
            date: DAY,
            title: "x",
            subject: HomeworkSubject.MATH,
            required: true,
            status: "???",
            createdAt: 1,
          },
          null,
        ],
        ledger: [{ at: 1, kind: "earn", amount: 5, reason: "taskScored" }, { nonsense: true }],
        settledDates: [DAY, "13"],
      });

      expect(restored.stamina).toBe(0);
      expect(restored.tasks.map(t => t.id)).toEqual(["ok"]);
      expect(restored.ledger).toHaveLength(1);
      expect(restored.settledDates).toEqual([DAY]);
    });

    it("starts empty for junk input", () => {
      expect(HomeworkData.fromSaveData(null).tasks).toEqual([]);
      expect(HomeworkData.fromSaveData("nope").stamina).toBe(0);
    });
  });
});
