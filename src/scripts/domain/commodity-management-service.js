(function (app) {
  app.domain = app.domain || {};

  var IMPACT_PRIORITY = {
    NOT_IMPACTED: 0,
    COMMERCIAL_COMPLETE: 1,
    ENGINEERING_IMPACT: 2,
    SUPPLIER_REVIEW_REQUIRED: 3,
    PRICE_REVIEW_REQUIRED: 4,
    OBSOLETE: 5
  };

  function getCommodityWorkspaceData(criteria) {
    criteria = criteria || {};
    var startedAt = Date.now();
    var state = app.core.appState.getState();
    var context = state.context || {};
    var programId = criteria.programId || context.activeProgramId;
    var seatVariantId = criteria.seatVariantId || context.activeSeatVariantId;
    var program = findById(state.programs, programId);
    var variant = findById(state.seatVariants, seatVariantId);
    var structure = findForContext(state.engineeringProductStructures, programId, seatVariantId);
    var assessment = findForContext(state.commercialAssessments, programId, seatVariantId);
    var prerequisites = [];

    if (!program || !variant) prerequisites.push("Select a Programme and Finished-Good Variant.");
    if (program && variant && variant.programId !== program.id) prerequisites.push("The selected Finished-Good Variant does not belong to the active Programme.");
    if (program && variant && !structure) prerequisites.push("Generate Complete Seat JIT before managing Commodity data.");
    if (structure && structure.generationStatus !== "CURRENT") prerequisites.push("Regenerate Complete Seat JIT before managing Commodity data.");

    var canPrepareAssessment = prerequisites.length === 0 && Boolean(structure);
    var assessmentNeedsPreparation = canPrepareAssessment && needsAssessmentPreparation(structure, assessment);
    if (canPrepareAssessment && assessment && assessment.generationStatus === "GENERATION_FAILED") {
      prerequisites.push("Regenerate Commercial Assessment after correcting its validation issues.");
      canPrepareAssessment = false;
    }

    var rows = assessment ? buildRows(state, structure, assessment) : [];
    return {
      program: program,
      variant: variant,
      structure: structure,
      assessment: assessment,
      suppliers: (state.suppliers || []).map(function (supplier) {
        return { id: supplier.id, name: supplier.name || "", supplierCode: supplier.supplierCode || "" };
      }),
      rows: rows,
      prerequisites: prerequisites,
      canPrepareAssessment: canPrepareAssessment,
      assessmentNeedsPreparation: assessmentNeedsPreparation,
      dataResolutionMs: Date.now() - startedAt,
      identity: {
        programId: programId || "",
        seatVariantId: seatVariantId || "",
        engineeringProductStructureId: structure && structure.id || "",
        commercialAssessmentId: assessment && assessment.id || ""
      }
    };
  }

  function ensureCommercialAssessmentForContext(criteria) {
    var data = getCommodityWorkspaceData(criteria || {});
    if (!data.canPrepareAssessment) {
      throw new app.core.errors.BusinessOperationError("Commodity Management prerequisites are incomplete.", data.prerequisites.map(function (message) {
        return { code: "COMMODITY_PREREQUISITE", message: message, objectType: "COMMERCIAL_ASSESSMENT", objectId: data.identity.seatVariantId };
      }));
    }
    if (!data.assessment) {
      app.domain.commercialAssessmentService.generateCommercialAssessment(criteria || {});
    } else if (data.assessmentNeedsPreparation || data.assessment.generationStatus !== "CURRENT") {
      app.domain.commercialAssessmentService.regenerateCommercialAssessment(criteria || {});
    }
    return app.domain.commercialAssessmentService.getCommercialAssessmentForContext(criteria || {});
  }

  function updateCommercialLine(assessmentId, lineId, patch, options) {
    var state = app.core.appState.getState();
    var normalizedPatch = Object.assign({}, patch || {});
    if (normalizedPatch.unitRate !== undefined) {
      normalizedPatch.piecePrice = normalizedPatch.unitRate;
      delete normalizedPatch.unitRate;
    }
    if (normalizedPatch.tooling !== undefined) {
      normalizedPatch.toolingCost = normalizedPatch.tooling;
      delete normalizedPatch.tooling;
    }
    if (normalizedPatch.logistics !== undefined) {
      normalizedPatch.logisticsCost = normalizedPatch.logistics;
      delete normalizedPatch.logistics;
    }
    if (normalizedPatch.remarks !== undefined) {
      normalizedPatch.notes = normalizedPatch.remarks;
      delete normalizedPatch.remarks;
    }
    if (normalizedPatch.supplier !== undefined) {
      var supplierName = trim(normalizedPatch.supplier);
      var supplier = (state.suppliers || []).find(function (candidate) {
        return normalizeText(candidate.name) === normalizeText(supplierName) || normalizeText(candidate.supplierCode) === normalizeText(supplierName);
      });
      normalizedPatch.supplier = supplierName;
      normalizedPatch.supplierId = supplier ? supplier.id : "";
    }
    app.domain.commercialAssessmentService.updateCommercialLine(assessmentId, lineId, normalizedPatch, options || {});
    return app.domain.commercialAssessmentService.getCommercialAssessment(assessmentId);
  }

  function buildRows(state, structure, assessment) {
    var partsById = indexById(state.parts || []);
    var modulesById = indexById(state.engineeringModules || []);
    var bomsById = indexById(state.engineeringBoms || []);
    var structureItemsById = indexById(structure && structure.items || []);
    var impactIndex = buildEcnImpactIndex(state, structure, assessment);

    return (assessment.lineItems || []).map(function (line) {
      var item = structureItemsById[line.engineeringProductStructureItemId] || null;
      var part = partsById[line.partId] || null;
      var snapshot = line.sourcePartSnapshot || {};
      var module = item && modulesById[item.sourceEngineeringModuleId] || null;
      var bom = item && bomsById[item.sourceEngineeringBomId] || null;
      var originalCommodity = trim(part && (part.sourceCommodityOriginal || part.commodity) || snapshot.sourceCommodityOriginal || snapshot.commodity);
      var normalizedCommodity = normalizeCommodity(originalCommodity);
      var impacts = resolveLineImpacts(impactIndex, line, item, structure, assessment);
      var obsolete = Boolean(line.obsolete || line.sourcingStatus === "OBSOLETE" || (snapshot.changeClassification || item && item.changeClassification) === "DELETED");
      var commercialStatus = app.domain.commercialAssessmentService.resolveCommercialStatus(line);
      if (obsolete) commercialStatus = "OBSOLETE";
      else if (impacts.some(function (impact) { return impact.open; })) commercialStatus = "IMPACTED_BY_ECN";
      var quantity = number(line.quantity || item && (item.calculatedQuantity || item.quantity) || 1);
      var piecePrice = number(line.piecePrice);
      var toolingCost = number(line.toolingCost);
      var logisticsCost = number(line.logisticsCost);
      return {
        id: line.id,
        commercialAssessmentId: assessment.id,
        engineeringProductStructureId: structure && structure.id || line.engineeringProductStructureId,
        engineeringProductStructureItemId: line.engineeringProductStructureItemId,
        partId: line.partId,
        commodityOriginal: originalCommodity,
        commodityKey: normalizedCommodity.key,
        commodity: normalizedCommodity.label,
        imageReference: part && part.imageReference || snapshot.imageReference || "",
        partNumber: part && part.partNumber || snapshot.partNumber || line.partId,
        partRevision: part && part.currentRevision || snapshot.revision || "",
        drawingNumber: part && part.drawingNumber || snapshot.drawingNumber || "",
        drawingRevision: part && part.drawingRevision || snapshot.drawingRevision || "",
        partDescription: part && (part.description || part.name) || snapshot.description || snapshot.name || "",
        sourceDiscipline: module && (module.name || module.label || module.code) || "Historical",
        sourceEngineeringModuleId: item && item.sourceEngineeringModuleId || "",
        sourceEngineeringBomId: item && item.sourceEngineeringBomId || line.sourceEngineeringBomId || "",
        sourceEngineeringBom: bom && (bom.bomNumber || bom.name || bom.id) || item && item.sourceEngineeringBomId || "",
        sourceBomItemId: item && item.sourceBomItemId || "",
        unitQuantity: quantity,
        cadWeight: part && (part.cadWeight != null ? part.cadWeight : part.mass) || snapshot.cadWeight || "",
        changeClassification: item && item.changeClassification || snapshot.changeClassification || "UNCHANGED",
        commodityManager: line.commodityManager || "",
        sta: line.sta || "",
        supplier: line.supplier || "",
        supplierId: line.supplierId || "",
        supplierPartNumber: line.supplierPartNumber || "",
        currency: line.currency || "",
        unitRate: piecePrice,
        tooling: toolingCost,
        logistics: logisticsCost,
        sourcingStatus: line.sourcingStatus || "NOT_SOURCED",
        commercialStatus: commercialStatus,
        remarks: line.notes || "",
        pieceCost: quantity * piecePrice,
        lineTotal: quantity * piecePrice + toolingCost + logisticsCost,
        priced: piecePrice > 0,
        obsolete: obsolete,
        active: !obsolete,
        ecnNumbers: impacts.map(function (impact) { return impact.changeNumber; }),
        ecnNumber: impacts.map(function (impact) { return impact.changeNumber; }).join(", "),
        ecnStatus: impacts.map(function (impact) { return impact.changeStatus; }).filter(Boolean).join(", "),
        ecnImpactStatus: highestImpactStatus(impacts, obsolete),
        openEcnImpactCount: impacts.filter(function (impact) { return impact.open; }).length,
        previousUnitRate: impacts.length ? number(impacts[0].previousUnitRate) : piecePrice,
        currentUnitRate: piecePrice,
        costDelta: impacts.length ? impacts[0].costDelta : 0,
        activeEngineeringChangeId: (impacts.find(function (impact) {
          return ["APPROVED", "IMPLEMENTING"].indexOf(impact.changeStatus) !== -1;
        }) || {}).id || "",
        sourceWorkbookSheet: part && part.sourceWorkbookSheet || snapshot.sourceWorkbookSheet || "",
        sourceWorkbookRow: part && part.sourceWorkbookRow || snapshot.sourceWorkbookRow || ""
      };
    });
  }

  function applyView(rows, filters, sort) {
    filters = filters || {};
    sort = sort || { field: "commodity", direction: "asc" };
    var search = normalizeText(filters.search);
    var filtered = (rows || []).filter(function (row) {
      if (filters.commodity && row.commodityKey !== filters.commodity) return false;
      if (filters.sourceDiscipline && row.sourceDiscipline !== filters.sourceDiscipline) return false;
      if (filters.supplier && row.supplier !== filters.supplier) return false;
      if (filters.commodityManager && row.commodityManager !== filters.commodityManager) return false;
      if (filters.commercialStatus && row.commercialStatus !== filters.commercialStatus) return false;
      if (filters.pricing === "PRICED" && !row.priced) return false;
      if (filters.pricing === "UNPRICED" && row.priced) return false;
      if (filters.ecnImpact === "IMPACTED" && row.ecnImpactStatus === "NOT_IMPACTED") return false;
      if (filters.ecnImpact === "NOT_IMPACTED" && row.ecnImpactStatus !== "NOT_IMPACTED") return false;
      if (filters.ecnImpact && ["IMPACTED", "NOT_IMPACTED"].indexOf(filters.ecnImpact) === -1 && row.ecnImpactStatus !== filters.ecnImpact) return false;
      if (search) {
        var searchable = normalizeText([row.partNumber, row.partDescription, row.drawingNumber].join(" "));
        if (searchable.indexOf(search) === -1) return false;
      }
      return true;
    });
    return filtered.sort(function (left, right) {
      var field = sort.field || "commodity";
      var result;
      if (["unitRate", "pieceCost", "lineTotal"].indexOf(field) !== -1) result = number(left[field]) - number(right[field]);
      else result = String(left[field] == null ? "" : left[field]).localeCompare(String(right[field] == null ? "" : right[field]), undefined, { numeric: true, sensitivity: "base" });
      if (!result) result = String(left.partNumber).localeCompare(String(right.partNumber), undefined, { numeric: true, sensitivity: "base" });
      return sort.direction === "desc" ? -result : result;
    });
  }

  function calculateSummaries(rows) {
    var activeRows = (rows || []).filter(function (row) { return row.active; });
    var groups = {};
    activeRows.forEach(function (row) {
      if (!groups[row.commodityKey]) groups[row.commodityKey] = createSummary(row.commodity, row.commodityKey);
      addToSummary(groups[row.commodityKey], row);
    });
    var commoditySummaries = Object.keys(groups).map(function (key) {
      return finishSummary(groups[key]);
    }).sort(function (a, b) { return a.commodity.localeCompare(b.commodity); });
    var variant = createSummary("Finished-Good Variant", "__VARIANT__");
    activeRows.forEach(function (row) { addToSummary(variant, row); });
    return { commoditySummaries: commoditySummaries, variantSummary: finishSummary(variant) };
  }

  function getFilterOptions(rows) {
    return {
      commodities: uniqueOptions(rows, "commodityKey", "commodity"),
      sourceDisciplines: uniqueValues(rows, "sourceDiscipline"),
      suppliers: uniqueValues(rows, "supplier", true),
      commodityManagers: uniqueValues(rows, "commodityManager", true),
      commercialStatuses: uniqueValues(rows, "commercialStatus"),
      ecnImpacts: uniqueValues(rows, "ecnImpactStatus")
    };
  }

  function normalizeCommodity(value) {
    var original = trim(value).replace(/\s+/g, " ");
    if (!original || /^[-–—]+$/.test(original)) return { key: "__UNASSIGNED__", label: "Unassigned Commodity", original: original };
    return {
      key: original.toUpperCase(),
      label: original.toLowerCase().replace(/(^|[\s/()_-])([a-z])/g, function (_, prefix, character) {
        return prefix + character.toUpperCase();
      }),
      original: original
    };
  }

  function needsAssessmentPreparation(structure, assessment) {
    if (!assessment || assessment.generationStatus !== "CURRENT" || assessment.engineeringProductStructureId !== structure.id) return true;
    var lineItemIds = {};
    (assessment.lineItems || []).forEach(function (line) {
      if (!line.obsolete) lineItemIds[line.engineeringProductStructureItemId] = true;
    });
    return getLeafItems(structure).some(function (item) { return !lineItemIds[item.id]; });
  }

  function getLeafItems(structure) {
    var parentIds = {};
    (structure.items || []).forEach(function (item) { if (item.parentGeneratedItemId) parentIds[item.parentGeneratedItemId] = true; });
    return (structure.items || []).filter(function (item) { return item.partId && !parentIds[item.id]; });
  }

  function buildEcnImpactIndex(state, structure, assessment) {
    var index = {};
    function add(key, entry) {
      if (!key) return;
      index[key] = index[key] || [];
      index[key].push(entry);
    }
    (state.engineeringChanges || []).forEach(function (change) {
      if (change.programId !== assessment.programId || change.seatVariantId !== assessment.seatVariantId) return;
      (change.commodityImpact || []).forEach(function (impactLine) {
        var entry = { change: change, affected: null, impactLine: impactLine };
        if (impactLine.commercialLineId) add("LINE|" + impactLine.commercialLineId, entry);
        else if (impactLine.engineeringProductStructureItemId) add("EPS_ITEM|" + impactLine.engineeringProductStructureItemId, entry);
        else if (impactLine.sourceBomItemId) add("BOM_ITEM|" + impactLine.sourceBomItemId, entry);
        else if (impactLine.partId) add("PART|" + impactLine.partId, entry);
      });
      (change.affectedObjects || []).forEach(function (affected) {
        if (!affected.objectId) return;
        var type = String(affected.objectType || "").toUpperCase();
        var key = type === "COMMERCIAL_LINE" ? "LINE|" + affected.objectId :
          type === "ENGINEERING_PRODUCT_STRUCTURE_ITEM" ? "EPS_ITEM|" + affected.objectId :
            type === "ENGINEERING_BOM_ITEM" ? "BOM_ITEM|" + affected.objectId :
              type === "ENGINEERING_BOM" ? "BOM|" + affected.objectId :
                type === "PART" ? "PART|" + affected.objectId :
                  type === "COMMERCIAL_ASSESSMENT" ? "ASSESSMENT|" + affected.objectId :
                    type === "ENGINEERING_PRODUCT_STRUCTURE" ? "EPS|" + affected.objectId : "";
        add(key, { change: change, affected: affected, impactLine: null });
      });
    });
    return index;
  }

  function resolveLineImpacts(index, line, item, structure, assessment) {
    var ids = [
      "LINE|" + line.id,
      "PART|" + line.partId,
      "EPS_ITEM|" + line.engineeringProductStructureItemId,
      "ASSESSMENT|" + assessment.id,
      structure && "EPS|" + structure.id
    ];
    if (item) ids = ids.concat(["BOM_ITEM|" + item.sourceBomItemId, "BOM|" + item.sourceEngineeringBomId]);
    var seen = {};
    var impacts = [];
    ids.filter(Boolean).forEach(function (id) {
      (index[id] || []).forEach(function (entry) {
        var change = entry.change;
        if (seen[change.id]) return;
        seen[change.id] = true;
        impacts.push({
          id: change.id,
          changeNumber: change.changeNumber || change.ecnNumber || change.id,
          changeStatus: change.status,
          status: entry.impactLine && entry.impactLine.impactStatus || impactStatus(change, entry.affected || {}),
          previousUnitRate: entry.impactLine && entry.impactLine.previousUnitRate,
          currentUnitRate: entry.impactLine && entry.impactLine.currentUnitRate,
          costDelta: entry.impactLine && entry.impactLine.costDelta,
          open: ["IMPLEMENTED", "REJECTED", "CANCELLED"].indexOf(change.status) === -1
        });
      });
    });
    return impacts;
  }

  function impactStatus(change, affected) {
    var action = String(affected.action || "").toUpperCase();
    var disposition = String(affected.disposition || "").toUpperCase();
    var commercialImpact = String(change.commercialImpact || affected.impact || "").toUpperCase();
    if (action === "DELETE" || action === "REMOVE" || disposition === "OBSOLETE") return "OBSOLETE";
    if (change.status === "IMPLEMENTED") return "COMMERCIAL_COMPLETE";
    if (/PRICE|COST/.test(commercialImpact)) return "PRICE_REVIEW_REQUIRED";
    if (String(affected.objectType || "").toUpperCase().indexOf("COMMERCIAL") !== -1) return "SUPPLIER_REVIEW_REQUIRED";
    return "ENGINEERING_IMPACT";
  }

  function highestImpactStatus(impacts, obsolete) {
    if (obsolete) return "OBSOLETE";
    return (impacts || []).reduce(function (status, impact) {
      return IMPACT_PRIORITY[impact.status] > IMPACT_PRIORITY[status] ? impact.status : status;
    }, "NOT_IMPACTED");
  }

  function createSummary(label, key) {
    return { commodity: label, commodityKey: key, rows: 0, suppliers: {}, pricedParts: 0, unpricedParts: 0, completeParts: 0, openEcnImpactCount: 0, currencies: {} };
  }

  function addToSummary(summary, row) {
    summary.rows += 1;
    if (row.supplier) summary.suppliers[row.supplier] = true;
    if (row.priced) summary.pricedParts += 1;
    else summary.unpricedParts += 1;
    if (row.commercialStatus === "COMPLETE") summary.completeParts += 1;
    summary.openEcnImpactCount += row.openEcnImpactCount;
    var currency = row.currency || "UNSPECIFIED";
    summary.currencies[currency] = summary.currencies[currency] || { currency: currency, pieceCost: 0, tooling: 0, logistics: 0, total: 0 };
    summary.currencies[currency].pieceCost += row.pieceCost;
    summary.currencies[currency].tooling += row.tooling;
    summary.currencies[currency].logistics += row.logistics;
    summary.currencies[currency].total += row.lineTotal;
  }

  function finishSummary(summary) {
    return {
      commodity: summary.commodity,
      commodityKey: summary.commodityKey,
      partCount: summary.rows,
      supplierCount: Object.keys(summary.suppliers).length,
      pricedParts: summary.pricedParts,
      unpricedParts: summary.unpricedParts,
      commercialCompleteness: summary.rows ? Math.round(summary.completeParts * 100 / summary.rows) : 0,
      openEcnImpactCount: summary.openEcnImpactCount,
      totalsByCurrency: Object.keys(summary.currencies).sort().map(function (currency) { return summary.currencies[currency]; }),
      mixedCurrency: Object.keys(summary.currencies).filter(function (currency) { return currency !== "UNSPECIFIED"; }).length > 1
    };
  }

  function uniqueOptions(rows, keyField, labelField) {
    var values = {};
    (rows || []).forEach(function (row) { values[row[keyField]] = row[labelField]; });
    return Object.keys(values).sort(function (a, b) { return String(values[a]).localeCompare(String(values[b])); }).map(function (key) {
      return { value: key, label: values[key] };
    });
  }

  function uniqueValues(rows, field, omitBlank) {
    var values = {};
    (rows || []).forEach(function (row) {
      var value = trim(row[field]);
      if (!value && omitBlank) return;
      if (value) values[value] = true;
    });
    return Object.keys(values).sort(function (a, b) { return a.localeCompare(b); });
  }

  function findForContext(collection, programId, seatVariantId) {
    return (collection || []).find(function (item) { return item.programId === programId && item.seatVariantId === seatVariantId; }) || null;
  }

  function findById(collection, id) {
    return (collection || []).find(function (item) { return item.id === id; }) || null;
  }

  function indexById(collection) {
    var index = {};
    (collection || []).forEach(function (item) { if (item && item.id) index[item.id] = item; });
    return index;
  }

  function normalizeText(value) {
    return trim(value).replace(/\s+/g, " ").toUpperCase();
  }

  function number(value) {
    var result = Number(value);
    return isNaN(result) ? 0 : result;
  }

  function trim(value) {
    return String(value == null ? "" : value).trim();
  }

  app.domain.commodityManagementService = {
    getCommodityWorkspaceData: getCommodityWorkspaceData,
    ensureCommercialAssessmentForContext: ensureCommercialAssessmentForContext,
    updateCommercialLine: updateCommercialLine,
    normalizeCommodity: normalizeCommodity,
    applyView: applyView,
    calculateSummaries: calculateSummaries,
    getFilterOptions: getFilterOptions
  };
})(typeof window !== "undefined" ? (window.DEP = window.DEP || {}) : (globalThis.DEP = globalThis.DEP || {}));
