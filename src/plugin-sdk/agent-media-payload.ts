export { getAgentScopedMediaLocalRoots } from "../media/local-roots.js";

export type AgentMediaPayload = {
  MediaPath?: string;
  MediaType?: string;
  MediaUrl?: string;
  MediaPaths?: string[];
  MediaUrls?: string[];
  MediaTypes?: string[];
};

/** Convert outbound media descriptors into the legacy agent payload field layout. */
export function buildAgentMediaPayload(
  mediaList: Array<{ path: string; contentType?: string | null }>,
): AgentMediaPayload {
  const first = mediaList[0];
  const mediaPaths = mediaList.map((media) => media.path);
  // Keep MediaTypes index-aligned with MediaPaths: a missing contentType must
  // not shift subsequent entries left (consumers pair them positionally).
  const mediaTypes = mediaList.map((media) => media.contentType ?? "application/octet-stream");
  return {
    MediaPath: first?.path,
    MediaType: first?.contentType ?? undefined,
    MediaUrl: first?.path,
    MediaPaths: mediaPaths.length > 0 ? mediaPaths : undefined,
    MediaUrls: mediaPaths.length > 0 ? mediaPaths : undefined,
    MediaTypes: mediaTypes.length > 0 ? mediaTypes : undefined,
  };
}
