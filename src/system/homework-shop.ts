import { globalScene } from "#app/global-scene";
import { speciesDataRegistry } from "#app/global-species-data-registry";
import type { SpeciesId } from "#enums/species-id";
import { VoucherType } from "#enums/voucher-type";
import { homeworkManager } from "#system/homework-manager";
import { randSeedShuffle } from "#utils/common";
import i18next from "i18next";

/** Candy handed to each species picked by the candy rain item. */
const CANDY_RAIN_AMOUNT = 5;

/** How many species the candy rain spreads over. */
const CANDY_RAIN_SPECIES = 3;

/** Outcome of handing a reward to the player. */
interface GrantResult {
  /** `false` when the reward could not be given, in which case no stamina is charged. */
  ok: boolean;
  /** Message to show instead of the generic "bought it" line. */
  message?: string;
}

/** One purchasable reward in the study shop. */
export interface HomeworkShopItem {
  id: string;
  /** Price in stamina. */
  cost: number;
  /** Key under the `homework:shop` namespace. */
  nameKey: string;
  grant: () => GrantResult;
}

function grantVoucher(voucherType: VoucherType): GrantResult {
  globalScene.gameData.voucherCounts[voucherType]++;
  globalScene.gameData.saveSystem();
  return { ok: true };
}

/**
 * Spreads candy over a few species the player has already caught.
 *
 * @remarks
 * Candy is per-species in PokéRogue, so the shop cannot just hand out "candy"; drawing from the
 * caught species keeps the reward concrete without asking a child to understand starter costs.
 */
function grantCandyRain(): GrantResult {
  const { gameData } = globalScene;
  const caught = Object.keys(gameData.starterData)
    .map(id => Number(id) as SpeciesId)
    .filter(id => gameData.dexData[id]?.caughtAttr);

  if (caught.length === 0) {
    return { ok: false, message: i18next.t("homework:shop.candyRainNoTarget") };
  }

  const picked = randSeedShuffle(caught).slice(0, CANDY_RAIN_SPECIES);
  for (const id of picked) {
    gameData.starterData[id].candyCount += CANDY_RAIN_AMOUNT;
  }
  gameData.saveSystem();

  const names = picked.map(id => speciesDataRegistry.getSpecies(id).name).join("、");
  return { ok: true, message: i18next.t("homework:shop.candyRainResult", { names }) };
}

/**
 * What stamina can be spent on besides playing.
 *
 * @remarks
 * Egg vouchers anchor the shop on purpose: they are PokéRogue's existing "one more pull" currency,
 * so they add excitement without touching battle balance the way extra items or money would.
 * Prices assume a solid homework day is worth roughly 130 stamina, so one good day funds a run plus
 * a regular voucher, while a premium voucher is a multi-day goal.
 */
export const HOMEWORK_SHOP_ITEMS: readonly HomeworkShopItem[] = [
  { id: "voucherRegular", cost: 60, nameKey: "voucherRegular", grant: () => grantVoucher(VoucherType.REGULAR) },
  { id: "voucherPlus", cost: 150, nameKey: "voucherPlus", grant: () => grantVoucher(VoucherType.PLUS) },
  { id: "voucherPremium", cost: 400, nameKey: "voucherPremium", grant: () => grantVoucher(VoucherType.PREMIUM) },
  { id: "candyRain", cost: 80, nameKey: "candyRain", grant: grantCandyRain },
];

/** Result of attempting a purchase. */
export interface PurchaseResult {
  success: boolean;
  /** Message to show the child. */
  message: string;
}

/** Charges for and grants a shop item, leaving stamina untouched when the reward cannot be given. */
export function purchaseShopItem(item: HomeworkShopItem): PurchaseResult {
  const data = homeworkManager.get();
  const name = i18next.t(`homework:shop.${item.nameKey}`);

  if (data.stamina < item.cost) {
    return { success: false, message: i18next.t("homework:shop.notEnough", { missing: item.cost - data.stamina }) };
  }

  // Grant before charging: a reward that cannot apply must never cost stamina.
  const granted = item.grant();
  if (!granted.ok) {
    return { success: false, message: granted.message ?? i18next.t("homework:shop.candyRainNoTarget") };
  }

  data.spend(item.cost, "shop", { name });
  homeworkManager.save();

  return { success: true, message: granted.message ?? i18next.t("homework:shop.bought", { name }) };
}
