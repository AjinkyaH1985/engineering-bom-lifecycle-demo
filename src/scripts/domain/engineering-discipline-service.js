(function (app) {
  app.domain = app.domain || {};

  function getModuleContext(moduleCode, criteria) {
    var module = requireModule(moduleCode);
    var context = app.core.contextService.getContext();
    var programId = criteria && criteria.programId || context.activeProgramId;
    var seatVariantId = criteria && criteria.seatVariantId || context.activeSeatVariantId;
    return {
      module: module,
      programId: programId || null,
      seatVariantId: seatVariantId || null,
      bom: programId && seatVariantId ? getModuleBom(moduleCode, programId, seatVariantId) : null
    };
  }

  function getModuleParts(moduleCode) {
    var module = requireModule(moduleCode);
    return app.domain.partService.listPartsByModule(module.id).filter(function (part) {
      return part.partType === "PART";
    });
  }

  function getModuleAssemblies(moduleCode) {
    var module = requireModule(moduleCode);
    return app.domain.partService.listAssembliesByModule(module.id);
  }

  function getModuleBom(moduleCode, programId, seatVariantId) {
    var module = requireModule(moduleCode);
    return app.domain.engineeringBomService.getEngineeringBomForContext({
      programId: programId,
      seatVariantId: seatVariantId,
      engineeringModuleId: module.id
    });
  }

  function createModulePart(moduleCode, input) {
    return app.domain.partService.createPart(withModule(moduleCode, Object.assign({}, input || {}, { partType: "PART" }), "PART"));
  }

  function createModuleAssembly(moduleCode, input) {
    return app.domain.partService.createPart(withModule(moduleCode, Object.assign({}, input || {}, { partType: "ASSEMBLY" }), "PART"));
  }

  function updateModulePart(moduleCode, id, patch, options) {
    assertModulePart(moduleCode, id);
    if (patch && patch.engineeringModuleId && patch.engineeringModuleId !== requireModule(moduleCode).id) {
      throw ownershipError(moduleCode, "PART", id);
    }
    return app.domain.partService.updatePart(id, patch || {}, options || {});
  }

  function deleteModulePart(moduleCode, id) {
    assertModulePart(moduleCode, id);
    return app.domain.partService.deletePart(id);
  }

  function createModuleBom(moduleCode, input) {
    return app.domain.engineeringBomService.createEngineeringBom(withModule(moduleCode, input || {}, "ENGINEERING_BOM"));
  }

  function updateModuleBom(moduleCode, id, patch, options) {
    assertModuleBom(moduleCode, id);
    if (patch && patch.engineeringModuleId && patch.engineeringModuleId !== requireModule(moduleCode).id) {
      throw ownershipError(moduleCode, "ENGINEERING_BOM", id);
    }
    return app.domain.engineeringBomService.updateEngineeringBom(id, patch || {}, options || {});
  }

  function deleteModuleBom(moduleCode, id) {
    assertModuleBom(moduleCode, id);
    return app.domain.engineeringBomService.deleteEngineeringBom(id);
  }

  function addModuleBomItem(moduleCode, bomId, item, options) {
    assertModuleBom(moduleCode, bomId);
    return app.domain.engineeringBomService.addBomItem(bomId, item || {}, options || {});
  }

  function updateModuleBomItem(moduleCode, bomId, itemId, patch, options) {
    assertModuleBom(moduleCode, bomId);
    return app.domain.engineeringBomService.updateBomItem(bomId, itemId, patch || {}, options || {});
  }

  function removeModuleBomItem(moduleCode, bomId, itemId, options) {
    assertModuleBom(moduleCode, bomId);
    return app.domain.engineeringBomService.removeBomItem(bomId, itemId, options || {});
  }

  function moveModuleBomItem(moduleCode, bomId, itemId, newParentPartId, sequence) {
    assertModuleBom(moduleCode, bomId);
    return app.domain.engineeringBomService.moveBomItem(bomId, itemId, newParentPartId, sequence);
  }

  function replaceModuleBomItems(moduleCode, bomId, items) {
    assertModuleBom(moduleCode, bomId);
    return app.domain.engineeringBomService.replaceBomItems(bomId, items || []);
  }

  function setModuleBomStatus(moduleCode, bomId, lifecycleState) {
    assertModuleBom(moduleCode, bomId);
    return app.domain.engineeringBomService.setBomStatus(bomId, lifecycleState);
  }

  function setModuleCompletionStatus(moduleCode, bomId, completionStatus) {
    assertModuleBom(moduleCode, bomId);
    return app.domain.engineeringBomService.setBomCompletionStatus(bomId, completionStatus);
  }

  function validateModuleBomForCompletion(moduleCode, bomId) {
    assertModuleBom(moduleCode, bomId);
    return app.domain.engineeringBomService.validateEngineeringBomForCompletion(bomId);
  }

  function completeModuleBom(moduleCode, bomId, options) {
    assertModuleBom(moduleCode, bomId);
    return app.domain.engineeringBomService.completeEngineeringBom(bomId, options || {});
  }

  function saveModuleRows(moduleCode, rows, options) {
    rows = clone(rows || []);
    return app.core.appState.transaction(function (state) {
      var context = state.context || {};
      if (!context.activeProgramId || !context.activeSeatVariantId) {
        throw businessError("ENGINEERING_CONTEXT_REQUIRED", "Engineering BOM cannot be saved without an active Program and Seat Variant.", "ENGINEERING_BOM", null);
      }
      var module = findModuleByCode(state, moduleCode);
      if (!module) throw notFound("ENGINEERING_MODULE", moduleCode);
      validateWorkspaceRows(rows, moduleCode);
      if (!rows.length) return;

      var rootRows = rows.filter(function (row) {
        return isAssemblyRow(row) && !row.parentId;
      });
      if (rootRows.length !== 1) {
        throw businessError("ENGINEERING_ROOT_INVALID", "Engineering BOM must contain exactly one root Assembly.", "ENGINEERING_BOM", null);
      }

      var partByNumber = indexPartsByNumber(state.parts);
      var partById = indexPartsById(state.parts);
      var rowIdToPart = {};

      rows.forEach(function (row) {
        var existingPart = resolveExistingPart(row, partById, partByNumber);
        var normalizedPart = app.domain.partService.normalizePart({
          id: existingPart ? existingPart.id : makePartId(row.partNumber),
          partNumber: row.partNumber,
          internalPartNumber: row.internalPartNumber || row.partNumber,
          oemPartNumber: row.oemPartNumber,
          name: row.description,
          description: row.description,
          category: row.category,
          partType: isAssemblyRow(row) ? "ASSEMBLY" : "PART",
          engineeringModuleId: module.id,
          material: row.material,
          commodity: row.commodity,
          gauge: row.gauge,
          imageReference: row.imageReference,
          drawingNumber: row.drawingNumber,
          drawingRevision: row.drawingRevision,
          cadWeight: row.cadWeight,
          threeDSharedDate: row.threeDSharedDate,
          twoDSharedDate: row.twoDSharedDate,
          weight: row.weight,
          unitOfMeasure: row.unitOfMeasure || "EA",
          lifecycleState: toLifecycle(row.status),
          currentRevision: row.revision
        });

        if (existingPart) {
          if (existingPart.engineeringModuleId !== module.id) throw ownershipError(moduleCode, "PART", existingPart.id);
          if (app.core.permissionService.isReleased(existingPart)) {
            assertReleasedPartUnchanged(state, moduleCode, existingPart, normalizedPart, row, options);
          } else {
            Object.assign(existingPart, normalizedPart, { id: existingPart.id });
            app.domain.partService.validatePart(existingPart, state.parts, state.engineeringModules, existingPart.id);
          }
          rowIdToPart[row.id] = existingPart;
          rowIdToPart[row.partNumber] = existingPart;
          if (row.partId) rowIdToPart[row.partId] = existingPart;
          return;
        }

        app.domain.partService.validatePart(normalizedPart, state.parts, state.engineeringModules);
        state.parts.push(normalizedPart);
        partByNumber[normalizePartNumber(normalizedPart.partNumber)] = normalizedPart;
        partById[normalizedPart.id] = normalizedPart;
        rowIdToPart[row.id] = normalizedPart;
        rowIdToPart[row.partNumber] = normalizedPart;
        rowIdToPart[normalizedPart.id] = normalizedPart;
      });

      var rootPart = rowIdToPart[rootRows[0].id] || rowIdToPart[rootRows[0].partNumber] || rowIdToPart[rootRows[0].partId];
      var bom = findModuleBom(state, context.activeProgramId, context.activeSeatVariantId, module.id);
      if (bom && app.core.permissionService.isReleased(bom)) {
        var authorisedBomChange = findAuthorisingChange(state, "ENGINEERING_BOM", bom.id, options);
        if (!authorisedBomChange) {
          throw new app.core.errors.PermissionError("Released Engineering BOM cannot be edited directly.", [
            { code: "RELEASED_OBJECT_IMMUTABLE", message: "Released Engineering BOMs cannot be edited directly.", objectType: "ENGINEERING_BOM", objectId: bom.id }
          ]);
        }
      }

      var items = rows.filter(function (row) { return row.parentId; }).map(function (row, index) {
        var parentPart = rowIdToPart[row.parentId];
        var childPart = rowIdToPart[row.id] || rowIdToPart[row.partNumber] || rowIdToPart[row.partId];
        if (!parentPart || !childPart) {
          throw businessError("ENGINEERING_PARENT_MISSING", "Engineering row parent could not be resolved.", "ENGINEERING_BOM", row.id);
        }
        return {
          id: row.bomItemId || makeBomItemId(parentPart.partNumber, childPart.partNumber),
          parentPartId: parentPart.id,
          childPartId: childPart.id,
          oemJit: row.oemJit,
          internalJit: row.internalJit,
          quantity: row.quantity,
          unitOfMeasure: row.unitOfMeasure || "EA",
          sequence: row.sequence || ((index + 1) * 10),
          totalCadWeight: row.totalCadWeight,
          changeClassification: row.changeClassification,
          remark: row.remark,
          applicability: row.applicability || { requiredFeatureIds: [], excludedFeatureIds: [], requiredValues: [], excludedValues: [] }
        };
      });

      if (!bom) {
        bom = app.domain.engineeringBomService.normalizeEngineeringBom({
          id: makeBomId(module.code, context.activeSeatVariantId),
          programId: context.activeProgramId,
          seatVariantId: context.activeSeatVariantId,
          engineeringModuleId: module.id,
          rootPartId: rootPart.id,
          lifecycleState: "DRAFT",
          completionStatus: "IN_PROGRESS",
          items: items
        });
        app.domain.engineeringBomService.validateEngineeringBom(bom, state, null);
        state.engineeringBoms.push(bom);
      } else {
        bom.rootPartId = rootPart.id;
        bom.items = items.map(function (item) {
          return app.domain.engineeringBomService.normalizeBomItem(item, bom);
        });
        app.domain.engineeringBomService.validateEngineeringBom(bom, state, bom.id);
      }

      app.core.appState._recordAuditEvent(state, {
        objectType: "ENGINEERING_BOM",
        objectId: bom.id,
        action: "ENGINEERING_BOM_SAVED",
        details: JSON.stringify({ moduleCode: module.code })
      });
      markGeneratedDataStale(state, context.activeProgramId, context.activeSeatVariantId);
      var changeId = options && (options.engineeringChangeId || options.changeId);
      if (changeId && app.domain.engineeringChangeImpactService) {
        var affectedItemIds = {};
        items.forEach(function (item) { affectedItemIds[item.id] = true; });
        var change = (state.engineeringChanges || []).find(function (candidate) { return candidate.id === changeId; });
        (change && change.affectedObjects || []).forEach(function (affected) {
          if (affected.objectType === "PART" && rowIdToPart[affected.objectId]) {
            app.domain.engineeringChangeImpactService._markAffectedObjectModifiedInState(state, changeId, "PART", affected.objectId, ["engineeringData"]);
          }
          if (affected.objectType === "ENGINEERING_BOM_ITEM" && affectedItemIds[affected.objectId]) {
            app.domain.engineeringChangeImpactService._markAffectedObjectModifiedInState(state, changeId, "ENGINEERING_BOM_ITEM", affected.objectId, ["quantity", "engineeringData"]);
          }
        });
        app.domain.engineeringChangeImpactService._markAffectedObjectModifiedInState(state, changeId, "ENGINEERING_BOM", bom.id, ["items"]);
      }
    });
  }

  function withModule(moduleCode, input, objectType) {
    var module = requireModule(moduleCode);
    if (input.engineeringModuleId && input.engineeringModuleId !== module.id) {
      throw ownershipError(moduleCode, objectType, input.id || input.partNumber || input.rootPartId);
    }
    return Object.assign({}, input, { engineeringModuleId: module.id });
  }

  function assertModulePart(moduleCode, id) {
    var module = requireModule(moduleCode);
    var part = app.domain.partService.getPartById(id);
    if (!part) throw notFound("PART", id);
    if (part.engineeringModuleId !== module.id) throw ownershipError(moduleCode, "PART", id);
    return part;
  }

  function assertModuleBom(moduleCode, id) {
    var module = requireModule(moduleCode);
    var bom = app.domain.engineeringBomService.getEngineeringBom(id);
    if (!bom) throw notFound("ENGINEERING_BOM", id);
    if (bom.engineeringModuleId !== module.id) throw ownershipError(moduleCode, "ENGINEERING_BOM", id);
    return bom;
  }

  function requireModule(moduleCode) {
    return app.domain.engineeringModuleService.requireModuleByCode(moduleCode);
  }

  function validateWorkspaceRows(rows, moduleCode) {
    var ids = {};
    var partNumbers = {};
    rows.forEach(function (row) {
      if (!row.partNumber) throw businessError("PART_NUMBER_REQUIRED", "Part Number is required.", "PART", row.id);
      if (!row.description) throw businessError("PART_NAME_REQUIRED", "Part Name is required.", "PART", row.id);
      var id = String(row.id || row.partNumber);
      if (ids[id]) throw businessError("ENGINEERING_ROW_ID_DUPLICATE", "Engineering row IDs must be unique.", "ENGINEERING_BOM", id);
      ids[id] = row;
      var partNumber = normalizePartNumber(row.partNumber);
      if (partNumbers[partNumber] && partNumbers[partNumber].partId !== row.partId) {
        throw businessError("PART_NUMBER_DUPLICATE", "Part Number must be unique.", "PART", row.id);
      }
      partNumbers[partNumber] = row;
    });
    rows.forEach(function (row) {
      if (row.parentId && !ids[row.parentId]) {
        throw businessError("ENGINEERING_PARENT_MISSING", "Engineering row parent does not exist.", "ENGINEERING_BOM", row.id);
      }
      if (row.parentId === row.id) {
        throw businessError("BOM_SELF_PARENT_INVALID", "A Part cannot be its own BOM parent.", "ENGINEERING_BOM", row.id);
      }
    });
    rows.forEach(function (row) {
      var seen = {};
      var current = row;
      while (current && current.parentId) {
        if (seen[current.id]) throw businessError("BOM_HIERARCHY_CYCLE", "Engineering hierarchy must not contain cycles.", "ENGINEERING_BOM", row.id);
        seen[current.id] = true;
        current = ids[current.parentId];
      }
    });
  }

  function resolveExistingPart(row, partById, partByNumber) {
    if (row.partId && partById[row.partId]) return partById[row.partId];
    if (row.id && partById[row.id]) return partById[row.id];
    if (row.id && partByNumber[normalizePartNumber(row.id)]) return partByNumber[normalizePartNumber(row.id)];
    if (row.partNumber && partByNumber[normalizePartNumber(row.partNumber)]) return partByNumber[normalizePartNumber(row.partNumber)];
    return null;
  }

  function assertReleasedPartUnchanged(state, moduleCode, existingPart, normalizedPart, row, options) {
    var changed = normalizePartNumber(existingPart.partNumber) !== normalizePartNumber(normalizedPart.partNumber) ||
      trim(existingPart.description || existingPart.name) !== trim(normalizedPart.description || normalizedPart.name) ||
      trim(existingPart.internalPartNumber) !== trim(normalizedPart.internalPartNumber) ||
      trim(existingPart.oemPartNumber) !== trim(normalizedPart.oemPartNumber) ||
      trim(existingPart.category) !== trim(normalizedPart.category) ||
      trim(existingPart.material) !== trim(normalizedPart.material) ||
      trim(existingPart.commodity) !== trim(normalizedPart.commodity) ||
      trim(existingPart.gauge) !== trim(normalizedPart.gauge) ||
      trim(existingPart.drawingNumber) !== trim(normalizedPart.drawingNumber) ||
      trim(existingPart.drawingRevision) !== trim(normalizedPart.drawingRevision) ||
      trim(existingPart.currentRevision) !== trim(normalizedPart.currentRevision) ||
      trim(existingPart.weight) !== trim(normalizedPart.weight) ||
      toLifecycle(row.status) !== existingPart.lifecycleState;
    if (changed) {
      var authorisedChange = findAuthorisingChange(state, "PART", existingPart.id, options);
      if (authorisedChange) {
        Object.assign(existingPart, normalizedPart, { id: existingPart.id });
        return;
      }
      throw new app.core.errors.PermissionError("Released Part cannot be edited directly.", [
        { code: "RELEASED_OBJECT_IMMUTABLE", message: "Released Parts cannot be edited directly.", objectType: "PART", objectId: existingPart.id, moduleCode: moduleCode }
      ]);
    }
  }

  function findAuthorisingChange(state, objectType, objectId, options) {
    if (!app.domain.engineeringChangeService) return null;
    var changeId = options && (options.engineeringChangeId || options.changeId);
    if (!changeId) return null;
    return (state.engineeringChanges || []).map(app.domain.engineeringChangeService.normalizeEngineeringChange).find(function (change) {
      if (change.id !== changeId && change.changeNumber !== changeId) return false;
      if (["APPROVED", "IMPLEMENTING"].indexOf(change.status) === -1) return false;
      return (change.affectedObjects || []).some(function (affected) {
        return affected.objectType === objectType && affected.objectId === objectId;
      });
    }) || null;
  }

  function markGeneratedDataStale(state, programId, seatVariantId) {
    (state.engineeringProductStructures || []).forEach(function (structure) {
      if (structure.programId !== programId || structure.seatVariantId !== seatVariantId) return;
      if (structure.generationStatus === "GENERATION_FAILED") return;
      structure.generationStatus = "STALE";
      structure.staleReasons = ["ENGINEERING_BOM_CHANGED"];
      structure.updatedAt = now();
      app.core.appState._recordAuditEvent(state, {
        objectType: "ENGINEERING_PRODUCT_STRUCTURE",
        objectId: structure.id,
        action: "ENGINEERING_PRODUCT_STRUCTURE_STALE",
        details: "Engineering eBOM changed."
      });
    });
    (state.commercialAssessments || []).forEach(function (assessment) {
      if (assessment.programId !== programId || assessment.seatVariantId !== seatVariantId) return;
      if (assessment.generationStatus === "GENERATION_FAILED") return;
      assessment.generationStatus = "STALE";
      assessment.staleReasons = ["ENGINEERING_BOM_CHANGED"];
      assessment.updatedAt = now();
      app.core.appState._recordAuditEvent(state, {
        objectType: "COMMERCIAL_ASSESSMENT",
        objectId: assessment.id,
        action: "COMMERCIAL_ASSESSMENT_STALE",
        details: "Engineering eBOM changed."
      });
    });
    if (app.domain.engineeringChangeImpactService) {
      (state.engineeringChanges || []).forEach(function (change) {
        if (!change.impactTrackingEnabled || change.programId !== programId || change.seatVariantId !== seatVariantId) return;
        if (["IMPLEMENTED", "REJECTED", "CANCELLED"].indexOf(change.status) !== -1) return;
        app.domain.engineeringChangeImpactService._recalculateInState(state, change, { audit: false, reason: "ENGINEERING_BOM_CHANGED" });
      });
    }
  }

  function findModuleByCode(state, code) {
    var normalized = app.domain.engineeringModuleService.normalizeCode(code);
    return (state.engineeringModules || []).find(function (module) {
      return app.domain.engineeringModuleService.normalizeCode(module.code) === normalized;
    }) || null;
  }

  function findModuleBom(state, programId, seatVariantId, moduleId) {
    return (state.engineeringBoms || []).find(function (bom) {
      return bom.programId === programId && bom.seatVariantId === seatVariantId && bom.engineeringModuleId === moduleId;
    }) || null;
  }

  function indexPartsByNumber(parts) {
    var index = {};
    (parts || []).forEach(function (part) {
      index[normalizePartNumber(part.partNumber)] = part;
    });
    return index;
  }

  function indexPartsById(parts) {
    var index = {};
    (parts || []).forEach(function (part) {
      index[part.id] = part;
    });
    return index;
  }

  function isAssemblyRow(row) {
    return String(row.type || "").toLowerCase() === "assembly";
  }

  function toLifecycle(status) {
    var value = String(status == null ? "" : status).trim().toUpperCase().replace(/\s+/g, "_");
    if (value === "IN_WORK") return "IN_WORK";
    if (value === "RELEASED") return "RELEASED";
    if (value === "PLANNED") return "DRAFT";
    return app.domain.partService.normalizeLifecycle(value || "DRAFT");
  }

  function normalizePartNumber(value) {
    return String(value == null ? "" : value).trim().toUpperCase();
  }

  function normalizeModuleCode(value) {
    return app.domain.engineeringModuleService.normalizeCode(value).replace(/[^A-Z0-9]+/g, "-");
  }

  function makePartId(partNumber) {
    return "PART-" + normalizePartNumber(partNumber).replace(/[^A-Z0-9]+/g, "-").replace(/^-|-$/g, "");
  }

  function makeBomId(moduleCode, seatVariantId) {
    return "EBOM-" + normalizeModuleCode(moduleCode) + "-" + String(seatVariantId || Date.now().toString(36)).replace(/[^A-Za-z0-9]+/g, "-");
  }

  function makeBomItemId(parentNumber, childNumber) {
    return "BOMITEM-" + normalizePartNumber(parentNumber + "-" + childNumber).replace(/[^A-Z0-9]+/g, "-").replace(/^-|-$/g, "");
  }

  function trim(value) {
    return String(value == null ? "" : value).trim();
  }

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function now() {
    return new Date().toISOString();
  }

  function businessError(code, message, objectType, objectId) {
    throw new app.core.errors.BusinessOperationError(message, [
      { code: code, message: message, objectType: objectType, objectId: objectId || null }
    ]);
  }

  function notFound(objectType, id) {
    return new app.core.errors.BusinessOperationError(objectType + " was not found.", [
      { code: objectType + "_NOT_FOUND", message: objectType + " was not found.", objectType: objectType, objectId: id }
    ]);
  }

  function ownershipError(moduleCode, objectType, id) {
    return new app.core.errors.BusinessOperationError("Object is not owned by the requested Engineering Module.", [
      { code: "ENGINEERING_MODULE_OWNERSHIP_INVALID", message: "Workspace may only author engineering data owned by its Engineering Module.", objectType: objectType, objectId: id || null, moduleCode: moduleCode }
    ]);
  }

  app.domain.engineeringDisciplineService = {
    getModuleContext: getModuleContext,
    getModuleParts: getModuleParts,
    getModuleAssemblies: getModuleAssemblies,
    getModuleBom: getModuleBom,
    saveModuleRows: saveModuleRows,
    createModulePart: createModulePart,
    createModuleAssembly: createModuleAssembly,
    updateModulePart: updateModulePart,
    deleteModulePart: deleteModulePart,
    createModuleBom: createModuleBom,
    updateModuleBom: updateModuleBom,
    deleteModuleBom: deleteModuleBom,
    addModuleBomItem: addModuleBomItem,
    updateModuleBomItem: updateModuleBomItem,
    removeModuleBomItem: removeModuleBomItem,
    moveModuleBomItem: moveModuleBomItem,
    replaceModuleBomItems: replaceModuleBomItems,
    setModuleBomStatus: setModuleBomStatus,
    setModuleCompletionStatus: setModuleCompletionStatus,
    validateModuleBomForCompletion: validateModuleBomForCompletion,
    completeModuleBom: completeModuleBom
  };
})(typeof window !== "undefined" ? (window.DEP = window.DEP || {}) : (globalThis.DEP = globalThis.DEP || {}));
