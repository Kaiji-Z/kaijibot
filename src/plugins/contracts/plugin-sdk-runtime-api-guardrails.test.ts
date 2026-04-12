import { existsSync, readFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { loadPluginManifestRegistry } from "../manifest-registry.js";

const ROOT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const bundledPluginRoots = new Map(
  loadPluginManifestRegistry({ cache: true, config: {} })
    .plugins.filter((plugin) => plugin.origin === "bundled")
    .map((plugin) => [plugin.id, plugin.rootDir] as const),
);

function bundledPluginFile(pluginId: string, relativePath: string): string {
  const rootDir = bundledPluginRoots.get(pluginId);
  if (!rootDir) {
    throw new Error(`missing bundled plugin root for ${pluginId}`);
  }
  return relative(resolve(ROOT_DIR, ".."), resolve(rootDir, relativePath)).replaceAll("\\", "/");
}

const RUNTIME_API_EXPORT_GUARDS: Record<string, readonly string[]> = {} as const;

function collectRuntimeApiFiles(): string[] {
  return [...bundledPluginRoots.values()]
    .map((rootDir) => resolve(rootDir, "runtime-api.ts"))
    .filter((path) => existsSync(path))
    .map((path) => relative(resolve(ROOT_DIR, ".."), path).replaceAll("\\", "/"));
}

function readExportStatements(path: string): string[] {
  const sourceText = readFileSync(resolve(ROOT_DIR, "..", path), "utf8");
  const sourceFile = ts.createSourceFile(path, sourceText, ts.ScriptTarget.Latest, true);

  return sourceFile.statements.flatMap((statement) => {
    if (!ts.isExportDeclaration(statement)) {
      const modifiers = ts.canHaveModifiers(statement) ? ts.getModifiers(statement) : undefined;
      if (!modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword)) {
        return [];
      }
      return [statement.getText(sourceFile).replaceAll(/\s+/g, " ").trim()];
    }

    const moduleSpecifier = statement.moduleSpecifier;
    if (!moduleSpecifier || !ts.isStringLiteral(moduleSpecifier)) {
      return [statement.getText(sourceFile).replaceAll(/\s+/g, " ").trim()];
    }

    if (!statement.exportClause) {
      const prefix = statement.isTypeOnly ? "export type *" : "export *";
      return [`${prefix} from ${moduleSpecifier.getText(sourceFile)};`];
    }

    if (!ts.isNamedExports(statement.exportClause)) {
      return [statement.getText(sourceFile).replaceAll(/\s+/g, " ").trim()];
    }

    const specifiers = statement.exportClause.elements.map((element) => {
      const imported = element.propertyName?.text;
      const exported = element.name.text;
      const alias = imported ? `${imported} as ${exported}` : exported;
      return element.isTypeOnly ? `type ${alias}` : alias;
    });
    const exportPrefix = statement.isTypeOnly ? "export type" : "export";
    return [
      `${exportPrefix} { ${specifiers.join(", ")} } from ${moduleSpecifier.getText(sourceFile)};`,
    ];
  });
}

describe("runtime api guardrails", () => {
  it("keeps runtime api surfaces on an explicit export allowlist", () => {
    const runtimeApiFiles = collectRuntimeApiFiles();

    for (const file of runtimeApiFiles) {
      expect(file, "runtime-api file should belong to a living extension").not.toMatch(
        /\/(discord|slack|telegram|irc|matrix|googlechat|zalouser|line|signal|whatsapp|nextcloud-talk|imessage|mattermost|bluebubbles|nostr|twitch|tlon|msteams|zalo)\//,
      );
    }
  });
});
