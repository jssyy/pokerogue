import { pokerogueApi } from "#api/api";
import { updateUserInfo } from "#app/account";
import { globalScene } from "#app/global-scene";
import { Button } from "#enums/buttons";
import type { HomeworkSubject } from "#enums/homework-subject";
import { HomeworkTaskStatus } from "#enums/homework-task-status";
import { TextStyle } from "#enums/text-style";
import { UiMode } from "#enums/ui-mode";
import { bugLogSize, downloadBugLog } from "#system/bug-log";
import {
  creditStamina,
  currentAccountName,
  isParentAccount,
  isParentSession,
  isSignedIn,
  listChildren,
  usesPinForParentMode,
} from "#system/family-session";
import {
  COST_NEW_RUN,
  COST_RESUME_RUN,
  COST_WAVE_TOLL,
  GUIDE_URL,
  MAX_STARS,
  PARENT_PIN_LENGTH,
  STAMINA_BAR_REFERENCE,
  STAR_STAMINA,
  SUBJECT_ORDER,
  TASK_TEMPLATES,
  WAVE_TOLL_INTERVAL,
} from "#system/homework-config";
import { addDays, formatDateLabel, getWeekdayLabel, parseDateKey, startOfWeek, todayKey } from "#system/homework-date";
import { getPlayCost } from "#system/homework-gate";
import { homeworkManager } from "#system/homework-manager";
import { HOMEWORK_SHOP_ITEMS, purchaseShopItem } from "#system/homework-shop";
import type { HomeworkDateKey, HomeworkTask, StarRating } from "#types/homework-types";
import type { OptionSelectItem } from "#types/ui-types";
import type { HomeworkPinFormUiHandler } from "#ui/homework-pin-form-ui-handler";
import { MessageUiHandler } from "#ui/message-ui-handler";
import { addTextObject, getTextColor } from "#ui/text";
import { addWindow } from "#ui/ui-theme";
import i18next from "i18next";

/** How many list rows are on screen at once. */
const VISIBLE_ROWS = 6;

/** Pixel height of a single list row. */
const ROW_HEIGHT = 15;

/** Days shown in the week strip. */
const WEEK_LENGTH = 7;

/** Stamina a parent hands over per "grant" tap. */
const PARENT_GRANT_AMOUNT = 50;

/** Rows an option menu may show before it starts scrolling, so it always fits on screen. */
const MAX_MENU_ROWS = 6;

/** Size of the stamina gauge in the header. */
const GAUGE_WIDTH = 74;
const GAUGE_HEIGHT = 4;

/** Gauge colours: out of reach of a run, enough for a run, and a comfortable balance. */
const GAUGE_EMPTY_COLOR = 0xe04c4c;
const GAUGE_LOW_COLOR = 0xf0a92c;
const GAUGE_FULL_COLOR = 0x78c850;

/** The list entry that opens the action menu, appended after the day's tasks. */
interface MenuEntry {
  kind: "menu";
}

interface TaskEntry {
  kind: "task";
  task: HomeworkTask;
}

/** The "set out" row, shown first while the planner stands in for the title screen. */
interface PlayEntry {
  kind: "play";
}

type HomeworkEntry = PlayEntry | TaskEntry | MenuEntry;

/**
 * The homework planner: the child's view of their plan and stamina, and - behind a parent PIN - the
 * screen where a parent plans tasks and grades them.
 */
export class HomeworkUiHandler extends MessageUiHandler {
  private mainContainer: Phaser.GameObjects.Container;

  private headerBg: Phaser.GameObjects.NineSlice;
  private titleText: Phaser.GameObjects.Text;
  private staminaText: Phaser.GameObjects.Text;
  private streakText: Phaser.GameObjects.Text;
  private gaugeBg: Phaser.GameObjects.Rectangle;
  private gaugeFill: Phaser.GameObjects.Rectangle;
  /** Tick on the gauge marking what one new run costs. */
  private gaugeMark: Phaser.GameObjects.Rectangle;

  private weekdayTexts: Phaser.GameObjects.Text[] = [];
  private dayTexts: Phaser.GameObjects.Text[] = [];
  private dayCursor: Phaser.GameObjects.NineSlice;

  private rowLabels: Phaser.GameObjects.Text[] = [];
  private rowValues: Phaser.GameObjects.Text[] = [];
  private rowCursor: Phaser.GameObjects.Image;
  /** Shown across the empty list area, so a day with no plan still says what to do. */
  private emptyText: Phaser.GameObjects.Text;

  /** The day whose tasks are listed. */
  private selectedDate: HomeworkDateKey = todayKey();
  private entries: HomeworkEntry[] = [];
  private scrollOffset = 0;

  /** Whether a parent has unlocked grading and planning for this visit. */
  /**
   * Whether the PIN was entered during this visit.
   *
   * Only consulted when playing without an account. Signed in, the role on the account decides, so
   * a child never has a PIN prompt to try in the first place - see {@linkcode parentMode}.
   */
  private pinUnlocked = false;

  /** Whether the parent tools are available right now. */
  private get parentMode(): boolean {
    return isParentSession(this.pinUnlocked);
  }

  /**
   * The title-screen options handed over by {@linkcode TitlePhase} when the planner is standing in
   * for the title screen, or `null` when it was opened as a sub-screen.
   */
  private playOptions: OptionSelectItem[] | null = null;

  /**
   * How many option menus / modals are stacked on top of the planner.
   *
   * @remarks
   * Also used to alternate between two option-select modes: a menu opened from a menu must not be
   * the same handler instance, because the instance clears itself after its handler runs and would
   * wipe the menu it just opened.
   */
  private menuDepth = 0;

  public setup(): void {
    const ui = this.getUi();
    const width = globalScene.scaledCanvas.width;
    const height = globalScene.scaledCanvas.height;

    this.mainContainer = globalScene.add
      .container(1, -height + 1)
      .setName("homework")
      .setInteractive(new Phaser.Geom.Rectangle(0, 0, width, height), Phaser.Geom.Rectangle.Contains);

    // #region Header
    this.headerBg = addWindow(0, 0, width - 2, 26);
    this.titleText = addTextObject(8, 2, i18next.t("homework:name"), TextStyle.HEADER_LABEL).setOrigin(0);
    this.staminaText = addTextObject(width - 10, 2, "", TextStyle.MONEY, { fontSize: "72px" }).setOrigin(1, 0);
    // Second header line carries the two numbers that answer "am I keeping this up?".
    this.streakText = addTextObject(8, 15, "", TextStyle.WINDOW, { fontSize: "54px" }).setOrigin(0);

    // A bar rather than a bare number: the child should be able to see at a glance whether they can
    // afford to set out, without doing arithmetic against the costs.
    const gaugeX = width - 10 - GAUGE_WIDTH;
    this.gaugeBg = globalScene.add.rectangle(gaugeX, 16, GAUGE_WIDTH, GAUGE_HEIGHT, 0x1c1c2b).setOrigin(0);
    this.gaugeFill = globalScene.add.rectangle(gaugeX, 16, 0, GAUGE_HEIGHT, 0x78c850).setOrigin(0);
    this.gaugeMark = globalScene.add
      .rectangle(
        gaugeX + Math.round((GAUGE_WIDTH * COST_NEW_RUN) / STAMINA_BAR_REFERENCE),
        15,
        1,
        GAUGE_HEIGHT + 2,
        0xf8f8f8,
      )
      .setOrigin(0)
      .setAlpha(0.7);

    this.mainContainer.add([
      this.headerBg,
      this.titleText,
      this.staminaText,
      this.streakText,
      this.gaugeBg,
      this.gaugeFill,
      this.gaugeMark,
    ]);
    // #endregion Header

    // #region Week strip
    const weekBg = addWindow(0, 26, width - 2, 22);
    this.mainContainer.add(weekBg);

    const cellWidth = Math.floor((width - 10) / WEEK_LENGTH);
    for (let day = 0; day < WEEK_LENGTH; day++) {
      const centerX = 5 + day * cellWidth + cellWidth / 2;
      const weekdayText = addTextObject(centerX, 28, "", TextStyle.WINDOW, { fontSize: "54px" }).setOrigin(0.5, 0);
      const dayText = addTextObject(centerX, 37, "", TextStyle.WINDOW, { fontSize: "54px" }).setOrigin(0.5, 0);
      this.weekdayTexts.push(weekdayText);
      this.dayTexts.push(dayText);
      this.mainContainer.add([weekdayText, dayText]);
    }

    this.dayCursor = globalScene.add
      .nineslice(0, 28, "select_cursor_highlight", undefined, cellWidth, 18, 1, 1, 1, 1)
      .setOrigin(0);
    this.mainContainer.add(this.dayCursor);
    // #endregion Week strip

    // #region Task list
    const listBg = addWindow(0, 48, width - 2, 96);
    this.mainContainer.add(listBg);

    for (let row = 0; row < VISIBLE_ROWS; row++) {
      const y = 52 + row * ROW_HEIGHT;
      const label = addTextObject(16, y, "", TextStyle.WINDOW, { fontSize: "72px" }).setOrigin(0);
      const value = addTextObject(width - 12, y, "", TextStyle.WINDOW, { fontSize: "72px" }).setOrigin(1, 0);
      this.rowLabels.push(label);
      this.rowValues.push(value);
      this.mainContainer.add([label, value]);
    }

    this.emptyText = addTextObject(width / 2, 88, "", TextStyle.SUMMARY_GRAY, {
      fontSize: "72px",
      align: "center",
    }).setOrigin(0.5, 0);
    this.mainContainer.add(this.emptyText);

    // The arrow the rest of the game uses for list selection. A stretched highlight frame reads as
    // stray brackets at this row width, so it is not used here.
    this.rowCursor = globalScene.add.image(6, 0, "cursor").setOrigin(0);
    this.mainContainer.add(this.rowCursor);
    // #endregion Task list

    // #region Footer
    const footerBg = addWindow(0, 144, width - 2, 34);
    this.message = addTextObject(8, 148, "", TextStyle.WINDOW, { fontSize: "60px", maxLines: 3 }).setWordWrapWidth(
      1820,
    );
    this.mainContainer.add([footerBg, this.message]);
    // #endregion Footer

    ui.add(this.mainContainer);
    this.mainContainer.setVisible(false);
  }

  public override show(args: any[]): boolean {
    super.show(args);

    this.playOptions = (args[0] as { playOptions?: OptionSelectItem[] } | undefined)?.playOptions ?? null;
    // Every visit starts as the child. Parent rights are re-earned with the PIN each time, so they
    // cannot leak into a later visit that reused this handler without it being cleared in between.
    this.pinUnlocked = false;
    this.selectedDate = todayKey();
    this.scrollOffset = 0;
    // Entering the planner always starts from a bare screen: if a previous visit was torn down with
    // menus still open, a stale depth would make the next menu reuse the handler that is about to
    // clear itself.
    this.menuDepth = 0;
    this.bringPlannerToFront();
    this.getUi().hideTooltip();

    this.refresh();
    this.setCursor(0);
    this.showHint();

    return true;
  }

  public override clear(): void {
    super.clear();
    // Parent rights never outlive one visit to the planner.
    this.pinUnlocked = false;
    this.playOptions = null;
    this.menuDepth = 0;
    this.mainContainer.setVisible(false);
    this.showText("", 0);
  }

  // #region Rendering

  /** Rebuilds the entry list and repaints every part of the screen. */
  private refresh(): void {
    const data = homeworkManager.get();

    this.entries = [
      ...(this.isHomeScreen() ? [{ kind: "play" } as PlayEntry] : []),
      ...data.getTasksForDate(this.selectedDate).map<TaskEntry>(task => ({ kind: "task", task })),
      { kind: "menu" },
    ];

    if (this.cursor >= this.entries.length) {
      this.cursor = this.entries.length - 1;
    }
    this.clampScroll();

    this.titleText.setText(
      this.parentMode
        ? `${i18next.t("homework:name")}　${i18next.t("homework:action.parentMode")}`
        : i18next.t("homework:name"),
    );
    this.staminaText.setText(i18next.t("homework:staminaValue", { amount: data.stamina }));
    this.refreshGauge(data.stamina);

    const streak = data.getStreak();
    const pending = data.getTasksAwaitingGrading().length;
    const required = data.getRequiredTasksForDate(this.selectedDate);
    const graded = required.filter(t => t.status === HomeworkTaskStatus.SCORED).length;

    const parts = [
      required.length > 0
        ? i18next.t("homework:dayProgress", { done: graded, total: required.length })
        : i18next.t("homework:noPlan"),
      streak > 0 ? i18next.t("homework:streakDays", { days: streak }) : i18next.t("homework:noStreak"),
    ];
    if (pending > 0) {
      parts.push(i18next.t("homework:pendingBadge", { amount: pending }));
    }
    this.streakText.setText(parts.join("　"));

    this.refreshWeekStrip();
    this.refreshRows();
    this.updateCursorPositions();
  }

  /** Repaints the stamina gauge, colour-coded against what a run actually costs. */
  private refreshGauge(stamina: number): void {
    const filled = Math.min(1, stamina / STAMINA_BAR_REFERENCE);
    this.gaugeFill.width = Math.round(GAUGE_WIDTH * filled);
    this.gaugeFill.fillColor =
      stamina < COST_NEW_RUN
        ? GAUGE_EMPTY_COLOR
        : stamina < STAMINA_BAR_REFERENCE / 2
          ? GAUGE_LOW_COLOR
          : GAUGE_FULL_COLOR;
  }

  private refreshWeekStrip(): void {
    const data = homeworkManager.get();
    const weekStart = startOfWeek(this.selectedDate);
    const today = todayKey();

    for (let day = 0; day < WEEK_LENGTH; day++) {
      const date = addDays(weekStart, day);
      const tasks = data.getTasksForDate(date);
      const style = data.isDayComplete(date)
        ? TextStyle.SUMMARY_GREEN
        : tasks.some(t => t.status === HomeworkTaskStatus.SUBMITTED)
          ? TextStyle.SUMMARY_GOLD
          : tasks.length > 0
            ? TextStyle.WINDOW
            : TextStyle.SUMMARY_GRAY;

      this.weekdayTexts[day].setText(getWeekdayLabel(date));
      this.dayTexts[day]
        .setText(date === today ? `[${parseDateKey(date).getDate()}]` : `${parseDateKey(date).getDate()}`)
        .setColor(getTextColor(style))
        .setShadowColor(getTextColor(style, true));
    }
  }

  private refreshRows(): void {
    const hasTasks = this.entries.some(entry => entry.kind === "task");
    this.emptyText
      .setText(hasTasks ? "" : i18next.t(this.parentMode ? "homework:emptyDayParent" : "homework:emptyDayChild"))
      .setVisible(!hasTasks);

    for (let row = 0; row < VISIBLE_ROWS; row++) {
      const entry = this.entries[row + this.scrollOffset];
      const label = this.rowLabels[row];
      const value = this.rowValues[row];

      if (entry == null) {
        label.setText("");
        value.setText("");
        continue;
      }

      if (entry.kind === "menu") {
        label.setText(i18next.t("homework:action.menu"));
        this.applyRowStyle(label, TextStyle.SUMMARY_BLUE);
        value.setText("");
        continue;
      }

      if (entry.kind === "play") {
        const cost = getPlayCost("newRun");
        const missing = homeworkManager.get().missingStamina(cost);
        label.setText(i18next.t("homework:action.play"));
        this.applyRowStyle(label, missing > 0 ? TextStyle.SUMMARY_GRAY : TextStyle.SUMMARY_GOLD);
        value.setText(
          missing > 0 ? i18next.t("homework:play.blocked", { missing }) : i18next.t("homework:play.ready", { cost }),
        );
        this.applyRowStyle(value, missing > 0 ? TextStyle.SUMMARY_RED : TextStyle.SUMMARY_GOLD);
        continue;
      }

      const { task } = entry;
      const subject = i18next.t(`homework:subject.${task.subject}`);
      const optionalTag = task.required ? "" : `（${i18next.t("homework:optionalTag")}）`;
      label.setText(`${subject}・${task.title}${optionalTag}`);
      this.applyRowStyle(label, task.required ? TextStyle.WINDOW : TextStyle.SUMMARY_GRAY);

      switch (task.status) {
        case HomeworkTaskStatus.PLANNED:
          value.setText(i18next.t("homework:status.planned"));
          this.applyRowStyle(value, TextStyle.SUMMARY_GRAY);
          break;
        case HomeworkTaskStatus.SUBMITTED:
          value.setText(i18next.t("homework:status.submitted"));
          this.applyRowStyle(value, TextStyle.SUMMARY_GOLD);
          break;
        case HomeworkTaskStatus.SCORED:
          value.setText("★".repeat(task.stars ?? 0));
          this.applyRowStyle(value, TextStyle.SUMMARY_GREEN);
          break;
      }
    }
  }

  private applyRowStyle(text: Phaser.GameObjects.Text, style: TextStyle): void {
    text.setColor(getTextColor(style)).setShadowColor(getTextColor(style, true));
  }

  private updateCursorPositions(): void {
    const cellWidth = this.dayCursor.width;
    const weekStart = startOfWeek(this.selectedDate);
    const dayIndex = Math.max(0, Math.min(WEEK_LENGTH - 1, this.daysFromWeekStart(weekStart)));
    this.dayCursor.setX(5 + dayIndex * cellWidth);
    this.rowCursor.setY(53 + (this.cursor - this.scrollOffset) * ROW_HEIGHT);
  }

  private daysFromWeekStart(weekStart: HomeworkDateKey): number {
    for (let day = 0; day < WEEK_LENGTH; day++) {
      if (addDays(weekStart, day) === this.selectedDate) {
        return day;
      }
    }
    return 0;
  }

  /** Puts the planner back on top of everything else in the UI stack. */
  private bringPlannerToFront(): void {
    this.mainContainer.setVisible(true);
    this.getUi().moveTo(this.mainContainer, this.getUi().length - 1);
  }

  /** Drops the planner to the bottom so a screen opened on top of it is actually visible. */
  private sendPlannerToBack(): void {
    this.getUi().moveTo(this.mainContainer, 0);
  }

  /** Whether the planner is standing in for the title screen. */
  private isHomeScreen(): boolean {
    return this.playOptions != null;
  }

  /** Restores the footer to the navigation hint for the current mode. */
  private showHint(): void {
    const data = homeworkManager.get();
    const hint = this.parentMode
      ? "homework:hint.parent"
      : this.isHomeScreen()
        ? "homework:hint.home"
        : "homework:hint.child";
    const parts = [i18next.t(hint)];

    if (!data.isGateActive()) {
      parts.push(i18next.t("homework:gateOffNotice"));
    }

    this.showText(parts.join("\n"), 0);
  }

  // #endregion Rendering

  // #region Input

  public override processInput(button: Button): boolean {
    const ui = this.getUi();
    // Control can come back from a screen that reverted onto the planner without going through
    // `show`, so make sure the planner is on top again before it accepts input.
    this.bringPlannerToFront();
    let success = false;

    switch (button) {
      case Button.UP:
        success = this.moveCursor(-1);
        break;
      case Button.DOWN:
        success = this.moveCursor(1);
        break;
      case Button.LEFT:
        success = this.changeDate(-1);
        break;
      case Button.RIGHT:
        success = this.changeDate(1);
        break;
      case Button.ACTION:
        success = this.activateEntry();
        break;
      case Button.CANCEL:
        // As the home screen there is nothing behind the planner to go back to.
        if (this.isHomeScreen()) {
          return false;
        }
        ui.revertMode();
        success = true;
        break;
    }

    if (success) {
      ui.playSelect();
    }

    return success;
  }

  private moveCursor(delta: number): boolean {
    const next = this.cursor + delta;
    if (next < 0 || next >= this.entries.length) {
      return false;
    }
    return this.setCursor(next);
  }

  public override setCursor(cursor: number): boolean {
    const changed = super.setCursor(cursor);
    this.clampScroll();
    this.refreshRows();
    this.updateCursorPositions();
    return changed;
  }

  private clampScroll(): void {
    const maxOffset = Math.max(0, this.entries.length - VISIBLE_ROWS);
    this.scrollOffset = Math.min(Math.max(this.scrollOffset, this.cursor - VISIBLE_ROWS + 1), this.cursor);
    this.scrollOffset = Math.max(0, Math.min(this.scrollOffset, maxOffset));
  }

  private changeDate(delta: number): boolean {
    this.selectedDate = addDays(this.selectedDate, delta);
    this.cursor = 0;
    this.scrollOffset = 0;
    this.refresh();
    this.showHint();
    return true;
  }

  private activateEntry(): boolean {
    const entry = this.entries[this.cursor];
    if (entry == null) {
      return false;
    }
    if (entry.kind === "play") {
      this.openPlayMenu();
      return true;
    }
    if (entry.kind === "menu") {
      this.openMainMenu();
      return true;
    }
    return this.openTaskMenu(entry.task);
  }

  /**
   * Opens the title-screen options the phase handed over.
   *
   * @remarks
   * The options are used verbatim, so starting a run, loading a save and the stamina charge all keep
   * behaving exactly as they do on the normal title screen.
   */
  private openPlayMenu(): void {
    if (this.playOptions == null) {
      return;
    }
    this.showText(i18next.t("homework:hint.home"), 0);

    // These options open screens owned by the title phase - the save slots, run history, settings.
    // The planner is registered late, so its container sits above all of them and would bury them.
    // Dropping it to the bottom of the stack lets them through while keeping the planner on screen,
    // so coming back from one of them does not land the player on an empty background.
    const options = this.playOptions.map<OptionSelectItem>(option => ({
      ...option,
      handler: () => {
        this.sendPlannerToBack();
        const handled = option.handler();
        if (!handled) {
          // Turned away (not enough stamina): the planner keeps the screen.
          this.bringPlannerToFront();
        }
        return handled;
      },
    }));

    // Deliberately not the plain option-select mode: picking "new game" opens the game-mode list on
    // `UiMode.OPTION_SELECT`, and `setOverlayMode` does nothing when that mode is already active -
    // which would leave this menu cleared and the whole screen unresponsive.
    this.openMenu([...options, this.cancelOption()], UiMode.HOMEWORK_OPTION_SELECT);
  }

  // #endregion Input

  // #region Menu plumbing

  /**
   * Opens an option menu above the planner.
   *
   * Alternates between two option-select modes so that a menu opened from another menu never reuses
   * the handler instance that is about to clear itself.
   */
  private openMenu(options: OptionSelectItem[], forcedMode?: UiMode): void {
    const mode = forcedMode ?? (this.menuDepth % 2 === 0 ? UiMode.OPTION_SELECT : UiMode.HOMEWORK_OPTION_SELECT);
    this.menuDepth++;
    // Option windows are anchored to the bottom right and grow upwards at 16px per row, so anything
    // past `MAX_MENU_ROWS` would run off the top of the screen; longer lists scroll instead.
    this.getUi().setOverlayMode(mode, { options, maxOptions: MAX_MENU_ROWS });
  }

  /** Closes every stacked menu / modal and returns to the planner. */
  private closeMenus(): void {
    const ui = this.getUi();
    while (this.menuDepth > 0) {
      ui.revertMode();
      this.menuDepth--;
    }
    // A play option may have dropped the planner behind another screen.
    this.bringPlannerToFront();
  }

  /** A trailing "cancel" option, which is also what the cancel button triggers. */
  private cancelOption(label = i18next.t("homework:action.cancel")): OptionSelectItem {
    return {
      label,
      handler: () => {
        this.closeMenus();
        this.showHint();
        return true;
      },
    };
  }

  /** Runs an action after closing the menus, then repaints the planner. */
  private menuAction(label: string, action: () => void): OptionSelectItem {
    return {
      label,
      handler: () => {
        this.closeMenus();
        action();
        this.refresh();
        return true;
      },
    };
  }

  // #endregion Menu plumbing

  // #region Main menu

  private openMainMenu(): void {
    const options: OptionSelectItem[] = [];

    if (this.parentMode) {
      options.push(
        {
          label: i18next.t("homework:action.addTask"),
          handler: () => {
            this.openSubjectMenu();
            return true;
          },
        },
        this.menuAction(i18next.t("homework:action.copyYesterday"), () => this.copyYesterday()),
        {
          label: i18next.t("homework:action.parentSettings"),
          handler: () => {
            this.openParentSettings();
            return true;
          },
        },
      );
    }
    if (isParentAccount()) {
      options.push({
        label: i18next.t("homework:sync.switchChild"),
        handler: () => {
          void this.openChildPicker();
          return true;
        },
      });
    }

    options.push(
      {
        label: i18next.t("homework:action.shop"),
        handler: () => {
          this.openShop();
          return true;
        },
      },
      // Every option handler must either close the menus or open another overlay; one that does
      // neither leaves the cleared option select as the active mode, which freezes the planner.
      this.menuAction(i18next.t("homework:action.ledger"), () => this.showLedger()),
      this.menuAction(i18next.t("homework:action.guide"), () => {
        window.open(GUIDE_URL, "_blank")?.focus();
        // Said out loud because a blocked pop-up otherwise looks like the option did nothing.
        this.showText(i18next.t("homework:guide.opened"), 0);
      }),
      this.menuAction(i18next.t("homework:action.help"), () => this.showText(i18next.t("homework:help.text"), 0)),
    );

    // With an account, this is the only way to hand the screen to somebody else: a parent needs it to
    // grade on the child's device, and a second child needs it to reach their own plan. Without an
    // account there is nobody to sign out of.
    if (isSignedIn()) {
      options.push({
        label: i18next.t("homework:sync.signOut"),
        handler: () => {
          this.confirmSignOut();
          return true;
        },
      });
    }

    // Signed in, the account settles this and there is nothing to enter or leave: a parent already
    // has the tools, and a child is never shown a way in to try. The PIN rows belong to the
    // account-less mode, which has to keep working with no server reachable.
    if (usesPinForParentMode()) {
      if (this.pinUnlocked) {
        options.push(
          this.menuAction(i18next.t("homework:action.exitParentMode"), () => {
            this.pinUnlocked = false;
            this.showText(i18next.t("homework:parent.modeOff"), 0);
          }),
        );
      } else {
        options.push({
          label: i18next.t("homework:action.parentMode"),
          handler: () => {
            this.requestParentMode();
            return true;
          },
        });
      }
    }

    options.push(this.cancelOption());
    this.openMenu(options);
  }

  /**
   * Signs the current account out and returns to the sign-in screen.
   *
   * Asked first, and worded to say what does not get lost: the fear this whole account system exists
   * to remove is a child believing they have thrown their week away by tapping the wrong row.
   */
  private confirmSignOut(): void {
    const ui = this.getUi();
    this.menuDepth++;
    ui.setOverlayMode(
      UiMode.CONFIRM,
      () => {
        this.closeMenus();
        void this.signOut();
      },
      () => {
        this.closeMenus();
        this.showHint();
      },
    );
    this.showText(i18next.t("homework:sync.signOutConfirm", { name: currentAccountName() ?? "" }), 0);
  }

  /** Pushes anything still pending, then drops the session and resets back to sign-in. */
  private async signOut(): Promise<void> {
    // The plan is written on a delay, so a grade given moments ago may not have left yet, and after
    // the session is gone there is no account to send it to.
    await homeworkManager.flushPush();
    await pokerogueApi.account.logout();
    await updateUserInfo();
    homeworkManager.invalidate();
    globalScene.reset(true, true);
  }

  // #endregion Main menu

  // #region Child actions

  private openTaskMenu(task: HomeworkTask): boolean {
    const options: OptionSelectItem[] = [];

    if (this.parentMode) {
      options.push(
        {
          label: i18next.t("homework:action.grade"),
          handler: () => {
            this.openGradeMenu(task);
            return true;
          },
        },
        this.menuAction(
          i18next.t(task.required ? "homework:action.makeOptional" : "homework:action.makeRequired"),
          () => {
            homeworkManager.mutate(d => d.setTaskRequired(task.id, !task.required));
            this.showText(
              i18next.t(task.required ? "homework:prompt.madeOptional" : "homework:prompt.madeRequired"),
              0,
            );
          },
        ),
        {
          label: i18next.t("homework:action.delete"),
          handler: () => {
            this.confirmDelete(task);
            return true;
          },
        },
      );
    } else if (task.status === HomeworkTaskStatus.PLANNED) {
      options.push(
        this.menuAction(i18next.t("homework:action.markDone"), () => {
          homeworkManager.mutate(d => d.submitTask(task.id));
          this.showText(i18next.t("homework:prompt.submitted"), 0);
        }),
      );
    } else if (task.status === HomeworkTaskStatus.SUBMITTED) {
      options.push(
        this.menuAction(i18next.t("homework:action.withdraw"), () => {
          homeworkManager.mutate(d => d.withdrawTask(task.id));
          this.showText(i18next.t("homework:prompt.withdrawn"), 0);
        }),
      );
    } else {
      options.push(
        this.menuAction(i18next.t("homework:action.back"), () => {
          this.showText(this.describeScoredTask(task), 0);
        }),
      );
    }

    options.push(this.cancelOption());
    this.showText(i18next.t("homework:prompt.taskActions", { title: task.title }), 0);
    this.openMenu(options);
    return true;
  }

  private describeScoredTask(task: HomeworkTask): string {
    const summary = i18next.t("homework:prompt.scoredInfo", {
      title: task.title,
      stars: "★".repeat(task.stars ?? 0),
      amount: task.awarded ?? 0,
    });
    return task.note ? `${summary}\n${task.note}` : summary;
  }

  // #endregion Child actions

  // #region Parent actions

  private requestParentMode(): void {
    const ui = this.getUi();
    const data = homeworkManager.get();
    const pinHandler = ui.handlers[UiMode.HOMEWORK_PIN] as HomeworkPinFormUiHandler;

    this.menuDepth++;
    ui.setOverlayMode(UiMode.HOMEWORK_PIN, {
      buttonActions: [
        (pin: string) => {
          if (!data.verifyPin(pin)) {
            ui.playError();
            pinHandler.clearInput();
            pinHandler.setError(i18next.t("homework:parent.pinWrong"));
            return;
          }
          this.closeMenus();
          this.pinUnlocked = true;
          this.refresh();
          this.showText(
            data.hasCustomPin()
              ? i18next.t("homework:parent.modeOn")
              : `${i18next.t("homework:parent.modeOn")}\n${i18next.t("homework:parent.pinDefaultHint")}`,
            0,
          );
        },
        () => {
          this.closeMenus();
          this.showHint();
        },
      ],
      errorMessage: data.hasCustomPin() ? undefined : i18next.t("homework:parent.pinDefaultHint"),
    });
  }

  private openGradeMenu(task: HomeworkTask): void {
    const options: OptionSelectItem[] = [];
    for (let stars = MAX_STARS; stars >= 1; stars--) {
      const rating = stars as StarRating;
      options.push(
        this.menuAction(
          i18next.t("homework:prompt.starOption", { stars: "★".repeat(rating), amount: STAR_STAMINA[rating] }),
          () => this.gradeTask(task, rating),
        ),
      );
    }
    options.push(this.cancelOption());

    this.showText(i18next.t("homework:prompt.selectStars", { title: task.title }), 0);
    this.openMenu(options);
  }

  private gradeTask(task: HomeworkTask, stars: StarRating): void {
    // The rules engine stays on the client - it is where the tuning table lives - but the number it
    // produces has to be countersigned. The local total moves first so the parent sees the result at
    // once, and the difference is then sent up; if that fails, the next sync overwrites the local
    // total with the service's, which rolls the optimistic gain back on its own.
    const before = homeworkManager.get().totalEarned;
    const result = homeworkManager.mutate(d => d.scoreTask(task.id, stars));
    if (result == null) {
      return;
    }
    void this.countersignGrade(homeworkManager.get().totalEarned - before, stars);

    const starText = "★".repeat(stars);
    const lines = [
      result.regraded
        ? i18next.t("homework:prompt.regraded", { stars: starText, amount: result.taskStamina })
        : i18next.t(result.late ? "homework:prompt.scoredLate" : "homework:prompt.scored", {
            title: task.title,
            stars: starText,
            amount: result.taskStamina,
          }),
    ];

    if (result.bonusStamina > 0) {
      lines.push(i18next.t("homework:prompt.dayBonus", { amount: result.bonusStamina, days: result.streak }));
    }

    this.showText(lines.join("\n"), 0);
  }

  /**
   * Lets a parent choose which child's plan the planner is showing.
   *
   * A parent's own plan is empty - they are not the one doing the homework - so a parent session
   * always works on a child's, and this is how they pick.
   */
  private async openChildPicker(): Promise<void> {
    const children = await listChildren();
    if (children == null) {
      this.closeMenus();
      this.showText(i18next.t("homework:sync.offline"), 0);
      return;
    }
    const usable = children.filter(child => !child.disabled);
    if (usable.length === 0) {
      this.closeMenus();
      this.showText(i18next.t("homework:sync.noChildren"), 0);
      return;
    }
    this.openMenu([
      ...usable.map(child =>
        this.menuAction(child.displayName, () => {
          void this.switchToChild(child.id, child.displayName);
        }),
      ),
      this.cancelOption(),
    ]);
  }

  private async switchToChild(childId: number, name: string): Promise<void> {
    const ok = await homeworkManager.viewChild(childId);
    this.refresh();
    this.showText(i18next.t(ok ? "homework:sync.switched" : "homework:sync.offline", { name }), 0);
  }

  /**
   * Records the award with the family service, which is the only place it counts.
   *
   * Nothing happens when playing without an account: there is no service to countersign anything,
   * and the PIN is doing the job the sign-in would have.
   */
  private async countersignGrade(amount: number, stars: StarRating): Promise<void> {
    const child = homeworkManager.viewingChild;
    if (!isSignedIn() || child == null || amount <= 0) {
      return;
    }
    const earned = await creditStamina(child, amount, `grade:${stars}star`);
    if (earned == null) {
      // Said out loud, because the balance on screen is now ahead of the one that will survive.
      this.showText(i18next.t("homework:sync.creditFailed"), 0);
      return;
    }
    homeworkManager.applyRemote({ data: null, earned });
    this.refresh();
  }

  private confirmDelete(task: HomeworkTask): void {
    const ui = this.getUi();
    this.menuDepth++;
    ui.setOverlayMode(
      UiMode.CONFIRM,
      () => {
        this.closeMenus();
        homeworkManager.mutate(d => d.removeTask(task.id));
        this.refresh();
        this.showText(i18next.t("homework:prompt.deleted"), 0);
      },
      () => {
        this.closeMenus();
        this.showHint();
      },
    );
    this.showText(i18next.t("homework:prompt.confirmDelete", { title: task.title }), 0);
  }

  private copyYesterday(): void {
    const source = addDays(this.selectedDate, -1);
    const copied = homeworkManager.mutate(d => d.copyDay(source, this.selectedDate));
    const date = formatDateLabel(source);
    this.showText(
      copied > 0
        ? i18next.t("homework:prompt.copied", { amount: copied, date })
        : i18next.t("homework:prompt.nothingToCopy", { date }),
      0,
    );
  }

  // #endregion Parent actions

  // #region Task creation

  private openSubjectMenu(): void {
    const options = SUBJECT_ORDER.map<OptionSelectItem>(subject => ({
      label: i18next.t(`homework:subject.${subject}`),
      handler: () => {
        this.openTemplateMenu(subject);
        return true;
      },
    }));
    options.push(this.cancelOption());

    this.showText(i18next.t("homework:form.selectSubject"), 0);
    this.openMenu(options);
  }

  private openTemplateMenu(subject: HomeworkSubject): void {
    const options = TASK_TEMPLATES[subject]
      .filter(template => template !== "custom")
      .map<OptionSelectItem>(template => {
        const title = i18next.t(`homework:template.${template}`);
        return {
          label: title,
          handler: () => {
            this.openRequiredMenu(subject, title);
            return true;
          },
        };
      });
    options.push(
      {
        label: i18next.t("homework:template.custom"),
        handler: () => {
          this.openTitleForm(subject);
          return true;
        },
      },
      this.cancelOption(),
    );

    this.showText(i18next.t("homework:form.selectTemplate"), 0);
    this.openMenu(options);
  }

  private openTitleForm(subject: HomeworkSubject): void {
    const ui = this.getUi();
    this.menuDepth++;
    ui.setOverlayMode(UiMode.HOMEWORK_TASK_FORM, {
      buttonActions: [
        (title: string) => {
          this.menuDepth--;
          ui.revertMode();
          this.openRequiredMenu(subject, title);
        },
        () => {
          this.closeMenus();
          this.showHint();
        },
      ],
    });
  }

  private openRequiredMenu(subject: HomeworkSubject, title: string): void {
    const options: OptionSelectItem[] = [
      this.menuAction(i18next.t("homework:requiredTag"), () => this.addTask(subject, title, true)),
      this.menuAction(i18next.t("homework:optionalTag"), () => this.addTask(subject, title, false)),
      this.cancelOption(),
    ];

    this.showText(i18next.t("homework:form.requiredQuestion"), 0);
    this.openMenu(options);
  }

  private addTask(subject: HomeworkSubject, title: string, required: boolean): void {
    homeworkManager.mutate(d => d.addTask({ date: this.selectedDate, title, subject, required }));
    this.showText(i18next.t("homework:form.added", { title, date: formatDateLabel(this.selectedDate) }), 0);
  }

  // #endregion Task creation

  // #region Parent settings

  private openParentSettings(): void {
    const data = homeworkManager.get();
    const options: OptionSelectItem[] = [
      this.menuAction(i18next.t("homework:parent.exportLog"), () => {
        downloadBugLog();
        this.showText(i18next.t("homework:parent.logExported", { count: bugLogSize() }), 0);
      }),
      this.menuAction(i18next.t("homework:parent.toggleGate"), () => {
        homeworkManager.mutate(d => {
          d.gateEnabled = !d.gateEnabled;
        });
        this.showText(
          i18next.t(data.gateEnabled ? "homework:parent.gateStatusOn" : "homework:parent.gateStatusOff"),
          0,
        );
      }),
      this.menuAction(i18next.t("homework:parent.freePass"), () => {
        const today = todayKey();
        const wasFree = data.hasFreePass(today);
        homeworkManager.mutate(d => {
          d.freePassDate = wasFree ? null : today;
        });
        this.showText(i18next.t(wasFree ? "homework:parent.freePassOff" : "homework:parent.freePassOn"), 0);
      }),
      this.menuAction(i18next.t("homework:parent.grantStamina", { amount: PARENT_GRANT_AMOUNT }), () => {
        homeworkManager.mutate(d => d.earn(PARENT_GRANT_AMOUNT, "parentGrant"));
        this.showText(i18next.t("homework:parent.granted", { amount: PARENT_GRANT_AMOUNT }), 0);
      }),
      {
        label: i18next.t("homework:parent.changePin"),
        handler: () => {
          this.openPinChangeForm();
          return true;
        },
      },
      this.cancelOption(i18next.t("homework:action.back")),
    ];

    this.showText(
      [
        i18next.t(data.gateEnabled ? "homework:parent.gateStatusOn" : "homework:parent.gateStatusOff"),
        i18next.t("homework:parent.balance", {
          amount: data.stamina,
          earned: data.totalEarned,
          spent: data.totalSpent,
        }),
        i18next.t("homework:parent.costs", {
          newRun: COST_NEW_RUN,
          resume: COST_RESUME_RUN,
          toll: COST_WAVE_TOLL,
          waves: WAVE_TOLL_INTERVAL,
        }),
      ].join("\n"),
      0,
    );
    this.openMenu(options);
  }

  private openPinChangeForm(): void {
    const ui = this.getUi();
    const pinHandler = ui.handlers[UiMode.HOMEWORK_PIN] as HomeworkPinFormUiHandler;

    this.menuDepth++;
    ui.setOverlayMode(UiMode.HOMEWORK_PIN, {
      buttonActions: [
        (pin: string) => {
          if (!/^\d+$/.test(pin) || pin.length !== PARENT_PIN_LENGTH) {
            ui.playError();
            pinHandler.clearInput();
            pinHandler.setError(i18next.t("homework:parent.pinLengthError"));
            return;
          }
          this.closeMenus();
          homeworkManager.mutate(d => d.setPin(pin));
          this.showText(i18next.t("homework:parent.pinChanged"), 0);
        },
        () => {
          this.closeMenus();
          this.showHint();
        },
      ],
      errorMessage: i18next.t("homework:parent.setPinTitle"),
    });
  }

  // #endregion Parent settings

  // #region Shop & ledger

  private openShop(): void {
    const data = homeworkManager.get();
    const options = HOMEWORK_SHOP_ITEMS.map<OptionSelectItem>(item =>
      this.menuAction(
        i18next.t("homework:shop.option", {
          name: i18next.t(`homework:shop.${item.nameKey}`),
          cost: item.cost,
        }),
        () => {
          const result = purchaseShopItem(item);
          if (!result.success) {
            this.getUi().playError();
          }
          this.showText(result.message, 0);
        },
      ),
    );
    options.push(this.cancelOption(i18next.t("homework:action.back")));

    this.showText(i18next.t("homework:shop.title", { amount: data.stamina }), 0);
    this.openMenu(options);
  }

  private showLedger(): void {
    const data = homeworkManager.get();
    const lines = data.ledger.slice(0, 2).map(entry => {
      const reason = i18next.t(`homework:ledger.${entry.reason}`, {
        ...entry.reasonArgs,
        defaultValue: i18next.t("homework:ledger.unknown"),
      });
      return i18next.t(entry.kind === "earn" ? "homework:ledger.entryEarn" : "homework:ledger.entrySpend", {
        amount: entry.amount,
        reason,
      });
    });

    this.showText(
      [
        i18next.t("homework:ledger.title", { amount: data.stamina }),
        ...(lines.length > 0 ? lines : [i18next.t("homework:ledger.empty")]),
      ].join("\n"),
      0,
    );
  }

  // #endregion Shop & ledger
}
