import { t } from "../i18n/translate.js";
import { defineCommandDescriptorCatalog } from "./command-descriptor-utils.js";
import type { NamedCommandDescriptor } from "./command-group-descriptors.js";

export type CoreCliCommandDescriptor = NamedCommandDescriptor;

const coreCliCommandCatalog = defineCommandDescriptorCatalog([
  {
    name: "setup",
    description: t("cli.commands.setup.description"),
    hasSubcommands: false,
  },
  {
    name: "onboard",
    description: t("cli.commands.onboard.description"),
    hasSubcommands: false,
  },
  {
    name: "configure",
    description: t("cli.commands.configure.description"),
    hasSubcommands: false,
  },
  {
    name: "config",
    description: t("cli.commands.config.description"),
    hasSubcommands: true,
  },
  {
    name: "backup",
    description: t("cli.commands.backup.description"),
    hasSubcommands: true,
  },
  {
    name: "doctor",
    description: t("cli.commands.doctor.description"),
    hasSubcommands: false,
  },
  {
    name: "dashboard",
    description: t("cli.commands.dashboard.description"),
    hasSubcommands: false,
  },
  {
    name: "reset",
    description: t("cli.commands.reset.description"),
    hasSubcommands: false,
  },
  {
    name: "uninstall",
    description: t("cli.commands.uninstall.description"),
    hasSubcommands: false,
  },
  {
    name: "migrate",
    description: t("cli.commands.migrate.description"),
    hasSubcommands: false,
  },
  {
    name: "android-install",
    description: t("cli.commands.android-install.description"),
    hasSubcommands: false,
  },
  {
    name: "message",
    description: t("cli.commands.message.description"),
    hasSubcommands: true,
  },
  {
    name: "mcp",
    description: t("cli.commands.mcp.description"),
    hasSubcommands: true,
  },
  {
    name: "agent",
    description: t("cli.commands.agent.description"),
    hasSubcommands: false,
  },
  {
    name: "agents",
    description: t("cli.commands.agents.description"),
    hasSubcommands: true,
  },
  {
    name: "status",
    description: t("cli.commands.status.description"),
    hasSubcommands: false,
  },
  {
    name: "health",
    description: t("cli.commands.health.description"),
    hasSubcommands: false,
  },
  {
    name: "sessions",
    description: t("cli.commands.sessions.description"),
    hasSubcommands: true,
  },
  {
    name: "tasks",
    description: t("cli.commands.tasks.description"),
    hasSubcommands: true,
  },
] as const satisfies ReadonlyArray<CoreCliCommandDescriptor>);

export const CORE_CLI_COMMAND_DESCRIPTORS = coreCliCommandCatalog.descriptors;

export function getCoreCliCommandDescriptors(): ReadonlyArray<CoreCliCommandDescriptor> {
  return coreCliCommandCatalog.getDescriptors();
}

export function getCoreCliCommandNames(): string[] {
  return coreCliCommandCatalog.getNames();
}

export function getCoreCliCommandsWithSubcommands(): string[] {
  return coreCliCommandCatalog.getCommandsWithSubcommands();
}
