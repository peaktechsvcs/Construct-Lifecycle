import { spawn, execFile } from "node:child_process";
import { once } from "node:events";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const port = Number(process.env.CLC_BROWSER_TEST_PORT ?? 22781);
const debuggingPort = Number(process.env.CLC_BROWSER_TEST_DEBUG_PORT ?? 22782);
const baseUrl = `http://127.0.0.1:${port}`;
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

async function openTarget(path, viewport) {
  const response = await fetch(
    `http://127.0.0.1:${debuggingPort}/json/new?${encodeURIComponent(`${baseUrl}${path}`)}`,
    { method: "PUT" },
  );
  if (!response.ok) throw new Error(`Could not create Chromium target: ${response.status}`);
  const target = await response.json();
  const client = await CdpClient.connect(target.webSocketDebuggerUrl);
  await Promise.all([client.command("Page.enable"), client.command("Runtime.enable")]);
  if (viewport) {
    await client.command("Emulation.setDeviceMetricsOverride", {
      width: viewport.width,
      height: viewport.height,
      deviceScaleFactor: 1,
      mobile: true,
    });
  }
  await client.command("Page.navigate", { url: `${baseUrl}${path}` });
  return { target, client };
}

async function closeTarget(target, client) {
  client.close();
  await fetch(`http://127.0.0.1:${debuggingPort}/json/close/${target.id}`);
}

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
    previewLogo: { src: "/logo-icon.png", alt: "Construct Lifecycle logo" },
  },
  {
    name: "branding preview with unreachable draft logo",
    path: "/settings/branding?browserAuth=authenticated&browserBranding=unreachable-draft",
    heading: "Customer Branding",
    breadcrumb: "Branding",
    activeNav: null,
    title: "Customer Branding · Construct Lifecycle",
    previewLogo: { src: "/logo-icon.png", alt: "Construct Lifecycle logo" },
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
      "No field work projects",
      "Create a project or update a project to the Field Work status.",
      "Field Work projects",
      "Projects currently carrying the Field Work status.",
      "Browser Test Waiting Project",
      "Start a project",
    ],
    orderedTexts: ["Paused projects", "In Flight projects", "Field Work projects"],
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
      "No field work projects match",
      "Clear the search to view all field work projects.",
    ],
    orderedTexts: ["Paused projects", "In Flight projects", "Field Work projects"],
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

function brandingPreviewLogoAttributes(html) {
  const tag = html.match(/<img\b[^>]*data-testid="branding-preview-logo"[^>]*>/i)?.[0] ?? "";
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
  if (routeCase.previewLogo) {
    const logo = brandingPreviewLogoAttributes(html);
    if (!logo.src) failures.push("branding preview logo image missing");
    if (logo.src !== routeCase.previewLogo.src) failures.push(`branding preview logo src="${logo.src}" expected "${routeCase.previewLogo.src}"`);
    if (logo.alt !== routeCase.previewLogo.alt) failures.push(`branding preview logo alt="${logo.alt}" expected "${routeCase.previewLogo.alt}"`);
  }
  if (failures.length) throw new Error(`${routeCase.name}: ${failures.join("; ")}`);
}

async function checkProjectDetailReturnSafety() {
  const unsafeReturns = [
    { label: "external", value: "https://outside.example/projects" },
    { label: "protocol-relative", value: "//outside.example/projects" },
    { label: "malformed", value: "/projects/%ZZ" },
  ];

  for (const unsafeReturn of unsafeReturns) {
    const returnQuery = encodeURIComponent(unsafeReturn.value);
    const { target, client } = await openTarget(
      `/projects/42?browserAuth=authenticated&browserRole=owner&return=${returnQuery}`,
    );
    try {
      await waitFor(
        client,
        `${unsafeReturn.label} project detail`,
        `(() => ({
          ready: document.querySelector('h1')?.textContent?.trim() === "Browser Test Project"
            && document.querySelector('[data-testid="link-back-projects"]')?.getAttribute("href") === "/projects",
        }))()`,
      );
      const clicked = await evaluate(client, `(() => {
        const link = document.querySelector('[data-testid="link-back-projects"]');
        if (!(link instanceof HTMLElement)) return false;
        link.click();
        return true;
      })()`);
      if (!clicked) throw new Error(`${unsafeReturn.label} project detail fallback could not be clicked`);
      await waitFor(
        client,
        `${unsafeReturn.label} project detail fallback`,
        `(() => ({
          ready: window.location.origin === ${JSON.stringify(baseUrl)}
            && window.location.pathname === "/projects"
            && document.querySelector('[role="dialog"]') === null,
          url: window.location.href,
        }))()`,
      );
    } finally {
      await closeTarget(target, client);
    }
  }
  console.log("✔ project detail rejects external, protocol-relative, and malformed returns");

  const validReturn = "/dashboard/drilldown/active-projects?browserAuth=authenticated&sort=value_desc&search=alpha#projects";
  const validTarget = await openTarget(
    `/projects/42?browserAuth=authenticated&browserRole=owner&return=${encodeURIComponent(validReturn)}`,
  );
  try {
    await waitFor(
      validTarget.client,
      "valid project detail return",
      `(() => ({
        ready: document.querySelector('h1')?.textContent?.trim() === "Browser Test Project"
          && document.querySelector('[data-testid="link-back-drilldown"]')?.getAttribute("href") === ${JSON.stringify(validReturn)},
      }))()`,
    );
    const clicked = await evaluate(validTarget.client, `(() => {
      const link = document.querySelector('[data-testid="link-back-drilldown"]');
      if (!(link instanceof HTMLElement)) return false;
      link.click();
      return true;
    })()`);
    if (!clicked) throw new Error("valid project detail return could not be clicked");
    await waitFor(
      validTarget.client,
      "valid project detail return navigation",
      `(() => ({
        ready: window.location.origin === ${JSON.stringify(baseUrl)}
          && window.location.pathname === "/dashboard/drilldown/active-projects"
          && window.location.search === "?browserAuth=authenticated&sort=value_desc&search=alpha",
          && window.location.hash === "#projects",
        url: window.location.href,
      }))()`,
    );
  } finally {
    await closeTarget(validTarget.target, validTarget.client);
  }
  console.log("✔ project detail preserves valid internal return query parameters");

  const mobileViewport = { width: 390, height: 844 };
  for (const unsafeReturn of unsafeReturns) {
    const returnQuery = encodeURIComponent(unsafeReturn.value);
    const { target, client } = await openTarget(
      `/projects/42?browserAuth=authenticated&browserRole=owner&return=${returnQuery}`,
      mobileViewport,
    );
    try {
      await waitFor(
        client,
        `mobile ${unsafeReturn.label} project detail`,
        `(() => ({
          ready: window.innerWidth === ${mobileViewport.width}
            && window.innerHeight === ${mobileViewport.height}
            && document.querySelector('h1')?.textContent?.trim() === "Browser Test Project"
            && document.querySelector('[data-testid="link-back-projects"]')?.getAttribute("href") === "/projects",
          viewport: [window.innerWidth, window.innerHeight],
        }))()`,
      );
      const clicked = await evaluate(client, `(() => {
        const link = document.querySelector('[data-testid="link-back-projects"]');
        if (!(link instanceof HTMLElement)) return false;
        link.click();
        return true;
      })()`);
      if (!clicked) throw new Error(`mobile ${unsafeReturn.label} project detail fallback could not be clicked`);
      await waitFor(
        client,
        `mobile ${unsafeReturn.label} project detail fallback`,
        `(() => ({
          ready: window.innerWidth === ${mobileViewport.width}
            && window.innerHeight === ${mobileViewport.height}
            && window.location.origin === ${JSON.stringify(baseUrl)}
            && window.location.pathname === "/projects"
            && document.querySelector('[role="dialog"]') === null,
          url: window.location.href,
        }))()`,
      );
    } finally {
      await closeTarget(target, client);
    }
  }

  const mobileValidTarget = await openTarget(
    `/projects/42?browserAuth=authenticated&browserRole=owner&return=${encodeURIComponent(validReturn)}`,
    mobileViewport,
  );
  try {
    await waitFor(
      mobileValidTarget.client,
      "mobile valid project detail return",
      `(() => ({
        ready: window.innerWidth === ${mobileViewport.width}
          && window.innerHeight === ${mobileViewport.height}
          && document.querySelector('h1')?.textContent?.trim() === "Browser Test Project"
          && document.querySelector('[data-testid="link-back-drilldown"]')?.getAttribute("href") === ${JSON.stringify(validReturn)},
      }))()`,
    );
    const clicked = await evaluate(mobileValidTarget.client, `(() => {
      const link = document.querySelector('[data-testid="link-back-drilldown"]');
      if (!(link instanceof HTMLElement)) return false;
      link.click();
      return true;
    })()`);
    if (!clicked) throw new Error("mobile valid project detail return could not be clicked");
    await waitFor(
      mobileValidTarget.client,
      "mobile valid project detail return navigation",
      `(() => ({
        ready: window.innerWidth === ${mobileViewport.width}
          && window.innerHeight === ${mobileViewport.height}
          && window.location.origin === ${JSON.stringify(baseUrl)}
          && window.location.pathname === "/dashboard/drilldown/active-projects"
          && window.location.search === "?browserAuth=authenticated&sort=value_desc&search=alpha",
        url: window.location.href,
      }))()`,
    );
  } finally {
    await closeTarget(mobileValidTarget.target, mobileValidTarget.client);
  }
  console.log("✔ project detail return safety preserves valid queries on mobile");
}

async function checkProjectDetailActionsPreserveReturnContext() {
  const validReturn = "/dashboard/drilldown/active-projects?browserAuth=authenticated&sort=value_desc&search=alpha#projects";
  const actionPath = `/projects/42?browserAuth=authenticated&browserRole=owner&return=${encodeURIComponent(validReturn)}`;
  const assertProjectDetailRoute = (description) => waitFor(
    client,
    description,
    `(() => {
      const params = new URLSearchParams(window.location.search);
      return {
        ready: window.location.origin === ${JSON.stringify(baseUrl)}
          && window.location.pathname === "/projects/42"
          && params.get("browserAuth") === "authenticated"
          && params.get("browserRole") === "owner"
          && params.get("return") === ${JSON.stringify(validReturn)}
          && document.querySelector("h1")?.textContent?.trim() === "Browser Test Project"
          && document.querySelector('[role="dialog"]') === null,
        url: window.location.href,
      };
    })()`,
  );

  const { target, client } = await openTarget(actionPath);
  try {
    await waitFor(
      client,
      "project detail action return context",
      `(() => {
        const params = new URLSearchParams(window.location.search);
        return {
          ready: document.querySelector("h1")?.textContent?.trim() === "Browser Test Project"
            && document.querySelector('[data-testid="link-back-drilldown"]')?.getAttribute("href") === ${JSON.stringify(validReturn)}
            && params.get("return") === ${JSON.stringify(validReturn)},
        };
      })()`,
    );

    const editOpened = await evaluate(client, `(() => {
      const button = document.querySelector('[data-testid="button-edit-project-detail"]');
      if (!(button instanceof HTMLElement)) return false;
      button.click();
      return true;
    })()`);
    if (!editOpened) throw new Error("project detail edit action could not be opened");
    await waitFor(
      client,
      "project detail edit modal",
      `(() => ({
        ready: document.querySelector('[role="dialog"] h2')?.textContent?.trim() === "Edit P-0042"
          && new URLSearchParams(window.location.search).get("return") === ${JSON.stringify(validReturn)},
      }))()`,
    );

    const editCanceled = await evaluate(client, `(() => {
      const button = document.querySelector('[data-testid="button-cancel-project"]');
      if (!(button instanceof HTMLElement)) return false;
      button.click();
      return true;
    })()`);
    if (!editCanceled) throw new Error("project detail edit cancel action missing");
    await assertProjectDetailRoute("project detail after edit cancel");

    const editReopened = await evaluate(client, `(() => {
      const button = document.querySelector('[data-testid="button-edit-project-detail"]');
      if (!(button instanceof HTMLElement)) return false;
      button.click();
      return true;
    })()`);
    if (!editReopened) throw new Error("project detail edit action could not be reopened");
    await waitFor(
      client,
      "project detail edit modal before save",
      `(() => ({
        ready: document.querySelector('[role="dialog"] h2')?.textContent?.trim() === "Edit P-0042",
      }))()`,
    );
    const editSaved = await evaluate(client, `(() => {
      const button = document.querySelector('[data-testid="button-save-project"]');
      if (!(button instanceof HTMLButtonElement) || button.disabled) return false;
      button.click();
      return true;
    })()`);
    if (!editSaved) throw new Error("project detail edit save action missing");
    await assertProjectDetailRoute("project detail after edit save");

    const followUpOpened = await evaluate(client, `(() => {
      const button = document.querySelector('[data-testid="button-add-followup-detail"]');
      if (!(button instanceof HTMLElement)) return false;
      button.click();
      return true;
    })()`);
    if (!followUpOpened) throw new Error("project detail follow-up action could not be opened");
    await waitFor(
      client,
      "project detail follow-up modal",
      `(() => ({
        ready: document.querySelector('[role="dialog"] h2')?.textContent?.trim() === "Schedule a follow-up"
          && new URLSearchParams(window.location.search).get("return") === ${JSON.stringify(validReturn)},
      }))()`,
    );

    const followUpCanceled = await evaluate(client, `(() => {
      const button = document.querySelector('[data-testid="button-cancel-followup-detail"]');
      if (!(button instanceof HTMLElement)) return false;
      button.click();
      return true;
    })()`);
    if (!followUpCanceled) throw new Error("project detail follow-up cancel action missing");
    await assertProjectDetailRoute("project detail after follow-up cancel");

    const followUpReopened = await evaluate(client, `(() => {
      const button = document.querySelector('[data-testid="button-add-followup-detail"]');
      if (!(button instanceof HTMLElement)) return false;
      button.click();
      return true;
    })()`);
    if (!followUpReopened) throw new Error("project detail follow-up action could not be reopened");
    await waitFor(
      client,
      "project detail follow-up modal before save",
      `(() => ({
        ready: document.querySelector('[role="dialog"] h2')?.textContent?.trim() === "Schedule a follow-up",
      }))()`,
    );
    const followUpFilled = await evaluate(client, `(() => {
      const setValue = (selector, value) => {
        const field = document.querySelector(selector);
        const prototype = field instanceof HTMLInputElement
          ? HTMLInputElement.prototype
          : field instanceof HTMLTextAreaElement
            ? HTMLTextAreaElement.prototype
            : null;
        if (!prototype) return false;
        const setter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;
        if (!setter) return false;
        setter.call(field, value);
        field.dispatchEvent(new Event("input", { bubbles: true }));
        field.dispatchEvent(new Event("change", { bubbles: true }));
        return true;
      };
      return setValue('[data-testid="input-followup-date-detail"]', "2026-12-15")
        && setValue('[data-testid="textarea-followup-note-detail"]', "Confirm the next client decision.");
    })()`);
    if (!followUpFilled) throw new Error("project detail follow-up form could not be filled");
    const followUpSaved = await evaluate(client, `(() => {
      const button = document.querySelector('[data-testid="button-save-followup-detail"]');
      if (!(button instanceof HTMLButtonElement) || button.disabled) return false;
      button.click();
      return true;
    })()`);
    if (!followUpSaved) throw new Error("project detail follow-up save action missing");
    await assertProjectDetailRoute("project detail after follow-up save");
  } finally {
    await closeTarget(target, client);
  }

  const unsafeReturns = [
    { label: "external", value: "https://outside.example/projects" },
    { label: "malformed", value: "/projects/%ZZ" },
  ];
  for (const unsafeReturn of unsafeReturns) {
    const { target: unsafeTarget, client: unsafeClient } = await openTarget(
      `/projects/42?browserAuth=authenticated&browserRole=owner&return=${encodeURIComponent(unsafeReturn.value)}`,
    );
    try {
      await waitFor(
        unsafeClient,
        `${unsafeReturn.label} project detail action context`,
        `(() => ({
          ready: document.querySelector("h1")?.textContent?.trim() === "Browser Test Project"
            && document.querySelector('[data-testid="link-back-projects"]')?.getAttribute("href") === "/projects",
        }))()`,
      );

      const editOpened = await evaluate(unsafeClient, `(() => {
        const button = document.querySelector('[data-testid="button-edit-project-detail"]');
        if (!(button instanceof HTMLElement)) return false;
        button.click();
        return true;
      })()`);
      if (!editOpened) throw new Error(`${unsafeReturn.label} project detail edit could not be opened`);
      await waitFor(
        unsafeClient,
        `${unsafeReturn.label} project detail edit modal`,
        `(() => ({
          ready: document.querySelector('[role="dialog"] h2')?.textContent?.trim() === "Edit P-0042",
        }))()`,
      );
      const editCanceled = await evaluate(unsafeClient, `(() => {
        const button = document.querySelector('[data-testid="button-cancel-project"]');
        if (!(button instanceof HTMLElement)) return false;
        button.click();
        return true;
      })()`);
      if (!editCanceled) throw new Error(`${unsafeReturn.label} project detail edit cancel action missing`);
      await waitFor(
        unsafeClient,
        `${unsafeReturn.label} project detail after edit cancel`,
        `(() => ({
          ready: window.location.pathname === "/projects/42"
            && document.querySelector("h1")?.textContent?.trim() === "Browser Test Project"
            && document.querySelector('[role="dialog"]') === null,
        }))()`,
      );

      const followUpOpened = await evaluate(unsafeClient, `(() => {
        const button = document.querySelector('[data-testid="button-add-followup-detail"]');
        if (!(button instanceof HTMLElement)) return false;
        button.click();
        return true;
      })()`);
      if (!followUpOpened) throw new Error(`${unsafeReturn.label} project detail follow-up could not be opened`);
      await waitFor(
        unsafeClient,
        `${unsafeReturn.label} project detail follow-up modal`,
        `(() => ({
          ready: document.querySelector('[role="dialog"] h2')?.textContent?.trim() === "Schedule a follow-up",
        }))()`,
      );
      const followUpCanceled = await evaluate(unsafeClient, `(() => {
        const button = document.querySelector('[data-testid="button-cancel-followup-detail"]');
        if (!(button instanceof HTMLElement)) return false;
        button.click();
        return true;
      })()`);
      if (!followUpCanceled) throw new Error(`${unsafeReturn.label} project detail follow-up cancel action missing`);
      await waitFor(
        unsafeClient,
        `${unsafeReturn.label} project detail after follow-up cancel`,
        `(() => ({
          ready: window.location.pathname === "/projects/42"
            && document.querySelector("h1")?.textContent?.trim() === "Browser Test Project"
            && document.querySelector('[role="dialog"]') === null,
        }))()`,
      );
    } finally {
      await closeTarget(unsafeTarget, unsafeClient);
    }
  }
  console.log("✔ project detail edit and follow-up actions preserve internal workspace context");
}

async function checkActiveProjectsClearSearch() {
  const { target, client } = await openTarget(
    "/dashboard/drilldown/active-projects?browserAuth=authenticated&search=does-not-match&sort=value_desc",
  );
  try {
    await waitFor(
      client,
      "filtered active projects guidance",
      `(() => {
        const params = new URLSearchParams(window.location.search);
        return {
          ready: document.body?.innerText?.includes("No paused projects match") === true
            && document.body?.innerText?.includes("Clear the search to view all paused projects.") === true
            && params.get("search") === "does-not-match"
            && params.get("sort") === "value_desc",
        };
      })()`,
    );

    const clicked = await evaluate(client, `(() => {
      const link = [...document.querySelectorAll("a")]
        .find((candidate) => candidate.textContent?.trim() === "Clear search");
      if (!(link instanceof HTMLElement)) return false;
      link.click();
      return true;
    })()`);
    if (!clicked) throw new Error("active projects clear-search link could not be clicked");

    const restored = await waitFor(
      client,
      "active projects after clearing search",
      `(() => {
        const params = new URLSearchParams(window.location.search);
        const text = document.body?.innerText ?? "";
        const hasPaused = text.includes("Paused projects");
        const hasInFlight = text.includes("In Flight projects");
        const hasFieldWork = text.includes("Field Work projects");
        const hasWaitingProject = text.includes("Browser Test Waiting Project");
        const hasFilteredCopy = text.includes("No paused projects match");
        return {
          ready: window.location.pathname === "/dashboard/drilldown/active-projects"
            && !params.has("search")
            && params.get("browserAuth") === "authenticated"
            && params.get("sort") === "value_desc"
            && hasPaused
            && hasInFlight
            && hasFieldWork
            && hasWaitingProject
            && !hasFilteredCopy,
          pathname: window.location.pathname,
          search: window.location.search,
          hasPaused,
          hasInFlight,
          hasFieldWork,
          hasWaitingProject,
          hasFilteredCopy,
        };
      })()`,
    );
    if (restored.pathname !== "/dashboard/drilldown/active-projects") {
      throw new Error(`clear search changed the drilldown route to ${restored.pathname}`);
    }
    if (restored.search !== "?browserAuth=authenticated&sort=value_desc") {
      throw new Error(`clear search changed unrelated query parameters: ${restored.search}`);
    }
    console.log("✔ Active Projects clear search restores the unfiltered guidance");
  } finally {
    await closeTarget(target, client);
  }
}

async function checkFailedOwnerInvitationRecovery() {
  const { target, client } = await openTarget(
    "/administration/platform/customers?browserAuth=platform&browserCustomerOnboarding=failed",
  );
  try {
    await waitFor(
      client,
      "failed owner invitation customer form",
      `(() => ({
        ready: document.querySelector("h1")?.textContent?.trim() === "Customers"
          && [...document.querySelectorAll("form")].some((form) => form.querySelector('input[type="email"]')),
      }))()`,
    );

    const filled = await evaluate(client, `(() => {
      const form = [...document.querySelectorAll("form")]
        .find((candidate) => candidate.querySelector('input[type="email"]'));
      if (!(form instanceof HTMLFormElement)) return false;
      const setValue = (input, value) => {
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
        if (!setter) return false;
        setter.call(input, value);
        input.dispatchEvent(new Event("input", { bubbles: true }));
        input.dispatchEvent(new Event("change", { bubbles: true }));
        return true;
      };
      const textInputs = [...form.querySelectorAll('input:not([type]), input[type="text"]')];
      const emailInput = form.querySelector('input[type="email"]');
      return textInputs.length >= 2
        && emailInput instanceof HTMLInputElement
        && setValue(textInputs[0], "Failed Invitation Browser Customer")
        && setValue(textInputs[1], "failed-invitation-browser-customer")
        && setValue(emailInput, "owner-retry@example.test");
    })()`);
    if (!filled) throw new Error("failed owner invitation fixture could not fill the customer form");

    await waitFor(
      client,
      "failed owner invitation customer form values",
      `(() => {
        const form = [...document.querySelectorAll("form")]
          .find((candidate) => candidate.querySelector('input[type="email"]'));
        const inputs = form ? [...form.querySelectorAll('input:not([type]), input[type="text"]')] : [];
        return {
          ready: inputs[0]?.value === "Failed Invitation Browser Customer"
            && inputs[1]?.value === "failed-invitation-browser-customer"
            && form?.querySelector('input[type="email"]')?.value === "owner-retry@example.test",
        };
      })()`,
    );

    const submitted = await evaluate(client, `(() => {
      const form = [...document.querySelectorAll("form")]
        .find((candidate) => candidate.querySelector('input[type="email"]'));
      const button = form?.querySelector('button[type="submit"]');
      if (!(button instanceof HTMLButtonElement) || button.disabled) return false;
      button.click();
      return true;
    })()`);
    if (!submitted) throw new Error("failed owner invitation fixture could not submit the customer form");

    await waitFor(
      client,
      "failed owner invitation recovery warning",
      `(() => ({
        ready: document.body?.innerText?.includes("Owner invitation needs a retry") === true,
        tokenLink: document.body?.innerText?.includes("One-time owner invitation link") === true,
        accessAction: [...document.querySelectorAll("button")]
          .some((button) => button.textContent?.includes("Open customer access")),
      }))()`,
    );
    const warning = await evaluate(client, `(() => ({
      tokenLink: document.body?.innerText?.includes("One-time owner invitation link") === true,
      accessAction: [...document.querySelectorAll("button")]
        .some((button) => button.textContent?.includes("Open customer access")),
    }))()`);
    if (warning.tokenLink) throw new Error("failed owner invitation warning exposed a one-time token link");
    if (!warning.accessAction) throw new Error("failed owner invitation warning did not expose customer access");

    const opened = await evaluate(client, `(() => {
      const button = [...document.querySelectorAll("button")]
        .find((candidate) => candidate.textContent?.includes("Open customer access"));
      if (!(button instanceof HTMLElement)) return false;
      button.click();
      return true;
    })()`);
    if (!opened) throw new Error("failed owner invitation recovery action could not open customer access");

    await waitFor(
      client,
      "owner invitation retry access form",
      `(() => {
        const form = [...document.querySelectorAll("form")]
          .find((candidate) => candidate.querySelector("h3")?.textContent?.trim() === "Retry owner invitation");
        const email = form?.querySelector('input[type="email"]');
        const role = form?.querySelector("select");
        const submit = form?.querySelector('button[type="submit"]');
        return {
          ready: document.querySelector("#customer-access-heading") !== null
            && form !== undefined
            && email?.value === "owner-retry@example.test"
            && email?.readOnly === true
            && role?.value === "owner"
            && submit?.textContent?.includes("Retry owner invitation") === true,
        };
      })()`,
    );
    console.log("✔ failed owner invitation recovery opens the locked owner retry form");
  } finally {
    await closeTarget(target, client);
  }
}

async function checkMailboxRecoveryFlows() {
  const flows = [
    {
      scenario: "existing",
      name: "already-imported mailbox message",
      expectedButton: "Open existing intake",
      expectedState: "existing",
    },
    {
      scenario: "duplicate",
      name: "mailbox duplicate recovery",
      expectedButton: "Import",
      expectedState: "duplicate",
    },
    {
      scenario: "provider-failure",
      name: "mailbox provider failure",
      expectedButton: "Import",
      expectedState: "provider-failure",
    },
  ];

  for (const flow of flows) {
    const { target, client } = await openTarget(
      `/itb-intakes?browserAuth=authenticated&browserMailbox=${flow.scenario}`,
    );
    try {
      await waitFor(
        client,
        `${flow.name} intake page`,
        `(() => ({
          ready: document.querySelector("h1")?.textContent?.trim() === "ITB intakes"
            && document.querySelector('[data-testid="button-mailbox-preview"]') !== null,
        }))()`,
      );

      const opened = await evaluate(client, `(() => {
        const button = document.querySelector('[data-testid="button-mailbox-preview"]');
        if (!(button instanceof HTMLElement)) return false;
        button.click();
        return true;
      })()`);
      if (!opened) throw new Error(`${flow.name}: mailbox preview opener missing`);

      await waitFor(
        client,
        `${flow.name} mailbox dialog`,
        `(() => ({
          ready: document.querySelector('[role="dialog"]') !== null
            && [...document.querySelectorAll('[role="dialog"] button')].some((button) => button.textContent?.trim() === "Preview"),
        }))()`,
      );

      const previewed = await evaluate(client, `(() => {
        const dialog = document.querySelector('[role="dialog"]');
        const button = [...(dialog?.querySelectorAll("button") ?? [])]
          .find((candidate) => candidate.textContent?.trim() === "Preview");
        if (!(button instanceof HTMLElement)) return false;
        button.click();
        return true;
      })()`);
      if (!previewed) throw new Error(`${flow.name}: mailbox preview action missing`);

      await waitFor(
        client,
        `${flow.name} mailbox message`,
        `(() => ({
          ready: document.querySelector('[data-testid="mailbox-import-browser-mailbox-message"]') !== null,
        }))()`,
      );

      const messageState = await evaluate(client, `(() => {
        const button = document.querySelector('[data-testid="mailbox-import-browser-mailbox-message"]');
        return { label: button?.textContent?.trim() ?? "" };
      })()`);
      if (messageState.label !== flow.expectedButton) {
        throw new Error(`${flow.name}: mailbox action "${messageState.label}" instead of "${flow.expectedButton}"`);
      }

      const imported = await evaluate(client, `(() => {
        const button = document.querySelector('[data-testid="mailbox-import-browser-mailbox-message"]');
        if (!(button instanceof HTMLElement)) return false;
        button.click();
        return true;
      })()`);
      if (!imported) throw new Error(`${flow.name}: mailbox message action could not be clicked`);

      if (flow.expectedState === "existing") {
        await waitFor(
          client,
          `${flow.name} detail`,
          `(() => ({
            ready: document.querySelector('[role="dialog"]') === null
              && document.querySelector("h2")?.textContent?.trim() === "ITB Browser Mailbox Recovery",
          }))()`,
        );
      } else if (flow.expectedState === "duplicate") {
        await waitFor(
          client,
          `${flow.name} recovery banner`,
          `(() => ({
            ready: document.querySelector('[data-testid="mailbox-import-duplicate"]') !== null
              && document.querySelector('[data-testid="mailbox-open-existing-intake"]') !== null,
          }))()`,
        );

        const openedExisting = await evaluate(client, `(() => {
          const button = document.querySelector('[data-testid="mailbox-open-existing-intake"]');
          if (!(button instanceof HTMLElement)) return false;
          button.click();
          return true;
        })()`);
        if (!openedExisting) throw new Error(`${flow.name}: existing intake action could not be clicked`);

        await waitFor(
          client,
          `${flow.name} detail`,
          `(() => ({
            ready: document.querySelector('[role="dialog"]') === null
              && document.querySelector("h2")?.textContent?.trim() === "ITB Browser Mailbox Recovery",
          }))()`,
        );
      } else {
        await waitFor(
          client,
          `${flow.name} error`,
          `(() => ({
            ready: document.querySelector('[data-testid="mailbox-import-error"]') !== null
              && document.querySelector('[data-testid="mailbox-import-duplicate"]') === null,
          }))()`,
        );
      }
    } finally {
      await closeTarget(target, client);
    }
  }
  console.log("✔ mailbox existing-intake, duplicate-recovery, and provider-failure flows");
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
const browser = spawn(chromium, [
  "--headless=new",
  "--no-sandbox",
  "--disable-gpu",
  "--disable-dev-shm-usage",
  `--remote-debugging-port=${debuggingPort}`,
  `--user-data-dir=/tmp/clc-browser-routes-chromium-${process.pid}`,
  "about:blank",
], {
  stdio: ["ignore", "pipe", "pipe"],
});

let serverOutput = "";
server.stdout.on("data", (chunk) => { serverOutput += chunk; });
server.stderr.on("data", (chunk) => { serverOutput += chunk; });
let browserOutput = "";
browser.stdout.on("data", (chunk) => { browserOutput += chunk; });
browser.stderr.on("data", (chunk) => { browserOutput += chunk; });

try {
  await waitForServer(server);
  await waitForDevTools();
  if (process.env.CLC_BROWSER_TEST_SKIP_ROUTE_MATRIX !== "1") {
    for (const routeCase of cases) {
      await visit(routeCase);
      console.log(`✔ ${routeCase.name}`);
    }
  }
  await checkProjectDetailReturnSafety();
  await checkProjectDetailActionsPreserveReturnContext();
  await checkActiveProjectsClearSearch();
  await checkFailedOwnerInvitationRecovery();
  await checkMailboxRecoveryFlows();
  console.log(
    process.env.CLC_BROWSER_TEST_SKIP_ROUTE_MATRIX === "1"
      ? "Validated failed owner invitation recovery and mailbox recovery flows."
      : `Validated ${cases.length} authenticated and protected browser routes plus failed owner invitation and mailbox recovery flows.`,
  );
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  if (serverOutput) console.error(serverOutput);
  if (browserOutput) console.error(browserOutput);
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
  if (browser.exitCode === null && browser.signalCode === null) {
    browser.kill("SIGTERM");
    await Promise.race([once(browser, "exit"), new Promise((resolve) => setTimeout(resolve, 2_000))]);
    if (browser.exitCode === null && browser.signalCode === null) {
      browser.kill("SIGKILL");
      await once(browser, "exit");
    }
  }
}
