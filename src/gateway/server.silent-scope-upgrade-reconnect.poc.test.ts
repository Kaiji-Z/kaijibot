import { describe, expect, test, vi } from "vitest";
import { WebSocket } from "ws";
import * as devicePairingModule from "../infra/device-pairing.js";
import { getPairedDevice } from "../infra/device-pairing.js";
import { GATEWAY_CLIENT_MODES, GATEWAY_CLIENT_NAMES } from "../utils/message-channel.js";
import {
  issueOperatorToken,
  loadDeviceIdentity,
  openTrackedWs,
} from "./device-authz.test-helpers.js";
import {
  connectOk,
  connectReq,
  installGatewayTestHooks,
  onceMessage,
  startServerWithClient,
} from "./test-helpers.js";

installGatewayTestHooks({ scope: "suite" });

describe("gateway silent scope-upgrade reconnect", () => {
  test("silently approves local scope-upgrade from read to admin on shared-auth reconnect", async () => {
    const started = await startServerWithClient("secret");
    const paired = await issueOperatorToken({
      name: "silent-scope-upgrade-reconnect-poc",
      approvedScopes: ["operator.read"],
      clientId: GATEWAY_CLIENT_NAMES.TEST,
      clientMode: GATEWAY_CLIENT_MODES.TEST,
    });

    let sharedAuthReconnectWs: WebSocket | undefined;
    let postUpgradeDeviceTokenWs: WebSocket | undefined;

    try {
      sharedAuthReconnectWs = await openTrackedWs(started.port);
      const sharedAuthUpgradeAttempt = await connectReq(sharedAuthReconnectWs, {
        token: "secret",
        deviceIdentityPath: paired.identityPath,
        scopes: ["operator.admin"],
      });
      expect(sharedAuthUpgradeAttempt.ok).toBe(true);

      const afterUpgrade = await getPairedDevice(paired.deviceId);
      expect(afterUpgrade?.approvedScopes).toEqual(
        expect.arrayContaining(["operator.read", "operator.admin"]),
      );

      postUpgradeDeviceTokenWs = await openTrackedWs(started.port);
      const afterUpgradeConnect = await connectReq(postUpgradeDeviceTokenWs, {
        token: "secret",
        deviceIdentityPath: paired.identityPath,
        scopes: ["operator.admin"],
      });
      expect(afterUpgradeConnect.ok).toBe(true);
    } finally {
      sharedAuthReconnectWs?.close();
      postUpgradeDeviceTokenWs?.close();
      started.ws.close();
      await started.server.close();
      started.envSnapshot.restore();
    }
  });

  test("silently approves local backend scope-upgrade from read to admin on reconnect", async () => {
    const started = await startServerWithClient("secret");
    const paired = await issueOperatorToken({
      name: "backend-scope-upgrade-reconnect-poc",
      approvedScopes: ["operator.read"],
      clientId: GATEWAY_CLIENT_NAMES.GATEWAY_CLIENT,
      clientMode: GATEWAY_CLIENT_MODES.BACKEND,
    });

    let backendReconnectWs: WebSocket | undefined;

    try {
      backendReconnectWs = await openTrackedWs(started.port);
      const reconnectAttempt = await connectReq(backendReconnectWs, {
        token: "secret",
        deviceIdentityPath: paired.identityPath,
        client: {
          id: GATEWAY_CLIENT_NAMES.GATEWAY_CLIENT,
          version: "1.0.0",
          platform: "node",
          mode: GATEWAY_CLIENT_MODES.BACKEND,
        },
        role: "operator",
        scopes: ["operator.admin"],
      });
      expect(reconnectAttempt.ok).toBe(true);

      const afterAttempt = await getPairedDevice(paired.deviceId);
      expect(afterAttempt?.approvedScopes).toEqual(
        expect.arrayContaining(["operator.read", "operator.admin"]),
      );
    } finally {
      backendReconnectWs?.close();
      started.ws.close();
      await started.server.close();
      started.envSnapshot.restore();
    }
  });

  test("accepts local silent reconnect when pairing was concurrently approved", async () => {
    const started = await startServerWithClient("secret");
    const loaded = loadDeviceIdentity("silent-reconnect-race");
    let ws: WebSocket | undefined;

    const approveOriginal = devicePairingModule.approveDevicePairing;
    let simulatedRace = false;
    const forwardApprove = async (requestId: string, optionsOrBaseDir?: unknown) => {
      if (optionsOrBaseDir && typeof optionsOrBaseDir === "object") {
        return await approveOriginal(
          requestId,
          optionsOrBaseDir as { callerScopes?: readonly string[] },
        );
      }
      return await approveOriginal(requestId);
    };
    const approveSpy = vi
      .spyOn(devicePairingModule, "approveDevicePairing")
      .mockImplementation(async (requestId: string, optionsOrBaseDir?: unknown) => {
        if (simulatedRace) {
          return await forwardApprove(requestId, optionsOrBaseDir);
        }
        simulatedRace = true;
        await forwardApprove(requestId, optionsOrBaseDir);
        return null;
      });

    try {
      ws = await openTrackedWs(started.port);
      const res = await connectReq(ws, {
        token: "secret",
        deviceIdentityPath: loaded.identityPath,
      });
      expect(res.ok).toBe(true);

      const paired = await getPairedDevice(loaded.identity.deviceId);
      expect(paired?.publicKey).toBe(loaded.publicKey);
      expect(paired?.tokens?.operator?.token).toBeTruthy();
    } finally {
      approveSpy.mockRestore();
      ws?.close();
      started.ws.close();
      await started.server.close();
      started.envSnapshot.restore();
    }
  });

  test("does not rebroadcast a deleted silent pairing request after a concurrent rejection", async () => {
    const started = await startServerWithClient("secret");
    const loaded = loadDeviceIdentity("silent-reconnect-reject-race");
    let ws: WebSocket | undefined;

    const approveSpy = vi
      .spyOn(devicePairingModule, "approveDevicePairing")
      .mockImplementation(async (requestId: string) => {
        await devicePairingModule.rejectDevicePairing(requestId);
        return null;
      });

    try {
      await connectOk(started.ws, { scopes: ["operator.pairing"], device: null });
      const requestedEvent = onceMessage(
        started.ws,
        (obj) => obj.type === "event" && obj.event === "device.pair.requested",
        300,
      )
        .then((event) => ({ ok: true as const, event }))
        .catch((error: unknown) => ({ ok: false as const, error }));

      ws = await openTrackedWs(started.port);
      const res = await connectReq(ws, {
        token: "secret",
        deviceIdentityPath: loaded.identityPath,
      });

      expect(res.ok).toBe(false);
      expect(res.error?.message).toBe("pairing required");
      expect(
        (res.error?.details as { requestId?: unknown; code?: string } | undefined)?.requestId,
      ).toBeUndefined();
      const requested = await requestedEvent;
      expect(requested.ok).toBe(false);
      if (requested.ok) {
        throw new Error("expected pairing request watcher to time out");
      }
      expect(requested.error).toBeInstanceOf(Error);
      expect((requested.error as Error).message).toContain("timeout");

      const pending = await devicePairingModule.listDevicePairing();
      expect(pending.pending).toEqual([]);
    } finally {
      approveSpy.mockRestore();
      ws?.close();
      started.ws.close();
      await started.server.close();
      started.envSnapshot.restore();
    }
  });

  test("returns the replacement pending request id when a silent request is superseded", async () => {
    const started = await startServerWithClient("secret");
    const loaded = loadDeviceIdentity("silent-reconnect-supersede-race");
    let ws: WebSocket | undefined;
    let replacementRequestId = "";

    const approveSpy = vi
      .spyOn(devicePairingModule, "approveDevicePairing")
      .mockImplementation(async (_requestId: string) => {
        const replacement = await devicePairingModule.requestDevicePairing({
          deviceId: loaded.identity.deviceId,
          publicKey: loaded.publicKey,
          role: "operator",
          scopes: ["operator.read"],
          clientId: GATEWAY_CLIENT_NAMES.TEST,
          clientMode: GATEWAY_CLIENT_MODES.TEST,
          silent: false,
        });
        replacementRequestId = replacement.request.requestId;
        return null;
      });

    try {
      ws = await openTrackedWs(started.port);
      const res = await connectReq(ws, {
        token: "secret",
        deviceIdentityPath: loaded.identityPath,
      });

      expect(res.ok).toBe(false);
      expect(res.error?.message).toBe("pairing required");
      expect(replacementRequestId).toBeTruthy();
      expect(
        (res.error?.details as { requestId?: unknown; code?: string } | undefined)?.requestId,
      ).toBe(replacementRequestId);

      const pending = await devicePairingModule.listDevicePairing();
      expect(pending.pending.map((entry) => entry.requestId)).toContain(replacementRequestId);
    } finally {
      approveSpy.mockRestore();
      ws?.close();
      started.ws.close();
      await started.server.close();
      started.envSnapshot.restore();
    }
  });
});
