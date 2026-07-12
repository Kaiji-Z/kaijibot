import { confirm, isCancel } from "@clack/prompts";
import { readConfigFileSnapshot } from "../../config/config.js";
import {
  formatUpdateChannelLabel,
  normalizeUpdateChannel,
  resolveEffectiveUpdateChannel,
} from "../../infra/update-channels.js";
import { checkUpdateStatus } from "../../infra/update-check.js";
import { defaultRuntime } from "../../runtime.js";
import { selectStyled } from "../../terminal/prompt-select-styled.js";
import { stylePromptMessage } from "../../terminal/prompt-style.js";
import { theme } from "../../terminal/theme.js";
import { pathExists } from "../../utils.js";
import { t } from "../i18n/translate.js";
import {
  isEmptyDir,
  isGitCheckout,
  parseTimeoutMsOrExit,
  resolveGitInstallDir,
  resolveUpdateRoot,
  type UpdateWizardOptions,
} from "./shared.js";
import { updateCommand } from "./update-command.js";

export async function updateWizardCommand(opts: UpdateWizardOptions = {}): Promise<void> {
  if (!process.stdin.isTTY) {
    defaultRuntime.error(t("cli.update.wizard.requiresTty"));
    defaultRuntime.exit(1);
    return;
  }

  const timeoutMs = parseTimeoutMsOrExit(opts.timeout);
  if (timeoutMs === null) {
    return;
  }

  const root = await resolveUpdateRoot();
  const [updateStatus, configSnapshot] = await Promise.all([
    checkUpdateStatus({
      root,
      timeoutMs: timeoutMs ?? 3500,
      fetchGit: false,
      includeRegistry: false,
    }),
    readConfigFileSnapshot(),
  ]);

  const configChannel = configSnapshot.valid
    ? normalizeUpdateChannel(configSnapshot.config.update?.channel)
    : null;
  const channelInfo = resolveEffectiveUpdateChannel({
    configChannel,
    installKind: updateStatus.installKind,
    git: updateStatus.git
      ? { tag: updateStatus.git.tag, branch: updateStatus.git.branch }
      : undefined,
  });
  const channelLabel = formatUpdateChannelLabel({
    channel: channelInfo.channel,
    source: channelInfo.source,
    gitTag: updateStatus.git?.tag ?? null,
    gitBranch: updateStatus.git?.branch ?? null,
  });

  const pickedChannel = await selectStyled({
    message: t("cli.update.wizard.channelSelect"),
    options: [
      {
        value: "keep",
        label: t("cli.update.wizard.keepCurrent", { channel: channelInfo.channel }),
        hint: channelLabel,
      },
      {
        value: "stable",
        label: t("cli.update.wizard.stable"),
        hint: t("cli.update.wizard.stableHint"),
      },
      {
        value: "beta",
        label: t("cli.update.wizard.beta"),
        hint: t("cli.update.wizard.betaHint"),
      },
      {
        value: "dev",
        label: t("cli.update.wizard.dev"),
        hint: t("cli.update.wizard.devHint"),
      },
    ],
    initialValue: "keep",
  });

  if (isCancel(pickedChannel)) {
    defaultRuntime.log(theme.muted(t("cli.update.wizard.cancelled")));
    defaultRuntime.exit(0);
    return;
  }

  const requestedChannel = pickedChannel === "keep" ? null : pickedChannel;

  if (requestedChannel === "dev" && updateStatus.installKind !== "git") {
    const gitDir = resolveGitInstallDir();
    const hasGit = await isGitCheckout(gitDir);
    if (!hasGit) {
      const dirExists = await pathExists(gitDir);
      if (dirExists) {
        const empty = await isEmptyDir(gitDir);
        if (!empty) {
          defaultRuntime.error(
            `KAIJIBOT_GIT_DIR points at a non-git directory: ${gitDir}. Set KAIJIBOT_GIT_DIR to an empty folder or an kaijibot checkout.`,
          );
          defaultRuntime.exit(1);
          return;
        }
      }

      const ok = await confirm({
        message: stylePromptMessage(t("cli.update.wizard.createGitCheckout", { dir: gitDir })),
        initialValue: true,
      });
      if (isCancel(ok) || !ok) {
        defaultRuntime.log(theme.muted(t("cli.update.wizard.cancelled")));
        defaultRuntime.exit(0);
        return;
      }
    }
  }

  const restart = await confirm({
    message: stylePromptMessage(t("cli.update.wizard.restartPrompt")),
    initialValue: true,
  });
  if (isCancel(restart)) {
    defaultRuntime.log(theme.muted(t("cli.update.wizard.cancelled")));
    defaultRuntime.exit(0);
    return;
  }

  try {
    await updateCommand({
      channel: requestedChannel ?? undefined,
      restart: Boolean(restart),
      timeout: opts.timeout,
    });
  } catch (err) {
    defaultRuntime.error(String(err));
    defaultRuntime.exit(1);
  }
}
