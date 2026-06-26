import type { Command } from "commander";
import { runAndroidInstall } from "../../commands/android-install.js";
import { defaultRuntime } from "../../runtime.js";
import { theme } from "../../terminal/theme.js";
import { runCommandWithRuntime } from "../cli-utils.js";
import { formatHelpExamples } from "../help-format.js";

export function registerAndroidInstallCommand(program: Command) {
  program
    .command("android-install")
    .description(
      "Set up KaijiBot on Android/Termux (auto-installs packages, boot script, battery settings)",
    )
    .option("--non-interactive", "Skip the onboard prompt and do not launch the wizard", false)
    .addHelpText(
      "after",
      () =>
        `\n${theme.heading("Examples:")}\n${formatHelpExamples([
          ["kaijibot android-install", "Run the full Android/Termux setup flow interactively."],
          [
            "kaijibot android-install --non-interactive",
            "Run setup without launching the onboard wizard at the end.",
          ],
        ])}`,
    )
    .action(async (opts) => {
      await runCommandWithRuntime(defaultRuntime, async () => {
        await runAndroidInstall(defaultRuntime, {
          nonInteractive: Boolean(opts.nonInteractive),
        });
        defaultRuntime.exit(0);
      });
    });
}
