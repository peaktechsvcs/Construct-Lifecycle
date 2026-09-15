import { spawn, execFile } from "node:child_process";
import { once } from "node:events";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const port = Number(process.env.CLC_BROWSER_TEST_PORT ?? 22781);
const baseUrl = `http://127.0.0.1:${port}`;
const chromium = process.env.CHROMIUM_PATH ?? "/repl/tools/bin/chromium";

const cases = [
  {
    name: "authenticated customer list",
    path: "/customers?browserAuth=authenticated",
    heading: "Customers",
    breadcrumb: "Customers",
    activeNav: "link-nav-customers",
  },
  {
    name: "authenticated customer detail",
    path: "/customers/42?browserAuth=authenticated",
    heading: "Browser Test Customer",
    breadcrumb: "Customer details",
    activeNav: "link-nav-customers",
  },
  {
    name: "authenticated administration",
    path: "/settings/administration/access?browserAuth=authenticated",
    heading: "Administration",
    breadcrumb: "Administration · Access & Memberships",
    activeNav: null,
  },
  {
    name: "platform customer administration",
    path: "/administration/platform/customers?browserAuth=platform",
    heading: "Customers",
    breadcrumb: "Platform Customers",
    activeNav: null,
  },
  {
    name: "platform environment recovery",
    path: "/administration/platform/recovery?browserAuth=platform",
    heading: "Environment Recovery",
    breadcrumb: "Environment Recovery",
    activeNav: null,
    requiredTexts: ["runtime", "database", "storage", "queue", "secrets", "jobs", "logs", "context ready"],
  },
  {
    name: "customer cannot access platform recovery",
    path: "/administration/platform/recovery?browserAuth=authenticated",
    heading: "Platform administrator access required",
    breadcrumb: null,
    activeNav: null,
  },
  {
    name: "legacy settings redirect",
    path: "/settings/access?browserAuth=authenticated",
    heading: "Administration",
    breadcrumb: "Administration · Access & Memberships",
    activeNav: null,
  },
  {
    name: "not found page",
    path: "/route-does-not-exist?browserAuth=authenticated",
    heading: "404 Page Not Found",
    breadcrumb: null,
    activeNav: null,
  },
  {
    name: "signed-out protected route redirects home",
    path: "/customers?browserAuth=signed-out",
    heading: "Construct Lifecycle",
    breadcrumb: null,
    activeNav: null,
  },
  {
    name: "signed-in account without workspace",
    path: "/customers?browserAuth=no-tenant",
    heading: "You do not have access to a workspace",
    breadcrumb: null,
    activeNav: null,
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
      reject(new Error(`Browser test server exited before readiness with code ${code}`));
    });
    check();
  });
}

function textContent(html, selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = html.match(new RegExp(`<${escaped}\\b[^>]*>([\\s\\S]*?)</${escaped}>`, "i"));
  return decodeEntities(match?.[1]?.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim() ?? "");
}

function decodeEntities(value) {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function containsActiveNav(html, testId) {
  return new RegExp(`data-testid="${testId}"[^>]*aria-current="page"`, "i").test(html);
}

async function visit(routeCase) {
  const { stdout } = await execFileAsync(chromium, [
    "--headless=new",
    "--no-sandbox",
    "--disable-gpu",
    "--disable-dev-shm-usage",
    "--hide-scrollbars",
    "--window-size=1440,1000",
    "--virtual-time-budget=5000",
    "--dump-dom",
    `${baseUrl}${routeCase.path}`,
  ], { maxBuffer: 8 * 1024 * 1024 });
  const html = stdout;
  const pageText = decodeEntities(html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim());
  const failures = [];
  const heading = textContent(html, "h1");
  if (heading !== routeCase.heading) failures.push(`heading="${heading}" expected "${routeCase.heading}"`);
  if (routeCase.breadcrumb) {
    const breadcrumb = (html.match(/data-testid="workspace-breadcrumb"[^>]*>([\s\S]*?)<\/span>/i)?.[1] ?? "")
      .replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
    if (decodeEntities(breadcrumb) !== routeCase.breadcrumb) failures.push(`breadcrumb="${breadcrumb}" expected "${routeCase.breadcrumb}"`);
  }
  if (routeCase.activeNav && !containsActiveNav(html, routeCase.activeNav)) {
    failures.push(`active navigation ${routeCase.activeNav} missing`);
  }
  for (const requiredText of routeCase.requiredTexts ?? []) {
    if (!pageText.includes(requiredText)) failures.push(`required text "${requiredText}" missing`);
  }
  if (failures.length) throw new Error(`${routeCase.name}: ${failures.join("; ")}`);
}

const server = spawn("pnpm", ["--filter", "@workspace/clc-projects", "run", "dev"], {
  env: {
    ...process.env,
    BASE_PATH: "/",
    CLC_BROWSER_TEST: "1",
    PORT: String(port),
    VITE_CLC_BROWSER_TEST: "1",
  },
  stdio: ["ignore", "pipe", "pipe"],
  detached: true,
});

let serverOutput = "";
server.stdout.on("data", (chunk) => { serverOutput += chunk; });
server.stderr.on("data", (chunk) => { serverOutput += chunk; });

try {
  await waitForServer(server);
  for (const routeCase of cases) {
    await visit(routeCase);
    console.log(`✔ ${routeCase.name}`);
  }
  console.log(`Validated ${cases.length} authenticated and protected browser routes.`);
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  if (serverOutput) console.error(serverOutput);
  process.exitCode = 1;
} finally {
  if (server.exitCode === null && server.signalCode === null && server.pid) {
    try {
      process.kill(-server.pid, "SIGTERM");
    } catch {
      server.kill("SIGTERM");
    }
    await Promise.race([
      once(server, "exit"),
      new Promise((resolve) => setTimeout(resolve, 2_000)),
    ]);
  }
}
