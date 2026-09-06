import { Button } from "#enums/buttons";
import type { FormModalConfig, ModalConfig } from "#types/ui-types";
import type { InputFieldConfig } from "#ui/form-modal-ui-handler";
import { FormModalUiHandler } from "#ui/form-modal-ui-handler";
import i18next from "i18next";

/** Lets a parent type a homework task title that none of the templates covers. */
export class HomeworkTaskFormUiHandler extends FormModalUiHandler {
  public getModalTitle(_config?: ModalConfig): string {
    return i18next.t("homework:form.taskTitle");
  }

  public getWidth(_config?: ModalConfig): number {
    return 160;
  }

  public getMargin(_config?: ModalConfig): [number, number, number, number] {
    return [0, 0, 48, 0];
  }

  public getButtonLabels(_config?: ModalConfig): string[] {
    return [i18next.t("homework:form.submit"), i18next.t("homework:action.cancel")];
  }

  public override getInputFieldConfigs(): InputFieldConfig[] {
    return [{ label: i18next.t("homework:form.taskTitle") }];
  }

  /** Shows a validation message without having to reopen the modal. */
  public setError(message: string): void {
    this.errorMessage.setText(message).setVisible(!!message);
  }

  public override show(args: any[]): boolean {
    if (!super.show(args)) {
      return false;
    }

    const config = args[0] as FormModalConfig;
    this.inputs[0].text = typeof args[1] === "string" ? args[1] : "";

    this.submitAction = () => {
      this.sanitizeInputs();
      const title = this.inputs[0].text;
      if (!title) {
        this.setError(i18next.t("homework:form.emptyTitle"));
        return;
      }
      config.buttonActions[0](title);
    };

    return true;
  }

  /** Lets the cancel button be reached from the keyboard, which the base modal does not allow. */
  public override processInput(button: Button): boolean {
    if (button === Button.CANCEL && this.cancelAction) {
      this.cancelAction();
      return true;
    }
    return super.processInput(button);
  }
}
