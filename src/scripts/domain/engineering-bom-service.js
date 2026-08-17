(function (app) {
  app.domain = app.domain || {};

  function getEngineeringBom(id) {
    return app.core.appState.getById("engineeringBoms", id);
  }

  function getEngineeringBomForContext(criteria) {
    criteria = criteria || {};
    var context = app.core.contextService.getContext();
    var programId = criteria.programId || context.activeProgramId;
    var seatVariantId = criteria.seatVariantId || context.activeSeatVariantId;
    var engineeringModuleId = criteria.engineeringModuleId;
    return app.core.appState.getCollection("engineeringBoms").find(function (bom) {
      return bom.programId === programId &&
        bom.seatVariantId === seatVariantId &&
        (!engineeringModuleId || bom.engineeringModuleId === engineeringModuleId);
    }) || null;
  }

  function createEngineeringBom(input) {
    var bom = normalizeEngineeringBom(input || {});
    return app.core.appState.transaction(function (state) {
      validateEngineeringBom(bom, state, null);
      state.engineeringBoms.push(bom);
      app.core.appState._recordAuditEvent(state, {
        objectType: "ENGINEERING_BOM",
        objectId: bom.id,
        action: "OBJECT_CREATED"
      });
    });
  }

  function updateEngineeringBom(id, patch, options) {
    return app.core.appState.transaction(function (state) {
      var index = findIndex(state.engineeringBoms, id);
      if (index === -1) throw notFound("ENGINEERING_BOM", id);
      if (patch && patch.id && patch.id !== id) throw immutableId("ENGINEERING_BOM", id);
      assertBomEditable(state.engineeringBoms[index], state.context, state, options);
      if (patch && patch.engineeringModuleId && patch.engineeringModuleId !== state.engineeringBoms[index].engineeringModuleId) {
        throw new app.core.errors.BusinessOperationError("Engineering BOM Module cannot be changed.", [
          { code: "ENGINEERING_BOM_MODULE_IMMUTABLE", message: "An Engineering BOM belongs to one Engineering Module.", objectType: "ENGINEERING_BOM", objectId: id }
        ]);
      }
      var updated = normalizeEngineeringBom(Object.assign({}, state.engineeringBoms[index], patch || {}, { id: id }));
      validateEngineeringBom(updated, state, id);
      state.engineeringBoms[index] = updated;
      app.core.appState._recordAuditEvent(state, {
        objectType: "ENGINEERING_BOM",
        objectId: id,
        action: "OBJECT_UPDATED"
      });
      markEcnModification(state, options, "ENGINEERING_BOM", id, Object.keys(patch || {}));
    });
  }

  function deleteEngineeringBom(id, options) {
    return app.core.appState.transaction(function (state) {
      var index = findIndex(state.engineeringBoms, id);
      if (index === -1) throw notFound("ENGINEERING_BOM", id);
      assertBomEditable(state.engineeringBoms[index], state.context, state, options);
      state.engineeringBoms.splice(index, 1);
      app.core.appState._recordAuditEvent(state, {
        objectType: "ENGINEERING_BOM",
        objectId: id,
        action: "OBJECT_REMOVED"
      });
    });
  }

  function addBomItem(bomId, item, options) {
    return app.core.appState.transaction(function (state) {
      var bom = requireBom(state, bomId);
      assertBomEditable(bom, state.context, state, options);
      bom.items = (bom.items || []).concat(normalizeBomItem(item || {}, bom));
      validateEngineeringBom(bom, state, bomId);
      auditBomChanged(state, bomId, "BOM_ITEM_ADDED");
      markEcnModification(state, options, "ENGINEERING_BOM", bomId, ["items"]);
    });
  }

  function updateBomItem(bomId, itemId, patch, options) {
    return app.core.appState.transaction(function (state) {
      var bom = requireBom(state, bomId);
      var index = findIndex(bom.items || [], itemId);
      if (index === -1) throw notFound("ENGINEERING_BOM_ITEM", itemId);
      assertBomItemEditable(bom, itemId, state.context, state, options);
      if (patch && patch.id && patch.id !== itemId) throw immutableId("ENGINEERING_BOM_ITEM", itemId);
      bom.items[index] = normalizeBomItem(Object.assign({}, bom.items[index], patch || {}, { id: itemId }), bom);
      validateEngineeringBom(bom, state, bomId);
      auditBomChanged(state, bomId, "BOM_ITEM_UPDATED");
      markEcnModification(state, options, "ENGINEERING_BOM_ITEM", itemId, Object.keys(patch || {}));
    });
  }

  function removeBomItem(bomId, itemId, options) {
    return app.core.appState.transaction(function (state) {
      var bom = requireBom(state, bomId);
      var item = findById(bom.items || [], itemId);
      if (!item) throw notFound("ENGINEERING_BOM_ITEM", itemId);
      assertBomItemEditable(bom, itemId, state.context, state, options);
      var childIdsToRemove = collectDescendantChildIds(bom.items || [], item.childPartId);
      childIdsToRemove[item.childPartId] = true;
      bom.items = (bom.items || []).filter(function (candidate) {
        return !childIdsToRemove[candidate.childPartId];
      });
      validateEngineeringBom(bom, state, bomId);
      auditBomChanged(state, bomId, "BOM_ITEM_REMOVED");
      markEcnModification(state, options, "ENGINEERING_BOM_ITEM", itemId, ["removed"]);
    });
  }

  function moveBomItem(bomId, itemId, newParentPartId, sequence, options) {
    return updateBomItem(bomId, itemId, {
      parentPartId: newParentPartId,
      sequence: sequence
    }, options);
  }

  function replaceBomItems(bomId, items, options) {
    return app.core.appState.transaction(function (state) {
      var bom = requireBom(state, bomId);
      assertBomEditable(bom, state.context, state, options);
      bom.items = (items || []).map(function (item) {
        return normalizeBomItem(item, bom);
      });
      validateEngineeringBom(bom, state, bomId);
      auditBomChanged(state, bomId, "BOM_ITEMS_REPLACED");
    });
  }

  function setBomStatus(bomId, lifecycleState, options) {
    return updateEngineeringBom(bomId, { lifecycleState: normalizeLifecycle(lifecycleState) }, options);
  }

  function setBomCompletionStatus(bomId, completionStatus, options) {
    return updateEngineeringBom(bomId, { completionStatus: normalizeCompletionStatus(completionStatus) }, options);
  }

  function validateEngineeringBomForCompletion(bomId) {
    var state = app.core.appState.getState();
    var bom = requireBom(state, bomId);
    try {
      validateEngineeringBom(bom, state, bom.id);
      return { valid: true, bomId: bom.id, itemCount: (bom.items || []).length, errors: [] };
    } catch (error) {
      return {
        valid: false,
        bomId: bom.id,
        itemCount: (bom.items || []).length,
        errors: cloneErrors(error.validationErrors || error.errors || [])
      };
    }
  }

  function completeEngineeringBom(bomId, options) {
    return app.core.appState.transaction(function (state) {
      var bom = requireBom(state, bomId);
      assertBomEditable(bom, state.context, state, options);
      validateEngineeringBom(bom, state, bom.id);
      if (bom.completionStatus === "COMPLETE") return;
      bom.completionStatus = "COMPLETE";
      app.core.appState._recordAuditEvent(state, {
        objectType: "ENGINEERING_BOM",
        objectId: bom.id,
        action: "ENGINEERING_BOM_COMPLETED",
        details: JSON.stringify({ itemCount: (bom.items || []).length })
      });
      markEcnModification(state, options, "ENGINEERING_BOM", bom.id, ["completionStatus"]);
    });
  }

  function validateBomHierarchy(bom, state) {
    var errors = [];
    validateHierarchy(errors, bom, state);
    if (errors.length) throw new app.core.errors.BusinessOperationError("Engineering BOM hierarchy validation failed.", errors);
    return { valid: true, errors: [] };
  }

  function normalizeEngineeringBom(input) {
    return {
      id: trim(input.id) || makeId("EBOM", [input.engineeringModuleId, input.programId, input.seatVariantId].filter(Boolean).join("-")),
      programId: trim(input.programId),
      seatVariantId: trim(input.seatVariantId),
      engineeringModuleId: trim(input.engineeringModuleId),
      rootPartId: trim(input.rootPartId),
      lifecycleState: normalizeLifecycle(input.lifecycleState || "DRAFT"),
      completionStatus: normalizeCompletionStatus(input.completionStatus || "IN_PROGRESS"),
      items: (input.items || []).map(function (item) {
        return normalizeBomItem(item, input);
      })
    };
  }

  function normalizeBomItem(input, bom) {
    return {
      id: trim(input.id) || makeId("BOMITEM", [bom.id, input.parentPartId, input.childPartId].filter(Boolean).join("-")),
      parentPartId: trim(input.parentPartId),
      childPartId: trim(input.childPartId),
      oemJit: trim(input.oemJit),
      internalJit: trim(input.internalJit),
      quantity: toNumber(input.quantity),
      unitOfMeasure: trim(input.unitOfMeasure || "EA"),
      sequence: toNumber(input.sequence || 10),
      totalCadWeight: toNumberOrNull(input.totalCadWeight),
      changeClassification: normalizeChangeClassification(input.changeClassification || input.changeClass || input.changeType),
      remark: trim(input.remark || input.remarks),
      applicability: normalizeApplicability(input.applicability),
      sourceWorkbookFingerprint: trim(input.sourceWorkbookFingerprint),
      sourceWorkbookSheet: trim(input.sourceWorkbookSheet),
      sourceWorkbookRow: input.sourceWorkbookRow === null || input.sourceWorkbookRow === undefined ? "" : input.sourceWorkbookRow,
      sourceOccurrenceKey: trim(input.sourceOccurrenceKey),
      hierarchyPath: trim(input.hierarchyPath),
      duplicateSourceRows: Array.isArray(input.duplicateSourceRows) ? input.duplicateSourceRows.slice() : []
    };
  }

  function validateEngineeringBom(bom, state, existingId) {
    var errors = [];
    var program = findById(state.programs, bom.programId);
    var variant = findById(state.seatVariants, bom.seatVariantId);
    var module = findById(state.engineeringModules, bom.engineeringModuleId);
    var root = findById(state.parts, bom.rootPartId);

    if (!bom.id) push(errors, "ENGINEERING_BOM_ID_REQUIRED", "Engineering BOM ID is required.", bom.id);
    if (bom.id && state.engineeringBoms.some(function (item) { return item.id !== existingId && item.id === bom.id; })) {
      push(errors, "ENGINEERING_BOM_ID_DUPLICATE", "Engineering BOM ID must be unique.", bom.id);
    }
    if (!program) push(errors, "ENGINEERING_BOM_PROGRAM_MISSING", "Engineering BOM cannot reference an unknown Program.", bom.id);
    if (!variant) push(errors, "ENGINEERING_BOM_VARIANT_MISSING", "Engineering BOM cannot reference an unknown Seat Variant.", bom.id);
    if (program && variant && variant.programId !== program.id) {
      push(errors, "ENGINEERING_BOM_PROGRAM_VARIANT_MISMATCH", "Engineering BOM Seat Variant must belong to the referenced Program.", bom.id);
    }
    if (!module) push(errors, "ENGINEERING_BOM_MODULE_MISSING", "Engineering BOM cannot reference an unknown Engineering Module.", bom.id);
    if (!root) push(errors, "ENGINEERING_BOM_ROOT_MISSING", "Engineering BOM root Part is required.", bom.id);
    if (root && root.partType !== "ASSEMBLY") push(errors, "ENGINEERING_BOM_ROOT_NOT_ASSEMBLY", "Engineering BOM root must be an Assembly.", bom.id);
    if (root && module && !partAllowedInBomModule(root, module.id)) {
      push(errors, "ENGINEERING_BOM_ROOT_MODULE_MISMATCH", "Engineering BOM root must belong to the BOM module.", bom.id);
    }
    if ((app.data.referenceData.lifecycleStates || []).indexOf(bom.lifecycleState) === -1) {
      push(errors, "ENGINEERING_BOM_LIFECYCLE_INVALID", "Engineering BOM lifecycle status is not controlled.", bom.id);
    }
    if ((app.data.referenceData.engineeringBomCompletionStatuses || []).indexOf(bom.completionStatus) === -1) {
      push(errors, "ENGINEERING_BOM_COMPLETION_INVALID", "Engineering BOM completion status is not controlled.", bom.id);
    }
    if (state.engineeringBoms.some(function (item) {
      return item.id !== existingId &&
        item.programId === bom.programId &&
        item.seatVariantId === bom.seatVariantId &&
        item.engineeringModuleId === bom.engineeringModuleId;
    })) {
      push(errors, "ENGINEERING_BOM_DUPLICATE_CONTEXT", "Only one Engineering BOM per Program, Seat Variant, and Engineering Module is allowed.", bom.id);
    }

    validateItems(errors, bom, state, module, indexById(state.parts || []));
    validateHierarchy(errors, bom, state);
    if (errors.length) throw new app.core.errors.BusinessOperationError("Engineering BOM validation failed.", errors);
  }

  function validateItems(errors, bom, state, module, partsById) {
    var duplicateRows = {};
    (bom.items || []).forEach(function (item) {
      var parent = partsById[item.parentPartId];
      var child = partsById[item.childPartId];
      if (!parent) push(errors, "BOM_PARENT_PART_MISSING", "BOM parent Part does not exist.", item.id);
      if (!child) push(errors, "BOM_CHILD_PART_MISSING", "BOM child Part does not exist.", item.id);
      if (parent && parent.partType !== "ASSEMBLY") push(errors, "BOM_PARENT_NOT_ASSEMBLY", "BOM parent must be an Assembly.", item.id);
      if (module && parent && !partAllowedInBomModule(parent, module.id)) push(errors, "BOM_PARENT_MODULE_MISMATCH", "BOM parent belongs to a different module.", item.id);
      if (module && child && !partAllowedInBomModule(child, module.id)) push(errors, "BOM_CHILD_MODULE_MISMATCH", "BOM child belongs to a different module.", item.id);
      if (item.parentPartId && item.childPartId && item.parentPartId === item.childPartId) {
        push(errors, "BOM_SELF_PARENT_INVALID", "A Part cannot be its own BOM parent.", item.id);
      }
      if (Number(item.quantity) <= 0) push(errors, "BOM_QUANTITY_INVALID", "BOM quantity must be greater than zero.", item.id);
      if ((app.data.referenceData.unitsOfMeasure || []).indexOf(item.unitOfMeasure) === -1) {
        push(errors, "BOM_UNIT_INVALID", "BOM unit of measure is not controlled.", item.id);
      }
      if (item.changeClassification && (app.data.referenceData.changeClassifications || []).indexOf(item.changeClassification) === -1) {
        push(errors, "BOM_CHANGE_CLASSIFICATION_INVALID", "BOM change classification is not controlled.", item.id);
      }
      validateApplicability(errors, item, state.features);
      var duplicateKey = item.parentPartId + ">" + item.childPartId;
      if (duplicateRows[duplicateKey]) {
        push(errors, "BOM_DUPLICATE_ROW", "Duplicate child Part under the same parent is not allowed.", item.id);
      }
      duplicateRows[duplicateKey] = true;
    });
  }

  function partAllowedInBomModule(part, moduleId) {
    return part.engineeringModuleId === moduleId || (part.allowedBomModuleIds || []).indexOf(moduleId) !== -1;
  }

  function validateApplicability(errors, item, features) {
    var featureIds = (features || []).map(function (feature) { return feature.id; });
    var applicability = item.applicability || {};
    (applicability.requiredFeatureIds || []).concat(applicability.excludedFeatureIds || []).forEach(function (featureId) {
      if (featureIds.indexOf(featureId) === -1) {
        push(errors, "BOM_APPLICABILITY_FEATURE_MISSING", "BOM applicability references an unknown Feature.", item.id);
      }
    });
    (applicability.requiredValues || []).concat(applicability.excludedValues || []).forEach(function (condition) {
      var feature = findById(features, condition.featureId);
      if (!feature) {
        push(errors, "BOM_APPLICABILITY_FEATURE_MISSING", "BOM applicability references an unknown Feature.", item.id);
        return;
      }
      if (Array.isArray(feature.allowedValues) && feature.allowedValues.length && feature.allowedValues.indexOf(condition.value) === -1) {
        push(errors, "BOM_APPLICABILITY_VALUE_INVALID", "BOM applicability value is not allowed for the referenced Feature.", item.id);
      }
    });
  }

  function validateHierarchy(errors, bom, state) {
    var items = bom.items || [];
    var childrenByParent = {};
    items.forEach(function (item) {
      childrenByParent[item.parentPartId] = childrenByParent[item.parentPartId] || [];
      childrenByParent[item.parentPartId].push(item.childPartId);
    });

    var reachable = {};
    var visiting = {};
    function walk(partId, ancestors) {
      if (visiting[partId]) {
        push(errors, "BOM_HIERARCHY_CYCLE", "BOM hierarchy must not contain cycles.", bom.id);
        return;
      }
      visiting[partId] = true;
      reachable[partId] = true;
      (childrenByParent[partId] || []).forEach(function (childId) {
        if (ancestors.indexOf(childId) !== -1) {
          push(errors, "BOM_HIERARCHY_CYCLE", "A Part must not be its own ancestor.", bom.id);
          return;
        }
        walk(childId, ancestors.concat(partId));
      });
      delete visiting[partId];
    }
    if (bom.rootPartId) walk(bom.rootPartId, []);

    items.forEach(function (item) {
      if (!reachable[item.parentPartId]) {
        push(errors, "BOM_ORPHAN_ROW", "BOM item parent is not reachable from the root Assembly.", item.id);
      }
      if (!reachable[item.childPartId]) {
        push(errors, "BOM_ORPHAN_ROW", "BOM item child is not reachable from the root Assembly.", item.id);
      }
    });
  }

  function normalizeApplicability(applicability) {
    applicability = applicability || {};
    return {
      requiredFeatureIds: (applicability.requiredFeatureIds || []).slice(),
      excludedFeatureIds: (applicability.excludedFeatureIds || []).slice(),
      requiredValues: (applicability.requiredValues || []).map(normalizeApplicabilityCondition),
      excludedValues: (applicability.excludedValues || []).map(normalizeApplicabilityCondition)
    };
  }

  function normalizeApplicabilityCondition(condition) {
    return {
      featureId: trim(condition.featureId),
      value: trim(condition.value)
    };
  }

  function assertBomEditable(bom, context, state, options) {
    app.core.permissionService.assertCanEdit("engineeringBoms", bom, Object.assign({}, context || {}, {
      state: state,
      engineeringChangeId: options && (options.engineeringChangeId || options.changeId)
    }));
  }

  function assertBomItemEditable(bom, itemId, context, state, options) {
    if (!app.core.permissionService.isReleased(bom)) return;
    var operation = Object.assign({}, context || {}, {
      state: state,
      engineeringChangeId: options && (options.engineeringChangeId || options.changeId)
    });
    if (app.core.permissionService.canModifyReleasedObject("ENGINEERING_BOM_ITEM", itemId, operation)) return;
    app.core.permissionService.assertCanEdit("engineeringBoms", bom, operation);
  }

  function markEcnModification(state, options, objectType, objectId, changedFields) {
    var changeId = options && (options.engineeringChangeId || options.changeId);
    if (changeId && app.domain.engineeringChangeImpactService) {
      app.domain.engineeringChangeImpactService._markAffectedObjectModifiedInState(state, changeId, objectType, objectId, changedFields);
    }
  }

  function requireBom(state, bomId) {
    var bom = findById(state.engineeringBoms, bomId);
    if (!bom) throw notFound("ENGINEERING_BOM", bomId);
    return bom;
  }

  function collectDescendantChildIds(items, parentPartId) {
    var descendants = {};
    items.filter(function (item) { return item.parentPartId === parentPartId; }).forEach(function (item) {
      descendants[item.childPartId] = true;
      Object.assign(descendants, collectDescendantChildIds(items, item.childPartId));
    });
    return descendants;
  }

  function auditBomChanged(state, bomId, action) {
    app.core.appState._recordAuditEvent(state, {
      objectType: "ENGINEERING_BOM",
      objectId: bomId,
      action: action
    });
  }

  function normalizeLifecycle(value) {
    var normalized = normalizeCode(value || "DRAFT");
    if (normalized === "INWORK") return "IN_WORK";
    if (normalized === "PLANNED") return "DRAFT";
    if ((app.data.referenceData.lifecycleStates || []).indexOf(normalized) !== -1) return normalized;
    return "DRAFT";
  }

  function normalizeCompletionStatus(value) {
    var normalized = normalizeCode(value || "IN_PROGRESS");
    if ((app.data.referenceData.engineeringBomCompletionStatuses || []).indexOf(normalized) !== -1) return normalized;
    return "IN_PROGRESS";
  }

  function toNumber(value) {
    var number = Number(value);
    return isNaN(number) ? 0 : number;
  }

  function toNumberOrNull(value) {
    if (value === "" || value === null || value === undefined) return null;
    var number = Number(String(value).replace(/[^\d.-]/g, ""));
    return isNaN(number) ? null : number;
  }

  function normalizeChangeClassification(value) {
    var normalized = normalizeCode(value || "UNCHANGED");
    if (normalized === "C_O" || normalized === "CO" || normalized === "CARRYOVER") return "CARRY_OVER";
    if (normalized === "NEW") return "NEW";
    if (normalized === "MODIFIED") return "MODIFIED";
    if (normalized === "DELETED") return "DELETED";
    if (normalized === "REPLACED") return "REPLACED";
    return "UNCHANGED";
  }

  function trim(value) {
    return String(value == null ? "" : value).trim();
  }

  function normalizeCode(value) {
    return trim(value).toUpperCase().replace(/[\s-]+/g, "_");
  }

  function makeId(prefix, code) {
    return prefix + "-" + normalizeCode(code || Date.now().toString(36)).replace(/[^A-Z0-9]+/g, "-").replace(/^-|-$/g, "");
  }

  function findById(collection, id) {
    return (collection || []).find(function (item) {
      return item.id === id;
    });
  }

  function findIndex(collection, id) {
    return collection.findIndex(function (item) {
      return item.id === id;
    });
  }

  function indexById(collection) {
    var index = {};
    (collection || []).forEach(function (item) {
      index[item.id] = item;
    });
    return index;
  }

  function cloneErrors(errors) {
    return (errors || []).map(function (error) {
      return Object.assign({}, error);
    });
  }

  function push(errors, code, message, objectId) {
    errors.push({ code: code, message: message, objectType: "ENGINEERING_BOM", objectId: objectId || null });
  }

  function notFound(objectType, id) {
    return new app.core.errors.BusinessOperationError(objectType + " was not found.", [
      { code: objectType + "_NOT_FOUND", message: objectType + " was not found.", objectType: objectType, objectId: id }
    ]);
  }

  function immutableId(objectType, id) {
    return new app.core.errors.BusinessOperationError(objectType + " ID cannot be changed.", [
      { code: objectType + "_ID_IMMUTABLE", message: objectType + " ID is stable and immutable.", objectType: objectType, objectId: id }
    ]);
  }

  app.domain.engineeringBomService = {
    createEngineeringBom: createEngineeringBom,
    updateEngineeringBom: updateEngineeringBom,
    deleteEngineeringBom: deleteEngineeringBom,
    getEngineeringBom: getEngineeringBom,
    getEngineeringBomForContext: getEngineeringBomForContext,
    addBomItem: addBomItem,
    updateBomItem: updateBomItem,
    removeBomItem: removeBomItem,
    moveBomItem: moveBomItem,
    replaceBomItems: replaceBomItems,
    setBomStatus: setBomStatus,
    setBomCompletionStatus: setBomCompletionStatus,
    validateEngineeringBomForCompletion: validateEngineeringBomForCompletion,
    completeEngineeringBom: completeEngineeringBom,
    validateBomHierarchy: validateBomHierarchy,
    normalizeEngineeringBom: normalizeEngineeringBom,
    normalizeBomItem: normalizeBomItem,
    validateEngineeringBom: validateEngineeringBom
  };
})(typeof window !== "undefined" ? (window.DEP = window.DEP || {}) : (globalThis.DEP = globalThis.DEP || {}));
