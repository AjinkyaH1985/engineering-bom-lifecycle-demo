(function (app) {
  var selectedRevisionId = null;
  var comparison = null;

  app.router.register("revision", {
    render: function () {
      var revisions = getRevisions();
      if (!selectedRevisionId && revisions.length) selectedRevisionId = revisions[revisions.length - 1].id;
      return renderWorkspace(revisions, getSelectedRevision());
    },
    afterRender: function (container) {
      bindRows(container);
      bindActions(container);
      bindFilter(container);
      var selected = getSelectedRevision();
      if (selected) selectRevision(selected);
    }
  });

  function renderWorkspace(revisions, selected) {
    var readyChanges = getImplementedChangesWithoutRevision();
    var pendingChange = getActivePendingChange();
    var actions = [];
    if (readyChanges.length) {
      actions.push({ id: "release-revision", label: "Create Revision", primary: true, title: "Creates an immutable snapshot of the released product definition." });
    }
    if (revisions.length >= 2) {
      actions.push({ id: "compare-revisions", label: "Compare Revisions", primary: true, title: "Compares two selected immutable revisions." });
    }
    if (!readyChanges.length && pendingChange) {
      actions.push({ id: "open-engineering-change", label: "Open Engineering Change", primary: true, title: "Complete the active ECN before creating its immutable Revision." });
    }
    return [
      app.utils.renderWorkspaceHeader({
        title: "Revision History",
        purpose: "",
        status: revisions.length ? "Released History" : "No Revisions",
        nextStep: readyChanges.length ? "Create Revision from implemented change" : pendingChange ? "Complete " + pendingChange.changeNumber + " before creating a Revision" : "Complete an Engineering Change first",
        actions: actions
      }),
      '<div class="workspace-body">',
      '<div class="placeholder-panel">',
      renderRevisionPrerequisite(readyChanges, pendingChange),
      renderReleaseControls(),
      '<div class="table-toolbar"><input type="search" placeholder="Search revisions" data-revision-filter><button type="button" data-action="filter">Search</button></div>',
      renderTable(revisions),
      renderComparisonControls(revisions),
      renderDetails(selected),
      renderComparison(),
      '</div>',
      '</div>'
    ].join("");
  }

  function renderRevisionPrerequisite(readyChanges, pendingChange) {
    if (readyChanges.length || !pendingChange) return "";
    return '<div class="revision-prerequisite"><strong>Revision creation is not yet available.</strong><span>' +
      app.utils.escapeHtml(pendingChange.changeNumber + " is " + labelStatus(pendingChange.status) + ". Complete its Engineering and Commercial reviews, then select Complete Implementation.") +
      '</span></div>';
  }

  function renderReleaseControls() {
    var changes = getImplementedChangesWithoutRevision();
    if (!changes.length) return "";
    return [
      '<div class="configuration-bar">',
      '<span>Revision Source</span>',
      '<select data-release-change>',
      changes.map(function (change) {
        return '<option value="' + app.utils.escapeHtml(change.id) + '">' + app.utils.escapeHtml((change.changeNumber || change.ecnNumber) + " - " + change.title) + '</option>';
      }).join("") || '<option value="">No implemented changes ready</option>',
      '</select>',
      '<input type="text" data-release-notes placeholder="Release notes">',
      '<span>' + app.utils.renderStatusBadge("Ready", "Release readiness passed for implemented changes shown here.") + '</span>',
      '</div>'
    ].join("");
  }

  function renderTable(revisions) {
    return [
      '<table class="engineering-table revision-table"><thead><tr><th>Revision</th><th>Released</th><th>Released By</th><th>Change Number</th><th>Title</th><th>Status</th><th>Snapshot Hash</th></tr></thead><tbody>',
      revisions.map(function (revision) {
        return '<tr data-revision-id="' + app.utils.escapeHtml(revision.id) + '" class="' + (revision.id === selectedRevisionId ? "selected" : "") + '">' +
          '<td>' + app.utils.escapeHtml(revision.revisionNumber) + '</td>' +
          '<td>' + app.utils.escapeHtml(formatDate(revision.releasedAt)) + '</td>' +
          '<td>' + app.utils.escapeHtml(revision.releasedBy) + '</td>' +
          '<td>' + app.utils.escapeHtml(getChangeNumber(revision.engineeringChangeId)) + '</td>' +
          '<td>' + app.utils.escapeHtml(revision.title) + '</td>' +
          '<td>' + app.utils.escapeHtml(revision.lifecycleStatus) + '</td>' +
          '<td>' + app.utils.escapeHtml(shortHash(revision.snapshotHash)) + '</td>' +
          '</tr>';
      }).join("") || '<tr><td colspan="7" class="muted">No released revisions.</td></tr>',
      '</tbody></table>'
    ].join("");
  }

  function renderComparisonControls(revisions) {
    if (revisions.length < 2) return "";
    var fromId = revisions[0].id;
    var toId = revisions[revisions.length - 1].id;
    return [
      '<div class="configuration-bar">',
      '<span>Compare Revisions</span>',
      '<select data-compare-from>',
      revisions.map(function (revision) { return optionForRevision(revision, revision.id === fromId); }).join(""),
      '</select>',
      '<select data-compare-to>',
      revisions.map(function (revision) { return optionForRevision(revision, revision.id === toId); }).join(""),
      '</select>',
      '<span class="muted">Compare released baselines for Feature, eBOM, Complete Seat, and Commercial changes.</span>',
      '</div>'
    ].join("");
  }

  function renderDetails(revision) {
    if (!revision) return app.utils.renderEmptyState(
      "No Revision selected",
      "Create or select a Revision to view immutable snapshot details.",
      "Revision creation requires an implemented Engineering Change and current generated/commercial data."
    );
    return [
      '<section class="workspace-section">',
      '<h2>Revision Details</h2>',
      '<table class="engineering-table related-table"><tbody>',
      pair("Revision", revision.revisionNumber),
      pair("Title", revision.title),
      pair("Status", revision.lifecycleStatus),
      pair("Change Number", getChangeNumber(revision.engineeringChangeId)),
      pair("Released At", formatDate(revision.releasedAt)),
      pair("Released By", revision.releasedBy),
      pair("Parts Snapshot", String((revision.partsSnapshot || []).length)),
      pair("Engineering BOM Snapshots", String((revision.engineeringBomSnapshots || []).length)),
      pair("EPS Items", String(((revision.engineeringProductStructureSnapshot || {}).items || []).length)),
      pair("Commercial Lines", String(((revision.commercialAssessmentSnapshot || {}).lineItems || []).length)),
      pair("Snapshot Hash", shortHash(revision.snapshotHash)),
      '</tbody></table>',
      '<h2>Snapshot View</h2>',
      '<table class="engineering-table related-table"><thead><tr><th>Snapshot</th><th>ID</th><th>Status</th></tr></thead><tbody>',
      snapshotRow("Feature Configuration", revision.featureConfigurationSnapshot),
      (revision.engineeringBomSnapshots || []).map(function (bom) { return snapshotRow("Engineering BOM", bom); }).join(""),
      snapshotRow("Engineering Product Structure", revision.engineeringProductStructureSnapshot),
      snapshotRow("Commercial Assessment", revision.commercialAssessmentSnapshot),
      '</tbody></table>',
      '</section>'
    ].join("");
  }

  function renderComparison() {
    if (!comparison) return "";
    var areas = Object.keys(comparison.differences || {});
    return [
      '<section class="workspace-section">',
      '<h2>Comparison Result</h2>',
      '<table class="engineering-table related-table"><thead><tr><th>Area</th><th>Changed</th><th>Change Count</th></tr></thead><tbody>',
      areas.map(function (area) {
        var result = comparison.differences[area];
        return '<tr><td>' + app.utils.escapeHtml(area) + '</td><td>' + app.utils.escapeHtml(result.changed ? "Yes" : "No") +
          '</td><td>' + app.utils.escapeHtml(String((result.changes || []).length)) + '</td></tr>';
      }).join(""),
      '</tbody></table>',
      '<h2>Business Differences</h2>',
      '<table class="engineering-table related-table"><thead><tr><th>Area</th><th>Type</th><th>Object</th><th>Difference</th></tr></thead><tbody>',
      renderComparisonDetails(areas),
      '</tbody></table>',
      '</section>'
    ].join("");
  }

  function renderComparisonDetails(areas) {
    var rows = [];
    (comparison.businessDifferences || []).slice(0, 80).forEach(function (change) {
      rows.push('<tr><td>' + app.utils.escapeHtml(labelArea(change.area)) + '</td><td>' +
        app.utils.escapeHtml(change.type) + '</td><td>' +
        app.utils.escapeHtml(change.partNumber || change.objectId || "-") + '</td><td>' +
        app.utils.escapeHtml(change.field
          ? change.field + ": " + formatComparisonValue(change.before) + " -> " + formatComparisonValue(change.after)
          : change.type === "ADDED" ? "Added" : change.type === "REMOVED" ? "Removed" : "Changed") + '</td></tr>');
    });
    if (rows.length) return rows.join("");
    areas.forEach(function (area) {
      var result = comparison.differences[area];
      (result.changes || []).slice(0, 12).forEach(function (change) {
        rows.push('<tr><td>' + app.utils.escapeHtml(labelArea(area)) + '</td><td>' +
          app.utils.escapeHtml(change.type || "CHANGED") + '</td><td>' +
          app.utils.escapeHtml(change.id || describeObject(change.after || change.before)) + '</td><td>' +
          app.utils.escapeHtml(describeChange(area, change)) + '</td></tr>');
      });
    });
    return rows.join("") || '<tr><td colspan="4" class="muted">No business differences found.</td></tr>';
  }

  function formatComparisonValue(value) {
    if (value === null || value === undefined || value === "") return "-";
    if (typeof value === "object") return value.partNumber || value.id || JSON.stringify(value);
    return String(value);
  }

  function labelArea(area) {
    return {
      featureConfiguration: "Feature Configuration",
      parts: "Parts",
      engineeringBoms: "Engineering eBOMs",
      engineeringProductStructure: "Complete Seat JIT",
      commercialAssessment: "Commercial Assessment"
    }[area] || area;
  }

  function describeObject(object) {
    object = object || {};
    return object.partNumber || object.changeNumber || object.id || object.revisionNumber || "-";
  }

  function describeChange(area, change) {
    if (change.type === "ADDED") return "Added " + describeObject(change.after);
    if (change.type === "REMOVED") return "Removed " + describeObject(change.before);
    if (area === "parts") return describeFieldChanges(change.before, change.after, ["oemPartNumber", "internalPartNumber", "partNumber", "category", "currentRevision", "drawingRevision", "material", "commodity", "cadWeight", "lifecycleState"]);
    if (area === "engineeringBoms") return describeBomChange(change.before, change.after);
    if (area === "commercialAssessment") return describeCommercialChange(change.before, change.after);
    if (area === "featureConfiguration") return describeFeatureConfigChange(change.before, change.after);
    if (area === "engineeringProductStructure") return describeEpsChange(change.before, change.after);
    return "Changed";
  }

  function describeFieldChanges(before, after, fields) {
    before = before || {};
    after = after || {};
    var changes = fields.filter(function (field) {
      return JSON.stringify(before[field] || "") !== JSON.stringify(after[field] || "");
    }).map(function (field) {
      return field + ": " + (before[field] || "-") + " -> " + (after[field] || "-");
    });
    return changes.join("; ") || "Changed";
  }

  function describeBomChange(before, after) {
    before = before || {};
    after = after || {};
    var beforeItems = before.items || [];
    var afterItems = after.items || [];
    if (beforeItems.length !== afterItems.length) return "BOM item count: " + beforeItems.length + " -> " + afterItems.length;
    return describeFieldChanges(before, after, ["completionStatus", "lifecycleState", "rootPartId"]);
  }

  function describeFeatureConfigChange(before, after) {
    before = before || {};
    after = after || {};
    var beforeSelections = before.selections || [];
    var afterSelections = after.selections || [];
    if (beforeSelections.length !== afterSelections.length) return "Feature selections: " + beforeSelections.length + " -> " + afterSelections.length;
    return "Feature values changed for this Finished-Good Variant.";
  }

  function describeEpsChange(before, after) {
    before = before || {};
    after = after || {};
    return "Generated hierarchy/items: " + ((before.items || []).length) + " -> " + ((after.items || []).length) +
      "; status: " + (before.generationStatus || "-") + " -> " + (after.generationStatus || "-");
  }

  function describeCommercialChange(before, after) {
    before = before || {};
    after = after || {};
    var beforeTotals = before.totals || {};
    var afterTotals = after.totals || {};
    return "Overall total: " + (beforeTotals.overallTotal || 0) + " -> " + (afterTotals.overallTotal || 0) +
      "; commercial lines: " + ((before.lineItems || []).length) + " -> " + ((after.lineItems || []).length);
  }

  function bindRows(container) {
    container.querySelectorAll("[data-revision-id]").forEach(function (row) {
      row.onclick = function () {
        selectedRevisionId = row.getAttribute("data-revision-id");
        selectRevision(getSelectedRevision());
        app.router.render();
      };
    });
  }

  function bindActions(container) {
    bindAction(container, "release-revision", function () {
      var changeId = value(container, "[data-release-change]");
      if (!changeId) return;
      try {
        app.domain.revisionService.createRevision({
          engineeringChangeId: changeId,
          notes: value(container, "[data-release-notes]")
        });
        var history = getRevisions();
        selectedRevisionId = history.length ? history[history.length - 1].id : selectedRevisionId;
        app.state.addNotification("Revision released", "success");
        app.router.render();
      } catch (error) {
        app.state.addNotification(error.message || "Revision release failed", "warning");
        app.router.render();
      }
    });
    bindAction(container, "compare-revisions", function () {
      var fromId = value(container, "[data-compare-from]");
      var toId = value(container, "[data-compare-to]");
      if (!fromId || !toId) return;
      if (fromId === toId) {
        app.state.addNotification("Select two different revisions to compare", "warning");
        return;
      }
      comparison = app.domain.revisionService.compareRevisions(fromId, toId);
      app.state.addNotification("Revision comparison updated", "success");
      app.router.render();
    });
    bindAction(container, "open-engineering-change", function () {
      app.router.navigate("engineering-change");
    });
  }

  function bindFilter(container) {
    var input = container.querySelector("[data-revision-filter]");
    if (!input) return;
    var filter = function () {
      var term = String(input.value || "").toLowerCase();
      container.querySelectorAll("[data-revision-id]").forEach(function (row) {
        row.hidden = row.textContent && row.textContent.toLowerCase().indexOf(term) === -1;
      });
    };
    input.oninput = filter;
    bindAction(container, "filter", filter);
  }

  function getRevisions() {
    return app.domain && app.domain.revisionService ? app.domain.revisionService.getRevisionHistory() : [];
  }

  function getSelectedRevision() {
    return selectedRevisionId && app.domain.revisionService.getRevision(selectedRevisionId);
  }

  function getImplementedChangesWithoutRevision() {
    var state = app.core.appState.getState();
    var context = state.context || {};
    var releasedChangeIds = {};
    (state.revisions || []).forEach(function (revision) {
      releasedChangeIds[app.domain.revisionService.normalizeRevision(revision).engineeringChangeId] = true;
    });
    return (state.engineeringChanges || []).map(app.domain.engineeringChangeService.normalizeEngineeringChange).filter(function (change) {
      return change.status === "IMPLEMENTED" && !releasedChangeIds[change.id] &&
        change.programId === context.activeProgramId && change.seatVariantId === context.activeSeatVariantId;
    });
  }

  function getActivePendingChange() {
    var state = app.core.appState.getState();
    var context = state.context || {};
    return (state.engineeringChanges || []).map(app.domain.engineeringChangeService.normalizeEngineeringChange).filter(function (change) {
      return change.programId === context.activeProgramId && change.seatVariantId === context.activeSeatVariantId &&
        ["DRAFT", "SUBMITTED", "APPROVED", "IMPLEMENTING"].indexOf(change.status) !== -1;
    }).sort(function (a, b) {
      return String(b.updatedAt || b.createdAt || "").localeCompare(String(a.updatedAt || a.createdAt || ""));
    })[0] || null;
  }

  function labelStatus(status) {
    return String(status || "").toLowerCase().replace(/_/g, " ").replace(/(^|\s)([a-z])/g, function (_, prefix, letter) {
      return prefix + letter.toUpperCase();
    });
  }

  function selectRevision(revision) {
    if (!revision) return;
    app.state.setSelection({
      type: "Revision",
      id: revision.id,
      status: revision.lifecycleStatus,
      date: formatDate(revision.releasedAt),
      engineer: revision.releasedBy || revision.createdBy,
      reason: revision.notes,
      revision: revision.revisionNumber,
      ecnNumber: getChangeNumber(revision.engineeringChangeId),
      changeNumber: getChangeNumber(revision.engineeringChangeId),
      affectedObjects: getAffectedObjects(revision.engineeringChangeId),
      previousRevision: getPreviousRevision(revision),
      currentRevision: revision.revisionNumber
    });
  }

  function getChangeNumber(changeId) {
    var change = app.domain.engineeringChangeService.getEngineeringChange(changeId);
    return change ? change.changeNumber : changeId;
  }

  function getAffectedObjects(changeId) {
    var change = app.domain.engineeringChangeService.getEngineeringChange(changeId);
    return change ? (change.affectedObjects || []).map(function (affected) {
      return affected.objectType + ":" + affected.objectId;
    }).join(", ") : "";
  }

  function getPreviousRevision(revision) {
    var history = getRevisions();
    var index = history.findIndex(function (item) { return item.id === revision.id; });
    return index > 0 ? history[index - 1].revisionNumber : "";
  }

  function optionForRevision(revision, selected) {
    return '<option value="' + app.utils.escapeHtml(revision.id) + '"' + (selected ? " selected" : "") + '>' +
      app.utils.escapeHtml("Revision " + revision.revisionNumber + " - " + revision.title) + '</option>';
  }

  function snapshotRow(label, snapshot) {
    snapshot = snapshot || {};
    return '<tr><td>' + app.utils.escapeHtml(label) + '</td><td>' + app.utils.escapeHtml(snapshot.id || "-") +
      '</td><td>' + app.utils.escapeHtml(snapshot.lifecycleStatus || snapshot.lifecycleState || snapshot.generationStatus || snapshot.status || "-") + '</td></tr>';
  }

  function pair(label, value) {
    return '<tr><th>' + app.utils.escapeHtml(label) + '</th><td>' + app.utils.escapeHtml(value || "-") + '</td></tr>';
  }

  function value(container, selector) {
    var element = container.querySelector(selector);
    return element ? element.value : "";
  }

  function bindAction(container, actionId, handler) {
    var button = container.querySelector('[data-action="' + actionId + '"]');
    if (button) button.onclick = handler;
  }

  function formatDate(value) {
    return value ? String(value).slice(0, 10) : "";
  }

  function shortHash(value) {
    value = String(value || "");
    return value.length > 18 ? value.slice(0, 18) + "..." : value;
  }
})(window.DEP = window.DEP || {});
