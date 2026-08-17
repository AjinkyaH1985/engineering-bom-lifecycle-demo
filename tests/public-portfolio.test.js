const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const root = path.resolve(__dirname, "..");

function storage() {
  const values = {};
  return {
    values,
    get length() { return Object.keys(values).length; },
    key(index) { return Object.keys(values)[index] || null; },
    getItem(key) { return Object.prototype.hasOwnProperty.call(values, key) ? values[key] : null; },
    setItem(key, value) { values[key] = String(value); },
    removeItem(key) { delete values[key]; }
  };
}

function scriptFilesFromIndex() {
  const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
  return Array.from(html.matchAll(/<script\s+src="([^"]+)"/g), (match) => match[1]);
}

function boot() {
  const localStorage = storage();
  const document = {
    addEventListener() {},
    querySelector() { return null; },
    querySelectorAll() { return []; },
    getElementById() { return null; },
    createElement() { return { click() {}, remove() {}, style: {}, setAttribute() {} }; },
    body: { appendChild() {}, classList: { add() {}, remove() {} } }
  };
  const window = {
    DEP: {},
    localStorage,
    document,
    Blob,
    URL,
    TextEncoder,
    Uint8Array,
    ArrayBuffer,
    setTimeout,
    clearTimeout,
    setImmediate,
    addEventListener() {},
    location: { hash: "" },
    history: { pushState() {} }
  };
  const context = { console, window, document, localStorage, Blob, URL, TextEncoder, Uint8Array, ArrayBuffer, setTimeout, clearTimeout, setImmediate, navigator: { userAgent: "portfolio-test" } };
  context.globalThis = context;
  vm.createContext(context);
  scriptFilesFromIndex().forEach((relativePath) => {
    const file = path.join(root, relativePath);
    assert.ok(fs.existsSync(file), `Runtime file is missing: ${relativePath}`);
    vm.runInContext(fs.readFileSync(file, "utf8"), context, { filename: relativePath });
    if (context.JSZip && !window.JSZip) window.JSZip = context.JSZip;
  });
  return { app: window.DEP, localStorage };
}

async function run() {
  const { app, localStorage } = boot();
  app.core.appState.initialise();
  const state = app.core.appState.getState();

  assert.strictEqual(state.metadata.publicEdition, true);
  assert.strictEqual(state.programs.length, 1);
  assert.strictEqual(state.programs[0].programCode, "AX7");
  assert.strictEqual(state.programs[0].customer, "Orion Motors");
  assert.deepStrictEqual(Array.from(state.seatVariants, (variant) => variant.variantCode), ["AX7-60P-E2", "AX7-60P-E3", "AX7-60P-E4"]);
  assert.strictEqual(state.context.activeSeatVariantId, "VAR-AX7-60P-E3");
  assert.strictEqual(state.featureConfigurations.length, 3);
  assert.strictEqual(state.engineeringBoms.length, 6);
  assert.ok(state.engineeringBoms.every((bom) => bom.completionStatus === "COMPLETE"));
  assert.strictEqual(state.engineeringProductStructures.length, 1);
  assert.strictEqual(state.engineeringProductStructures[0].generationStatus, "CURRENT");
  assert.strictEqual(state.commercialAssessments.length, 1);
  assert.strictEqual(state.commercialAssessments[0].generationStatus, "CURRENT");
  assert.strictEqual(app.domain.engineeringProductStructureService.detectEngineeringProductStructureStaleness({
    programId: "PGM-AX7-001",
    seatVariantId: "VAR-AX7-60P-E3"
  }).generationStatus, "CURRENT");
  assert.strictEqual(app.domain.commercialAssessmentService.detectCommercialAssessmentStaleness({
    programId: "PGM-AX7-001",
    seatVariantId: "VAR-AX7-60P-E3"
  }).generationStatus, "CURRENT");
  assert.strictEqual(state.engineeringChanges.length, 2);
  assert.strictEqual(state.revisions.length, 1);
  assert.strictEqual(state.revisions[0].lifecycleStatus, "RELEASED");
  assert.strictEqual(state.revisions[0].revisionNumber, "A");

  const validation = app.core.validationService.validateReferences(state);
  assert.strictEqual(validation.valid, true, JSON.stringify(validation.errors));

  const dashboard = app.domain.dashboardService.getDashboardSummary();
  assert.strictEqual(dashboard.context.seatVariantId, "VAR-AX7-60P-E3");
  assert.strictEqual(dashboard.completedBoms.completed, 6);
  assert.strictEqual(dashboard.completedBoms.required, 6);
  assert.strictEqual(dashboard.releasedRevisions.count, 1);

  const e2 = app.domain.featureConfigurationService.getConfigurationForSeatVariant("VAR-AX7-60P-E2");
  const e3 = app.domain.featureConfigurationService.getConfigurationForSeatVariant("VAR-AX7-60P-E3");
  const e4 = app.domain.featureConfigurationService.getConfigurationForSeatVariant("VAR-AX7-60P-E4");
  assert.ok(e2 && e3 && e4);
  assert.notStrictEqual(e2.id, e3.id);
  assert.notStrictEqual(e3.id, e4.id);

  const mappings = app.domain.commodityMasterService.getMappingsForFinishedGoodVariant("VAR-AX7-60P-E3");
  assert.strictEqual(mappings.length, 6);

  const revisionId = state.revisions[0].id;
  const readiness = app.domain.revisionExcelExportService.getRevisionExportReadiness(revisionId);
  assert.strictEqual(readiness.exportAllowed, true, JSON.stringify(readiness.errors));
  const model = app.domain.revisionExcelExportService.buildRevisionWorkbookModel(revisionId, { exportedAt: "2026-07-01T00:00:00.000Z" });
  assert.ok(model.sheets.some((sheet) => sheet.name === "Feature Matrix"));
  assert.ok(model.sheets.some((sheet) => sheet.name === "Complete Seat JIT"));
  assert.ok(model.sheets.some((sheet) => sheet.name === "Commercial Assessment"));
  const workbook = await app.domain.revisionExcelExportService.generateRevisionWorkbook(revisionId, { exportedAt: "2026-07-01T00:00:00.000Z" });
  assert.ok(workbook.bytes && workbook.bytes.length > 1000);
  assert.match(workbook.fileName, /AX7.*REV-A\.xlsx$/);

  assert.ok(localStorage.getItem("engineeringBomLifecyclePortfolio.public.v2.state"));

  console.log("Public portfolio tests: 33 assertions passed");
}

run().catch((error) => {
  console.error(error && error.stack || error);
  process.exitCode = 1;
});
