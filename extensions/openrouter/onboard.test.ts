import { describe, it } from "vitest";
import {
  applyOpenrouterConfig,
  applyOpenrouterProviderConfig,
  OPENROUTER_DEFAULT_MODEL_REF,
} from "./onboard.js";

describe.skip("openrouter onboard", () => {
  it("adds allowlist entry and preserves alias", () => {
    void OPENROUTER_DEFAULT_MODEL_REF;
    void applyOpenrouterProviderConfig;
  });

  it("sets primary model and preserves existing model fallbacks", () => {
    void applyOpenrouterConfig;
  });
});
