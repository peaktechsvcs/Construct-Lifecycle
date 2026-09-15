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
    title: "Customers · Construct Lifecycle",
    logo: { src: "/logo-icon.png", alt: "Browser Test Workspace logo" },
  },
  {
    name: "authenticated customer list with valid branding logo",
    path: "/customers?browserAuth=authenticated&browserBranding=valid",
    heading: "Customers",
    breadcrumb: "Customers",
    activeNav: "link-nav-customers",
    title: "Customers · Construct Lifecycle",
    logo: { src: "/logo-full.png", alt: "Browser Test Workspace logo" },
  },
  {
    name: "authenticated customer list with broken branding logo",
    path: "/customers?browserAuth=authenticated&browserBranding=broken",
    heading: "Customers",
    breadcrumb: "Customers",
    activeNav: "link-nav-customers",
    title: "Customers · Construct Lifecycle",
    logo: { src: "/logo-icon.png", alt: "Browser Test Workspace logo" },
  },
  {
    name: "branding draft guidance",
    path: "/settings/branding?browserAuth=authenticated&browserBranding=invalid-draft",
    heading: "Customer Branding",
    breadcrumb: "Branding",
    activeNav: null,
    title: "Customer Branding · Construct Lifecycle",
    requiredLinks: ["/settings"],
    requiredTexts: [
      "Use a 3- or 6-digit hex color, such as #2563eb.",
      "Draft autosave is paused until the highlighted color values are corrected.",
      "White text on this action color",
      "Page text contrast is",
    ],
  },
  {
    name: "public pricing page",
    path: "/pricing",
    heading: "Choose the plan that fits your operation",
    breadcrumb: null,
    activeNav: null,
    title: "Plans & billing · Construct Lifecycle",
    description: "Compare Construct Lifecycle plans for managing your construction lifecycle from bid through closeout.",
  },
  {
    name: "sign-in page",
    path: "/sign-in",
    breadcrumb: null,
    activeNav: null,
    title: "Sign in · Construct Lifecycle",
    description: "Sign in to Construct Lifecycle to manage construction projects from bid through closeout.",
  },
  {
    name: "sign-up page",
    path: "/sign-up",
    breadcrumb: null,
    activeNav: null,
    title: "Create your account · Construct Lifecycle",
    description: "Create a Construct Lifecycle account to manage construction work from bid through closeout.",
  },
  {
    name: "invitation page",
    path: "/accept-invitation/browser-test-token?browserAuth=signed-out",
    breadcrumb: null,
    activeNav: null,
    title: "Invitation · Construct Lifecycle",
    description: "Accept your Construct Lifecycle workspace invitation and join your construction team.",
  },
  {
    name: "authenticated customer detail",
    path: "/customers/42?browserAuth=authenticated",
    heading: "Browser Test Customer",
    breadcrumb: "Customer details",
    activeNav: "link-nav-customers",
    title: "Browser Test Customer · Construct Lifecycle",
  },
  {
    name: "authenticated compliance scan status",
    path: "/compliance?browserAuth=authenticated",
    heading: "Trade partner compliance",
    breadcrumb: "Trade Partner Compliance",
    activeNav: null,
    title: "Trade partner compliance · Construct Lifecycle",
    requiredTexts: [
      "Security scan passed.",
      "Security scan unavailable. Try again later.",
      "File blocked after a security scan.",
      "Security scan timed out. Try again later.",
    ],
  },
  {
    name: "authenticated active projects guidance",
    path: "/dashboard/drilldown/active-projects?browserAuth=authenticated",
    heading: "Active Projects",
    breadcrumb: "Dashboard · Active Projects",
    activeNav: null,
    title: "Construct Lifecycle — From Bid to Closeout",
    requiredTexts: [
      "No in flight projects",
      "Create a project or move a paused project into In Flight when work is ready.",
      "Paused projects",
      "Projects currently carrying the Paused status.",
      "In Flight projects",
      "Projects currently carrying the In Flight status.",
      "Browser Test Waiting Project",
      "Start a project",
    ],
    orderedTexts: ["Paused projects", "In Flight projects"],
    requiredLinks: ["/projects?create=1&return=", "/projects/42?return="],
  },
  {
    name: "authenticated filtered active projects guidance",
    path: "/dashboard/drilldown/active-projects?browserAuth=authenticated&search=does-not-match&sort=value_desc",
    heading: "Active Projects",
    breadcrumb: "Dashboard · Active Projects",
    activeNav: null,
    title: "Construct Lifecycle — From Bid to Closeout",
    requiredTexts: [
      "No paused projects match",
      "Clear the search to view all paused projects.",
      "No in flight projects match",
      "Clear the search to view all in flight projects.",
    ],
    orderedTexts: ["Paused projects", "In Flight projects"],
    requiredLinks: [
      "/dashboard/drilldown/active-projects?browserAuth=authenticated&sort=value_desc",
    ],
  },
  {
    name: "authenticated administration",
    path: "/settings/administration/access?browserAuth=authenticated",
    heading: "Administration",
    breadcrumb: "Administration · Access & Memberships",
    activeNav: null,
    title: "Administration · Construct Lifecycle",
  },
  {
    name: "platform customer administration",
    path: "/administration/platform/customers?browserAuth=platform",
    heading: "Customers",
    breadcrumb: "Platform Customers",
    activeNav: null,
    title: "Customers · Construct Lifecycle",
  },
  {
    name: "platform environment recovery",
    path: "/administration/platform/recovery?browserAuth=platform",
    heading: "Environment Recovery",
    breadcrumb: "Environment Recovery",
    activeNav: null,
    title: "Environment Recovery · Construct Lifecycle",
    requiredTexts: ["runtime", "database", "storage", "queue", "secrets", "jobs", "logs", "context ready"],
  },
  {
    name: "customer cannot access platform recovery",
    path: "/administration/platform/recovery?browserAuth=authenticated",
    heading: "Platform administrator access required",
    breadcrumb: null,
    activeNav: null,
    title: "Platform administrator access required · Construct Lifecycle",
    description: "Construct Lifecycle platform administrator access is required to open this recovery console.",
  },
  {
    name: "coming soon feature",
    path: "/coming-soon/notifications?browserAuth=platform",
    heading: "Notifications",
    breadcrumb: null,
    activeNav: null,
    title: "Notifications · Coming soon · Construct Lifecycle",
    description: "Notifications is coming soon in Construct Lifecycle. Check back for updates on this construction workflow.",
  },
  {
    name: "legacy settings redirect",
    path: "/settings/access?browserAuth=authenticated",
    heading: "Administration",
    breadcrumb: "Administration · Access & Memberships",
    activeNav: null,
    title: "Administration · Construct Lifecycle",
  },
  {
    name: "not found page",
    path: "/route-does-not-exist?browserAuth=authenticated",
    heading: "404 Page Not Found",
    breadcrumb: null,
    activeNav: null,
    title: "404 Page Not Found · Construct Lifecycle",
    description: "The Construct Lifecycle page you requested could not be found.",
  },
  {
    name: "render error fallback",
    path: "/__browser-test/render-error",
    heading: "Something went wrong",
    breadcrumb: null,
    activeNav: null,
    title: "Something went wrong · Construct Lifecycle",
    description: "Construct Lifecycle encountered an error while loading this page. Try again to continue.",
  },
  {
    name: "signed-out protected route redirects home",
    path: "/customers?browserAuth=signed-out",
    ogUrlPath: "/",
    heading: "Construct Lifecycle",
    breadcrumb: null,
    activeNav: null,
    title: "Construct Lifecycle",
    description: "Construct Lifecycle helps construction teams manage work from bid through closeout in one connected workspace.",
  },
  {
    name: "signed-in account without workspace",
    path: "/customers?browserAuth=no-tenant",
    heading: "You do not have access to a workspace",
    breadcrumb: null,
    activeNav: null,
    title: "You do not have access to a workspace · Construct Lifecycle",
    description: "Your Construct Lifecycle account is signed in, but it is not assigned to a Construct Lifecycle workspace.",
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

function workspaceLogoAttributes(html) {
  const tag = html.match(/<img\b[^>]*data-testid="workspace-logo"[^>]*>/i)?.[0] ?? "";
  return {
    src: decodeEntities(tag.match(/\ssrc="([^"]*)"/i)?.[1] ?? ""),
    alt: decodeEntities(tag.match(/\salt="([^"]*)"/i)?.[1] ?? ""),
  };
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
  if (routeCase.heading && heading !== routeCase.heading) failures.push(`heading="${heading}" expected "${routeCase.heading}"`);
  if (routeCase.title) {
    const title = decodeEntities(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.trim() ?? "");
    if (title !== routeCase.title) failures.push(`title="${title}" expected "${routeCase.title}"`);
  }
  if (routeCase.description) {
    const description = decodeEntities(html.match(/<meta[^>]+name="description"[^>]+content="([^"]*)"/i)?.[1] ?? "");
    if (description !== routeCase.description) failures.push(`description="${description}" expected "${routeCase.description}"`);
    const ogTitle = decodeEntities(html.match(/<meta[^>]+property="og:title"[^>]+content="([^"]*)"/i)?.[1] ?? "");
    if (ogTitle !== routeCase.title) failures.push(`og:title="${ogTitle}" expected "${routeCase.title}"`);
    const ogDescription = decodeEntities(html.match(/<meta[^>]+property="og:description"[^>]+content="([^"]*)"/i)?.[1] ?? "");
    if (ogDescription !== routeCase.description) failures.push(`og:description="${ogDescription}" expected "${routeCase.description}"`);
    const expectedOgUrl = new URL(routeCase.ogUrlPath ?? routeCase.path, baseUrl);
    expectedOgUrl.search = "";
    expectedOgUrl.hash = "";
    const ogUrl = decodeEntities(html.match(/<meta[^>]+property="og:url"[^>]+content="([^"]*)"/i)?.[1] ?? "");
    if (ogUrl !== expectedOgUrl.href) failures.push(`og:url="${ogUrl}" expected "${expectedOgUrl.href}"`);
  }
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
  let previousTextIndex = -1;
  for (const orderedText of routeCase.orderedTexts ?? []) {
    const textIndex = pageText.indexOf(orderedText);
    if (textIndex < 0) {
      failures.push(`ordered text "${orderedText}" missing`);
    } else if (textIndex < previousTextIndex) {
      failures.push(`ordered text "${orderedText}" appears before the preceding section`);
    }
    previousTextIndex = textIndex;
  }
  for (const requiredLink of routeCase.requiredLinks ?? []) {
    if (!decodeEntities(html).includes(`href="${requiredLink}`)) failures.push(`required link "${requiredLink}" missing`);
  }
  if (routeCase.logo) {
    const logo = workspaceLogoAttributes(html);
    if (!logo.src) failures.push("workspace logo image missing");
    if (logo.src !== routeCase.logo.src) failures.push(`workspace logo src="${logo.src}" expected "${routeCase.logo.src}"`);
    if (logo.alt !== routeCase.logo.alt) failures.push(`workspace logo alt="${logo.alt}" expected "${routeCase.logo.alt}"`);
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
