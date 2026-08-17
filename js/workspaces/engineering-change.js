(function (app) {
  var selectedChangeId = null;
  var activeTab = "summary";
  var pendingAffectedObject = null;
  var recalculating = false;
  var operationMessage = null;

  app.workspaces = app.workspaces || {};
  app.workspaces.engineeringChange = {
    prepareAffectedObject: function (affected) {
      pendingAffectedObject = affected ? Object.assign({}, affected) : null;
      selectedChangeId = null;
      activeTab = "summary";
    }
  };

  app.router.register("engineering-change", {
    render: function (state) {
      var changes = getChanges();
      if (selectedChangeId && !changes.some(function (change) { return change.id === selectedChangeId; })) selectedChangeId = null;
      if (!selectedChangeId && changes.length) selectedChangeId = changes[0].id;
      return renderWorkspace(state, changes, getSelectedChange());
    },
    afterRender: function (container) {
      bindWorkspace(container);
      var selected = getSelectedChange();
      if (selected) selectChange(selected);
      if (selected && selected.impactTrackingEnabled && !selected.impactLastCalculatedAt && !recalculating) {
        recalculating = true;
        setTimeout(function () {
          try {
            app.domain.engineeringChangeService.recalculateEngineeringChangeImpact(selected.id, { reason: "WORKSPACE_OPENED" });
          } finally {
            recalculating = false;
            if (app.state.getCurrentWorkspace() === "engineering-change") app.router.render();
          }
        }, 0);
      }
    }
  });

  app.events.on("commercial-assessment:saved", refreshIfOpen);
  app.events.on("engineering-product-structure:generated", refreshIfOpen);
  app.events.on("engineering-module:saved", refreshIfOpen);

  function refreshIfOpen() {
    if (app.state.getCurrentWorkspace() !== "engineering-change" || recalculating) return;
    var selected = getSelectedChange();
    if (selected && selected.impactTrackingEnabled) {
      try {
        app.domain.engineeringChangeService.recalculateEngineeringChangeImpact(selected.id, { reason: "DEPENDENCY_UPDATED" });
      } catch (error) {
        notify(error, "Engineering Change impact could not be refreshed.");
      }
    }
    app.router.render();
  }

  function renderWorkspace(state, changes, selected) {
    var readiness = selected && selected.implementationReadiness || { ready: false, checks: [], blockingErrors: [] };
    return [
      app.utils.renderWorkspaceHeader({
        title: "Engineering Change",
        status: selected ? selected.status : "No Change Selected",
        statusTitle: selected ? "Lifecycle status for " + selected.changeNumber : "",
        actions: getActions(selected, readiness)
      }),
      '<div class="workspace-body"><div class="placeholder-panel ecn-workspace" data-selected-ecn="' + escape(selected && selected.id || "") + '">',
      renderEditors(state),
      renderOperationMessage(),
      '<div class="ecn-list-toolbar"><input type="search" placeholder="Search ECN Number, title, owner or status" data-change-filter></div>',
      renderChangeTable(changes),
      selected ? renderSelectedChange(state, selected) : app.utils.renderEmptyState("No Engineering Change selected", "Create an ECN to begin controlled change implementation."),
      '</div></div>'
    ].join("");
  }

  function getActions(change, readiness) {
    if (!change) return [{ id: "create-change", label: "Create ECN", primary: true }];
    var actions = [{ id: "create-change", label: "Create ECN" }];
    if (["DRAFT", "SUBMITTED", "APPROVED", "IMPLEMENTING"].indexOf(change.status) !== -1) {
      actions.push({ id: "add-change-comment", label: "Add Comment" });
    }
    if (change.status === "DRAFT") {
      actions.push({ id: "add-affected-object", label: "Add Affected Object" });
      actions.push({ id: "edit-change", label: "Edit" });
      actions.push({ id: "submit-change", label: "Submit", primary: true });
      actions.push({ id: "cancel-change", label: "Cancel", destructive: true });
    } else if (change.status === "SUBMITTED") {
      actions.push({ id: "approve-change", label: "Approve", primary: true });
      actions.push({ id: "reject-change", label: "Reject", destructive: true });
      actions.push({ id: "cancel-change", label: "Cancel", destructive: true });
    } else if (change.status === "APPROVED") {
      actions.push({ id: "start-implementation", label: "Start Implementation", primary: true });
    } else if (change.status === "IMPLEMENTING") {
      actions.push({ id: "review-engineering-impact", label: "Review Engineering Impact" });
      if ((change.commodityImpact || []).length) actions.push({ id: "review-commodity-impact", label: "Review Commodity Impact" });
      actions.push({
        id: "complete-implementation",
        label: "Complete Implementation",
        primary: true,
        disabled: !readiness.ready,
        title: readiness.ready ? "Completes implementation." : readinessMessage(readiness)
      });
    } else if (change.status === "IMPLEMENTED") {
      if (change.resultingRevisionId) actions.push({ id: "view-resulting-revision", label: "View Resulting Revision", primary: true });
      else actions.push({ id: "create-resulting-revision", label: "Create Released Revision", primary: true });
    }
    return actions;
  }

  function renderEditors(state) {
    var pending = pendingAffectedObject || {};
    var affectedType = pending.objectType || "PART";
    return [
      '<form class="ecn-editor" data-change-editor hidden>',
      '<input type="hidden" data-field="id"><input type="hidden" data-field="mode" value="create">',
      '<label>ECN Number<input type="text" data-field="changeNumber" required></label>',
      '<label>Title<input type="text" data-field="title" required></label>',
      '<label>Reason<input type="text" data-field="reason" required></label>',
      '<label>Description<input type="text" data-field="description"></label>',
      '<label>Priority<select data-field="priority"><option>LOW</option><option selected>MEDIUM</option><option>HIGH</option><option>CRITICAL</option></select></label>',
      '<label>Owner<input type="text" data-field="owner" required></label>',
      '<label>Expected Commercial Impact<input type="text" data-field="commercialImpact"></label>',
      '<label>Engineering Impact<input type="text" data-field="engineeringImpact"></label>',
      '<button type="submit" class="primary">Save ECN</button><button type="button" data-action="close-change-editor">Close Form</button>',
      '</form>',
      '<form class="ecn-editor ecn-affected-editor" data-affected-editor hidden>',
      '<label for="ecn-affected-type">Object Type<select id="ecn-affected-type" data-field="objectType">', affectedTypeOptions(affectedType), '</select></label>',
      '<label for="ecn-affected-filter">Find Object<input id="ecn-affected-filter" type="search" data-field="objectFilter" placeholder="Part number, description or discipline" autocomplete="off"><span class="ecn-search-help" data-affected-search-help>Enter at least 2 characters to find a Part or occurrence.</span></label>',
      '<label for="ecn-affected-object" class="ecn-object-target">Affected Object<select id="ecn-affected-object" data-field="objectId" required>', affectedObjectOptions(state, affectedType, pending.objectId), '</select></label>',
      '<label for="ecn-affected-action">Action<select id="ecn-affected-action" data-field="action"><option>MODIFY</option><option>ADD</option><option>REMOVE</option><option>REPLACE</option></select></label>',
      '<label for="ecn-affected-impact">Impact<input id="ecn-affected-impact" type="text" data-field="impact" value="' + escape(pending.impact || "") + '"></label>',
      '<label for="ecn-affected-disposition">Disposition<select id="ecn-affected-disposition" data-field="disposition"><option>AFFECTED</option><option>UNDER_REVIEW</option></select></label>',
      '<div class="form-validation" data-affected-error aria-live="polite"></div>',
      '<button type="submit" class="primary">Add Affected Object</button><button type="button" data-action="close-affected-editor">Cancel</button>',
      '</form>',
      '<form class="ecn-comment-editor" data-comment-editor hidden>',
      '<label>Comment<input type="text" data-field="comment" required placeholder="Add an Engineering or Commodity review comment"></label>',
      '<button type="submit" class="primary">Add Comment</button><button type="button" data-action="close-comment-editor">Close Form</button>',
      '</form>'
    ].join("");
  }

  function renderOperationMessage() {
    if (!operationMessage) return "";
    return '<div class="ecn-operation-message ' + escape(operationMessage.type) + '" role="status">' + escape(operationMessage.text) + '</div>';
  }

  function affectedTypeOptions(selected) {
    return [
      ["PART", "Part"],
      ["ENGINEERING_BOM", "Engineering BOM"],
      ["ENGINEERING_BOM_ITEM", "Engineering BOM Item"],
      ["ENGINEERING_PRODUCT_STRUCTURE", "Complete Seat JIT"],
      ["ENGINEERING_PRODUCT_STRUCTURE_ITEM", "Complete Seat Item"],
      ["COMMERCIAL_ASSESSMENT", "Commercial Assessment"],
      ["COMMERCIAL_LINE", "Commercial Line"]
    ].map(function (entry) {
      return '<option value="' + entry[0] + '"' + (selected === entry[0] ? " selected" : "") + '>' + entry[1] + '</option>';
    }).join("");
  }

  function affectedObjectOptions(state, objectType, selectedId, filterText) {
    var choices = getAffectedObjectChoices(state, objectType);
    var filter = String(filterText || "").trim().toLowerCase();
    if (requiresAffectedSearch(objectType) && filter.length < 2 && !selectedId) {
      return '<option value="">Enter at least 2 characters to find an object</option>';
    }
    if (filter) {
      choices = choices.filter(function (choice) {
        return choice.searchText.indexOf(filter) !== -1;
      });
    }
    choices = choices.slice(0, 100);
    var placeholder = choices.length ? "Select an affected object" : "No objects available for this context";
    return '<option value="">' + placeholder + '</option>' + choices.map(function (choice) {
      return '<option value="' + escape(choice.id) + '"' + (choice.id === selectedId ? " selected" : "") + '>' + escape(choice.label) + '</option>';
    }).join("");
  }

  function requiresAffectedSearch(objectType) {
    return ["PART", "ENGINEERING_BOM_ITEM", "ENGINEERING_PRODUCT_STRUCTURE_ITEM", "COMMERCIAL_LINE"].indexOf(objectType) !== -1;
  }

  function getAffectedObjectChoices(state, objectType) {
    // Workspace state is a rendering projection and intentionally omits Parts and eBOMs.
    // Resolve affected-object choices from the authoritative AppState snapshot.
    state = app.core.appState.getState();
    var context = app.core.contextService.getContext();
    var selectedChange = getSelectedChange();
    var programId = selectedChange && selectedChange.programId || context.activeProgramId;
    var variantId = selectedChange && selectedChange.seatVariantId || context.activeSeatVariantId;
    var partsById = indexById(state.parts || []);
    var modulesById = indexById(state.engineeringModules || []);
    var boms = (state.engineeringBoms || []).filter(function (bom) {
      return bom.programId === programId && bom.seatVariantId === variantId;
    });
    var structures = (state.engineeringProductStructures || []).filter(function (structure) {
      return structure.programId === programId && structure.seatVariantId === variantId;
    });
    var assessments = (state.commercialAssessments || []).filter(function (assessment) {
      return assessment.programId === programId && assessment.seatVariantId === variantId;
    });
    var choices = [];

    if (objectType === "PART") {
      var partIds = {};
      boms.forEach(function (bom) {
        if (bom.rootPartId) partIds[bom.rootPartId] = moduleName(modulesById[bom.engineeringModuleId]);
        (bom.items || []).forEach(function (item) {
          if (item.childPartId) partIds[item.childPartId] = moduleName(modulesById[bom.engineeringModuleId]);
          if (item.parentPartId) partIds[item.parentPartId] = moduleName(modulesById[bom.engineeringModuleId]);
        });
      });
      structures.forEach(function (structure) {
        (structure.items || []).forEach(function (item) {
          if (item.partId && !partIds[item.partId]) partIds[item.partId] = "Complete Seat JIT";
        });
      });
      choices = Object.keys(partIds).map(function (partId) {
        var part = partsById[partId];
        if (!part) return null;
        return choice(part.id, [part.partNumber || part.id, part.description || part.name, partIds[partId]].filter(Boolean).join(" - "));
      }).filter(Boolean);
    } else if (objectType === "ENGINEERING_BOM") {
      choices = boms.map(function (bom) {
        return choice(bom.id, [moduleName(modulesById[bom.engineeringModuleId]) + " eBOM", bom.id, label(bom.completionStatus || "IN_PROGRESS")].join(" - "));
      });
    } else if (objectType === "ENGINEERING_BOM_ITEM") {
      boms.forEach(function (bom) {
        var discipline = moduleName(modulesById[bom.engineeringModuleId]);
        (bom.items || []).forEach(function (item) {
          var part = partsById[item.childPartId] || {};
          choices.push(choice(item.id, [discipline, part.partNumber || item.childPartId || item.id, part.description || part.name, "eBOM item " + item.id].filter(Boolean).join(" - ")));
        });
      });
    } else if (objectType === "ENGINEERING_PRODUCT_STRUCTURE") {
      choices = structures.map(function (structure) {
        return choice(structure.id, ["Complete Seat JIT", structure.generationStatus || structure.lifecycleStatus, structure.id].filter(Boolean).join(" - "));
      });
    } else if (objectType === "ENGINEERING_PRODUCT_STRUCTURE_ITEM") {
      structures.forEach(function (structure) {
        (structure.items || []).forEach(function (item) {
          var part = partsById[item.partId] || {};
          choices.push(choice(item.id, [part.partNumber || item.sourcePartSnapshot && item.sourcePartSnapshot.partNumber || "Generated item", part.description || part.name || item.sourcePartSnapshot && item.sourcePartSnapshot.description, item.path].filter(Boolean).join(" - ")));
        });
      });
    } else if (objectType === "COMMERCIAL_ASSESSMENT") {
      choices = assessments.map(function (assessment) {
        return choice(assessment.id, ["Commercial Assessment", assessment.generationStatus || assessment.lifecycleStatus, assessment.id].filter(Boolean).join(" - "));
      });
    } else if (objectType === "COMMERCIAL_LINE") {
      assessments.forEach(function (assessment) {
        (assessment.lineItems || []).forEach(function (lineItem) {
          var part = partsById[lineItem.partId] || {};
          choices.push(choice(lineItem.id, [part.partNumber || lineItem.partNumber || lineItem.id, part.description || part.name || lineItem.partDescription, lineItem.supplier || "Commercial line"].filter(Boolean).join(" - ")));
        });
      });
    }

    return choices.sort(function (a, b) { return a.label.localeCompare(b.label); });
  }

  function choice(id, choiceLabel) {
    var text = String(choiceLabel || id || "");
    return { id: id, label: text, searchText: (text + " " + id).toLowerCase() };
  }

  function indexById(items) {
    return (items || []).reduce(function (index, item) {
      if (item && item.id) index[item.id] = item;
      return index;
    }, {});
  }

  function moduleName(module) {
    return module && (module.name || module.code) || "Engineering";
  }

  function renderChangeTable(changes) {
    return '<div class="ecn-list-wrap"><table class="engineering-table ecn-table"><thead><tr>' +
      '<th>ECN Number</th><th>Title</th><th>Priority</th><th>Status</th><th>Owner</th><th>Requested By</th><th>Updated</th><th>Affected</th><th>Commodity Delta</th>' +
      '</tr></thead><tbody>' + (changes.length ? changes.map(function (change) {
        return '<tr data-change-id="' + escape(change.id) + '"' + (change.id === selectedChangeId ? ' class="selected"' : "") + '>' +
          cell(change.changeNumber) + cell(change.title) + cell(change.priority) + cell(change.status) + cell(change.owner) +
          cell(change.requester || change.requestedBy) + cell(formatDateTime(change.updatedAt)) + cell((change.affectedObjects || []).length) +
          cell(formatDelta(change.commercialImpactSummary && change.commercialImpactSummary.totalsByCurrency)) + '</tr>';
      }).join("") : '<tr><td colspan="9">No Engineering Changes for this Finished-Good Variant.</td></tr>') + '</tbody></table></div>';
  }

  function renderSelectedChange(state, change) {
    var tabs = buildTabs(change);
    if (!tabs.some(function (tab) { return tab.id === activeTab; })) activeTab = tabs[0].id;
    return [
      '<div class="ecn-tabs" role="tablist">',
      tabs.map(function (tab) {
        return '<button type="button" class="tab-button' + (tab.id === activeTab ? " active" : "") + '" data-ecn-tab="' + tab.id + '">' + escape(tab.label) + '</button>';
      }).join(""),
      '</div>',
      '<section class="ecn-tab-content">',
      renderTab(state, change, activeTab),
      '</section>'
    ].join("");
  }

  function buildTabs(change) {
    var tabs = [{ id: "summary", label: "Change Summary" }];
    if ((change.affectedObjects || []).length) tabs.push({ id: "affected", label: "Affected Objects" });
    if ((change.commodityImpact || []).length) {
      tabs.push({ id: "commodity", label: "Commodity Impact" });
      tabs.push({ id: "supplier", label: "Supplier and Cost Impact" });
    }
    if (change.impactTrackingEnabled && ["APPROVED", "IMPLEMENTING", "IMPLEMENTED"].indexOf(change.status) !== -1) {
      tabs.push({ id: "readiness", label: "Implementation Readiness" });
    }
    if (change.resultingRevisionId) tabs.push({ id: "revision", label: "Resulting Revision" });
    return tabs;
  }

  function renderTab(state, change, tab) {
    if (tab === "affected") return renderAffected(change);
    if (tab === "commodity") return renderCommodityImpact(change);
    if (tab === "supplier") return renderSupplierImpact(change);
    if (tab === "readiness") return renderReadiness(change);
    if (tab === "revision") return renderResultingRevision(change);
    return renderSummary(state, change);
  }

  function renderSummary(state, change) {
    var program = (state.programs || []).find(function (item) { return item.id === change.programId; }) || {};
    var variant = (state.seatVariants || []).find(function (item) { return item.id === change.seatVariantId; }) || {};
    var disciplines = unique((change.affectedObjects || []).map(function (item) { return item.sourceDiscipline; }).filter(Boolean));
    var impact = change.commercialImpactSummary || {};
    return [
      '<table class="engineering-table ecn-summary-table"><tbody>',
      summarySection("Change"),
      summaryRow("ECN Number", change.changeNumber, "Status", label(change.status)),
      summaryRow("Title", change.title, "Priority", label(change.priority)),
      summaryRow("Reason", change.reason, "Owner", change.owner),
      summaryRow("Requested By", change.requester || change.requestedBy, "Created", formatDateTime(change.createdAt)),
      summarySection("Product Context"),
      summaryRow("Programme", program.programCode || program.name || change.programId, "Customer / OEM", variant.customer || variant.brand),
      summaryRow("Seat Type", variant.seatType || variant.seatFamily, "Finished-Good Variant", variant.variantCode || variant.code || change.seatVariantId),
      summarySection("Impact and Release"),
      summaryRow("Affected Disciplines", disciplines.length, "Affected Commodities", impact.commodityCount || 0),
      summaryRow("Affected Suppliers", impact.supplierCount || 0, "Total Cost Delta", formatDelta(impact.totalsByCurrency)),
      summaryRow("Approved", formatDateTime(change.approvedAt), "Implemented", formatDateTime(change.implementedAt)),
      summaryRow("Resulting Revision", change.resultingRevisionId || "-", "Last Updated", formatDateTime(change.updatedAt)),
      '</tbody></table>',
      renderComments(change)
    ].join("");
  }

  function summarySection(title) {
    return '<tr class="ecn-summary-section"><th colspan="4">' + escape(title) + '</th></tr>';
  }

  function summaryRow(labelOne, valueOne, labelTwo, valueTwo) {
    return '<tr><th scope="row">' + escape(labelOne) + '</th><td>' + escape(valueOne == null || valueOne === "" ? "-" : valueOne) +
      '</td><th scope="row">' + escape(labelTwo) + '</th><td>' + escape(valueTwo == null || valueTwo === "" ? "-" : valueTwo) + '</td></tr>';
  }

  function renderAffected(change) {
    return '<table class="engineering-table related-table"><thead><tr><th>Type</th><th>Part Number</th><th>Part Description</th><th>Discipline</th><th>Source Sheet</th><th>Source Row</th><th>Action</th><th>Impact</th><th>Disposition</th><th>Stable ID</th><th></th></tr></thead><tbody>' +
      (change.affectedObjects || []).map(function (affected) {
        var display = resolveAffectedDisplay(affected);
        return '<tr>' + cell(label(affected.objectType)) + cell(display.partNumber) + cell(display.partDescription) + cell(display.discipline) +
          cell(display.sourceSheet) + cell(display.sourceRow) + cell(affected.action) + cell(affected.impact) + cell(affected.disposition) + cell(affected.objectId) +
          '<td>' + (change.status === "DRAFT" ? '<button type="button" data-remove-affected="' + escape(affected.objectType + "|" + affected.objectId) + '">Remove</button>' : "") + '</td></tr>';
      }).join("") + '</tbody></table>';
  }

  function resolveAffectedDisplay(affected) {
    var state = app.core.appState.getState();
    var parts = indexById(state.parts || []);
    var modules = indexById(state.engineeringModules || []);
    var bom = null;
    var bomItem = null;
    var epsItem = null;
    var lineItem = null;
    (state.engineeringBoms || []).some(function (candidate) {
      if (candidate.id === affected.objectId || candidate.id === affected.sourceBomId) bom = candidate;
      var found = (candidate.items || []).find(function (item) {
        return item.id === affected.objectId || item.id === affected.sourceBomItemId;
      });
      if (found) { bom = candidate; bomItem = found; }
      return Boolean(found);
    });
    (state.engineeringProductStructures || []).some(function (structure) {
      epsItem = (structure.items || []).find(function (item) { return item.id === affected.objectId; }) || null;
      return Boolean(epsItem);
    });
    (state.commercialAssessments || []).some(function (assessment) {
      lineItem = (assessment.lineItems || []).find(function (line) {
        return line.id === affected.objectId || line.id === affected.commercialLineId;
      }) || null;
      return Boolean(lineItem);
    });
    var partId = affected.objectType === "PART" ? affected.objectId : affected.partId || bomItem && bomItem.childPartId || epsItem && epsItem.partId || lineItem && lineItem.partId;
    var part = parts[partId] || {};
    var snapshot = epsItem && epsItem.sourcePartSnapshot || lineItem && lineItem.sourcePartSnapshot || {};
    var source = bomItem || part;
    var partSource = firstPartSource(part);
    return {
      partNumber: part.partNumber || snapshot.partNumber || lineItem && lineItem.partNumber || "-",
      partDescription: part.description || part.name || snapshot.description || lineItem && lineItem.partDescription || "-",
      discipline: affected.sourceDiscipline || moduleName(modules[bom && bom.engineeringModuleId || epsItem && epsItem.sourceEngineeringModuleId || part.engineeringModuleId]),
      sourceSheet: source.sourceWorkbookSheet || part.sourceWorkbookSheet || partSource.sheet || "-",
      sourceRow: source.sourceWorkbookRow || part.sourceWorkbookRow || partSource.row || "-"
    };
  }

  function firstPartSource(part) {
    var references = part && Array.isArray(part.sourceWorkbookRows) ? part.sourceWorkbookRows : [];
    var reference = references.find(function (item) { return item && (item.sheet || item.row); }) || {};
    var sheets = part && Array.isArray(part.sourceWorkbookSheets) ? part.sourceWorkbookSheets : [];
    return {
      sheet: reference.sheet || sheets[0] || "",
      row: reference.row || ""
    };
  }

  function renderCommodityImpact(change) {
    return renderCommercialReviewAction(change) + '<table class="engineering-table ecn-impact-table"><thead><tr><th>Commodity</th><th>Part Number</th><th>Discipline</th><th>Manager</th><th>STA</th><th>Status</th><th>Previous Qty</th><th>Current Qty</th><th>Previous Rate</th><th>Current Rate</th><th>Currency</th><th>Cost Delta</th></tr></thead><tbody>' +
      (change.commodityImpact || []).map(function (impact) {
        return '<tr>' + cell(impact.commodity) + cell(impact.partNumber) + cell(impact.sourceDiscipline) + cell(impact.commodityManager) + cell(impact.sta) +
          cell(label(impact.impactStatus)) + cell(formatNumber(impact.previousQuantity)) + cell(formatNumber(impact.currentQuantity)) +
          cell(formatMoney(impact.previousUnitRate, impact.previousCurrency || impact.currency)) + cell(formatMoney(impact.currentUnitRate, impact.currency)) +
          cell(impact.mixedCurrency ? (impact.previousCurrency + " -> " + impact.currency) : impact.currency) +
          cell(impact.costDelta === null ? "Mixed currency" : formatMoney(impact.costDelta, impact.currency || impact.previousCurrency)) + '</tr>';
      }).join("") + '</tbody></table>';
  }

  function renderSupplierImpact(change) {
    return renderCommercialReviewAction(change) + '<table class="engineering-table ecn-impact-table"><thead><tr><th>Part Number</th><th>Commodity</th><th>Supplier</th><th>Supplier Part</th><th>Sourcing</th><th>Commercial</th><th>Previous Piece Cost</th><th>Current Piece Cost</th><th>Tooling Delta</th><th>Logistics Delta</th></tr></thead><tbody>' +
      (change.commodityImpact || []).map(function (impact) {
        return '<tr>' + cell(impact.partNumber) + cell(impact.commodity) + cell(impact.supplier) + cell(impact.supplierPartNumber) +
          cell(label(impact.sourcingStatus)) + cell(label(impact.commercialStatus)) +
          cell(formatMoney(impact.previousPieceCost, impact.previousCurrency || impact.currency)) +
          cell(formatMoney(impact.currentPieceCost, impact.currency)) + cell(formatMoney(impact.toolingDelta, impact.currency)) +
          cell(formatMoney(impact.logisticsDelta, impact.currency)) + '</tr>';
      }).join("") + '</tbody></table>';
  }

  function renderReadiness(change) {
    var readiness = change.implementationReadiness || { ready: false, checks: [] };
    var commercialBlocked = (change.commodityImpact || []).some(function (impact) {
      return impact.impactStatus !== "COMMERCIAL_COMPLETE" && impact.impactStatus !== "OBSOLETE";
    });
    return [
      '<div class="ecn-readiness-summary ' + (readiness.ready ? "ready" : "blocked") + '"><strong>' +
      (readiness.ready ? "Implementation is ready to complete." : "Implementation is not ready.") + '</strong>' +
      (!readiness.ready ? '<span>' + escape(readinessMessage(readiness)) + '</span>' : "") +
      renderReadinessAction(readiness, commercialBlocked) + '</div>',
      '<table class="engineering-table related-table"><thead><tr><th>Condition</th><th>Status</th><th>Required Action</th><th>Related Object</th></tr></thead><tbody>',
      (readiness.checks || []).map(function (check) {
        return '<tr>' + cell(check.condition) + '<td>' + app.utils.renderStatusBadge(check.status) + '</td>' +
          cell(check.blockingMessage) + cell([check.objectType, check.objectId].filter(Boolean).join(": ")) + '</tr>';
      }).join(""),
      '</tbody></table>'
    ].join("");
  }

  function renderReadinessAction(readiness, commercialBlocked) {
    var blockedIds = (readiness.checks || []).filter(function (check) { return check.status === "BLOCKED"; }).map(function (check) { return check.id; });
    if (blockedIds.indexOf("EPS_CURRENT") !== -1) return '<button type="button" data-action="open-complete-seat">Open Complete Seat JIT</button>';
    if (blockedIds.indexOf("COMMERCIAL_CURRENT") !== -1) return '<button type="button" data-action="open-commercial-assessment">Open Commercial Assessment</button>';
    if (commercialBlocked) return '<button type="button" data-action="open-commercial-review">Open Affected Commercial Line</button>';
    return "";
  }

  function renderCommercialReviewAction(change) {
    var blocked = (change.commodityImpact || []).filter(function (impact) {
      return impact.impactStatus !== "COMMERCIAL_COMPLETE" && impact.impactStatus !== "OBSOLETE";
    });
    if (!blocked.length) return "";
    return '<div class="ecn-review-actions"><span>' + escape(blocked.length + " affected commercial line(s) require Supplier or Price review.") + '</span>' +
      '<button type="button" data-action="open-commercial-review">Open Commercial Assessment</button></div>';
  }

  function renderResultingRevision(change) {
    var revision = app.domain.revisionService.getRevision(change.resultingRevisionId);
    if (!revision) return app.utils.renderEmptyState("Resulting Revision is unavailable", "The linked Revision record could not be resolved.");
    return '<table class="engineering-table related-table"><tbody>' +
      pair("Revision", revision.revisionNumber) + pair("Revision ID", revision.id) + pair("ECN Number", change.changeNumber) +
      pair("Released", formatDateTime(revision.releasedAt)) + pair("Released By", revision.releasedBy) +
      pair("Snapshot Hash", revision.snapshotHash) + '</tbody></table>';
  }

  function renderComments(change) {
    if (!(change.comments || []).length) return "";
    return '<h2 class="compact-section-title">Comments</h2><table class="engineering-table related-table"><thead><tr><th>Timestamp</th><th>By</th><th>Comment</th></tr></thead><tbody>' +
      change.comments.map(function (comment) { return '<tr>' + cell(formatDateTime(comment.createdAt)) + cell(comment.createdBy) + cell(comment.text) + '</tr>'; }).join("") +
      '</tbody></table>';
  }

  function bindWorkspace(container) {
    container.querySelectorAll("[data-change-id]").forEach(function (row) {
      row.onclick = function () {
        selectedChangeId = row.getAttribute("data-change-id");
        activeTab = "summary";
        app.state.clearSelection();
        app.router.render();
      };
    });
    var filter = container.querySelector("[data-change-filter]");
    if (filter) filter.oninput = function () {
      var term = String(filter.value || "").toLowerCase();
      container.querySelectorAll("[data-change-id]").forEach(function (row) {
        row.hidden = row.textContent.toLowerCase().indexOf(term) === -1;
      });
    };
    container.querySelectorAll("[data-ecn-tab]").forEach(function (button) {
      button.onclick = function () { activeTab = button.getAttribute("data-ecn-tab"); app.router.render(); };
    });
    bindEditors(container);
    bindActions(container);
    container.querySelectorAll("[data-remove-affected]").forEach(function (button) {
      button.onclick = function () {
        var key = button.getAttribute("data-remove-affected").split("|");
        run(function () { app.domain.engineeringChangeService.removeAffectedObject(selectedChangeId, key[0], key[1]); }, "Affected object removed.");
      };
    });
  }

  function bindEditors(container) {
    var changeEditor = container.querySelector("[data-change-editor]");
    if (changeEditor) changeEditor.onsubmit = function (event) {
      event.preventDefault();
      var input = readChangeEditor(changeEditor);
      run(function () {
        if (field(changeEditor, "mode").value === "edit") app.domain.engineeringChangeService.updateEngineeringChange(input.id, input);
        else {
          app.domain.engineeringChangeService.createEngineeringChange(input);
          selectedChangeId = input.id;
          if (pendingAffectedObject && pendingAffectedObject.objectId) {
            app.domain.engineeringChangeService.addAffectedObject(input.id, pendingAffectedObject);
            pendingAffectedObject = null;
          }
        }
      }, "Engineering Change saved.");
    };
    var affectedEditor = container.querySelector("[data-affected-editor]");
    if (affectedEditor) {
      var objectType = field(affectedEditor, "objectType");
      var objectFilter = field(affectedEditor, "objectFilter");
      var objectId = field(affectedEditor, "objectId");
      var searchHelp = affectedEditor.querySelector("[data-affected-search-help]");
      var formError = affectedEditor.querySelector("[data-affected-error]");
      function refreshAffectedChoices() {
        var selectedId = objectId.value;
        objectId.innerHTML = affectedObjectOptions(app.state.get(), objectType.value, selectedId, objectFilter.value);
        objectId.disabled = objectId.options.length <= 1;
        if (searchHelp) {
          searchHelp.textContent = requiresAffectedSearch(objectType.value) && objectFilter.value.trim().length < 2
            ? "Enter at least 2 characters to find a Part or occurrence."
            : Math.max(0, objectId.options.length - 1) + " matching object(s).";
        }
        if (formError) formError.textContent = "";
      }
      objectType.onchange = function () {
        objectFilter.value = "";
        refreshAffectedChoices();
      };
      objectFilter.oninput = refreshAffectedChoices;
      objectId.disabled = objectId.options.length <= 1;
      affectedEditor.onsubmit = function (event) {
        event.preventDefault();
        var input = {
          objectType: objectType.value,
          objectId: objectId.value,
          action: field(affectedEditor, "action").value,
          impact: field(affectedEditor, "impact").value.trim(),
          disposition: field(affectedEditor, "disposition").value
        };
        if (!input.objectId) {
          var message = requiresAffectedSearch(objectType.value) && objectFilter.value.trim().length < 2
            ? "Search with at least 2 characters, then select the affected object."
            : "Select an affected object from the active Finished-Good Variant.";
          if (formError) formError.textContent = message;
          app.services.notificationService.notify(message, "warning");
          return;
        }
        run(function () { app.domain.engineeringChangeService.addAffectedObject(selectedChangeId, input); }, "Affected object added and impact calculated.");
      };
    }
    var commentEditor = container.querySelector("[data-comment-editor]");
    if (commentEditor) commentEditor.onsubmit = function (event) {
      event.preventDefault();
      var comment = field(commentEditor, "comment").value.trim();
      run(function () { app.domain.engineeringChangeService.addComment(selectedChangeId, comment); }, "Comment added.");
    };
  }

  function bindActions(container) {
    bind(container, "create-change", function () { openChangeEditor(container, null); });
    bind(container, "edit-change", function () { openChangeEditor(container, getSelectedChange()); });
    bind(container, "add-affected-object", function () {
      var editor = container.querySelector("[data-affected-editor]");
      if (editor) {
        editor.hidden = false;
        field(editor, "objectFilter").focus();
      }
    });
    bind(container, "add-change-comment", function () {
      var editor = container.querySelector("[data-comment-editor]");
      if (editor) { editor.hidden = false; field(editor, "comment").focus(); }
    });
    bind(container, "close-change-editor", function () { container.querySelector("[data-change-editor]").hidden = true; });
    bind(container, "close-affected-editor", function () { container.querySelector("[data-affected-editor]").hidden = true; });
    bind(container, "close-comment-editor", function () { container.querySelector("[data-comment-editor]").hidden = true; });
    bind(container, "submit-change", function () { transition("submitEngineeringChange", "ECN submitted."); });
    bind(container, "approve-change", function () { transition("approveEngineeringChange", "ECN approved."); });
    bind(container, "reject-change", function () { transition("rejectEngineeringChange", "ECN rejected."); });
    bind(container, "cancel-change", function () { transition("cancelEngineeringChange", "ECN cancelled."); });
    bind(container, "start-implementation", function () { transition("startImplementation", "Implementation started and baseline captured."); });
    bind(container, "review-engineering-impact", function () { activeTab = "affected"; app.router.render(); });
    bind(container, "review-commodity-impact", function () { activeTab = "commodity"; app.router.render(); });
    bind(container, "open-commercial-review", function () { openCommercialReview(getSelectedChange()); });
    bind(container, "open-complete-seat", function () { app.router.navigate("complete-seat"); });
    bind(container, "open-commercial-assessment", function () { app.router.navigate("bom-cost"); });
    bind(container, "complete-implementation", function () { transition("completeImplementation", "ECN implementation completed."); });
    bind(container, "create-resulting-revision", function () {
      try {
        app.domain.revisionService.createRevision({ engineeringChangeId: selectedChangeId, notes: "Released from " + getSelectedChange().changeNumber });
        operationMessage = { type: "success", text: "Released Revision created." };
        app.services.notificationService.notify("Released Revision created.", "success");
        app.router.navigate("revision");
      } catch (error) {
        notify(error, "Released Revision could not be created.");
        app.router.render();
      }
    });
    bind(container, "view-resulting-revision", function () {
      app.router.navigate("revision");
    });
    var readinessTab = container.querySelector('[data-ecn-tab="readiness"]');
    if (readinessTab && getSelectedChange().status === "IMPLEMENTING") {
      var content = container.querySelector(".ecn-tab-content");
      if (content && activeTab === "readiness") {
        var selectedChange = getSelectedChange();
        var reviewActions = [];
        if (selectedChange.engineeringReviewStatus !== "COMPLETE") reviewActions.push('<button type="button" data-action="complete-engineering-review">Complete Engineering Review</button>');
        reviewActions.push('<button type="button" data-action="recalculate-impact">Recalculate Readiness</button>');
        content.insertAdjacentHTML("afterbegin", '<div class="ecn-review-actions">' + reviewActions.join("") + '</div>');
        bind(container, "complete-engineering-review", function () {
          run(function () { app.domain.engineeringChangeService.completeEngineeringReview(selectedChangeId, "Engineering impact reviewed."); }, "Engineering review completed.");
        });
        bind(container, "recalculate-impact", function () {
          run(function () { app.domain.engineeringChangeService.recalculateEngineeringChangeImpact(selectedChangeId, { reason: "USER_REQUESTED" }); }, "ECN impact recalculated.");
        });
      }
    }
  }

  function transition(operation, success) {
    run(function () { app.domain.engineeringChangeService[operation](selectedChangeId); }, success);
  }

  function openCommercialReview(change) {
    if (!change) return;
    var impact = (change.commodityImpact || []).find(function (item) {
      return item.impactStatus !== "COMMERCIAL_COMPLETE" && item.impactStatus !== "OBSOLETE";
    });
    if (!impact || !impact.commercialLineId) {
      operationMessage = { type: "warning", text: "No affected Commercial Assessment line is available. Regenerate Complete Seat JIT and Commercial Assessment, then Recalculate Impact." };
      app.router.render();
      return;
    }
    if (app.workspaces && app.workspaces.commercialAssessment && app.workspaces.commercialAssessment.prepareEcnReview) {
      app.workspaces.commercialAssessment.prepareEcnReview({
        engineeringChangeId: change.id,
        changeNumber: change.changeNumber,
        lineId: impact.commercialLineId,
        partId: impact.partId,
        partNumber: impact.partNumber,
        impactStatus: impact.impactStatus
      });
    }
    app.router.navigate("bom-cost");
  }

  function run(action, success) {
    try {
      action();
      operationMessage = success ? { type: "success", text: success } : null;
      if (success) app.services.notificationService.notify(success, "success");
      app.router.render();
    } catch (error) {
      var errors = error && (error.validationErrors || error.errors) || [];
      operationMessage = { type: "warning", text: errors[0] && errors[0].message || error && error.message || "Engineering Change operation was blocked." };
      notify(error, "Engineering Change operation was blocked.");
      app.router.render();
    }
  }

  function notify(error, fallback) {
    var errors = error && (error.validationErrors || error.errors) || [];
    app.services.notificationService.notify(errors[0] && errors[0].message || error && error.message || fallback, "warning");
  }

  function openChangeEditor(container, change) {
    var editor = container.querySelector("[data-change-editor]");
    var context = app.core.contextService.getContext();
    var number = change && change.changeNumber || "ECN-" + new Date().getFullYear() + "-" + String(getChanges().length + 1).padStart(3, "0");
    field(editor, "mode").value = change ? "edit" : "create";
    field(editor, "id").value = change && change.id || makeId(number);
    field(editor, "changeNumber").value = number;
    field(editor, "changeNumber").disabled = Boolean(change);
    field(editor, "title").value = change && change.title || "";
    field(editor, "reason").value = change && change.reason || "";
    field(editor, "description").value = change && change.description || "";
    field(editor, "priority").value = change && change.priority || "MEDIUM";
    field(editor, "owner").value = change && change.owner || "";
    field(editor, "commercialImpact").value = change && change.commercialImpact || "";
    field(editor, "engineeringImpact").value = change && change.engineeringImpact || "";
    editor.dataset.programId = context.activeProgramId || "";
    editor.dataset.seatVariantId = context.activeSeatVariantId || "";
    editor.hidden = false;
    field(editor, "title").focus();
  }

  function readChangeEditor(editor) {
    var user = app.state.get().currentUser || {};
    return {
      id: field(editor, "id").value,
      changeNumber: field(editor, "changeNumber").value.trim(),
      title: field(editor, "title").value.trim(),
      reason: field(editor, "reason").value.trim(),
      description: field(editor, "description").value.trim(),
      priority: field(editor, "priority").value,
      type: "ENGINEERING_CHANGE",
      programId: editor.dataset.programId,
      seatVariantId: editor.dataset.seatVariantId,
      requester: user.name || "Demo User",
      owner: field(editor, "owner").value.trim(),
      commercialImpact: field(editor, "commercialImpact").value.trim(),
      engineeringImpact: field(editor, "engineeringImpact").value.trim(),
      impactTrackingEnabled: true
    };
  }

  function getChanges() {
    var context = app.core.contextService.getContext();
    return app.domain.engineeringChangeService.listEngineeringChanges({
      programId: context.activeProgramId,
      seatVariantId: context.activeSeatVariantId
    }).sort(function (a, b) {
      return String(b.updatedAt || b.createdAt || "").localeCompare(String(a.updatedAt || a.createdAt || ""));
    });
  }

  function getSelectedChange() {
    return selectedChangeId && app.domain.engineeringChangeService.getEngineeringChange(selectedChangeId);
  }

  function selectChange(change) {
    app.state.setSelection({
      workspace: "engineering-change",
      type: "Engineering Change",
      id: change.id,
      name: change.title,
      status: change.status,
      ecnNumber: change.changeNumber,
      affectedObjects: (change.affectedObjects || []).map(function (item) { return item.objectType + ":" + item.objectId; }).join(", "),
      commercialImpact: formatDelta(change.commercialImpactSummary && change.commercialImpactSummary.totalsByCurrency),
      engineeringImpact: change.engineeringImpact,
      requestedBy: change.requester || change.requestedBy
    });
  }

  function readinessMessage(readiness) {
    return (readiness.blockingErrors || []).map(function (error) { return error.message; }).join(" ") || "Complete the readiness checklist.";
  }

  function renderResultLabel(value) {
    return value || "-";
  }

  function formatDelta(totals) {
    if (!totals || !totals.length) return "No cost delta";
    return totals.map(function (total) { return (total.currency || "UNSPECIFIED") + " " + Number(total.costDelta || 0).toFixed(2); }).join(" | ");
  }

  function formatMoney(value, currency) {
    return (currency || "UNSPECIFIED") + " " + Number(value || 0).toFixed(2);
  }

  function formatNumber(value) {
    return Number(value || 0).toFixed(3).replace(/0+$/, "").replace(/\.$/, "");
  }

  function formatDateTime(value) {
    return value ? String(value).replace("T", " ").slice(0, 16) : "-";
  }

  function label(value) {
    return String(value || "").toLowerCase().replace(/(^|_)([a-z])/g, function (_, prefix, letter) { return (prefix ? " " : "") + letter.toUpperCase(); });
  }

  function unique(values) {
    var seen = {};
    return values.filter(function (value) { if (seen[value]) return false; seen[value] = true; return true; });
  }

  function pair(labelText, value) {
    return '<tr><th>' + escape(labelText) + '</th><td>' + escape(value == null || value === "" ? "-" : value) + '</td></tr>';
  }

  function cell(value) {
    return '<td>' + escape(value == null || value === "" ? "-" : value) + '</td>';
  }

  function bind(container, action, handler) {
    var button = container.querySelector('[data-action="' + action + '"]');
    if (button) button.onclick = handler;
  }

  function field(form, name) {
    return form.querySelector('[data-field="' + name + '"]');
  }

  function makeId(value) {
    return String(value || "").toUpperCase().replace(/[^A-Z0-9]+/g, "-").replace(/^-|-$/g, "");
  }

  function escape(value) {
    return app.utils.escapeHtml(value == null ? "" : String(value));
  }
})(window.DEP = window.DEP || {});
