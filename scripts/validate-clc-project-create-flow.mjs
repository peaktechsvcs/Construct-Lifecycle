import { spawn } from "node:child_process";
import { once } from "node:events";
const appPort = Number(process.env.CLC_PROJECT_CREATE_TEST_PORT ?? 22784);
const debuggingPort = Number(process.env.CLC_PROJECT_CREATE_DEBUG_PORT ?? 22785);
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
  throw new Error("Timed out waiting for the project-create test server");
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

async function checkPermittedRole(role) {
  const { target, client } = await openTarget(
    `/dashboard/drilldown/active-projects?browserAuth=authenticated&browserRole=${role}`,
  );
  try {
    await waitFor(
      client,
      `${role} empty-state action`,
      `(() => ({
        ready: document.body?.innerText?.includes("No active projects") === true
          && document.querySelector('a[href="/projects?create=1"]') !== null,
      }))()`,
    );

    const clicked = await evaluate(client, `(() => {
      const action = document.querySelector('a[href="/projects?create=1"]');
      if (!(action instanceof HTMLElement)) return false;
      action.click();
      return true;
    })()`);
    if (!clicked) throw new Error(`${role} could not activate the empty-state create action`);

    await waitFor(
      client,
      `${role} project form modal`,
      `(() => ({
        ready: document.querySelector('[role="dialog"] h2')?.textContent?.trim() === "Create a new project",
        url: window.location.href,
        body: document.body?.innerText?.slice(-1000) ?? "",
        newProjectButton: document.querySelector('[data-testid="button-new-project"]') !== null,
      }))()`,
    );

    const defaults = await evaluate(client, `(() => {
      const dialog = document.querySelector('[role="dialog"]');
      return {
        title: dialog?.querySelector('h2')?.textContent?.trim() ?? "",
        stage: dialog?.querySelector('[data-testid="select-project-stage"]')?.value ?? "",
        customerInput: dialog?.querySelector('[data-testid="input-project-customer"]') instanceof HTMLInputElement,
      };
    })()`);
    if (defaults.title !== "Create a new project") throw new Error(`${role} opened the wrong form: ${defaults.title}`);
    if (defaults.stage !== "opportunity") throw new Error(`${role} lost the normal workflow default: stage=${defaults.stage}`);
    if (!defaults.customerInput) throw new Error(`${role} did not render the customer selector`);

    const focused = await evaluate(client, `(() => {
      const input = document.querySelector('[data-testid="input-project-customer"]');
      if (!(input instanceof HTMLInputElement)) return false;
      input.focus();
      input.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
      return true;
    })()`);
    if (!focused) throw new Error(`${role} could not open the customer selector`);
    await waitFor(
      client,
      `${role} customer selector`,
      `(() => ({
        ready: [...document.querySelectorAll('[role="option"]')]
          .some((option) => option.textContent?.includes("Browser Test Customer")),
        listboxes: document.querySelectorAll('[role="listbox"]').length,
        active: document.activeElement?.getAttribute("data-testid") ?? "",
        body: document.body?.innerText?.slice(-600) ?? "",
      }))()`,
    );
    const selected = await evaluate(client, `(() => {
      const option = [...document.querySelectorAll('[role="option"]')]
        .find((candidate) => candidate.textContent?.includes("Browser Test Customer"));
      if (!(option instanceof HTMLElement)) return false;
      option.click();
      return true;
    })()`);
    if (!selected) throw new Error(`${role} could not select the existing customer`);
    await waitFor(
      client,
      `${role} selected customer`,
      `(() => ({
        ready: document.querySelector('[data-testid="input-project-customer"]')?.value === "Browser Test Customer",
      }))()`,
    );
    console.log(`✔ ${role} can open the project form from the empty state`);
  } finally {
    await closeTarget(target, client);
  }
}

async function checkRestrictedRole() {
  const { target, client } = await openTarget(
    "/dashboard/drilldown/active-projects?browserAuth=authenticated&browserRole=viewer",
  );
  try {
    await waitFor(
      client,
      "viewer empty-state guidance",
      `(() => ({
        ready: document.body?.innerText?.includes("No active projects") === true
          && document.querySelector('a[href="/projects?create=1"]') === null,
      }))()`,
    );
    console.log("✔ viewer does not receive the project create action");
  } finally {
    await closeTarget(target, client);
  }
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
  `--user-data-dir=/tmp/clc-project-create-chromium-${process.pid}`,
  "about:blank",
], {
  stdio: ["ignore", "pipe", "pipe"],
});
let output = "";
server.stdout.on("data", (chunk) => { output += chunk; });
server.stderr.on("data", (chunk) => { output += chunk; });
browser.stdout.on("data", (chunk) => { output += chunk; });
browser.stderr.on("data", (chunk) => { output += chunk; });

try {
  await Promise.all([waitForServer(server), waitForDevTools()]);
  for (const role of ["owner", "admin", "member"]) await checkPermittedRole(role);
  await checkRestrictedRole();
  console.log("Validated empty-state project creation for all project roles.");
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  if (output) console.error(output);
  process.exitCode = 1;
} finally {
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
    if (browser.exitCode === null && browser.signalCode === null) {
      browser.kill("SIGKILL");
      await once(browser, "exit");
    }
  }
}