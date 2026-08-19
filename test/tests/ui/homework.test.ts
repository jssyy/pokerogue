import { Button } from "#enums/buttons";
import { GameModes } from "#enums/game-modes";
import { HomeworkSubject } from "#enums/homework-subject";
import { HomeworkTaskStatus } from "#enums/homework-task-status";
import { SpeciesId } from "#enums/species-id";
import { UiMode } from "#enums/ui-mode";
import { VoucherType } from "#enums/voucher-type";
import {
  CAREFUL_DAY_BONUS,
  COST_NEW_RUN,
  COST_WAVE_TOLL,
  DAY_COMPLETE_BONUS,
  DEFAULT_PARENT_PIN,
  STAR_STAMINA,
  STREAK_BONUS_PER_DAY,
  TASK_TEMPLATES,
  WAVE_TOLL_INTERVAL,
} from "#system/homework-config";
import { addDays, todayKey } from "#system/homework-date";
import { canAffordPlay, tryPayToPlay, tryPayWaveToll } from "#system/homework-gate";
import { homeworkManager } from "#system/homework-manager";
import { GameManager } from "#test/framework/game-manager";
import { HomeworkUiHandler } from "#ui/homework-ui-handler";
import i18next from "i18next";
import Phaser from "phaser";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

/**
 * Integration tests for the homework planner UI and the stamina gate.
 * @module
 */

describe("UI - Homework planner", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;

  beforeAll(() => {
    phaserGame = new Phaser.Game({
      type: Phaser.HEADLESS,
    });
  });

  beforeEach(() => {
    game = new GameManager(phaserGame);
    localStorage.removeItem("homeworkQuest_guest");
    homeworkManager.invalidate();
    // Start from an empty plan with the gate off, matching the harness default: the planner then
    // opens as a sub-screen of the normal title. The gate and home-screen blocks turn it back on.
    const data = homeworkManager.get();
    data.gateEnabled = false;
    // Spend away the welcome gift so each test starts from a known balance.
    data.stamina = 0;
  });

  afterEach(() => {
    localStorage.removeItem("homeworkQuest_guest");
    homeworkManager.invalidate();
  });

  /** Opens the planner from the title screen. */
  async function openPlanner(): Promise<HomeworkUiHandler> {
    await game.runToTitle();
    await game.scene.ui.setOverlayMode(UiMode.HOMEWORK);

    const handler = game.scene.ui.getHandler();
    expect(handler).toBeInstanceOf(HomeworkUiHandler);
    return handler as HomeworkUiHandler;
  }

  /** Picks the option at `index` in whichever option menu is on top. */
  function chooseOption(index: number): void {
    const menu = game.scene.ui.getHandler();
    menu.setCursor(index);
    menu.processInput(Button.ACTION);
  }

  /**
   * Picks an option by its label rather than its position.
   *
   * The planner's menu grows over time; selecting by index means every new entry renumbers a dozen
   * unrelated tests.
   */
  function chooseLabel(label: string): void {
    const menu = game.scene.ui.getHandler() as unknown as { config: { options: { label: string }[] } };
    const index = menu.config.options.findIndex(o => o.label === label);
    expect(index, `no option labelled "${label}"`).toBeGreaterThanOrEqual(0);
    chooseOption(index);
  }

  /** Opens the planner's own menu (the row after the day's tasks). */
  function openMainMenu(handler: HomeworkUiHandler, taskRows: number): void {
    handler.setCursor(taskRows);
    handler.processInput(Button.ACTION);
    expect(game.scene.ui.getMode()).toBe(UiMode.OPTION_SELECT);
  }

  /** Unlocks parent mode through the PIN modal, the way a parent has to. */
  function enterParentMode(handler: HomeworkUiHandler, taskRows: number): void {
    openMainMenu(handler, taskRows);
    chooseLabel(i18next.t("homework:action.parentMode"));
    expect(game.scene.ui.getMode()).toBe(UiMode.HOMEWORK_PIN);
    const modal = game.scene.ui.getHandler() as unknown as { inputs: { text: string }[] };
    modal.inputs[0].text = DEFAULT_PARENT_PIN;
    game.scene.ui.getHandler().processInput(Button.SUBMIT);
    expect(game.scene.ui.getMode()).toBe(UiMode.HOMEWORK);
  }

  /**
   * Asserts the planner is back in charge and still responds.
   *
   * A menu action that leaves the cleared option select as the active mode looks fine in a
   * screenshot but freezes every later keypress, so both halves matter.
   */
  function expectPlannerAlive(handler: HomeworkUiHandler): void {
    expect(game.scene.ui.getMode()).toBe(UiMode.HOMEWORK);
    expect(handler.processInput(Button.ACTION)).toBe(true);
    expect(game.scene.ui.getMode()).not.toBe(UiMode.HOMEWORK);
    game.scene.ui.getHandler().processInput(Button.CANCEL);
    expect(game.scene.ui.getMode()).toBe(UiMode.HOMEWORK);
  }

  /** Waits for a mode that only appears after a fade or a typed-out message. */
  async function waitForMode(mode: UiMode): Promise<void> {
    const deadline = Date.now() + 10000;
    while (game.scene.ui.getMode() !== mode) {
      if (Date.now() > deadline) {
        throw new Error(`Never reached ${UiMode[mode]}; the mode is ${UiMode[game.scene.ui.getMode()]}.`);
      }
      await new Promise(resolve => setTimeout(resolve, 50));
    }
  }

  /** Plans a task for today, the way a parent would. */
  function planToday(title = "抄写生字"): string {
    return homeworkManager.mutate(d =>
      d.addTask({ date: todayKey(), title, subject: HomeworkSubject.CHINESE, required: true }),
    ).id;
  }

  it("opens from the title screen and lists the day's plan", async () => {
    planToday();
    const handler = await openPlanner();

    expect(game.scene.ui.getMode()).toBe(UiMode.HOMEWORK);
    // Moving around must not throw: the cursor covers the task rows plus the trailing menu row.
    expect(handler.processInput(Button.DOWN)).toBe(true);
    expect(handler.processInput(Button.UP)).toBe(true);
    expect(handler.processInput(Button.RIGHT)).toBe(true);
    expect(handler.processInput(Button.LEFT)).toBe(true);
  });

  it("opens with an empty plan without erroring", async () => {
    const handler = await openPlanner();

    // Only the menu row exists, so there is nowhere to move to.
    expect(handler.processInput(Button.DOWN)).toBe(false);
    expect(handler.processInput(Button.ACTION)).toBe(true);
    expect(game.scene.ui.getMode()).toBe(UiMode.OPTION_SELECT);
  });

  it("lets the child report a task as done without paying out any stamina", async () => {
    const taskId = planToday();
    const handler = await openPlanner();

    // Row 0 is the task; the first option of its menu is "I finished it".
    expect(handler.processInput(Button.ACTION)).toBe(true);
    expect(game.scene.ui.getMode()).toBe(UiMode.OPTION_SELECT);

    const menu = game.scene.ui.getHandler();
    menu.setCursor(0);
    menu.processInput(Button.ACTION);

    const data = homeworkManager.get();
    expect(data.getTask(taskId)!.status).toBe(HomeworkTaskStatus.SUBMITTED);
    // Only a parent's grade may move stamina.
    expect(data.stamina).toBe(0);
    expect(game.scene.ui.getMode()).toBe(UiMode.HOMEWORK);
  });

  it("returns to the planner when a menu is cancelled", async () => {
    const taskId = planToday();
    const handler = await openPlanner();

    handler.processInput(Button.ACTION);
    game.scene.ui.getHandler().processInput(Button.CANCEL);

    expect(game.scene.ui.getMode()).toBe(UiMode.HOMEWORK);
    expect(homeworkManager.get().getTask(taskId)!.status).toBe(HomeworkTaskStatus.PLANNED);
  });

  it("asks for the parent PIN before showing grading options", async () => {
    planToday();
    const handler = await openPlanner();

    // Move to the trailing menu row and open it.
    handler.processInput(Button.DOWN);
    handler.processInput(Button.ACTION);
    expect(game.scene.ui.getMode()).toBe(UiMode.OPTION_SELECT);

    chooseLabel(i18next.t("homework:action.parentMode"));

    expect(game.scene.ui.getMode()).toBe(UiMode.HOMEWORK_PIN);
  });

  it("pays out stamina once a parent unlocks grading with the PIN and awards stars", async () => {
    const taskId = planToday();
    const handler = await openPlanner();

    // Open the trailing menu and pick "parent mode".
    handler.processInput(Button.DOWN);
    handler.processInput(Button.ACTION);
    chooseLabel(i18next.t("homework:action.parentMode"));
    expect(game.scene.ui.getMode()).toBe(UiMode.HOMEWORK_PIN);

    // Type the starting PIN and submit.
    const pinModal = game.scene.ui.getHandler() as unknown as { inputs: { text: string }[] };
    pinModal.inputs[0].text = DEFAULT_PARENT_PIN;
    game.scene.ui.getHandler().processInput(Button.SUBMIT);
    expect(game.scene.ui.getMode()).toBe(UiMode.HOMEWORK);

    // Grading is now the first option on the task, and the star list opens on top of it.
    handler.setCursor(0);
    handler.processInput(Button.ACTION);
    const taskMenu = game.scene.ui.getHandler();
    taskMenu.setCursor(0);
    taskMenu.processInput(Button.ACTION);

    // Stars run from 5 down to 1, so the first entry is a five-star grade.
    const starMenu = game.scene.ui.getHandler();
    starMenu.setCursor(0);
    starMenu.processInput(Button.ACTION);

    const data = homeworkManager.get();
    const task = data.getTask(taskId)!;
    expect(task.status).toBe(HomeworkTaskStatus.SCORED);
    expect(task.stars).toBe(5);
    // Five stars plus the day-completion, careful-day and first-streak-day bonuses.
    expect(data.stamina).toBe(STAR_STAMINA[5] + DAY_COMPLETE_BONUS + CAREFUL_DAY_BONUS + STREAK_BONUS_PER_DAY);
    expect(game.scene.ui.getMode()).toBe(UiMode.HOMEWORK);
  });

  it("returns to the planner after showing the ledger", async () => {
    const handler = await openPlanner();

    // Menu row -> "my ledger". Anything that leaves the cleared option select as the active mode
    // freezes the whole screen, so the planner must be back in charge afterwards.
    handler.processInput(Button.ACTION);
    const menu = game.scene.ui.getHandler();
    menu.setCursor(1);
    menu.processInput(Button.ACTION);

    expect(game.scene.ui.getMode()).toBe(UiMode.HOMEWORK);
    expect(handler.processInput(Button.ACTION)).toBe(true);
    expect(game.scene.ui.getMode()).toBe(UiMode.OPTION_SELECT);
  });

  it("closes the planner on cancel", async () => {
    const handler = await openPlanner();

    handler.processInput(Button.CANCEL);
    await new Promise(resolve => setTimeout(resolve, 0));

    expect(game.scene.ui.getMode()).not.toBe(UiMode.HOMEWORK);
  });

  describe("as the home screen", () => {
    /** Waits for the planner to take over, which happens after the opening cutscene. */
    async function waitForHomeScreen(): Promise<HomeworkUiHandler> {
      const deadline = Date.now() + 10000;
      while (game.scene.ui.getMode() !== UiMode.HOMEWORK) {
        if (Date.now() > deadline) {
          throw new Error(`The planner never opened; the mode is ${UiMode[game.scene.ui.getMode()]}.`);
        }
        await new Promise(resolve => setTimeout(resolve, 50));
      }
      return game.scene.ui.getHandler() as HomeworkUiHandler;
    }

    beforeEach(() => {
      // The planner replaces the title screen exactly while homework funds play.
      homeworkManager.get().gateEnabled = true;
    });

    it("is where the game lands after the title phase, with a row to set out from", async () => {
      await game.runToTitle();
      const handler = await waitForHomeScreen();

      // The first row is "set out", which opens the title options the phase handed over. It uses the
      // planner's own option mode so that "new game" can still open the game-mode list on top.
      expect(handler.processInput(Button.ACTION)).toBe(true);
      expect(game.scene.ui.getMode()).toBe(UiMode.HOMEWORK_OPTION_SELECT);
    });

    it("cannot be exited, since there is nothing behind it", async () => {
      await game.runToTitle();
      const handler = await waitForHomeScreen();

      expect(handler.processInput(Button.CANCEL)).toBe(false);
      expect(game.scene.ui.getMode()).toBe(UiMode.HOMEWORK);
    });

    it("still lists the day's tasks below the set-out row", async () => {
      const taskId = planToday();
      await game.runToTitle();
      const handler = await waitForHomeScreen();

      handler.processInput(Button.DOWN);
      handler.processInput(Button.ACTION);
      const menu = game.scene.ui.getHandler();
      menu.setCursor(0);
      menu.processInput(Button.ACTION);

      expect(homeworkManager.get().getTask(taskId)!.status).toBe(HomeworkTaskStatus.SUBMITTED);
    });
  });

  describe("the whole loop", () => {
    /** Waits for a mode that only appears after an animation or a typed-out message. */
    async function waitForMode(mode: UiMode): Promise<void> {
      const deadline = Date.now() + 10000;
      while (game.scene.ui.getMode() !== mode) {
        if (Date.now() > deadline) {
          throw new Error(`Never reached ${UiMode[mode]}; the mode is ${UiMode[game.scene.ui.getMode()]}.`);
        }
        await new Promise(resolve => setTimeout(resolve, 50));
      }
    }

    it("goes plan -> finished -> graded -> stamina -> into the game", async () => {
      const taskId = planToday("口算练习");
      homeworkManager.get().gateEnabled = true;

      await game.runToTitle();
      await waitForMode(UiMode.HOMEWORK);
      const planner = game.scene.ui.getHandler() as HomeworkUiHandler;

      // 1. The child cannot set out yet: an empty balance blocks the run.
      expect(canAffordPlay("newRun")).toBe(false);

      // 2. The child reports the task as done - still no stamina, since only a parent may grade.
      planner.setCursor(1);
      planner.processInput(Button.ACTION);
      chooseOption(0);
      expect(homeworkManager.get().getTask(taskId)!.status).toBe(HomeworkTaskStatus.SUBMITTED);
      expect(homeworkManager.get().stamina).toBe(0);

      // 3. A parent unlocks grading with the PIN.
      planner.setCursor(2);
      planner.processInput(Button.ACTION);
      chooseLabel(i18next.t("homework:action.parentMode"));
      expect(game.scene.ui.getMode()).toBe(UiMode.HOMEWORK_PIN);
      const pinModal = game.scene.ui.getHandler() as unknown as { inputs: { text: string }[] };
      pinModal.inputs[0].text = DEFAULT_PARENT_PIN;
      game.scene.ui.getHandler().processInput(Button.SUBMIT);
      expect(game.scene.ui.getMode()).toBe(UiMode.HOMEWORK);

      // 4. The parent awards five stars, which pays for a run.
      planner.setCursor(1);
      planner.processInput(Button.ACTION);
      chooseOption(0);
      chooseOption(0);
      const earned = homeworkManager.get().stamina;
      expect(earned).toBe(STAR_STAMINA[5] + DAY_COMPLETE_BONUS + CAREFUL_DAY_BONUS + STREAK_BONUS_PER_DAY);
      expect(canAffordPlay("newRun")).toBe(true);

      // 5. "Set out" -> new game -> classic actually starts the run and charges for it.
      planner.setCursor(0);
      planner.processInput(Button.ACTION);
      expect(game.scene.ui.getMode()).toBe(UiMode.HOMEWORK_OPTION_SELECT);

      // "New game" opens the game-mode list; it appears once the prompt has typed itself out.
      chooseOption(0);
      await waitForMode(UiMode.OPTION_SELECT);

      chooseOption(0); // classic
      expect(homeworkManager.get().stamina).toBe(earned - COST_NEW_RUN);

      // Starter select is what the title phase hands over to, so the run really is under way.
      await game.phaseInterceptor.to("SelectStarterPhase", false);
      expect(game.scene.gameMode.modeId).toBe(GameModes.CLASSIC);
      expect(game.scene.ui.getMode()).not.toBe(UiMode.HOMEWORK);
    });
  });

  describe("every menu action closes its loop", () => {
    it("buys a voucher in the study shop and hands control back", async () => {
      homeworkManager.get().stamina = 100;
      const handler = await openPlanner();
      const before = game.scene.gameData.voucherCounts[VoucherType.REGULAR];

      openMainMenu(handler, 0);
      chooseOption(0); // study shop
      chooseOption(0); // regular egg voucher, 60 stamina

      expect(game.scene.gameData.voucherCounts[VoucherType.REGULAR]).toBe(before + 1);
      expect(homeworkManager.get().stamina).toBe(40);
      expectPlannerAlive(handler);
    });

    it("refuses a purchase it cannot pay for without charging anything", async () => {
      homeworkManager.get().stamina = 5;
      const handler = await openPlanner();
      const before = game.scene.gameData.voucherCounts[VoucherType.REGULAR];

      openMainMenu(handler, 0);
      chooseOption(0); // study shop
      chooseOption(0); // regular egg voucher

      expect(game.scene.gameData.voucherCounts[VoucherType.REGULAR]).toBe(before);
      expect(homeworkManager.get().stamina).toBe(5);
      expectPlannerAlive(handler);
    });

    it("shows the rules and hands control back", async () => {
      const handler = await openPlanner();

      openMainMenu(handler, 0);
      chooseLabel(i18next.t("homework:action.help"));

      expectPlannerAlive(handler);
    });

    it("lets a child undo a mis-tapped submission", async () => {
      const taskId = planToday();
      const handler = await openPlanner();

      handler.setCursor(0);
      handler.processInput(Button.ACTION);
      chooseOption(0); // I finished it
      expect(homeworkManager.get().getTask(taskId)!.status).toBe(HomeworkTaskStatus.SUBMITTED);

      handler.setCursor(0);
      handler.processInput(Button.ACTION);
      chooseOption(0); // undo
      expect(homeworkManager.get().getTask(taskId)!.status).toBe(HomeworkTaskStatus.PLANNED);
      expectPlannerAlive(handler);
    });

    it("shows a graded task's result without letting the child change it", async () => {
      const taskId = planToday();
      homeworkManager.mutate(d => d.scoreTask(taskId, 4));
      const handler = await openPlanner();
      const staminaBefore = homeworkManager.get().stamina;

      handler.setCursor(0);
      handler.processInput(Button.ACTION);
      chooseOption(0); // back / show the result

      expect(homeworkManager.get().getTask(taskId)!.stars).toBe(4);
      expect(homeworkManager.get().stamina).toBe(staminaBefore);
      expectPlannerAlive(handler);
    });

    describe("the set-out menu", () => {
      /** Opens the planner as the home screen, the way the title phase does. */
      async function openHomeScreen(): Promise<HomeworkUiHandler> {
        homeworkManager.get().gateEnabled = true;
        await game.runToTitle();
        await waitForMode(UiMode.HOMEWORK);
        return game.scene.ui.getHandler() as HomeworkUiHandler;
      }

      // The save slots and the run history fade in, so their mode only lands a few hundred
      // milliseconds later; leaving one of them open would also bleed into the next test.
      afterEach(async () => {
        await game.scene.ui.setMode(UiMode.MESSAGE);
        game.scene.ui.resetModeChain();
      });

      /** Where the planner sits in the UI stack; the screens it opens must end up above it. */
      function plannerIsOnTop(handler: HomeworkUiHandler): boolean {
        const container = (handler as unknown as { mainContainer: Phaser.GameObjects.Container }).mainContainer;
        return game.scene.ui.getIndex(container) === game.scene.ui.length - 1;
      }

      it("opens the save slots and gets out of their way", async () => {
        const handler = await openHomeScreen();

        handler.setCursor(0);
        handler.processInput(Button.ACTION); // set out
        chooseOption(1); // load game
        await waitForMode(UiMode.SAVE_SLOT);

        // The planner is registered after these screens, so staying on top would bury them.
        expect(plannerIsOnTop(handler)).toBe(false);
      });

      it("opens the run history", async () => {
        const handler = await openHomeScreen();

        handler.setCursor(0);
        handler.processInput(Button.ACTION);
        chooseOption(2); // run history
        await waitForMode(UiMode.RUN_HISTORY);

        expect(plannerIsOnTop(handler)).toBe(false);
      });

      it("opens the settings", async () => {
        const handler = await openHomeScreen();

        handler.setCursor(0);
        handler.processInput(Button.ACTION);
        chooseOption(3); // settings

        expect(game.scene.ui.getMode()).toBe(UiMode.SETTINGS_GENERAL);
        expect(plannerIsOnTop(handler)).toBe(false);
      });

      it("comes back visible when the menu is cancelled", async () => {
        const handler = await openHomeScreen();

        handler.setCursor(0);
        handler.processInput(Button.ACTION);
        expect(game.scene.ui.getMode()).toBe(UiMode.HOMEWORK_OPTION_SELECT);
        chooseOption(4); // cancel

        expect(game.scene.ui.getMode()).toBe(UiMode.HOMEWORK);
        expect(plannerIsOnTop(handler)).toBe(true);
      });

      it("stays put, and visible, when a run cannot be afforded", async () => {
        const handler = await openHomeScreen();
        homeworkManager.get().stamina = 0;

        handler.setCursor(0);
        handler.processInput(Button.ACTION);
        chooseOption(0); // new game, with an empty balance

        expect(game.scene.ui.getMode()).toBe(UiMode.HOMEWORK_OPTION_SELECT);
        expect(plannerIsOnTop(handler)).toBe(true);
      });
    });

    describe("parent tools", () => {
      it("toggles the stamina gate", async () => {
        const handler = await openPlanner();
        enterParentMode(handler, 0);

        openMainMenu(handler, 0);
        chooseOption(2); // parent settings
        chooseOption(0); // toggle the gate

        expect(homeworkManager.get().gateEnabled).toBe(true);
        expectPlannerAlive(handler);
      });

      it("grants a free pass for today only", async () => {
        const handler = await openPlanner();
        enterParentMode(handler, 0);

        openMainMenu(handler, 0);
        chooseOption(2); // parent settings
        chooseOption(1); // free pass

        const data = homeworkManager.get();
        expect(data.freePassDate).toBe(todayKey());
        expect(data.hasFreePass(todayKey())).toBe(true);
        expect(data.hasFreePass(addDays(todayKey(), 1))).toBe(false);
        expectPlannerAlive(handler);
      });

      it("grants stamina", async () => {
        const handler = await openPlanner();
        enterParentMode(handler, 0);

        openMainMenu(handler, 0);
        chooseOption(2); // parent settings
        chooseOption(2); // grant stamina

        expect(homeworkManager.get().stamina).toBeGreaterThan(0);
        expectPlannerAlive(handler);
      });

      it("changes the PIN, and the old one stops working", async () => {
        const handler = await openPlanner();
        enterParentMode(handler, 0);

        openMainMenu(handler, 0);
        chooseOption(2); // parent settings
        chooseOption(3); // change PIN
        expect(game.scene.ui.getMode()).toBe(UiMode.HOMEWORK_PIN);

        const modal = game.scene.ui.getHandler() as unknown as { inputs: { text: string }[] };
        modal.inputs[0].text = "8613";
        game.scene.ui.getHandler().processInput(Button.SUBMIT);

        const data = homeworkManager.get();
        expect(data.verifyPin("8613")).toBe(true);
        expect(data.verifyPin(DEFAULT_PARENT_PIN)).toBe(false);
        expectPlannerAlive(handler);
      });

      it("rejects a PIN that is not four digits", async () => {
        const handler = await openPlanner();
        enterParentMode(handler, 0);

        openMainMenu(handler, 0);
        chooseOption(2); // parent settings
        chooseOption(3); // change PIN

        const modal = game.scene.ui.getHandler() as unknown as { inputs: { text: string }[] };
        modal.inputs[0].text = "12";
        game.scene.ui.getHandler().processInput(Button.SUBMIT);

        // Still on the modal, and the old PIN still works.
        expect(game.scene.ui.getMode()).toBe(UiMode.HOMEWORK_PIN);
        expect(homeworkManager.get().verifyPin(DEFAULT_PARENT_PIN)).toBe(true);
      });

      it("copies yesterday's plan onto today", async () => {
        homeworkManager.mutate(d =>
          d.addTask({ date: addDays(todayKey(), -1), title: "口算练习", subject: HomeworkSubject.MATH }),
        );
        const handler = await openPlanner();
        enterParentMode(handler, 0);

        openMainMenu(handler, 0);
        chooseOption(1); // copy yesterday

        expect(
          homeworkManager
            .get()
            .getTasksForDate(todayKey())
            .map(t => t.title),
        ).toEqual(["口算练习"]);
        expectPlannerAlive(handler);
      });

      it("adds a task with a title typed by hand", async () => {
        const handler = await openPlanner();
        enterParentMode(handler, 0);

        openMainMenu(handler, 0);
        chooseOption(0); // new task
        chooseOption(1); // maths
        // The template list ends with "write my own title", then cancel.
        const templates = TASK_TEMPLATES[HomeworkSubject.MATH].filter(t => t !== "custom").length;
        chooseOption(templates);
        expect(game.scene.ui.getMode()).toBe(UiMode.HOMEWORK_TASK_FORM);

        const form = game.scene.ui.getHandler() as unknown as { inputs: { text: string }[] };
        form.inputs[0].text = "第 3 单元卷子";
        game.scene.ui.getHandler().processInput(Button.SUBMIT);

        chooseOption(0); // required
        expect(
          homeworkManager
            .get()
            .getTasksForDate(todayKey())
            .map(t => t.title),
        ).toEqual(["第 3 单元卷子"]);
        expectPlannerAlive(handler);
      });

      it("turns a task optional, which drops it out of the day's requirement", async () => {
        const taskId = planToday();
        const handler = await openPlanner();
        enterParentMode(handler, 1);

        handler.setCursor(0);
        handler.processInput(Button.ACTION);
        chooseOption(1); // make optional

        expect(homeworkManager.get().getTask(taskId)!.required).toBe(false);
        expect(homeworkManager.get().getRequiredTasksForDate(todayKey())).toHaveLength(0);
        expectPlannerAlive(handler);
      });

      it("deletes a task through the confirmation", async () => {
        const taskId = planToday();
        const handler = await openPlanner();
        enterParentMode(handler, 1);

        handler.setCursor(0);
        handler.processInput(Button.ACTION);
        chooseOption(2); // delete
        expect(game.scene.ui.getMode()).toBe(UiMode.CONFIRM);
        chooseOption(0); // yes

        expect(homeworkManager.get().getTask(taskId)).toBeUndefined();
        expectPlannerAlive(handler);
      });

      it("keeps the task when the deletion is declined", async () => {
        const taskId = planToday();
        const handler = await openPlanner();
        enterParentMode(handler, 1);

        handler.setCursor(0);
        handler.processInput(Button.ACTION);
        chooseOption(2); // delete
        chooseOption(1); // no

        expect(homeworkManager.get().getTask(taskId)).toBeDefined();
        expectPlannerAlive(handler);
      });
    });
  });

  describe("stamina gate", () => {
    it("blocks a new run until enough homework stamina has been earned", async () => {
      await game.runToTitle();
      homeworkManager.get().gateEnabled = true;

      expect(canAffordPlay("newRun")).toBe(false);
      expect(tryPayToPlay("newRun")).toBe(false);
      expect(homeworkManager.get().stamina).toBe(0);

      homeworkManager.mutate(d => d.earn(COST_NEW_RUN + 5, "parentGrant"));

      expect(canAffordPlay("newRun")).toBe(true);
      expect(tryPayToPlay("newRun")).toBe(true);
      expect(homeworkManager.get().stamina).toBe(5);
    });

    it("lets everything through while the gate is off", async () => {
      await game.runToTitle();

      expect(homeworkManager.get().gateEnabled).toBe(false);
      expect(canAffordPlay("newRun")).toBe(true);
      expect(tryPayToPlay("newRun")).toBe(true);
      expect(homeworkManager.get().stamina).toBe(0);
    });

    it("charges the wave toll only when a toll wave is reached", async () => {
      await game.classicMode.startBattle(SpeciesId.MAGIKARP);
      homeworkManager.get().gateEnabled = true;
      homeworkManager.mutate(d => d.earn(COST_WAVE_TOLL, "parentGrant"));

      // Mid-interval waves are already paid for.
      game.scene.currentBattle.waveIndex = WAVE_TOLL_INTERVAL - 5;
      expect(tryPayWaveToll()).toBe(true);
      expect(homeworkManager.get().stamina).toBe(COST_WAVE_TOLL);

      // Crossing into the next interval costs a toll.
      game.scene.currentBattle.waveIndex = WAVE_TOLL_INTERVAL;
      expect(tryPayWaveToll()).toBe(true);
      expect(homeworkManager.get().stamina).toBe(0);
    });

    it("stops the run instead of continuing when the toll cannot be paid", async () => {
      await game.classicMode.startBattle(SpeciesId.MAGIKARP);
      homeworkManager.get().gateEnabled = true;
      game.scene.currentBattle.waveIndex = WAVE_TOLL_INTERVAL;

      expect(homeworkManager.get().stamina).toBe(0);
      expect(tryPayWaveToll()).toBe(false);
    });
  });
});
