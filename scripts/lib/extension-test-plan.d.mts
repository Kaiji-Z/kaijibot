export type ExtensionTestPlan = {
  config: string;
  extensionDir: string;
  extensionId: string;
  hasTests: boolean;
  roots: string[];
  testFileCount: number;
};

export function resolveExtensionTestPlan(params?: {
  cwd?: string;
  targetArg?: string;
}): ExtensionTestPlan;

export function resolveExtensionBatchPlan(params?: { cwd?: string; extensionIds?: string[] }): {
  extensionCount: number;
  extensionIds: string[];
  hasTests: boolean;
  planGroups: Array<{
    config: string;
    extensionIds: string[];
    roots: string[];
    testFileCount: number;
  }>;
  testFileCount: number;
};
