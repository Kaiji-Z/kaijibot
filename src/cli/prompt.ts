import { stdin as input, stdout as output } from "node:process";
import readline from "node:readline/promises";
import { isVerbose, isYes } from "../globals.js";
import { normalizeLowercaseStringOrEmpty } from "../shared/string-coerce.js";
import { t } from "./i18n/translate.js";

export async function promptYesNo(question: string, defaultYes = false): Promise<boolean> {
  // Simple Y/N prompt honoring global --yes and verbosity flags.
  if (isVerbose() && isYes()) {
    return true;
  } // redundant guard when both flags set
  if (isYes()) {
    return true;
  }
  const rl = readline.createInterface({ input, output });
  const suffix = defaultYes ? t("cli.prompt.yesNo") : t("cli.prompt.noYes");
  const answer = normalizeLowercaseStringOrEmpty(await rl.question(`${question}${suffix}`));
  rl.close();
  if (!answer) {
    return defaultYes;
  }
  return answer.startsWith("y");
}
