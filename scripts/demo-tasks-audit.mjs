#!/usr/bin/env node
/**
 * T12 demo — reproducible task-audit chain (M4).
 *
 * Drives the same RPCs the Control UI "任务" panel consumes, against a live
 * gateway, and prints the execution trail. Reproduction:
 *
 *   1. Ensure the gateway runs with cognitive.tasks.enabled=true
 *      (kaijibot config set cognitive.tasks.enabled true && pnpm gw:deploy).
 *   2. Ask the agent (chat / Feishu) to delegate a multi-step task — e.g.
 *      "帮我建一个任务：调研 X 并写一页摘要" — the task_create tool queues it.
 *   3. Run this script:
 *
 *        node scripts/demo-tasks-audit.mjs [--url ws://127.0.0.1:18789]
 *                                          [--token <gateway token>]
 *                                          [--get <taskId>] [--user <userId>]
 *                                          [--all]
 *
 *      --token defaults to KAIJIBOT_GATEWAY_TOKEN / the token in
 *      ~/.kaijibot/kaijibot.json (gateway.auth.token).
 *      --all includes finished tasks; --get prints one task's full steps.
 *
 * Then open the Control UI → 任务 tab to see the same trail rendered.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import WebSocket from "ws";

function parseArgs(argv) {
  const options = {
    url: process.env.KAIJIBOT_GATEWAY_URL ?? "ws://127.0.0.1:18789",
    token: process.env.KAIJIBOT_GATEWAY_TOKEN ?? null,
    get: null,
    user: null,
    all: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = () => {
      i += 1;
      if (!argv[i]) {
        throw new Error(`Missing value for ${arg}`);
      }
      return argv[i];
    };
    if (arg === "--url") {
      options.url = next();
    } else if (arg === "--token") {
      options.token = next();
    } else if (arg === "--get") {
      options.get = next();
    } else if (arg === "--user") {
      options.user = next();
    } else if (arg === "--all") {
      options.all = true;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return options;
}

function readTokenFromConfig() {
  for (const candidate of [
    process.env.KAIJIBOT_CONFIG_PATH,
    path.join(os.homedir(), ".kaijibot", "kaijibot.json"),
  ]) {
    if (!candidate || !fs.existsSync(candidate)) {
      continue;
    }
    try {
      const cfg = JSON.parse(fs.readFileSync(candidate, "utf-8"));
      const token = cfg?.gateway?.auth?.token;
      if (typeof token === "string" && token) {
        return token;
      }
    } catch {
      // ignore unreadable config
    }
  }
  return null;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const token = options.token ?? readTokenFromConfig();
  if (!token) {
    console.error("No gateway token: pass --token or set KAIJIBOT_GATEWAY_TOKEN.");
    process.exit(1);
  }

  const ws = new WebSocket(options.url, { headers: { Authorization: `Bearer ${token}` } });
  const pending = new Map();
  let nextId = 1;

  const request = (method, params) =>
    new Promise((resolve, reject) => {
      const id = `demo-${nextId++}`;
      pending.set(id, { resolve, reject });
      ws.send(JSON.stringify({ type: "req", id, method, params }));
    });

  ws.on("message", (raw) => {
    const frame = JSON.parse(String(raw));
    if (frame.type === "res" && pending.has(frame.id)) {
      const entry = pending.get(frame.id);
      pending.delete(frame.id);
      if (frame.error) {
        entry.reject(new Error(JSON.stringify(frame.error)));
      } else {
        entry.resolve(frame.result);
      }
    }
  });

  const opened = new Promise((resolve, reject) => {
    const connectTimeout = setTimeout(
      () => reject(new Error(`connect timeout: ${options.url}`)),
      10_000,
    );
    ws.once("open", () => {
      clearTimeout(connectTimeout);
      resolve();
    });
    ws.once("error", (err) => {
      clearTimeout(connectTimeout);
      reject(err);
    });
  });
  await opened;

  try {
    await request("connect", {
      minProtocol: 1,
      maxProtocol: 3,
      client: {
        id: "cli",
        version: "dev",
        platform: process.platform,
        mode: "cli",
      },
      token,
    });

    if (options.get) {
      if (!options.user) {
        throw new Error("--get requires --user <userId>");
      }
      const res = await request("tasks.get", { taskId: options.get, userId: options.user });
      console.log(JSON.stringify(res, null, 2));
      return;
    }

    const res = await request("tasks.list", { includeFinished: options.all });
    const tasks = res?.tasks ?? [];
    console.log(`tasks.list → ${tasks.length} task(s)${options.all ? " (incl. finished)" : ""}`);
    for (const task of tasks) {
      console.log(
        `  [${task.status}] ${task.agentId}/${task.userId} · 步骤 ${task.usedSteps}/${task.maxSteps} · ${task.goal}`,
      );
    }
    if (tasks.length > 0) {
      const first = tasks[0];
      const detail = await request("tasks.get", { taskId: first.id, userId: first.userId });
      console.log("\ntasks.get (first task) execution trail:");
      for (const step of detail?.task?.steps ?? []) {
        console.log(`  ${step.index}. [${step.status}] ${step.summary}`);
      }
      if (detail?.task?.result) {
        console.log(`  result: ${detail.task.result}`);
      }
      console.log(`\nOpen the Control UI → 任务 tab to see this trail rendered.`);
    }
  } finally {
    ws.close();
  }
}

main().catch((err) => {
  console.error(String(err));
  process.exit(1);
});
