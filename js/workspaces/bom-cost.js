(function (app) {
  var currentRollup = null;
  var currentAssessment = null;
  var ecnReviewContext = null;

  app.workspaces = app.workspaces || {};
  app.workspaces.commercialAssessment = {
    prepareEcnReview: function (context) {
      ecnReviewContext = context ? Object.assign({}, context, {
        seatVariantId: app.core.contextService.getContext().activeSeatVariantId
      }) : null;
    }
  };

  app.router.register("bom-cost", {
    render: function (state) {
      currentAssessment = hasCommercialService() ? app.domain.commercialAssessmentService.getCommercialAssessmentForContext() : null;
      currentRollup = app.services.costService.calculateConfiguredSeatCost(state);
      return renderWorkspace(state, currentAssessment, currentRollup);
    },
    afterRender: function (container) {
      bindRows(container);
      bindActions(container);
    }
  });

  app.events.on("configuration:changed", refreshIfOpen);
  app.events.on("engineering-product-structure:generated", refreshIfOpen);
  app.events.on("commercial-assessment:saved", refreshIfOpen);

  function refreshIfOpen() {
    if (app.state.getCurrentWorkspace() === "bom-cost") {
      app.router.render();
    }
  }

  function renderWorkspace(state, assessment, rollup) {
    var canEdit = Boolean(assessment);
    var readiness = hasCommercialService()
      ? app.domain.commercialAssessmentService.validateGenerationInputs(app.core.appState.getState())
      : { blockingErrors: [] };
    var generationBlocked = (readiness.blockingErrors || []).length > 0;
    var context = app.core.contextService.getContext();
    if (ecnReviewContext && ecnReviewContext.seatVariantId !== context.activeSeatVariantId) ecnReviewContext = null;
    var displayLines = rollup.lines || [];
    if (ecnReviewContext && ecnReviewContext.lineId) {
      displayLines = displayLines.filter(function (line) { return line.id === ecnReviewContext.lineId; });
    }
    var actions = [];
    if (!assessment || assessment.generationStatus !== "CURRENT") {
      actions.push({
        id: "generate-commercial-assessment",
        label: assessment ? "Regenerate Assessment" : "Generate Assessment",
        primary: true,
        disabled: generationBlocked,
        title: generationBlocked ? commercialPrerequisites(readiness.blockingErrors || []).join(" ") : "Creates commercial lines from the current Complete Seat JIT."
      });
    }
    if (assessment) actions.push({
      id: "save-commercial-assessment",
      label: ecnReviewContext ? "Save Review and Return to ECN" : "Save Commercial Data",
      primary: true
    });
    return [
      app.utils.renderWorkspaceHeader({
        title: "Commercial Assessment",
        purpose: "",
        status: assessment ? assessment.generationStatus : "NOT_GENERATED",
        statusTitle: "Commercial values are owned by Purchase / Commodity Manager and never stored in engineering Parts.",
        actions: actions
      }),
      '<div class="workspace-body">',
      '<div class="placeholder-panel">',
      renderEcnReviewContext(),
      renderMessages(assessment, readiness),
      assessment ? renderSummary(rollup.summary) : "",
      assessment ? renderDetail(canEdit, displayLines) : "",
      '</div>',
      '</div>'
    ].join("");
  }

  function renderEcnReviewContext() {
    if (!ecnReviewContext) return "";
    return '<div class="ecn-commercial-review" role="status"><div><strong>' +
      app.utils.escapeHtml((ecnReviewContext.changeNumber || "ECN") + " commercial review") + '</strong><span>Part ' +
      app.utils.escapeHtml(ecnReviewContext.partNumber || ecnReviewContext.partId || "-") +
      ': enter Supplier, Currency, a positive Unit Rate, and select Quoted, Nominated, or Sourced.</span></div>' +
      '<button type="button" data-action="return-to-ecn">Return to ECN</button>' +
      '<button type="button" data-action="show-all-commercial-lines">Show All Lines</button></div>';
  }

  function renderConfigurationContext(config, assessment) {
    return [
      '<div class="configuration-bar">',
      '<span>Seat Type: <strong>' + app.utils.escapeHtml(config.seatType || config.seatFamily || "") + '</strong></span>',
      '<span>Customer / OEM: <strong>' + app.utils.escapeHtml(config.customer || config.brand || "") + '</strong></span>',
      '<span>Side: <strong>' + app.utils.escapeHtml(config.side || "") + '</strong></span>',
      '<span>Grade: <strong>' + app.utils.escapeHtml(config.grade || "") + '</strong></span>',
      '<span>Assessment: <strong>' + app.utils.escapeHtml(assessment ? assessment.generationStatus : "NOT_GENERATED") + '</strong></span>',
      '</div>'
    ].join("");
  }

  function renderMessages(assessment, readiness) {
    var messages = [];
    var prerequisites = commercialPrerequisites(readiness.blockingErrors || []);
    if (!assessment && !prerequisites.length) messages.push("No Commercial Assessment. Select Generate Assessment to create commercial lines from the current Complete Seat JIT.");
    if (assessment && assessment.generationStatus === "STALE") {
      messages.push("Commercial Assessment is stale because the generated Complete Seat has changed.");
    }
    if (assessment && assessment.generationStatus === "GENERATION_FAILED") {
      messages.push("Commercial Assessment generation failed. The last valid commercial lines are retained where available.");
    }
    if (prerequisites.length) {
      if (assessment) messages.push("Required before regeneration:");
      prerequisites.forEach(function (message) { if (messages.indexOf(message) === -1) messages.push(message); });
    }
    if (!messages.length) return "";
    return '<div class="validation-summary">' + messages.map(function (message) {
      return '<div>' + app.utils.escapeHtml(message) + '</div>';
    }).join("") + '</div>';
  }

  function commercialPrerequisites(errors) {
    var prerequisites = [];
    var has = function (code) {
      return errors.some(function (error) { return error.code === code; });
    };
    if (has("COMMERCIAL_ASSESSMENT_EPS_MISSING")) prerequisites.push("Generate the Complete Seat JIT for the selected Finished-Good Variant.");
    if (has("COMMERCIAL_ASSESSMENT_EPS_NOT_CURRENT")) prerequisites.push("Regenerate Complete Seat JIT so it is current.");
    if (has("COMMERCIAL_ASSESSMENT_CONTEXT_MISSING")) prerequisites.push("Select a Programme and Finished-Good Variant.");
    if (!prerequisites.length && errors.length) prerequisites.push("Correct the generated Complete Seat before creating commercial lines.");
    return prerequisites;
  }

  function renderSummary(summary) {
    return [
      '<div class="commercial-summary-strip" aria-label="Commercial totals">',
      summaryItem("Piece Total", formatMoney(summary.totalPartCost)),
      summaryItem("Tooling Total", formatMoney(summary.totalToolCost)),
      summaryItem("Logistics Total", formatMoney(summary.totalLogisticsCost)),
      summaryItem("Overall Total", formatMoney(summary.overallTotal)),
      summaryItem("Priced Parts", String(summary.pricedPartCount)),
      summaryItem("Unpriced Parts", String(summary.unpricedPartCount)),
      '</div>'
    ].join("");
  }

  function summaryItem(label, value) {
    return '<span class="commercial-summary-item"><span>' + app.utils.escapeHtml(label) + '</span><strong>' + app.utils.escapeHtml(value) + '</strong></span>';
  }

  function renderDetail(editable, lines) {
    if (!lines.length) {
      return '<table class="engineering-table cost-detail-table"><tbody><tr><td>' + app.utils.renderEmptyState(
        "No commercial line items",
        "Generate a current Engineering Product Structure before creating or regenerating the Commercial Assessment.",
        "Open Complete Seat JIT, generate the Complete Seat, then return here."
      ) + '</td></tr></tbody></table>';
    }
    return [
      '<table class="engineering-table cost-detail-table"><thead><tr>',
      '<th>Preview</th><th>Part Number</th><th>Part Description</th><th>Drawing Number</th><th>Revision</th><th>Change Class</th><th>Commodity</th><th>Unit Qty</th>',
      '<th>Commodity Manager</th><th>STA</th><th>Supplier</th><th>Supplier Part</th><th>PO Number</th><th>Unit Rate</th><th>Currency</th><th>PO Type</th><th>PO Qty</th><th>Schedule Given</th>',
      '<th>Extended Cost</th><th>Tooling</th><th>Logistics</th><th>Status</th><th>ECN Number</th><th>ECN Status</th><th>Impact Status</th><th>Old Unit Rate</th><th>Cost Delta</th><th>Remarks</th>',
      '</tr></thead><tbody>',
      lines.map(function (line) {
        return '<tr data-commercial-line="' + app.utils.escapeHtml(line.id || line.partNumber) + '"' +
          (ecnReviewContext && line.id === ecnReviewContext.lineId ? ' class="selected"' : '') + '>' +
          '<td class="preview-cell read-only">' + app.utils.renderPartPreviewButton(line, line.id) + '</td>' +
          readOnlyCell(line.partNumber) +
          readOnlyCell(line.description) +
          readOnlyCell(line.drawingNumber) +
          readOnlyCell(line.revision) +
          readOnlyCell(line.changeClassification) +
          readOnlyCell(line.commodity) +
          readOnlyCell(line.quantity) +
          editableCell(line, "commodityManager", editable) +
          editableCell(line, "sta", editable) +
          editableCell(line, "supplier", editable) +
          editableCell(line, "supplierPartNumber", editable) +
          editableCell(line, "poNumber", editable) +
          editableCell(line, "piecePrice", editable) +
          editableCell(line, "currency", editable) +
          editableCell(line, "poType", editable) +
          editableCell(line, "poQuantity", editable) +
          editableCell(line, "scheduleGiven", editable) +
          readOnlyCell(formatMoney(line.extendedCost || (Number(line.quantity || 0) * Number(line.piecePrice || 0)))) +
          editableCell(line, "toolingCost", editable) +
          editableCell(line, "logisticsCost", editable) +
          editableCell(line, "sourcingStatus", editable) +
          readOnlyCell(line.ecnNumber || "-") +
          readOnlyCell(line.ecnStatus || "-") +
          readOnlyCell(line.ecnImpactStatus || "NOT_IMPACTED") +
          readOnlyCell(line.previousUnitRate) +
          readOnlyCell(line.costDelta === null ? "Mixed currency" : line.costDelta) +
          editableCell(line, "notes", editable) +
          '</tr>';
      }).join(""),
      '</tbody></table>'
    ].join("");
  }

  function readOnlyCell(value) {
    return '<td class="read-only">' + app.utils.escapeHtml(value == null ? "" : value) + '</td>';
  }

  function editableCell(line, field, editable) {
    var value = line[field] == null ? "" : line[field];
    if (!editable || line.obsolete) return readOnlyCell(value);
    var attrs = ' data-commercial-field="' + field + '" data-line-id="' + app.utils.escapeHtml(line.id) + '"';
    if (field === "sourcingStatus") {
      return '<td><select' + attrs + '>' + ["NOT_SOURCED", "RFQ", "QUOTED", "NOMINATED", "SOURCED"].map(function (status) {
        return '<option value="' + status + '"' + (status === value ? " selected" : "") + '>' + label(status) + '</option>';
      }).join("") + '</select></td>';
    }
    if (field === "currency") {
      var currencies = app.data.referenceData.currencies || ["INR", "EUR", "USD"];
      return '<td><select' + attrs + '><option value="">Select</option>' + currencies.map(function (currency) {
        return '<option value="' + app.utils.escapeHtml(currency) + '"' + (currency === value ? " selected" : "") + '>' + app.utils.escapeHtml(currency) + '</option>';
      }).join("") + '</select></td>';
    }
    var numeric = ["piecePrice", "poQuantity", "toolingCost", "logisticsCost"].indexOf(field) !== -1;
    return '<td><input type="' + (numeric ? "number" : "text") + '"' + (numeric ? ' min="0" step="any"' : "") + attrs +
      ' value="' + app.utils.escapeHtml(value) + '"></td>';
  }

  function bindRows(container) {
    container.querySelectorAll("[data-commercial-line]").forEach(function (row) {
      row.onclick = function () {
        var line = findLine(row.getAttribute("data-commercial-line"));
        if (!line) return;
        container.querySelectorAll("tr.selected").forEach(function (selected) {
          selected.classList.remove("selected");
        });
        row.classList.add("selected");
        app.state.setSelection({
          type: "Commercial Line Item",
          id: line.id,
          name: line.description,
          status: line.sourcingStatus,
          referencedPartNumber: line.partNumber,
          drawingNumber: line.drawingNumber,
          drawingRevision: line.drawingRevision,
          revision: line.revision,
          commodity: line.commodity,
          quantity: line.quantity,
          engineeringProductStructureItemId: line.engineeringProductStructureItemId,
          commodityManager: line.commodityManager,
          sta: line.sta,
          supplier: line.supplier,
          supplierPartNumber: line.supplierPartNumber,
          poNumber: line.poNumber,
          poType: line.poType,
          poQuantity: line.poQuantity,
          scheduleGiven: line.scheduleGiven,
          currency: line.currency,
          piecePrice: formatMoney(line.piecePrice),
          extendedCost: formatMoney(line.extendedCost),
          toolingCost: formatMoney(line.toolingCost),
          logisticsCost: formatMoney(line.logisticsCost),
          remarks: line.notes || "Commercial Assessment line item"
        });
      };
    });
    app.utils.bindPartPreviewButtons(container, function (lineId) {
      return findLine(lineId);
    });
  }

  function bindActions(container) {
    var generate = container.querySelector('[data-action="generate-commercial-assessment"]');
    if (generate) {
      generate.onclick = function () {
        try {
          if (!hasCommercialService()) return;
          if (currentAssessment) app.domain.commercialAssessmentService.regenerateCommercialAssessment();
          else app.domain.commercialAssessmentService.generateCommercialAssessment();
          app.events.emit("commercial-assessment:saved", app.domain.commercialAssessmentService.getCommercialAssessmentForContext());
          app.services.notificationService.notify(currentAssessment ? "Commercial Assessment regenerated" : "Commercial Assessment generated", "success");
        } catch (error) {
          app.services.notificationService.notify("Commercial Assessment generation failed", "error");
          app.router.render();
        }
      };
    }
    var save = container.querySelector('[data-action="save-commercial-assessment"]');
    if (save) {
      save.onclick = function () {
        if (!hasCommercialService() || !currentAssessment) return;
        save.disabled = true;
        var reviewContext = ecnReviewContext ? Object.assign({}, ecnReviewContext) : null;
        try {
          var updates = collectLineUpdates(container);
          updates.forEach(function (entry) {
            var line = findLine(entry.lineId);
            var reviewChangeId = ecnReviewContext && ecnReviewContext.lineId === entry.lineId ? ecnReviewContext.engineeringChangeId : "";
            app.domain.commercialAssessmentService.updateCommercialLine(currentAssessment.id, entry.lineId, entry.patch,
              line && line.activeEngineeringChangeId || reviewChangeId ? { engineeringChangeId: line && line.activeEngineeringChangeId || reviewChangeId } : {});
          });
          app.events.emit("commercial-assessment:saved", app.domain.commercialAssessmentService.getCommercialAssessmentForContext());
          if (reviewContext && reviewContext.engineeringChangeId) {
            var change = app.domain.engineeringChangeService.recalculateEngineeringChangeImpact(reviewContext.engineeringChangeId, { reason: "COMMERCIAL_REVIEW_SAVED" });
            var unresolved = (change.commodityImpact || []).filter(function (impact) {
              return impact.impactStatus !== "COMMERCIAL_COMPLETE" && impact.impactStatus !== "OBSOLETE";
            });
            if (!unresolved.length) {
              app.domain.engineeringChangeService.completeCommodityReview(reviewContext.engineeringChangeId, "Affected commercial data reviewed and saved.");
              ecnReviewContext = null;
              app.services.notificationService.notify("Commercial review completed. ECN readiness was recalculated.", "success");
              app.router.navigate("engineering-change");
              return;
            }
            app.services.notificationService.notify(commercialReviewRequirement(unresolved[0]), "warning");
            app.router.render();
            return;
          }
          app.services.notificationService.notify(updates.length ? "Commercial Assessment saved" : "No commercial changes to save", updates.length ? "success" : "info");
        } catch (error) {
          save.disabled = false;
          var validation = error && (error.validationErrors || error.errors) || [];
          app.services.notificationService.notify(validation[0] && validation[0].message || error.message || "Commercial Assessment could not be saved", "warning");
        }
      };
    }
    var showAll = container.querySelector('[data-action="show-all-commercial-lines"]');
    if (showAll) {
      showAll.onclick = function () {
        ecnReviewContext = null;
        app.router.render();
      };
    }
    var returnToEcn = container.querySelector('[data-action="return-to-ecn"]');
    if (returnToEcn) returnToEcn.onclick = function () { ecnReviewContext = null; app.router.navigate("engineering-change"); };
  }

  function commercialReviewRequirement(impact) {
    if (!impact || !impact.supplier) return "Supplier is required for the affected Part before Commodity review can be completed.";
    if (!impact.currency || Number(impact.currentUnitRate || 0) <= 0) return "Currency and a positive Unit Rate are required for the affected Part.";
    return "Select Quoted, Nominated, or Sourced as the Sourcing Status for the affected Part.";
  }

  function collectLineUpdates(container) {
    var patches = {};
    container.querySelectorAll("[data-commercial-field]").forEach(function (input) {
      var lineId = input.getAttribute("data-line-id");
      var line = findLine(lineId);
      var field = input.getAttribute("data-commercial-field");
      if (line && String(line[field] == null ? "" : line[field]) === String(input.value)) return;
      patches[lineId] = patches[lineId] || {};
      patches[lineId][field] = input.value;
    });
    return Object.keys(patches).map(function (lineId) {
      return { lineId: lineId, patch: patches[lineId] };
    });
  }

  function findLine(id) {
    return (currentRollup.lines || []).find(function (line) {
      return line.id === id || line.partNumber === id;
    });
  }

  function formatMoney(value) {
    return "INR " + Number(value || 0).toFixed(2);
  }

  function label(value) {
    return String(value || "").toLowerCase().replace(/(^|_)([a-z])/g, function (_, gap, letter) {
      return (gap ? " " : "") + letter.toUpperCase();
    });
  }

  function hasCommercialService() {
    return Boolean(app.domain && app.domain.commercialAssessmentService);
  }

  var supplierConfig = {
    title: "Suppliers",
    subtitle: "View approved supplier information used by commercial workspaces",
    actions: [{ id: "search", label: "Search" }, { id: "refresh", label: "Refresh" }],
    columns: [
      { key: "id", label: "Supplier ID" },
      { key: "name", label: "Supplier Name" },
      { key: "supplierCode", label: "Code" },
      { key: "country", label: "Country" }
    ]
  };

  app.router.register("suppliers", {
    render: function (state) { return app.utils.renderWorkspaceShell(supplierConfig, state.suppliers); },
    afterRender: function (container, state) { app.utils.bindWorkspaceRows(container, state.suppliers, "Supplier", "Commodity Manager"); }
  });
})(window.DEP = window.DEP || {});
