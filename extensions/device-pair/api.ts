export {
  approveDevicePairing,
  clearDeviceBootstrapTokens,
  issueDeviceBootstrapToken,
  PAIRING_SETUP_BOOTSTRAP_PROFILE,
  listDevicePairing,
  revokeDeviceBootstrapToken,
  type DeviceBootstrapProfile,
} from "kaijibot/plugin-sdk/device-bootstrap";
export { definePluginEntry, type KaijiBotPluginApi } from "kaijibot/plugin-sdk/plugin-entry";
export {
  resolveGatewayBindUrl,
  resolveGatewayPort,
  resolveTailnetHostWithRunner,
} from "kaijibot/plugin-sdk/core";
export {
  resolvePreferredKaijiBotTmpDir,
  runPluginCommandWithTimeout,
} from "kaijibot/plugin-sdk/sandbox";
export { renderQrPngBase64 } from "./qr-image.js";
