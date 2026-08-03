import type { ChannelDirectoryEntry } from "kaijibot/plugin-sdk/channel-contract";
import type { KaijiBotConfig } from "kaijibot/plugin-sdk/testing";
import { expect } from "vitest";

export type DirectoryListFn = (params: {
  cfg: KaijiBotConfig;
  accountId?: string;
  query?: string | null;
  limit?: number | null;
}) => Promise<ChannelDirectoryEntry[]>;

export async function expectDirectoryIds(
  listFn: DirectoryListFn,
  cfg: KaijiBotConfig,
  expected: string[],
  options?: { sorted?: boolean },
) {
  const entries = await listFn({
    cfg,
    accountId: "default",
    query: null,
    limit: null,
  });
  const ids = entries.map((entry) => entry.id);
  expect(options?.sorted ? sortDirectoryIds(ids) : ids).toEqual(
    options?.sorted ? sortDirectoryIds(expected) : expected,
  );
}

function compareDirectoryIds(left: string, right: string) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function sortDirectoryIds(values: string[]) {
  return values.toSorted(compareDirectoryIds);
}
