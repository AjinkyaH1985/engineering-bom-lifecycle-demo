(function (app) {
  var session = emptySession();

  app.router.register("import-bom", {
    render: function () {
      return renderWorkspace();
    },
    afterRender: function (container) {
      bindControls(container);
    }
  });

  function emptySession() {
    return {
      stage: "SELECT",
      file: null,
      model: null,
      selectedSheet: "",
      summary: null,
      busy: false,
      message: ""
    };
  }

  function renderWorkspace() {
    var status = session.busy ? "Reading Workbook" : statusLabel();
    return [
      app.utils.renderWorkspaceHeader({
        title: "Import BOM",
        purpose: "",
        showContext: false,
        status: status
      }),
      '<div class="workspace-body import-workspace">',
      '<section class="import-shell">',
      renderSteps(),
      renderActions(),
      session.message ? '<div class="import-message" role="status">' + app.utils.escapeHtml(session.message) + '</div>' : "",
      session.file ? renderDetection() : renderSelectState(),
      session.stage === "VALIDATED" ? renderValidationAndPreview() : "",
      session.summary ? renderSummary() : "",
      renderHistory(),
      '</section>',
      '</div>'
    ].join("");
  }

  function renderSteps() {
    var stages = ["SELECT", "DETECTED", "VALIDATED", "IMPORTED"];
    var current = session.stage === "EXISTING" ? 3 : (session.busy ? Math.max(0, stages.indexOf(session.stage)) : stages.indexOf(session.stage));
    var labels = ["Select File", "Detect Workbook", "Validate & Preview", "Import & Summary"];
    return '<ol class="import-steps">' + labels.map(function (label, index) {
      return '<li class="' + (index < current ? "complete" : index === current ? "active" : "") + '"><span>' + (index + 1) + '</span>' + label + '</li>';
    }).join("") + '</ol>';
  }

  function renderActions() {
    if (session.stage === "EXISTING") {
      var repair = app.domain.bomImportService.needsPartImageRepair(session.summary)
        ? '<button type="button" class="primary" data-import-action="repair-images">Correct Part Images</button>'
        : '';
      return '<div class="import-actions">' + repair + '<button type="button" class="' + (repair ? '' : 'primary') + '" data-import-action="open">Open Existing Import</button><button type="button" data-import-action="cancel">Cancel</button></div>';
    }
    return [
      '<div class="import-actions">',
      '<input type="file" data-import-file accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" hidden>',
      '<button type="button" class="' + (!session.file ? "primary" : "") + '" data-import-action="select"' + (session.busy ? " disabled" : "") + '>Select Workbook</button>',
      session.stage === "DETECTED" ? '<button type="button" class="primary" data-import-action="validate">Validate Workbook</button>' : "",
      session.stage === "VALIDATED" && session.model && session.model.valid ? '<button type="button" class="primary" data-import-action="import">Import Workbook</button>' : "",
      session.file && session.stage !== "IMPORTED" ? '<button type="button" data-import-action="cancel">Cancel Import</button>' : "",
      session.summary ? '<button type="button" class="primary" data-import-action="open">Open Imported Programme</button>' : "",
      '</div>'
    ].join("");
  }

  function renderSelectState() {
    return '<div class="empty-state import-empty"><strong>Select a supported source Excel workbook.</strong><span>Engineering BOM and BOM Cost workbooks using the mapped source sheets and headers are recognised.</span></div>';
  }

  function renderDetection() {
    var model = session.model;
    if (!model) return '<div class="empty-state"><strong>Reading workbook...</strong></div>';
    return [
      '<section class="import-section">',
      '<div class="import-section-heading"><strong>Detected Workbook</strong><span>' + app.utils.escapeHtml(session.file.name) + '</span></div>',
      '<div class="import-detection-grid">',
      metric("Workbook Type", model.supported ? model.workbookLabel : "Unsupported workbook format"),
      metric("Seat Type", model.seatType || "Not detected"),
      metric("Sheets", model.sheets.length),
      metric("Part Images Found", model.counts.partImagesMapped || 0),
      metric("Content Fingerprint", model.workbookFingerprint || "-"),
      '</div>',
      '<div class="import-sheet-list">' + model.sheets.map(function (sheet) {
        return '<span>' + app.utils.escapeHtml(sheet.name) + '</span>';
      }).join("") + '</div>',
      !model.supported ? '<div class="validation-summary error">Unsupported workbook format.</div>' : "",
      model.previewOnly ? '<div class="validation-summary warning">BOM Cost data can be reviewed, but commercial import is outside this milestone.</div>' : "",
      '</section>'
    ].join("");
  }

  function renderValidationAndPreview() {
    var model = session.model;
    return [
      '<section class="import-section">',
      '<div class="import-section-heading"><strong>Validation</strong><span>' + model.counts.errors + ' errors, ' + model.counts.warnings + ' warnings</span></div>',
      '<div class="import-count-grid">',
      metric("Parts", model.counts.parts),
      metric("Assemblies", model.counts.assemblies),
      metric("BOM Items", model.counts.bomItems),
      metric("Part Images Mapped", model.counts.partImagesMapped || 0),
      metric("Features", model.counts.features),
      metric("FG Variants", model.counts.variants),
      metric("Commodities", model.counts.commodities),
      '</div>',
      renderDiagnostics(model.diagnostics),
      '</section>',
      '<section class="import-section import-preview">',
      '<div class="import-section-heading"><strong>Business Preview</strong>' + renderSheetSelect(model) + '</div>',
      renderPreviewTable(model),
      '</section>'
    ].join("");
  }

  function renderDiagnostics(diagnostics) {
    if (!diagnostics.length) return '<div class="validation-summary success">Workbook validation passed without issues.</div>';
    return [
      '<div class="import-diagnostics-wrap">',
      '<table class="engineering-table import-diagnostics"><thead><tr><th>Severity</th><th>Sheet</th><th>Row</th><th>Column</th><th>Value</th><th>Business Message</th><th>Recommended Correction</th></tr></thead><tbody>',
      diagnostics.slice(0, 100).map(function (item) {
        return '<tr class="diagnostic-' + item.severity.toLowerCase() + '"><td>' + escape(item.severity) + '</td><td>' + escape(item.sheet) + '</td><td>' + escape(item.row || "-") + '</td><td>' + escape(item.column || "-") + '</td><td>' + escape(item.value) + '</td><td>' + escape(item.message) + '</td><td>' + escape(item.correction) + '</td></tr>';
      }).join(""),
      '</tbody></table>',
      diagnostics.length > 100 ? '<div class="import-table-note">Showing the first 100 validation results.</div>' : "",
      '</div>'
    ].join("");
  }

  function renderSheetSelect(model) {
    var options = model.previewOnly ? [model.costPreview && model.costPreview.sheetName].filter(Boolean) : ["Feature Matrix"].concat(model.modules.map(function (module) { return module.sheetName; }));
    if (!session.selectedSheet || options.indexOf(session.selectedSheet) === -1) session.selectedSheet = options[0] || "";
    return '<label class="import-sheet-select">Sheet<select data-import-preview-sheet>' + options.map(function (name) {
      return '<option value="' + escape(name) + '"' + (name === session.selectedSheet ? " selected" : "") + '>' + escape(name) + '</option>';
    }).join("") + '</select></label>';
  }

  function renderPreviewTable(model) {
    if (model.previewOnly) {
      var rows = model.costPreview && model.costPreview.rows || [];
      return table(["Source Row", "Part Number", "Part Description", "Commodity", "Supplier", "Unit Rate"], rows.map(function (row) {
        return [row.sourceRow, row.partNumber, row.description, row.commodity, row.supplier, row.unitRate];
      }));
    }
    if (session.selectedSheet === "Feature Matrix") {
      return table(["Source Row", "Feature Code", "Feature Name", "Type", "Allowed Values"], model.features.map(function (feature) {
        return [feature.sourceRow, feature.featureCode, feature.name, feature.valueType, feature.allowedValues.join(", ")];
      }));
    }
    var module = model.modules.find(function (item) { return item.sheetName === session.selectedSheet; });
    var rows = module ? module.sourceRows.slice(0, 100) : [];
    return table(["Source Row", "Level", "Part Number", "Part Revision", "Drawing Number", "Drawing Revision", "Part Description", "Commodity", "Material", "Quantity", "CAD Weight", "Change"], rows.map(function (row) {
      return [row.sourceRow, row.level, row.sourcePartNumber, row.currentRevision, row.drawingNumber, row.drawingRevision, row.description, row.commodity, row.material, row.quantity, row.cadWeight, row.changeClassification];
    }), module && module.sourceRows.length > 100 ? "Showing the first 100 mapped rows." : "");
  }

  function renderSummary() {
    var summary = session.summary;
    var counts = summary.recordCounts || {};
    return [
      '<section class="import-section import-summary">',
      '<div class="import-section-heading"><strong>Import Completed</strong><span>' + escape(formatDate(summary.importedAt)) + '</span></div>',
      '<div class="import-summary-context"><span>Workbook <strong>' + escape(summary.workbookName) + '</strong></span><span>Programme <strong>' + escape(summary.programCode) + '</strong></span><span>Type <strong>' + escape(summary.workbookType) + '</strong></span></div>',
      '<div class="import-count-grid">',
      metric("FG Variants", counts.variants || 0),
      metric("Features Created", counts.featuresCreated || 0),
      metric("Parts Created", counts.partsCreated || 0),
      metric("Parts Reused", counts.partsReused || 0),
      metric("Identical Part Occurrences", counts.duplicateIdenticalPartOccurrences || 0),
      metric("Conflicting Parts", counts.conflictingParts || 0),
      metric("Accepted Source Variances", counts.acceptedSourceVariances || 0),
      metric("Inactive Source Variances", counts.acceptedInactiveSourceVariances || 0),
      metric("Engineering BOMs", counts.engineeringBoms || 0),
      metric("Reused eBOMs", counts.engineeringBomsReused || 0),
      metric("BOM Items", counts.bomItems || 0),
      metric("Duplicate BOM Occurrences", counts.duplicateBomOccurrencesSkipped || 0),
      metric("Part Images Imported", counts.partImagesImported || 0),
      metric("Unsupported Part Images", counts.unsupportedPartImages || 0),
      metric("Warnings", summary.warningCount || 0),
      metric("Ignored Presentation Rows", counts.ignoredPresentationRows || summary.skippedRows || 0),
      '</div>',
      '</section>'
    ].join("");
  }

  function renderHistory() {
    var history = app.domain.bomImportService.getImportHistory().slice(0, 5);
    if (!history.length) return "";
    return [
      '<section class="import-section import-history">',
      '<div class="import-section-heading"><strong>Recent Imports</strong><span>Latest five validation and import attempts</span></div>',
      '<table class="engineering-table"><thead><tr><th>Workbook</th><th>Type</th><th>Status</th><th>Date</th><th>Warnings</th><th>Errors</th></tr></thead><tbody>',
      history.map(function (item) {
        return '<tr><td>' + escape(item.workbookName) + '</td><td>' + escape(item.workbookType) + '</td><td>' + escape(item.status) + '</td><td>' + escape(formatDate(item.importedAt || item.validatedAt || item.startedAt || item.failedAt)) + '</td><td>' + escape(item.warningCount || 0) + '</td><td>' + escape(item.errorCount || 0) + '</td></tr>';
      }).join(""),
      '</tbody></table></section>'
    ].join("");
  }

  function bindControls(container) {
    var fileInput = container.querySelector("[data-import-file]");
    bind(container, "select", function () { fileInput.click(); });
    if (fileInput) fileInput.onchange = function () { if (fileInput.files && fileInput.files[0]) selectFile(fileInput.files[0]); };
    bind(container, "validate", validateWorkbook);
    bind(container, "import", importWorkbook);
    bind(container, "repair-images", repairPartImages);
    bind(container, "cancel", function () { session = emptySession(); app.router.render(); });
    bind(container, "open", openImportedProgramme);
    var previewSelect = container.querySelector("[data-import-preview-sheet]");
    if (previewSelect) previewSelect.onchange = function () { session.selectedSheet = previewSelect.value; app.router.render(); };
  }

  function selectFile(file) {
    if (!/\.xlsx$/i.test(file.name || "")) {
      session = emptySession();
      session.message = "Select an .xlsx workbook.";
      app.router.render();
      return;
    }
    session = emptySession();
    session.file = file;
    session.busy = true;
    session.message = "Reading workbook locally...";
    app.router.render();
    file.arrayBuffer().then(function (buffer) {
      return app.importing.xlsxReader.readWorkbook(buffer);
    }).then(function (workbook) {
      session.model = app.importing.bomImportMapper.mapWorkbook(workbook, { name: file.name, size: file.size });
      var existing = app.domain.bomImportService.findExistingImportForModel(session.model);
      session.summary = existing;
      session.stage = existing ? "EXISTING" : "DETECTED";
      session.busy = false;
      session.message = existing ? "This workbook has already been imported." : (session.model.supported ? "Workbook detected. Validate it before import." : "Unsupported workbook format.");
      app.router.render();
    }).catch(function () {
      session.busy = false;
      session.stage = "SELECT";
      session.message = "The workbook could not be read. Confirm that it is a valid .xlsx file.";
      app.router.render();
    });
  }

  function validateWorkbook() {
    if (!session.model) return;
    run(function () {
      app.domain.bomImportService.recordWorkbookValidation(session.model);
      session.stage = "VALIDATED";
      session.selectedSheet = session.model.previewOnly && session.model.costPreview ? session.model.costPreview.sheetName : "Feature Matrix";
      session.message = session.model.valid ? "Validation passed. Review the preview and confirm the import." : session.model.previewOnly ? "Workbook detected for preview; commercial import is not included in this milestone." : "Validation found blocking errors. Correct the workbook and select it again.";
    });
  }

  function importWorkbook() {
    session.busy = true;
    session.message = "Importing engineering data and Part images...";
    app.router.render();
    app.domain.bomImportService.importWorkbookWithImages(session.model).then(function (summary) {
      session.summary = summary;
      session.stage = "IMPORTED";
      session.busy = false;
      session.message = "Import completed. Part images and engineering data are ready.";
      if (session.model && session.model.imageAssets) {
        session.model.imageAssets.forEach(function (asset) { delete asset.base64; });
      }
      if (app.components.toast) app.components.toast.show({ message: "Workbook imported", tone: "success" });
      if (app.core && app.core.contextService) app.state.repairContext();
      app.router.render();
    }).catch(function (error) {
      session.busy = false;
      session.message = error && error.validationErrors && error.validationErrors[0] ? error.validationErrors[0].message : error.message;
      app.router.render();
    });
  }

  function repairPartImages() {
    session.busy = true;
    session.message = "Checking the workbook image-to-Part associations...";
    app.router.render();
    app.domain.bomImportService.repairImportedPartImagesWithAssets(session.model).then(function (summary) {
      session.summary = summary;
      session.busy = false;
      var repair = summary.imageMappingRepair || {};
      session.message = repair.updatedParts + " Part image association(s) corrected. Existing user-assigned images were preserved.";
      if (app.components.toast) app.components.toast.show({ message: "Part images corrected", tone: "success" });
      app.router.render();
    }).catch(function (error) {
      session.busy = false;
      session.message = error && error.validationErrors && error.validationErrors[0] ? error.validationErrors[0].message : error.message;
      app.router.render();
    });
  }

  function openImportedProgramme() {
    run(function () {
      app.domain.bomImportService.openImportedProgramme(session.summary.importId);
      app.router.navigate("program");
    });
  }

  function run(operation, successMessage) {
    try {
      operation();
      if (successMessage && app.components.toast) app.components.toast.show({ message: successMessage, tone: "success" });
      if (app.core && app.core.contextService) app.state.repairContext();
      app.router.render();
    } catch (error) {
      var message = error && error.validationErrors && error.validationErrors[0] ? error.validationErrors[0].message : error.message;
      session.message = message || "The operation could not be completed.";
      if (app.components.toast) app.components.toast.show({ message: session.message, tone: "error" });
      app.router.render();
    }
  }

  function bind(container, action, handler) {
    var button = container.querySelector('[data-import-action="' + action + '"]');
    if (button) button.onclick = handler;
  }

  function table(headers, rows, note) {
    return '<div class="import-preview-table"><table class="engineering-table"><thead><tr>' + headers.map(function (header) { return '<th>' + escape(header) + '</th>'; }).join("") + '</tr></thead><tbody>' + (rows.length ? rows.map(function (row) { return '<tr>' + row.map(function (value) { return '<td>' + escape(value == null ? "" : value) + '</td>'; }).join("") + '</tr>'; }).join("") : '<tr><td colspan="' + headers.length + '">No mapped business rows.</td></tr>') + '</tbody></table>' + (note ? '<div class="import-table-note">' + escape(note) + '</div>' : "") + '</div>';
  }

  function metric(label, value) {
    return '<div class="import-metric"><span>' + escape(label) + '</span><strong>' + escape(value) + '</strong></div>';
  }

  function sum(items, property) {
    return (items || []).reduce(function (total, item) { return total + Number(item[property] || 0); }, 0);
  }

  function statusLabel() {
    if (session.stage === "EXISTING") return "Existing Import";
    if (session.stage === "IMPORTED") return "Import Complete";
    if (session.stage === "VALIDATED") return session.model && session.model.valid ? "Ready to Import" : "Validation Issues";
    if (session.stage === "DETECTED") return "Workbook Detected";
    return "Select Workbook";
  }

  function formatDate(value) {
    if (!value) return "-";
    var date = new Date(value);
    return isNaN(date.getTime()) ? value : date.toLocaleString();
  }

  function escape(value) {
    return app.utils.escapeHtml(String(value == null ? "" : value));
  }
})(window.DEP = window.DEP || {});
