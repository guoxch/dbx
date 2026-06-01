#!/usr/bin/env node
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";

const root = new URL("..", import.meta.url).pathname;
const chromePath = process.env.CHROME_PATH || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const vitePort = Number(process.env.DBX_GRID_BENCH_PORT || 5187);
const chromePort = Number(process.env.DBX_GRID_BENCH_CHROME_PORT || 9339);
const sampleCount = Number(process.env.DBX_GRID_BENCH_SAMPLES || 3);
const scenarios = [
  { rows: 1000, cols: 20 },
  { rows: 1000, cols: 200 },
  { rows: 5000, cols: 200 },
];

const modes = ["dom", "canvas"];

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForHttp(url, timeoutMs = 30000) {
  const started = Date.now();
  let lastError;
  while (Date.now() - started < timeoutMs) {
    try {
      const response = await fetch(url);
      if (response.ok) return response;
      lastError = new Error(`HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await sleep(250);
  }
  throw lastError ?? new Error(`Timed out waiting for ${url}`);
}

function spawnProcess(command, args, options = {}) {
  const { pipeStdout = true, pipeStderr = true, ...spawnOptions } = options;
  const child = spawn(command, args, {
    cwd: root,
    stdio: ["ignore", "pipe", "pipe"],
    ...spawnOptions,
  });
  if (pipeStdout) child.stdout.on("data", (chunk) => process.stdout.write(chunk));
  if (pipeStderr) child.stderr.on("data", (chunk) => process.stderr.write(chunk));
  return child;
}

async function stopProcess(child) {
  if (!child || child.exitCode != null) return;
  child.kill("SIGTERM");
  await Promise.race([
    new Promise((resolve) => child.once("exit", resolve)),
    sleep(3000).then(() => {
      if (child.exitCode == null) child.kill("SIGKILL");
    }),
  ]);
}

class CdpClient {
  constructor(socket) {
    this.socket = socket;
    this.nextId = 1;
    this.pending = new Map();
    this.events = new Map();
    socket.addEventListener("message", (event) => {
      const message = JSON.parse(event.data);
      if (message.id && this.pending.has(message.id)) {
        const { resolve, reject } = this.pending.get(message.id);
        this.pending.delete(message.id);
        if (message.error) reject(new Error(message.error.message));
        else resolve(message.result);
        return;
      }
      const handlers = this.events.get(message.method);
      if (handlers) handlers.forEach((handler) => handler(message.params));
    });
  }

  static async connect(wsUrl) {
    const socket = new WebSocket(wsUrl);
    await new Promise((resolve, reject) => {
      socket.addEventListener("open", resolve, { once: true });
      socket.addEventListener("error", reject, { once: true });
    });
    return new CdpClient(socket);
  }

  command(method, params = {}, sessionId) {
    const id = this.nextId;
    this.nextId += 1;
    this.socket.send(JSON.stringify({ id, method, params, sessionId }));
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
    });
  }

  on(method, handler) {
    const handlers = this.events.get(method) ?? [];
    handlers.push(handler);
    this.events.set(method, handlers);
  }

  close() {
    this.socket.close();
  }
}

async function getChromeRssMiB(rootPid) {
  const ps = spawn("ps", ["-axo", "pid=,ppid=,rss=,command="], { stdio: ["ignore", "pipe", "ignore"] });
  let output = "";
  ps.stdout.on("data", (chunk) => {
    output += chunk;
  });
  await new Promise((resolve) => ps.once("exit", resolve));
  const rows = output
    .trim()
    .split("\n")
    .map((line) => {
      const match = line.trim().match(/^(\d+)\s+(\d+)\s+(\d+)\s+(.*)$/);
      if (!match) return null;
      return {
        pid: Number(match[1]),
        ppid: Number(match[2]),
        rssKiB: Number(match[3]),
        command: match[4],
      };
    })
    .filter(Boolean);
  const children = new Map();
  for (const row of rows) {
    const bucket = children.get(row.ppid) ?? [];
    bucket.push(row);
    children.set(row.ppid, bucket);
  }
  const descendants = [];
  const stack = [rootPid];
  while (stack.length > 0) {
    const pid = stack.pop();
    const row = rows.find((candidate) => candidate.pid === pid);
    if (row) descendants.push(row);
    for (const child of children.get(pid) ?? []) stack.push(child.pid);
  }
  return descendants.reduce((sum, row) => sum + row.rssKiB, 0) / 1024;
}

async function measureOnce({ mode, rows, cols }) {
  const userDataDir = await mkdtemp(join(tmpdir(), "dbx-grid-bench-"));
  const chrome = spawnProcess(chromePath, [
    "--headless=new",
    `--remote-debugging-port=${chromePort}`,
    `--user-data-dir=${userDataDir}`,
    "--disable-background-networking",
    "--disable-default-apps",
    "--disable-extensions",
    "--disable-sync",
    "--js-flags=--expose-gc",
    "about:blank",
  ], { pipeStdout: false, pipeStderr: false });
  try {
    const version = await waitForHttp(`http://127.0.0.1:${chromePort}/json/version`);
    const { webSocketDebuggerUrl } = await version.json();
    const browser = await CdpClient.connect(webSocketDebuggerUrl);
    const target = await browser.command("Target.createTarget", {
      url: `http://127.0.0.1:${vitePort}/perf-grid.html?mode=${mode}&rows=${rows}&cols=${cols}`,
    });
    const attach = await browser.command("Target.attachToTarget", { targetId: target.targetId, flatten: true });
    const sessionId = attach.sessionId;
    const command = (method, params = {}) => browser.command(method, params, sessionId);

    await command("Runtime.enable");
    await command("Page.enable");
    await command("Emulation.setDeviceMetricsOverride", {
      width: 1440,
      height: 900,
      deviceScaleFactor: 1,
      mobile: false,
    });
    await waitUntilReady(command);
    await command("HeapProfiler.enable");
    for (let i = 0; i < 3; i += 1) {
      await command("HeapProfiler.collectGarbage");
      await command("Runtime.evaluate", { expression: "globalThis.gc?.()", awaitPromise: true });
      await sleep(120);
    }
    const heap = await command("Runtime.getHeapUsage");
    const metricsResult = await command("Runtime.evaluate", {
      expression: "window.__DBX_GRID_BENCH_METRICS?.()",
      returnByValue: true,
    });
    const rssMiB = await getChromeRssMiB(chrome.pid);
    browser.close();
    return {
      mode,
      rows,
      cols,
      jsHeapMiB: heap.usedSize / 1024 / 1024,
      rssMiB,
      ...metricsResult.result.value,
    };
  } finally {
    await stopProcess(chrome);
    await rm(userDataDir, { recursive: true, force: true });
  }
}

async function waitUntilReady(command) {
  const started = Date.now();
  while (Date.now() - started < 30000) {
    const result = await command("Runtime.evaluate", {
      expression: "Boolean(window.__DBX_GRID_BENCH_READY)",
      returnByValue: true,
    });
    if (result.result.value) return;
    await sleep(200);
  }
  throw new Error("Benchmark page did not become ready");
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

function medianResult(samples) {
  const byHeap = [...samples].sort((a, b) => a.jsHeapMiB - b.jsHeapMiB);
  const base = { ...byHeap[Math.floor(byHeap.length / 2)] };
  for (const key of ["jsHeapMiB", "rssMiB", "elements", "nodes", "canvases", "dataGridCells", "dataGridRows", "dataGridHeaders"]) {
    base[key] = median(samples.map((sample) => sample[key]));
  }
  return base;
}

function formatMiB(value) {
  return value.toFixed(1);
}

function pct(delta, base) {
  return `${((delta / base) * 100).toFixed(1)}%`;
}

async function main() {
  const vite = spawnProcess("pnpm", [
    "exec",
    "vite",
    "--config",
    "apps/desktop/vite.config.ts",
    "--host",
    "127.0.0.1",
    "--port",
    String(vitePort),
  ]);
  const results = [];
  try {
    await waitForHttp(`http://127.0.0.1:${vitePort}/perf-grid.html`);
    for (const scenario of scenarios) {
      for (const mode of modes) {
        const samples = [];
        for (let sample = 0; sample < sampleCount; sample += 1) {
          process.stderr.write(`[grid-bench] ${mode} ${scenario.rows}x${scenario.cols} sample ${sample + 1}/${sampleCount}\n`);
          samples.push(await measureOnce({ mode, ...scenario }));
        }
        results.push(medianResult(samples));
      }
    }
  } finally {
    await stopProcess(vite);
  }

  const rows = [];
  for (const scenario of scenarios) {
    const dom = results.find((result) => result.mode === "dom" && result.rows === scenario.rows && result.cols === scenario.cols);
    const canvas = results.find(
      (result) => result.mode === "canvas" && result.rows === scenario.rows && result.cols === scenario.cols,
    );
    rows.push({
      scenario: `${scenario.rows} x ${scenario.cols}`,
      dom,
      canvas,
      heapDelta: canvas.jsHeapMiB - dom.jsHeapMiB,
      rssDelta: canvas.rssMiB - dom.rssMiB,
      elementDelta: canvas.elements - dom.elements,
      nodeDelta: canvas.nodes - dom.nodes,
    });
  }

  console.log("\nRaw median results:");
  console.log(JSON.stringify(results, null, 2));
  console.log("\nSummary:");
  console.log("| Scenario | DOM JS MiB | Canvas JS MiB | JS Delta | DOM RSS MiB | Canvas RSS MiB | RSS Delta | DOM Elements | Canvas Elements | Element Delta |");
  console.log("| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |");
  for (const row of rows) {
    console.log(
      `| ${row.scenario} | ${formatMiB(row.dom.jsHeapMiB)} | ${formatMiB(row.canvas.jsHeapMiB)} | ${formatMiB(row.heapDelta)} (${pct(row.heapDelta, row.dom.jsHeapMiB)}) | ${formatMiB(row.dom.rssMiB)} | ${formatMiB(row.canvas.rssMiB)} | ${formatMiB(row.rssDelta)} (${pct(row.rssDelta, row.dom.rssMiB)}) | ${row.dom.elements} | ${row.canvas.elements} | ${row.elementDelta} |`,
    );
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
