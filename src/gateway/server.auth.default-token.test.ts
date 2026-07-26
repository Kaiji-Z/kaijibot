import { describe } from "vitest";
import { registerDefaultAuthTokenSuite } from "./server.auth.default-token.suite.js";
import { installGatewayTestHooks } from "./server.auth.shared.js";

installGatewayTestHooks({ scope: "suite" });

// Skip on CI: requires upstream-only channels/plugins not bundled in KaijiBot
describe.skipIf(process.env.CI)("gateway server auth/connect", () => {
  registerDefaultAuthTokenSuite();
});
