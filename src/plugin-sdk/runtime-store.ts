export type { PluginRuntime } from "../plugins/runtime/types.js";

export type PluginRuntimeStoreOptions = {
  pluginId?: string;
  errorMessage: string;
};

/** Create a tiny mutable runtime slot with strict access when the runtime has not been initialized. */
export function createPluginRuntimeStore<T>(
  options: string | PluginRuntimeStoreOptions,
): {
  setRuntime: (next: T) => void;
  clearRuntime: () => void;
  tryGetRuntime: () => T | null;
  getRuntime: () => T;
} {
  const errorMessage = typeof options === "string" ? options : options.errorMessage;
  let runtime: T | null = null;

  return {
    setRuntime(next: T) {
      runtime = next;
    },
    clearRuntime() {
      runtime = null;
    },
    tryGetRuntime() {
      return runtime;
    },
    getRuntime() {
      if (!runtime) {
        throw new Error(errorMessage);
      }
      return runtime;
    },
  };
}
