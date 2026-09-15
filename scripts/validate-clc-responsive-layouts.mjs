import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { deflateSync, inflateSync } from "node:zlib";

const appPort = Number(process.env.CLC_RESPONSIVE_TEST_PORT ?? 22782);
const debuggingPort = Number(process.env.CLC_RESPONSIVE_DEBUG_PORT ?? 22783);
const baseUrl = `http://127.0.0.1:${appPort}`;
const chromium = process.env.CHROMIUM_PATH ?? "/repl/tools/bin/chromium";
const profileDir = `/tmp/clc-responsive-chromium-${process.pid}`;
const baselineDir = fileURLToPath(new URL("./fixtures/clc-visual-baselines/", import.meta.url));
const diffDir = process.env.CLC_VISUAL_DIFF_DIR ?? `${process.cwd()}/tmp/clc-visual-diffs`;
const updateBaselines = process.env.CLC_UPDATE_VISUAL_BASELINES === "1";
const visualChannelTolerance = Number(process.env.CLC_VISUAL_CHANNEL_TOLERANCE ?? 8);
const visualMaxDiffRatio = Number(process.env.CLC_VISUAL_MAX_DIFF_RATIO ?? 0.0025);
const visualMaxMeanError = Number(process.env.CLC_VISUAL_MAX_MEAN_ERROR ?? 1.5);
const viewports = [
  { name: "mobile", width: 390, height: 844 },
  { name: "desktop", width: 1440, height: 1000 },
];
const cases = [
  {
    id: "public-landing",
    name: "public landing",
    path: "/?browserAuth=signed-out",
    heading: "Construct Lifecycle",
    actions: ['a[href="/sign-in"]', 'a[href="/sign-up"]'],
    shell: false,
  },
  {
    id: "authenticated-workspace-shell",
    name: "authenticated workspace shell",
    path: "/overview?browserAuth=authenticated",
    actions: ['a[data-testid="link-brand"]'],
    shell: true,
  },
  {
    id: "project-list",
    name: "project list",
    path: "/projects?browserAuth=authenticated",
    heading: "Projects",
    actions: ['button[data-testid="button-new-project"]', 'a[data-testid="link-project-42"]'],
    dialog: {
      openSelector: 'button[data-testid="button-new-project"]',
      title: "Create a new project",
      submitSelector: 'button[data-testid="button-save-project"]',
      submitLabel: "Create project",
    },
    shell: true,
  },
  {
    id: "project-detail",
    name: "project detail",
    path: "/projects/42?browserAuth=authenticated",
    heading: "Browser Test Project",
    actions: ['a[data-testid="link-back-projects"]', 'button[data-testid="button-edit-project-detail"]'],
    dialog: {
      openSelector: 'button[data-testid="button-edit-project-detail"]',
      title: "Edit P-0042",
      submitSelector: 'button[data-testid="button-save-project"]',
      submitLabel: "Save changes",
    },
    shell: true,
  },
  {
    id: "active-projects-empty-guidance",
    name: "active projects empty guidance",
    path: "/dashboard/drilldown/active-projects?browserAuth=authenticated",
    heading: "Active Projects",
    actions: ['a[href^="/projects?create=1"]'],
    requiredSelectors: ['a[data-testid="link-drilldown-project-42"]'],
    requiredTexts: [
      "No in flight projects",
      "Create a project or move a paused project into In Flight when work is ready.",
      "Paused projects",
      "Projects currently carrying the Paused status.",
      "In Flight projects",
      "Projects currently carrying the In Flight status.",
      "Browser Test Waiting Project",
    ],
    orderedTexts: ["Paused projects", "In Flight projects"],
    shell: true,
  },
  {
    id: "active-projects-filtered-empty-guidance",
    name: "active projects filtered empty guidance",
    path: "/dashboard/drilldown/active-projects?browserAuth=authenticated&search=does-not-match&sort=value_desc",
    heading: "Active Projects",
    actions: ['a[href^="/dashboard/drilldown/active-projects?browserAuth=authenticated&sort=value_desc"]'],
    requiredTexts: [
      "No paused projects match",
      "Clear the search to view all paused projects.",
      "No in flight projects match",
      "Clear the search to view all in flight projects.",
    ],
    orderedTexts: ["Paused projects", "In Flight projects"],
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

const pngSignature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const typeBuffer = Buffer.from(type);
  const body = Buffer.concat([typeBuffer, data]);
  const header = Buffer.alloc(4);
  header.writeUInt32BE(data.length, 0);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([header, body, checksum]);
}

function encodeRgbaPng(width, height, rgba) {
  const scanlines = Buffer.alloc((width * 4 + 1) * height);
  for (let row = 0; row < height; row += 1) {
    const scanlineOffset = row * (width * 4 + 1);
    scanlines[scanlineOffset] = 0;
    rgba.copy(scanlines, scanlineOffset + 1, row * width * 4, (row + 1) * width * 4);
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 6;
  return Buffer.concat([
    pngSignature,
    pngChunk("IHDR", header),
    pngChunk("IDAT", deflateSync(scanlines, { level: 9 })),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

function decodeRgbaPng(buffer) {
  if (!buffer.subarray(0, pngSignature.length).equals(pngSignature)) {
    throw new Error("Visual baseline is not a PNG");
  }
  let offset = pngSignature.length;
  let width;
  let height;
  let bitDepth;
  let colorType;
  const imageData = [];
  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString("ascii", offset + 4, offset + 8);
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    const data = buffer.subarray(dataStart, dataEnd);
    offset = dataEnd + 4;
    if (type === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
    } else if (type === "IDAT") {
      imageData.push(data);
    } else if (type === "IEND") {
      break;
    }
  }
  if (!width || !height || bitDepth !== 8 || ![2, 6].includes(colorType)) {
    throw new Error("Visual baseline must be an 8-bit RGB or RGBA PNG");
  }
  const bytesPerPixel = colorType === 6 ? 4 : 3;
  const stride = width * bytesPerPixel;
  const decoded = inflateSync(Buffer.concat(imageData));
  const rgba = Buffer.alloc(width * height * 4);
  let sourceOffset = 0;
  let previousRow = Buffer.alloc(stride);
  for (let rowIndex = 0; rowIndex < height; rowIndex += 1) {
    const filter = decoded[sourceOffset];
    sourceOffset += 1;
    const row = Buffer.from(decoded.subarray(sourceOffset, sourceOffset + stride));
    sourceOffset += stride;
    if (row.length !== stride) throw new Error("Visual baseline PNG data is truncated");
    for (let index = 0; index < stride; index += 1) {
      const left = index >= bytesPerPixel ? row[index - bytesPerPixel] : 0;
      const above = previousRow[index] ?? 0;
      const upperLeft = index >= bytesPerPixel ? previousRow[index - bytesPerPixel] ?? 0 : 0;
      if (filter === 1) row[index] = (row[index] + left) & 0xff;
      else if (filter === 2) row[index] = (row[index] + above) & 0xff;
      else if (filter === 3) row[index] = (row[index] + Math.floor((left + above) / 2)) & 0xff;
      else if (filter === 4) {
        const estimate = left + above - upperLeft;
        const leftDistance = Math.abs(estimate - left);
        const aboveDistance = Math.abs(estimate - above);
        const upperLeftDistance = Math.abs(estimate - upperLeft);
        const predictor = leftDistance <= aboveDistance && leftDistance <= upperLeftDistance
          ? left
          : aboveDistance <= upperLeftDistance ? above : upperLeft;
        row[index] = (row[index] + predictor) & 0xff;
      } else if (filter !== 0) {
        throw new Error(`Unsupported visual baseline PNG filter ${filter}`);
      }
    }
    for (let pixel = 0; pixel < width; pixel += 1) {
      const source = pixel * bytesPerPixel;
      const target = (rowIndex * width + pixel) * 4;
      rgba[target] = row[source];
      rgba[target + 1] = row[source + 1];
      rgba[target + 2] = row[source + 2];
      rgba[target + 3] = colorType === 6 ? row[source + 3] : 255;
    }
    previousRow = row;
  }
  return { width, height, rgba };
}

function comparePng(expectedBuffer, actualBuffer) {
  const expected = decodeRgbaPng(expectedBuffer);
  const actual = decodeRgbaPng(actualBuffer);
  if (expected.width !== actual.width || expected.height !== actual.height) {
    return {
      matches: false,
      summary: `dimensions ${actual.width}×${actual.height}, expected ${expected.width}×${expected.height}`,
    };
  }
  const diff = Buffer.alloc(actual.rgba.length);
  let differingPixels = 0;
  let totalError = 0;
  let maximumError = 0;
  for (let offset = 0; offset < actual.rgba.length; offset += 4) {
    const red = Math.abs(actual.rgba[offset] - expected.rgba[offset]);
    const green = Math.abs(actual.rgba[offset + 1] - expected.rgba[offset + 1]);
    const blue = Math.abs(actual.rgba[offset + 2] - expected.rgba[offset + 2]);
    const alpha = Math.abs(actual.rgba[offset + 3] - expected.rgba[offset + 3]);
    const error = Math.max(red, green, blue, alpha);
    maximumError = Math.max(maximumError, error);
    totalError += red + green + blue + alpha;
    if (error > visualChannelTolerance) {
      differingPixels += 1;
      const intensity = Math.min(255, 80 + error * 8);
      diff[offset] = 255;
      diff[offset + 1] = Math.max(0, 255 - intensity);
      diff[offset + 2] = Math.max(0, 255 - intensity);
      diff[offset + 3] = 255;
    } else {
      diff[offset] = 255;
      diff[offset + 1] = 255;
      diff[offset + 2] = 255;
      diff[offset + 3] = 255;
    }
  }
  const pixelCount = actual.width * actual.height;
  const diffRatio = differingPixels / pixelCount;
  const meanError = totalError / (pixelCount * 4);
  return {
    matches: diffRatio <= visualMaxDiffRatio && meanError <= visualMaxMeanError,
    diffPng: encodeRgbaPng(actual.width, actual.height, diff),
    summary: `${differingPixels}/${pixelCount} pixels (${(diffRatio * 100).toFixed(3)}%), mean channel error ${meanError.toFixed(2)}, max ${maximumError}`,
  };
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
      const fontsReady = !document.fonts || document.fonts.status === "loaded";
      const ready = document.readyState === "complete"
        && heading.length > 0
        && (!expectedHeading || heading === expectedHeading)
        && fontsReady
        && shellReady;
      return {
        ready,
        heading,
        fontsReady,
        shellReady,
        body: document.body.innerText.slice(0, 400),
      };
    })()`);
    if (state.ready) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`${routeCase.name}: page did not finish rendering (${JSON.stringify(state)})`);
}

async function stabilize(client) {
  await evaluate(client, `(() => {
    const style = document.createElement("style");
    style.dataset.visualBaselineStabilizer = "true";
    style.textContent = [
      "*, *::before, *::after { animation: none !important; transition: none !important; caret-color: transparent !important; }",
      "html { scroll-behavior: auto !important; }",
    ].join("\\n");
    document.head.appendChild(style);
    return document.fonts?.ready ?? true;
  })()`);
  await new Promise((resolve) => setTimeout(resolve, 100));
}

async function inspectDialog(client, routeCase, viewport) {
  const dialogCase = routeCase.dialog;
  if (!dialogCase) return;

  const opened = await evaluate(client, `(() => {
    const opener = document.querySelector(${JSON.stringify(dialogCase.openSelector)});
    if (!(opener instanceof HTMLElement)) return false;
    opener.click();
    return true;
  })()`);
  if (!opened) {
    throw new Error(`${routeCase.name} (${viewport.name}): dialog opener missing (${dialogCase.openSelector})`);
  }

  const dialogDeadline = Date.now() + 5_000;
  let dialogState;
  while (Date.now() < dialogDeadline) {
    dialogState = await evaluate(client, `(() => {
      const dialog = document.querySelector('[role="dialog"]');
      const title = dialog?.querySelector('h2')?.textContent?.trim() ?? "";
      return {
        ready: dialog instanceof HTMLElement && title.length > 0,
        title,
      };
    })()`);
    if (dialogState.ready) break;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  if (!dialogState?.ready) {
    throw new Error(`${routeCase.name} (${viewport.name}): project dialog did not open`);
  }

  const initialState = await evaluate(client, `(() => {
    const dialog = document.querySelector('[role="dialog"]');
    const title = dialog?.querySelector('h2')?.textContent?.trim() ?? "";
    const close = dialog?.querySelector('button[aria-label="Close modal"]');
    const submit = dialog?.querySelector(${JSON.stringify(dialogCase.submitSelector)});
    const visible = (element) => {
      if (!(element instanceof HTMLElement)) return false;
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return style.display !== "none" && style.visibility !== "hidden" && Number(style.opacity) > 0
        && rect.width > 0 && rect.height > 0 && rect.right > 0 && rect.left < innerWidth
        && rect.bottom > 0 && rect.top < innerHeight;
    };
    return {
      title,
      closeVisible: visible(close),
      submitExists: submit instanceof HTMLElement,
      submitLabel: submit?.textContent?.trim() ?? "",
    };
  })()`);
  const initialFailures = [];
  if (initialState.title !== dialogCase.title) {
    initialFailures.push(`dialog title "${initialState.title}" instead of "${dialogCase.title}"`);
  }
  if (!initialState.closeVisible) initialFailures.push("dialog close control is not visible");
  if (!initialState.submitExists) initialFailures.push(`missing primary submit action: ${dialogCase.submitSelector}`);
  if (initialState.submitExists && initialState.submitLabel !== dialogCase.submitLabel) {
    initialFailures.push(`submit label "${initialState.submitLabel}" instead of "${dialogCase.submitLabel}"`);
  }
  if (initialFailures.length) {
    throw new Error(`${routeCase.name} (${viewport.name}): ${initialFailures.join("; ")}`);
  }

  await evaluate(client, `(() => {
    const submit = document.querySelector(${JSON.stringify(dialogCase.submitSelector)});
    if (submit instanceof HTMLElement) submit.scrollIntoView({ block: "nearest", inline: "nearest" });
    return true;
  })()`);
  await new Promise((resolve) => setTimeout(resolve, 100));

  const openLayout = await evaluate(client, `(() => {
    const dialog = document.querySelector('[role="dialog"]');
    const submit = dialog?.querySelector(${JSON.stringify(dialogCase.submitSelector)});
    const visible = (element) => {
      if (!(element instanceof HTMLElement)) return false;
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return style.display !== "none" && style.visibility !== "hidden" && Number(style.opacity) > 0
        && rect.width > 0 && rect.height > 0 && rect.right > 0 && rect.left < innerWidth
        && rect.bottom > 0 && rect.top < innerHeight;
    };
    const isIntentionalScrollRegion = (element) => {
      const style = getComputedStyle(element);
      return element.scrollWidth > element.clientWidth + 1
        && ["auto", "scroll"].includes(style.overflowX);
    };
    const isInsideIntentionalScrollRegion = (element) => {
      let parent = element.parentElement;
      while (parent) {
        if (isIntentionalScrollRegion(parent)) return true;
        parent = parent.parentElement;
      }
      return false;
    };
    const overflowingElements = [...document.querySelectorAll("body *")].filter((element) => {
      const rect = element.getBoundingClientRect();
      return rect.right > innerWidth + 1 && !isInsideIntentionalScrollRegion(element);
    });
    const effectiveOverflow = overflowingElements.length
      ? Math.max(...overflowingElements.map((element) => element.getBoundingClientRect().right - innerWidth))
      : 0;
    return {
      submitVisible: visible(submit),
      effectiveOverflow,
      overflowing: overflowingElements
        .map((element) => element.getAttribute("data-testid") || element.id || element.tagName.toLowerCase())
        .slice(0, 8),
    };
  })()`);
  const openFailures = [];
  if (!openLayout.submitVisible) openFailures.push("primary submit action is not visible/reachable in the dialog viewport");
  if (openLayout.effectiveOverflow > 1) {
    openFailures.push(`horizontal overflow of ${openLayout.effectiveOverflow}px while dialog is open${openLayout.overflowing.length ? ` from ${openLayout.overflowing.join(", ")}` : ""}`);
  }
  if (openFailures.length) {
    throw new Error(`${routeCase.name} (${viewport.name}): ${openFailures.join("; ")}`);
  }

  await evaluate(client, `(() => {
    const close = document.querySelector('[role="dialog"] button[aria-label="Close modal"]');
    if (!(close instanceof HTMLElement)) return false;
    close.click();
    return true;
  })()`);
  const closeDeadline = Date.now() + 5_000;
  while (Date.now() < closeDeadline) {
    const closed = await evaluate(client, `document.querySelector('[role="dialog"]') === null`);
    if (closed) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`${routeCase.name} (${viewport.name}): dialog close control did not close the dialog`);
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

  await inspectDialog(client, routeCase, viewport);

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
    const isIntentionalScrollRegion = (element) => {
      const style = getComputedStyle(element);
      return element.scrollWidth > element.clientWidth + 1
        && ["auto", "scroll"].includes(style.overflowX);
    };
    const isInsideIntentionalScrollRegion = (element) => {
      let parent = element.parentElement;
      while (parent) {
        if (isIntentionalScrollRegion(parent)) return true;
        parent = parent.parentElement;
      }
      return false;
    };
    const overflowingElements = [...document.querySelectorAll("body *")].filter((element) => {
      const rect = element.getBoundingClientRect();
      return rect.right > innerWidth + 1 && !isInsideIntentionalScrollRegion(element);
    });
    const effectiveOverflow = overflowingElements.length
      ? Math.max(...overflowingElements.map((element) => element.getBoundingClientRect().right - innerWidth))
      : 0;
    const overflowing = overflowingElements
      .map((element) => element.getAttribute("data-testid") || element.id || element.tagName.toLowerCase())
      .slice(0, 8);
    const actions = ${JSON.stringify(routeCase.actions)}.filter((selector) => !visible(selector));
    const requiredSelectors = ${JSON.stringify(routeCase.requiredSelectors ?? [])}
      .filter((selector) => !document.querySelector(selector));
    const requiredTexts = ${JSON.stringify(routeCase.requiredTexts ?? [])}
      .filter((text) => !document.body.innerText.includes(text));
    const orderedTexts = ${JSON.stringify(routeCase.orderedTexts ?? [])};
    const orderedTextFailures = orderedTexts.filter((text, index) => {
      const current = document.body.innerText.indexOf(text);
      const previous = index === 0 ? -1 : document.body.innerText.indexOf(orderedTexts[index - 1]);
      return current < 0 || (previous >= 0 && current < previous);
    });
    const navigationVisible = ${routeCase.shell}
      ? visible('a[data-testid="link-nav-all-projects"]')
      : true;
    return { rootOverflow, effectiveOverflow, overflowing, actions, requiredSelectors, requiredTexts, orderedTextFailures, navigationVisible };
  })()`);
}

function visualBaselinePath(routeCase, viewport) {
  return `${baselineDir}/${routeCase.id}-${viewport.name}.png`;
}

async function saveVisualFailure(routeCase, viewport, actualPng, comparison, error) {
  await mkdir(diffDir, { recursive: true });
  const prefix = `${diffDir}/${routeCase.id}-${viewport.name}`;
  await writeFile(`${prefix}.actual.png`, actualPng);
  if (comparison?.diffPng) await writeFile(`${prefix}.diff.png`, comparison.diffPng);
  await writeFile(`${prefix}.json`, JSON.stringify({
    route: routeCase.path,
    viewport,
    baseline: visualBaselinePath(routeCase, viewport),
    summary: comparison?.summary ?? error?.message ?? "Visual comparison failed",
    tolerance: {
      channel: visualChannelTolerance,
      maxDiffRatio: visualMaxDiffRatio,
      maxMeanError: visualMaxMeanError,
    },
  }, null, 2));
  return prefix;
}

async function captureAndCompareVisual(client, routeCase, viewport) {
  const screenshot = await client.command("Page.captureScreenshot", {
    format: "png",
    captureBeyondViewport: false,
  });
  const actualPng = Buffer.from(screenshot.data, "base64");
  const baselinePath = visualBaselinePath(routeCase, viewport);
  if (updateBaselines) {
    await mkdir(baselineDir, { recursive: true });
    await writeFile(baselinePath, actualPng);
    console.log(`↻ ${routeCase.name} ${viewport.name} baseline updated`);
    return;
  }

  let expectedPng;
  try {
    expectedPng = await readFile(baselinePath);
  } catch (error) {
    const artifactPrefix = await saveVisualFailure(routeCase, viewport, actualPng, undefined, error);
    throw new Error(`${routeCase.name} (${viewport.name}): missing visual baseline ${baselinePath}; actual screenshot saved to ${artifactPrefix}.actual.png`);
  }

  let comparison;
  try {
    comparison = comparePng(expectedPng, actualPng);
  } catch (error) {
    const artifactPrefix = await saveVisualFailure(routeCase, viewport, actualPng, undefined, error);
    throw new Error(`${routeCase.name} (${viewport.name}): could not compare visual baseline; artifacts saved to ${artifactPrefix}.*`);
  }
  if (!comparison.matches) {
    const artifactPrefix = await saveVisualFailure(routeCase, viewport, actualPng, comparison);
    throw new Error(`${routeCase.name} (${viewport.name}): visual baseline mismatch (${comparison.summary}); artifacts saved to ${artifactPrefix}.*`);
  }
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
    await stabilize(client);
    await waitForRenderedPage(client, routeCase);
    const result = await inspect(client, routeCase, viewport);
    const failures = [];
    if (result.effectiveOverflow > 1) {
      failures.push(`horizontal overflow of ${result.effectiveOverflow}px${result.overflowing.length ? ` from ${result.overflowing.join(", ")}` : ""}`);
    }
    if (!result.navigationVisible) failures.push("primary Projects navigation is not visible");
    if (result.actions.length) failures.push(`missing primary actions: ${result.actions.join(", ")}`);
    if (result.requiredSelectors.length) failures.push(`missing required elements: ${result.requiredSelectors.join(", ")}`);
    if (result.requiredTexts.length) failures.push(`missing required text: ${result.requiredTexts.join(", ")}`);
    if (result.orderedTextFailures.length) failures.push(`incorrect section order: ${result.orderedTextFailures.join(", ")}`);
    if (failures.length) throw new Error(`${routeCase.name} (${viewport.name}): ${failures.join("; ")}`);
    await captureAndCompareVisual(client, routeCase, viewport);
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