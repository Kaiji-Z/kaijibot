import { loadConfig } from "kaijibot/plugin-sdk/config-runtime";
import { readChannelAllowFromStore } from "kaijibot/plugin-sdk/conversation-runtime";
import { getPluginCommandSpecs } from "kaijibot/plugin-sdk/plugin-runtime";
import { dispatchReplyWithBufferedBlockDispatcher } from "kaijibot/plugin-sdk/reply-dispatch-runtime";
import { listSkillCommandsForAgents } from "kaijibot/plugin-sdk/skill-commands-runtime";
import type { TelegramBotDeps } from "./bot-deps.js";
import { syncTelegramMenuCommands } from "./bot-native-command-menu.js";

export type TelegramNativeCommandDeps = Pick<
  TelegramBotDeps,
  | "dispatchReplyWithBufferedBlockDispatcher"
  | "editMessageTelegram"
  | "listSkillCommandsForAgents"
  | "loadConfig"
  | "readChannelAllowFromStore"
  | "syncTelegramMenuCommands"
> & {
  getPluginCommandSpecs?: typeof getPluginCommandSpecs;
};

let telegramSendRuntimePromise: Promise<typeof import("./send.js")> | undefined;

async function loadTelegramSendRuntime() {
  telegramSendRuntimePromise ??= import("./send.js");
  return await telegramSendRuntimePromise;
}

export const defaultTelegramNativeCommandDeps: TelegramNativeCommandDeps = {
  get loadConfig() {
    return loadConfig;
  },
  get readChannelAllowFromStore() {
    return readChannelAllowFromStore;
  },
  get dispatchReplyWithBufferedBlockDispatcher() {
    return dispatchReplyWithBufferedBlockDispatcher;
  },
  get listSkillCommandsForAgents() {
    return listSkillCommandsForAgents;
  },
  get syncTelegramMenuCommands() {
    return syncTelegramMenuCommands;
  },
  get getPluginCommandSpecs() {
    return getPluginCommandSpecs;
  },
  async editMessageTelegram(...args) {
    const { editMessageTelegram } = await loadTelegramSendRuntime();
    return await editMessageTelegram(...args);
  },
};
