import { definePluginEntry } from "kaijibot/plugin-sdk/plugin-entry";
import {
  buildSherpaMediaUnderstandingProvider,
  isAsrReadySync,
  startBackgroundWarmup,
} from "./engine.js";

const SYNTHETIC_LOCAL_KEY = "sherpa-speech-local";

export default definePluginEntry({
  id: "sherpa-speech",
  name: "Sherpa Speech (local)",
  description: "Local offline ASR: sherpa-onnx (TTS removed — use edge/microsoft)",
  register(api) {
    api.registerProvider({
      id: "sherpa-speech",
      label: "Sherpa Speech (local)",
      docsPath: "/plugins/sherpa-speech",
      envVars: ["SHERPA_ONNX_RUNTIME_DIR", "SHERPA_ONNX_ASR_MODEL", "SHERPA_ONNX_AUTO_DOWNLOAD"],
      auth: [],
      resolveSyntheticAuth: () => {
        if (!isAsrReadySync()) {
          return undefined;
        }
        return {
          apiKey: SYNTHETIC_LOCAL_KEY,
          source: "sherpa-speech local engine (no key required)",
          mode: "api-key",
        };
      },
    });
    api.registerMediaUnderstandingProvider(buildSherpaMediaUnderstandingProvider());
    startBackgroundWarmup((message) => {
      console.log(`[sherpa-speech] ${message}`);
    });
  },
});
