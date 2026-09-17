import { spawn } from "node:child_process";
import { once } from "node:events";

const appPort = Number(process.env.CLC_BRANDING_SAVE_TEST_PORT ?? 22786);
const debuggingPort = Number(process.env.CLC_BRANDING_SAVE_DEBUG_PORT ?? 22787);
const baseUrl = `http://127.0.0.1:${appPort}`;
const chromium = process.env.CHROMIUM_PATH ?? "/repl/tools/bin/chromium";

class CdpClient {
  constructor(socket) {
    this.socket = socket;
    this.nextId = 1;
    this.pending = new Map();
    socket.addEventListener("message", (event) => {
      const message = JSON.parse(String(event.data));
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      if (message.error) pending.reject(new Error(message.error.message));
      else pending.resolve(message.result);
    });
  }

  static async connect(url) {
    const socket = new WebSocket(url);
    await new Promise((resolve, reject) => {
      socket.addEventListener("open", resolve, { once: true });
      socket.addEventListener("error", () => reject(new Error("Could not connect to Chromium DevTools")), { once: true });
    });
    return new CdpClient(socket);
  }

  command(method, params = {}) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  close() {
    this.socket.close();
  }
}

async function evaluate(client, expression) {
  const result = await client.command("Runtime.evaluate", {
    expression,
    returnByValue: true,
    awaitPromise: true,
  });
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.exception?.description ?? "Browser evaluation failed");
  }
  return result.result.value;
}

async function waitForServer(child) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(baseUrl);
      if (response.status < 500) return;
    } catch {
      // Vite is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("Timed out waiting for the branding-save test server");
}

async function waitForDevTools() {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${debuggingPort}/json/version`);
      if (response.ok) return;
    } catch {
      // Chromium is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("Timed out waiting for Chromium DevTools");
}

async function waitFor(client, description, predicate) {
  const deadline = Date.now() + 12_000;
  let state;
  while (Date.now() < deadline) {
    state = await evaluate(client, predicate);
    if (state?.ready) return state;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`${description} did not become ready: ${JSON.stringify(state)}`);
}

async function openTarget(path) {
  const response = await fetch(
    `http://127.0.0.1:${debuggingPort}/json/new?${encodeURIComponent(`${baseUrl}${path}`)}`,
    { method: "PUT" },
  );
  if (!response.ok) throw new Error(`Could not create Chromium target: ${response.status}`);
  const target = await response.json();
  const client = await CdpClient.connect(target.webSocketDebuggerUrl);
  await Promise.all([client.command("Page.enable"), client.command("Runtime.enable")]);
  await client.command("Page.navigate", { url: `${baseUrl}${path}` });
  return { target, client };
}

async function closeTarget(target, client) {
  client.close();
  await fetch(`http://127.0.0.1:${debuggingPort}/json/close/${target.id}`);
}

const server = spawn("pnpm", ["--filter", "@workspace/clc-projects", "run", "dev"], {
  env: {
    ...process.env,
    BASE_PATH: "/",
    CLC_BROWSER_TEST: "1",
    PORT: String(appPort),
    VITE_CLC_BROWSER_TEST: "1",
  },
  stdio: ["ignore", "pipe", "pipe"],
  detached: true,
});
const browser = spawn(chromium, [
  "--headless=new",
  "--no-sandbox",
  "--disable-gpu",
  "--disable-dev-shm-usage",
  `--remote-debugging-port=${debuggingPort}`,
  `--user-data-dir=/tmp/clc-branding-save-${process.pid}`,
  "about:blank",
], {
  stdio: ["ignore", "pipe", "pipe"],
});
let output = "";
server.stdout.on("data", (chunk) => { output += chunk; });
server.stderr.on("data", (chunk) => { output += chunk; });
browser.stdout.on("data", (chunk) => { output += chunk; });
browser.stderr.on("data", (chunk) => { output += chunk; });

let target;
let client;
try {
  await Promise.all([waitForServer(server), waitForDevTools()]);
  ({ target, client } = await openTarget("/settings/branding?browserAuth=authenticated&browserBranding=save-error"));

  await waitFor(client, "branding page", `(() => ({
    ready: document.readyState === "complete"
      && document.querySelector("h1")?.textContent?.trim() === "Customer Branding"
      && document.querySelector("#branding-primaryColor") !== null,
  }))()`);

  const editedValue = "#123456";
  const inputResult = await evaluate(client, `(() => {
    const input = document.querySelector("#branding-primaryColor");
    if (!(input instanceof HTMLInputElement)) return { ok: false, value: "" };
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    setter?.call(input, ${JSON.stringify(editedValue)});
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
    return { ok: true, value: input.value };
  })()`);
  if (!inputResult?.ok || inputResult.value !== editedValue) {
    throw new Error(`Could not edit the branding color input: ${JSON.stringify(inputResult)}`);
  }

  await waitFor(client, "branding save error", `(() => ({
    ready: document.querySelector('[data-testid="branding-save-error"]')?.textContent?.includes("not persisted") === true
      && document.querySelector('[data-testid="branding-save-retry"]') !== null,
    value: document.querySelector("#branding-primaryColor")?.value ?? "",
  }))()`);

  const failedSaveState = await evaluate(client, `(() => ({
    value: document.querySelector("#branding-primaryColor")?.value ?? "",
    error: document.querySelector('[data-testid="branding-save-error"]')?.textContent ?? "",
  }))()`);
  if (failedSaveState.value !== editedValue) {
    throw new Error(`Failed save replaced the current form value: ${JSON.stringify(failedSaveState)}`);
  }

  await evaluate(client, `document.querySelector('[data-testid="branding-save-retry"]')?.click()`);
  const recoveredState = await waitFor(client, "branding save recovery", `(() => ({
    ready: document.querySelector('[data-testid="branding-save-error"]') === null
      && document.querySelector("#branding-primaryColor")?.value === ${JSON.stringify(editedValue)},
    value: document.querySelector("#branding-primaryColor")?.value ?? "",
  }))()`);
  if (recoveredState.value !== editedValue) {
    throw new Error(`Retry changed the current form value: ${JSON.stringify(recoveredState)}`);
  }
  console.log("✔ branding save failure is visible and retry recovers without losing form values");
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  if (output) console.error(output);
  process.exitCode = 1;
} finally {
  if (target && client) await closeTarget(target, client);
  if (server.exitCode === null && server.signalCode === null && server.pid) {
    try {
      process.kill(-server.pid, "SIGTERM");
    } catch {
      server.kill("SIGTERM");
    }
    await Promise.race([once(server, "exit"), new Promise((resolve) => setTimeout(resolve, 2_000))]);
  }
  if (browser.exitCode === null && browser.signalCode === null) {
    browser.kill("SIGTERM");
    await Promise.race([once(browser, "exit"), new Promise((resolve) => setTimeout(resolve, 2_000))]);
  }
}