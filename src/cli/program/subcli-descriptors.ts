import { t } from "../i18n/translate.js";
import { defineCommandDescriptorCatalog } from "./command-descriptor-utils.js";
import type { NamedCommandDescriptor } from "./command-group-descriptors.js";

export type SubCliDescriptor = NamedCommandDescriptor;

const subCliCommandCatalog = defineCommandDescriptorCatalog([
  { name: "acp", description: t("cli.commands.acp.description"), hasSubcommands: true },
  {
    name: "gateway",
    description: t("cli.commands.gateway.description"),
    hasSubcommands: true,
  },
  { name: "daemon", description: t("cli.commands.daemon.description"), hasSubcommands: true },
  { name: "logs", description: t("cli.commands.logs.description"), hasSubcommands: false },
  {
    name: "system",
    description: t("cli.commands.system.description"),
    hasSubcommands: true,
  },
  {
    name: "models",
    description: t("cli.commands.models.description"),
    hasSubcommands: true,
  },
  {
    name: "infer",
    description: t("cli.commands.infer.description"),
    hasSubcommands: true,
  },
  {
    name: "capability",
    description: t("cli.commands.capability.description"),
    hasSubcommands: true,
  },
  {
    name: "approvals",
    description: t("cli.commands.approvals.description"),
    hasSubcommands: true,
  },
  {
    name: "nodes",
    description: t("cli.commands.nodes.description"),
    hasSubcommands: true,
  },
  {
    name: "devices",
    description: t("cli.commands.devices.description"),
    hasSubcommands: true,
  },
  {
    name: "node",
    description: t("cli.commands.node.description"),
    hasSubcommands: true,
  },
  {
    name: "sandbox",
    description: t("cli.commands.sandbox.description"),
    hasSubcommands: true,
  },
  {
    name: "tui",
    description: t("cli.commands.tui.description"),
    hasSubcommands: false,
  },
  {
    name: "cron",
    description: t("cli.commands.cron.description"),
    hasSubcommands: true,
  },
  {
    name: "dns",
    description: t("cli.commands.dns.description"),
    hasSubcommands: true,
  },
  {
    name: "docs",
    description: t("cli.commands.docs.description"),
    hasSubcommands: false,
  },
  {
    name: "qa",
    description: t("cli.commands.qa.description"),
    hasSubcommands: true,
  },
  {
    name: "hooks",
    description: t("cli.commands.hooks.description"),
    hasSubcommands: true,
  },
  {
    name: "webhooks",
    description: t("cli.commands.webhooks.description"),
    hasSubcommands: true,
  },
  {
    name: "qr",
    description: t("cli.commands.qr.description"),
    hasSubcommands: false,
  },
  {
    name: "clawbot",
    description: t("cli.commands.clawbot.description"),
    hasSubcommands: true,
  },
  {
    name: "pairing",
    description: t("cli.commands.pairing.description"),
    hasSubcommands: true,
  },
  {
    name: "plugins",
    description: t("cli.commands.plugins.description"),
    hasSubcommands: true,
  },
  {
    name: "channels",
    description: t("cli.commands.channels.description"),
    hasSubcommands: true,
  },
  {
    name: "directory",
    description: t("cli.commands.directory.description"),
    hasSubcommands: true,
  },
  {
    name: "security",
    description: t("cli.commands.security.description"),
    hasSubcommands: true,
  },
  {
    name: "secrets",
    description: t("cli.commands.secrets.description"),
    hasSubcommands: true,
  },
  {
    name: "skills",
    description: t("cli.commands.skills.description"),
    hasSubcommands: true,
  },
  {
    name: "soul",
    description: t("cli.commands.soul.description"),
    hasSubcommands: true,
  },
  {
    name: "update",
    description: t("cli.commands.update.description"),
    hasSubcommands: true,
  },
  {
    name: "completion",
    description: t("cli.commands.completion.description"),
    hasSubcommands: false,
  },
  {
    name: "context",
    description: "Context engineering — audit and trim injected context",
    hasSubcommands: true,
  },
] as const satisfies ReadonlyArray<SubCliDescriptor>);

export const SUB_CLI_DESCRIPTORS = subCliCommandCatalog.descriptors;

export function getSubCliEntries(): ReadonlyArray<SubCliDescriptor> {
  return subCliCommandCatalog.getDescriptors();
}

export function getSubCliCommandsWithSubcommands(): string[] {
  return subCliCommandCatalog.getCommandsWithSubcommands();
}
