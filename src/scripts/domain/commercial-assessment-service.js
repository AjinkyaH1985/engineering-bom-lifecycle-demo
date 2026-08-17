(function (app) {
  app.domain = app.domain || {};

  var GENERATION_STATUSES = ["NOT_GENERATED", "CURRENT", "STALE", "GENERATION_FAILED"];
  var SOURCING_STATUSES = ["NOT_SOURCED", "RFQ", "QUOTED", "NOMINATED", "SOURCED", "OBSOLETE"];
  var COMMERCIAL_STATUSES = ["NOT_STARTED", "IN_PROGRESS", "COMPLETE", "STALE", "IMPACTED_BY_ECN", "OBSOLETE"];

  function getCommercialAssessment(id) {
    return app.core.appState.getById("commercialAssessments", id);
  }

  function getCommercialAssessmentForContext(criteria) {
    criteria = criteria || {};
    if (app.domain.engineeringProductStructureService) {
      app.domain.engineeringProductStructureService.detectEngineeringProductStructureStaleness(criteria);
    }
    var context = app.core.contextService.getContext();
    var programId = criteria.programId || context.activeProgramId;
    var seatVariantId = criteria.seatVariantId || context.activeSeatVariantId;
    if (!programId || !seatVariantId) return null;
    detectCommercialAssessmentStaleness({ programId: programId, seatVariantId: seatVariantId });
    return findAssessment(app.core.appState.getState(), programId, seatVariantId);
  }

  function generateCommercialAssessment(criteria) {
    return generateOrRegenerate(criteria || {}, false);
  }

  function regenerateCommercialAssessment(criteria) {
    return generateOrRegenerate(criteria || {}, true);
  }

  function generateOrRegenerate(criteria, preserveExisting) {
    if (app.domain.engineeringProductStructureService) {
      app.domain.engineeringProductStructureService.detectEngineeringProductStructureStaleness(criteria || {});
    }
    var snapshot = app.core.appState.getState();
    var built = buildAssessment(snapshot, criteria || {}, preserveExisting);
    if (!built.readiness.generationAllowed) {
      markGenerationFailed(snapshot, built);
      throw new app.core.errors.BusinessOperationError("Commercial Assessment generation failed.", built.readiness.blockingErrors);
    }
    var assessment = built.assessment;
    return app.core.appState.transaction(function (state) {
      var index = findIndex(state.commercialAssessments, assessment.id);
      if (index === -1) state.commercialAssessments.push(assessment);
      else {
        if (isReleasedAssessment(state.commercialAssessments[index])) {
          app.core.permissionService.assertCanEdit("commercialAssessments", state.commercialAssessments[index], operationContext(state, criteria));
        }
        state.commercialAssessments[index] = Object.assign({}, state.commercialAssessments[index], assessment, {
          id: state.commercialAssessments[index].id,
          createdAt: state.commercialAssessments[index].createdAt || assessment.createdAt
        });
      }
      app.core.appState._recordAuditEvent(state, {
        objectType: "COMMERCIAL_ASSESSMENT",
        objectId: assessment.id,
        action: preserveExisting ? "COMMERCIAL_ASSESSMENT_REGENERATED" : "COMMERCIAL_ASSESSMENT_GENERATED"
      });
      recalculateContextChanges(state, assessment.programId, assessment.seatVariantId, preserveExisting ? "COMMERCIAL_ASSESSMENT_REGENERATED" : "COMMERCIAL_ASSESSMENT_GENERATED");
    });
  }

  function updateCommercialLine(assessmentId, lineId, patch, options) {
    return app.core.appState.transaction(function (state) {
      var assessment = findById(state.commercialAssessments, assessmentId);
      if (!assessment) throw notFound("COMMERCIAL_ASSESSMENT", assessmentId);
      var line = findById(assessment.lineItems || [], lineId);
      if (!line) throw notFound("COMMERCIAL_LINE_ITEM", lineId);
      if (isReleasedAssessment(assessment)) {
        var operation = operationContext(state, options);
        if (!app.core.permissionService.canModifyReleasedObject("COMMERCIAL_LINE", lineId, operation)) {
          app.core.permissionService.assertCanEdit("commercialAssessments", assessment, operation);
        }
      }
      if (patch && patch.id && patch.id !== lineId) throw immutableId("COMMERCIAL_LINE_ITEM", lineId);
      var normalizedPatch = normalizeLinePatch(patch || {});
      var changedFields = Object.keys(normalizedPatch).filter(function (field) {
        return String(line[field] == null ? "" : line[field]) !== String(normalizedPatch[field] == null ? "" : normalizedPatch[field]);
      });
      var updated = normalizeCommercialLine(Object.assign({}, line, normalizedPatch, {
        id: lineId,
        engineeringProductStructureItemId: line.engineeringProductStructureItemId,
        partId: line.partId
      }));
      updated.commercialStatus = resolveCommercialStatus(updated, normalizedPatch.commercialStatus);
      validateLine(updated, state, assessment);
      Object.assign(line, updated, {
        updatedAt: now(),
        updatedBy: state.context.activeRole || "COMMODITY_MANAGER"
      });
      assessment.totals = calculateTotals(assessment);
      assessment.generationStatus = assessment.generationStatus === "NOT_GENERATED" ? "CURRENT" : assessment.generationStatus;
      assessment.updatedAt = now();
      app.core.appState._recordAuditEvent(state, {
        objectType: "COMMERCIAL_LINE_ITEM",
        objectId: lineId,
        action: "COMMERCIAL_LINE_UPDATED",
        details: JSON.stringify({
          commercialAssessmentId: assessment.id,
          commercialLineId: lineId,
          partId: line.partId,
          changedFields: changedFields
        })
      });
      var changeId = options && (options.engineeringChangeId || options.changeId);
      if (changeId && app.domain.engineeringChangeImpactService) {
        app.domain.engineeringChangeImpactService._markAffectedObjectModifiedInState(
          state,
          changeId,
          "COMMERCIAL_LINE",
          lineId,
          changedFields
        );
        var change = (state.engineeringChanges || []).find(function (candidate) { return candidate.id === changeId; });
        if (change && line.commercialStatus === "COMPLETE") {
          app.core.appState._recordAuditEvent(state, {
            objectType: "ENGINEERING_CHANGE",
            objectId: change.id,
            action: "ECN_COMMODITY_REVIEW_LINE_COMPLETED",
            details: JSON.stringify({ changeNumber: change.changeNumber, commercialLineId: line.id, partId: line.partId, changedFields: changedFields })
          });
        }
      } else {
        recalculateContextChanges(state, assessment.programId, assessment.seatVariantId, "COMMERCIAL_LINE_UPDATED");
      }
    });
  }

  function updateSupplier(assessmentId, lineId, supplierId, supplierName, options) {
    return updateCommercialLine(assessmentId, lineId, { supplierId: supplierId, supplier: supplierName }, options);
  }

  function updatePiecePrice(assessmentId, lineId, value, options) {
    return updateCommercialLine(assessmentId, lineId, { piecePrice: value }, options);
  }

  function updateCurrency(assessmentId, lineId, value, options) {
    return updateCommercialLine(assessmentId, lineId, { currency: value }, options);
  }

  function updateQuotation(assessmentId, lineId, value, options) {
    return updateCommercialLine(assessmentId, lineId, { quotation: value }, options);
  }

  function updateToolingCost(assessmentId, lineId, value, options) {
    return updateCommercialLine(assessmentId, lineId, { toolingCost: value }, options);
  }

  function updateLogisticsCost(assessmentId, lineId, value, options) {
    return updateCommercialLine(assessmentId, lineId, { logisticsCost: value }, options);
  }

  function updateNotes(assessmentId, lineId, value, options) {
    return updateCommercialLine(assessmentId, lineId, { notes: value }, options);
  }

  function markCommercialAssessmentStale(idOrCriteria, reasons) {
    reasons = reasons || ["ENGINEERING_PRODUCT_STRUCTURE_CHANGED"];
    return app.core.appState.transaction(function (state) {
      var assessment = typeof idOrCriteria === "string"
        ? findById(state.commercialAssessments, idOrCriteria)
        : findAssessment(state, idOrCriteria && idOrCriteria.programId, idOrCriteria && idOrCriteria.seatVariantId);
      if (!assessment) return;
      if (isReleasedAssessment(assessment)) {
        app.core.permissionService.assertCanEdit("commercialAssessments", assessment, operationContext(state, typeof idOrCriteria === "object" ? idOrCriteria : {}));
      }
      if (assessment.generationStatus !== "GENERATION_FAILED") assessment.generationStatus = "STALE";
      assessment.staleReasons = reasons.slice();
      assessment.updatedAt = now();
      app.core.appState._recordAuditEvent(state, {
        objectType: "COMMERCIAL_ASSESSMENT",
        objectId: assessment.id,
        action: "COMMERCIAL_ASSESSMENT_STALE",
        details: JSON.stringify({ reasons: reasons })
      });
    });
  }

  function detectCommercialAssessmentStaleness(criteria) {
    criteria = criteria || {};
    if (app.domain.engineeringProductStructureService) {
      app.domain.engineeringProductStructureService.detectEngineeringProductStructureStaleness(criteria);
    }
    var state = app.core.appState.getState();
    var assessment = criteria.id
      ? findById(state.commercialAssessments, criteria.id)
      : findAssessment(state, criteria.programId, criteria.seatVariantId);
    if (!assessment || assessment.generationStatus === "GENERATION_FAILED") return assessment || null;
    var eps = findById(state.engineeringProductStructures, assessment.engineeringProductStructureId);
    if (!eps || eps.generationStatus !== "CURRENT") {
      return markCommercialAssessmentStale(assessment.id, ["ENGINEERING_PRODUCT_STRUCTURE_NOT_CURRENT"]);
    }
    var currentFingerprint = fingerprintEngineeringProductStructure(eps);
    if (assessment.sourceEngineeringProductStructureFingerprint !== currentFingerprint) {
      return markCommercialAssessmentStale(assessment.id, ["ENGINEERING_PRODUCT_STRUCTURE_CHANGED"]);
    }
    return assessment;
  }

  function getCommercialAssessmentTotals(assessment) {
    return calculateTotals(assessment || { lineItems: [] });
  }

  function buildAssessment(state, criteria, preserveExisting) {
    var readiness = validateGenerationInputs(state, criteria || {});
    if (!readiness.generationAllowed) return { readiness: readiness, assessment: null };
    var existing = findAssessment(state, readiness.program.id, readiness.seatVariant.id);
    var id = existing ? existing.id : makeAssessmentId(readiness.program.id, readiness.seatVariant.id);
    var lineBuild = buildLineItems(readiness.structure, existing, preserveExisting);
    var generatedAt = now();
    var assessment = normalizeCommercialAssessment({
      id: id,
      programId: readiness.program.id,
      seatVariantId: readiness.seatVariant.id,
      engineeringProductStructureId: readiness.structure.id,
      lifecycleStatus: existing && existing.lifecycleStatus || "DRAFT",
      generationStatus: "CURRENT",
      generatedAt: generatedAt,
      generatedBy: state.context.activeRole || "COMMODITY_MANAGER",
      generationVersion: existing && existing.generationVersion ? Number(existing.generationVersion) + 1 : 1,
      sourceEngineeringProductStructureFingerprint: fingerprintEngineeringProductStructure(readiness.structure),
      lineItems: lineBuild.lineItems,
      validation: { valid: true, errors: [], warnings: [] },
      staleReasons: [],
      lastGenerationError: "",
      unmatchedCommercialRows: lineBuild.unmatchedCommercialRows,
      createdAt: existing && existing.createdAt || generatedAt,
      updatedAt: generatedAt
    });
    assessment.totals = calculateTotals(assessment);
    return { readiness: readiness, assessment: assessment };
  }

  function validateGenerationInputs(state, criteria) {
    criteria = criteria || {};
    var programId = criteria.programId || (state.context && state.context.activeProgramId);
    var seatVariantId = criteria.seatVariantId || (state.context && state.context.activeSeatVariantId);
    var blockingErrors = [];
    var program = findById(state.programs, programId);
    var seatVariant = findById(state.seatVariants, seatVariantId);
    if (!program) push(blockingErrors, "COMMERCIAL_ASSESSMENT_PROGRAM_MISSING", "Active Program is required.", "PROGRAM", programId);
    if (!seatVariant) push(blockingErrors, "COMMERCIAL_ASSESSMENT_VARIANT_MISSING", "Active Seat Variant is required.", "SEAT_VARIANT", seatVariantId);
    if (program && seatVariant && seatVariant.programId !== program.id) {
      push(blockingErrors, "COMMERCIAL_ASSESSMENT_PROGRAM_VARIANT_MISMATCH", "Seat Variant must belong to active Program.", "SEAT_VARIANT", seatVariant.id);
    }
    var structure = program && seatVariant && findCurrentStructure(state, program.id, seatVariant.id);
    if (!structure) {
      push(blockingErrors, "COMMERCIAL_ASSESSMENT_EPS_MISSING", "Current Engineering Product Structure is required.", "ENGINEERING_PRODUCT_STRUCTURE", seatVariantId);
    } else if (structure.generationStatus !== "CURRENT") {
      push(blockingErrors, "COMMERCIAL_ASSESSMENT_EPS_NOT_CURRENT", "Engineering Product Structure must be CURRENT before commercial assessment.", "ENGINEERING_PRODUCT_STRUCTURE", structure.id);
    }
    return {
      generationAllowed: blockingErrors.length === 0,
      blockingErrors: blockingErrors,
      warnings: [],
      program: program,
      seatVariant: seatVariant,
      structure: structure
    };
  }

  function buildLineItems(structure, existing, preserveExisting) {
    var existingByStructureItem = {};
    var existingByPart = {};
    var matchedExistingIds = {};
    (existing && existing.lineItems || []).forEach(function (line) {
      existingByStructureItem[line.engineeringProductStructureItemId] = line;
      if (line.partId && !existingByPart[line.partId]) existingByPart[line.partId] = line;
    });
    var leaves = getLeafStructureItems(structure);
    var lineItems = leaves.map(function (item) {
      var existingLine = preserveExisting && (existingByStructureItem[item.id] || existingByPart[item.partId]);
      if (existingLine) matchedExistingIds[existingLine.id] = true;
      return createLineFromStructureItem(structure, item, existingLine);
    });
    var unmatched = [];
    if (preserveExisting && existing) {
      (existing.lineItems || []).forEach(function (line) {
        if (matchedExistingIds[line.id]) return;
        var obsolete = normalizeCommercialLine(Object.assign({}, line, {
          sourcingStatus: "OBSOLETE",
          obsolete: true,
          updatedAt: now()
        }));
        lineItems.push(obsolete);
        unmatched.push({
          id: line.id,
          engineeringProductStructureItemId: line.engineeringProductStructureItemId,
          partId: line.partId,
          reason: "REMOVED_FROM_ENGINEERING_PRODUCT_STRUCTURE"
        });
      });
    }
    return { lineItems: lineItems, unmatchedCommercialRows: unmatched };
  }

  function createLineFromStructureItem(structure, item, existingLine) {
    var snapshot = item.sourcePartSnapshot || {};
    var base = existingLine || {};
    return normalizeCommercialLine({
      id: base.id || makeLineId(structure.id, item.id),
      engineeringProductStructureId: structure.id,
      engineeringProductStructureItemId: item.id,
      partId: item.partId,
      supplierId: base.supplierId || "",
      supplier: base.supplier || "",
      supplierPartNumber: base.supplierPartNumber || "",
      commodityManager: base.commodityManager || "",
      sta: base.sta || "",
      poNumber: base.poNumber || "",
      poType: base.poType || "",
      poQuantity: base.poQuantity || item.calculatedQuantity || item.quantity || 1,
      scheduleGiven: base.scheduleGiven || "",
      quotation: base.quotation || "",
      piecePrice: base.piecePrice,
      toolingCost: base.toolingCost,
      logisticsCost: base.logisticsCost,
      currency: base.currency || "INR",
      sourcingStatus: base.sourcingStatus && base.sourcingStatus !== "OBSOLETE" ? base.sourcingStatus : "NOT_SOURCED",
      commercialStatus: base.commercialStatus || "NOT_STARTED",
      notes: base.notes || "",
      obsolete: false,
      quantity: item.calculatedQuantity || item.quantity || 1,
      sourcePartSnapshot: {
        partNumber: snapshot.partNumber || "",
        internalPartNumber: snapshot.internalPartNumber || snapshot.partNumber || "",
        oemPartNumber: snapshot.oemPartNumber || "",
        name: snapshot.name || snapshot.description || "",
        description: snapshot.description || snapshot.name || "",
        category: snapshot.category || "",
        revision: snapshot.revision || "",
        drawingNumber: snapshot.drawingNumber || "",
        drawingRevision: snapshot.drawingRevision || "",
        commodity: snapshot.commodity || "",
        sourceCommodityOriginal: snapshot.sourceCommodityOriginal || snapshot.commodity || "",
        sourceWorkbookSheet: snapshot.sourceWorkbookSheet || "",
        sourceWorkbookRow: snapshot.sourceWorkbookRow || "",
        material: snapshot.material || "",
        gauge: snapshot.gauge || "",
        cadWeight: snapshot.cadWeight || "",
        imageReference: snapshot.imageReference || "",
        changeClassification: item.changeClassification || "UNCHANGED"
      },
      updatedAt: base.updatedAt || "",
      updatedBy: base.updatedBy || ""
    });
  }

  function normalizeCommercialAssessment(input) {
    return {
      id: input.id,
      programId: input.programId,
      seatVariantId: input.seatVariantId,
      engineeringProductStructureId: input.engineeringProductStructureId,
      lifecycleStatus: input.lifecycleStatus || "DRAFT",
      generationStatus: normalizeGenerationStatus(input.generationStatus),
      generatedAt: input.generatedAt || null,
      generatedBy: input.generatedBy || "",
      generationVersion: Number(input.generationVersion || 0),
      sourceEngineeringProductStructureFingerprint: input.sourceEngineeringProductStructureFingerprint || "",
      lineItems: (input.lineItems || []).map(normalizeCommercialLine),
      totals: input.totals || { pieceTotal: 0, toolingTotal: 0, logisticsTotal: 0, overallTotal: 0 },
      validation: input.validation || { valid: true, errors: [], warnings: [] },
      staleReasons: (input.staleReasons || []).slice(),
      lastGenerationError: input.lastGenerationError || "",
      unmatchedCommercialRows: (input.unmatchedCommercialRows || []).slice(),
      createdAt: input.createdAt || now(),
      updatedAt: input.updatedAt || now()
    };
  }

  function normalizeCommercialLine(input) {
    return {
      id: input.id,
      engineeringProductStructureId: input.engineeringProductStructureId || "",
      engineeringProductStructureItemId: input.engineeringProductStructureItemId || "",
      partId: input.partId || "",
      supplierId: input.supplierId || "",
      supplier: input.supplier || "",
      supplierPartNumber: input.supplierPartNumber || "",
      commodityManager: input.commodityManager || "",
      sta: input.sta || "",
      poNumber: input.poNumber || "",
      poType: input.poType || "",
      poQuantity: toNumber(input.poQuantity || input.quantity || 1),
      scheduleGiven: input.scheduleGiven || "",
      quotation: input.quotation || "",
      piecePrice: toNumber(input.piecePrice),
      toolingCost: toNumber(input.toolingCost),
      logisticsCost: toNumber(input.logisticsCost),
      currency: input.currency === undefined || input.currency === null ? "INR" : String(input.currency).trim(),
      sourcingStatus: normalizeSourcingStatus(input.sourcingStatus),
      commercialStatus: normalizeCommercialStatus(input.commercialStatus),
      notes: input.notes || "",
      obsolete: Boolean(input.obsolete),
      quantity: toNumber(input.quantity || 1),
      sourcePartSnapshot: Object.assign({}, input.sourcePartSnapshot || {}),
      updatedAt: input.updatedAt || "",
      updatedBy: input.updatedBy || ""
    };
  }

  function normalizeLinePatch(patch) {
    var normalized = {};
    [
      "supplierId",
      "supplier",
      "supplierPartNumber",
      "commodityManager",
      "sta",
      "poNumber",
      "poType",
      "scheduleGiven",
      "quotation",
      "logisticsCost",
      "currency",
      "commercialStatus"
    ].forEach(function (field) {
      if (patch[field] !== undefined) normalized[field] = patch[field];
    });
    if (patch.poQuantity !== undefined) normalized.poQuantity = patch.poQuantity;
    if (patch.piecePrice !== undefined) normalized.piecePrice = patch.piecePrice;
    if (patch.unitCost !== undefined) normalized.piecePrice = patch.unitCost;
    if (patch.toolingCost !== undefined) normalized.toolingCost = patch.toolingCost;
    if (patch.toolCost !== undefined) normalized.toolingCost = patch.toolCost;
    if (patch.sourcingStatus !== undefined) normalized.sourcingStatus = patch.sourcingStatus;
    if (patch.notes !== undefined) normalized.notes = patch.notes;
    if (patch.remarks !== undefined) normalized.notes = patch.remarks;
    return normalized;
  }

  function validateLine(line, state, assessment) {
    var errors = [];
    if (!line.id) push(errors, "COMMERCIAL_LINE_ID_REQUIRED", "Commercial Line ID is required.", "COMMERCIAL_LINE_ITEM", line.id);
    if (!line.engineeringProductStructureItemId) push(errors, "COMMERCIAL_LINE_EPS_ITEM_REQUIRED", "Engineering Product Structure Item reference is required.", "COMMERCIAL_LINE_ITEM", line.id);
    var hasCommercialValue = line.piecePrice > 0 || line.toolingCost > 0 || line.logisticsCost > 0;
    if (hasCommercialValue && !line.currency) push(errors, "COMMERCIAL_LINE_CURRENCY_REQUIRED", "Currency is required when commercial values are entered.", "COMMERCIAL_LINE_ITEM", line.id);
    if (line.currency && (app.data.referenceData.currencies || []).indexOf(line.currency) === -1) push(errors, "COMMERCIAL_LINE_CURRENCY_INVALID", "Currency is not controlled.", "COMMERCIAL_LINE_ITEM", line.id);
    if (line.piecePrice < 0 || line.toolingCost < 0 || line.logisticsCost < 0 || line.poQuantity < 0) push(errors, "COMMERCIAL_LINE_COST_INVALID", "Commercial cost and PO quantity values must be non-negative.", "COMMERCIAL_LINE_ITEM", line.id);
    if (["SOURCED", "NOMINATED", "QUOTED"].indexOf(line.sourcingStatus) !== -1 && !line.supplierId && !line.supplier) push(errors, "COMMERCIAL_LINE_SUPPLIER_REQUIRED", "Supplier is required for sourced, nominated, or quoted line items.", "COMMERCIAL_LINE_ITEM", line.id);
    if (line.commercialStatus === "COMPLETE" && !isCommercialLineComplete(line)) push(errors, "COMMERCIAL_LINE_COMPLETE_INVALID", "Commercial Status cannot be COMPLETE until Commodity, Supplier, Currency, Unit Rate, and Sourcing Status are complete.", "COMMERCIAL_LINE_ITEM", line.id);
    var structure = findById(state.engineeringProductStructures, assessment.engineeringProductStructureId);
    if (assessment.generationStatus === "CURRENT" && !line.obsolete && line.sourcingStatus !== "OBSOLETE" && structure && !(structure.items || []).some(function (item) { return item.id === line.engineeringProductStructureItemId; })) {
      push(errors, "COMMERCIAL_LINE_EPS_ITEM_MISSING", "Commercial Line references an unknown EPS item.", "COMMERCIAL_LINE_ITEM", line.id);
    }
    if (errors.length) throw new app.core.errors.BusinessOperationError("Commercial Line validation failed.", errors);
  }

  function calculateTotals(assessment) {
    var totals = { pieceTotal: 0, toolingTotal: 0, logisticsTotal: 0, overallTotal: 0 };
    (assessment.lineItems || []).forEach(function (line) {
      if (line.obsolete || line.sourcingStatus === "OBSOLETE") return;
      totals.pieceTotal += toNumber(line.quantity) * toNumber(line.piecePrice);
      totals.toolingTotal += toNumber(line.toolingCost);
      totals.logisticsTotal += toNumber(line.logisticsCost);
    });
    totals.overallTotal = totals.pieceTotal + totals.toolingTotal + totals.logisticsTotal;
    return totals;
  }

  function getLeafStructureItems(structure) {
    var parentIds = {};
    (structure.items || []).forEach(function (item) {
      if (item.parentGeneratedItemId) parentIds[item.parentGeneratedItemId] = true;
    });
    return (structure.items || []).filter(function (item) {
      return item.partId && !parentIds[item.id];
    });
  }

  function findCurrentStructure(state, programId, seatVariantId) {
    return (state.engineeringProductStructures || []).find(function (structure) {
      return structure.programId === programId && structure.seatVariantId === seatVariantId;
    }) || null;
  }

  function findAssessment(state, programId, seatVariantId) {
    return (state.commercialAssessments || []).find(function (assessment) {
      return assessment.programId === programId && assessment.seatVariantId === seatVariantId;
    }) || null;
  }

  function fingerprintEngineeringProductStructure(structure) {
    return stableStringify({
      id: structure.id,
      generationStatus: structure.generationStatus,
      generationVersion: structure.generationVersion,
      items: getLeafStructureItems(structure).map(function (item) {
        return {
          id: item.id,
          partId: item.partId,
          quantity: item.calculatedQuantity || item.quantity,
          unit: item.unit,
          part: item.sourcePartSnapshot
        };
      }).sort(function (a, b) { return String(a.id).localeCompare(String(b.id)); })
    });
  }

  function markGenerationFailed(snapshot, built) {
    var readiness = built.readiness;
    if (!readiness.program || !readiness.seatVariant) return;
    var existing = findAssessment(snapshot, readiness.program.id, readiness.seatVariant.id);
    var id = existing ? existing.id : makeAssessmentId(readiness.program.id, readiness.seatVariant.id);
    app.core.appState.transaction(function (state) {
      var current = findById(state.commercialAssessments, id);
      var failedAt = now();
      var failure = normalizeCommercialAssessment({
        id: id,
        programId: readiness.program.id,
        seatVariantId: readiness.seatVariant.id,
        engineeringProductStructureId: readiness.structure && readiness.structure.id || current && current.engineeringProductStructureId || "",
        lifecycleStatus: current && current.lifecycleStatus || "DRAFT",
        generationStatus: "GENERATION_FAILED",
        generatedAt: current && current.generatedAt || null,
        generatedBy: current && current.generatedBy || "",
        generationVersion: current && current.generationVersion || 0,
        sourceEngineeringProductStructureFingerprint: current && current.sourceEngineeringProductStructureFingerprint || "",
        lineItems: current && current.lineItems || [],
        totals: current && current.totals || { pieceTotal: 0, toolingTotal: 0, logisticsTotal: 0, overallTotal: 0 },
        validation: { valid: false, errors: readiness.blockingErrors, warnings: readiness.warnings },
        staleReasons: ["GENERATION_FAILED"],
        lastGenerationError: readiness.blockingErrors.map(function (item) { return item.code + ": " + item.message; }).join("; "),
        unmatchedCommercialRows: current && current.unmatchedCommercialRows || [],
        createdAt: current && current.createdAt || failedAt,
        updatedAt: failedAt
      });
      var index = findIndex(state.commercialAssessments, id);
      if (index === -1) state.commercialAssessments.push(failure);
      else state.commercialAssessments[index] = failure;
      app.core.appState._recordAuditEvent(state, {
        objectType: "COMMERCIAL_ASSESSMENT",
        objectId: id,
        action: "COMMERCIAL_ASSESSMENT_GENERATION_FAILED",
        details: failure.lastGenerationError
      });
    });
  }

  function normalizeGenerationStatus(status) {
    var normalized = String(status || "NOT_GENERATED").trim().toUpperCase().replace(/\s+/g, "_");
    return GENERATION_STATUSES.indexOf(normalized) === -1 ? "NOT_GENERATED" : normalized;
  }

  function normalizeSourcingStatus(status) {
    var normalized = String(status || "NOT_SOURCED").trim().toUpperCase().replace(/[\s-]+/g, "_");
    if (normalized === "UNPRICED") return "NOT_SOURCED";
    if (normalized === "COSTED") return "QUOTED";
    return SOURCING_STATUSES.indexOf(normalized) === -1 ? "NOT_SOURCED" : normalized;
  }

  function normalizeCommercialStatus(status) {
    var normalized = String(status || "NOT_STARTED").trim().toUpperCase().replace(/[\s-]+/g, "_");
    return COMMERCIAL_STATUSES.indexOf(normalized) === -1 ? "NOT_STARTED" : normalized;
  }

  function resolveCommercialStatus(line, requestedStatus) {
    if (line.obsolete || line.sourcingStatus === "OBSOLETE") return "OBSOLETE";
    var requested = requestedStatus === undefined ? "" : normalizeCommercialStatus(requestedStatus);
    if (["STALE", "IMPACTED_BY_ECN"].indexOf(requested) !== -1) return requested;
    if (requested === "COMPLETE") return "COMPLETE";
    if (isCommercialLineComplete(line)) return "COMPLETE";
    var hasProgress = Boolean(line.supplier || line.supplierPartNumber || line.commodityManager || line.sta ||
      line.piecePrice > 0 || line.toolingCost > 0 || line.logisticsCost > 0 ||
      (line.sourcingStatus && line.sourcingStatus !== "NOT_SOURCED") || line.notes);
    return hasProgress ? "IN_PROGRESS" : "NOT_STARTED";
  }

  function isCommercialLineComplete(line) {
    var commodity = line.sourcePartSnapshot && line.sourcePartSnapshot.commodity || "";
    return Boolean(String(commodity).trim() && (line.supplierId || line.supplier) && line.currency &&
      Number(line.piecePrice) > 0 && line.sourcingStatus && line.sourcingStatus !== "NOT_SOURCED" && line.sourcingStatus !== "OBSOLETE");
  }

  function stableStringify(value) {
    if (value === null || typeof value !== "object") return JSON.stringify(value);
    if (Array.isArray(value)) return "[" + value.map(stableStringify).join(",") + "]";
    return "{" + Object.keys(value).sort().map(function (key) {
      return JSON.stringify(key) + ":" + stableStringify(value[key]);
    }).join(",") + "}";
  }

  function makeAssessmentId(programId, seatVariantId) {
    return "CA-" + normalizeId(programId + "-" + seatVariantId);
  }

  function makeLineId(structureId, itemId) {
    return "CLI-" + normalizeId(structureId + "-" + itemId);
  }

  function normalizeId(value) {
    return String(value || "").toUpperCase().replace(/[^A-Z0-9]+/g, "-").replace(/^-|-$/g, "");
  }

  function toNumber(value) {
    if (value === "" || value === null || value === undefined) return 0;
    var number = Number(value);
    return isNaN(number) ? 0 : number;
  }

  function findById(collection, id) {
    return (collection || []).find(function (item) { return item.id === id; }) || null;
  }

  function findIndex(collection, id) {
    return (collection || []).findIndex(function (item) { return item.id === id; });
  }

  function isReleasedAssessment(assessment) {
    return Boolean(assessment && (assessment.lifecycleStatus === "RELEASED" || app.core.permissionService.isReleased(assessment)));
  }

  function immutableId(objectType, id) {
    return new app.core.errors.BusinessOperationError(objectType + " ID cannot be changed.", [
      { code: objectType + "_ID_IMMUTABLE", message: objectType + " ID is stable and immutable.", objectType: objectType, objectId: id }
    ]);
  }

  function notFound(objectType, id) {
    return new app.core.errors.BusinessOperationError(objectType + " was not found.", [
      { code: objectType + "_NOT_FOUND", message: objectType + " was not found.", objectType: objectType, objectId: id }
    ]);
  }

  function now() {
    return new Date().toISOString();
  }

  function push(errors, code, message, objectType, objectId) {
    errors.push({ code: code, message: message, objectType: objectType || null, objectId: objectId || null });
  }

  function operationContext(state, options) {
    return Object.assign({}, state.context || {}, {
      state: state,
      engineeringChangeId: options && (options.engineeringChangeId || options.changeId)
    });
  }

  function recalculateContextChanges(state, programId, seatVariantId, reason) {
    if (!app.domain.engineeringChangeImpactService) return;
    (state.engineeringChanges || []).forEach(function (change) {
      if (!change.impactTrackingEnabled || change.programId !== programId || change.seatVariantId !== seatVariantId) return;
      if (["IMPLEMENTED", "REJECTED", "CANCELLED"].indexOf(change.status) !== -1) return;
      app.domain.engineeringChangeImpactService._recalculateInState(state, change, { audit: false, reason: reason });
    });
  }

  app.domain.commercialAssessmentService = {
    GENERATION_STATUSES: GENERATION_STATUSES.slice(),
    SOURCING_STATUSES: SOURCING_STATUSES.slice(),
    COMMERCIAL_STATUSES: COMMERCIAL_STATUSES.slice(),
    generateCommercialAssessment: generateCommercialAssessment,
    regenerateCommercialAssessment: regenerateCommercialAssessment,
    getCommercialAssessment: getCommercialAssessment,
    getCommercialAssessmentForContext: getCommercialAssessmentForContext,
    updateCommercialLine: updateCommercialLine,
    updateSupplier: updateSupplier,
    updatePiecePrice: updatePiecePrice,
    updateCurrency: updateCurrency,
    updateQuotation: updateQuotation,
    updateToolingCost: updateToolingCost,
    updateLogisticsCost: updateLogisticsCost,
    updateNotes: updateNotes,
    markCommercialAssessmentStale: markCommercialAssessmentStale,
    detectCommercialAssessmentStaleness: detectCommercialAssessmentStaleness,
    getCommercialAssessmentTotals: getCommercialAssessmentTotals,
    validateGenerationInputs: validateGenerationInputs,
    normalizeCommercialAssessment: normalizeCommercialAssessment,
    normalizeCommercialLine: normalizeCommercialLine,
    normalizeCommercialStatus: normalizeCommercialStatus,
    resolveCommercialStatus: resolveCommercialStatus,
    isCommercialLineComplete: isCommercialLineComplete,
    isCommercialLineComplete: isCommercialLineComplete
  };
})(typeof window !== "undefined" ? (window.DEP = window.DEP || {}) : (globalThis.DEP = globalThis.DEP || {}));
