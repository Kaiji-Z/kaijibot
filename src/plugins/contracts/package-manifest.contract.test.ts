import { describePackageManifestContract } from "../../../test/helpers/plugins/package-manifest-contract.js";

type PackageManifestContractParams = Parameters<typeof describePackageManifestContract>[0];

const packageManifestContractTests: PackageManifestContractParams[] = [
  {
    pluginId: "feishu",
    mirroredRootRuntimeDeps: ["@larksuiteoapi/node-sdk"],
    minHostVersionBaseline: "2026.3.22",
  },
  {
    pluginId: "memory-lancedb",
    mirroredRootRuntimeDeps: ["@lancedb/lancedb", "openai"],
    minHostVersionBaseline: "2026.3.22",
  },
];

for (const params of packageManifestContractTests) {
  describePackageManifestContract(params);
}
