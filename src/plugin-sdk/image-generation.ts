// Public image-generation helpers and types for provider plugins.

export type {
  GeneratedImageAsset,
  ImageGenerationProvider,
  ImageGenerationProviderConfiguredContext,
  ImageGenerationResolution,
  ImageGenerationRequest,
  ImageGenerationResult,
  ImageGenerationSourceImage,
} from "../image-generation/types.js";

const NOT_IMPLEMENTED = "not implemented in this build";

export function createOpenAiCompatibleImageGenerationProvider(): never {
  throw new Error(NOT_IMPLEMENTED);
}
export function generatedImageAssetFromBase64(): never {
  throw new Error(NOT_IMPLEMENTED);
}
export function generatedImageAssetFromDataUrl(): never {
  throw new Error(NOT_IMPLEMENTED);
}
export function imageSourceUploadFileName(): string {
  return "upload.png";
}
export function toImageDataUrl(): string {
  throw new Error(NOT_IMPLEMENTED);
}
