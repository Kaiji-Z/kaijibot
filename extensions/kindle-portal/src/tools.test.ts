import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Hoisted mocks — vi.hoisted ensures the mock functions are available in both
// the vi.mock factory (module-eval time) and the test bodies (runtime).
// ---------------------------------------------------------------------------

const mocks = vi.hoisted(() => ({
  networkInterfaces: vi.fn(),
  homedir: vi.fn(),
  readFile: vi.fn(),
  writeFile: vi.fn(),
  httpGet: vi.fn(),
}));

vi.mock("node:os", () => ({
  default: {
    networkInterfaces: mocks.networkInterfaces,
    homedir: mocks.homedir,
  },
  networkInterfaces: mocks.networkInterfaces,
  homedir: mocks.homedir,
}));

vi.mock("node:fs/promises", () => ({
  default: {
    readFile: mocks.readFile,
    writeFile: mocks.writeFile,
  },
  readFile: mocks.readFile,
  writeFile: mocks.writeFile,
}));

vi.mock("node:http", () => ({
  default: { get: mocks.httpGet },
  get: mocks.httpGet,
}));

// Import AFTER vi.mock so the module picks up the mocked builtins.
import { createKindleSetupTool, createKindleStatusTool } from "./tools.js";

// ---------------------------------------------------------------------------
// Mock helper factories
// ---------------------------------------------------------------------------

const LAN_IP = "192.168.1.42";

/** A network interface entry that looks like a real LAN IPv4 address. */
const lanIface = (ip: string = LAN_IP) => [
  {
    address: ip,
    netmask: "255.255.255.0",
    family: "IPv4",
    mac: "aa:bb:cc:dd:ee:ff",
    internal: false,
    cidr: `${ip}/24`,
  },
];

/** Loopback-only interfaces (no LAN IP). */
const loopbackOnly = () => ({
  lo: [
    {
      address: "127.0.0.1",
      netmask: "255.0.0.0",
      family: "IPv4",
      mac: "00:00:00:00:00:00",
      internal: true,
      cidr: "127.0.0.1/8",
    },
  ],
});

/**
 * Configure the mocked os.networkInterfaces to return a single LAN interface.
 */
function setLanIp(ip: string = LAN_IP): void {
  mocks.networkInterfaces.mockReturnValue({ eth0: lanIface(ip) });
  mocks.homedir.mockReturnValue("/home/testuser");
}

/**
 * Configure fs.readFile to return the given config object as JSON.
 */
function setConfigRead(config: Record<string, unknown>): void {
  mocks.readFile.mockResolvedValue(JSON.stringify(config));
}

/**
 * Extract the config object that was written by the last writeFile call.
 */
async function getWrittenConfig(): Promise<Record<string, unknown>> {
  expect(mocks.writeFile).toHaveBeenCalled();
  const content = mocks.writeFile.mock.calls[mocks.writeFile.mock.calls.length - 1][1] as string;
  return JSON.parse(content) as Record<string, unknown>;
}

/**
 * Make http.get respond with a successful (200) response.
 */
function setHttpGetSuccess(statusCode = 200): void {
  mocks.httpGet.mockImplementation((_url: string, cb: (res: EventEmitter) => void) => {
    const res = new EventEmitter();
    (res as EventEmitter & { statusCode: number }).statusCode = statusCode;
    (res as EventEmitter & { resume: () => void }).resume = vi.fn();
    const req = new EventEmitter();
    (req as EventEmitter & { setTimeout: () => void }).setTimeout = vi.fn();
    (req as EventEmitter & { destroy: () => void }).destroy = vi.fn();
    // Defer to a microtask so the caller can attach listeners synchronously.
    queueMicrotask(() => {
      cb(res);
      res.emit("end");
    });
    return req;
  });
}

/**
 * Make http.get emit an error on the request object.
 */
function setHttpGetError(): void {
  mocks.httpGet.mockImplementation((_url: string, _cb: (res: EventEmitter) => void) => {
    const req = new EventEmitter();
    (req as EventEmitter & { setTimeout: () => void }).setTimeout = vi.fn();
    (req as EventEmitter & { destroy: () => void }).destroy = vi.fn();
    queueMicrotask(() => {
      req.emit("error", new Error("connect ECONNREFUSED 127.0.0.1:18789"));
    });
    return req;
  });
}

/**
 * Make http.get fail the first N calls, then succeed.
 */
function setHttpGetFailThenSuccess(failCount: number): void {
  let call = 0;
  mocks.httpGet.mockImplementation((_url: string, cb: (res: EventEmitter) => void) => {
    const current = call++;
    const req = new EventEmitter();
    (req as EventEmitter & { setTimeout: () => void }).setTimeout = vi.fn();
    (req as EventEmitter & { destroy: () => void }).destroy = vi.fn();
    if (current < failCount) {
      queueMicrotask(() => req.emit("error", new Error("ECONNREFUSED")));
    } else {
      const res = new EventEmitter();
      (res as EventEmitter & { statusCode: number }).statusCode = 200;
      (res as EventEmitter & { resume: () => void }).resume = vi.fn();
      queueMicrotask(() => {
        cb(res);
        res.emit("end");
      });
    }
    return req;
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("kindle_setup tool", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setLanIp();
    setHttpGetSuccess();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns URL with detected LAN IP on success", async () => {
    setConfigRead({});
    const tool = createKindleSetupTool({ pollIntervalMs: 1, pollTimeoutMs: 50 });
    const result = await tool.execute("call-1", {});

    expect(result.content[0]?.type).toBe("text");
    const text = (result.content[0] as { text: string }).text;
    expect(text).toContain("http://192.168.1.42:18789");
    expect(result.details).toMatchObject({
      url: "http://192.168.1.42:18789/kindle/",
      lanIp: "192.168.1.42",
      ready: true,
    });
  });

  it("enables plugin in config", async () => {
    setConfigRead({ plugins: { entries: {} } });
    const tool = createKindleSetupTool({ pollIntervalMs: 1, pollTimeoutMs: 50 });
    await tool.execute("call-2", {});

    const written = await getWrittenConfig();
    const entry = (written as Record<string, unknown>).plugins as
      | Record<string, unknown>
      | undefined;
    const entries = entry?.entries as Record<string, unknown> | undefined;
    const kindleEntry = entries?.["kindle-portal"] as Record<string, unknown> | undefined;
    expect(kindleEntry?.enabled).toBe(true);
  });

  it("changes gateway.bind from loopback to lan", async () => {
    setConfigRead({ gateway: { bind: "loopback" } });
    const tool = createKindleSetupTool({ pollIntervalMs: 1, pollTimeoutMs: 50 });
    const result = await tool.execute("call-3", {});

    const written = await getWrittenConfig();
    expect((written as Record<string, unknown>).gateway).toMatchObject({ bind: "lan" });
    expect(result.details).toMatchObject({ bindChanged: true });
  });

  it("changes gateway.bind from undefined to lan", async () => {
    setConfigRead({ gateway: {} });
    const tool = createKindleSetupTool({ pollIntervalMs: 1, pollTimeoutMs: 50 });
    const result = await tool.execute("call-4", {});

    const written = await getWrittenConfig();
    expect((written as Record<string, unknown>).gateway).toMatchObject({ bind: "lan" });
    expect(result.details).toMatchObject({ bindChanged: true });
  });

  it("does not change bind if already lan", async () => {
    setConfigRead({ gateway: { bind: "lan" } });
    const tool = createKindleSetupTool({ pollIntervalMs: 1, pollTimeoutMs: 50 });
    const result = await tool.execute("call-5", {});

    const written = await getWrittenConfig();
    expect((written as Record<string, unknown>).gateway).toMatchObject({ bind: "lan" });
    expect(result.details).toMatchObject({ bindChanged: false });
  });

  it("polls gateway readiness (fail twice then succeed)", async () => {
    setConfigRead({});
    setHttpGetFailThenSuccess(2);
    const tool = createKindleSetupTool({ pollIntervalMs: 1, pollTimeoutMs: 5000 });
    const result = await tool.execute("call-6", {});

    expect(mocks.httpGet.mock.calls.length).toBeGreaterThanOrEqual(3);
    expect(result.details).toMatchObject({ ready: true });
  });

  it("returns partial success if gateway not ready after timeout", async () => {
    setConfigRead({});
    setHttpGetError();
    const tool = createKindleSetupTool({ pollIntervalMs: 1, pollTimeoutMs: 20 });
    const result = await tool.execute("call-7", {});

    expect(result.details).toMatchObject({ ready: false });
    const text = (result.content[0] as { text: string }).text;
    expect(text).toContain("http://192.168.1.42:18789");
  });

  it("returns error if no LAN IP found", async () => {
    mocks.networkInterfaces.mockReturnValue(loopbackOnly());
    setConfigRead({});
    const tool = createKindleSetupTool({ pollIntervalMs: 1, pollTimeoutMs: 50 });
    const result = await tool.execute("call-8", {});

    const text = (result.content[0] as { text: string }).text;
    expect(text.toLowerCase()).toContain("error");
    expect(text.toLowerCase()).toMatch(/lan|network|ip/);
    expect(mocks.writeFile).not.toHaveBeenCalled();
  });

  it("does not set accessToken (LAN-open by default)", async () => {
    setConfigRead({ plugins: { entries: { "kindle-portal": { config: {} } } } });
    const tool = createKindleSetupTool({ pollIntervalMs: 1, pollTimeoutMs: 50 });
    await tool.execute("call-9", {});

    const written = await getWrittenConfig();
    const plugins = (written as Record<string, unknown>).plugins as Record<string, unknown>;
    const entries = plugins.entries as Record<string, Record<string, unknown>>;
    const entry = entries["kindle-portal"];
    const config = entry.config as Record<string, unknown> | undefined;
    expect(config?.accessToken).toBeUndefined();
  });

  it("tool metadata has correct name and label", () => {
    const tool = createKindleSetupTool();
    expect(tool.name).toBe("kindle_setup");
    expect(tool.label).toBe("Kindle Setup");
  });
});

describe("kindle_status tool", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setLanIp();
    setHttpGetSuccess();
  });

  it("returns enabled:true when config says enabled", async () => {
    setConfigRead({ plugins: { entries: { "kindle-portal": { enabled: true } } } });
    const tool = createKindleStatusTool();
    const result = await tool.execute("status-1", {});

    expect(result.details).toMatchObject({ enabled: true });
  });

  it("returns enabled:false when config says disabled", async () => {
    setConfigRead({ plugins: { entries: { "kindle-portal": { enabled: false } } } });
    const tool = createKindleStatusTool();
    const result = await tool.execute("status-2", {});

    expect(result.details).toMatchObject({ enabled: false });
  });

  it("returns reachable:true when /kindle/api/fleet responds 200", async () => {
    setConfigRead({ plugins: { entries: { "kindle-portal": { enabled: true } } } });
    setHttpGetSuccess(200);
    const tool = createKindleStatusTool();
    const result = await tool.execute("status-3", {});

    expect(result.details).toMatchObject({ reachable: true });
  });

  it("returns reachable:false when gateway not responding", async () => {
    setConfigRead({ plugins: { entries: { "kindle-portal": { enabled: true } } } });
    setHttpGetError();
    const tool = createKindleStatusTool();
    const result = await tool.execute("status-4", {});

    expect(result.details).toMatchObject({ reachable: false });
  });

  it("includes URL in result", async () => {
    setConfigRead({ plugins: { entries: { "kindle-portal": { enabled: true } } } });
    const tool = createKindleStatusTool();
    const result = await tool.execute("status-5", {});

    expect(result.details).toMatchObject({ url: "http://192.168.1.42:18789/kindle/" });
    const text = (result.content[0] as { text: string }).text;
    expect(text).toContain("http://192.168.1.42:18789");
  });

  it("includes bind in details", async () => {
    setConfigRead({
      gateway: { bind: "lan" },
      plugins: { entries: { "kindle-portal": { enabled: true } } },
    });
    const tool = createKindleStatusTool();
    const result = await tool.execute("status-6", {});

    expect(result.details).toMatchObject({ bind: "lan" });
  });

  it("defaults bind to loopback when unset", async () => {
    setConfigRead({});
    const tool = createKindleStatusTool();
    const result = await tool.execute("status-7", {});

    expect(result.details).toMatchObject({ bind: "loopback" });
  });

  it("tool metadata has correct name and label", () => {
    const tool = createKindleStatusTool();
    expect(tool.name).toBe("kindle_status");
    expect(tool.label).toBe("Kindle Status");
  });
});
