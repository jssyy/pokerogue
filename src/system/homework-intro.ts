import { globalScene } from "#app/global-scene";
import { TextStyle } from "#enums/text-style";
import { addTextObject } from "#ui/text";
import { fixedInt } from "#utils/common";
import i18next from "i18next";

/** Whether the opening cutscene has already run since the page was loaded. */
let introPlayed = false;

/** Milliseconds the whole cutscene takes when it is not skipped. */
const INTRO_DURATION = 4400;

/** Horizontal gap between the five stars of the title card. */
const STAR_SPACING = 18;

/** How long the curtain waits for the caller to lift it before doing so itself. */
const CURTAIN_SAFETY_MS = 5000;

/** Extra grace before the backstop timer force-ends the cutscene. */
const INTRO_BACKSTOP_GRACE = 1500;

/**
 * Plays the opening cutscene once per session, before the homework planner takes over as the home
 * screen.
 *
 * @remarks
 * Returning to the title after a run must not replay it - a cutscene the child sits through several
 * times a day stops being a cutscene and becomes a toll.
 *
 * @returns A function that lifts the black curtain. The curtain stays up after the cutscene ends so
 * that the caller can build the planner behind it: dropping it earlier would flash the bare title
 * background between the two screens.
 */
export async function playHomeworkIntroOnce(): Promise<() => void> {
  if (introPlayed) {
    return () => {};
  }
  introPlayed = true;
  return playHomeworkIntro();
}

/**
 * Runs the cutscene, resolving once it has finished or been skipped.
 *
 * @remarks
 * The cutscene is decoration, so every failure path still resolves: a backstop timer and a `catch`
 * around the setup make sure a broken animation can never leave the player stuck on a black screen.
 * The returned function fades the remaining curtain away; a safety timer calls it too, so a caller
 * that never gets around to it cannot strand the player on black.
 */
export function playHomeworkIntro(): Promise<() => void> {
  return new Promise<() => void>(resolve => {
    let finished = false;
    let container: Phaser.GameObjects.Container | undefined;
    let content: Phaser.GameObjects.GameObject[] = [];
    let backstop: ReturnType<typeof setTimeout> | undefined;

    let lifted = false;
    let safety: ReturnType<typeof setTimeout> | undefined;

    const destroy = (): void => {
      clearTimeout(backstop);
      clearTimeout(safety);
      container?.destroy();
      container = undefined;
    };

    /** Fades the curtain away, revealing whatever the caller put on screen behind it. */
    const lift = (): void => {
      if (lifted) {
        return;
      }
      lifted = true;
      if (container == null) {
        return;
      }
      try {
        globalScene.tweens.add({
          targets: container,
          alpha: 0,
          duration: fixedInt(350),
          onComplete: destroy,
        });
      } catch {
        destroy();
      }
    };

    const finish = (): void => {
      if (finished) {
        return;
      }
      finished = true;
      globalScene.input?.keyboard?.off?.("keydown", finish);
      globalScene.input?.off?.("pointerdown", finish);
      clearTimeout(backstop);

      // Only the lettering goes; the curtain stays so the planner can be built behind it.
      try {
        globalScene.tweens.add({ targets: content, alpha: 0, duration: fixedInt(250) });
      } catch {
        // The curtain alone is enough - a failed fade must not hold up the hand-off.
      }
      safety = setTimeout(lift, CURTAIN_SAFETY_MS);
      resolve(lift);
    };

    try {
      const width = globalScene.scaledCanvas.width;
      const height = globalScene.scaledCanvas.height;

      container = globalScene.add.container(0, 0).setName("homework-intro");
      // Opaque from the first frame: the loading screen it replaces is black too, so fading the
      // curtain in would only flash the empty title background underneath.
      const curtain = globalScene.add.rectangle(0, 0, width, height, 0x0c0c18).setOrigin(0);

      const title = addTextObject(width / 2, height * 0.2, i18next.t("homework:name"), TextStyle.MONEY, {
        fontSize: "160px",
      })
        .setOrigin(0.5)
        .setAlpha(0);
      // Text objects come out of `addTextObject` pre-scaled to the pixel-art grid, so growth has to
      // be expressed relative to that scale - setting it outright blows the text up sixfold.
      const titleScale = title.scale;
      title.setScale(titleScale * 0.75);

      const subtitle = addTextObject(width / 2, height * 0.34, i18next.t("homework:intro.subtitle"), TextStyle.WINDOW, {
        fontSize: "54px",
      })
        .setOrigin(0.5)
        .setAlpha(0);

      const rule = globalScene.add
        .rectangle(width / 2, height * 0.41, 120, 1, 0xf8d030)
        .setOrigin(0.5)
        .setAlpha(0);

      // The five stars are the whole mechanic in one image: a parent's grade is what turns homework
      // into stamina, so they light up one by one before the promise is spelled out.
      const stars = [0, 1, 2, 3, 4].map(index => {
        const star = addTextObject(width / 2 + (index - 2) * STAR_SPACING, height * 0.5, "★", TextStyle.MONEY, {
          fontSize: "96px",
        })
          .setOrigin(0.5)
          .setAlpha(0);
        star.setScale(star.scale * 2.2);
        return star;
      });
      const starScale = stars[0].scale / 2.2;

      const lines = [1, 2, 3].map((line, index) =>
        addTextObject(
          width / 2,
          height * 0.68 + index * 13,
          i18next.t(`homework:intro.line${line}`),
          TextStyle.WINDOW,
          { fontSize: "72px" },
        )
          .setOrigin(0.5)
          .setAlpha(0),
      );

      const skipHint = addTextObject(width - 6, height - 12, i18next.t("homework:intro.skip"), TextStyle.WINDOW, {
        fontSize: "54px",
      })
        .setOrigin(1, 0)
        .setAlpha(0);

      const credit = addTextObject(6, height - 12, i18next.t("homework:intro.credit"), TextStyle.WINDOW, {
        fontSize: "42px",
      })
        .setOrigin(0, 0)
        .setAlpha(0);

      content = [title, subtitle, rule, ...stars, ...lines, skipHint, credit];
      container.add([curtain, ...content]);
      globalScene.uiContainer.add(container);

      // Any key or tap gets past it - a child who has seen it should never be held hostage by it.
      globalScene.input?.keyboard?.once?.("keydown", finish);
      globalScene.input?.once?.("pointerdown", finish);

      globalScene.tweens.add({
        targets: title,
        alpha: 1,
        scale: titleScale,
        delay: fixedInt(250),
        duration: fixedInt(650),
        ease: "Back.easeOut",
      });
      globalScene.tweens.add({ targets: subtitle, alpha: 0.9, delay: fixedInt(700), duration: fixedInt(400) });
      globalScene.tweens.add({ targets: rule, alpha: 1, width: 120, delay: fixedInt(750), duration: fixedInt(400) });

      for (const [index, star] of stars.entries()) {
        globalScene.tweens.add({
          targets: star,
          alpha: 1,
          scale: starScale,
          delay: fixedInt(950 + index * 130),
          duration: fixedInt(260),
          ease: "Back.easeOut",
        });
      }

      for (const [index, line] of lines.entries()) {
        globalScene.tweens.add({
          targets: line,
          alpha: 1,
          y: "-=6",
          delay: fixedInt(1750 + index * 620),
          duration: fixedInt(520),
          ease: "Sine.easeOut",
        });
      }
      globalScene.tweens.add({ targets: skipHint, alpha: 0.8, delay: fixedInt(700), duration: fixedInt(400) });
      globalScene.tweens.add({ targets: credit, alpha: 0.5, delay: fixedInt(1200), duration: fixedInt(400) });

      globalScene.time.delayedCall(fixedInt(INTRO_DURATION), finish);
      backstop = setTimeout(finish, INTRO_DURATION + INTRO_BACKSTOP_GRACE);
    } catch (err) {
      console.warn("The homework intro could not play; skipping it.\n", err);
      finished = true;
      destroy();
      resolve(() => {});
    }
  });
}
