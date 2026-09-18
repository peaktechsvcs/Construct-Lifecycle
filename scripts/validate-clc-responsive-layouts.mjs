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
const includeSearchTransitionCase = process.env.CLC_RESPONSIVE_TEST_SEARCH_TRANSITION === "1";
const skipVisualComparison = process.env.CLC_RESPONSIVE_TEST_SKIP_VISUAL === "1";
const requestedCaseIds = (process.env.CLC_RESPONSIVE_TEST_CASES ?? "")
  .split(",")
  .map((id) => id.trim())
  .filter(Boolean);
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
    id: "project-detail-controls-persistence",
    name: "project detail controls persistence",
    path: "/projects/42?browserAuth=authenticated&browserControls=reload&browserControlsReset=1&browserControlsSaveFailure=1",
    heading: "Browser Test Project",
    actions: [],
    projectControlsPersistence: true,
    shell: false,
    skipVisual: true,
  },
  {
    id: "project-detail-controls-validation",
    name: "project detail controls validation",
    path: "/projects/42?browserAuth=authenticated&browserControls=standalone&browserControlsValidationFailure=1",
    heading: "Browser Test Project",
    actions: [],
    projectControlsValidation: true,
    shell: false,
    skipVisual: true,
  },
  {
    id: "contracts-workspace",
    name: "contracts workspace",
    path: "/contracts?browserAuth=authenticated&browserControls=standalone",
    heading: "Contracts",
    actions: [
      'button[data-testid="button-edit-contract-42"]',
      'a[data-testid="link-contract-project-42"]',
    ],
    requiredSelectors: ['[data-testid="contract-approval-status"]'],
    requiredTexts: ["Browser Test Project", "CNT-0042", "Net 30"],
    inlineEditor: {
      openSelector: 'button[data-testid="button-edit-contract-42"]',
      requiredSelector: 'input[data-testid="input-contract-contractNumber"]',
      submitSelector: 'button[data-testid="button-save-contract"]',
      submitLabel: "Save contract",
      feedbackSelector: '[data-testid="contract-save-feedback"]',
      feedbackText: "Contract saved.",
      fieldSelector: 'input[data-testid="input-contract-contractNumber"]',
      fieldValue: "CNT-0042-UPDATED",
    },
    shell: true,
  },
  {
    id: "milestones-workspace",
    name: "milestones workspace",
    path: "/milestones?browserAuth=authenticated&browserControls=standalone&browserControlsReset=1",
    heading: "Milestones",
    actions: [
      'button[data-testid="button-add-milestone-42"]',
      'a[data-testid="link-milestone-project-42"]',
    ],
    requiredSelectors: [
      '[data-testid="milestone-status-4202"]',
      'button[data-testid="button-edit-milestone-4202"]',
    ],
    requiredTexts: ["Browser Test Project", "MS-001", "Site mobilization"],
    inlineEditor: {
      openSelector: 'button[data-testid="button-add-milestone-42"]',
      requiredSelector: 'input[data-testid="input-milestone-itemNumber"]',
      submitSelector: 'button[data-testid="button-save-milestone"]',
      submitLabel: "Add milestone",
      feedbackSelector: '[data-testid="milestone-save-feedback"]',
      feedbackText: "Milestone saved.",
      fields: [
        { selector: 'input[data-testid="input-milestone-itemNumber"]', value: "MS-002" },
        { selector: 'input[data-testid="input-milestone-name"]', value: "Site mobilization updated" },
      ],
    },
    editInlineEditor: {
      openSelector: 'button[data-testid="button-edit-milestone-4202"]',
      requiredSelector: 'input[data-testid="input-milestone-itemNumber"]',
      submitSelector: 'button[data-testid="button-save-milestone"]',
      submitLabel: "Save milestone",
      feedbackSelector: '[data-testid="milestone-save-feedback"]',
      feedbackText: "Milestone saved.",
      fields: [
        { selector: 'input[data-testid="input-milestone-name"]', value: "Site mobilization edited" },
      ],
      reloadAfterSave: true,
    },
    shell: true,
  },
  {
    id: "milestones-save-failure",
    name: "milestone save failure recovery",
    path: "/milestones?browserAuth=authenticated&browserControls=standalone&browserControlsReset=1&browserMilestoneSaveFailure=1",
    heading: "Milestones",
    actions: [
      'button[data-testid="button-add-milestone-42"]',
      'a[data-testid="link-milestone-project-42"]',
    ],
    requiredSelectors: [
      '[data-testid="milestone-status-4202"]',
      'button[data-testid="button-edit-milestone-4202"]',
    ],
    requiredTexts: ["Browser Test Project", "MS-001", "Site mobilization"],
    inlineEditor: {
      openSelector: 'button[data-testid="button-add-milestone-42"]',
      requiredSelector: 'input[data-testid="input-milestone-itemNumber"]',
      submitSelector: 'button[data-testid="button-save-milestone"]',
      submitLabel: "Add milestone",
      feedbackSelector: '[data-testid="milestone-save-feedback"]',
      feedbackText: "Milestone saved.",
      fields: [
        { selector: 'input[data-testid="input-milestone-itemNumber"]', value: "MS-002" },
        { selector: 'input[data-testid="input-milestone-name"]', value: "Site mobilization updated" },
      ],
    },
    editInlineEditor: {
      openSelector: 'button[data-testid="button-edit-milestone-4202"]',
      requiredSelector: 'input[data-testid="input-milestone-itemNumber"]',
      submitSelector: 'button[data-testid="button-save-milestone"]',
      submitLabel: "Save milestone",
      feedbackSelector: '[data-testid="milestone-save-feedback"]',
      feedbackText: "Milestone saved.",
      fields: [
        { selector: 'input[data-testid="input-milestone-name"]', value: "Site mobilization edited after retry" },
      ],
      failureRecovery: {
        errorText: "The milestone could not be saved. Check the fields and try again.",
      },
    },
  },
  {
    id: "milestones-validation-failure",
    name: "milestone validation failure recovery",
    path: "/milestones?browserAuth=authenticated&browserControls=standalone&browserControlsReset=1&browserMilestoneSaveFailure=validation",
    heading: "Milestones",
    actions: [
      'button[data-testid="button-add-milestone-42"]',
      'a[data-testid="link-milestone-project-42"]',
    ],
    requiredSelectors: [
      '[data-testid="milestone-status-4202"]',
      'button[data-testid="button-edit-milestone-4202"]',
    ],
    requiredTexts: ["Browser Test Project", "MS-001", "Site mobilization"],
    inlineEditor: {
      openSelector: 'button[data-testid="button-add-milestone-42"]',
      requiredSelector: 'input[data-testid="input-milestone-itemNumber"]',
      submitSelector: 'button[data-testid="button-save-milestone"]',
      submitLabel: "Add milestone",
      feedbackSelector: '[data-testid="milestone-save-feedback"]',
      feedbackText: "Milestone saved.",
      fields: [
        { selector: 'input[data-testid="input-milestone-itemNumber"]', value: "MS-002" },
        { selector: 'input[data-testid="input-milestone-name"]', value: "Site mobilization updated" },
      ],
    },
    editInlineEditor: {
      openSelector: 'button[data-testid="button-edit-milestone-4202"]',
      requiredSelector: 'input[data-testid="input-milestone-itemNumber"]',
      submitSelector: 'button[data-testid="button-save-milestone"]',
      submitLabel: "Save milestone",
      feedbackSelector: '[data-testid="milestone-save-feedback"]',
      feedbackText: "Milestone saved.",
      fields: [
        { selector: 'input[data-testid="input-milestone-name"]', value: "Site mobilization validation retry" },
      ],
      failureRecovery: {
        errorText: "Milestone details are not valid. Check the milestone number, name, dates, and status.",
      },
    },
  },
  {
    id: "milestones-conflict",
    name: "milestone stale edit conflict recovery",
    path: "/milestones?browserAuth=authenticated&browserControls=standalone&browserControlsReset=1&browserMilestoneSaveFailure=conflict",
    heading: "Milestones",
    actions: [
      'button[data-testid="button-add-milestone-42"]',
      'a[data-testid="link-milestone-project-42"]',
    ],
    requiredSelectors: [
      '[data-testid="milestone-status-4202"]',
      'button[data-testid="button-edit-milestone-4202"]',
    ],
    requiredTexts: ["Browser Test Project", "MS-001", "Site mobilization"],
    editInlineEditor: {
      openSelector: 'button[data-testid="button-edit-milestone-4202"]',
      requiredSelector: 'input[data-testid="input-milestone-itemNumber"]',
      submitSelector: 'button[data-testid="button-save-milestone"]',
      submitLabel: "Save milestone",
      feedbackSelector: '[data-testid="milestone-save-feedback"]',
      feedbackText: "Milestone saved.",
      fields: [
        { selector: 'input[data-testid="input-milestone-name"]', value: "Stale browser edit" },
      ],
      failureRecovery: {
        errorText: "This milestone changed since you opened it. Your edits are still here; reload the milestone before trying again.",
        retry: false,
      },
    },
  },
  {
    id: "procurement-workspace",
    name: "procurement workspace",
    path: "/procurement?browserAuth=authenticated",
    heading: "Supplier operations",
    actions: [
      'button[data-testid="button-new-supplier-quote"]',
      'button[data-testid="button-supplier-tab-quotes"]',
    ],
    requiredSelectors: ['button[data-testid="button-supplier-tab-orders"]'],
    requiredTexts: ["Latest supplier orders", "PO-8202", "Browser Test Customer"],
    supplierQuoteCreation: true,
    procurementNavigation: true,
    shell: true,
    skipVisual: true,
  },
  {
    id: "procurement-api-failure",
    name: "procurement API failure recovery",
    path: "/procurement?browserAuth=authenticated&browserProcurementFailure=orders",
    heading: "Supplier operations",
    actions: [
      'button[data-testid="button-new-supplier-quote"]',
      'button[data-testid="button-supplier-tab-quotes"]',
    ],
    requiredSelectors: ['button[data-testid="button-supplier-tab-orders"]'],
    requiredTexts: ["Latest supplier orders", "PO-8202", "Browser Test Customer"],
    procurementFailureRecovery: { errorTestId: "supplier-orders-error", errorText: "Supplier order queue unavailable", healthyText: "Products in catalog", text: "PO-8202" },
    shell: true,
    skipVisual: true,
  },
  {
    id: "procurement-products-failure",
    name: "procurement products failure recovery",
    path: "/procurement?browserAuth=authenticated&browserProcurementFailure=products",
    heading: "Supplier operations",
    actions: [
      'button[data-testid="button-new-supplier-quote"]',
      'button[data-testid="button-supplier-tab-quotes"]',
    ],
    requiredSelectors: ['button[data-testid="button-supplier-tab-orders"]'],
    requiredTexts: ["Products and materials", "Browser Test Concrete", "Supplier vendors"],
    procurementFailureRecovery: { tab: "catalog", errorTestId: "supplier-products-error", errorText: "Product catalog unavailable", healthyText: "Active vendors", text: "Browser Test Concrete" },
    shell: true,
    skipVisual: true,
  },
  {
    id: "procurement-vendors-failure",
    name: "procurement vendors failure recovery",
    path: "/procurement?browserAuth=authenticated&browserProcurementFailure=vendors",
    heading: "Supplier operations",
    actions: [
      'button[data-testid="button-new-supplier-quote"]',
      'button[data-testid="button-supplier-tab-quotes"]',
    ],
    requiredSelectors: ['button[data-testid="button-supplier-tab-orders"]'],
    requiredTexts: ["Products and materials", "Browser Test Concrete", "Browser Test Supplier"],
    procurementFailureRecovery: { tab: "catalog", errorTestId: "supplier-vendors-error", errorText: "Vendor directory unavailable", healthyText: "Products in catalog", text: "Browser Test Supplier" },
    shell: true,
    skipVisual: true,
  },
  {
    id: "procurement-quotes-failure",
    name: "procurement quotes failure recovery",
    path: "/procurement?browserAuth=authenticated&browserProcurementFailure=quotes",
    heading: "Supplier operations",
    actions: [
      'button[data-testid="button-new-supplier-quote"]',
      'button[data-testid="button-supplier-tab-quotes"]',
    ],
    requiredSelectors: ['button[data-testid="button-supplier-tab-orders"]'],
    requiredTexts: ["Quotes and proposals", "SQ-8101", "Browser Test Customer"],
    procurementFailureRecovery: { tab: "quotes", initialTab: "quotes", errorTestId: "supplier-quotes-error", errorText: "Supplier quote list unavailable", healthyText: "Quote detail", text: "SQ-8101" },
    shell: true,
    skipVisual: true,
  },
  {
    id: "purchase-orders-workspace",
    name: "purchase orders workspace",
    path: "/purchase-orders?browserAuth=authenticated&order=8202",
    heading: "Purchase orders",
    actions: ['button[data-testid="button-open-procurement"]'],
    requiredSelectors: ['[data-testid="row-supplier-order-8202"]'],
    requiredTexts: ["Supplier orders", "PO-8202", "Order detail", "SCHEDULE DELIVERY / PARTIAL FULFILLMENT"],
    shell: true,
    skipVisual: true,
  },
  {
    id: "deliveries-workspace",
    name: "deliveries workspace",
    path: "/deliveries?browserAuth=authenticated&order=8202",
    heading: "Delivery control",
    actions: ['button[data-testid="button-open-procurement"]'],
    requiredSelectors: ['[data-testid="row-supplier-order-8202"]'],
    requiredTexts: ["Delivery schedule", "DEL-8202", "DELIVERY EVIDENCE", "Record delivery"],
    shell: true,
    skipVisual: true,
  },
  {
    id: "deliveries-api-failure",
    name: "deliveries API failure recovery",
    path: "/deliveries?browserAuth=authenticated&order=8202&browserProcurementFailure=deliveries",
    heading: "Delivery control",
    actions: ['button[data-testid="button-open-procurement"]'],
    requiredSelectors: ['[data-testid="row-supplier-order-8202"]'],
    requiredTexts: ["Delivery schedule", "DEL-8202", "DELIVERY EVIDENCE", "Record delivery"],
    procurementFailureRecovery: { text: "DEL-8202" },
    shell: true,
    skipVisual: true,
  },
  {
    id: "receiving-workspace",
    name: "receiving workspace",
    path: "/receiving?browserAuth=authenticated&order=8202",
    heading: "Receiving queue",
    actions: ['button[data-testid="button-open-procurement"]'],
    requiredSelectors: ['[data-testid="row-supplier-order-8202"]'],
    requiredTexts: ["Receiving dispositions", "DEL-8202", "RECEIVING CLOSEOUT", "Save receiving"],
    shell: true,
    skipVisual: true,
  },
  {
    id: "receiving-api-failure",
    name: "receiving API failure recovery",
    path: "/receiving?browserAuth=authenticated&order=8202&browserProcurementFailure=receiving",
    heading: "Receiving queue",
    actions: ['button[data-testid="button-open-procurement"]'],
    requiredSelectors: ['[data-testid="row-supplier-order-8202"]'],
    requiredTexts: ["Receiving dispositions", "DEL-8202", "RECEIVING CLOSEOUT", "Save receiving"],
    procurementFailureRecovery: { text: "DEL-8202" },
    shell: true,
    skipVisual: true,
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
      "No field work projects",
      "Create a project or update a project to the Field Work status.",
      "Field Work projects",
      "Projects currently carrying the Field Work status.",
      "Browser Test Waiting Project",
    ],
    orderedTexts: ["Paused projects", "In Flight projects", "Field Work projects"],
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
      "No field work projects match",
      "Clear the search to view all field work projects.",
    ],
    orderedTexts: ["Paused projects", "In Flight projects", "Field Work projects"],
    shell: true,
  },
  ...(includeSearchTransitionCase ? [{
    id: "active-projects-search-transition",
    name: "active projects search transition",
    path: "/dashboard/drilldown/active-projects?browserAuth=authenticated&browserSearchDelay=1",
    heading: "Active Projects",
    searchTransition: true,
    skipVisual: true,
    actions: [],
    requiredSelectors: [],
    requiredTexts: [],
    orderedTexts: [],
    shell: true,
  }] : []),
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
    this.onceListeners = new Map();
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
      const onceListeners = this.onceListeners.get(message.method) ?? [];
      this.onceListeners.delete(message.method);
      for (const listener of [...listeners, ...onceListeners]) listener(message.params);
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
        const listeners = this.onceListeners.get(method) ?? [];
        this.onceListeners.set(method, listeners.filter((candidate) => candidate !== listener));
        resolve(params);
      };
      const timeout = setTimeout(() => {
        const listeners = this.onceListeners.get(method) ?? [];
        this.onceListeners.set(method, listeners.filter((candidate) => candidate !== listener));
        reject(new Error(`Timed out waiting for ${method}`));
      }, timeoutMs);
      this.onceListeners.set(method, [...(this.onceListeners.get(method) ?? []), listener]);
    });
  }

  on(method, listener) {
    const listeners = this.listeners.get(method) ?? [];
    this.listeners.set(method, [...listeners, listener]);
    return () => {
      const current = this.listeners.get(method) ?? [];
      this.listeners.set(method, current.filter((candidate) => candidate !== listener));
    };
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

async function waitFor(client, description, expression) {
  const deadline = Date.now() + 12_000;
  let state;
  while (Date.now() < deadline) {
    state = await evaluate(client, expression);
    if (state?.ready) return state;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`${description} did not complete (${JSON.stringify(state)})`);
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

async function inspectInlineEditor(client, routeCase, viewport, editorKey = "inlineEditor") {
  const editorCase = routeCase[editorKey];
  if (!editorCase) return;

  const opened = await evaluate(client, `(() => {
    const opener = document.querySelector(${JSON.stringify(editorCase.openSelector)});
    if (!(opener instanceof HTMLElement)) return false;
    opener.click();
    return true;
  })()`);
  if (!opened) {
    throw new Error(`${routeCase.name} (${viewport.name}): inline editor opener missing (${editorCase.openSelector})`);
  }

  await waitFor(
    client,
    `${routeCase.name} inline editor`,
    `(() => ({
      ready: Boolean(document.querySelector(${JSON.stringify(editorCase.requiredSelector)})),
    }))()`,
  );

  await evaluate(client, `(() => {
    const submit = document.querySelector(${JSON.stringify(editorCase.submitSelector)});
    if (submit instanceof HTMLElement) submit.scrollIntoView({ block: "nearest", inline: "nearest" });
    return true;
  })()`);
  await new Promise((resolve) => setTimeout(resolve, 100));

  const initialState = await evaluate(client, `(() => {
    const submit = document.querySelector(${JSON.stringify(editorCase.submitSelector)});
    const visible = (element) => {
      if (!(element instanceof HTMLElement)) return false;
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return style.display !== "none" && style.visibility !== "hidden" && Number(style.opacity) > 0
        && rect.width > 0 && rect.height > 0 && rect.right > 0 && rect.left < innerWidth
        && rect.bottom > 0 && rect.top < innerHeight;
    };
    return {
      submitVisible: visible(submit),
      submitLabel: submit?.textContent?.trim() ?? "",
    };
  })()`);
  if (!initialState.submitVisible) {
    throw new Error(`${routeCase.name} (${viewport.name}): inline editor submit action is not visible`);
  }
  if (initialState.submitLabel !== editorCase.submitLabel) {
    throw new Error(`${routeCase.name} (${viewport.name}): inline editor submit label "${initialState.submitLabel}" instead of "${editorCase.submitLabel}"`);
  }

  const fields = editorCase.fields ?? [{ selector: editorCase.fieldSelector, value: editorCase.fieldValue }];
  const filled = await evaluate(client, `(() => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    if (!setter) return false;
    const fields = ${JSON.stringify(fields)};
    for (const fieldCase of fields) {
      const field = document.querySelector(fieldCase.selector);
      if (!(field instanceof HTMLInputElement)) return false;
      setter.call(field, fieldCase.value);
      field.dispatchEvent(new Event("input", { bubbles: true }));
      field.dispatchEvent(new Event("change", { bubbles: true }));
    }
    return true;
  })()`);
  if (!filled) {
    throw new Error(`${routeCase.name} (${viewport.name}): inline editor field missing`);
  }

  const submitted = await evaluate(client, `(() => {
    const submit = document.querySelector(${JSON.stringify(editorCase.submitSelector)});
    if (!(submit instanceof HTMLElement)) return false;
    submit.click();
    return true;
  })()`);
  if (!submitted) {
    throw new Error(`${routeCase.name} (${viewport.name}): inline editor submit action missing`);
  }

  await waitFor(
    client,
    `${routeCase.name} save feedback`,
    `(() => {
      const feedback = document.querySelector(${JSON.stringify(editorCase.feedbackSelector)});
      return {
        ready: feedback?.textContent?.trim() === ${JSON.stringify(editorCase.failureRecovery?.errorText ?? editorCase.feedbackText)}
          && (${editorCase.failureRecovery ? `feedback?.getAttribute("role") === "alert"` : "true"}),
        text: feedback?.textContent?.trim() ?? "",
      };
    })()`,
  );

  if (editorCase.failureRecovery) {
    await waitFor(
      client,
      `${routeCase.name} preserved milestone values`,
      `(() => {
        const value = (selector) => document.querySelector(selector)?.value ?? null;
        const submit = document.querySelector(${JSON.stringify(editorCase.submitSelector)});
        return {
          ready: value('[data-testid="input-milestone-name"]') === ${JSON.stringify(fields.find((field) => field.selector.includes("input-milestone-name"))?.value ?? "")}
            && submit instanceof HTMLElement
            && !submit.hasAttribute("disabled"),
          name: value('[data-testid="input-milestone-name"]'),
        };
      })()`,
    );

    if (editorCase.failureRecovery.retry === false) return;

    const retried = await evaluate(client, `(() => {
      const submit = document.querySelector(${JSON.stringify(editorCase.submitSelector)});
      if (!(submit instanceof HTMLElement) || submit.hasAttribute("disabled")) return false;
      submit.click();
      return true;
    })()`);
    if (!retried) {
      throw new Error(`${routeCase.name} (${viewport.name}): milestone retry action missing`);
    }

    await waitFor(
      client,
      `${routeCase.name} recovered milestone save`,
      `(() => {
        const feedback = document.querySelector(${JSON.stringify(editorCase.feedbackSelector)});
        return {
          ready: feedback?.textContent?.trim() === ${JSON.stringify(editorCase.feedbackText)}
            && feedback?.getAttribute("role") === "status",
          text: feedback?.textContent?.trim() ?? "",
        };
      })()`,
    );
  }

  if (editorCase.reloadAfterSave) {
    const loaded = client.event("Page.loadEventFired");
    await client.command("Page.reload", { ignoreCache: true });
    await loaded;
    await waitForRenderedPage(client, routeCase);

    const reopened = await evaluate(client, `(() => {
      const opener = document.querySelector(${JSON.stringify(editorCase.openSelector)});
      if (!(opener instanceof HTMLElement)) return false;
      opener.click();
      return true;
    })()`);
    if (!reopened) {
      throw new Error(`${routeCase.name} (${viewport.name}): edited milestone did not reopen after reload`);
    }

    await waitFor(
      client,
      `${routeCase.name} editor after reload`,
      `(() => ({
        ready: Boolean(document.querySelector(${JSON.stringify(editorCase.requiredSelector)})),
      }))()`,
    );

    await waitFor(
      client,
      `${routeCase.name} edited values after reload`,
      `(() => {
        const fields = ${JSON.stringify(fields)};
        return {
          ready: fields.every((fieldCase) => document.querySelector(fieldCase.selector)?.value === fieldCase.value),
          values: fields.map((fieldCase) => ({
            selector: fieldCase.selector,
            value: document.querySelector(fieldCase.selector)?.value ?? null,
          })),
        };
      })()`,
    );

    if (routeCase.shell && viewport.name === "mobile") {
      const menuReopened = await evaluate(client, `(() => {
        const button = document.querySelector('[data-testid="button-open-menu"]');
        if (!(button instanceof HTMLElement)) return false;
        button.click();
        return true;
      })()`);
      if (!menuReopened) {
        throw new Error(`${routeCase.name} (${viewport.name}): mobile navigation did not reopen after reload`);
      }
    }
  }

  await evaluate(client, `window.scrollTo({ top: 0, left: 0, behavior: "auto" })`);
}

async function inspectProjectControlsPersistence(client, routeCase, viewport) {
  if (!routeCase.projectControlsPersistence) return;

  const controlsReady = await waitFor(
    client,
    `${routeCase.name} controls`,
    `(() => ({
      ready: document.querySelector('[data-testid="input-controls-contract-number"]') !== null,
    }))()`,
  );
  if (!controlsReady.ready) throw new Error(`${routeCase.name} (${viewport.name}): project controls did not render`);

  const fillFields = async (fields) => {
    const filled = await evaluate(client, `(() => {
      const fields = ${JSON.stringify(fields)};
      for (const fieldCase of fields) {
        const field = document.querySelector(fieldCase.selector);
        if (!(field instanceof HTMLInputElement) && !(field instanceof HTMLSelectElement)) return false;
        const prototype = field instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
        const setter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;
        if (!setter) return false;
        setter.call(field, fieldCase.value);
        field.dispatchEvent(new Event("input", { bubbles: true }));
        field.dispatchEvent(new Event("change", { bubbles: true }));
      }
      return true;
    })()`);
    if (!filled) throw new Error(`${routeCase.name} (${viewport.name}): project control field missing`);
  };

  const addParticipant = await evaluate(client, `(() => {
    if (document.querySelector('[data-testid="input-controls-participant-0-organization"]')) return true;
    const button = document.querySelector('[data-testid="button-add-controls-participant"]');
    if (!(button instanceof HTMLElement)) return false;
    button.click();
    return true;
  })()`);
  if (!addParticipant) throw new Error(`${routeCase.name} (${viewport.name}): participant control missing`);

  await fillFields([
    { selector: '[data-testid="input-controls-contract-number"]', value: "CNT-0042-RELOAD" },
    { selector: '[data-testid="input-controls-contract-start"]', value: "2026-03-01" },
    { selector: '[data-testid="input-controls-contract-end"]', value: "2026-11-30" },
    { selector: '[data-testid="input-controls-participant-0-organization"]', value: "Reloaded Owner" },
    { selector: '[data-testid="input-controls-participant-0-contact"]', value: "Reload Contact" },
    { selector: '[data-testid="input-controls-participant-0-email"]', value: "reload-owner@example.test" },
    { selector: '[data-testid="input-controls-participant-0-role"]', value: "Owner representative" },
  ]);

  const contractSubmitted = await evaluate(client, `(() => {
    const button = document.querySelector('[data-testid="button-save-controls-contract"]');
    if (!(button instanceof HTMLElement)) return false;
    button.click();
    return true;
  })()`);
  if (!contractSubmitted) throw new Error(`${routeCase.name} (${viewport.name}): contract save control missing`);
  await waitFor(
    client,
    `${routeCase.name} failed contract save`,
    `(() => {
      const value = (selector) => document.querySelector(selector)?.value ?? null;
      const body = document.body.innerText;
      const feedback = document.querySelector('[data-testid="status-controls-feedback"]');
      return {
        ready: feedback?.getAttribute("role") === "alert"
          && feedback.textContent?.includes("still here") === true
          && value('[data-testid="input-controls-contract-number"]') === "CNT-0042-RELOAD"
          && value('[data-testid="input-controls-contract-start"]') === "2026-03-01"
          && value('[data-testid="input-controls-contract-end"]') === "2026-11-30"
          && value('[data-testid="input-controls-participant-0-organization"]') === "Reloaded Owner"
          && value('[data-testid="input-controls-participant-0-contact"]') === "Reload Contact"
          && value('[data-testid="input-controls-participant-0-email"]') === "reload-owner@example.test"
          && value('[data-testid="input-controls-participant-0-role"]') === "Owner representative"
          && !body.includes("Contract saved."),
        feedback: feedback?.textContent?.trim() ?? "",
        values: {
          contractNumber: value('[data-testid="input-controls-contract-number"]'),
          contractStart: value('[data-testid="input-controls-contract-start"]'),
          contractEnd: value('[data-testid="input-controls-contract-end"]'),
          participant: value('[data-testid="input-controls-participant-0-organization"]'),
          contact: value('[data-testid="input-controls-participant-0-contact"]'),
          email: value('[data-testid="input-controls-participant-0-email"]'),
          role: value('[data-testid="input-controls-participant-0-role"]'),
        },
      };
    })()`,
  );

  const contractRetried = await evaluate(client, `(() => {
    const button = document.querySelector('[data-testid="button-save-controls-contract"]');
    if (!(button instanceof HTMLElement) || button.hasAttribute("disabled")) return false;
    button.click();
    return true;
  })()`);
  if (!contractRetried) throw new Error(`${routeCase.name} (${viewport.name}): contract retry control missing`);
  await waitFor(
    client,
    `${routeCase.name} retried contract save`,
    `(() => {
      const value = (selector) => document.querySelector(selector)?.value ?? null;
      const feedback = document.querySelector('[data-testid="status-controls-feedback"]');
      return {
        ready: feedback?.getAttribute("role") === "status"
          && feedback.textContent?.trim() === "Contract saved."
          && document.querySelector('[data-testid="status-controls-feedback"][role="alert"]') === null
          && value('[data-testid="input-controls-contract-number"]') === "CNT-0042-RELOAD"
          && value('[data-testid="input-controls-participant-0-organization"]') === "Reloaded Owner",
        feedback: feedback?.textContent?.trim() ?? "",
      };
    })()`,
  );

  const milestoneOpened = await evaluate(client, `(() => {
    const button = document.querySelector('[data-testid="button-edit-controls-milestone-4202"]');
    if (!(button instanceof HTMLElement)) return false;
    button.click();
    return true;
  })()`);
  if (!milestoneOpened) throw new Error(`${routeCase.name} (${viewport.name}): milestone edit control missing`);
  await waitFor(
    client,
    `${routeCase.name} milestone editor`,
    `(() => ({
      ready: document.querySelector('[data-testid="input-controls-milestone-number"]') !== null,
    }))()`,
  );
  await fillFields([
    { selector: '[data-testid="input-controls-milestone-number"]', value: "MS-RELOAD" },
    { selector: '[data-testid="input-controls-milestone-name"]', value: "Reloaded mobilization" },
    { selector: '[data-testid="input-controls-milestone-planned-start"]', value: "2026-04-01" },
    { selector: '[data-testid="input-controls-milestone-planned-end"]', value: "2026-04-30" },
    { selector: '[data-testid="select-controls-milestone-status"]', value: "complete" },
  ]);

  const milestoneSubmitted = await evaluate(client, `(() => {
    const button = document.querySelector('[data-testid="button-save-controls-milestone"]');
    if (!(button instanceof HTMLElement)) return false;
    button.click();
    return true;
  })()`);
  if (!milestoneSubmitted) throw new Error(`${routeCase.name} (${viewport.name}): milestone save control missing`);
  await waitFor(
    client,
    `${routeCase.name} milestone save`,
    `(() => ({
      ready: document.body.innerText.includes("Control saved.")
        && document.body.innerText.includes("MS-RELOAD")
        && document.body.innerText.includes("Reloaded mobilization"),
    }))()`,
  );

  const loaded = client.event("Page.loadEventFired");
  await client.command("Page.reload", { ignoreCache: true });
  await loaded;
  await waitForRenderedPage(client, routeCase);
  await waitFor(
    client,
    `${routeCase.name} contract values after reload`,
    `(() => {
      const value = (selector) => document.querySelector(selector)?.value ?? null;
      const body = document.body.innerText;
      return {
        ready: value('[data-testid="input-controls-contract-number"]') === "CNT-0042-RELOAD"
          && value('[data-testid="input-controls-contract-start"]') === "2026-03-01"
          && value('[data-testid="input-controls-contract-end"]') === "2026-11-30"
          && value('[data-testid="input-controls-participant-0-organization"]') === "Reloaded Owner"
          && body.includes("MS-RELOAD")
          && body.includes("Reloaded mobilization"),
        values: {
          contractNumber: value('[data-testid="input-controls-contract-number"]'),
          contractStart: value('[data-testid="input-controls-contract-start"]'),
          contractEnd: value('[data-testid="input-controls-contract-end"]'),
          participant: value('[data-testid="input-controls-participant-0-organization"]'),
          hasMilestoneNumber: body.includes("MS-RELOAD"),
          hasMilestoneName: body.includes("Reloaded mobilization"),
        },
      };
    })()`,
  );

  const milestoneOpenedAfterReload = await evaluate(client, `(() => {
    const button = document.querySelector('[data-testid="button-edit-controls-milestone-4202"]');
    if (!(button instanceof HTMLElement)) return false;
    button.click();
    return true;
  })()`);
  if (!milestoneOpenedAfterReload) throw new Error(`${routeCase.name} (${viewport.name}): milestone editor did not reopen after reload`);
  await waitFor(
    client,
    `${routeCase.name} milestone values after reload`,
    `(() => ({
      ready: document.querySelector('[data-testid="input-controls-milestone-number"]')?.value === "MS-RELOAD"
        && document.querySelector('[data-testid="input-controls-milestone-name"]')?.value === "Reloaded mobilization"
        && document.querySelector('[data-testid="input-controls-milestone-planned-start"]')?.value === "2026-04-01"
        && document.querySelector('[data-testid="input-controls-milestone-planned-end"]')?.value === "2026-04-30"
        && document.querySelector('[data-testid="select-controls-milestone-status"]')?.value === "complete",
    }))()`,
  );
}

async function inspectProjectControlsValidation(client, routeCase, viewport) {
  if (!routeCase.projectControlsValidation) return;

  await waitFor(
    client,
    `${routeCase.name} controls`,
    `(() => ({
      ready: document.querySelector('[data-testid="input-controls-contract-number"]') !== null,
    }))()`,
  );

  const participantAdded = await evaluate(client, `(() => {
    const button = document.querySelector('[data-testid="button-add-controls-participant"]');
    if (!(button instanceof HTMLElement)) return false;
    button.click();
    return true;
  })()`);
  if (!participantAdded) throw new Error(`${routeCase.name} (${viewport.name}): participant control missing`);

  const setInput = async (selector, value) => {
    const changed = await evaluate(client, `(() => {
      const field = document.querySelector(${JSON.stringify(selector)});
      if (!(field instanceof HTMLInputElement)) return false;
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      if (!setter) return false;
      setter.call(field, ${JSON.stringify(value)});
      field.dispatchEvent(new Event("input", { bubbles: true }));
      field.dispatchEvent(new Event("change", { bubbles: true }));
      return true;
    })()`);
    if (!changed) throw new Error(`${routeCase.name} (${viewport.name}): validation field missing`);
  };

  await setInput('[data-testid="input-controls-participant-0-organization"]', 'Validation Owner');
  await setInput('[data-testid="input-controls-document-url"]', 'javascript:invalid');
  await setInput('[data-testid="input-controls-participant-0-email"]', 'not-an-email');

  const submitted = await evaluate(client, `(() => {
    const button = document.querySelector('[data-testid="button-save-controls-contract"]');
    if (!(button instanceof HTMLElement)) return false;
    button.click();
    return true;
  })()`);
  if (!submitted) throw new Error(`${routeCase.name} (${viewport.name}): contract validation submit control missing`);

  await waitFor(
    client,
    `${routeCase.name} field validation`,
    `(() => {
      const value = (selector) => document.querySelector(selector)?.value ?? null;
      const feedback = document.querySelector('[data-testid="status-controls-feedback"]');
      return {
        ready: feedback?.getAttribute("role") === "alert"
          && feedback.textContent?.trim() === "Fix the highlighted contract details and try again."
          && document.querySelector('[data-testid="input-controls-document-url-error"]')?.textContent?.includes("HTTP or HTTPS") === true
          && document.querySelector('[data-testid="input-controls-participant-0-email-error"]')?.textContent?.includes("valid email") === true
          && value('[data-testid="input-controls-document-url"]') === "javascript:invalid"
          && value('[data-testid="input-controls-participant-0-email"]') === "not-an-email"
          && !document.body.innerText.includes("Contract saved."),
        feedback: feedback?.textContent?.trim() ?? "",
        documentUrl: value('[data-testid="input-controls-document-url"]'),
        participantEmail: value('[data-testid="input-controls-participant-0-email"]'),
      };
    })()`,
  );

  await setInput('[data-testid="input-controls-document-url"]', 'https://example.test/contracts/42');
  await setInput('[data-testid="input-controls-participant-0-email"]', 'owner@example.test');

  const retried = await evaluate(client, `(() => {
    const button = document.querySelector('[data-testid="button-save-controls-contract"]');
    if (!(button instanceof HTMLElement) || button.hasAttribute("disabled")) return false;
    button.click();
    return true;
  })()`);
  if (!retried) throw new Error(`${routeCase.name} (${viewport.name}): corrected contract save control missing`);

  await waitFor(
    client,
    `${routeCase.name} corrected contract save`,
    `(() => {
      const feedback = document.querySelector('[data-testid="status-controls-feedback"]');
      return {
        ready: feedback?.getAttribute("role") === "status"
          && feedback.textContent?.trim() === "Contract saved."
          && document.querySelector('[data-testid="status-controls-feedback"][role="alert"]') === null
          && document.querySelector('[data-testid="input-controls-document-url-error"]') === null
          && document.querySelector('[data-testid="input-controls-participant-0-email-error"]') === null
          && document.querySelector('[data-testid="input-controls-document-url"]')?.value === "https://example.test/contracts/42"
          && document.querySelector('[data-testid="input-controls-participant-0-email"]')?.value === "owner@example.test",
        feedback: feedback?.textContent?.trim() ?? "",
      };
    })()`,
  );
}

async function inspectSearchTransition(client, routeCase, viewport) {
  if (!routeCase.searchTransition) return;

  const changed = await evaluate(client, `(() => {
    const input = document.querySelector('[data-testid="input-drilldown-search"]');
    if (!(input instanceof HTMLInputElement)) return false;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    if (!setter) return false;
    setter.call(input, "does-not-match");
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
    return true;
  })()`);
  if (!changed) {
    throw new Error(`${routeCase.name} (${viewport.name}): search input missing`);
  }

  const pending = await evaluate(client, `(() => ({
    status: document.querySelector('[data-testid="drilldown-search-status"]')?.textContent?.trim() ?? "",
    hasStaleFilteredGuidance: document.body.innerText.includes("No paused projects match"),
    urlSearch: new URLSearchParams(window.location.search).get("search"),
  }))()`);
  if (pending.status !== "Updating Active Projects results…") {
    throw new Error(`${routeCase.name} (${viewport.name}): missing accessible pending-search status`);
  }
  if (pending.hasStaleFilteredGuidance) {
    throw new Error(`${routeCase.name} (${viewport.name}): stale filtered guidance remained during debounce`);
  }
  if (pending.urlSearch !== "does-not-match") {
    throw new Error(`${routeCase.name} (${viewport.name}): URL did not reflect the latest search term`);
  }

  const settled = await waitFor(
    client,
    `${routeCase.name} final response`,
    `(() => {
      const text = document.body.innerText;
      const searches = window.__clcBrowserTestDrilldownSearches ?? [];
      return {
        ready: text.includes("No paused projects match")
          && searches.at(-1) === "does-not-match"
          && !document.querySelector('[data-testid="drilldown-search-status"]'),
        searches,
      };
    })()`,
  );
  if (settled.searches.at(-1) !== "does-not-match") {
    throw new Error(`${routeCase.name} (${viewport.name}): API did not receive the latest search term`);
  }
}

async function inspectProcurementNavigation(client, routeCase, viewport) {
  if (!routeCase.procurementNavigation) return;

  const resetLoaded = client.event("Page.loadEventFired");
  await client.command("Page.navigate", { url: `${baseUrl}/procurement?tab=overview&browserAuth=authenticated` });
  await resetLoaded;
  await waitForRenderedPage(client, routeCase);
  await waitFor(
    client,
    `${routeCase.name} navigation reset`,
    `(() => ({ ready: document.body.innerText.includes("Latest supplier orders") }))()`,
  );

  const quotesTab = await evaluate(client, `(() => {
    const button = document.querySelector('[data-testid="button-supplier-tab-quotes"]');
    if (!(button instanceof HTMLElement)) return false;
    button.click();
    return true;
  })()`);
  if (!quotesTab) throw new Error(`${routeCase.name} (${viewport.name}): quotes tab missing`);

  await waitFor(
    client,
    `${routeCase.name} quote queue`,
    `(() => ({
      ready: document.querySelector('[data-testid="row-supplier-quote-8101"]') !== null
        && document.body.innerText.includes("SQ-8101"),
    }))()`,
  );

  const quoteSelected = await evaluate(client, `(() => {
    const row = document.querySelector('[data-testid="row-supplier-quote-8101"]');
    if (!(row instanceof HTMLElement)) return false;
    row.click();
    return true;
  })()`);
  if (!quoteSelected) throw new Error(`${routeCase.name} (${viewport.name}): quote row missing`);

  await waitFor(
    client,
    `${routeCase.name} quote detail`,
    `(() => ({
      ready: document.body.innerText.includes("Convert to purchase order")
        && document.body.innerText.includes("Browser Test Customer"),
    }))()`,
  );

  const goBack = async (label, ready) => {
    const navigated = await evaluate(client, `(() => {
      window.history.back();
      return true;
    })()`);
    if (!navigated) throw new Error(`${routeCase.name} (${viewport.name}): could not navigate back from ${label}`);
    await waitFor(client, `${routeCase.name} ${label} after back`, ready);
  };

  const goForward = async (label, ready) => {
    const navigated = await evaluate(client, `(() => {
      window.history.forward();
      return true;
    })()`);
    if (!navigated) throw new Error(`${routeCase.name} (${viewport.name}): could not navigate forward to ${label}`);
    await waitFor(client, `${routeCase.name} ${label} after forward`, ready);
  };

  await goBack(
    "quote queue",
    `(() => ({
      ready: window.location.pathname === "/procurement"
        && new URLSearchParams(window.location.search).get("tab") === "quotes"
        && !new URLSearchParams(window.location.search).get("quote")
        && document.querySelector('[data-testid="row-supplier-quote-8101"]') !== null,
    }))()`,
  );
  await goForward(
    "selected quote",
    `(() => ({
      ready: window.location.pathname === "/procurement"
        && new URLSearchParams(window.location.search).get("tab") === "quotes"
        && new URLSearchParams(window.location.search).get("quote") === "8101"
        && document.body.innerText.includes("SQ-8101")
        && document.body.innerText.includes("Browser Test Customer"),
    }))()`,
  );

  const staleQuoteLoaded = client.event("Page.loadEventFired");
  await client.command("Page.navigate", { url: `${baseUrl}/procurement?tab=quotes&quote=999999&browserAuth=authenticated` });
  await staleQuoteLoaded;
  await waitForRenderedPage(client, { name: routeCase.name, heading: "Supplier operations", shell: true });
  await waitFor(
    client,
    `${routeCase.name} stale quote link`,
    `(() => {
      const params = new URLSearchParams(window.location.search);
      const unavailable = document.querySelector('[data-testid="supplier-quote-unavailable"]');
      return {
        ready: window.location.pathname === "/procurement"
          && params.get("tab") === "quotes"
          && params.get("quote") === "999999"
          && unavailable?.textContent?.includes("Quote unavailable") === true,
      };
    })()`,
  );

  const selectedQuoteRestored = client.event("Page.loadEventFired");
  await client.command("Page.navigate", { url: `${baseUrl}/procurement?tab=quotes&quote=8101&browserAuth=authenticated` });
  await selectedQuoteRestored;
  await waitForRenderedPage(client, { name: routeCase.name, heading: "Supplier operations", shell: true });
  await waitFor(
    client,
    `${routeCase.name} selected quote restored`,
    `(() => ({
      ready: document.body.innerText.includes("Convert to purchase order")
        && new URLSearchParams(window.location.search).get("quote") === "8101",
    }))()`,
  );

  const converted = await evaluate(client, `(() => {
    const button = [...document.querySelectorAll("button")]
      .find((candidate) => candidate.textContent?.includes("Convert to purchase order"));
    if (!(button instanceof HTMLElement)) return false;
    button.click();
    return true;
  })()`);
  if (!converted) throw new Error(`${routeCase.name} (${viewport.name}): quote conversion action missing`);

  await waitFor(
    client,
    `${routeCase.name} converted order`,
    `(() => ({
      ready: window.location.pathname === "/procurement"
        && new URLSearchParams(window.location.search).get("order") === "8202"
        && document.body.innerText.includes("PO-8202")
        && document.body.innerText.toLowerCase().includes("schedule delivery / partial fulfillment"),
    }))()`,
  );

  await goBack(
    "selected quote after conversion",
    `(() => ({
      ready: window.location.pathname === "/procurement"
        && new URLSearchParams(window.location.search).get("tab") === "quotes"
        && new URLSearchParams(window.location.search).get("quote") === "8101"
        && document.body.innerText.includes("SQ-8101")
        && document.body.innerText.includes("Browser Test Customer"),
    }))()`,
  );
  await goForward(
    "converted order",
    `(() => ({
      ready: window.location.pathname === "/procurement"
        && new URLSearchParams(window.location.search).get("order") === "8202"
        && document.body.innerText.includes("PO-8202"),
    }))()`,
  );

  const navigate = async (path, heading, requiredText) => {
    const loaded = client.event("Page.loadEventFired");
    await client.command("Page.navigate", { url: `${baseUrl}${path}` });
    await loaded;
    await waitForRenderedPage(client, { path, heading });
    await waitFor(
      client,
      `${routeCase.name} ${heading}`,
      `(() => ({
        ready: document.querySelector("h1")?.textContent?.trim() === ${JSON.stringify(heading)}
          && document.body.innerText.toLowerCase().includes(${JSON.stringify(requiredText.toLowerCase())})
          && document.body.innerText.includes("DEL-8202"),
      }))()`,
    );
  };

  await navigate("/deliveries?browserAuth=authenticated", "Delivery control", "Delivery evidence");
  await goBack(
    "converted order after automatic queue selection",
    `(() => ({
      ready: window.location.pathname === "/procurement"
        && new URLSearchParams(window.location.search).get("order") === "8202"
        && document.body.innerText.includes("PO-8202"),
    }))()`,
  );
  await goForward(
    "delivery queue after automatic queue selection",
    `(() => ({
      ready: window.location.pathname === "/deliveries"
        && new URLSearchParams(window.location.search).get("order") === "8202"
        && document.body.innerText.includes("DEL-8202"),
    }))()`,
  );

  const staleOrderLoaded = client.event("Page.loadEventFired");
  await client.command("Page.navigate", { url: `${baseUrl}/deliveries?browserAuth=authenticated&order=999999` });
  await staleOrderLoaded;
  await waitForRenderedPage(client, { name: routeCase.name, heading: "Delivery control", shell: true });
  await waitFor(
    client,
    `${routeCase.name} stale delivery link`,
    `(() => {
      const params = new URLSearchParams(window.location.search);
      const unavailable = document.querySelector('[data-testid="supplier-order-unavailable"]');
      return {
        ready: window.location.pathname === "/deliveries"
          && params.get("order") === "999999"
          && unavailable?.textContent?.includes("Order unavailable in this queue") === true
          && !unavailable?.textContent?.includes("PO-8202"),
      };
    })()`,
  );

  const explicitOrderChoice = await evaluate(client, `(() => {
    const row = document.querySelector('[data-testid="row-supplier-order-8202"]');
    if (!(row instanceof HTMLElement)) return false;
    row.click();
    return true;
  })()`);
  if (!explicitOrderChoice) throw new Error(`${routeCase.name} (${viewport.name}): stale delivery link did not leave an order choice`);
  await waitFor(
    client,
    `${routeCase.name} explicit order choice`,
    `(() => {
      const params = new URLSearchParams(window.location.search);
      const body = document.body.innerText;
      return {
        ready: window.location.pathname === "/deliveries"
          && params.get("order") === "8202"
          && body.includes("DEL-8202"),
        url: window.location.href,
        hasUnavailableState: document.querySelector('[data-testid="supplier-order-unavailable"]') !== null,
        hasDeliveryDetail: body.includes("DEL-8202"),
      };
    })()`,
  );

  await navigate("/receiving?browserAuth=authenticated&order=8202", "Receiving queue", "Receiving closeout");
  const returnLoaded = client.event("Page.loadEventFired");
  await client.command("Page.navigate", { url: `${baseUrl}/procurement?tab=overview&browserAuth=authenticated` });
  await returnLoaded;
  const reloaded = client.event("Page.loadEventFired");
  await client.command("Page.reload", { ignoreCache: true });
  await reloaded;
  await waitForRenderedPage(client, { name: routeCase.name, heading: "Supplier operations", shell: true });
  if (viewport.name === "mobile") {
    const menuOpened = await evaluate(client, `(() => {
      const button = document.querySelector('[data-testid="button-open-menu"]');
      if (!(button instanceof HTMLElement)) return false;
      button.click();
      return true;
    })()`);
    if (!menuOpened) throw new Error(`${routeCase.name} (${viewport.name}): mobile menu button missing after navigation flow`);
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  await waitFor(
    client,
    `${routeCase.name} procurement overview`,
    `(() => ({
      ready: document.body.innerText.includes("Latest supplier orders"),
    }))()`,
  );
}

async function inspectSupplierQuoteCreation(client, routeCase, viewport) {
  if (!routeCase.supplierQuoteCreation) return;

  const newQuote = await evaluate(client, `(() => {
    const button = document.querySelector('[data-testid="button-new-supplier-quote"]');
    if (!(button instanceof HTMLElement)) return false;
    button.click();
    return true;
  })()`);
  if (!newQuote) throw new Error(`${routeCase.name} (${viewport.name}): quote creation action missing`);

  const editor = await waitFor(
    client,
    `${routeCase.name} quote editor`,
    `(() => ({
      ready: document.querySelector('[data-testid="select-supplier-quote-customer"]') !== null,
      tab: new URLSearchParams(window.location.search).get("tab"),
    }))()`,
  );
  if (editor.tab !== "quotes") throw new Error(`${routeCase.name} (${viewport.name}): new quote action did not open the quotes tab`);

  const filled = await evaluate(client, `(() => {
    const fields = [
      { selector: '[data-testid="select-supplier-quote-customer"]', value: "42" },
      { selector: '[data-testid="input-supplier-quote-description"]', value: "Updated browser quote line" },
      { selector: '[data-testid="input-supplier-quote-quantity"]', value: "7" },
      { selector: '[data-testid="input-supplier-quote-promised-date"]', value: "2026-11-20" },
      { selector: '[data-testid="input-supplier-quote-unit-cost"]', value: "125" },
      { selector: '[data-testid="input-supplier-quote-unit-price"]', value: "225" },
    ];
    for (const fieldCase of fields) {
      const field = document.querySelector(fieldCase.selector);
      if (!(field instanceof HTMLInputElement) && !(field instanceof HTMLSelectElement)) return false;
      const prototype = field instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;
      if (!setter) return false;
      setter.call(field, fieldCase.value);
      field.dispatchEvent(new Event("input", { bubbles: true }));
      field.dispatchEvent(new Event("change", { bubbles: true }));
    }
    return true;
  })()`);
  if (!filled) throw new Error(`${routeCase.name} (${viewport.name}): quote editor field missing`);

  const submitted = await evaluate(client, `(() => {
    const button = document.querySelector('[data-testid="button-create-supplier-quote"]');
    if (!(button instanceof HTMLElement)) return false;
    button.click();
    return true;
  })()`);
  if (!submitted) throw new Error(`${routeCase.name} (${viewport.name}): quote editor submit action missing`);

  await waitFor(
    client,
    `${routeCase.name} created quote detail`,
    `(() => {
      const text = document.body.innerText;
      const normalizedText = text.toLowerCase();
      return {
        ready: new URLSearchParams(window.location.search).get("quote") === "8301"
          && normalizedText.includes("sq-8301")
          && normalizedText.includes("updated browser quote line")
          && normalizedText.includes("browser test supplier")
          && normalizedText.includes("browser alternate supplier")
          && normalizedText.includes("browser test fasteners")
          && normalizedText.includes("7 each")
          && normalizedText.includes("3 box")
          && text.includes("$1,815")
          && text.includes("$1,025")
          && text.includes("$790")
          && normalizedText.includes("nov 20"),
      };
    })()`,
  );

  const editStarted = await evaluate(client, `(() => {
    const button = document.querySelector('[data-testid="button-edit-supplier-quote"]');
    if (!(button instanceof HTMLElement)) return false;
    button.click();
    return true;
  })()`);
  if (!editStarted) throw new Error(`${routeCase.name} (${viewport.name}): quote edit action missing`);

  await waitFor(
    client,
    `${routeCase.name} quote line editor`,
    `(() => ({
      ready: document.querySelector('[data-testid="input-supplier-quote-edit-0-quantity"]') !== null,
    }))()`,
  );

  const editFilled = await evaluate(client, `(() => {
    const fields = [
      { selector: '[data-testid="input-supplier-quote-edit-0-quantity"]', value: "9" },
      { selector: '[data-testid="input-supplier-quote-edit-0-promised-date"]', value: "2026-12-01" },
      { selector: '[data-testid="input-supplier-quote-edit-0-unit-cost"]', value: "140" },
      { selector: '[data-testid="input-supplier-quote-edit-0-unit-price"]', value: "260" },
    ];
    for (const fieldCase of fields) {
      const field = document.querySelector(fieldCase.selector);
      if (!(field instanceof HTMLInputElement)) return false;
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      if (!setter) return false;
      setter.call(field, fieldCase.value);
      field.dispatchEvent(new Event("input", { bubbles: true }));
      field.dispatchEvent(new Event("change", { bubbles: true }));
    }
    return true;
  })()`);
  if (!editFilled) throw new Error(`${routeCase.name} (${viewport.name}): quote edit field missing`);

  const editSubmitted = await evaluate(client, `(() => {
    const button = document.querySelector('[data-testid="button-save-supplier-quote"]');
    if (!(button instanceof HTMLElement)) return false;
    button.click();
    return true;
  })()`);
  if (!editSubmitted) throw new Error(`${routeCase.name} (${viewport.name}): quote edit submit action missing`);

  await waitFor(
    client,
    `${routeCase.name} updated quote detail`,
    `(() => {
      const text = document.body.innerText;
      const normalizedText = text.toLowerCase();
      return {
        ready: normalizedText.includes("updated browser quote line")
          && normalizedText.includes("9 each")
          && normalizedText.includes("browser alternate supplier")
          && normalizedText.includes("browser test fasteners")
          && normalizedText.includes("3 box")
          && text.includes("$2,580")
          && text.includes("$1,410")
          && text.includes("$1,170")
          && normalizedText.includes("dec 1"),
      };
    })()`,
  );
}

async function inspectProcurementFailureRecovery(client, routeCase, viewport) {
  if (!routeCase.procurementFailureRecovery) return;
  const recovery = routeCase.procurementFailureRecovery;

  if (recovery.initialTab) {
    const selectedTab = await evaluate(client, `(() => {
      const button = document.querySelector('[data-testid="button-supplier-tab-${recovery.initialTab}"]');
      if (!(button instanceof HTMLElement)) return false;
      button.click();
      return true;
    })()`);
    if (!selectedTab) throw new Error(`${routeCase.name} (${viewport.name}): failed to open ${recovery.initialTab} for targeted error recovery`);
  }

  await waitFor(
    client,
    `${routeCase.name} error state`,
    `(() => ({
      ready: document.querySelector('[data-testid="${recovery.errorTestId}"]') !== null
        && document.body.innerText.includes(${JSON.stringify(recovery.errorText)})
        && document.body.innerText.includes(${JSON.stringify(recovery.healthyText)})
        && [...document.querySelectorAll('[data-testid="${recovery.errorTestId}"] button')].some((button) => button.textContent?.trim() === "Retry"),
    }))()`,
  );

    if (editorCase.failureRecovery.retry === false) return;

  const retried = await evaluate(client, `(() => {
    const button = document.querySelector('[data-testid="${recovery.errorTestId}"] button');
    if (!(button instanceof HTMLElement)) return false;
    button.click();
    return true;
  })()`);
  if (!retried) throw new Error(`${routeCase.name} (${viewport.name}): retry action missing`);

  await waitFor(
    client,
    `${routeCase.name} cleared error`,
    `(() => ({
      ready: document.querySelector('[data-testid="${recovery.errorTestId}"]') === null
    }))()`,
  );

  if (recovery.tab) {
    const selectedTab = await evaluate(client, `(() => {
      const button = document.querySelector('[data-testid="button-supplier-tab-${recovery.tab}"]');
      if (!(button instanceof HTMLElement)) return false;
      button.click();
      return true;
    })()`);
    if (!selectedTab) throw new Error(`${routeCase.name} (${viewport.name}): recovered ${recovery.tab} tab missing`);
  }

  await waitFor(
    client,
    `${routeCase.name} recovered queue`,
    `(() => ({
      ready: document.body.innerText.toLowerCase().includes(${JSON.stringify(recovery.text.toLowerCase())}),
    }))()`,
  );
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
  await inspectProjectControlsPersistence(client, routeCase, viewport);
  await inspectProjectControlsValidation(client, routeCase, viewport);
  await inspectInlineEditor(client, routeCase, viewport);
  await inspectInlineEditor(client, routeCase, viewport, "editInlineEditor");
  await inspectSearchTransition(client, routeCase, viewport);
  await inspectSupplierQuoteCreation(client, routeCase, viewport);
  await inspectProcurementFailureRecovery(client, routeCase, viewport);
  await inspectProcurementNavigation(client, routeCase, viewport);

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
      .filter((text) => !document.body.innerText.toLowerCase().includes(text.toLowerCase()));
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

function describeBrowserError(kind, params) {
  if (kind === "runtime exception") {
    return params.exceptionDetails?.exception?.description
      ?? params.exceptionDetails?.text
      ?? "Unhandled browser exception";
  }
  if (kind === "console error") {
    return params.args?.map((argument) => argument.value ?? argument.description ?? "").join(" ")
      || "console.error";
  }
  return params.entry?.text ?? "Browser log error";
}

async function visit(routeCase, viewport) {
  const targetResponse = await fetch(
    `http://127.0.0.1:${debuggingPort}/json/new?${encodeURIComponent(`${baseUrl}${routeCase.path}`)}`,
    { method: "PUT" },
  );
  if (!targetResponse.ok) throw new Error(`Could not create Chromium target: ${targetResponse.status}`);
  const target = await targetResponse.json();
  const client = await CdpClient.connect(target.webSocketDebuggerUrl);
  const browserErrors = [];
  const removeExceptionListener = client.on("Runtime.exceptionThrown", (params) => {
    browserErrors.push(`runtime exception: ${describeBrowserError("runtime exception", params)}`);
  });
  const removeConsoleListener = client.on("Runtime.consoleAPICalled", (params) => {
    if (params.type === "error") {
      browserErrors.push(`console error: ${describeBrowserError("console error", params)}`);
    }
  });
  const removeLogListener = client.on("Log.entryAdded", (params) => {
    if (params.entry?.level === "error") {
      const message = describeBrowserError("browser log", params);
      if (!message.includes("Page entered Back-Forward Cache.")) {
        browserErrors.push(`browser log: ${message}`);
      }
    }
  });
  try {
    await Promise.all([
      client.command("Page.enable"),
      client.command("Runtime.enable"),
      client.command("Log.enable"),
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
    await new Promise((resolve) => setTimeout(resolve, 50));
    if (browserErrors.length) {
      throw new Error(`${routeCase.name} (${viewport.name}): unexpected browser errors: ${[...new Set(browserErrors)].join(" | ")}`);
    }
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
    if (!routeCase.skipVisual && !skipVisualComparison) await captureAndCompareVisual(client, routeCase, viewport);
    console.log(`✔ ${routeCase.name} at ${viewport.width}×${viewport.height}`);
  } finally {
    removeExceptionListener();
    removeConsoleListener();
    removeLogListener();
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
  const selectedCases = requestedCaseIds.length
    ? cases.filter((routeCase) => requestedCaseIds.includes(routeCase.id))
    : cases;
  for (const routeCase of selectedCases) {
    for (const viewport of viewports) await visit(routeCase, viewport);
  }
  console.log(`Validated ${selectedCases.length} representative views at mobile and desktop widths.`);
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