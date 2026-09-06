import { Button } from "#enums/buttons";
import type { FormModalConfig, ModalConfig } from "#types/ui-types";
import type { InputFieldConfig } from "#ui/form-modal-ui-handler";
import { FormModalUiHandler } from "#ui/form-modal-ui-handler";
import i18next from "i18next";

/**
 * Asks for the parent PIN before handing out grading and planning rights.
 *
 * @remarks
 * The PIN is a speed bump, not a security boundary - a determined child can always edit local
 * storage. It exists so that grading stays a deliberate act by an adult, which is what makes the
 * score mean anything.
 */
export class HomeworkPinFormUiHandler extends FormModalUiHandler {
  public getModalTitle(_config?: ModalConfig): string {
    return i18next.t("homework:parent.pinTitle");
  }

  public getWidth(_config?: ModalConfig): number {
    return 160;
  }

  public getMargin(_config?: ModalConfig): [number, number, number, number] {
    return [0, 0, 48, 0];
  }

  public getButtonLabels(_config?: ModalConfig): string[] {
    return [i18next.t("homework:parent.pinSubmit"), i18next.t("homework:action.cancel")];
  }

  public override getInputFieldConfigs(): InputFieldConfig[] {
    return [{ label: i18next.t("homework:parent.pinLabel"), isPassword: true }];
  }

  /** Shows a validation message without having to reopen the modal. */
  public setError(message: string): void {
    this.errorMessage.setText(message).setVisible(!!message);
  }

  /** Empties the PIN field, so a wrong attempt does not have to be deleted by hand. */
  public clearInput(): void {
    this.inputs[0].text = "";
  }

  public override show(args: any[]): boolean {
    if (!super.show(args)) {
      return false;
    }

    const config = args[0] as FormModalConfig;
    this.inputs[0].text = "";

    this.submitAction = () => {
      this.sanitizeInputs();
      config.buttonActions[0](this.inputs[0].text);
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
