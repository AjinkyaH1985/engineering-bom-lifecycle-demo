(function (app) {
  app.domain = app.domain || {};

  var IMPACT_STATUSES = [
    "NOT_IMPACTED",
    "ENGINEERING_IMPACT",
    "SUPPLIER_REVIEW_REQUIRED",
    "PRICE_REVIEW_REQUIRED",
    "COMMERCIAL_COMPLETE",
    "OBSOLETE"
  ];
  var ENGINEERING_TYPES = {
    PART: true,
    ENGINEERING_BOM: true,
    ENGINEERING_BOM_ITEM: true,
    ENGINEERING_PRODUCT_STRUCTURE: true,
    ENGINEERING_PRODUCT_STRUCTURE_ITEM: true
  };

  function recalculateEngineeringChangeImpact(id, options) {
    options = options || {};
    var startedAt = Date.now();
    app.core.appState.transaction(function (state) {
      var change = requireChange(state, id);
      recalculateInState(state, change, {
        audit: options.audit !== false,
        reason: options.reason || "EXPLICIT_RECALCULATION"
      });
    });
    var result = app.domain.engineeringChangeService.getEngineeringChange(id);
    result.impactCalculationMs = Date.now() - startedAt;
    return result;
  }

  function getEngineeringChangeImpact(id) {
    var change = app.domain.engineeringChangeService.getEngineeringChange(id);
    if (!change) return null;
    return {
      engineeringImpactItems: clone(change.engineeringImpactItems || []),
      commodityImpact: clone(change.commodityImpact || []),
      commercialImpactSummary: clone(change.commercialImpactSummary || {}),
      implementationReadiness: clone(change.implementationReadiness || emptyReadiness()),
      impactLastCalculatedAt: change.impactLastCalculatedAt || "",
      impactSourceFingerprints: clone(change.impactSourceFingerprints || {})
    };
  }

  function getImplementationReadiness(id) {
    var change = app.domain.engineeringChangeService.getEngineeringChange(id);
    if (!change) throw notFound("ENGINEERING_CHANGE", id);
    var state = app.core.appState.getState();
    return buildReadiness(state, change, change.commodityImpact || []);
  }

  function captureImplementationBaseline(id) {
    app.core.appState.transaction(function (state) {
      var change = requireChange(state, id);
      captureBaselineInState(state, change);
      recalculateInState(state, change, { audit: true, reason: "IMPLEMENTATION_BASELINE_CAPTURED" });
    });
    return app.domain.engineeringChangeService.getEngineeringChange(id);
  }

  function completeEngineeringReview(id, comment) {
    app.core.appState.transaction(function (state) {
      var change = requireChange(state, id);
      assertImplementing(change);
      recalculateInState(state, change, { audit: false });
      var incompleteBoms = affectedBomIds(change).filter(function (bomId) {
        var bom = findById(state.engineeringBoms, bomId);
        return !bom || bom.completionStatus !== "COMPLETE";
      });
      if (incompleteBoms.length) {
        throw businessError("ECN_ENGINEERING_REVIEW_BLOCKED", "Complete the affected Engineering eBOMs before closing Engineering review.", "ENGINEERING_BOM", incompleteBoms[0]);
      }
      change.engineeringReviewStatus = "COMPLETE";
      if (comment) change.comments = (change.comments || []).concat(makeComment(comment, state.context && state.context.activeRole));
      change.updatedAt = now();
      audit(state, change, "ECN_ENGINEERING_REVIEW_COMPLETED", { affectedBomIds: affectedBomIds(change) });
      recalculateInState(state, change, { audit: false });
    });
    return app.domain.engineeringChangeService.getEngineeringChange(id);
  }

  function completeCommodityReview(id, comment) {
    app.core.appState.transaction(function (state) {
      var change = requireChange(state, id);
      assertImplementing(change);
      recalculateInState(state, change, { audit: false });
      var blocked = (change.commodityImpact || []).filter(function (impact) {
        return impact.impactStatus !== "COMMERCIAL_COMPLETE" && impact.impactStatus !== "OBSOLETE";
      });
      if (blocked.length) {
        throw businessError(
          "ECN_COMMODITY_REVIEW_BLOCKED",
          blocked.length + " affected commercial line(s) still require Supplier or Price review.",
          "COMMERCIAL_LINE",
          blocked[0].commercialLineId || blocked[0].partId
        );
      }
      change.commodityReviewStatus = "COMPLETE";
      if (comment) change.comments = (change.comments || []).concat(makeComment(comment, state.context && state.context.activeRole));
      change.updatedAt = now();
      audit(state, change, "ECN_COMMODITY_REVIEW_COMPLETED", {
        commodities: unique((change.commodityImpact || []).map(function (impact) { return impact.normalizedCommodity; }))
      });
      recalculateInState(state, change, { audit: false });
    });
    return app.domain.engineeringChangeService.getEngineeringChange(id);
  }

  function captureBaselineInState(state, change) {
    if (change.implementationBaseline && change.implementationBaseline.capturedAt &&
      (change.implementationBaseline.source !== "REVISION" || (change.implementationBaseline.items || []).length)) {
      return change.implementationBaseline;
    }
    var revision = latestRevision(state, change.programId, change.seatVariantId);
    if (revision) {
      var revisionIndexes = buildIndexes(state, change);
      var revisionCandidates = collectImpactCandidates(state, change, revisionIndexes);
      change.implementationBaseline = {
        source: "REVISION",
        revisionId: revision.id,
        revisionNumber: revision.revisionNumber || revision.revision,
        snapshotHash: revision.snapshotHash || "",
        capturedAt: now(),
        items: revisionCandidates.map(baselineItemFromCandidate)
      };
      return change.implementationBaseline;
    }
    var indexes = buildIndexes(state, change);
    var candidates = collectImpactCandidates(state, change, indexes);
    change.implementationBaseline = {
      source: "IMPLEMENTATION_START",
      revisionId: "",
      revisionNumber: "",
      snapshotHash: "",
      capturedAt: now(),
      items: candidates.map(baselineItemFromCandidate)
    };
    return change.implementationBaseline;
  }

  function recalculateInState(state, change, options) {
    options = options || {};
    var normalized = app.domain.engineeringChangeService.normalizeEngineeringChange(change);
    Object.keys(normalized).forEach(function (key) { change[key] = normalized[key]; });
    var indexes = buildIndexes(state, change);
    enrichAffectedObjects(change, indexes);
    var baseline = buildBaselineIndex(state, change, indexes);
    var candidates = collectImpactCandidates(state, change, indexes);
    var commodityImpact = candidates.map(function (candidate) {
      return buildCommodityImpact(change, candidate, baseline);
    });
    change.engineeringImpactItems = buildEngineeringImpactItems(change, indexes, baseline);
    change.commodityImpact = commodityImpact;
    change.commercialImpactSummary = summarizeImpact(commodityImpact);
    change.commodityReviewStatus = commodityImpact.length && commodityImpact.every(function (impact) {
      return impact.impactStatus === "COMMERCIAL_COMPLETE" || impact.impactStatus === "OBSOLETE";
    }) ? "COMPLETE" : commodityImpact.length ? "IN_PROGRESS" : "NOT_APPLICABLE";
    change.impactLastCalculatedAt = now();
    change.impactSourceFingerprints = buildFingerprints(change, indexes, baseline);
    change.implementationReadiness = buildReadiness(state, change, commodityImpact);
    change.updatedAt = change.updatedAt || change.impactLastCalculatedAt;
    if (options.audit) {
      audit(state, change, "ECN_IMPACT_RECALCULATED", {
        reason: options.reason || "SOURCE_CHANGED",
        impactedLines: commodityImpact.length,
        commodities: change.commercialImpactSummary.commodityCount,
        suppliers: change.commercialImpactSummary.supplierCount,
        totalsByCurrency: change.commercialImpactSummary.totalsByCurrency
      });
    }
    return change;
  }

  function markAffectedObjectModifiedInState(state, changeId, objectType, objectId, changedFields) {
    if (!changeId) return;
    var change = findChange(state, changeId);
    if (!change || ["APPROVED", "IMPLEMENTING"].indexOf(change.status) === -1) return;
    objectType = normalizeObjectType(objectType);
    var affected = (change.affectedObjects || []).find(function (reference) {
      return normalizeObjectType(reference.objectType) === objectType && reference.objectId === objectId;
    });
    if (affected) {
      affected.disposition = "IMPLEMENTED";
      affected.changedFields = unique((affected.changedFields || []).concat(changedFields || []));
      affected.lastModifiedAt = now();
    }
    audit(state, change, "ECN_ENGINEERING_OBJECT_MODIFIED", {
      objectType: objectType,
      objectId: objectId,
      changedFields: changedFields || []
    });
    recalculateInState(state, change, { audit: false });
  }

  function enrichAffectedObjectInState(state, affected) {
    var fakeChange = { programId: "", seatVariantId: "" };
    var indexes = buildIndexes(state, fakeChange);
    return enrichAffectedObject(affected, indexes);
  }

  function buildIndexes(state, change) {
    var partsById = indexById(state.parts || []);
    var modulesById = indexById(state.engineeringModules || []);
    var bomsById = indexById(state.engineeringBoms || []);
    var bomItemsById = {};
    (state.engineeringBoms || []).forEach(function (bom) {
      (bom.items || []).forEach(function (item) {
        bomItemsById[item.id] = { item: item, bom: bom };
      });
    });
    var structure = (state.engineeringProductStructures || []).find(function (item) {
      return item.programId === change.programId && item.seatVariantId === change.seatVariantId;
    }) || null;
    var epsItemsById = indexById(structure && structure.items || []);
    var assessment = (state.commercialAssessments || []).find(function (item) {
      return item.programId === change.programId && item.seatVariantId === change.seatVariantId;
    }) || null;
    var linesById = indexById(assessment && assessment.lineItems || []);
    var linesByPartId = {};
    var linesByEpsItemId = {};
    (assessment && assessment.lineItems || []).forEach(function (line) {
      if (line.partId) {
        linesByPartId[line.partId] = linesByPartId[line.partId] || [];
        linesByPartId[line.partId].push(line);
      }
      if (line.engineeringProductStructureItemId) linesByEpsItemId[line.engineeringProductStructureItemId] = line;
    });
    return {
      state: state,
      partsById: partsById,
      modulesById: modulesById,
      bomsById: bomsById,
      bomItemsById: bomItemsById,
      structure: structure,
      epsItemsById: epsItemsById,
      assessment: assessment,
      linesById: linesById,
      linesByPartId: linesByPartId,
      linesByEpsItemId: linesByEpsItemId
    };
  }

  function enrichAffectedObjects(change, indexes) {
    change.affectedObjects = (change.affectedObjects || []).map(function (affected) {
      return enrichAffectedObject(affected, indexes);
    });
  }

  function enrichAffectedObject(affected, indexes) {
    affected = Object.assign({}, affected || {});
    affected.objectType = normalizeObjectType(affected.objectType);
    var part = null;
    var bom = null;
    var bomItem = null;
    var epsItem = null;
    var line = null;
    if (affected.objectType === "PART") part = indexes.partsById[affected.objectId];
    if (affected.objectType === "ENGINEERING_BOM") bom = indexes.bomsById[affected.objectId];
    if (affected.objectType === "ENGINEERING_BOM_ITEM" && indexes.bomItemsById[affected.objectId]) {
      bomItem = indexes.bomItemsById[affected.objectId].item;
      bom = indexes.bomItemsById[affected.objectId].bom;
      part = indexes.partsById[bomItem.childPartId];
    }
    if (affected.objectType === "ENGINEERING_PRODUCT_STRUCTURE_ITEM") {
      epsItem = indexes.epsItemsById[affected.objectId];
      part = epsItem && indexes.partsById[epsItem.partId];
      bom = epsItem && indexes.bomsById[epsItem.sourceEngineeringBomId];
      bomItem = epsItem && indexes.bomItemsById[epsItem.sourceBomItemId] && indexes.bomItemsById[epsItem.sourceBomItemId].item;
    }
    if (affected.objectType === "COMMERCIAL_LINE") {
      line = indexes.linesById[affected.objectId];
      part = line && indexes.partsById[line.partId];
      epsItem = line && indexes.epsItemsById[line.engineeringProductStructureItemId];
      bom = epsItem && indexes.bomsById[epsItem.sourceEngineeringBomId];
      bomItem = epsItem && indexes.bomItemsById[epsItem.sourceBomItemId] && indexes.bomItemsById[epsItem.sourceBomItemId].item;
    }
    affected.partId = affected.partId || part && part.id || "";
    affected.sourceBomId = affected.sourceBomId || bom && bom.id || epsItem && epsItem.sourceEngineeringBomId || "";
    affected.sourceBomItemId = affected.sourceBomItemId || bomItem && bomItem.id || epsItem && epsItem.sourceBomItemId || "";
    affected.commercialLineId = affected.commercialLineId || line && line.id || "";
    var module = bom && indexes.modulesById[bom.engineeringModuleId] || epsItem && indexes.modulesById[epsItem.sourceEngineeringModuleId];
    affected.sourceDiscipline = affected.sourceDiscipline || module && (module.name || module.code) || "";
    return affected;
  }

  function collectImpactCandidates(state, change, indexes) {
    var candidates = {};
    function addCandidate(line, part, epsItem, bom, bomItem, affected) {
      var candidate = {
        line: line || null,
        part: part || line && indexes.partsById[line.partId] || null,
        epsItem: epsItem || line && indexes.epsItemsById[line.engineeringProductStructureItemId] || null,
        bom: bom || null,
        bomItem: bomItem || null,
        affected: affected,
        assessment: indexes.assessment,
        module: null
      };
      if (!candidate.bom && candidate.epsItem) candidate.bom = indexes.bomsById[candidate.epsItem.sourceEngineeringBomId] || null;
      if (!candidate.bomItem && candidate.epsItem && indexes.bomItemsById[candidate.epsItem.sourceBomItemId]) {
        candidate.bomItem = indexes.bomItemsById[candidate.epsItem.sourceBomItemId].item;
      }
      candidate.module = candidate.bom && indexes.modulesById[candidate.bom.engineeringModuleId] ||
        candidate.epsItem && indexes.modulesById[candidate.epsItem.sourceEngineeringModuleId] || null;
      var key = candidateKey(candidate);
      if (!candidates[key]) candidates[key] = candidate;
    }
    (change.affectedObjects || []).forEach(function (affected) {
      var type = normalizeObjectType(affected.objectType);
      if (type === "PART") {
        var partLines = indexes.linesByPartId[affected.objectId] || [];
        if (partLines.length) partLines.forEach(function (line) { addCandidate(line, indexes.partsById[affected.objectId], null, null, null, affected); });
        else addCandidate(null, indexes.partsById[affected.objectId], null, null, null, affected);
      } else if (type === "ENGINEERING_BOM") {
        var affectedBom = indexes.bomsById[affected.objectId];
        (affectedBom && affectedBom.items || []).forEach(function (item) {
          var matching = (indexes.linesByPartId[item.childPartId] || []).filter(function (line) {
            var eps = indexes.epsItemsById[line.engineeringProductStructureItemId];
            return !eps || eps.sourceEngineeringBomId === affectedBom.id;
          });
          if (matching.length) matching.forEach(function (line) { addCandidate(line, indexes.partsById[item.childPartId], null, affectedBom, item, affected); });
        });
      } else if (type === "ENGINEERING_BOM_ITEM") {
        var entry = indexes.bomItemsById[affected.objectId];
        if (entry) {
          var itemLines = (indexes.linesByPartId[entry.item.childPartId] || []).filter(function (line) {
            var eps = indexes.epsItemsById[line.engineeringProductStructureItemId];
            return !eps || eps.sourceBomItemId === entry.item.id;
          });
          if (itemLines.length) itemLines.forEach(function (line) { addCandidate(line, indexes.partsById[entry.item.childPartId], null, entry.bom, entry.item, affected); });
          else addCandidate(null, indexes.partsById[entry.item.childPartId], null, entry.bom, entry.item, affected);
        }
      } else if (type === "ENGINEERING_PRODUCT_STRUCTURE") {
        (indexes.assessment && indexes.assessment.lineItems || []).forEach(function (line) { addCandidate(line, null, null, null, null, affected); });
      } else if (type === "ENGINEERING_PRODUCT_STRUCTURE_ITEM") {
        var epsItem = indexes.epsItemsById[affected.objectId];
        var epsLine = indexes.linesByEpsItemId[affected.objectId];
        addCandidate(epsLine, epsItem && indexes.partsById[epsItem.partId], epsItem, null, null, affected);
      } else if (type === "COMMERCIAL_ASSESSMENT") {
        (indexes.assessment && indexes.assessment.lineItems || []).forEach(function (line) { addCandidate(line, null, null, null, null, affected); });
      } else if (type === "COMMERCIAL_LINE") {
        var line = indexes.linesById[affected.objectId];
        if (line) addCandidate(line, null, null, null, null, affected);
      }
    });
    return Object.keys(candidates).sort().map(function (key) { return candidates[key]; });
  }

  function candidateKey(candidate) {
    return candidate.line && ("LINE|" + candidate.line.id) ||
      candidate.epsItem && ("EPSITEM|" + candidate.epsItem.id) ||
      candidate.bomItem && ("BOMITEM|" + candidate.bomItem.id) ||
      candidate.part && ("PART|" + candidate.part.id) ||
      "UNKNOWN";
  }

  function buildBaselineIndex(state, change, indexes) {
    var revision = latestRevision(state, change.programId, change.seatVariantId);
    if (revision) {
      if (change.status === "IMPLEMENTING" && (!change.implementationBaseline || !(change.implementationBaseline.items || []).length)) {
        change.implementationBaseline = {
          source: "REVISION",
          revisionId: revision.id,
          revisionNumber: revision.revisionNumber || revision.revision,
          snapshotHash: revision.snapshotHash || "",
          capturedAt: now(),
          items: collectImpactCandidates(state, change, indexes).map(baselineItemFromCandidate)
        };
      }
      var revisionIndex = revisionBaseline(revision);
      revisionIndex.fallbackValuesByKey = {};
      ((change.implementationBaseline && change.implementationBaseline.items) || []).forEach(function (entry) {
        revisionIndex.fallbackValuesByKey[entry.key] = entry.values || {};
        if (entry.commercialLineId) revisionIndex.fallbackValuesByKey["LINE|" + entry.commercialLineId] = entry.values || {};
        if (entry.engineeringProductStructureItemId) revisionIndex.fallbackValuesByKey["EPSITEM|" + entry.engineeringProductStructureItemId] = entry.values || {};
        if (entry.sourceBomItemId) revisionIndex.fallbackValuesByKey["BOMITEM|" + entry.sourceBomItemId] = entry.values || {};
        if (entry.partId && !revisionIndex.fallbackValuesByKey["PART|" + entry.partId]) {
          revisionIndex.fallbackValuesByKey["PART|" + entry.partId] = entry.values || {};
        }
      });
      return revisionIndex;
    }
    var stored = {};
    ((change.implementationBaseline && change.implementationBaseline.items) || []).forEach(function (entry) {
      stored[entry.key] = entry.values || {};
      if (entry.commercialLineId) stored["LINE|" + entry.commercialLineId] = entry.values || {};
      if (entry.engineeringProductStructureItemId) stored["EPSITEM|" + entry.engineeringProductStructureItemId] = entry.values || {};
      if (entry.sourceBomItemId) stored["BOMITEM|" + entry.sourceBomItemId] = entry.values || {};
      if (entry.partId && !stored["PART|" + entry.partId]) stored["PART|" + entry.partId] = entry.values || {};
    });
    return { source: "IMPLEMENTATION_START", valuesByKey: stored, revisionId: "" };
  }

  function revisionBaseline(revision) {
    var parts = indexById(revision.partsSnapshot || []);
    var bomItems = {};
    (revision.engineeringBomSnapshots || []).forEach(function (bom) {
      (bom.items || []).forEach(function (item) { bomItems[item.id] = { item: item, bom: bom }; });
    });
    var epsItems = indexById((revision.engineeringProductStructureSnapshot || {}).items || []);
    var lines = (revision.commercialAssessmentSnapshot || {}).lineItems || [];
    var lineById = indexById(lines);
    var lineBySourceId = {};
    var lineByEps = {};
    var lineBySourceEps = {};
    var lineByBomItem = {};
    var linesByPart = {};
    lines.forEach(function (line) {
      if (line.sourceCommercialLineId) lineBySourceId[line.sourceCommercialLineId] = line;
      lineByEps[line.engineeringProductStructureItemId] = line;
      if (line.sourceEngineeringProductStructureItemId) lineBySourceEps[line.sourceEngineeringProductStructureItemId] = line;
      var sourceEpsItem = epsItems[line.engineeringProductStructureItemId];
      if (sourceEpsItem && sourceEpsItem.sourceBomItemId) lineByBomItem[sourceEpsItem.sourceBomItemId] = line;
      linesByPart[line.partId] = linesByPart[line.partId] || [];
      linesByPart[line.partId].push(line);
    });
    return {
      source: "REVISION",
      revisionId: revision.id,
      revisionNumber: revision.revisionNumber || revision.revision,
      parts: parts,
      bomItems: bomItems,
      epsItems: epsItems,
      lineById: lineById,
      lineBySourceId: lineBySourceId,
      lineByEps: lineByEps,
      lineBySourceEps: lineBySourceEps,
      lineByBomItem: lineByBomItem,
      linesByPart: linesByPart,
      hasSourceIdentity: lines.some(function (line) { return Boolean(line.sourceCommercialLineId); }),
      valuesByKey: {}
    };
  }

  function previousValues(candidate, baseline) {
    var key = candidateKey(candidate);
    if (baseline.valuesByKey && baseline.valuesByKey[key]) return clone(baseline.valuesByKey[key]);
    if (baseline.source !== "REVISION") return currentValues(candidate);
    var fallback = baseline.fallbackValuesByKey && (baseline.fallbackValuesByKey[key] ||
      candidate.line && baseline.fallbackValuesByKey["LINE|" + candidate.line.id] ||
      candidate.epsItem && baseline.fallbackValuesByKey["EPSITEM|" + candidate.epsItem.id] ||
      candidate.bomItem && baseline.fallbackValuesByKey["BOMITEM|" + candidate.bomItem.id]);
    if (fallback) return clone(fallback);
    var currentLine = candidate.line || {};
    var currentPartLines = (candidate.assessment && candidate.assessment.lineItems || []).filter(function (line) {
      return line.partId === currentLine.partId;
    });
    var occurrence = currentPartLines.findIndex(function (line) { return line.id === currentLine.id; });
    var identityMatchedLine = matchCommercialIdentity(currentLine, baseline.linesByPart[currentLine.partId] || []);
    var previousLine = baseline.lineById[currentLine.id] ||
      baseline.lineBySourceId[currentLine.id] ||
      baseline.lineById[compactRevisionId("CL", currentLine.id)] ||
      baseline.lineByEps[currentLine.engineeringProductStructureItemId] ||
      baseline.lineBySourceEps[currentLine.engineeringProductStructureItemId] ||
      baseline.lineByEps[compactRevisionId("GI", currentLine.engineeringProductStructureItemId)] ||
      identityMatchedLine ||
      candidate.bomItem && baseline.lineByBomItem[candidate.bomItem.id] ||
      occurrence >= 0 && (baseline.linesByPart[currentLine.partId] || [])[occurrence] ||
      (baseline.linesByPart[currentLine.partId] || [])[0] || null;
    var previousEps = previousLine && baseline.epsItems[previousLine.engineeringProductStructureItemId] ||
      candidate.epsItem && baseline.epsItems[candidate.epsItem.id] || null;
    var previousPart = candidate.part && baseline.parts[candidate.part.id] ||
      previousLine && baseline.parts[previousLine.partId] || null;
    var previousBomEntry = candidate.bomItem && baseline.bomItems[candidate.bomItem.id] ||
      previousEps && baseline.bomItems[previousEps.sourceBomItemId] || null;
    return valuesFromSources(previousPart, previousBomEntry && previousBomEntry.item, previousEps, previousLine);
  }

  function currentValues(candidate) {
    return valuesFromSources(candidate.part, candidate.bomItem, candidate.epsItem, candidate.line);
  }

  function baselineItemFromCandidate(candidate) {
    return {
      key: candidateKey(candidate),
      partId: candidate.part && candidate.part.id || "",
      commercialLineId: candidate.line && candidate.line.id || "",
      engineeringProductStructureItemId: candidate.epsItem && candidate.epsItem.id || "",
      sourceBomItemId: candidate.bomItem && candidate.bomItem.id || candidate.epsItem && candidate.epsItem.sourceBomItemId || "",
      values: currentValues(candidate)
    };
  }

  function matchCommercialIdentity(current, candidates) {
    if (!current || !(candidates || []).length) return null;
    var scored = (candidates || []).map(function (candidate, index) {
      var score = 0;
      if (current.supplierPartNumber && current.supplierPartNumber === candidate.supplierPartNumber) score += 16;
      if (current.supplier && current.supplier === candidate.supplier) score += 8;
      if (current.poNumber && current.poNumber === candidate.poNumber) score += 4;
      if (current.currency && current.currency === candidate.currency) score += 2;
      if (Boolean(number(current.piecePrice)) === Boolean(number(candidate.piecePrice))) score += 2;
      if ((current.sourcingStatus || "") === (candidate.sourcingStatus || "")) score += 1;
      if (number(current.piecePrice) === number(candidate.piecePrice)) score += 1;
      return { line: candidate, score: score, index: index };
    }).sort(function (left, right) { return right.score - left.score || left.index - right.index; });
    return scored[0] && scored[0].score > 2 ? scored[0].line : null;
  }

  function valuesFromSources(part, bomItem, epsItem, line) {
    part = part || {};
    bomItem = bomItem || {};
    epsItem = epsItem || {};
    line = line || {};
    var snapshot = line.sourcePartSnapshot || epsItem.sourcePartSnapshot || {};
    return {
      partRevision: part.currentRevision || part.revision || snapshot.revision || "",
      drawingRevision: part.drawingRevision || snapshot.drawingRevision || "",
      material: part.material || snapshot.material || "",
      quantity: number(line.quantity || epsItem.calculatedQuantity || epsItem.quantity || bomItem.quantity || 0),
      changeClassification: epsItem.changeClassification || bomItem.changeClassification || snapshot.changeClassification || "",
      commodity: part.commodity || snapshot.commodity || "",
      supplier: line.supplier || "",
      supplierPartNumber: line.supplierPartNumber || "",
      unitRate: number(line.piecePrice),
      currency: line.currency || "",
      tooling: number(line.toolingCost),
      logistics: number(line.logisticsCost),
      sourcingStatus: line.sourcingStatus || "",
      commercialStatus: line.commercialStatus || "",
      obsolete: Boolean(line.obsolete || line.sourcingStatus === "OBSOLETE" || (epsItem.changeClassification || bomItem.changeClassification) === "DELETED")
    };
  }

  function buildCommodityImpact(change, candidate, baseline) {
    var current = currentValues(candidate);
    var previous = previousValues(candidate, baseline);
    var commodity = normalizeCommodity(current.commodity || previous.commodity);
    var previousPieceCost = previous.quantity * previous.unitRate;
    var currentPieceCost = current.quantity * current.unitRate;
    var sameCurrency = !previous.currency || !current.currency || previous.currency === current.currency;
    var costDelta = sameCurrency
      ? currentPieceCost - previousPieceCost + (current.tooling - previous.tooling) + (current.logistics - previous.logistics)
      : null;
    return {
      id: "ECNI-" + normalizeId(change.id + "-" + candidateKey(candidate)),
      partId: candidate.part && candidate.part.id || candidate.line && candidate.line.partId || "",
      partNumber: candidate.part && candidate.part.partNumber || candidate.line && candidate.line.sourcePartSnapshot && candidate.line.sourcePartSnapshot.partNumber || "",
      commercialAssessmentId: candidate.assessment && candidate.assessment.id || "",
      commercialLineId: candidate.line && candidate.line.id || "",
      engineeringProductStructureItemId: candidate.epsItem && candidate.epsItem.id || candidate.line && candidate.line.engineeringProductStructureItemId || "",
      sourceBomId: candidate.bom && candidate.bom.id || candidate.epsItem && candidate.epsItem.sourceEngineeringBomId || "",
      sourceBomItemId: candidate.bomItem && candidate.bomItem.id || candidate.epsItem && candidate.epsItem.sourceBomItemId || "",
      sourceDiscipline: sourceDiscipline(candidate),
      commodity: commodity.label,
      originalCommodity: current.commodity || previous.commodity || "",
      normalizedCommodity: commodity.key,
      commodityManager: candidate.line && candidate.line.commodityManager || "",
      sta: candidate.line && candidate.line.sta || "",
      supplier: current.supplier,
      supplierPartNumber: current.supplierPartNumber,
      previousCurrency: previous.currency,
      currency: current.currency,
      previousUnitRate: previous.unitRate,
      currentUnitRate: current.unitRate,
      previousQuantity: previous.quantity,
      currentQuantity: current.quantity,
      previousPieceCost: previousPieceCost,
      currentPieceCost: currentPieceCost,
      previousTooling: previous.tooling,
      tooling: current.tooling,
      previousLogistics: previous.logistics,
      logistics: current.logistics,
      toolingDelta: current.tooling - previous.tooling,
      logisticsDelta: current.logistics - previous.logistics,
      costDelta: costDelta,
      mixedCurrency: !sameCurrency,
      sourcingStatus: current.sourcingStatus,
      commercialStatus: current.commercialStatus,
      impactStatus: deriveImpactStatus(current, commodity),
      previousValues: previous,
      currentValues: current
    };
  }

  function sourceDiscipline(candidate) {
    return candidate.affected && candidate.affected.sourceDiscipline ||
      candidate.module && (candidate.module.name || candidate.module.code) || "";
  }

  function deriveImpactStatus(current, commodity) {
    if (current.obsolete) return "OBSOLETE";
    if (!current.supplier) return "SUPPLIER_REVIEW_REQUIRED";
    if (!current.currency || current.unitRate <= 0) return "PRICE_REVIEW_REQUIRED";
    if (commodity.key !== "__UNASSIGNED__" && current.supplier && current.currency && current.unitRate > 0 &&
      current.sourcingStatus && ["NOT_SOURCED", "RFQ", "OBSOLETE"].indexOf(current.sourcingStatus) === -1) {
      return "COMMERCIAL_COMPLETE";
    }
    return "ENGINEERING_IMPACT";
  }

  function buildEngineeringImpactItems(change, indexes, baseline) {
    return (change.affectedObjects || []).filter(function (affected) {
      return ENGINEERING_TYPES[normalizeObjectType(affected.objectType)];
    }).map(function (affected) {
      var target = engineeringTarget(affected, indexes);
      var current = target ? currentValues(target) : {};
      var previous = target ? previousValues(target, baseline) : {};
      return {
        objectType: affected.objectType,
        objectId: affected.objectId,
        partId: affected.partId || target && target.part && target.part.id || "",
        sourceDiscipline: affected.sourceDiscipline || "",
        sourceBomId: affected.sourceBomId || "",
        sourceBomItemId: affected.sourceBomItemId || "",
        previousValues: previous,
        currentValues: current,
        changedFields: changedFields(previous, current),
        status: affected.disposition === "IMPLEMENTED" || affected.disposition === "COMPLETE" ? "COMPLETE" : "IN_PROGRESS"
      };
    });
  }

  function engineeringTarget(affected, indexes) {
    var type = normalizeObjectType(affected.objectType);
    var part = type === "PART" ? indexes.partsById[affected.objectId] : affected.partId && indexes.partsById[affected.partId];
    var entry = type === "ENGINEERING_BOM_ITEM" ? indexes.bomItemsById[affected.objectId] : affected.sourceBomItemId && indexes.bomItemsById[affected.sourceBomItemId];
    var epsItem = type === "ENGINEERING_PRODUCT_STRUCTURE_ITEM" ? indexes.epsItemsById[affected.objectId] : null;
    var line = affected.commercialLineId && indexes.linesById[affected.commercialLineId] || epsItem && indexes.linesByEpsItemId[epsItem.id] || null;
    return {
      affected: affected,
      part: part || line && indexes.partsById[line.partId] || null,
      bom: entry && entry.bom || affected.sourceBomId && indexes.bomsById[affected.sourceBomId] || null,
      bomItem: entry && entry.item || null,
      epsItem: epsItem,
      line: line
    };
  }

  function summarizeImpact(impacts) {
    var commodities = {};
    var suppliers = {};
    var totals = {};
    (impacts || []).forEach(function (impact) {
      commodities[impact.normalizedCommodity || "__UNASSIGNED__"] = true;
      if (impact.supplier) suppliers[impact.supplier] = true;
      if (impact.mixedCurrency) {
        addCurrency(totals, impact.previousCurrency || "UNSPECIFIED", -impact.previousPieceCost - impact.previousTooling - impact.previousLogistics);
        addCurrency(totals, impact.currency || "UNSPECIFIED", impact.currentPieceCost + impact.tooling + impact.logistics);
      } else {
        addCurrency(totals, impact.currency || impact.previousCurrency || "UNSPECIFIED", number(impact.costDelta));
      }
    });
    return {
      affectedLineCount: (impacts || []).length,
      commodityCount: Object.keys(commodities).length,
      supplierCount: Object.keys(suppliers).length,
      totalsByCurrency: Object.keys(totals).sort().map(function (currency) {
        return { currency: currency, costDelta: round(totals[currency]) };
      }),
      mixedCurrency: Object.keys(totals).filter(function (currency) { return currency !== "UNSPECIFIED"; }).length > 1
    };
  }

  function buildReadiness(state, change, impacts) {
    var checks = [];
    function add(id, label, passed, message, objectType, objectId) {
      checks.push({ id: id, condition: label, status: passed ? "COMPLETE" : "BLOCKED", blockingMessage: passed ? "" : message, objectType: objectType || "", objectId: objectId || "" });
    }
    var engineeringAffected = (change.affectedObjects || []).filter(function (affected) { return ENGINEERING_TYPES[normalizeObjectType(affected.objectType)]; });
    var boms = affectedBomIds(change).map(function (id) { return findById(state.engineeringBoms, id); }).filter(Boolean);
    add("AFFECTED_OBJECTS", "Affected objects identified", Boolean((change.affectedObjects || []).length), "Add at least one affected object.", "ENGINEERING_CHANGE", change.id);
    add("ENGINEERING_REVIEW", "Engineering impact reviewed", !engineeringAffected.length || change.engineeringReviewStatus === "COMPLETE", "Complete Engineering impact review.", "ENGINEERING_CHANGE", change.id);
    boms.forEach(function (bom) {
      add("BOM_COMPLETE_" + bom.id, "Affected " + bom.id + " complete", bom.completionStatus === "COMPLETE", "Complete the affected Engineering eBOM.", "ENGINEERING_BOM", bom.id);
    });
    var structure = (state.engineeringProductStructures || []).find(function (item) { return item.programId === change.programId && item.seatVariantId === change.seatVariantId; });
    var assessment = (state.commercialAssessments || []).find(function (item) { return item.programId === change.programId && item.seatVariantId === change.seatVariantId; });
    add("EPS_CURRENT", "Complete Seat JIT current", Boolean(structure && structure.generationStatus === "CURRENT"), "Regenerate Complete Seat JIT.", "ENGINEERING_PRODUCT_STRUCTURE", structure && structure.id);
    add("COMMERCIAL_CURRENT", "Commercial Assessment current", Boolean(assessment && assessment.generationStatus === "CURRENT"), "Regenerate Commercial Assessment.", "COMMERCIAL_ASSESSMENT", assessment && assessment.id);
    var unresolved = (impacts || []).filter(function (impact) { return impact.impactStatus !== "COMMERCIAL_COMPLETE" && impact.impactStatus !== "OBSOLETE"; });
    add("COMMODITY_REVIEW", "Commodity review complete", unresolved.length === 0, commercialReviewMessage(unresolved), "COMMERCIAL_LINE", unresolved[0] && unresolved[0].commercialLineId);
    var blockingErrors = checks.filter(function (check) { return check.status === "BLOCKED"; }).map(function (check) {
      return { code: "ECN_READINESS_" + check.id, message: check.blockingMessage, objectType: check.objectType, objectId: check.objectId };
    });
    return {
      ready: blockingErrors.length === 0,
      checks: checks,
      blockingErrors: blockingErrors,
      calculatedAt: now()
    };
  }

  function commercialReviewMessage(unresolved) {
    if (!unresolved.length) return "";
    var impact = unresolved[0];
    var part = impact.partNumber || "the affected Part";
    var action = "complete its commercial review";
    if (impact.impactStatus === "SUPPLIER_REVIEW_REQUIRED") action = "enter Supplier, Currency, Unit Rate and Sourcing Status";
    else if (impact.impactStatus === "PRICE_REVIEW_REQUIRED") action = "enter Currency, a positive Unit Rate and Sourcing Status";
    else if (impact.impactStatus === "ENGINEERING_IMPACT" && impact.normalizedCommodity === "__UNASSIGNED__") action = "assign its Engineering Commodity, then complete Supplier and Price data";
    else if (impact.impactStatus === "ENGINEERING_IMPACT") action = "complete Supplier, Price and Sourcing Status data";
    var remaining = unresolved.length > 1 ? " " + (unresolved.length - 1) + " additional affected line(s) also require review." : "";
    return "Open Commercial Assessment for Part " + part + " and " + action + "." + remaining;
  }

  function affectedBomIds(change) {
    var ids = {};
    (change.affectedObjects || []).forEach(function (affected) {
      if (normalizeObjectType(affected.objectType) === "ENGINEERING_BOM" && affected.objectId) ids[affected.objectId] = true;
      if (affected.sourceBomId) ids[affected.sourceBomId] = true;
    });
    return Object.keys(ids);
  }

  function buildFingerprints(change, indexes, baseline) {
    return {
      baselineSource: baseline.source,
      baselineRevisionId: baseline.revisionId || "",
      affectedObjects: stableStringify((change.affectedObjects || []).map(function (affected) {
        return [affected.objectType, affected.objectId, affected.disposition, affected.changedFields || []];
      })),
      engineeringValues: stableStringify(change.engineeringImpactItems || []),
      completeSeat: stableStringify(indexes.structure ? {
        id: indexes.structure.id,
        generationVersion: indexes.structure.generationVersion,
        generationStatus: indexes.structure.generationStatus,
        sourceFingerprints: indexes.structure.sourceEngineeringBomFingerprints
      } : null),
      commercialAssessment: stableStringify(indexes.assessment ? {
        id: indexes.assessment.id,
        generationVersion: indexes.assessment.generationVersion,
        generationStatus: indexes.assessment.generationStatus,
        lines: (indexes.assessment.lineItems || []).map(function (line) {
          return [line.id, line.partId, line.quantity, line.supplier, line.currency, line.piecePrice, line.toolingCost, line.logisticsCost, line.sourcingStatus, line.commercialStatus, line.obsolete];
        })
      } : null)
    };
  }

  function latestRevision(state, programId, seatVariantId) {
    return (state.revisions || []).filter(function (revision) {
      return revision.programId === programId && revision.seatVariantId === seatVariantId && (revision.lifecycleStatus === "RELEASED" || revision.status === "RELEASED");
    }).sort(function (a, b) {
      return String(b.releasedAt || b.createdAt || "").localeCompare(String(a.releasedAt || a.createdAt || ""));
    })[0] || null;
  }

  function changedFields(previous, current) {
    return ["partRevision", "drawingRevision", "material", "quantity", "changeClassification", "commodity", "supplier", "supplierPartNumber", "unitRate", "currency", "tooling", "logistics", "sourcingStatus"].filter(function (field) {
      return stableStringify(previous && previous[field]) !== stableStringify(current && current[field]);
    });
  }

  function normalizeCommodity(value) {
    var original = String(value == null ? "" : value).trim().replace(/\s+/g, " ");
    if (!original || /^[-–—]+$/.test(original)) return { key: "__UNASSIGNED__", label: "Unassigned Commodity" };
    return {
      key: original.toUpperCase(),
      label: original.toLowerCase().replace(/(^|[\s/()_-])([a-z])/g, function (_, prefix, letter) { return prefix + letter.toUpperCase(); })
    };
  }

  function normalizeObjectType(value) {
    var type = String(value || "").trim().toUpperCase().replace(/[\s-]+/g, "_");
    if (type === "BOM" || type === "EBOM") return "ENGINEERING_BOM";
    if (type === "BOM_ITEM" || type === "EBOM_ITEM") return "ENGINEERING_BOM_ITEM";
    if (type === "COMPLETE_SEAT" || type === "EPS") return "ENGINEERING_PRODUCT_STRUCTURE";
    if (type === "COMPLETE_SEAT_ITEM" || type === "EPS_ITEM") return "ENGINEERING_PRODUCT_STRUCTURE_ITEM";
    if (type === "COMMERCIAL" || type === "COMMERCIAL_ASSESSMENT_LINE") return "COMMERCIAL_LINE";
    return type;
  }

  function findChange(state, id) {
    return (state.engineeringChanges || []).find(function (change) {
      return change.id === id || change.changeNumber === id || change.ecnNumber === id;
    }) || null;
  }

  function requireChange(state, id) {
    var change = findChange(state, id);
    if (!change) throw notFound("ENGINEERING_CHANGE", id);
    return change;
  }

  function assertImplementing(change) {
    if (change.status !== "IMPLEMENTING") {
      throw businessError("ECN_REVIEW_STATUS_INVALID", "Engineering Change must be IMPLEMENTING before review can be completed.", "ENGINEERING_CHANGE", change.id);
    }
  }

  function audit(state, change, action, details) {
    app.core.appState._recordAuditEvent(state, {
      objectType: "ENGINEERING_CHANGE",
      objectId: change.id,
      action: action,
      details: JSON.stringify(Object.assign({
        engineeringChangeId: change.id,
        changeNumber: change.changeNumber,
        programId: change.programId,
        seatVariantId: change.seatVariantId
      }, details || {}))
    });
  }

  function addCurrency(totals, currency, delta) {
    totals[currency] = number(totals[currency]) + number(delta);
  }

  function emptyReadiness() {
    return { ready: false, checks: [], blockingErrors: [], calculatedAt: "" };
  }

  function makeComment(text, role) {
    return { id: "COMMENT-" + Date.now().toString(36), text: String(text || "").trim(), createdBy: role || "", createdAt: now() };
  }

  function indexById(items) {
    var result = {};
    (items || []).forEach(function (item) { if (item && item.id) result[item.id] = item; });
    return result;
  }

  function unique(values) {
    var seen = {};
    return (values || []).filter(function (value) {
      if (!value || seen[value]) return false;
      seen[value] = true;
      return true;
    });
  }

  function findById(items, id) {
    return (items || []).find(function (item) { return item.id === id; }) || null;
  }

  function number(value) {
    var numeric = Number(value);
    return isNaN(numeric) ? 0 : numeric;
  }

  function compactRevisionId(prefix, value) {
    if (!value) return "";
    var text = String(value);
    var hash = 2166136261;
    for (var index = 0; index < text.length; index += 1) {
      hash ^= text.charCodeAt(index);
      hash += (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24);
    }
    return prefix + "-" + (hash >>> 0).toString(16).toUpperCase().padStart(8, "0");
  }

  function round(value) {
    return Math.round(number(value) * 100) / 100;
  }

  function clone(value) {
    return JSON.parse(JSON.stringify(value == null ? null : value));
  }

  function stableStringify(value) {
    if (value === null || typeof value !== "object") return JSON.stringify(value);
    if (Array.isArray(value)) return "[" + value.map(stableStringify).join(",") + "]";
    return "{" + Object.keys(value).sort().map(function (key) {
      return JSON.stringify(key) + ":" + stableStringify(value[key]);
    }).join(",") + "}";
  }

  function normalizeId(value) {
    return String(value || "").toUpperCase().replace(/[^A-Z0-9]+/g, "-").replace(/^-|-$/g, "");
  }

  function now() {
    return new Date().toISOString();
  }

  function notFound(objectType, id) {
    return new app.core.errors.BusinessOperationError(objectType + " was not found.", [
      { code: objectType + "_NOT_FOUND", message: objectType + " was not found.", objectType: objectType, objectId: id }
    ]);
  }

  function businessError(code, message, objectType, objectId) {
    return new app.core.errors.BusinessOperationError(message, [
      { code: code, message: message, objectType: objectType, objectId: objectId || null }
    ]);
  }

  app.domain.engineeringChangeImpactService = {
    IMPACT_STATUSES: IMPACT_STATUSES.slice(),
    recalculateEngineeringChangeImpact: recalculateEngineeringChangeImpact,
    getEngineeringChangeImpact: getEngineeringChangeImpact,
    getImplementationReadiness: getImplementationReadiness,
    captureImplementationBaseline: captureImplementationBaseline,
    completeEngineeringReview: completeEngineeringReview,
    completeCommodityReview: completeCommodityReview,
    _captureImplementationBaselineInState: captureBaselineInState,
    _recalculateInState: recalculateInState,
    _markAffectedObjectModifiedInState: markAffectedObjectModifiedInState,
    _enrichAffectedObjectInState: enrichAffectedObjectInState,
    _buildReadinessInState: buildReadiness
  };
})(typeof window !== "undefined" ? (window.DEP = window.DEP || {}) : (globalThis.DEP = globalThis.DEP || {}));
