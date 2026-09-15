import { spawn } from "node:child_process";
import { once } from "node:events";
import { rm } from "node:fs/promises";

const appPort = Number(process.env.CLC_RESPONSIVE_TEST_PORT ?? 22782);
const debuggingPort = Number(process.env.CLC_RESPONSIVE_DEBUG_PORT ?? 22783);
const baseUrl = `http://127.0.0.1:${appPort}`;
const chromium = process.env.CHROMIUM_PATH ?? "/repl/tools/bin/chromium";
const profileDir = `/tmp/clc-responsive-chromium-${process.pid}`;
const viewports = [
  { name: "mobile", width: 390, height: 844 },
  { name: "desktop", width: 1440, height: 1000 },
];
const cases = [
  {
    name: "public landing",
    path: "/?browserAuth=signed-out",
    heading: "Construct Lifecycle",
    actions: ['a[href="/sign-in"]', 'a[href="/sign-up"]'],
    shell: false,
  },
  {
    name: "authenticated workspace shell",
    path: "/overview?browserAuth=authenticated",
    actions: ['a[data-testid="link-brand"]'],
    shell: true,
  },
  {
    name: "project list",
    path: "/projects?browserAuth=authenticated",
    heading: "Projects",
    actions: ['button[data-testid="button-new-project"]', 'a[data-testid="link-project-42"]'],
    shell: true,
  },
  {
    name: "project detail",
    path: "/projects/42?browserAuth=authenticated",
    heading: "Browser Test Project",
    actions: ['a[data-testid="link-back-projects"]', 'button[data-testid="button-edit-project-detail"]'],
    shell: true,
  },
  {
    name: "active projects empty guidance",
    path: "/dashboard/drilldown/active-projects?browserAuth=authenticated",
    heading: "Active Projects",
    actions: ['a[href="/projects?create=1"]'],
    requiredSelectors: ['a[data-testid="link-drilldown-project-42"]'],
    requiredTexts: [
      "No active projects",
      "Create a project or move a waiting project into Active when work is ready.",
      "Waiting projects",
      "Projects currently carrying the Waiting status.",
      "Browser Test Waiting Project",
    ],
    shell: true,
  },
];

function waitForServer(child) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`Timed out waiting for ${baseUrl}`)), 30_000);
    const check = async () => {
      try {
        const response = await fetch(baseUrl);
        if (response.status < 500) {
          clearTimeout(timeout);
          resolve();
          return;
        }
      } catch {
        // Vite is still starting.
      }
      setTimeout(check, 100);
    };
    child.once("exit", (code) => {
      clearTimeout(timeout);
      reject(new Error(`Responsive test server exited before readiness with code ${code}`));
    });
    check();
  });
}

async function waitForDevTools() {
  const endpoint = `http://127.0.0.1:${debuggingPort}/json/version`;
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(endpoint);
      if (response.ok) return;
    } catch {
      // Chromium is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("Timed out waiting for Chromium DevTools");
}

class CdpClient {
  constructor(socket) {
    this.socket = socket;
    this.nextId = 1;
    this.pending = new Map();
    this.listeners = new Map();
    socket.addEventListener("message", (event) => {
      const message = JSON.parse(String(event.data));
      if (message.id) {
        const pending = this.pending.get(message.id);
        if (!pending) return;
        this.pending.delete(message.id);
        if (message.error) pending.reject(new Error(message.error.message));
        else pending.resolve(message.result);
        return;
      }
      const listeners = this.listeners.get(message.method) ?? [];
      this.listeners.delete(message.method);
      for (const listener of listeners) listener(message.params);
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

  event(method, timeoutMs = 10_000) {
    return new Promise((resolve, reject) => {
      const listener = (params) => {
        clearTimeout(timeout);
        resolve(params);
      };
      const timeout = setTimeout(() => {
        const listeners = this.listeners.get(method) ?? [];
        this.listeners.set(method, listeners.filter((candidate) => candidate !== listener));
        reject(new Error(`Timed out waiting for ${method}`));
      }, timeoutMs);
      this.listeners.set(method, [...(this.listeners.get(method) ?? []), listener]);
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

async function waitForRenderedPage(client, routeCase) {
  const deadline = Date.now() + 12_000;
  let state;
  while (Date.now() < deadline) {
    state = await evaluate(client, `(() => {
      const heading = document.querySelector("h1")?.textContent?.trim() ?? "";
      const expectedHeading = ${JSON.stringify(routeCase.heading ?? "")};
      const shellReady = ${routeCase.shell}
        ? document.querySelector('a[data-testid="link-nav-all-projects"]') !== null
        : true;
      const ready = document.readyState === "complete"
        && heading.length > 0
        && (!expectedHeading || heading === expectedHeading)
        && shellReady;
      return {
        ready,
        heading,
        shellReady,
        body: document.body.innerText.slice(0, 400),
      };
    })()`);
    if (state.ready) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`${routeCase.name}: page did not finish rendering (${JSON.stringify(state)})`);
}

async function inspect(client, routeCase, viewport) {
  if (routeCase.shell && viewport.name === "mobile") {
    const opened = await evaluate(client, `(() => {
      const button = document.querySelector('[data-testid="button-open-menu"]');
      if (!(button instanceof HTMLElement)) return false;
      button.click();
      return true;
    })()`);
    if (!opened) throw new Error(`${routeCase.name} (${viewport.name}): mobile menu button missing`);
    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  return evaluate(client, `(() => {
    const visible = (selector) => {
      const element = document.querySelector(selector);
      if (!(element instanceof HTMLElement)) return false;
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return style.display !== "none" && style.visibility !== "hidden" && Number(style.opacity) > 0
        && rect.width > 0 && rect.height > 0 && rect.right > 0 && rect.left < innerWidth
        && rect.bottom > 0 && rect.top < innerHeight;
    };
    const rootOverflow = Math.max(
      document.documentElement.scrollWidth - document.documentElement.clientWidth,
      document.body.scrollWidth - document.body.clientWidth,
    );
    const overflowing = rootOverflow > 1
      ? [...document.querySelectorAll("body *")].flatMap((element) => {
          const rect = element.getBoundingClientRect();
          return rect.right > innerWidth + 1
            ? [element.getAttribute("data-testid") || element.id || element.tagName.toLowerCase()]
            : [];
        }).slice(0, 8)
      : [];
    const actions = ${JSON.stringify(routeCase.actions)}.filter((selector) => !visible(selector));
    const requiredSelectors = ${JSON.stringify(routeCase.requiredSelectors ?? [])}
      .filter((selector) => !document.querySelector(selector));
    const requiredTexts = ${JSON.stringify(routeCase.requiredTexts ?? [])}
      .filter((text) => !document.body.innerText.includes(text));
    const navigationVisible = ${routeCase.shell}
      ? visible('a[data-testid="link-nav-all-projects"]')
      : true;
    return { rootOverflow, overflowing, actions, requiredSelectors, requiredTexts, navigationVisible };
  })()`);
}

async function visit(routeCase, viewport) {
  const targetResponse = await fetch(
    `http://127.0.0.1:${debuggingPort}/json/new?${encodeURIComponent(`${baseUrl}${routeCase.path}`)}`,
    { method: "PUT" },
  );
  if (!targetResponse.ok) throw new Error(`Could not create Chromium target: ${targetResponse.status}`);
  const target = await targetResponse.json();
  const client = await CdpClient.connect(target.webSocketDebuggerUrl);
  try {
    await Promise.all([
      client.command("Page.enable"),
      client.command("Runtime.enable"),
      client.command("Emulation.setDeviceMetricsOverride", {
        width: viewport.width,
        height: viewport.height,
        deviceScaleFactor: 1,
        mobile: viewport.name === "mobile",
      }),
    ]);
    const loaded = client.event("Page.loadEventFired");
    await client.command("Page.reload", { ignoreCache: true });
    await loaded;
    await waitForRenderedPage(client, routeCase);
    const result = await inspect(client, routeCase, viewport);
    const failures = [];
    if (result.rootOverflow > 1) {
      failures.push(`horizontal overflow of ${result.rootOverflow}px${result.overflowing.length ? ` from ${result.overflowing.join(", ")}` : ""}`);
    }
    if (!result.navigationVisible) failures.push("primary Projects navigation is not visible");
    if (result.actions.length) failures.push(`missing primary actions: ${result.actions.join(", ")}`);
    if (result.requiredSelectors.length) failures.push(`missing required elements: ${result.requiredSelectors.join(", ")}`);
    if (result.requiredTexts.length) failures.push(`missing required text: ${result.requiredTexts.join(", ")}`);
    if (failures.length) throw new Error(`${routeCase.name} (${viewport.name}): ${failures.join("; ")}`);
    console.log(`✔ ${routeCase.name} at ${viewport.width}×${viewport.height}`);
  } finally {
    client.close();
    await fetch(`http://127.0.0.1:${debuggingPort}/json/close/${target.id}`);
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
  `--user-data-dir=${profileDir}`,
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
  for (const routeCase of cases) {
    for (const viewport of viewports) await visit(routeCase, viewport);
  }
  console.log(`Validated ${cases.length} representative views at mobile and desktop widths.`);
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
  await rm(profileDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}