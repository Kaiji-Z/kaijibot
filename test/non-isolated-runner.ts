import { VitestTestRunner } from "vitest/runners";

// Fork-specific: non-isolated test runner that delegates to vitest's default runner.
// Required by vitest.config.ts and multiple project configs.
export default VitestTestRunner;
