(function (app) {
  var expandedNodeIds = [];
  var currentRows = [];
  var currentAllRows = [];
  var rowsByParent = {};
  var currentStructure = null;
  var currentReadiness = null;

  app.router.register("complete-seat", {
    render: function (state) {
      expandedNodeIds = (state.completeSeat.expandedNodeIds || []).slice();
      currentReadiness = app.domain.engineeringProductStructureService.getGenerationReadiness();
      currentStructure = app.domain.engineeringProductStructureService.getEngineeringProductStructureForContext();
      currentRows = buildVisibleRows(currentStructure);
      return renderWorkspace(state, currentRows);
    },
    afterRender: function (container) {
      bindRows(container);
      bindToggles(container);
      bindActions(container);
      bindCompleteSeatPreview(container);
    }
  });

  app.events.on("feature-matrix:saved", refreshIfOpen);
  app.events.on("engineering-module:saved", refreshIfOpen);
  app.events.on("configuration:changed", refreshIfOpen);
  app.events.on("engineering-product-structure:generated", refreshIfOpen);
  app.events.on("engineering-product-structure:generation-failed", refreshIfOpen);

  function refreshIfOpen() {
    if (app.state.getCurrentWorkspace() === "complete-seat") {
      app.router.render();
    }
  }

  function renderWorkspace(state, rows) {
    var config = state.activeConfiguredSeat || {};
    var generationStatus = currentStructure ? currentStructure.generationStatus : "NOT_GENERATED";
    var hasRows = rows.length > 0;
    var hasExpandableRows = rows.some(function (row) { return row.hasChildren; });
    return [
      app.utils.renderWorkspaceHeader({
        title: "Complete Seat JIT",
        purpose: "",
        status: generationStatus,
        statusTitle: getGenerationStatusHelp(generationStatus),
        actions: getHeaderActions(generationStatus)
      }),
      '<div class="workspace-body">',
      '<div class="placeholder-panel">',
      renderConfigurationContext(config, generationStatus),
      renderCompleteSeatVisual(config),
      renderGenerationMessages(generationStatus),
      renderModuleReadiness(generationStatus),
      hasRows ? '<div class="table-toolbar"><input type="search" placeholder="Search complete seat" data-complete-seat-filter>' +
        (hasExpandableRows ? '<div class="hierarchy-actions" role="group" aria-label="Hierarchy display">' +
          '<button type="button" data-action="expand-all" title="Show every hierarchy level"><span aria-hidden="true">+</span> Expand All</button>' +
          '<button type="button" data-action="collapse-all" title="Show only top-level assemblies"><span aria-hidden="true">-</span> Collapse All</button>' +
          '</div>' : '') +
        '</div>' : '',
      hasRows ? '<table class="engineering-table bom-tree-table">' : '',
      hasRows ? [
      '<thead><tr><th>Full Hierarchy</th><th>Preview</th><th>Source Discipline</th><th>Part Number</th><th>Part Rev</th><th>Drawing Number</th><th>Dwg Rev</th>',
      '<th>Part Description</th><th>Commodity</th><th>Material</th><th>Gauge</th><th>Unit Qty</th><th>CAD Weight</th>',
      '<th>Total CAD Weight</th><th>Change Class</th><th>Applicability</th><th>Source BOM</th></tr></thead>',
      '<tbody>',
      rows.map(renderRow).join(""),
      '</tbody></table>',
      ].join("") : renderEmptyState(generationStatus),
      '</div>',
      '</div>'
    ].join("");
  }

  function getHeaderActions(generationStatus) {
    if (generationStatus === "CURRENT") return [];
    var label = generationStatus === "STALE" || generationStatus === "GENERATION_FAILED" ? "Regenerate Complete Seat" : "Generate Complete Seat";
    return [{
      id: "generate-product-structure",
      label: label,
      primary: true,
      disabled: !currentReadiness.generationAllowed,
      title: currentReadiness.generationAllowed ? "Generate the Complete Seat from completed Engineering eBOMs." : "Complete the prerequisites before generation."
    }];
  }

  function renderConfigurationContext(config, generationStatus) {
    return [
      '<div class="configuration-bar">',
      '<span>Seat Type: <strong>' + app.utils.escapeHtml(config.seatType || config.seatFamily || "") + '</strong></span>',
      '<span>Customer / OEM: <strong>' + app.utils.escapeHtml(config.customer || config.brand || "") + '</strong></span>',
      '<span>Side: <strong>' + app.utils.escapeHtml(config.side || "") + '</strong></span>',
      '<span>Grade: <strong>' + app.utils.escapeHtml(config.grade || "") + '</strong></span>',
      '<span>Trim: <strong>' + app.utils.escapeHtml(config.trimMaterial || "") + '</strong></span>',
      '<span>Generation: <strong>' + app.utils.escapeHtml(generationStatus) + '</strong></span>',
      '<span>Generated: <strong>' + app.utils.escapeHtml(currentStructure && currentStructure.generatedAt ? app.utils.formatDate(currentStructure.generatedAt) : "") + '</strong></span>',
      '</div>'
    ].join("");
  }

  function renderCompleteSeatVisual(config) {
    var imageReference = getCompleteSeatImageReference();
    if (!imageReference) return "";
    return [
      '<div class="complete-seat-preview-strip">',
      '<button type="button" class="complete-seat-image-button" data-complete-seat-image-preview aria-label="Open Complete Seat image preview">',
      renderCompleteSeatImage(imageReference, "Complete Seat JIT preview"),
      '</button>',
      '<div>',
      '<strong>Complete Seat JIT Preview</strong>',
      '<span>Click image to preview - ' + app.utils.escapeHtml([config.customer || config.brand, config.seatType || config.seatFamily, config.side, config.grade].filter(Boolean).join(" / ")) + '</span>',
      '</div>',
      '</div>'
    ].join("");
  }

  function getCompleteSeatImageReference() {
    var state = app.core.appState.getState();
    var variantId = state.context && state.context.activeSeatVariantId;
    var variant = (state.seatVariants || []).find(function (candidate) { return candidate.id === variantId; });
    return variant && variant.completeSeatImageReference || "";
  }

  function renderCompleteSeatImage(reference, alt) {
    var imageService = app.domain && app.domain.partImageService;
    if (imageService && imageService.isManagedReference(reference)) {
      return '<img class="part-image-loading" data-part-image-reference="' + app.utils.escapeHtml(reference) + '" alt="' + app.utils.escapeHtml(alt) + '">';
    }
    return '<img src="' + app.utils.escapeHtml(reference) + '" alt="' + app.utils.escapeHtml(alt) + '">';
  }

  function renderGenerationMessages(generationStatus) {
    var missing = getBusinessPrerequisites();
    if (generationStatus === "CURRENT" && !missing.length) return "";
    var messages = [];
    if (generationStatus === "NOT_GENERATED") {
      messages.push("No generated Complete Seat exists for this Finished-Good Variant.");
    }
    if (generationStatus === "STALE") {
      messages.push("The generated Complete Seat is stale because source inputs changed.");
    }
    if (generationStatus === "GENERATION_FAILED") {
      messages.push("Generation failed. The last valid Complete Seat hierarchy is retained where available.");
    }
    if (missing.length) messages.push("Required before generation: " + missing.join(" "));
    if (!messages.length) return "";
    return '<div class="validation-summary">' + messages.map(function (message) {
      return '<div>' + app.utils.escapeHtml(message) + '</div>';
    }).join("") + '</div>';
  }

  function renderModuleReadiness(generationStatus) {
    var modules = currentReadiness && currentReadiness.moduleReadiness || [];
    if (generationStatus === "CURRENT" && currentReadiness.generationAllowed) return "";
    if (!modules.length) return "";
    return '<div class="generation-readiness" data-generation-readiness><table><thead><tr><th>Engineering eBOM</th><th>Applicability</th><th>Completion</th><th>Readiness</th></tr></thead><tbody>' +
      modules.map(function (entry) {
        var issue = (entry.blockingIssues || [])[0] || (entry.applicable ? "Ready" : "Does not block this configuration");
        return '<tr><td>' + app.utils.escapeHtml(entry.moduleName || entry.moduleCode) + '</td>' +
          '<td>' + app.utils.escapeHtml(entry.disposition || (entry.applicable ? "REQUIRED" : "NOT_APPLICABLE")) + '</td>' +
          '<td>' + app.utils.escapeHtml(entry.completionStatus || "NOT_STARTED") + '</td>' +
          '<td>' + app.utils.escapeHtml(issue) + '</td></tr>';
      }).join("") + '</tbody></table></div>';
  }

  function getBusinessPrerequisites() {
    var errors = currentReadiness.blockingErrors || [];
    var prerequisites = [];
    function has(code) {
      return errors.some(function (error) { return error.code === code || error.code.indexOf(code) === 0; });
    }
    if (has("EPS_PROGRAM_MISSING")) prerequisites.push("Select a Programme.");
    if (has("EPS_VARIANT_MISSING") || has("EPS_PROGRAM_VARIANT_MISMATCH")) prerequisites.push("Select a valid Finished-Good Variant.");
    if (has("EPS_FEATURE_CONFIGURATION_MISSING")) prerequisites.push("Save the Feature Matrix for this Finished-Good Variant.");
    if (has("EPS_ENGINEERING_BOM_MISSING")) prerequisites.push("Create the required Engineering eBOMs.");
    if (has("EPS_ENGINEERING_BOM_INCOMPLETE")) prerequisites.push("Complete all required Engineering eBOMs.");
    if (errors.some(function (error) { return error.code.indexOf("EPS_SOURCE_") === 0 || error.code.indexOf("EPS_APPLICABILITY_") === 0; })) {
      prerequisites.push("Correct Engineering eBOM applicability and hierarchy issues.");
    }
    return prerequisites;
  }

  function renderRow(row) {
    var expanded = isExpanded(row.id);
    var toggle = row.hasChildren
      ? '<button type="button" class="tree-toggle" data-toggle-node="' + app.utils.escapeHtml(row.id) + '">' + (expanded ? "-" : "+") + '</button>'
      : '<span class="tree-spacer"></span>';
    return [
      '<tr data-eps-node="' + app.utils.escapeHtml(row.id) + '" data-module-key="' + app.utils.escapeHtml(row.moduleKey || "") + '">',
      '<td><div class="tree-cell" style="padding-left:' + (row.level * 18) + 'px">' + toggle +
        '<span>' + app.utils.escapeHtml(row.hierarchy) + '</span></div></td>',
      '<td class="preview-cell">' + app.utils.renderPartPreviewButton(row, row.id) + '</td>',
      '<td>' + app.utils.escapeHtml(row.sourceModule || "") + '</td>',
      '<td>' + app.utils.escapeHtml(row.partNumber || "") + '</td>',
      '<td>' + app.utils.escapeHtml(row.revision || "") + '</td>',
      '<td>' + app.utils.escapeHtml(row.drawingNumber || "") + '</td>',
      '<td>' + app.utils.escapeHtml(row.drawingRevision || "") + '</td>',
      '<td>' + app.utils.escapeHtml(row.description || "") + '</td>',
      '<td>' + app.utils.escapeHtml(row.commodity || "") + '</td>',
      '<td>' + app.utils.escapeHtml(row.material || "") + '</td>',
      '<td>' + app.utils.escapeHtml(row.gauge || "") + '</td>',
      '<td>' + app.utils.escapeHtml(row.quantity || "") + " " + app.utils.escapeHtml(row.unit || "") + '</td>',
      '<td>' + app.utils.escapeHtml(row.cadWeight || "") + '</td>',
      '<td>' + app.utils.escapeHtml(row.totalCadWeight || "") + '</td>',
      '<td>' + app.utils.escapeHtml(row.changeClassification || "") + '</td>',
      '<td>' + app.utils.escapeHtml(row.applicabilityLabel || "") + '</td>',
      '<td>' + app.utils.escapeHtml(row.sourceEngineeringBomId || "") + '</td>',
      '</tr>'
    ].join("");
  }

  function renderEmptyState(generationStatus) {
    var prerequisites = getBusinessPrerequisites().join(" ");
    var message = generationStatus === "NOT_GENERATED"
      ? (prerequisites || "Complete the required Engineering eBOMs and generate the Complete Seat.")
      : "No generated rows are available for the active Finished-Good Variant.";
    return app.utils.renderEmptyState(
      "No generated structure",
      message
    );
  }

  function getGenerationStatusHelp(status) {
    if (status === "CURRENT") return "Generated output matches the latest source BOMs and Feature Configuration.";
    if (status === "STALE") return "Source Engineering BOMs or Feature Configuration changed. Regenerate before downstream work.";
    if (status === "GENERATION_FAILED") return "Last generation attempt failed. Last valid hierarchy is retained.";
    return "No Engineering Product Structure has been generated for this context.";
  }

  function buildVisibleRows(structure) {
    if (!structure || !(structure.items || []).length) {
      currentAllRows = [];
      rowsByParent = {};
      return [];
    }
    currentAllRows = buildAllRows(structure);
    rowsByParent = indexRowsByParent(currentAllRows);
    if (currentAllRows[0] && expandedNodeIds.indexOf(currentAllRows[0].id) === -1) {
      expandedNodeIds = [currentAllRows[0].id];
    }
    return walkRows(null);
  }

  function buildAllRows(structure) {
    var modulesById = indexById(app.core.appState.getCollection("engineeringModules"));
    var hasChildren = {};
    (structure.items || []).forEach(function (item) {
      if (item.parentGeneratedItemId) hasChildren[item.parentGeneratedItemId] = true;
    });
    return (structure.items || []).map(function (item) {
      var snapshot = item.sourcePartSnapshot || {};
      var module = item.sourceEngineeringModuleId ? modulesById[item.sourceEngineeringModuleId] : null;
      return {
        id: item.id,
        type: snapshot.partType === "ASSEMBLY" || !item.partId ? "Assembly" : "Part",
        hierarchy: snapshot.description || snapshot.name || snapshot.partNumber || "Complete Seat",
        partNumber: snapshot.partNumber || "",
        internalPartNumber: snapshot.internalPartNumber || snapshot.partNumber || "",
        oemPartNumber: snapshot.oemPartNumber || "",
        description: snapshot.description || snapshot.name || "",
        category: snapshot.category || "",
        imageReference: snapshot.imageReference || "",
        revision: snapshot.revision || "",
        drawingNumber: snapshot.drawingNumber || "",
        drawingRevision: snapshot.drawingRevision || "",
        commodity: snapshot.commodity || "",
        material: snapshot.material || "",
        gauge: snapshot.gauge || "",
        cadWeight: snapshot.cadWeight != null ? snapshot.cadWeight : "",
        totalCadWeight: item.totalCadWeight != null ? item.totalCadWeight : "",
        changeClassification: item.changeClassification || snapshot.changeClassification || "",
        quantity: item.calculatedQuantity || item.quantity || 1,
        oemJit: item.oemJit || "",
        internalJit: item.internalJit || "",
        unit: item.unit || "EA",
        status: snapshot.status || structure.generationStatus,
        sourceModule: module ? module.name : "System",
        moduleKey: module ? moduleKeyFromModuleCode(module.code) : "",
        sourceEngineeringBomId: item.sourceEngineeringBomId,
        sourceBomItemId: item.sourceBomItemId,
        sourceEngineeringModuleId: item.sourceEngineeringModuleId,
        parentId: item.parentGeneratedItemId,
        level: item.level || 0,
        sequence: Number(item.sequence || 0),
        applicabilityLabel: getApplicabilityLabel(item.applicability),
        hasChildren: Boolean(hasChildren[item.id])
      };
    }).sort(function (a, b) {
      if (a.level !== b.level) return a.level - b.level;
      return String(a.id).localeCompare(String(b.id));
    });
  }

  function indexRowsByParent(rows) {
    var index = {};
    (rows || []).forEach(function (row) {
      var key = row.parentId || "__ROOT__";
      index[key] = index[key] || [];
      index[key].push(row);
    });
    return index;
  }

  function walkRows(parentId) {
    var visible = [];
    (rowsByParent[parentId || "__ROOT__"] || []).slice().sort(function (a, b) {
      return a.sequence - b.sequence || String(a.id).localeCompare(String(b.id));
    }).forEach(function (row) {
      visible.push(row);
      if (row.hasChildren && expandedNodeIds.indexOf(row.id) !== -1) {
        visible = visible.concat(walkRows(row.id));
      }
    });
    return visible;
  }

  function getApplicabilityLabel(applicability) {
    applicability = applicability || {};
    if (applicability.reason === "ROOT") return "Generated root";
    if (applicability.reason === "MODULE_ROOT") return "Module root";
    if (applicability.result) return applicability.result;
    return "Included";
  }

  function bindRows(container) {
    container.querySelectorAll("[data-eps-node]").forEach(function (rowEl) {
      rowEl.onclick = function () {
        var row = findRow(rowEl.getAttribute("data-eps-node"));
        if (!row) return;
        markSelected(container, rowEl);
        app.state.setSelection({
          workspace: "complete-seat",
          rowId: row.id,
          type: row.type,
          id: row.partNumber || row.id,
          name: row.description || row.hierarchy,
          status: row.status,
          owner: "System Generated",
          revision: row.revision,
          drawingNumber: row.drawingNumber,
          drawingRevision: row.drawingRevision,
          sourceWorkspace: row.sourceModule,
          referencedPartNumber: row.partNumber,
          quantity: row.quantity,
          unit: row.unit,
          material: row.material,
          commodity: row.commodity,
          gauge: row.gauge,
          weight: row.cadWeight,
          totalCadWeight: row.totalCadWeight,
          changeClassification: row.changeClassification,
          activeConfiguration: getConfigurationLabel(app.state.get().activeConfiguredSeat || {}),
          generationStatus: currentStructure ? currentStructure.generationStatus : "NOT_GENERATED",
          sourceEngineeringBomId: row.sourceEngineeringBomId,
          sourceBomItemId: row.sourceBomItemId,
          configurationApplicability: row.applicabilityLabel,
          remarks: "Read-only generated Engineering Product Structure item"
        });
      };
    });
    app.utils.bindPartPreviewButtons(container, function (rowId) {
      return currentRows.find(function (row) { return row.id === rowId; });
    });
  }

  function bindToggles(container) {
    container.querySelectorAll("[data-toggle-node]").forEach(function (button) {
      button.onclick = function (event) {
        event.stopPropagation();
        toggleNode(button.getAttribute("data-toggle-node"));
        app.state.setCompleteSeatView({ expandedNodeIds: expandedNodeIds });
        app.router.render();
      };
    });
  }

  function bindActions(container) {
    bindAction(container, "generate-product-structure", function () {
      try {
        app.domain.engineeringProductStructureService.generateEngineeringProductStructure();
        expandGeneratedRoots();
        app.state.setCompleteSeatView({ expandedNodeIds: expandedNodeIds });
        app.services.notificationService.notify("Engineering Product Structure generated", "success");
        app.router.render();
      } catch (error) {
        app.services.notificationService.notify("Generation failed", "error");
        app.router.render();
      }
    });
    bindAction(container, "expand-all", function () {
      expandedNodeIds = currentAllRows.filter(function (row) { return row.hasChildren; }).map(function (row) { return row.id; });
      app.state.setCompleteSeatView({ expandedNodeIds: expandedNodeIds });
      app.router.render();
    });
    bindAction(container, "collapse-all", function () {
      expandedNodeIds = [];
      app.state.setCompleteSeatView({ expandedNodeIds: expandedNodeIds });
      app.router.render();
    });
    bindAction(container, "search", function () {
      filterRows(container);
    });
    var filter = container.querySelector("[data-complete-seat-filter]");
    if (filter) {
      filter.oninput = function () {
        filterRows(container);
      };
    }
  }

  function bindCompleteSeatPreview(container) {
    if (app.domain && app.domain.partImageService) app.domain.partImageService.hydrateImageElements(container);
    var button = container.querySelector("[data-complete-seat-image-preview]");
    if (!button) return;
    button.onclick = function () {
      var state = app.state.get();
      var config = state.activeConfiguredSeat || {};
      app.utils.openCompleteSeatImagePreview({
        imageReference: getCompleteSeatImageReference(),
        programme: state.program && (state.program.programCode || state.program.name),
        customer: config.customer || config.brand,
        seatType: config.seatType || config.seatFamily,
        finishedGoodVariant: config.code || config.variantCode || config.name || config.id,
        side: config.side,
        grade: config.grade,
        trimMaterial: config.trimMaterial || "",
        revision: state.currentRevision,
        generationStatus: currentStructure ? currentStructure.generationStatus : "NOT_GENERATED",
        generatedAt: currentStructure && currentStructure.generatedAt ? app.utils.formatDate(currentStructure.generatedAt) : ""
      });
    };
  }

  function bindAction(container, action, handler) {
    var button = container.querySelector('[data-action="' + action + '"]');
    if (button) button.onclick = handler;
  }

  function expandGeneratedRoots() {
    var structure = app.domain.engineeringProductStructureService.getEngineeringProductStructureForContext();
    if (!structure) return;
    expandedNodeIds = (structure.items || []).filter(function (item) {
      return !item.parentGeneratedItemId || item.parentGeneratedItemId.indexOf("-ROOT") !== -1;
    }).map(function (item) {
      return item.id;
    });
  }

  function openSelectedModule(container) {
    var selected = container.querySelector("tr.selected");
    if (!selected) return;
    var moduleKey = selected.getAttribute("data-module-key");
    if (moduleKey) app.router.navigate(moduleKey);
  }

  function filterRows(container) {
    var filter = container.querySelector("[data-complete-seat-filter]");
    var term = filter ? filter.value.toLowerCase() : "";
    container.querySelectorAll("[data-eps-node]").forEach(function (row) {
      row.hidden = row.textContent.toLowerCase().indexOf(term) === -1;
    });
  }

  function toggleNode(id) {
    expandedNodeIds = isExpanded(id)
      ? expandedNodeIds.filter(function (nodeId) { return nodeId !== id; })
      : expandedNodeIds.concat(id);
  }

  function isExpanded(id) {
    return expandedNodeIds.indexOf(id) !== -1;
  }

  function findRow(id) {
    return currentRows.find(function (row) {
      return row.id === id;
    });
  }

  function markSelected(container, row) {
    container.querySelectorAll("tr.selected").forEach(function (selected) {
      selected.classList.remove("selected");
    });
    row.classList.add("selected");
  }

  function indexById(collection) {
    var index = {};
    (collection || []).forEach(function (item) {
      index[item.id] = item;
    });
    return index;
  }

  function moduleKeyFromModuleCode(code) {
    var normalized = app.domain.engineeringModuleService.normalizeCode(code);
    if (normalized === "HEAD_REST") return "headrest";
    if (normalized === "ARM_REST") return "armrest";
    return normalized.toLowerCase();
  }

  function getConfigurationLabel(config) {
    return [config.seatFamily, config.brand, config.side, config.grade, config.trimMaterial].filter(Boolean).join(" / ");
  }
})(window.DEP = window.DEP || {});
