import { spawn } from "node:child_process";
import { once } from "node:events";
const appPort = Number(process.env.CLC_PROJECT_CREATE_TEST_PORT ?? 22784);
const debuggingPort = Number(process.env.CLC_PROJECT_CREATE_DEBUG_PORT ?? 22785);
const baseUrl = `http://127.0.0.1:${appPort}`;
const chromium = process.env.CHROMIUM_PATH ?? "/repl/tools/bin/chromium";
const mobileViewport = {
  width: 390,
  height: 844,
  deviceScaleFactor: 1,
  mobile: true,
};

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

async function openTarget(path, viewport) {
  const response = await fetch(
    `http://127.0.0.1:${debuggingPort}/json/new?${encodeURIComponent(`${baseUrl}${path}`)}`,
    { method: "PUT" },
  );
  if (!response.ok) throw new Error(`Could not create Chromium target: ${response.status}`);
  const target = await response.json();
  const client = await CdpClient.connect(target.webSocketDebuggerUrl);
  await Promise.all([client.command("Page.enable"), client.command("Runtime.enable")]);
  if (viewport) await client.command("Emulation.setDeviceMetricsOverride", viewport);
  await client.command("Page.navigate", { url: `${baseUrl}${path}` });
  return { target, client };
}

async function closeTarget(target, client) {
  client.close();
  await fetch(`http://127.0.0.1:${debuggingPort}/json/close/${target.id}`);
}

async function checkPermittedRole(role) {
  const { target, client } = await openTarget(
    `/dashboard/drilldown/active-projects?browserAuth=authenticated&browserRole=${role}&sort=value_desc`,
  );
  try {
    await waitFor(
      client,
      `${role} empty-state action`,
      `(() => ({
        ready: document.body?.innerText?.includes("No in flight projects") === true
          && document.querySelector('a[href^="/projects?create=1"]') !== null,
      }))()`,
    );

    const clicked = await evaluate(client, `(() => {
      const action = document.querySelector('a[href^="/projects?create=1"]');
      if (!(action instanceof HTMLElement)) return false;
      action.click();
      return true;
    })()`);
    if (!clicked) throw new Error(`${role} could not activate the empty-state create action`);

    const createIntent = await evaluate(client, `(() => {
      const url = new URL(window.location.href);
      return {
        create: url.searchParams.get("create"),
        returnPath: url.searchParams.get("return"),
      };
    })()`);
    if (createIntent.create !== "1" || !createIntent.returnPath?.includes("sort=value_desc")) {
      throw new Error(`${role} lost create intent or return filters: ${JSON.stringify(createIntent)}`);
    }

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

    const wentBack = await evaluate(client, `(() => {
      window.history.back();
      return true;
    })()`);
    if (!wentBack) throw new Error(`${role} could not navigate back from the project form`);
    await waitFor(
      client,
      `${role} Active Projects after back`,
      `(() => ({
        ready: window.location.pathname === "/dashboard/drilldown/active-projects"
          && document.querySelector('[role="dialog"]') === null,
      }))()`,
    );

    const wentForward = await evaluate(client, `(() => {
      window.history.forward();
      return true;
    })()`);
    if (!wentForward) throw new Error(`${role} could not navigate forward to the project form`);
    await waitFor(
      client,
      `${role} project form after forward`,
      `(() => ({
        ready: window.location.pathname === "/projects"
          && new URL(window.location.href).searchParams.get("create") === "1"
          && document.querySelector('[role="dialog"] h2')?.textContent?.trim() === "Create a new project",
      }))()`,
    );

    const cancelled = await evaluate(client, `(() => {
      const button = document.querySelector('[role="dialog"] button[aria-label="Close modal"]');
      if (!(button instanceof HTMLElement)) return false;
      button.click();
      return true;
    })()`);
    if (!cancelled) throw new Error(`${role} could not cancel the project form`);
    await waitFor(
      client,
      `${role} Active Projects after cancel`,
      `(() => ({
        ready: window.location.pathname === "/dashboard/drilldown/active-projects"
          && window.location.search === "?browserAuth=authenticated&browserRole=${role}&sort=value_desc"
          && document.querySelector('[role="dialog"]') === null
          && new URL(window.location.href).searchParams.get("create") === null
          && new URL(window.location.href).searchParams.get("return") === null,
      }))()`,
    );

    const reopenedAfterCancel = await evaluate(client, `(() => {
      const action = document.querySelector('a[href^="/projects?create=1"]');
      if (!(action instanceof HTMLElement)) return false;
      action.click();
      return true;
    })()`);
    if (!reopenedAfterCancel) throw new Error(`${role} could not reopen the project form after cancel`);
    await waitFor(
      client,
      `${role} project form after cancel reopen`,
      `(() => ({
        ready: window.location.pathname === "/projects"
          && new URL(window.location.href).searchParams.get("create") === "1"
          && document.querySelector('[role="dialog"] h2')?.textContent?.trim() === "Create a new project",
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
    if (role === "owner") {
      const projectNameFocused = await evaluate(client, `(() => {
        const input = document.querySelector('[data-testid="input-project-projectName"]');
        if (!(input instanceof HTMLInputElement)) return false;
        input.focus();
        return true;
      })()`);
      if (!projectNameFocused) throw new Error("owner could not focus the project name");
      await client.command("Input.insertText", { text: "Browser Created From Active Projects" });
      const ownerFormState = await evaluate(client, `(() => ({
        projectName: document.querySelector('[data-testid="input-project-projectName"]')?.value ?? "",
        submitDisabled: document.querySelector('[data-testid="button-save-project"]')?.disabled ?? true,
      }))()`);
      if (!ownerFormState.projectName || ownerFormState.submitDisabled) {
        throw new Error(`owner form is not ready to submit: ${JSON.stringify(ownerFormState)}`);
      }
      const submitted = await evaluate(client, `(() => {
        const button = document.querySelector('[data-testid="button-save-project"]');
        if (!(button instanceof HTMLButtonElement) || button.disabled) return false;
        button.click();
        return true;
      })()`);
      if (!submitted) throw new Error("owner could not submit the project form");
      await waitFor(
        client,
        "Active Projects return after project creation",
        `(() => ({
          ready: window.location.pathname === "/dashboard/drilldown/active-projects"
            && window.location.search === "?browserAuth=authenticated&browserRole=owner&sort=value_desc"
            && document.querySelector('[role="dialog"]') === null,
          url: window.location.href,
        }))()`,
      );
      console.log("✔ project creation returns to Active Projects with sort context");
    }
    console.log(`✔ ${role} can open the project form from the empty state`);
  } finally {
    await closeTarget(target, client);
  }
}

async function checkDirectProjectBookCreation() {
  const { target, client } = await openTarget(
    "/projects?browserAuth=authenticated&browserRole=owner",
  );
  try {
    await waitFor(
      client,
      "direct project-book page",
      `(() => ({
        ready: document.querySelector('[data-testid="button-new-project"]') !== null,
      }))()`,
    );
    const opened = await evaluate(client, `(() => {
      const button = document.querySelector('[data-testid="button-new-project"]');
      if (!(button instanceof HTMLElement)) return false;
      button.click();
      return true;
    })()`);
    if (!opened) throw new Error("direct project-book create action was unavailable");
    await waitFor(
      client,
      "direct project-book modal",
      `(() => ({
        ready: document.querySelector('[role="dialog"] h2')?.textContent?.trim() === "Create a new project",
      }))()`,
    );
    const cancelled = await evaluate(client, `(() => {
      const button = document.querySelector('[role="dialog"] button[aria-label="Close modal"]');
      if (!(button instanceof HTMLElement)) return false;
      button.click();
      return true;
    })()`);
    if (!cancelled) throw new Error("direct project-book form could not be canceled");
    await waitFor(
      client,
      "direct project-book cancel",
      `(() => ({
        ready: window.location.pathname === "/projects"
          && window.location.search === "?browserAuth=authenticated&browserRole=owner"
          && document.querySelector('[role="dialog"]') === null
          && new URL(window.location.href).searchParams.get("create") === null
          && new URL(window.location.href).searchParams.get("return") === null,
      }))()`,
    );
    const reopened = await evaluate(client, `(() => {
      const button = document.querySelector('[data-testid="button-new-project"]');
      if (!(button instanceof HTMLElement)) return false;
      button.click();
      return true;
    })()`);
    if (!reopened) throw new Error("direct project-book form could not be reopened after cancel");
    await waitFor(
      client,
      "direct project-book modal after cancel",
      `(() => ({
        ready: document.querySelector('[role="dialog"] h2')?.textContent?.trim() === "Create a new project",
      }))()`,
    );
    const customerInputFocused = await evaluate(client, `(() => {
      const input = document.querySelector('[data-testid="input-project-customer"]');
      if (!(input instanceof HTMLInputElement)) return false;
      input.focus();
      input.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
      return true;
    })()`);
    if (!customerInputFocused) throw new Error("direct project-book flow could not open the customer selector");
    await waitFor(
      client,
      "direct project-book customer selector",
      `(() => ({
        ready: [...document.querySelectorAll('[role="option"]')]
          .some((option) => option.textContent?.includes("Browser Test Customer")),
      }))()`,
    );
    const customerSelected = await evaluate(client, `(() => {
      const option = [...document.querySelectorAll('[role="option"]')]
        .find((candidate) => candidate.textContent?.includes("Browser Test Customer"));
      if (!(option instanceof HTMLElement)) return false;
      option.click();
      return true;
    })()`);
    if (!customerSelected) throw new Error("direct project-book flow could not select the customer");
    const projectNameFocused = await evaluate(client, `(() => {
      const input = document.querySelector('[data-testid="input-project-projectName"]');
      if (!(input instanceof HTMLInputElement)) return false;
      input.focus();
      return true;
    })()`);
    if (!projectNameFocused) throw new Error("direct project-book flow could not focus the project name");
    await client.command("Input.insertText", { text: "Browser Direct Project" });
    const directFormState = await evaluate(client, `(() => ({
      projectName: document.querySelector('[data-testid="input-project-projectName"]')?.value ?? "",
      submitDisabled: document.querySelector('[data-testid="button-save-project"]')?.disabled ?? true,
    }))()`);
    if (!directFormState.projectName || directFormState.submitDisabled) {
      throw new Error(`direct project-book form is not ready to submit: ${JSON.stringify(directFormState)}`);
    }
    const submitted = await evaluate(client, `(() => {
      const button = document.querySelector('[data-testid="button-save-project"]');
      if (!(button instanceof HTMLButtonElement) || button.disabled) return false;
      button.click();
      return true;
    })()`);
    if (!submitted) throw new Error("direct project-book flow could not submit");
    await waitFor(
      client,
      "direct project-book return",
      `(() => ({
        ready: window.location.pathname === "/projects"
          && window.location.search === "?browserAuth=authenticated&browserRole=owner"
          && document.querySelector('[role="dialog"]') === null,
        url: window.location.href,
      }))()`,
    );
    console.log("✔ direct project-book creation stays on the project book");
  } finally {
    await closeTarget(target, client);
  }
}

async function checkFailedActiveProjectSaveCancellation() {
  const activeProjectsPath =
    "/dashboard/drilldown/active-projects?browserAuth=authenticated&browserRole=owner&sort=value_desc";
  const { target, client } = await openTarget(activeProjectsPath);
  try {
    await waitFor(
      client,
      "failed-save Active Projects empty-state action",
      `(() => ({
        ready: document.body?.innerText?.includes("No in flight projects") === true
          && document.querySelector('a[href^="/projects?create=1"]') !== null,
      }))()`,
    );

    const opened = await evaluate(client, `(() => {
      const action = document.querySelector('a[href^="/projects?create=1"]');
      if (!(action instanceof HTMLElement)) return false;
      action.click();
      return true;
    })()`);
    if (!opened) throw new Error("failed-save Active Projects could not open the project form");
    await waitFor(
      client,
      "failed-save Active Projects project form",
      `(() => ({
        ready: document.querySelector('[role="dialog"] h2')?.textContent?.trim() === "Create a new project",
      }))()`,
    );

    const failureInstalled = await evaluate(client, `(() => {
      const originalFetch = window.fetch;
      window.fetch = async (input, init = {}) => {
        const requestUrl = typeof input === "string"
          ? input
          : input instanceof URL
            ? input.toString()
            : input.url;
        const requestMethod = String(
          init.method
            ?? (typeof input === "string" || input instanceof URL ? "GET" : input.method),
        ).toUpperCase();
        const requestPath = new URL(requestUrl, window.location.origin).pathname;
        if (requestPath === "/api/projects" && requestMethod === "POST") {
          return new Response(
            JSON.stringify({ error: "Browser test forced project save failure" }),
            { status: 500, headers: { "content-type": "application/json" } },
          );
        }
        return originalFetch(input, init);
      };
      return true;
    })()`);
    if (!failureInstalled) throw new Error("failed-save browser response could not be installed");

    const customerFocused = await evaluate(client, `(() => {
      const input = document.querySelector('[data-testid="input-project-customer"]');
      if (!(input instanceof HTMLInputElement)) return false;
      input.focus();
      input.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
      return true;
    })()`);
    if (!customerFocused) throw new Error("failed-save flow could not focus the customer selector");
    await waitFor(
      client,
      "failed-save customer selector",
      `(() => ({
        ready: [...document.querySelectorAll('[role="option"]')]
          .some((option) => option.textContent?.includes("Browser Test Customer")),
      }))()`,
    );
    const customerSelected = await evaluate(client, `(() => {
      const option = [...document.querySelectorAll('[role="option"]')]
        .find((candidate) => candidate.textContent?.includes("Browser Test Customer"));
      if (!(option instanceof HTMLElement)) return false;
      option.click();
      return true;
    })()`);
    if (!customerSelected) throw new Error("failed-save flow could not select the customer");

    const projectNameFocused = await evaluate(client, `(() => {
      const input = document.querySelector('[data-testid="input-project-projectName"]');
      if (!(input instanceof HTMLInputElement)) return false;
      input.focus();
      return true;
    })()`);
    if (!projectNameFocused) throw new Error("failed-save flow could not focus the project name");
    await client.command("Input.insertText", { text: "Browser Failed Save Project" });

    const submitted = await evaluate(client, `(() => {
      const button = document.querySelector('[data-testid="button-save-project"]');
      if (!(button instanceof HTMLButtonElement) || button.disabled) return false;
      button.click();
      return true;
    })()`);
    if (!submitted) throw new Error("failed-save flow could not submit the project form");
    await waitFor(
      client,
      "failed-save error state",
      `(() => ({
        ready: document.querySelector('[role="dialog"] h2')?.textContent?.trim() === "Create a new project"
          && document.querySelector('[role="dialog"] [role="alert"]')?.textContent?.includes("This project could not be saved.") === true
          && document.querySelector('[role="dialog"] [data-testid="button-cancel-project"]') !== null,
      }))()`,
    );

    const cancelled = await evaluate(client, `(() => {
      const button = document.querySelector('[role="dialog"] [data-testid="button-cancel-project"]');
      if (!(button instanceof HTMLElement)) return false;
      button.click();
      return true;
    })()`);
    if (!cancelled) throw new Error("failed-save project form could not be canceled");
    await waitFor(
      client,
      "failed-save Active Projects return after cancel",
      `(() => ({
        ready: window.location.pathname === "/dashboard/drilldown/active-projects"
          && window.location.search === "?browserAuth=authenticated&browserRole=owner&sort=value_desc"
          && document.querySelector('[role="dialog"]') === null
          && new URL(window.location.href).searchParams.get("create") === null
          && new URL(window.location.href).searchParams.get("return") === null,
        url: window.location.href,
      }))()`,
    );
    console.log("✔ failed project saves remain cancelable and return to Active Projects");
  } finally {
    await closeTarget(target, client);
  }
}

async function checkMobileCancellation() {
  const activeProjectsPath =
    "/dashboard/drilldown/active-projects?browserAuth=authenticated&browserRole=owner&sort=value_desc";
  const activeProjects = await openTarget(activeProjectsPath, mobileViewport);
  try {
    await waitFor(
      activeProjects.client,
      "mobile Active Projects empty-state action",
      `(() => ({
        ready: window.innerWidth === 390
          && document.body?.innerText?.includes("No in flight projects") === true
          && document.querySelector('a[href^="/projects?create=1"]') !== null,
        width: window.innerWidth,
      }))()`,
    );

    const clicked = await evaluate(activeProjects.client, `(() => {
      const action = document.querySelector('a[href^="/projects?create=1"]');
      if (!(action instanceof HTMLElement)) return false;
      action.click();
      return true;
    })()`);
    if (!clicked) throw new Error("mobile Active Projects could not open the project form");

    const createIntent = await evaluate(activeProjects.client, `(() => {
      const url = new URL(window.location.href);
      return {
        create: url.searchParams.get("create"),
        returnPath: url.searchParams.get("return"),
      };
    })()`);
    if (createIntent.create !== "1" || createIntent.returnPath !== activeProjectsPath) {
      throw new Error(`mobile Active Projects lost its exact return context: ${JSON.stringify(createIntent)}`);
    }

    await waitFor(
      activeProjects.client,
      "mobile Active Projects project form",
      `(() => ({
        ready: document.querySelector('[role="dialog"] h2')?.textContent?.trim() === "Create a new project",
      }))()`,
    );
    const closed = await evaluate(activeProjects.client, `(() => {
      const button = document.querySelector('[role="dialog"] button[aria-label="Close modal"]');
      if (!(button instanceof HTMLElement)) return false;
      button.click();
      return true;
    })()`);
    if (!closed) throw new Error("mobile Active Projects form could not be closed");

    await waitFor(
      activeProjects.client,
      "mobile Active Projects return after cancel",
      `(() => ({
        ready: window.innerWidth === 390
          && window.location.pathname === "/dashboard/drilldown/active-projects"
          && window.location.search === "?browserAuth=authenticated&browserRole=owner&sort=value_desc"
          && document.querySelector('[role="dialog"]') === null
          && new URL(window.location.href).searchParams.get("create") === null
          && new URL(window.location.href).searchParams.get("return") === null,
        url: window.location.href,
      }))()`,
    );
    console.log("✔ mobile Active Projects cancel returns to its exact origin");
  } finally {
    await closeTarget(activeProjects.target, activeProjects.client);
  }

  const projectBookPath = "/projects?browserAuth=authenticated&browserRole=owner";
  const projectBook = await openTarget(projectBookPath, mobileViewport);
  try {
    await waitFor(
      projectBook.client,
      "mobile direct project-book page",
      `(() => ({
        ready: window.innerWidth === 390
          && document.querySelector('[data-testid="button-new-project"]') !== null,
      }))()`,
    );
    const opened = await evaluate(projectBook.client, `(() => {
      const button = document.querySelector('[data-testid="button-new-project"]');
      if (!(button instanceof HTMLElement)) return false;
      button.click();
      return true;
    })()`);
    if (!opened) throw new Error("mobile direct project-book create action was unavailable");

    await waitFor(
      projectBook.client,
      "mobile direct project-book modal",
      `(() => ({
        ready: document.querySelector('[role="dialog"] h2')?.textContent?.trim() === "Create a new project",
      }))()`,
    );
    const cancelled = await evaluate(projectBook.client, `(() => {
      const button = document.querySelector('[data-testid="button-cancel-project"]');
      if (!(button instanceof HTMLElement)) return false;
      button.click();
      return true;
    })()`);
    if (!cancelled) throw new Error("mobile direct project-book form could not be canceled");

    await waitFor(
      projectBook.client,
      "mobile direct project-book cancel",
      `(() => ({
        ready: window.innerWidth === 390
          && window.location.pathname === "/projects"
          && window.location.search === "?browserAuth=authenticated&browserRole=owner"
          && document.querySelector('[role="dialog"]') === null
          && new URL(window.location.href).searchParams.get("create") === null
          && new URL(window.location.href).searchParams.get("return") === null,
        url: window.location.href,
      }))()`,
    );
    console.log("✔ mobile direct project-book cancel stays usable");
  } finally {
    await closeTarget(projectBook.target, projectBook.client);
  }
}

async function checkPermittedQueryCleanup() {
  const { target, client } = await openTarget(
    "/projects?browserAuth=authenticated&browserRole=owner&search=alpha&stage=opportunity&ownerUserId=unassigned&customerId=42&create=1",
  );
  try {
    await waitFor(
      client,
      "owner direct create intent modal",
      `(() => ({
        ready: document.querySelector('[role="dialog"] h2')?.textContent?.trim() === "Create a new project",
      }))()`,
    );
    const initialQuery = await evaluate(client, `(() => {
      const params = new URL(window.location.href).searchParams;
      return {
        search: params.get("search"),
        stage: params.get("stage"),
        ownerUserId: params.get("ownerUserId"),
        customerId: params.get("customerId"),
        create: params.get("create"),
      };
    })()`);
    if (JSON.stringify(initialQuery) !== JSON.stringify({
      search: "alpha",
      stage: "opportunity",
      ownerUserId: "unassigned",
      customerId: "42",
      create: "1",
    })) {
      throw new Error(`owner direct create intent changed query state: ${JSON.stringify(initialQuery)}`);
    }

    const closed = await evaluate(client, `(() => {
      const button = document.querySelector('[role="dialog"] button[aria-label="Close modal"]');
      if (!(button instanceof HTMLElement)) return false;
      button.click();
      return true;
    })()`);
    if (!closed) throw new Error("owner could not close the direct create form");
    await waitFor(
      client,
      "owner direct create cleanup",
      `(() => ({
        ready: document.querySelector('[role="dialog"]') === null
          && new URL(window.location.href).searchParams.get("create") === null,
      }))()`,
    );
    const cleanedQuery = await evaluate(client, `(() => {
      const params = new URL(window.location.href).searchParams;
      return {
        browserAuth: params.get("browserAuth"),
        browserRole: params.get("browserRole"),
        search: params.get("search"),
        stage: params.get("stage"),
        ownerUserId: params.get("ownerUserId"),
        customerId: params.get("customerId"),
        create: params.get("create"),
      };
    })()`);
    if (JSON.stringify(cleanedQuery) !== JSON.stringify({
      browserAuth: "authenticated",
      browserRole: "owner",
      search: "alpha",
      stage: "opportunity",
      ownerUserId: "unassigned",
      customerId: "42",
      create: null,
    })) {
      throw new Error(`owner close changed unrelated query state: ${JSON.stringify(cleanedQuery)}`);
    }
    console.log("✔ permitted close removes only the create flag");
  } finally {
    await closeTarget(target, client);
  }
}

async function checkCustomerDetailProjectShortcut(role, expectedShortcut) {
  const { target, client } = await openTarget(
    `/customers/42?browserAuth=authenticated&browserRole=${role}`,
  );
  try {
    await waitFor(
      client,
      `${role} customer detail project shortcut`,
      `(() => ({
        ready: document.body?.innerText?.includes("Browser Test Customer") === true
          && Boolean(document.querySelector('a[href="/projects?customerId=42"]')) === ${expectedShortcut},
      }))()`,
    );
    if (!expectedShortcut) {
      console.log("✔ viewer does not receive the customer-detail project create action");
      return;
    }

    const clicked = await evaluate(client, `(() => {
      const action = document.querySelector('a[href="/projects?customerId=42"]');
      if (!(action instanceof HTMLElement)) return false;
      action.click();
      return true;
    })()`);
    if (!clicked) throw new Error(`${role} could not activate the customer-detail project shortcut`);

    await waitFor(
      client,
      `${role} customer-preselected project form`,
      `(() => ({
        ready: window.location.pathname === "/projects"
          && new URL(window.location.href).searchParams.get("customerId") === "42"
          && document.querySelector('[role="dialog"] h2')?.textContent?.trim() === "Create a new project"
          && document.querySelector('[data-testid="input-project-customer"]')?.value === "Browser Test Customer",
      }))()`,
    );

    const cleared = await evaluate(client, `(() => {
      const button = document.querySelector('[role="dialog"] button[aria-label="Clear selected customer"]');
      if (!(button instanceof HTMLElement)) return false;
      button.click();
      return true;
    })()`);
    if (!cleared) throw new Error(`${role} could not clear the preselected customer`);
    await waitFor(
      client,
      `${role} cleared customer selection`,
      `(() => ({
        ready: document.querySelector('[data-testid="input-project-customer"]')?.value === ""
          && document.querySelector('[role="dialog"] button[aria-label="Clear selected customer"]') === null,
      }))()`,
    );

    const focused = await evaluate(client, `(() => {
      const input = document.querySelector('[data-testid="input-project-customer"]');
      if (!(input instanceof HTMLInputElement)) return false;
      input.focus();
      return true;
    })()`);
    if (!focused) throw new Error(`${role} could not focus the customer selector after clearing`);
    await client.command("Input.insertText", { text: "Browser Alternate Customer" });
    await waitFor(
      client,
      `${role} alternate customer option`,
      `(() => ({
        ready: [...document.querySelectorAll('[role="option"]')]
          .some((option) => option.textContent?.includes("Browser Alternate Customer")),
      }))()`,
    );
    const changed = await evaluate(client, `(() => {
      const option = [...document.querySelectorAll('[role="option"]')]
        .find((candidate) => candidate.textContent?.includes("Browser Alternate Customer"));
      if (!(option instanceof HTMLElement)) return false;
      option.click();
      return true;
    })()`);
    if (!changed) throw new Error(`${role} could not change the selected customer`);
    await waitFor(
      client,
      `${role} changed customer selection`,
      `(() => ({
        ready: document.querySelector('[data-testid="input-project-customer"]')?.value === "Browser Alternate Customer"
          && document.querySelector('[role="dialog"] button[aria-label="Clear selected customer"]') !== null,
      }))()`,
    );
    console.log(`✔ ${role} customer detail preselects and allows changing the project customer`);
  } finally {
    await closeTarget(target, client);
  }
}

async function checkReturnPathSafety() {
  const unsafeReturns = [
    { label: "external", value: "https://outside.example/projects" },
    { label: "protocol-relative", value: "//outside.example/projects" },
    { label: "malformed", value: "/projects/%ZZ" },
  ];

  for (const unsafeReturn of unsafeReturns) {
    const returnQuery = encodeURIComponent(unsafeReturn.value);
    const { target, client } = await openTarget(
      `/projects?browserAuth=authenticated&browserRole=owner&create=1&return=${returnQuery}`,
    );
    try {
      await waitFor(
        client,
        `${unsafeReturn.label} return project form`,
        `(() => ({
          ready: document.querySelector('[role="dialog"] h2')?.textContent?.trim() === "Create a new project",
        }))()`,
      );
      const closed = await evaluate(client, `(() => {
        const button = document.querySelector('[role="dialog"] button[aria-label="Close modal"]');
        if (!(button instanceof HTMLElement)) return false;
        button.click();
        return true;
      })()`);
      if (!closed) throw new Error(`${unsafeReturn.label} return form could not be closed`);
      await waitFor(
        client,
        `${unsafeReturn.label} return fallback`,
        `(() => ({
          ready: window.location.origin === ${JSON.stringify(baseUrl)}
            && window.location.pathname === "/projects"
            && window.location.search === "?browserAuth=authenticated&browserRole=owner"
            && document.querySelector('[role="dialog"]') === null,
        }))()`,
      );
    } finally {
      await closeTarget(target, client);
    }
  }
  console.log("✔ external, protocol-relative, and malformed returns fall back to the project book on close");

  const unsafeReturn = encodeURIComponent("//outside.example/projects");
  const { target, client } = await openTarget(
    `/projects?browserAuth=authenticated&browserRole=owner&create=1&return=${unsafeReturn}`,
  );
  try {
    await waitFor(
      client,
      "unsafe return submit form",
      `(() => ({
        ready: document.querySelector('[role="dialog"] h2')?.textContent?.trim() === "Create a new project",
      }))()`,
    );
    const customerInputFocused = await evaluate(client, `(() => {
      const input = document.querySelector('[data-testid="input-project-customer"]');
      if (!(input instanceof HTMLInputElement)) return false;
      input.focus();
      input.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
      return true;
    })()`);
    if (!customerInputFocused) throw new Error("unsafe return form could not open the customer selector");
    await waitFor(
      client,
      "unsafe return customer option",
      `(() => ({
        ready: [...document.querySelectorAll('[role="option"]')]
          .some((option) => option.textContent?.includes("Browser Test Customer")),
      }))()`,
    );
    const customerSelected = await evaluate(client, `(() => {
      const option = [...document.querySelectorAll('[role="option"]')]
        .find((candidate) => candidate.textContent?.includes("Browser Test Customer"));
      if (!(option instanceof HTMLElement)) return false;
      option.click();
      return true;
    })()`);
    if (!customerSelected) throw new Error("unsafe return form could not select the customer");
    const projectNameFocused = await evaluate(client, `(() => {
      const input = document.querySelector('[data-testid="input-project-projectName"]');
      if (!(input instanceof HTMLInputElement)) return false;
      input.focus();
      return true;
    })()`);
    if (!projectNameFocused) throw new Error("unsafe return form could not focus the project name");
    await client.command("Input.insertText", { text: "Browser Unsafe Return Project" });
    const submitted = await evaluate(client, `(() => {
      const button = document.querySelector('[data-testid="button-save-project"]');
      if (!(button instanceof HTMLButtonElement) || button.disabled) return false;
      button.click();
      return true;
    })()`);
    if (!submitted) throw new Error("unsafe return form could not submit");
    await waitFor(
      client,
      "unsafe return submit fallback",
      `(() => ({
        ready: window.location.origin === ${JSON.stringify(baseUrl)}
          && window.location.pathname === "/projects"
          && window.location.search === "?browserAuth=authenticated&browserRole=owner"
          && document.querySelector('[role="dialog"]') === null,
      }))()`,
    );
  } finally {
    await closeTarget(target, client);
  }
  console.log("✔ completing with an unsafe return stays on the project book");

  const validReturn = encodeURIComponent("/dashboard/drilldown/active-projects?sort=value_desc&search=alpha");
  const validTarget = await openTarget(
    `/projects?browserAuth=authenticated&browserRole=owner&create=1&return=${validReturn}`,
  );
  try {
    await waitFor(
      validTarget.client,
      "valid internal return form",
      `(() => ({
        ready: document.querySelector('[role="dialog"] h2')?.textContent?.trim() === "Create a new project",
      }))()`,
    );
    const closed = await evaluate(validTarget.client, `(() => {
      const button = document.querySelector('[role="dialog"] button[aria-label="Close modal"]');
      if (!(button instanceof HTMLElement)) return false;
      button.click();
      return true;
    })()`);
    if (!closed) throw new Error("valid internal return form could not be closed");
    await waitFor(
      validTarget.client,
      "valid internal return navigation",
      `(() => ({
        ready: window.location.origin === ${JSON.stringify(baseUrl)}
          && window.location.pathname === "/dashboard/drilldown/active-projects"
          && window.location.search === "?sort=value_desc&search=alpha"
          && document.querySelector('[role="dialog"]') === null,
      }))()`,
    );
  } finally {
    await closeTarget(validTarget.target, validTarget.client);
  }
  console.log("✔ valid internal returns preserve their path and query parameters");
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
        ready: document.body?.innerText?.includes("No in flight projects") === true
          && document.querySelector('a[href^="/projects?create=1"]') === null,
      }))()`,
    );
    console.log("✔ viewer does not receive the project create action");
  } finally {
    await closeTarget(target, client);
  }

  const directCreate = await openTarget(
    "/projects?browserAuth=authenticated&browserRole=viewer&search=alpha&stage=opportunity&ownerUserId=unassigned&customerId=42&create=1",
  );
  try {
    await waitFor(
      directCreate.client,
      "viewer direct create intent",
      `(() => ({
        ready: document.querySelector('[role="dialog"]') === null
          && new URL(window.location.href).searchParams.get("create") === "1",
      }))()`,
    );
    const queryState = await evaluate(directCreate.client, `(() => {
      const params = new URL(window.location.href).searchParams;
      return {
        search: params.get("search"),
        stage: params.get("stage"),
        ownerUserId: params.get("ownerUserId"),
        customerId: params.get("customerId"),
        create: params.get("create"),
      };
    })()`);
    if (JSON.stringify(queryState) !== JSON.stringify({
      search: "alpha",
      stage: "opportunity",
      ownerUserId: "unassigned",
      customerId: "42",
      create: "1",
    })) {
      throw new Error(`viewer direct create intent changed query state: ${JSON.stringify(queryState)}`);
    }
    console.log("✔ viewer keeps the create intent URL without opening a restricted form");
  } finally {
    await closeTarget(directCreate.target, directCreate.client);
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
  await checkCustomerDetailProjectShortcut("member", true);
  await checkCustomerDetailProjectShortcut("viewer", false);
  await checkRestrictedRole();
  await checkDirectProjectBookCreation();
  await checkFailedActiveProjectSaveCancellation();
  await checkMobileCancellation();
  await checkPermittedQueryCleanup();
  await checkReturnPathSafety();
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