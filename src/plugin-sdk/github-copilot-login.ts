type FacadeModule = typeof import("@kaijibot/github-copilot/api.js");
import { loadBundledPluginPublicSurfaceModuleSync } from "./facade-loader.js";

function loadFacadeModule(): FacadeModule {
  return loadBundledPluginPublicSurfaceModuleSync<FacadeModule>({
    dirName: "github-copilot",
    artifactBasename: "api.js",
  });
}
export const githubCopilotLoginCommand: FacadeModule["githubCopilotLoginCommand"] = ((...args) =>
  loadFacadeModule()["githubCopilotLoginCommand"](
    ...args,
  )) as FacadeModule["githubCopilotLoginCommand"];
