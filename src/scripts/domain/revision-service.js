(function (app) {
  app.domain = app.domain || {};

  var RELEASED = "RELEASED";

  function getRevision(id) {
    var revision = app.core.appState.getById("revisions", id);
    return revision ? normalizeRevision(revision) : null;
  }

  function getRevisionHistory(criteria) {
    criteria = criteria || {};
    var context = app.core.contextService.getContext();
    var programId = criteria.programId || context.activeProgramId;
    var seatVariantId = criteria.seatVariantId || context.activeSeatVariantId;
    return app.core.appState.getCollection("revisions")
      .map(normalizeRevision)
      .filter(function (revision) {
        return (!programId || revision.programId === programId) &&
          (!seatVariantId || revision.seatVariantId === seatVariantId);
      })
      .sort(compareRevisionsByNumber);
  }

  function validateRevisionReadiness(criteria) {
    criteria = criteria || {};
    if (app.domain.engineeringProductStructureService) {
      app.domain.engineeringProductStructureService.detectEngineeringProductStructureStaleness(criteria);
    }
    if (app.domain.commercialAssessmentService) {
      app.domain.commercialAssessmentService.detectCommercialAssessmentStaleness(criteria);
    }
    return validateReadinessFromState(app.core.appState.getState(), criteria);
  }

  function createRevision(input) {
    input = input || {};
    if (app.domain.engineeringProductStructureService) {
      app.domain.engineeringProductStructureService.detectEngineeringProductStructureStaleness(input);
    }
    if (app.domain.commercialAssessmentService) {
      app.domain.commercialAssessmentService.detectCommercialAssessmentStaleness(input);
    }
    return app.core.appState.transaction(function (state) {
      var readiness = validateReadinessFromState(state, input);
      if (!readiness.releaseAllowed) {
        throw new app.core.errors.BusinessOperationError("Revision readiness validation failed.", readiness.blockingErrors);
      }
      var revisionNumber = input.revisionNumber ? normalizeRevisionNumber(input.revisionNumber) : getNextRevisionNumber(state, readiness.seatVariant.id);
      if (findRevisionByNumber(state, readiness.seatVariant.id, revisionNumber)) {
        throw businessError("REVISION_NUMBER_DUPLICATE", "Revision Number must be unique within a Seat Variant.", "REVISION", revisionNumber);
      }
      if (state.revisions.some(function (revision) { return normalizeRevision(revision).engineeringChangeId === readiness.change.id; })) {
        throw businessError("REVISION_CHANGE_DUPLICATE", "An implemented Engineering Change can create only one Revision.", "ENGINEERING_CHANGE", readiness.change.id);
      }
      var revision = buildRevisionSnapshot(state, readiness, revisionNumber, input);
      validateRevision(revision, state, null);
      state.revisions.push(revision);
      var changeIndex = (state.engineeringChanges || []).findIndex(function (change) {
        return change.id === readiness.change.id;
      });
      if (changeIndex !== -1) {
        state.engineeringChanges[changeIndex].resultingRevisionId = revision.id;
        state.engineeringChanges[changeIndex].updatedAt = revision.releasedAt;
      }
      app.core.appState._recordAuditEvent(state, {
        objectType: "REVISION",
        objectId: revision.id,
        action: "REVISION_RELEASED",
        details: JSON.stringify({ engineeringChangeId: revision.engineeringChangeId, revisionNumber: revision.revisionNumber })
      });
      app.core.appState._recordAuditEvent(state, {
        objectType: "ENGINEERING_CHANGE",
        objectId: readiness.change.id,
        action: "ECN_RESULTING_REVISION_CREATED",
        details: JSON.stringify({ changeNumber: readiness.change.changeNumber, revisionId: revision.id, revisionNumber: revision.revisionNumber })
      });
    });
  }

  function exportRevisionSnapshot(id) {
    var revision = getRevision(id);
    if (!revision) throw notFound("REVISION", id);
    return clone({
      id: revision.id,
      revisionNumber: revision.revisionNumber,
      title: revision.title,
      description: revision.description,
      programId: revision.programId,
      seatVariantId: revision.seatVariantId,
      engineeringChangeId: revision.engineeringChangeId,
      lifecycleStatus: revision.lifecycleStatus,
      releasedAt: revision.releasedAt,
      snapshotHash: revision.snapshotHash,
      sourceFingerprints: revision.sourceFingerprints,
      programSnapshot: revision.programSnapshot,
      seatVariantSnapshot: revision.seatVariantSnapshot,
      featureDefinitionsSnapshot: revision.featureDefinitionsSnapshot,
      engineeringModuleSnapshots: revision.engineeringModuleSnapshots,
      engineeringChangeSnapshot: revision.engineeringChangeSnapshot,
      sourceWorkbookSnapshots: revision.sourceWorkbookSnapshots,
      featureConfigurationSnapshot: revision.featureConfigurationSnapshot,
      partsSnapshot: revision.partsSnapshot,
      engineeringBomSnapshots: revision.engineeringBomSnapshots,
      engineeringProductStructureSnapshot: revision.engineeringProductStructureSnapshot,
      commercialAssessmentSnapshot: revision.commercialAssessmentSnapshot
    });
  }

  function compareRevisions(firstId, secondId) {
    var first = getRevision(firstId);
    var second = getRevision(secondId);
    if (!first) throw notFound("REVISION", firstId);
    if (!second) throw notFound("REVISION", secondId);
    return {
      fromRevisionId: first.id,
      toRevisionId: second.id,
      fromRevisionNumber: first.revisionNumber,
      toRevisionNumber: second.revisionNumber,
      differences: {
        featureConfiguration: compareObjects(first.featureConfigurationSnapshot, second.featureConfigurationSnapshot, "featureConfiguration"),
        parts: compareCollections(first.partsSnapshot, second.partsSnapshot, "parts"),
        engineeringBoms: compareCollections(first.engineeringBomSnapshots, second.engineeringBomSnapshots, "engineeringBoms"),
        engineeringProductStructure: compareObjects(first.engineeringProductStructureSnapshot, second.engineeringProductStructureSnapshot, "engineeringProductStructure"),
        commercialAssessment: compareObjects(first.commercialAssessmentSnapshot, second.commercialAssessmentSnapshot, "commercialAssessment")
      },
      businessDifferences: buildBusinessDifferences(first, second)
    };
  }

  function validateReadinessFromState(state, criteria) {
    criteria = criteria || {};
    var context = state.context || {};
    var change = criteria.engineeringChangeId
      ? findChange(state, criteria.engineeringChangeId)
      : findLatestImplementedUnreleasedChange(state, criteria.programId || context.activeProgramId, criteria.seatVariantId || context.activeSeatVariantId);
    var programId = criteria.programId || (change && change.programId) || context.activeProgramId;
    var seatVariantId = criteria.seatVariantId || (change && change.seatVariantId) || context.activeSeatVariantId;
    var program = findById(state.programs, programId);
    var seatVariant = findById(state.seatVariants, seatVariantId);
    var configuration = findActiveConfiguration(state, seatVariantId);
    var structure = findCurrentStructure(state, programId, seatVariantId);
    var assessment = findCurrentAssessment(state, programId, seatVariantId);
    var boms = findRequiredBoms(state, programId, seatVariantId, structure);
    var blockingErrors = [];

    if (!change) push(blockingErrors, "REVISION_CHANGE_REQUIRED", "Implemented Engineering Change is required.", "ENGINEERING_CHANGE", criteria.engineeringChangeId || null);
    if (change && change.status !== "IMPLEMENTED") push(blockingErrors, "REVISION_CHANGE_NOT_IMPLEMENTED", "Engineering Change must be IMPLEMENTED before Revision release.", "ENGINEERING_CHANGE", change.id);
    if (!program) push(blockingErrors, "REVISION_PROGRAM_MISSING", "Revision Program is required.", "PROGRAM", programId);
    if (!seatVariant) push(blockingErrors, "REVISION_VARIANT_MISSING", "Revision Seat Variant is required.", "SEAT_VARIANT", seatVariantId);
    if (program && seatVariant && seatVariant.programId !== program.id) push(blockingErrors, "REVISION_PROGRAM_VARIANT_MISMATCH", "Seat Variant must belong to Program.", "SEAT_VARIANT", seatVariant.id);
    if (!configuration) push(blockingErrors, "REVISION_FEATURE_CONFIGURATION_MISSING", "Active Feature Configuration is required.", "FEATURE_CONFIGURATION", seatVariantId);
    if (!structure) push(blockingErrors, "REVISION_EPS_MISSING", "Engineering Product Structure is required.", "ENGINEERING_PRODUCT_STRUCTURE", seatVariantId);
    if (structure && structure.generationStatus !== "CURRENT") push(blockingErrors, "REVISION_EPS_NOT_CURRENT", "Engineering Product Structure must be CURRENT.", "ENGINEERING_PRODUCT_STRUCTURE", structure.id);
    if (!assessment) push(blockingErrors, "REVISION_COMMERCIAL_ASSESSMENT_MISSING", "Commercial Assessment is required.", "COMMERCIAL_ASSESSMENT", seatVariantId);
    if (assessment && assessment.generationStatus !== "CURRENT") push(blockingErrors, "REVISION_COMMERCIAL_ASSESSMENT_NOT_CURRENT", "Commercial Assessment must be CURRENT.", "COMMERCIAL_ASSESSMENT", assessment.id);
    if (structure && !(structure.sourceEngineeringBomIds || []).length) {
      push(blockingErrors, "REVISION_REQUIRED_BOM_MISSING", "Complete Seat JIT does not identify its source Engineering eBOMs.", "ENGINEERING_PRODUCT_STRUCTURE", structure.id);
    }
    (boms.missingIds || []).forEach(function (bomId) {
      push(blockingErrors, "REVISION_REQUIRED_BOM_MISSING", "A source Engineering eBOM used by Complete Seat JIT is no longer available.", "ENGINEERING_BOM", bomId);
    });
    boms.forEach(function (entry) {
      if (entry.bom.completionStatus !== "COMPLETE") {
        push(blockingErrors, "REVISION_BOM_INCOMPLETE", "Required Engineering BOM must be COMPLETE.", "ENGINEERING_BOM", entry.bom.id);
      }
    });

    return {
      releaseAllowed: blockingErrors.length === 0,
      blockingErrors: blockingErrors,
      warnings: [],
      change: change,
      program: program,
      seatVariant: seatVariant,
      featureConfiguration: configuration,
      engineeringBoms: boms.map(function (entry) { return entry.bom; }),
      engineeringProductStructure: structure,
      commercialAssessment: assessment
    };
  }

  function buildRevisionSnapshot(state, readiness, revisionNumber, input) {
    var releasedAt = now();
    var revisionId = input.id || makeRevisionId(readiness.seatVariant.id, revisionNumber);
    var partIds = collectReleasedPartIds(readiness);
    var generatedItemIds = buildCompactIdMap(readiness.engineeringProductStructure.items || [], "GI");
    var commercialSource = clone(readiness.commercialAssessment);
    enrichCommercialSnapshotWithEcn(state, commercialSource, readiness.change);
    var snapshot = {
      programSnapshot: compactProgramSnapshot(readiness.program),
      seatVariantSnapshot: compactSeatVariantSnapshot(readiness.seatVariant),
      featureDefinitionsSnapshot: (state.features || []).map(compactFeatureDefinitionSnapshot).sort(compareById),
      engineeringModuleSnapshots: collectEngineeringModuleSnapshots(state, readiness.engineeringBoms),
      engineeringChangeSnapshot: compactEngineeringChangeSnapshot(readiness.change, revisionId),
      sourceWorkbookSnapshots: collectSourceWorkbookSnapshots(state, readiness.program.id, readiness.seatVariant.id),
      featureConfigurationSnapshot: clone(readiness.featureConfiguration),
      partsSnapshot: state.parts.filter(function (part) { return partIds[part.id]; }).map(compactPartSnapshot).sort(compareById),
      engineeringBomSnapshots: readiness.engineeringBoms.map(compactEngineeringBomSnapshot).sort(compareById),
      engineeringProductStructureSnapshot: compactEngineeringProductStructureSnapshot(readiness.engineeringProductStructure, generatedItemIds),
      commercialAssessmentSnapshot: compactCommercialAssessmentSnapshot(commercialSource, generatedItemIds)
    };
    snapshot.commercialAssessmentSnapshot.totalsByCurrency = calculateCommercialTotalsByCurrency(snapshot.commercialAssessmentSnapshot);
    var sourceFingerprints = {
      exportContext: hashValue({
        program: snapshot.programSnapshot,
        seatVariant: snapshot.seatVariantSnapshot,
        features: snapshot.featureDefinitionsSnapshot,
        modules: snapshot.engineeringModuleSnapshots,
        engineeringChange: snapshot.engineeringChangeSnapshot,
        sourceWorkbooks: snapshot.sourceWorkbookSnapshots
      }),
      featureConfiguration: hashValue(snapshot.featureConfigurationSnapshot),
      parts: hashValue(snapshot.partsSnapshot),
      engineeringBoms: hashValue(snapshot.engineeringBomSnapshots),
      engineeringProductStructure: hashValue(snapshot.engineeringProductStructureSnapshot),
      commercialAssessment: hashValue(snapshot.commercialAssessmentSnapshot)
    };
    var revision = normalizeRevision(Object.assign({
      id: revisionId,
      revisionNumber: revisionNumber,
      title: input.title || readiness.change.title,
      description: input.description || readiness.change.description,
      programId: readiness.program.id,
      seatVariantId: readiness.seatVariant.id,
      engineeringChangeId: readiness.change.id,
      lifecycleStatus: RELEASED,
      createdAt: releasedAt,
      releasedAt: releasedAt,
      releasedBy: input.releasedBy || (state.context && state.context.activeRole) || "",
      createdBy: input.createdBy || (state.context && state.context.activeRole) || "",
      notes: input.notes || readiness.change.reason,
      generationVersion: getNextGenerationVersion(state, readiness.seatVariant.id),
      sourceFingerprints: sourceFingerprints,
      validation: { valid: true, errors: [], warnings: [] },
      audit: []
    }, snapshot));
    revision.snapshotHash = hashValue({
      featureConfigurationSnapshot: revision.featureConfigurationSnapshot,
      partsSnapshot: revision.partsSnapshot,
      engineeringBomSnapshots: revision.engineeringBomSnapshots,
      engineeringProductStructureSnapshot: revision.engineeringProductStructureSnapshot,
      commercialAssessmentSnapshot: revision.commercialAssessmentSnapshot,
      programSnapshot: revision.programSnapshot,
      seatVariantSnapshot: revision.seatVariantSnapshot,
      featureDefinitionsSnapshot: revision.featureDefinitionsSnapshot,
      engineeringModuleSnapshots: revision.engineeringModuleSnapshots,
      engineeringChangeSnapshot: revision.engineeringChangeSnapshot,
      sourceWorkbookSnapshots: revision.sourceWorkbookSnapshots,
      sourceFingerprints: revision.sourceFingerprints
    });
    return revision;
  }

  function hashValue(value) {
    var text = stableStringify(value);
    var hash = 2166136261;
    for (var index = 0; index < text.length; index += 1) {
      hash ^= text.charCodeAt(index);
      hash += (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24);
    }
    return "FNV1A-" + (hash >>> 0).toString(16).toUpperCase().padStart(8, "0");
  }

  function compactEngineeringBomSnapshot(bom) {
    var result = copyFields(bom, [
      "id", "programId", "seatVariantId", "engineeringModuleId", "name", "rootPartId",
      "lifecycleStatus", "completionStatus"
    ]);
    result.items = (bom.items || []).map(function (item) {
      var snapshot = copyFields(item, [
        "id", "parentPartId", "childPartId", "quantity", "sequence", "level", "applicability",
        "changeClassification", "totalCadWeight", "sourceWorkbookFingerprint", "sourceWorkbookSheet",
        "sourceWorkbookRow", "sourceOccurrenceKey", "hierarchyPath"
      ]);
      snapshot.unitOfMeasure = item.unitOfMeasure || item.unit || "";
      snapshot.remarks = item.remarks || item.remark || "";
      return snapshot;
    });
    return result;
  }

  function compactPartSnapshot(part) {
    var snapshot = copyFields(part, [
      "id", "partNumber", "name", "description", "partType", "engineeringModuleId", "lifecycleStatus",
      "drawingNumber", "drawingRevision", "commodity", "sourceCommodityOriginal", "category", "material",
      "gauge", "unitOfMeasure", "imageReference", "threeDSharedDate", "twoDSharedDate", "technicalAttributes",
      "releasedAt", "releasedBy", "effectiveStatus", "technicalNotes", "sourceWorkbookFingerprint",
      "sourceWorkbookSheet", "sourceWorkbookRow", "sourceWorkbookSheets", "sourceWorkbookRows",
      "sourceWorkbookImageAnchor"
    ]);
    snapshot.currentRevision = part.currentRevision || part.revision || "";
    snapshot.cadWeight = part.cadWeight !== undefined ? part.cadWeight : part.mass !== undefined ? part.mass : part.weight;
    return snapshot;
  }

  function compactEngineeringProductStructureSnapshot(structure, generatedItemIds) {
    var result = copyFields(structure, [
      "id", "programId", "seatVariantId", "lifecycleStatus", "generationStatus", "generatedAt", "generatedBy",
      "generationVersion", "sourceConfigurationId", "sourceConfigurationFingerprint", "sourceEngineeringBomIds",
      "sourceEngineeringBomFingerprints", "requiredEngineeringModuleIds", "staleReasons", "lastGenerationError",
      "createdAt", "updatedAt"
    ]);
    result.items = (structure.items || []).map(function (item) {
      var snapshot = copyFields(item, [
        "sourceEngineeringBomId", "sourceBomItemId", "sourceEngineeringModuleId", "partId",
        "level", "quantity", "calculatedQuantity", "applicabilityResult", "sequence",
        "changeClassification", "totalCadWeight", "isLeaf", "isAssembly"
      ]);
      snapshot.unitOfMeasure = item.unitOfMeasure || item.unit || "";
      snapshot.id = generatedItemIds[item.id] || compactStableId("GI", item.id);
      snapshot.sourceGeneratedItemId = item.id;
      snapshot.parentGeneratedItemId = item.parentGeneratedItemId
        ? generatedItemIds[item.parentGeneratedItemId] || compactStableId("GI", item.parentGeneratedItemId)
        : null;
      return snapshot;
    });
    result.sourceConfigurationFingerprint = hashValue(structure.sourceConfigurationFingerprint || "");
    result.sourceEngineeringBomFingerprints = {};
    Object.keys(structure.sourceEngineeringBomFingerprints || {}).sort().forEach(function (bomId) {
      result.sourceEngineeringBomFingerprints[bomId] = hashValue(structure.sourceEngineeringBomFingerprints[bomId]);
    });
    return result;
  }

  function compactCommercialAssessmentSnapshot(assessment, generatedItemIds) {
    var result = copyFields(assessment, [
      "id", "programId", "seatVariantId", "engineeringProductStructureId", "lifecycleStatus", "generationStatus",
      "generatedAt", "generatedBy", "generationVersion", "sourceEngineeringProductStructureFingerprint",
      "staleReasons", "lastGenerationError", "createdAt", "updatedAt", "totals"
    ]);
    result.lineItems = (assessment.lineItems || []).map(function (line) {
      var snapshot = copyFields(line, [
        "partId", "supplierId", "supplier", "supplierPartNumber",
        "quotation", "commodityManager", "sta", "poNumber", "poType", "poQuantity", "scheduleGiven",
        "piecePrice", "toolingCost", "logisticsCost", "currency", "sourcingStatus", "commercialStatus",
        "obsolete", "quantity", "ecnId", "ecnNumber", "ecnReferences"
      ]);
      snapshot.notes = line.notes || line.remarks || "";
      snapshot.id = compactStableId("CL", line.id);
      snapshot.sourceCommercialLineId = line.id;
      snapshot.sourceEngineeringProductStructureItemId = line.engineeringProductStructureItemId;
      snapshot.engineeringProductStructureItemId = generatedItemIds[line.engineeringProductStructureItemId] ||
        compactStableId("GI", line.engineeringProductStructureItemId);
      return snapshot;
    });
    result.sourceEngineeringProductStructureFingerprint = hashValue(assessment.sourceEngineeringProductStructureFingerprint || "");
    return result;
  }

  function compactProgramSnapshot(program) {
    return copyFields(program, [
      "id", "programCode", "code", "name", "customer", "oem", "vehiclePlatform", "status",
      "createdAt", "updatedAt"
    ]);
  }

  function compactSeatVariantSnapshot(variant) {
    return copyFields(variant, [
      "id", "programId", "variantCode", "variantName", "customer", "brand", "oem", "seatType",
      "seatFamily", "side", "grade", "trim", "status", "lifecycleStatus", "createdAt", "updatedAt"
    ]);
  }

  function compactFeatureDefinitionSnapshot(feature) {
    return copyFields(feature, [
      "id", "featureCode", "code", "name", "description", "category", "valueType", "allowedValues", "status"
    ]);
  }

  function collectEngineeringModuleSnapshots(state, boms) {
    var ids = {};
    (boms || []).forEach(function (bom) { ids[bom.engineeringModuleId] = true; });
    return (state.engineeringModules || []).filter(function (module) { return ids[module.id]; }).map(function (module) {
      return copyFields(module, ["id", "moduleCode", "code", "name", "description", "status", "displaySequence"]);
    }).sort(compareById);
  }

  function compactEngineeringChangeSnapshot(change, revisionId) {
    var snapshot = copyFields(change, [
      "id", "changeNumber", "title", "description", "reason", "priority", "type", "status", "programId",
      "seatVariantId", "requester", "owner", "createdAt", "updatedAt", "submittedAt", "approvedAt",
      "implementedAt", "affectedObjects", "engineeringImpact", "engineeringImpactItems", "commodityImpact",
      "commercialImpact", "commercialImpactSummary", "implementationReadiness", "comments", "impactLastCalculatedAt"
    ]);
    snapshot.resultingRevisionId = revisionId;
    return snapshot;
  }

  function collectSourceWorkbookSnapshots(state, programId, seatVariantId) {
    var history = state.metadata && state.metadata.importHistory || [];
    return history.filter(function (entry) {
      if (entry.status && entry.status !== "COMPLETED") return false;
      var targets = entry.targetContextIds || {};
      var targetProgramId = entry.programId || targets.programId;
      var variantIds = entry.seatVariantIds || entry.finishedGoodVariantIds || targets.seatVariantIds || [];
      return (!targetProgramId || targetProgramId === programId) && (!variantIds.length || variantIds.indexOf(seatVariantId) !== -1);
    }).map(function (entry) {
      return copyFields(entry, [
        "importId", "workbookName", "sourceWorkbookName", "workbookType", "workbookFingerprint", "importedAt",
        "status", "recordCounts", "warningCount", "errorCount", "targetContextIds", "programId",
        "seatVariantIds", "finishedGoodVariantIds"
      ]);
    }).sort(function (left, right) { return String(left.importedAt || "").localeCompare(String(right.importedAt || "")); });
  }

  function copyFields(source, fields) {
    var result = {};
    (fields || []).forEach(function (field) {
      if (source && source[field] !== undefined) result[field] = clone(source[field]);
    });
    return result;
  }

  function buildCompactIdMap(records, prefix) {
    var result = {};
    (records || []).forEach(function (record) {
      if (record && record.id) result[record.id] = compactStableId(prefix, record.id);
    });
    return result;
  }

  function compactStableId(prefix, value) {
    return prefix + "-" + hashValue(String(value || "")).slice(-8);
  }

  function validateRevision(revision, state, existingId) {
    var errors = [];
    if (!revision.id) push(errors, "REVISION_ID_REQUIRED", "Revision ID is required.", "REVISION", revision.id);
    if (revision.id && state.revisions.some(function (item) { return item.id !== existingId && item.id === revision.id; })) {
      push(errors, "REVISION_ID_DUPLICATE", "Revision ID must be unique.", "REVISION", revision.id);
    }
    if (!revision.revisionNumber) push(errors, "REVISION_NUMBER_REQUIRED", "Revision Number is required.", "REVISION", revision.id);
    if (revision.revisionNumber && state.revisions.some(function (item) {
      var other = normalizeRevision(item);
      return other.id !== existingId && other.seatVariantId === revision.seatVariantId && other.revisionNumber === revision.revisionNumber;
    })) {
      push(errors, "REVISION_NUMBER_DUPLICATE", "Revision Number must be unique within a Seat Variant.", "REVISION", revision.id);
    }
    if (!findById(state.programs, revision.programId)) push(errors, "REVISION_PROGRAM_MISSING", "Revision Program reference is invalid.", "REVISION", revision.id);
    if (!findById(state.seatVariants, revision.seatVariantId)) push(errors, "REVISION_VARIANT_MISSING", "Revision Seat Variant reference is invalid.", "REVISION", revision.id);
    var change = findChange(state, revision.engineeringChangeId);
    if (!change) push(errors, "REVISION_CHANGE_MISSING", "Revision Engineering Change reference is invalid.", "REVISION", revision.id);
    if (change && change.status !== "IMPLEMENTED") push(errors, "REVISION_CHANGE_NOT_IMPLEMENTED", "Revision must reference an IMPLEMENTED Engineering Change.", "REVISION", revision.id);
    if (revision.lifecycleStatus !== RELEASED) push(errors, "REVISION_LIFECYCLE_INVALID", "Revision lifecycle must be RELEASED.", "REVISION", revision.id);
    if (!revision.featureConfigurationSnapshot || !revision.featureConfigurationSnapshot.id) push(errors, "REVISION_FEATURE_CONFIGURATION_SNAPSHOT_REQUIRED", "Feature Configuration snapshot is required.", "REVISION", revision.id);
    if (!Array.isArray(revision.partsSnapshot) || !revision.partsSnapshot.length) push(errors, "REVISION_PARTS_SNAPSHOT_REQUIRED", "Parts snapshot is required.", "REVISION", revision.id);
    if (!Array.isArray(revision.engineeringBomSnapshots) || !revision.engineeringBomSnapshots.length) push(errors, "REVISION_BOM_SNAPSHOT_REQUIRED", "Engineering BOM snapshots are required.", "REVISION", revision.id);
    if (!revision.engineeringProductStructureSnapshot || !revision.engineeringProductStructureSnapshot.id) push(errors, "REVISION_EPS_SNAPSHOT_REQUIRED", "Engineering Product Structure snapshot is required.", "REVISION", revision.id);
    if (!revision.commercialAssessmentSnapshot || !revision.commercialAssessmentSnapshot.id) push(errors, "REVISION_COMMERCIAL_ASSESSMENT_SNAPSHOT_REQUIRED", "Commercial Assessment snapshot is required.", "REVISION", revision.id);
    if (!revision.snapshotHash) push(errors, "REVISION_SNAPSHOT_HASH_REQUIRED", "Revision snapshot hash is required.", "REVISION", revision.id);
    if (errors.length) throw new app.core.errors.BusinessOperationError("Revision validation failed.", errors);
  }

  function normalizeRevision(input) {
    input = input || {};
    var revisionNumber = normalizeRevisionNumber(input.revisionNumber || input.revisionCode || input.currentRevisionCode || input.revision);
    var engineeringChangeId = input.engineeringChangeId || input.originatingEcnId || input.ecnId || input.ecnNumber || "";
    var releasedAt = input.releasedAt || input.date || input.createdAt || now();
    return {
      id: input.id || makeRevisionId(input.seatVariantId || "UNKNOWN", revisionNumber || "A"),
      revisionNumber: revisionNumber,
      revision: revisionNumber,
      title: input.title || "",
      description: input.description || "",
      programId: input.programId || "",
      seatVariantId: input.seatVariantId || "",
      engineeringChangeId: engineeringChangeId,
      ecnNumber: input.ecnNumber || engineeringChangeId,
      lifecycleStatus: input.lifecycleStatus || input.status || RELEASED,
      status: input.lifecycleStatus || input.status || RELEASED,
      createdAt: input.createdAt || releasedAt,
      releasedAt: releasedAt,
      date: releasedAt ? String(releasedAt).slice(0, 10) : "",
      releasedBy: input.releasedBy || input.engineer || "",
      createdBy: input.createdBy || input.engineer || "",
      engineer: input.releasedBy || input.createdBy || input.engineer || "",
      notes: input.notes || input.reason || "",
      reason: input.reason || input.notes || "",
      generationVersion: Number(input.generationVersion || 1),
      snapshotHash: input.snapshotHash || "",
      sourceFingerprints: Object.assign({}, input.sourceFingerprints || {}),
      validation: input.validation || { valid: true, errors: [], warnings: [] },
      audit: (input.audit || []).slice(),
      programSnapshot: clone(input.programSnapshot || {}),
      seatVariantSnapshot: clone(input.seatVariantSnapshot || {}),
      featureDefinitionsSnapshot: clone(input.featureDefinitionsSnapshot || []),
      engineeringModuleSnapshots: clone(input.engineeringModuleSnapshots || []),
      engineeringChangeSnapshot: clone(input.engineeringChangeSnapshot || {}),
      sourceWorkbookSnapshots: clone(input.sourceWorkbookSnapshots || []),
      featureConfigurationSnapshot: clone(input.featureConfigurationSnapshot || {}),
      partsSnapshot: clone(input.partsSnapshot || []),
      engineeringBomSnapshots: clone(input.engineeringBomSnapshots || []),
      engineeringProductStructureSnapshot: clone(input.engineeringProductStructureSnapshot || {}),
      commercialAssessmentSnapshot: clone(input.commercialAssessmentSnapshot || {}),
      affectedObjects: input.affectedObjects || [],
      previousRevision: input.previousRevision || input.previousRevisionCode || "",
      currentRevision: input.currentRevision || input.currentRevisionCode || revisionNumber
    };
  }

  function collectReleasedPartIds(readiness) {
    var ids = {};
    readiness.engineeringBoms.forEach(function (bom) {
      ids[bom.rootPartId] = true;
      (bom.items || []).forEach(function (item) {
        ids[item.parentPartId] = true;
        ids[item.childPartId] = true;
      });
    });
    (readiness.engineeringProductStructure.items || []).forEach(function (item) {
      if (item.partId) ids[item.partId] = true;
    });
    (readiness.commercialAssessment.lineItems || []).forEach(function (line) {
      if (line.partId) ids[line.partId] = true;
    });
    return ids;
  }

  function findRequiredBoms(state, programId, seatVariantId, structure) {
    var sourceIds = Array.from(new Set((structure && structure.sourceEngineeringBomIds || []).filter(Boolean)));
    var missingIds = [];
    var entries = sourceIds.map(function (bomId) {
      var bom = (state.engineeringBoms || []).find(function (candidate) {
        return candidate.id === bomId && candidate.programId === programId && candidate.seatVariantId === seatVariantId;
      });
      if (!bom) {
        missingIds.push(bomId);
        return null;
      }
      var module = (state.engineeringModules || []).find(function (candidate) {
        return candidate.id === bom.engineeringModuleId;
      });
      return { module: module, bom: bom };
    }).filter(Boolean);
    entries.missingIds = missingIds;
    return entries;
  }

  function findLatestImplementedUnreleasedChange(state, programId, seatVariantId) {
    var releasedChangeIds = {};
    (state.revisions || []).forEach(function (revision) {
      releasedChangeIds[normalizeRevision(revision).engineeringChangeId] = true;
    });
    return (state.engineeringChanges || []).map(function (change) {
      return app.domain.engineeringChangeService ? app.domain.engineeringChangeService.normalizeEngineeringChange(change) : change;
    }).filter(function (change) {
      return change.status === "IMPLEMENTED" &&
        !releasedChangeIds[change.id] &&
        (!programId || change.programId === programId) &&
        (!seatVariantId || change.seatVariantId === seatVariantId);
    }).sort(function (a, b) {
      return String(b.implementedAt || b.updatedAt || b.createdAt).localeCompare(String(a.implementedAt || a.updatedAt || a.createdAt));
    })[0] || null;
  }

  function findChange(state, id) {
    return (state.engineeringChanges || []).map(function (change) {
      return app.domain.engineeringChangeService ? app.domain.engineeringChangeService.normalizeEngineeringChange(change) : change;
    }).find(function (change) {
      return change.id === id || change.changeNumber === id || change.ecnNumber === id;
    }) || null;
  }

  function findActiveConfiguration(state, seatVariantId) {
    return (state.featureConfigurations || []).find(function (configuration) {
      return configuration.seatVariantId === seatVariantId && configuration.status === "ACTIVE";
    }) || null;
  }

  function findCurrentStructure(state, programId, seatVariantId) {
    return (state.engineeringProductStructures || []).find(function (structure) {
      return structure.programId === programId && structure.seatVariantId === seatVariantId;
    }) || null;
  }

  function findCurrentAssessment(state, programId, seatVariantId) {
    return (state.commercialAssessments || []).find(function (assessment) {
      return assessment.programId === programId && assessment.seatVariantId === seatVariantId;
    }) || null;
  }

  function findRevisionByNumber(state, seatVariantId, revisionNumber) {
    return (state.revisions || []).map(normalizeRevision).find(function (revision) {
      return revision.seatVariantId === seatVariantId && revision.revisionNumber === revisionNumber;
    }) || null;
  }

  function findModuleByCode(state, code) {
    var normalized = normalizeCode(code);
    return (state.engineeringModules || []).find(function (module) {
      return normalizeCode(module.code) === normalized;
    }) || null;
  }

  function getNextRevisionNumber(state, seatVariantId) {
    var existing = (state.revisions || []).map(normalizeRevision).filter(function (revision) {
      return revision.seatVariantId === seatVariantId;
    }).map(function (revision) {
      return revision.revisionNumber;
    });
    var index = existing.reduce(function (max, value) {
      return Math.max(max, revisionNumberToIndex(value));
    }, 0);
    return indexToRevisionNumber(index + 1);
  }

  function getNextGenerationVersion(state, seatVariantId) {
    return (state.revisions || []).filter(function (revision) {
      return normalizeRevision(revision).seatVariantId === seatVariantId;
    }).length + 1;
  }

  function compareObjects(first, second, area) {
    if (stableStringify(first || {}) === stableStringify(second || {})) {
      return { area: area, changed: false, changes: [] };
    }
    return {
      area: area,
      changed: true,
      changes: [{ type: "CHANGED", before: clone(first || {}), after: clone(second || {}) }]
    };
  }

  function compareCollections(firstCollection, secondCollection, area) {
    var firstById = indexById(firstCollection || []);
    var secondById = indexById(secondCollection || []);
    var changes = [];
    Object.keys(firstById).forEach(function (id) {
      if (!secondById[id]) changes.push({ type: "REMOVED", id: id, before: clone(firstById[id]) });
      else if (stableStringify(firstById[id]) !== stableStringify(secondById[id])) {
        changes.push({ type: "CHANGED", id: id, before: clone(firstById[id]), after: clone(secondById[id]) });
      }
    });
    Object.keys(secondById).forEach(function (id) {
      if (!firstById[id]) changes.push({ type: "ADDED", id: id, after: clone(secondById[id]) });
    });
    return { area: area, changed: changes.length > 0, changes: changes };
  }

  function enrichCommercialSnapshotWithEcn(state, assessment, change) {
    var impactsByLine = {};
    (state.engineeringChanges || []).forEach(function (candidate) {
      (candidate.commodityImpact || []).forEach(function (impact) {
        if (!impact.commercialLineId) return;
        impactsByLine[impact.commercialLineId] = impactsByLine[impact.commercialLineId] || [];
        impactsByLine[impact.commercialLineId].push({
          engineeringChangeId: candidate.id,
          changeNumber: candidate.changeNumber || candidate.ecnNumber,
          impactStatus: impact.impactStatus,
          costDelta: impact.costDelta
        });
      });
    });
    (assessment.lineItems || []).forEach(function (line) {
      line.ecnReferences = clone(impactsByLine[line.id] || []);
      if (change && (change.commodityImpact || []).some(function (impact) { return impact.commercialLineId === line.id; })) {
        line.engineeringChangeId = change.id;
        line.ecnNumber = change.changeNumber || change.ecnNumber;
      }
    });
  }

  function calculateCommercialTotalsByCurrency(assessment) {
    var totals = {};
    (assessment.lineItems || []).forEach(function (line) {
      if (line.obsolete || line.sourcingStatus === "OBSOLETE") return;
      var currency = line.currency || "UNSPECIFIED";
      totals[currency] = totals[currency] || { currency: currency, pieceTotal: 0, toolingTotal: 0, logisticsTotal: 0, overallTotal: 0 };
      totals[currency].pieceTotal += Number(line.quantity || 0) * Number(line.piecePrice || 0);
      totals[currency].toolingTotal += Number(line.toolingCost || 0);
      totals[currency].logisticsTotal += Number(line.logisticsCost || 0);
      totals[currency].overallTotal = totals[currency].pieceTotal + totals[currency].toolingTotal + totals[currency].logisticsTotal;
    });
    return Object.keys(totals).sort().map(function (currency) { return totals[currency]; });
  }

  function buildBusinessDifferences(first, second) {
    var differences = [];
    compareFeatureSelections(first.featureConfigurationSnapshot, second.featureConfigurationSnapshot, differences);
    compareBusinessCollection(first.partsSnapshot, second.partsSnapshot, "PART", ["currentRevision", "drawingRevision", "material", "commodity"], differences);
    compareBomItems(first.engineeringBomSnapshots, second.engineeringBomSnapshots, differences);
    compareEpsItems(first.engineeringProductStructureSnapshot, second.engineeringProductStructureSnapshot, differences);
    compareCommercialLines(first.commercialAssessmentSnapshot, second.commercialAssessmentSnapshot, differences);
    compareTotals(first.commercialAssessmentSnapshot, second.commercialAssessmentSnapshot, differences);
    return differences;
  }

  function compareFeatureSelections(first, second, differences) {
    var before = indexByKey(first && first.selections || [], "featureId");
    var after = indexByKey(second && second.selections || [], "featureId");
    Object.keys(Object.assign({}, before, after)).forEach(function (id) {
      addFieldDifference(differences, "FEATURE", id, "selectedValue", before[id] && before[id].selectedValue, after[id] && after[id].selectedValue);
    });
  }

  function compareBusinessCollection(first, second, area, fields, differences) {
    var before = indexById(first || []);
    var after = indexById(second || []);
    Object.keys(Object.assign({}, before, after)).forEach(function (id) {
      if (!before[id]) differences.push(businessDifference(area, "ADDED", id, "", null, after[id]));
      else if (!after[id]) differences.push(businessDifference(area, "REMOVED", id, "", before[id], null));
      else fields.forEach(function (field) {
        addFieldDifference(differences, area, id, field, before[id][field], after[id][field], after[id].partNumber || before[id].partNumber);
      });
    });
  }

  function compareBomItems(first, second, differences) {
    var before = flattenBomItems(first || []);
    var after = flattenBomItems(second || []);
    Object.keys(Object.assign({}, before, after)).forEach(function (id) {
      if (!before[id]) differences.push(businessDifference("ENGINEERING_BOM_ITEM", "ADDED", id, "", null, after[id]));
      else if (!after[id]) differences.push(businessDifference("ENGINEERING_BOM_ITEM", "REMOVED", id, "", before[id], null));
      else ["quantity", "changeClassification"].forEach(function (field) {
        addFieldDifference(differences, "ENGINEERING_BOM_ITEM", id, field, before[id][field], after[id][field]);
      });
    });
  }

  function compareEpsItems(first, second, differences) {
    var before = indexById(first && first.items || []);
    var after = indexById(second && second.items || []);
    Object.keys(Object.assign({}, before, after)).forEach(function (id) {
      if (!before[id]) differences.push(businessDifference("COMPLETE_SEAT_ITEM", "ADDED", id, "", null, after[id]));
      else if (!after[id]) differences.push(businessDifference("COMPLETE_SEAT_ITEM", "REMOVED", id, "", before[id], null));
      else addFieldDifference(differences, "COMPLETE_SEAT_ITEM", id, "calculatedQuantity", before[id].calculatedQuantity, after[id].calculatedQuantity);
    });
  }

  function compareCommercialLines(first, second, differences) {
    var before = indexById(first && first.lineItems || []);
    var after = indexById(second && second.lineItems || []);
    Object.keys(Object.assign({}, before, after)).forEach(function (id) {
      if (!before[id]) differences.push(businessDifference("COMMERCIAL_LINE", "ADDED", id, "", null, after[id]));
      else if (!after[id]) differences.push(businessDifference("COMMERCIAL_LINE", "REMOVED", id, "", before[id], null));
      else ["supplier", "supplierPartNumber", "piecePrice", "toolingCost", "logisticsCost", "commercialStatus"].forEach(function (field) {
        addFieldDifference(differences, "COMMERCIAL_LINE", id, field, before[id][field], after[id][field], (after[id].sourcePartSnapshot || {}).partNumber);
      });
    });
  }

  function compareTotals(first, second, differences) {
    var before = indexByKey(first && first.totalsByCurrency || calculateCommercialTotalsByCurrency(first || {}), "currency");
    var after = indexByKey(second && second.totalsByCurrency || calculateCommercialTotalsByCurrency(second || {}), "currency");
    Object.keys(Object.assign({}, before, after)).forEach(function (currency) {
      addFieldDifference(differences, "COMMERCIAL_TOTAL", currency, "overallTotal", before[currency] && before[currency].overallTotal, after[currency] && after[currency].overallTotal);
    });
  }

  function flattenBomItems(boms) {
    var result = {};
    (boms || []).forEach(function (bom) {
      (bom.items || []).forEach(function (item) { result[item.id] = item; });
    });
    return result;
  }

  function indexByKey(items, key) {
    var result = {};
    (items || []).forEach(function (item) { if (item && item[key]) result[item[key]] = item; });
    return result;
  }

  function addFieldDifference(differences, area, id, field, before, after, partNumber) {
    if (stableStringify(before) === stableStringify(after)) return;
    differences.push(businessDifference(area, "CHANGED", id, field, before, after, partNumber));
  }

  function businessDifference(area, type, id, field, before, after, partNumber) {
    return { area: area, type: type, objectId: id, partNumber: partNumber || "", field: field, before: clone(before), after: clone(after) };
  }

  function indexById(collection) {
    var index = {};
    (collection || []).forEach(function (item, itemIndex) {
      index[item.id || item.changeNumber || item.partNumber || String(itemIndex)] = item;
    });
    return index;
  }

  function compareRevisionsByNumber(a, b) {
    return revisionNumberToIndex(a.revisionNumber) - revisionNumberToIndex(b.revisionNumber);
  }

  function normalizeRevisionNumber(value) {
    var normalized = String(value || "").trim().toUpperCase();
    return normalized || "";
  }

  function revisionNumberToIndex(value) {
    value = normalizeRevisionNumber(value);
    var total = 0;
    for (var index = 0; index < value.length; index += 1) {
      var code = value.charCodeAt(index) - 64;
      if (code < 1 || code > 26) return 0;
      total = total * 26 + code;
    }
    return total;
  }

  function indexToRevisionNumber(index) {
    var value = "";
    while (index > 0) {
      index -= 1;
      value = String.fromCharCode(65 + (index % 26)) + value;
      index = Math.floor(index / 26);
    }
    return value || "A";
  }

  function makeRevisionId(seatVariantId, revisionNumber) {
    return "REV-" + normalizeId(seatVariantId + "-" + revisionNumber);
  }

  function normalizeId(value) {
    return String(value || "").toUpperCase().replace(/[^A-Z0-9]+/g, "-").replace(/^-|-$/g, "");
  }

  function normalizeCode(value) {
    return String(value == null ? "" : value).trim().toUpperCase().replace(/[\s-]+/g, "_");
  }

  function stableStringify(value) {
    if (value === null || typeof value !== "object") return JSON.stringify(value);
    if (Array.isArray(value)) return "[" + value.map(stableStringify).join(",") + "]";
    return "{" + Object.keys(value).sort().map(function (key) {
      return JSON.stringify(key) + ":" + stableStringify(value[key]);
    }).join(",") + "}";
  }

  function compareById(a, b) {
    return String(a.id || "").localeCompare(String(b.id || ""));
  }

  function clone(value) {
    return JSON.parse(JSON.stringify(value == null ? null : value));
  }

  function findById(collection, id) {
    return (collection || []).find(function (item) { return item.id === id; }) || null;
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

  function push(errors, code, message, objectType, objectId) {
    errors.push({ code: code, message: message, objectType: objectType || null, objectId: objectId || null });
  }

  function now() {
    return new Date().toISOString();
  }

  app.domain.revisionService = {
    createRevision: createRevision,
    getRevision: getRevision,
    getRevisionHistory: getRevisionHistory,
    compareRevisions: compareRevisions,
    validateRevisionReadiness: validateRevisionReadiness,
    exportRevisionSnapshot: exportRevisionSnapshot,
    normalizeRevision: normalizeRevision,
    validateRevision: validateRevision
  };
})(typeof window !== "undefined" ? (window.DEP = window.DEP || {}) : (globalThis.DEP = globalThis.DEP || {}));
