import { spinner } from "@clack/prompts";
import { formatDurationPrecise } from "../../infra/format-time/format-duration.ts";
import type {
  UpdateRunResult,
  UpdateStepInfo,
  UpdateStepProgress,
} from "../../infra/update-runner.js";
import { defaultRuntime } from "../../runtime.js";
import { normalizeLowercaseStringOrEmpty } from "../../shared/string-coerce.js";
import { theme } from "../../terminal/theme.js";
import { t } from "../i18n/translate.js";
import type { UpdateCommandOptions } from "./shared.js";

const STEP_LABEL_KEYS: Record<string, string> = {
  "clean check": "cli.update.step.cleanCheck",
  "upstream check": "cli.update.step.upstreamCheck",
  "git fetch": "cli.update.step.gitFetch",
  "git rebase": "cli.update.step.gitRebase",
  "git rev-parse @{upstream}": "cli.update.step.revParseUpstream",
  "git rev-list": "cli.update.step.gitRevList",
  "git clone": "cli.update.step.gitClone",
  "preflight worktree": "cli.update.step.preflightWorktree",
  "preflight cleanup": "cli.update.step.preflightCleanup",
  "deps install": "cli.update.step.depsInstall",
  build: "cli.update.step.build",
  "ui:build": "cli.update.step.uiBuild",
  "ui:build (post-doctor repair)": "cli.update.step.uiBuildPostDoctor",
  "ui assets verify": "cli.update.step.uiAssetsVerify",
  "kaijibot doctor entry": "cli.update.step.doctorEntry",
  "kaijibot doctor": "cli.update.step.doctor",
  "git rev-parse HEAD (after)": "cli.update.step.revParseHeadAfter",
  "global update": "cli.update.step.globalUpdate",
  "global update (omit optional)": "cli.update.step.globalUpdateOmitOptional",
  "global install": "cli.update.step.globalInstall",
};

function getStepLabel(step: UpdateStepInfo): string {
  const key = STEP_LABEL_KEYS[step.name];
  return key ? t(key) : step.name;
}

export function inferUpdateFailureHints(result: UpdateRunResult): string[] {
  if (result.status !== "error") {
    return [];
  }
  if (result.reason === "pnpm-corepack-missing") {
    return [t("cli.update.hint.corepackMissing"), t("cli.update.hint.corepackMissingAction")];
  }
  if (result.reason === "pnpm-corepack-enable-failed") {
    return [
      t("cli.update.hint.corepackEnableFailed"),
      t("cli.update.hint.corepackEnableFailedAction"),
    ];
  }
  if (result.reason === "pnpm-npm-bootstrap-failed") {
    return [t("cli.update.hint.npmBootstrapFailed"), t("cli.update.hint.npmBootstrapFailedAction")];
  }
  if (result.reason === "preferred-manager-unavailable") {
    return [
      t("cli.update.hint.preferredManagerUnavailable"),
      t("cli.update.hint.preferredManagerUnavailableAction"),
    ];
  }
  if (result.mode !== "npm") {
    return [];
  }
  const failedStep = [...result.steps].toReversed().find((step) => step.exitCode !== 0);
  if (!failedStep) {
    return [];
  }

  const stderr = normalizeLowercaseStringOrEmpty(failedStep.stderrTail);
  const hints: string[] = [];

  if (failedStep.name.startsWith("global update") && stderr.includes("eacces")) {
    hints.push(t("cli.update.hint.eaccesDetected"));
    hints.push(t("cli.update.hint.eaccesExample"));
  }

  if (
    failedStep.name.startsWith("global update") &&
    (stderr.includes("node-gyp") || stderr.includes("prebuild"))
  ) {
    hints.push(t("cli.update.hint.nativeDepFailure"));
    hints.push(t("cli.update.hint.nativeDepExample"));
  }

  return hints;
}

export type ProgressController = {
  progress: UpdateStepProgress;
  stop: () => void;
};

export function createUpdateProgress(enabled: boolean): ProgressController {
  if (!enabled) {
    return {
      progress: {},
      stop: () => {},
    };
  }

  let currentSpinner: ReturnType<typeof spinner> | null = null;

  const progress: UpdateStepProgress = {
    onStepStart: (step) => {
      currentSpinner = spinner();
      currentSpinner.start(theme.accent(getStepLabel(step)));
    },
    onStepComplete: (step) => {
      if (!currentSpinner) {
        return;
      }

      const label = getStepLabel(step);
      const duration = theme.muted(`(${formatDurationPrecise(step.durationMs)})`);
      const icon = step.exitCode === 0 ? theme.success("\u2713") : theme.error("\u2717");

      currentSpinner.stop(`${icon} ${label} ${duration}`);
      currentSpinner = null;

      if (step.exitCode !== 0 && step.stderrTail) {
        const lines = step.stderrTail.split("\n").slice(-10);
        for (const line of lines) {
          if (line.trim()) {
            defaultRuntime.log(`    ${theme.error(line)}`);
          }
        }
      }
    },
  };

  return {
    progress,
    stop: () => {
      if (currentSpinner) {
        currentSpinner.stop();
        currentSpinner = null;
      }
    },
  };
}

function formatStepStatus(exitCode: number | null): string {
  if (exitCode === 0) {
    return theme.success("\u2713");
  }
  if (exitCode === null) {
    return theme.warn("?");
  }
  return theme.error("\u2717");
}

type PrintResultOptions = UpdateCommandOptions & {
  hideSteps?: boolean;
};

export function printResult(result: UpdateRunResult, opts: PrintResultOptions): void {
  if (opts.json) {
    defaultRuntime.writeJson(result);
    return;
  }

  const statusColor =
    result.status === "ok" ? theme.success : result.status === "skipped" ? theme.warn : theme.error;

  defaultRuntime.log("");
  defaultRuntime.log(
    `${theme.heading(t("cli.update.result.heading"))} ${statusColor(result.status.toUpperCase())}`,
  );
  if (result.root) {
    defaultRuntime.log(`  ${t("cli.update.result.root")}: ${theme.muted(result.root)}`);
  }
  if (result.reason) {
    defaultRuntime.log(`  ${t("cli.update.result.reason")}: ${theme.muted(result.reason)}`);
  }

  if (result.before?.version || result.before?.sha) {
    const before = result.before.version ?? result.before.sha?.slice(0, 8) ?? "";
    defaultRuntime.log(`  ${t("cli.update.result.before")}: ${theme.muted(before)}`);
  }
  if (result.after?.version || result.after?.sha) {
    const after = result.after.version ?? result.after.sha?.slice(0, 8) ?? "";
    defaultRuntime.log(`  ${t("cli.update.result.after")}: ${theme.muted(after)}`);
  }

  if (!opts.hideSteps && result.steps.length > 0) {
    defaultRuntime.log("");
    defaultRuntime.log(theme.heading(t("cli.update.result.steps")));
    for (const step of result.steps) {
      const status = formatStepStatus(step.exitCode);
      const duration = theme.muted(`(${formatDurationPrecise(step.durationMs)})`);
      defaultRuntime.log(`  ${status} ${step.name} ${duration}`);

      if (step.exitCode !== 0 && step.stderrTail) {
        const lines = step.stderrTail.split("\n").slice(0, 5);
        for (const line of lines) {
          if (line.trim()) {
            defaultRuntime.log(`      ${theme.error(line)}`);
          }
        }
      }
    }
  }

  const hints = inferUpdateFailureHints(result);
  if (hints.length > 0) {
    defaultRuntime.log("");
    defaultRuntime.log(theme.heading(t("cli.update.result.recoveryHints")));
    for (const hint of hints) {
      defaultRuntime.log(`  - ${theme.warn(hint)}`);
    }
  }

  defaultRuntime.log("");
  defaultRuntime.log(
    `${t("cli.update.result.totalTime")}: ${theme.muted(formatDurationPrecise(result.durationMs))}`,
  );
}
