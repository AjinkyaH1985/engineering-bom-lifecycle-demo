(function (app) {
  app.domain = app.domain || {};

  var GENERATION_STATUSES = ["NOT_GENERATED", "CURRENT", "STALE", "GENERATION_FAILED"];
  var SUPPORTED_APPLICABILITY_KEYS = ["requiredFeatureIds", "excludedFeatureIds", "requiredValues", "excludedValues"];

  function getEngineeringProductStructure(id) {
    return app.core.appState.getById("engineeringProductStructures", id);
  }

  function getEngineeringProductStructureForContext(criteria) {
    criteria = criteria || {};
    var context = app.core.contextService.getContext();
    var programId = criteria.programId || context.activeProgramId;
    var seatVariantId = criteria.seatVariantId || context.activeSeatVariantId;
    if (!programId || !seatVariantId) return null;
    detectEngineeringProductStructureStaleness({ programId: programId, seatVariantId: seatVariantId });
    return findStructure(app.core.appState.getState(), programId, seatVariantId);
  }

  function getGenerationReadiness(criteria) {
    return validateGenerationInputs(criteria || {});
  }

  function getEngineeringBomApplicability(criteria) {
    criteria = criteria || {};
    var state = criteria.state || app.core.appState.getState();
    var context = state.context || {};
    var programId = criteria.programId || context.activeProgramId;
    var seatVariantId = criteria.seatVariantId || context.activeSeatVariantId;
    var seatVariant = findById(state.seatVariants, seatVariantId);
    var configuration = seatVariant ? findActiveConfiguration(state, seatVariant.id) : null;
    return (state.engineeringModules || []).map(function (module) {
      var disposition = classifyModuleApplicability(state, module, seatVariant, configuration);
      var bom = programId && seatVariantId ? findBomForModule(state, programId, seatVariantId, module.id) : null;
      return {
        engineeringModuleId: module.id,
        moduleCode: module.code,
        moduleName: module.name || module.label || module.code,
        disposition: disposition,
        required: disposition === "REQUIRED",
        applicable: disposition === "REQUIRED",
        engineeringBomId: bom && bom.id || null,
        completionStatus: bom && bom.completionStatus || "NOT_STARTED"
      };
    });
  }

  function validateGenerationInputs(criteria) {
    var state = app.core.appState.getState();
    return validateInputs(state, criteria || {});
  }

  function generateEngineeringProductStructure(criteria) {
    criteria = criteria || {};
    var snapshot = app.core.appState.getState();
    var built = buildGeneratedStructure(snapshot, criteria);
    if (!built.readiness.generationAllowed) {
      markGenerationFailedFromReadiness(snapshot, built);
      throw new app.core.errors.BusinessOperationError("Engineering Product Structure generation failed.", built.readiness.blockingErrors);
    }

    var generated = built.structure;
    var result = app.core.appState.transaction(function (state) {
      var existingIndex = findIndex(state.engineeringProductStructures, generated.id);
      if (existingIndex === -1) {
        state.engineeringProductStructures.push(generated);
      } else {
        if (isReleasedProductStructure(state.engineeringProductStructures[existingIndex])) {
          app.core.permissionService.assertCanEdit("engineeringProductStructures", state.engineeringProductStructures[existingIndex], operationContext(state, criteria));
        }
        state.engineeringProductStructures[existingIndex] = Object.assign({}, state.engineeringProductStructures[existingIndex], generated, {
          id: state.engineeringProductStructures[existingIndex].id,
          createdAt: state.engineeringProductStructures[existingIndex].createdAt || generated.createdAt
        });
      }
      app.core.appState._recordAuditEvent(state, {
        objectType: "ENGINEERING_PRODUCT_STRUCTURE",
        objectId: generated.id,
        action: "ENGINEERING_PRODUCT_STRUCTURE_GENERATED"
      });
      markCommercialAssessmentsStaleForGeneratedStructure(state, generated);
      if (app.domain.engineeringChangeImpactService) {
        (state.engineeringChanges || []).forEach(function (change) {
          if (!change.impactTrackingEnabled || change.programId !== generated.programId || change.seatVariantId !== generated.seatVariantId) return;
          if (["IMPLEMENTED", "REJECTED", "CANCELLED"].indexOf(change.status) !== -1) return;
          app.domain.engineeringChangeImpactService._recalculateInState(state, change, { audit: false, reason: "COMPLETE_SEAT_REGENERATED" });
        });
      }
    });
    app.events && app.events.emit && app.events.emit("engineering-product-structure:generated", getEngineeringProductStructure(generated.id));
    return result;
  }

  function detectEngineeringProductStructureStaleness(criteria) {
    criteria = criteria || {};
    var state = app.core.appState.getState();
    var context = state.context || {};
    var programId = criteria.programId || context.activeProgramId;
    var seatVariantId = criteria.seatVariantId || context.activeSeatVariantId;
    var structure = criteria.id
      ? findById(state.engineeringProductStructures, criteria.id)
      : findStructure(state, programId, seatVariantId);
    if (!structure || structure.generationStatus === "NOT_GENERATED") return structure || null;
    if (structure.generationStatus === "GENERATION_FAILED") return structure;

    var readiness = validateInputs(state, {
      programId: structure.programId,
      seatVariantId: structure.seatVariantId
    });
    if (!readiness.generationAllowed) {
      return markEngineeringProductStructureStale(structure.id, readiness.blockingErrors.map(function (item) { return item.code; }));
    }

    var currentFingerprints = createSourceFingerprints(state, readiness);
    var staleReasons = compareFingerprints(structure, currentFingerprints);
    if (!staleReasons.length) return structure;
    return markEngineeringProductStructureStale(structure.id, staleReasons);
  }

  function markEngineeringProductStructureStale(idOrCriteria, reasons) {
    reasons = reasons || ["SOURCE_CHANGED"];
    var targetId = typeof idOrCriteria === "string" ? idOrCriteria : null;
    return app.core.appState.transaction(function (state) {
      var structure = targetId
        ? findById(state.engineeringProductStructures, targetId)
        : idOrCriteria && idOrCriteria.id
          ? findById(state.engineeringProductStructures, idOrCriteria.id)
          : findStructure(state, idOrCriteria && idOrCriteria.programId, idOrCriteria && idOrCriteria.seatVariantId);
      if (!structure) return;
      if (isReleasedProductStructure(structure)) {
        app.core.permissionService.assertCanEdit("engineeringProductStructures", structure, operationContext(state, typeof idOrCriteria === "object" ? idOrCriteria : {}));
      }
      if (structure.generationStatus !== "GENERATION_FAILED") {
        structure.generationStatus = "STALE";
      }
      structure.staleReasons = reasons.slice();
      structure.updatedAt = now();
      app.core.appState._recordAuditEvent(state, {
        objectType: "ENGINEERING_PRODUCT_STRUCTURE",
        objectId: structure.id,
        action: "ENGINEERING_PRODUCT_STRUCTURE_STALE",
        details: JSON.stringify({ reasons: reasons })
      });
    });
  }

  function deleteDraftEngineeringProductStructure(id) {
    return app.core.appState.transaction(function (state) {
      var index = findIndex(state.engineeringProductStructures, id);
      if (index === -1) throw notFound("ENGINEERING_PRODUCT_STRUCTURE", id);
      if (isReleasedProductStructure(state.engineeringProductStructures[index])) {
        app.core.permissionService.assertCanEdit("engineeringProductStructures", state.engineeringProductStructures[index], operationContext(state, {}));
      }
      state.engineeringProductStructures.splice(index, 1);
      app.core.appState._recordAuditEvent(state, {
        objectType: "ENGINEERING_PRODUCT_STRUCTURE",
        objectId: id,
        action: "OBJECT_REMOVED"
      });
    });
  }

  function evaluateApplicability(applicability, configuration, features) {
    applicability = applicability || {};
    var errors = validateApplicabilityShape(applicability, features || [], "APPLICABILITY");
    if (errors.length) {
      throw new app.core.errors.BusinessOperationError("Applicability validation failed.", errors);
    }
    var selectedFeatureIds = {};
    var selectedValues = {};
    (configuration && configuration.selections || []).forEach(function (selection) {
      selectedFeatureIds[selection.featureId] = true;
      selectedValues[selection.featureId] = selection.selectedValue || "Selected";
    });
    var included = true;
    (applicability.requiredFeatureIds || []).forEach(function (featureId) {
      if (!selectedFeatureIds[featureId]) included = false;
    });
    (applicability.excludedFeatureIds || []).forEach(function (featureId) {
      if (selectedFeatureIds[featureId]) included = false;
    });
    (applicability.requiredValues || []).forEach(function (condition) {
      if (selectedValues[condition.featureId] !== condition.value) included = false;
    });
    (applicability.excludedValues || []).forEach(function (condition) {
      if (selectedValues[condition.featureId] === condition.value) included = false;
    });
    return {
      included: included,
      reason: hasApplicability(applicability) ? (included ? "MATCHED" : "NOT_MATCHED") : "UNCONDITIONAL"
    };
  }

  function buildGeneratedStructure(state, criteria) {
    var readiness = validateInputs(state, criteria || {});
    if (!readiness.generationAllowed) {
      return { readiness: readiness, structure: null };
    }
    var programId = readiness.program.id;
    var seatVariantId = readiness.seatVariant.id;
    var existing = findStructure(state, programId, seatVariantId);
    var structureId = existing ? existing.id : makeStructureId(programId, seatVariantId);
    var generatedAt = now();
    var fingerprints = createSourceFingerprints(state, readiness);
    var items = buildGeneratedItems(state, structureId, readiness);
    var validation = validateGeneratedItems(items);
    if (!validation.valid) {
      readiness.blockingErrors = readiness.blockingErrors.concat(validation.errors);
      readiness.generationAllowed = false;
      return { readiness: readiness, structure: null };
    }
    return {
      readiness: readiness,
      structure: normalizeEngineeringProductStructure({
        id: structureId,
        programId: programId,
        seatVariantId: seatVariantId,
        lifecycleStatus: existing && existing.lifecycleStatus || "DRAFT",
        generationStatus: "CURRENT",
        generatedAt: generatedAt,
        generatedBy: (state.context && state.context.activeRole) || "ENGINEERING",
        generationVersion: existing && existing.generationVersion ? Number(existing.generationVersion) + 1 : 1,
        sourceConfigurationId: readiness.configuration.id,
        sourceConfigurationFingerprint: fingerprints.configuration,
        sourceEngineeringBomIds: readiness.boms.map(function (entry) { return entry.bom.id; }),
        sourceEngineeringBomFingerprints: fingerprints.boms,
        items: items,
        validation: validation,
        staleReasons: [],
        lastGenerationError: "",
        createdAt: existing && existing.createdAt || generatedAt,
        updatedAt: generatedAt
      })
    };
  }

  function validateInputs(state, criteria) {
    var programId = criteria.programId || (state.context && state.context.activeProgramId);
    var seatVariantId = criteria.seatVariantId || (state.context && state.context.activeSeatVariantId);
    var blockingErrors = [];
    var warnings = [];
    var program = findById(state.programs, programId);
    var seatVariant = findById(state.seatVariants, seatVariantId);
    var configuration = seatVariant ? findActiveConfiguration(state, seatVariant.id) : null;
    var modules = [];
    var boms = [];
    var moduleReadiness = [];

    if (!programId || !program) push(blockingErrors, "EPS_PROGRAM_MISSING", "Active Program is required.", "PROGRAM", programId);
    if (!seatVariantId || !seatVariant) push(blockingErrors, "EPS_VARIANT_MISSING", "Active Seat Variant is required.", "SEAT_VARIANT", seatVariantId);
    if (program && seatVariant && seatVariant.programId !== program.id) {
      push(blockingErrors, "EPS_PROGRAM_VARIANT_MISMATCH", "Seat Variant must belong to the active Program.", "SEAT_VARIANT", seatVariant.id);
    }
    if (!configuration) push(blockingErrors, "EPS_FEATURE_CONFIGURATION_MISSING", "Active Feature Configuration is required.", "FEATURE_CONFIGURATION", seatVariantId);
    else validateConfigurationSelections(blockingErrors, configuration, state.features);

    var applicableModules = getApplicableModules(state, seatVariant, configuration);
    applicableModules.forEach(function (module) {
      var moduleCode = module.code;
      if (!module) {
        push(blockingErrors, "EPS_MODULE_MISSING", "Required Engineering Module is missing: " + moduleCode, "ENGINEERING_MODULE", moduleCode);
        return;
      }
      modules.push(module);
      if (!program || !seatVariant) return;
      var bom = findBomForModule(state, program.id, seatVariant.id, module.id);
      if (!bom) {
        push(blockingErrors, "EPS_ENGINEERING_BOM_MISSING", "Required Engineering BOM is missing: " + module.code, "ENGINEERING_BOM", module.id);
        moduleReadiness.push(toModuleReadiness(module, null, true, false, ["Engineering eBOM is missing."]));
        return;
      }
      boms.push({ module: module, bom: bom });
      var moduleIssues = [];
      if (bom.completionStatus !== "COMPLETE") {
        push(blockingErrors, "EPS_ENGINEERING_BOM_INCOMPLETE", "Required Engineering BOM must be complete: " + module.code, "ENGINEERING_BOM", bom.id);
        moduleIssues.push("Engineering eBOM is not complete.");
      }
      try {
        app.domain.engineeringBomService.validateEngineeringBom(bom, state, bom.id);
      } catch (error) {
        (error.validationErrors || []).forEach(function (validationError) {
          blockingErrors.push(Object.assign({}, validationError, { code: "EPS_SOURCE_" + validationError.code }));
          moduleIssues.push(validationError.message);
        });
      }
      validateBomApplicability(blockingErrors, bom, configuration, state.features);
      moduleReadiness.push(toModuleReadiness(module, bom, true, moduleIssues.length === 0, unique(moduleIssues)));
    });
    (state.engineeringModules || []).forEach(function (module) {
      if (applicableModules.some(function (candidate) { return candidate.id === module.id; })) return;
      var decision = classifyModuleApplicability(state, module, seatVariant, configuration);
      var inactiveBom = program && seatVariant ? findBomForModule(state, program.id, seatVariant.id, module.id) : null;
      moduleReadiness.push(toModuleReadiness(module, inactiveBom, false, true, [], decision));
    });

    return {
      activeProgramPresent: Boolean(program),
      activeSeatVariantPresent: Boolean(seatVariant),
      featureConfigurationPresent: Boolean(configuration),
      requiredEngineeringBomsPresent: boms.length === applicableModules.length,
      requiredEngineeringBomsValid: !blockingErrors.some(function (item) { return item.code.indexOf("EPS_SOURCE_") === 0; }),
      requiredEngineeringBomsComplete: !blockingErrors.some(function (item) { return item.code === "EPS_ENGINEERING_BOM_INCOMPLETE"; }),
      applicabilityValid: !blockingErrors.some(function (item) { return item.code.indexOf("EPS_APPLICABILITY_") === 0 || item.code.indexOf("BOM_APPLICABILITY_") !== -1; }),
      generationAllowed: blockingErrors.length === 0,
      blockingErrors: blockingErrors,
      warnings: warnings,
      program: program,
      seatVariant: seatVariant,
      configuration: configuration,
      modules: modules,
      moduleReadiness: moduleReadiness,
      applicableModuleCodes: applicableModules.map(function (module) { return module.code; }),
      boms: boms
    };
  }

  function buildGeneratedItems(state, structureId, readiness) {
    var items = [];
    var partsById = indexById(state.parts);
    var rootId = "EPSITEM-" + structureId + "-ROOT";
    items.push({
      id: rootId,
      sourceEngineeringBomId: null,
      sourceBomItemId: null,
      sourceEngineeringModuleId: null,
      partId: null,
      parentGeneratedItemId: null,
      level: 0,
      quantity: 1,
      unit: "EA",
      calculatedQuantity: 1,
      applicability: { included: true, reason: "ROOT" },
      path: "Complete Seat",
      sequence: 0,
      sourcePartSnapshot: {
        partNumber: "COMPLETE-SEAT",
        internalPartNumber: readiness.seatVariant && readiness.seatVariant.finishedGoodPartNumber || "COMPLETE-SEAT",
        oemPartNumber: readiness.seatVariant && readiness.seatVariant.oemFinishedGoodPartNumber || "",
        name: "Complete Seat Assembly",
        description: "Complete Seat Assembly",
        category: "ASSEMBLY",
        revision: "",
        drawingNumber: "",
        drawingRevision: "",
        commodity: "",
        material: "",
        gauge: "",
        cadWeight: "",
        weight: "",
        status: "Generated"
      },
      validationStatus: "VALID"
    });

    readiness.boms.forEach(function (entry, moduleIndex) {
      var generationEntry = Object.assign({ configuration: readiness.configuration, structureId: structureId }, entry);
      generationEntry.partsById = partsById;
      generationEntry.itemsByParent = indexBomItemsByParent(generationEntry.bom.items || []);
      var rootPart = partsById[generationEntry.bom.rootPartId];
      var moduleItemId = makeGeneratedItemId(structureId, generationEntry.bom.id, "ROOT", generationEntry.bom.rootPartId);
      items.push(toGeneratedItem({
        id: moduleItemId,
        parentGeneratedItemId: rootId,
        sourceEngineeringBomId: generationEntry.bom.id,
        sourceBomItemId: null,
        sourceEngineeringModuleId: generationEntry.module.id,
        part: rootPart,
        quantity: 1,
        unit: rootPart.unitOfMeasure || "EA",
        calculatedQuantity: 1,
        applicability: { included: true, reason: "MODULE_ROOT" },
        level: 1,
        path: "Complete Seat/" + generationEntry.module.name,
        sequence: (moduleIndex + 1) * 1000
      }));
      walkBomChildren(state, generationEntry, generationEntry.bom.rootPartId, moduleItemId, 2, 1, "Complete Seat/" + generationEntry.module.name, items);
    });
    return items;
  }

  function walkBomChildren(state, entry, parentPartId, parentGeneratedItemId, level, parentCalculatedQuantity, path, items) {
    var partsById = entry.partsById;
    (entry.itemsByParent[parentPartId] || []).slice().sort(function (a, b) {
      return Number(a.sequence || 0) - Number(b.sequence || 0) || String(a.id).localeCompare(String(b.id));
    }).forEach(function (item) {
      var applicability = evaluateApplicability(item.applicability, entry.configuration || getCurrentConfiguration(state, entry.bom.seatVariantId), state.features);
      if (!applicability.included) return;
      var part = partsById[item.childPartId];
      var calculatedQuantity = parentCalculatedQuantity * Number(item.quantity || 1);
      var generatedId = makeGeneratedItemId(
        entry.structureId || makeStructureId(entry.bom.programId, entry.bom.seatVariantId),
        entry.bom.id,
        item.id + "-UNDER-" + shortHash(parentGeneratedItemId),
        item.childPartId
      );
      var itemPath = path + "/" + ((part && (part.partNumber || part.description || part.name)) || item.childPartId);
      items.push(toGeneratedItem({
        id: generatedId,
        parentGeneratedItemId: parentGeneratedItemId,
        sourceEngineeringBomId: entry.bom.id,
        sourceBomItemId: item.id,
        sourceEngineeringModuleId: entry.module.id,
        part: part,
        quantity: item.quantity,
        unit: item.unitOfMeasure,
        calculatedQuantity: calculatedQuantity,
        applicability: Object.assign({ included: true }, item.applicability || {}, { result: applicability.reason }),
        bomItem: item,
        level: level,
        path: itemPath,
        sequence: item.sequence || 10
      }));
      if (part && part.partType === "ASSEMBLY") {
        walkBomChildren(state, entry, part.id, generatedId, level + 1, calculatedQuantity, itemPath, items);
      }
    });
  }

  function toGeneratedItem(input) {
    return {
      id: input.id,
      sourceEngineeringBomId: input.sourceEngineeringBomId,
      sourceBomItemId: input.sourceBomItemId,
      sourceEngineeringModuleId: input.sourceEngineeringModuleId,
      partId: input.part && input.part.id || null,
      parentGeneratedItemId: input.parentGeneratedItemId,
      level: input.level,
      quantity: Number(input.quantity || 1),
      oemJit: input.bomItem && input.bomItem.oemJit || "",
      internalJit: input.bomItem && input.bomItem.internalJit || "",
      unit: input.unit || "EA",
      calculatedQuantity: Number(input.calculatedQuantity || input.quantity || 1),
      applicability: input.applicability || { included: true, reason: "UNCONDITIONAL" },
      totalCadWeight: input.bomItem && input.bomItem.totalCadWeight != null
        ? Number(input.bomItem.totalCadWeight)
        : calculateTotalCadWeight(input.part, input.calculatedQuantity || input.quantity),
      changeClassification: input.bomItem && input.bomItem.changeClassification || "UNCHANGED",
      remark: input.bomItem && input.bomItem.remark || "",
      path: input.path,
      sequence: Number(input.sequence || 0),
      sourcePartSnapshot: snapshotPart(input.part),
      validationStatus: "VALID"
    };
  }

  function validateGeneratedItems(items) {
    var errors = [];
    var ids = {};
    var childrenByParent = {};
    (items || []).forEach(function (item) {
      if (ids[item.id]) push(errors, "EPS_GENERATED_ID_DUPLICATE", "Generated item IDs must be unique.", "ENGINEERING_PRODUCT_STRUCTURE_ITEM", item.id);
      ids[item.id] = item;
      if (item.parentGeneratedItemId) {
        childrenByParent[item.parentGeneratedItemId] = childrenByParent[item.parentGeneratedItemId] || [];
        childrenByParent[item.parentGeneratedItemId].push(item);
      }
    });
    (items || []).forEach(function (item) {
      if (item.parentGeneratedItemId && !ids[item.parentGeneratedItemId]) push(errors, "EPS_GENERATED_ORPHAN", "Generated item parent must exist.", "ENGINEERING_PRODUCT_STRUCTURE_ITEM", item.id);
    });
    var visiting = {};
    var visited = {};
    function walk(itemId) {
      if (visiting[itemId]) {
        push(errors, "EPS_GENERATED_CYCLE", "Generated structure must not contain cycles.", "ENGINEERING_PRODUCT_STRUCTURE_ITEM", itemId);
        return;
      }
      if (visited[itemId]) return;
      visiting[itemId] = true;
      (childrenByParent[itemId] || []).forEach(function (child) {
        walk(child.id);
      });
      visited[itemId] = true;
      delete visiting[itemId];
    }
    var roots = (items || []).filter(function (item) { return !item.parentGeneratedItemId; });
    if (roots.length !== 1) push(errors, "EPS_GENERATED_ROOT_INVALID", "Generated structure must contain exactly one root.", "ENGINEERING_PRODUCT_STRUCTURE", null);
    if (roots[0]) walk(roots[0].id);
    return { valid: errors.length === 0, errors: errors, warnings: [] };
  }

  function validateBomApplicability(errors, bom, configuration, features) {
    (bom.items || []).forEach(function (item) {
      var applicabilityErrors = validateApplicabilityShape(item.applicability || {}, features, item.id);
      errors.push.apply(errors, applicabilityErrors);
      if (configuration) {
        try {
          evaluateApplicability(item.applicability || {}, configuration, features);
        } catch (error) {
          errors.push.apply(errors, error.validationErrors || []);
        }
      }
    });
  }

  function validateApplicabilityShape(applicability, features, objectId) {
    var errors = [];
    Object.keys(applicability || {}).forEach(function (key) {
      if (SUPPORTED_APPLICABILITY_KEYS.indexOf(key) === -1 && applicability[key] !== undefined && applicability[key] !== null && applicability[key] !== "") {
        push(errors, "EPS_APPLICABILITY_UNSUPPORTED", "Unsupported applicability expression: " + key, "ENGINEERING_BOM_ITEM", objectId);
      }
    });
    var featureIds = (features || []).map(function (feature) { return feature.id; });
    (applicability.requiredFeatureIds || []).concat(applicability.excludedFeatureIds || []).forEach(function (featureId) {
      if (featureIds.indexOf(featureId) === -1) {
        push(errors, "EPS_APPLICABILITY_FEATURE_MISSING", "Applicability references an unknown Feature.", "ENGINEERING_BOM_ITEM", objectId);
      }
    });
    (applicability.requiredValues || []).concat(applicability.excludedValues || []).forEach(function (condition) {
      var feature = findById(features, condition && condition.featureId);
      if (!feature) {
        push(errors, "EPS_APPLICABILITY_FEATURE_MISSING", "Applicability references an unknown Feature.", "ENGINEERING_BOM_ITEM", objectId);
        return;
      }
      if (Array.isArray(feature.allowedValues) && feature.allowedValues.length && feature.allowedValues.indexOf(condition.value) === -1) {
        push(errors, "EPS_APPLICABILITY_VALUE_INVALID", "Applicability value is not allowed for the referenced Feature.", "ENGINEERING_BOM_ITEM", objectId);
      }
    });
    return errors;
  }

  function validateConfigurationSelections(errors, configuration, features) {
    (configuration.selections || []).forEach(function (selection) {
      var feature = findById(features, selection.featureId);
      if (!feature) {
        push(errors, "EPS_CONFIGURATION_FEATURE_MISSING", "Feature Configuration references an unknown Feature.", "FEATURE_CONFIGURATION", configuration.id);
        return;
      }
      if (Array.isArray(feature.allowedValues) && feature.allowedValues.length && feature.allowedValues.indexOf(selection.selectedValue) === -1) {
        push(errors, "EPS_CONFIGURATION_VALUE_INVALID", "Feature Configuration selected value is invalid.", "FEATURE_CONFIGURATION", configuration.id);
      }
    });
  }

  function createSourceFingerprints(state, readiness) {
    var bomFingerprints = {};
    var partsById = indexById(state.parts || []);
    readiness.boms.forEach(function (entry) {
      bomFingerprints[entry.bom.id] = fingerprintBomWithParts(entry.bom, partsById);
    });
    return {
      configuration: stableStringify({
        id: readiness.configuration.id,
        status: readiness.configuration.status,
        selections: (readiness.configuration.selections || []).slice().sort(compareFeatureSelections)
      }),
      boms: bomFingerprints
    };
  }

  function fingerprintBomWithParts(bom, partsById) {
    var partIds = {};
    partIds[bom.rootPartId] = true;
    (bom.items || []).forEach(function (item) {
      partIds[item.parentPartId] = true;
      partIds[item.childPartId] = true;
    });
    return stableStringify({
      id: bom.id,
      lifecycleState: bom.lifecycleState,
      completionStatus: bom.completionStatus,
      rootPartId: bom.rootPartId,
      items: (bom.items || []).slice().sort(function (a, b) { return String(a.id).localeCompare(String(b.id)); }),
      parts: Object.keys(partIds).sort().map(function (partId) {
        return snapshotPart(partsById[partId]);
      })
    });
  }

  function compareFingerprints(structure, currentFingerprints) {
    var reasons = [];
    if (structure.sourceConfigurationFingerprint !== currentFingerprints.configuration) {
      reasons.push("FEATURE_CONFIGURATION_CHANGED");
    }
    var stored = structure.sourceEngineeringBomFingerprints || {};
    Object.keys(currentFingerprints.boms).forEach(function (bomId) {
      if (stored[bomId] !== currentFingerprints.boms[bomId]) {
        reasons.push("ENGINEERING_BOM_CHANGED");
      }
    });
    Object.keys(stored).forEach(function (bomId) {
      if (!currentFingerprints.boms[bomId]) reasons.push("REQUIRED_MODULE_AVAILABILITY_CHANGED");
    });
    return unique(reasons);
  }

  function markGenerationFailedFromReadiness(snapshot, built) {
    var readiness = built.readiness;
    if (!readiness.program || !readiness.seatVariant) return;
    var existing = findStructure(snapshot, readiness.program.id, readiness.seatVariant.id);
    var structureId = existing ? existing.id : makeStructureId(readiness.program.id, readiness.seatVariant.id);
    app.core.appState.transaction(function (state) {
      var current = findById(state.engineeringProductStructures, structureId);
      var failedAt = now();
      var failure = {
        id: structureId,
        programId: readiness.program.id,
        seatVariantId: readiness.seatVariant.id,
        lifecycleStatus: current && current.lifecycleStatus || "DRAFT",
        generationStatus: "GENERATION_FAILED",
        generatedAt: current && current.generatedAt || null,
        generatedBy: current && current.generatedBy || "",
        generationVersion: current && current.generationVersion || 0,
        sourceConfigurationId: readiness.configuration && readiness.configuration.id || current && current.sourceConfigurationId || "",
        sourceConfigurationFingerprint: current && current.sourceConfigurationFingerprint || "",
        sourceEngineeringBomIds: current && current.sourceEngineeringBomIds || [],
        sourceEngineeringBomFingerprints: current && current.sourceEngineeringBomFingerprints || {},
        items: current && current.items || [],
        validation: { valid: false, errors: readiness.blockingErrors, warnings: readiness.warnings },
        staleReasons: ["GENERATION_FAILED"],
        lastGenerationError: readiness.blockingErrors.map(function (item) { return item.code + ": " + item.message; }).join("; "),
        createdAt: current && current.createdAt || failedAt,
        updatedAt: failedAt
      };
      var index = findIndex(state.engineeringProductStructures, structureId);
      if (index === -1) state.engineeringProductStructures.push(failure);
      else state.engineeringProductStructures[index] = failure;
      app.core.appState._recordAuditEvent(state, {
        objectType: "ENGINEERING_PRODUCT_STRUCTURE",
        objectId: structureId,
        action: "ENGINEERING_PRODUCT_STRUCTURE_GENERATION_FAILED",
        details: failure.lastGenerationError
      });
    });
    app.events && app.events.emit && app.events.emit("engineering-product-structure:generation-failed", getEngineeringProductStructure(structureId));
  }

  function normalizeEngineeringProductStructure(input) {
    return {
      id: input.id,
      programId: input.programId,
      seatVariantId: input.seatVariantId,
      lifecycleStatus: input.lifecycleStatus || "DRAFT",
      generationStatus: normalizeGenerationStatus(input.generationStatus),
      generatedAt: input.generatedAt || null,
      generatedBy: input.generatedBy || "",
      generationVersion: Number(input.generationVersion || 0),
      sourceConfigurationId: input.sourceConfigurationId || input.featureConfigurationId || "",
      sourceConfigurationFingerprint: input.sourceConfigurationFingerprint || "",
      sourceEngineeringBomIds: (input.sourceEngineeringBomIds || []).slice(),
      sourceEngineeringBomFingerprints: Object.assign({}, input.sourceEngineeringBomFingerprints || {}),
      items: (input.items || []).map(function (item) { return Object.assign({}, item); }),
      validation: input.validation || { valid: true, errors: [], warnings: [] },
      staleReasons: (input.staleReasons || []).slice(),
      lastGenerationError: input.lastGenerationError || "",
      createdAt: input.createdAt || now(),
      updatedAt: input.updatedAt || now()
    };
  }

  function markCommercialAssessmentsStaleForGeneratedStructure(state, structure) {
    (state.commercialAssessments || []).forEach(function (assessment) {
      if (assessment.programId !== structure.programId || assessment.seatVariantId !== structure.seatVariantId) return;
      if (assessment.generationStatus === "GENERATION_FAILED") return;
      assessment.generationStatus = "STALE";
      assessment.staleReasons = ["ENGINEERING_PRODUCT_STRUCTURE_REGENERATED"];
      assessment.updatedAt = now();
    });
  }

  function findActiveConfiguration(state, seatVariantId) {
    var contextId = state.context && state.context.activeFeatureConfigurationId;
    var contextConfiguration = contextId && findById(state.featureConfigurations, contextId);
    if (contextConfiguration && contextConfiguration.seatVariantId === seatVariantId && contextConfiguration.status === "ACTIVE") return contextConfiguration;
    return (state.featureConfigurations || []).find(function (configuration) {
      return configuration.seatVariantId === seatVariantId && configuration.status === "ACTIVE";
    }) || null;
  }

  function getCurrentConfiguration(state, seatVariantId) {
    return findActiveConfiguration(state, seatVariantId);
  }

  function findStructure(state, programId, seatVariantId) {
    return (state.engineeringProductStructures || []).find(function (structure) {
      return structure.programId === programId && structure.seatVariantId === seatVariantId;
    }) || null;
  }

  function findBomForModule(state, programId, seatVariantId, moduleId) {
    return (state.engineeringBoms || []).find(function (bom) {
      return bom.programId === programId && bom.seatVariantId === seatVariantId && bom.engineeringModuleId === moduleId;
    }) || null;
  }

  function findModuleByCode(state, code) {
    var normalized = app.domain.engineeringModuleService.normalizeCode(code);
    return (state.engineeringModules || []).find(function (module) {
      return app.domain.engineeringModuleService.normalizeCode(module.code) === normalized;
    }) || null;
  }

  function snapshotPart(part) {
    if (!part) return {};
    return {
      id: part.id,
      partNumber: part.partNumber,
      internalPartNumber: part.internalPartNumber || part.partNumber,
      oemPartNumber: part.oemPartNumber || "",
      name: part.name || part.description,
      description: part.description || part.name,
      category: part.category || "",
      revision: part.currentRevision || "",
      drawingNumber: part.drawingNumber || "",
      drawingRevision: part.drawingRevision || "",
      commodity: part.commodity || "",
      sourceCommodityOriginal: part.sourceCommodityOriginal || part.commodity || "",
      sourceWorkbookSheet: part.sourceWorkbookSheet || "",
      sourceWorkbookRow: part.sourceWorkbookRow || "",
      material: part.material || "",
      gauge: part.gauge || "",
      cadWeight: part.cadWeight != null ? part.cadWeight : part.mass,
      imageReference: part.imageReference || "",
      threeDSharedDate: part.threeDSharedDate || "",
      twoDSharedDate: part.twoDSharedDate || "",
      weight: part.weight || "",
      status: fromLifecycle(part.lifecycleState),
      partType: part.partType,
      unitOfMeasure: part.unitOfMeasure || "EA"
    };
  }

  function getApplicableModules(state, seatVariant, configuration) {
    return (state.engineeringModules || []).filter(function (module) {
      return classifyModuleApplicability(state, module, seatVariant, configuration) === "REQUIRED";
    });
  }

  function classifyModuleApplicability(state, module, seatVariant, configuration) {
    if (!module) return "NOT_APPLICABLE";
    if (Array.isArray(module.applicableSeatTypes) && module.applicableSeatTypes.length && seatVariant) {
      var seatType = seatVariant.seatType || seatVariant.seatFamily || "";
      if (module.applicableSeatTypes.indexOf(seatType) === -1) return "NOT_APPLICABLE";
    }
    if (module.requiredByDefault) return "REQUIRED";
    var featureCode = module.requiredFeatureCode || module.featureCode;
    if (featureCode) return configurationHasFeature(state, configuration, featureCode) ? "REQUIRED" : "NOT_APPLICABLE";
    return "OPTIONAL";
  }

  function toModuleReadiness(module, bom, applicable, valid, issues, disposition) {
    return {
      engineeringModuleId: module.id,
      moduleCode: module.code,
      moduleName: module.name || module.label || module.code,
      disposition: disposition || (applicable ? "REQUIRED" : "NOT_APPLICABLE"),
      applicable: Boolean(applicable),
      required: Boolean(applicable),
      engineeringBomId: bom && bom.id || null,
      completionStatus: bom && bom.completionStatus || "NOT_STARTED",
      valid: Boolean(valid),
      blockingIssues: (issues || []).slice()
    };
  }

  function indexBomItemsByParent(items) {
    var index = {};
    (items || []).forEach(function (item) {
      index[item.parentPartId] = index[item.parentPartId] || [];
      index[item.parentPartId].push(item);
    });
    return index;
  }

  function configurationHasFeature(state, configuration, featureCode) {
    var normalizedCode = app.domain.engineeringModuleService.normalizeCode(featureCode);
    var feature = (state.features || []).find(function (candidate) {
      return app.domain.engineeringModuleService.normalizeCode(candidate.featureCode || candidate.code || "") === normalizedCode;
    });
    if (!feature) return false;
    return (configuration && configuration.selections || []).some(function (selection) {
      return selection.featureId === feature.id && String(selection.selectedValue || "").toUpperCase() !== "NO";
    });
  }

  function calculateTotalCadWeight(part, quantity) {
    var weight = part && (part.cadWeight != null ? part.cadWeight : part.mass);
    var numeric = Number(weight);
    if (isNaN(numeric)) return null;
    return numeric * Number(quantity || 1);
  }

  function hasApplicability(applicability) {
    return Boolean((applicability.requiredFeatureIds || []).length ||
      (applicability.excludedFeatureIds || []).length ||
      (applicability.requiredValues || []).length ||
      (applicability.excludedValues || []).length);
  }

  function normalizeGenerationStatus(status) {
    var value = String(status || "NOT_GENERATED").trim().toUpperCase().replace(/\s+/g, "_");
    return GENERATION_STATUSES.indexOf(value) === -1 ? "NOT_GENERATED" : value;
  }

  function isReleasedProductStructure(structure) {
    return Boolean(structure && (structure.lifecycleStatus === "RELEASED" || app.core.permissionService.isReleased(structure)));
  }

  function fromLifecycle(status) {
    if (status === "RELEASED") return "Released";
    if (status === "IN_WORK") return "In Work";
    if (status === "COMPLETE") return "Complete";
    if (status === "APPROVED") return "Approved";
    return "Planned";
  }

  function makeStructureId(programId, seatVariantId) {
    return "EPS-" + normalizeId(programId + "-" + seatVariantId);
  }

  function makeGeneratedItemId(structureId, bomId, bomItemId, partId) {
    return "EPSITEM-" + normalizeId([structureId, bomId, bomItemId || "ROOT", partId || ""].join("-"));
  }

  function shortHash(value) {
    var hash = 2166136261;
    var text = String(value || "");
    for (var index = 0; index < text.length; index += 1) {
      hash ^= text.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(36).toUpperCase();
  }

  function normalizeId(value) {
    return String(value || "").toUpperCase().replace(/[^A-Z0-9]+/g, "-").replace(/^-|-$/g, "");
  }

  function stableStringify(value) {
    if (value === null || typeof value !== "object") return JSON.stringify(value);
    if (Array.isArray(value)) return "[" + value.map(stableStringify).join(",") + "]";
    return "{" + Object.keys(value).sort().map(function (key) {
      return JSON.stringify(key) + ":" + stableStringify(value[key]);
    }).join(",") + "}";
  }

  function compareFeatureSelections(a, b) {
    return String(a.featureId).localeCompare(String(b.featureId));
  }

  function indexById(collection) {
    var index = {};
    (collection || []).forEach(function (item) {
      index[item.id] = item;
    });
    return index;
  }

  function findById(collection, id) {
    return (collection || []).find(function (item) {
      return item.id === id;
    }) || null;
  }

  function findIndex(collection, id) {
    return (collection || []).findIndex(function (item) {
      return item.id === id;
    });
  }

  function unique(values) {
    var seen = {};
    return values.filter(function (value) {
      if (seen[value]) return false;
      seen[value] = true;
      return true;
    });
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

  function notFound(objectType, id) {
    return new app.core.errors.BusinessOperationError(objectType + " was not found.", [
      { code: objectType + "_NOT_FOUND", message: objectType + " was not found.", objectType: objectType, objectId: id }
    ]);
  }

  app.domain.engineeringProductStructureService = {
    GENERATION_STATUSES: GENERATION_STATUSES.slice(),
    getEngineeringProductStructure: getEngineeringProductStructure,
    getEngineeringProductStructureForContext: getEngineeringProductStructureForContext,
    generateEngineeringProductStructure: generateEngineeringProductStructure,
    validateGenerationInputs: validateGenerationInputs,
    evaluateApplicability: evaluateApplicability,
    markEngineeringProductStructureStale: markEngineeringProductStructureStale,
    detectEngineeringProductStructureStaleness: detectEngineeringProductStructureStaleness,
    getGenerationReadiness: getGenerationReadiness,
    getEngineeringBomApplicability: getEngineeringBomApplicability,
    deleteDraftEngineeringProductStructure: deleteDraftEngineeringProductStructure,
    normalizeEngineeringProductStructure: normalizeEngineeringProductStructure
  };
})(typeof window !== "undefined" ? (window.DEP = window.DEP || {}) : (globalThis.DEP = globalThis.DEP || {}));
