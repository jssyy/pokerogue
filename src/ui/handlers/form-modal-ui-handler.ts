import { resumePixelSnap, suspendPixelSnap } from "#app/display-scaling";
import { globalScene } from "#app/global-scene";
import { Button } from "#enums/buttons";
import { TextStyle } from "#enums/text-style";
import type { FormModalConfig, ModalConfig } from "#types/ui-types";
import { ModalUiHandler } from "#ui/modal-ui-handler";
import { addTextInputObject, addTextObject, getTextColor } from "#ui/text";
import { addWindow, WindowVariant } from "#ui/ui-theme";
import { fixedInt, truncateString } from "#utils/common";
import type Phaser from "phaser";
import type InputText from "phaser3-rex-plugins/plugins/inputtext";

/** Left edge a form label falls back to when it is too wide to sit against the field column. */
const LABEL_LEFT = 10;

/** Gap between a right-aligned label and the input box it names. */
const LABEL_GAP = 6;

export abstract class FormModalUiHandler extends ModalUiHandler {
  protected editing = false;
  protected inputContainers: Phaser.GameObjects.Container[] = [];
  protected inputs: InputText[] = [];
  protected errorMessage: Phaser.GameObjects.Text;
  protected submitAction: (() => void) | undefined;
  protected cancelAction: (() => void) | undefined;
  protected tween: Phaser.Tweens.Tween | undefined;
  protected formLabels: Phaser.GameObjects.Text[] = [];

  /**
   * Get configuration for all fields that should be part of the modal
   * @remarks
   * Gets used by {@linkcode updateFields} to add the proper text inputs and labels to the view
   * @returns array of {@linkcode InputFieldConfig}
   */
  abstract getInputFieldConfigs(): InputFieldConfig[];

  public override getHeight(config?: FormModalConfig): number {
    return (
      20 * this.getInputFieldConfigs().length
      + (this.getModalTitle() ? 26 : 0)
      + (config?.errorMessage ? 12 : 0)
      + this.getButtonTopMargin()
      + 28
    );
  }

  public getReadableErrorMessage(error: string): string {
    if (!error) {
      return "";
    }

    if (error.includes("connection refused")) {
      return "Could not connect to the server";
    }

    return error;
  }

  public override setup(): void {
    super.setup();

    const config = this.getInputFieldConfigs();

    const hasTitle = !!this.getModalTitle();

    if (config.length > 0) {
      this.updateFields(config, hasTitle);
    }

    const errorMessageY = (hasTitle ? 31 : 5) + 20 * (config.length - 1) + 16 + this.getButtonTopMargin();
    const errorMessageOptions: Phaser.Types.GameObjects.Text.TextStyle = { fontSize: "42px", wordWrap: { width: 850 } };
    this.errorMessage = addTextObject(10, errorMessageY, "", TextStyle.TOOLTIP_CONTENT, errorMessageOptions)
      .setColor(getTextColor(TextStyle.SUMMARY_PINK))
      .setShadowColor(getTextColor(TextStyle.SUMMARY_PINK, true))
      .setVisible(false);
    this.modalContainer.add(this.errorMessage);
  }

  protected updateFields(fieldsConfig: InputFieldConfig[], hasTitle: boolean) {
    this.inputContainers = new Array(fieldsConfig.length);
    this.inputs = new Array(fieldsConfig.length);
    this.formLabels = new Array(fieldsConfig.length);
    for (const [f, config] of fieldsConfig.entries()) {
      const labelY = (hasTitle ? 31 : 5) + 20 * f;
      // The Pokédex Scan Window uses width `300` instead of `160` like the other forms
      // Therefore, the label does not need to be shortened
      const labelContent = this.getWidth() < 200 ? truncateString(config.label, 25) : config.label;
      const label = addTextObject(LABEL_LEFT, labelY, labelContent, TextStyle.TOOLTIP_CONTENT);
      label.name = "formLabel" + f;

      this.formLabels[f] = label;
      this.modalContainer.add(label);

      const inputWidth = label.width < 320 ? 80 : 80 - (label.width - 320) / 5.5;
      const fieldLeft = 70 + (80 - inputWidth);
      // Right-aligned against the field column, so "用户名" and "密码" finish at the same place
      // instead of leaving a ragged edge beside the boxes. A label too wide for that gap keeps the
      // left edge it had, which is the only way it stays inside the modal.
      if (label.displayWidth <= fieldLeft - LABEL_GAP - LABEL_LEFT) {
        label.setOrigin(1, 0).setX(fieldLeft - LABEL_GAP);
      }

      const inputContainer = globalScene.add.container(fieldLeft, (hasTitle ? 28 : 2) + 20 * f).setVisible(false);

      const inputBg = addWindow(0, 0, inputWidth, 16, false, false, 0, 0, WindowVariant.XTHIN);

      const isPassword = config?.isPassword;
      const isReadOnly = config?.isReadOnly;
      const input = addTextInputObject(4, -2, inputWidth * 5.5, 116, TextStyle.TOOLTIP_CONTENT, {
        type: isPassword ? "password" : "text",
        maxLength: isPassword ? 64 : 20,
        readOnly: isReadOnly ?? false,
      }).setOrigin(0);

      inputContainer.add([inputBg, input]);

      this.inputContainers[f] = inputContainer;
      this.modalContainer.add(inputContainer);

      this.inputs[f] = input;
    }
  }

  public override show(args: any[]): boolean {
    if (super.show(args)) {
      // The text boxes are real DOM inputs sitting over the canvas, and they are placed against the
      // size Phaser believes the canvas to be. Pixel snapping writes a smaller size onto it, which
      // leaves every box wider than the one drawn under it - the caret lands away from the text and a
      // click near the edge misses. Snapping stands down until the form is gone.
      //
      // Only for a form that actually has boxes: the sign-in chooser is one of these handlers with no
      // fields at all, and giving up a crisp canvas there would buy nothing.
      if (this.inputs.length > 0) {
        suspendPixelSnap();
      }
      for (const ic of this.inputContainers) {
        ic.setActive(true).setVisible(true);
      }

      const config = args[0] as FormModalConfig;
      const buttonActions = config.buttonActions ?? [];

      [this.submitAction, this.cancelAction] = buttonActions;

      // Auto focus the first input field after a short delay, to prevent accidental inputs
      setTimeout(() => {
        this.inputs[0]?.setFocus();
      }, 50);

      // Override the pointerDown event for the buttonBgs to call the `submitAction` and `cancelAction`
      // properties that we set above, allowing their behavior to change after this method terminates.
      // Some subclasses use this to add behavior to the submit and cancel action

      this.buttonBgs[0] // formatting
        .off("pointerdown")
        .on("pointerdown", () => {
          if (this.submitAction && globalScene.tweens.getTweensOf(this.modalContainer).length === 0) {
            this.submitAction();
          }
        });
      this.buttonBgs[1] // formatting
        ?.off("pointerdown")
        .on("pointerdown", () => {
          // The seemingly redundant cancelAction check is intentionally left in as a defensive programming measure
          if (this.cancelAction && globalScene.tweens.getTweensOf(this.modalContainer).length === 0) {
            this.cancelAction();
          }
        });

      this.modalContainer.setAlpha(0).y += 24;

      this.tween = globalScene.tweens.add({
        targets: this.modalContainer,
        duration: fixedInt(1000),
        ease: "Sine.easeInOut",
        y: "-=24",
        alpha: 1,
      });

      return true;
    }

    return false;
  }

  public override processInput(button: Button): boolean {
    if (button === Button.SUBMIT && this.submitAction) {
      this.submitAction();
      return true;
    }

    return false;
  }

  public sanitizeInputs(): void {
    for (const input of this.inputs) {
      input.text = input.text.trim();
    }
  }

  public override updateContainer(config?: ModalConfig): void {
    super.updateContainer(config);

    this.errorMessage
      .setText(this.getReadableErrorMessage((config as FormModalConfig)?.errorMessage || ""))
      .setVisible(!!this.errorMessage.text);
  }

  public hide(): void {
    this.modalContainer.setVisible(false).setActive(false);
    for (const ic of this.inputContainers) {
      ic.setVisible(false).setActive(false);
    }
  }

  public unhide(): void {
    this.modalContainer.setActive(true).setVisible(true);
    for (const ic of this.inputContainers) {
      ic.setActive(true).setVisible(true);
    }
  }

  public override clear(): void {
    super.clear();
    resumePixelSnap();
    this.modalContainer.setVisible(false);

    for (const ic of this.inputContainers) {
      ic.setVisible(false).setActive(false);
    }

    this.submitAction = undefined;

    this.tween?.remove().destroy();
    this.tween = undefined;
  }
}

export interface InputFieldConfig {
  label: string;
  isPassword?: boolean;
  isReadOnly?: boolean;
}
