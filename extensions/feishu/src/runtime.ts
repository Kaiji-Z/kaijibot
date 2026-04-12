import type { PluginRuntime } from "kaijibot/plugin-sdk/core";
import { createPluginRuntimeStore } from "kaijibot/plugin-sdk/runtime-store";

const { setRuntime: setFeishuRuntime, getRuntime: getFeishuRuntime } =
  createPluginRuntimeStore<PluginRuntime>("Feishu runtime not initialized");
export { getFeishuRuntime, setFeishuRuntime };
