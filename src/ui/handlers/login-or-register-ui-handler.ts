import { globalScene } from "#app/global-scene";
import { TextStyle } from "#enums/text-style";
import type { ModalConfig } from "#types/ui-types";
import type { InputFieldConfig } from "#ui/form-modal-ui-handler";
import { LoginRegisterInfoContainerUiHandler } from "#ui/login-register-info-container-ui-handler";
import { addTextObject } from "#ui/text";
import i18next from "i18next";
import type Phaser from "phaser";

export class LoginOrRegisterUiHandler extends LoginRegisterInfoContainerUiHandler {
  private logo: Phaser.GameObjects.Image;
  private title: Phaser.GameObjects.Text;
  private subtitle: Phaser.GameObjects.Text;

  public override getModalTitle(): string {
    return "";
  }

  public override getWidth(): number {
    const buttonWidth = this.buttonLabels.reduce((sum, label) => sum + label.width, 0) / 6;
    return buttonWidth + 50;
  }

  public override getHeight(): number {
    return 32;
  }

  public override getMargin(): [number, number, number, number] {
    return [0, 0, 30, 0];
  }

  public override getButtonLabels(): string[] {
    return [i18next.t("menu:login"), i18next.t("menu:register")];
  }

  public override getInputFieldConfigs(): InputFieldConfig[] {
    return [];
  }

  public override setup(): void {
    super.setup();

    // logo width is 150
    this.logo = globalScene.add //
      .image(-((150 - this.getWidth()) / 2), -52, "logo")
      .setOrigin(0);

    // The stock logo names a different game. This screen is the first thing a child sees, so it
    // carries the same title and promise the opening cutscene does - set as text rather than a new
    // image, so it stays sharp and needs no art in the assets submodule.
    const centre = this.getWidth() / 2;
    this.title = addTextObject(centre, -46, i18next.t("homework:name"), TextStyle.MONEY, {
      fontSize: "112px",
    }).setOrigin(0.5, 0);
    // `addTextObject` hands back text already scaled onto the pixel grid, so growth is relative.
    this.title.setScale(this.title.scale * 0.75);

    this.subtitle = addTextObject(centre, -22, i18next.t("homework:intro.subtitle"), TextStyle.WINDOW, {
      fontSize: "44px",
    })
      .setOrigin(0.5, 0)
      .setStroke("#1b1420", 10);

    this.modalContainer.add([this.logo, this.title, this.subtitle]);
  }

  public override show(args: [ModalConfig, ...any[]]): boolean {
    // Hidden rather than removed: the base class still owns it, and leaving it out of the display
    // list would mean patching more of upstream than this screen is worth.
    this.logo.setVisible(false).setActive(false);
    this.title.setVisible(true);
    this.subtitle.setVisible(true);

    const config = args[0];
    this.showInfoContainer(config);

    return super.show(args);
  }

  public override clear(): void {
    super.clear();

    this.logo.setVisible(false).setActive(false);
    this.title.setVisible(false);
    this.subtitle.setVisible(false);
  }

  public override destroy(): void {
    super.destroy();

    this.logo.destroy();
    this.title.destroy();
    this.subtitle.destroy();
  }
}
