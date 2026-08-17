(function (app) {
  var selectedRevisionId = null;
  var exporting = false;

  app.router.register("excel-export", {
    render: function () {
      var revisions = app.domain.revisionExcelExportService.listReleasedRevisions();
      selectDefaultRevision(revisions);
      return renderWorkspace(revisions, getSelectedRevision(revisions));
    },
    afterRender: function (container) {
      bindRevisionSelector(container);
      bindExport(container);
    },
    beforeLeave: function () {
      exporting = false;
    }
  });

  function selectDefaultRevision(revisions) {
    if (selectedRevisionId && revisions.some(function (revision) { return revision.id === selectedRevisionId; })) return;
    var context = app.core.contextService.getContext();
    var contextual = revisions.filter(function (revision) {
      return (!context.activeProgramId || revision.programId === context.activeProgramId) &&
        (!context.activeSeatVariantId || revision.seatVariantId === context.activeSeatVariantId);
    });
    selectedRevisionId = (contextual[contextual.length - 1] || revisions[revisions.length - 1] || {}).id || null;
  }

  function getSelectedRevision(revisions) {
    return revisions.find(function (revision) { return revision.id === selectedRevisionId; }) || null;
  }

  function renderWorkspace(revisions, revision) {
    var readiness = app.domain.revisionExcelExportService.validateRevisionSnapshot(revision);
    var model = readiness.exportAllowed
      ? app.domain.revisionExcelExportService.buildWorkbookModelFromRevision(revision, { exportedAt: new Date().toISOString() })
      : null;
    return [
      app.utils.renderWorkspaceHeader({
        title: "Excel Export",
        purpose: "Released Revision Workbook",
        showContext: false,
        status: revision ? "Revision " + revision.revisionNumber + " Released" : "No Released Revision",
        actions: [{
          id: "export-released-revision",
          label: exporting ? "Preparing Workbook..." : "Export Released Revision",
          primary: true,
          disabled: !readiness.exportAllowed || exporting,
          title: "Downloads an XLSX reconstructed only from the selected immutable Revision snapshot."
        }]
      }),
      '<div class="workspace-body excel-export-workspace">',
      renderSelector(revisions, revision),
      revision ? renderContext(revision) : renderEmpty(),
      revision ? renderRevisionInformation(revision) : "",
      revision ? renderEcnInformation(revision) : "",
      model ? renderSheetList(model) : "",
      renderValidation(readiness),
      '</div>'
    ].join("");
  }

  function renderSelector(revisions, revision) {
    return [
      '<section class="export-selector-band" aria-label="Released Revision selection">',
      '<label>Released Revision<select data-export-revision>',
      revisions.length ? revisions.map(function (item) {
        return '<option value="' + escape(item.id) + '"' + (revision && item.id === revision.id ? ' selected' : '') + '>' +
          escape(revisionOptionLabel(item)) + '</option>';
      }).join("") : '<option value="">No released revisions</option>',
      '</select></label>',
      '<span class="export-source-note">Source: immutable released Revision snapshot</span>',
      '</section>'
    ].join("");
  }

  function renderContext(revision) {
    var programme = revision.programSnapshot || {};
    var variant = revision.seatVariantSnapshot || {};
    return [
      '<section class="export-context-grid" aria-label="Released product context">',
      contextValue("Programme", programme.programCode || programme.code || programme.name || revision.programId),
      contextValue("Customer / OEM", variant.customer || variant.brand || variant.oem || programme.customer || programme.oem || "-"),
      contextValue("Seat Type", variant.seatType || variant.seatFamily || "-"),
      contextValue("Finished-Good Variant", variant.variantCode || variant.variantName || revision.seatVariantId),
      '</section>'
    ].join("");
  }

  function renderRevisionInformation(revision) {
    return [
      '<section class="export-information-section">',
      '<h2>Revision Information</h2>',
      '<table class="engineering-table export-information-table"><tbody>',
      pair("Revision", revision.revisionNumber),
      pair("Title", revision.title || "Released Product Definition"),
      pair("Lifecycle Status", revision.lifecycleStatus),
      pair("Released At", formatDate(revision.releasedAt)),
      pair("Released By", revision.releasedBy || revision.createdBy || "-"),
      pair("Snapshot Hash", revision.snapshotHash || "-"),
      '</tbody></table>',
      '</section>'
    ].join("");
  }

  function renderEcnInformation(revision) {
    var change = revision.engineeringChangeSnapshot || {};
    return [
      '<section class="export-information-section">',
      '<h2>ECN Information</h2>',
      '<table class="engineering-table export-information-table"><tbody>',
      pair("ECN Number", change.changeNumber || change.ecnNumber || revision.engineeringChangeId || "-"),
      pair("Title", change.title || "-"),
      pair("Reason", change.reason || "-"),
      pair("Owner", change.owner || "-"),
      pair("Implemented At", formatDate(change.implementedAt)),
      '</tbody></table>',
      '</section>'
    ].join("");
  }

  function renderSheetList(model) {
    return [
      '<section class="export-information-section export-sheet-section">',
      '<h2>Generated Workbook Sheets</h2>',
      '<div class="export-sheet-list">',
      model.sheetNames.map(function (name, index) {
        return '<span><b>' + (index + 1) + '</b>' + escape(name) + '</span>';
      }).join(""),
      '</div>',
      '<p class="export-file-name">Download: <strong>' + escape(model.fileName) + '</strong></p>',
      '</section>'
    ].join("");
  }

  function renderValidation(readiness) {
    var errors = readiness.errors || [];
    var warnings = readiness.warnings || [];
    if (!errors.length && !warnings.length) {
      return '<div class="operation-feedback success" role="status">The released Revision contains all required snapshots and is ready to export.</div>';
    }
    return '<section class="operation-feedback ' + (errors.length ? 'error' : 'warning') + '" role="status"><strong>' +
      (errors.length ? 'Export is not available.' : 'Export notes') + '</strong><ul>' +
      errors.concat(warnings).map(function (item) { return '<li>' + escape(item.message) + '</li>'; }).join("") +
      '</ul></section>';
  }

  function renderEmpty() {
    return app.utils.renderEmptyState(
      "No released Revision is available.",
      "Release a Revision before exporting the product definition."
    );
  }

  function bindRevisionSelector(container) {
    var selector = container.querySelector("[data-export-revision]");
    if (!selector) return;
    selector.onchange = function () {
      selectedRevisionId = selector.value || null;
      app.state.clearSelection();
      app.router.render();
    };
  }

  function bindExport(container) {
    var button = container.querySelector('[data-action="export-released-revision"]');
    if (!button) return;
    button.onclick = function () {
      if (!selectedRevisionId || exporting) return;
      exporting = true;
      button.disabled = true;
      button.textContent = "Preparing Workbook...";
      app.domain.revisionExcelExportService.downloadReleasedRevision(selectedRevisionId).then(function (result) {
        app.services.notificationService.notify("Released Revision exported: " + result.fileName, "success");
      }).catch(function (error) {
        var issues = error && error.validationErrors || [];
        app.services.notificationService.notify(issues[0] && issues[0].message || "The released Revision workbook could not be exported.", "error");
      }).finally(function () {
        exporting = false;
        if (app.state.getCurrentWorkspace() === "excel-export") app.router.render();
      });
    };
  }

  function revisionOptionLabel(revision) {
    var variant = revision.seatVariantSnapshot || {};
    var variantLabel = variant.variantCode || variant.variantName || revision.seatVariantId;
    return variantLabel + " / Revision " + revision.revisionNumber + " / " + formatDate(revision.releasedAt);
  }

  function contextValue(label, value) {
    return '<div><span>' + escape(label) + '</span><strong>' + escape(value || "-") + '</strong></div>';
  }

  function pair(label, value) {
    return '<tr><th>' + escape(label) + '</th><td>' + escape(value || "-") + '</td></tr>';
  }

  function formatDate(value) {
    if (!value) return "-";
    var parsed = new Date(value);
    return isNaN(parsed.getTime()) ? String(value) : parsed.toLocaleString("en-GB");
  }

  function escape(value) {
    return app.utils.escapeHtml(String(value === null || value === undefined ? "" : value));
  }
})(window.DEP = window.DEP || {});
