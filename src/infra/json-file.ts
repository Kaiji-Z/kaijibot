import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const JSON_FILE_MODE = 0o600;
const JSON_DIR_MODE = 0o700;

function trySetSecureMode(pathname: string) {
  try {
    fs.chmodSync(pathname, JSON_FILE_MODE);
  } catch {
    // best-effort on platforms without chmod support
  }
}

function trySyncDirectory(pathname: string) {
  let fd: number | undefined;
  try {
    fd = fs.openSync(path.dirname(pathname), "r");
    fs.fsyncSync(fd);
  } catch {
    // best-effort; some platforms/filesystems do not support syncing directories.
  } finally {
    if (fd !== undefined) {
      try {
        fs.closeSync(fd);
      } catch {
        // best-effort cleanup
      }
    }
  }
}

function readSymlinkTargetPath(linkPath: string): string {
  const target = fs.readlinkSync(linkPath);
  return path.resolve(path.dirname(linkPath), target);
}

function resolveJsonWriteTarget(pathname: string): { targetPath: string; followsSymlink: boolean } {
  let currentPath = pathname;
  const visited = new Set<string>();
  let followsSymlink = false;

  for (;;) {
    let stat: fs.Stats;
    try {
      stat = fs.lstatSync(currentPath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        throw error;
      }
      return { targetPath: currentPath, followsSymlink };
    }

    if (!stat.isSymbolicLink()) {
      return { targetPath: currentPath, followsSymlink };
    }

    if (visited.has(currentPath)) {
      const err = new Error(
        `Too many symlink levels while resolving ${pathname}`,
      ) as NodeJS.ErrnoException;
      err.code = "ELOOP";
      throw err;
    }

    visited.add(currentPath);
    followsSymlink = true;
    currentPath = readSymlinkTargetPath(currentPath);
  }
}

function renameJsonFileWithFallback(tmpPath: string, pathname: string) {
  try {
    fs.renameSync(tmpPath, pathname);
    return;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    // Windows does not reliably support rename-based overwrite for existing files.
    if (code === "EPERM" || code === "EEXIST") {
      fs.copyFileSync(tmpPath, pathname);
      fs.rmSync(tmpPath, { force: true });
      return;
    }
    throw error;
  }
}

function writeTempJsonFile(pathname: string, payload: string) {
  const fd = fs.openSync(pathname, "w", JSON_FILE_MODE);
  try {
    fs.writeFileSync(fd, payload, "utf8");
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
}

export function loadJsonFile<T = unknown>(pathname: string): T | undefined {
  try {
    const raw = fs.readFileSync(pathname, "utf8");
    return JSON.parse(raw) as T;
  } catch {
    return undefined;
  }
}

function serializeJsonFilePayload(data: unknown): string {
  return `${JSON.stringify(data, null, 2)}\n`;
}

function readJsonFilePayload(pathname: string): string | undefined {
  try {
    return fs.readFileSync(pathname, "utf8");
  } catch {
    return undefined;
  }
}

function replaceJsonFilePayload(targetPath: string, followsSymlink: boolean, payload: string) {
  const tmpPath = `${targetPath}.${randomUUID()}.tmp`;

  if (!followsSymlink) {
    fs.mkdirSync(path.dirname(targetPath), { recursive: true, mode: JSON_DIR_MODE });
  }
  try {
    writeTempJsonFile(tmpPath, payload);
    trySetSecureMode(tmpPath);
    renameJsonFileWithFallback(tmpPath, targetPath);
    trySetSecureMode(targetPath);
    trySyncDirectory(targetPath);
  } finally {
    try {
      fs.rmSync(tmpPath, { force: true });
    } catch {
      // best-effort cleanup when rename does not happen
    }
  }
}

export function saveJsonFile(pathname: string, data: unknown) {
  const { targetPath, followsSymlink } = resolveJsonWriteTarget(pathname);
  replaceJsonFilePayload(targetPath, followsSymlink, serializeJsonFilePayload(data));
}

/**
 * `saveJsonFile` for files whose readers key on the mtime. A payload that is
 * byte-identical to what is already on disk leaves the file as it is and
 * returns `false`, so a save that changes nothing does not read as a change.
 * Anything else is written exactly as `saveJsonFile` writes it and returns `true`.
 */
export function saveJsonFileIfChanged(pathname: string, data: unknown): boolean {
  const { targetPath, followsSymlink } = resolveJsonWriteTarget(pathname);
  const payload = serializeJsonFilePayload(data);
  if (readJsonFilePayload(targetPath) === payload) {
    trySetSecureMode(targetPath);
    return false;
  }
  replaceJsonFilePayload(targetPath, followsSymlink, payload);
  return true;
}
