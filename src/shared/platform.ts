export function isLinuxLikePlatform(platform: NodeJS.Platform = process.platform): boolean {
  return platform === "linux" || platform === "android";
}

export function isAndroidTermux(platform: NodeJS.Platform = process.platform): boolean {
  return platform === "android";
}

export function getTermuxPrefix(env: NodeJS.ProcessEnv = process.env): string | null {
  if (!isAndroidTermux()) {
    return null;
  }
  return env.PREFIX ?? "/data/data/com.termux/files/usr";
}
