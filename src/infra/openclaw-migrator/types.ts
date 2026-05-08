export type MigrationSourceBrand = "openclaw" | "clawdbot" | "moltbot";

export type MigrationSource = {
  dir: string;
  brand: MigrationSourceBrand;
  configPath: string;
  configFilename: string;
};

export type MigrationOptions = {
  dryRun: boolean;
  source?: string;
  overwrite: boolean;
  migrateSecrets: boolean;
  log?: (msg: string) => void;
};

export type MigrationChangeKind = "copy" | "move" | "create" | "merge" | "skip";

export type MigrationChange = {
  kind: MigrationChangeKind;
  source: string;
  target: string;
  detail: string;
};

export type MigrationResult = {
  source: MigrationSource;
  changes: MigrationChange[];
  warnings: string[];
  skipped: string[];
};

export type MigrationReport = {
  timestamp: string;
  source: MigrationSource;
  scenario: MigrationScenario;
  results: MigrationResult[];
  totalChanges: number;
  totalWarnings: number;
  totalSkipped: number;
};

export type MigrationScenario = "fresh" | "import";

export type DataType = "workspace" | "memory" | "sessions" | "skills" | "config" | "credentials";

export type AgentInfo = {
  id: string;
  workspaceDir: string;
  isDefault: boolean;
};

export type WorkspaceStats = {
  fileCount: number;
  totalSize: number;
  hasMemory: boolean;
  hasSessions: boolean;
};

export type AgentSelection = {
  agentId: string;
  dataTypes: DataType[];
};

export type MigrationScenarioOptions = {
  scenario: MigrationScenario;
  agentSelections: AgentSelection[];
  selectedSkills?: string[];
  migrateSecrets: boolean;
};

export type MemoryMergeStrategy = "copy" | "merge";
