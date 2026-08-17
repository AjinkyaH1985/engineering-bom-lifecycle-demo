(function (app) {
  app.domain = app.domain || {};

  var MODULE_CODE = "STRUCTURE";

  function getStructureModule() {
    return app.domain.engineeringModuleService.requireModuleByCode(MODULE_CODE);
  }

  function getStructureBomForContext(programId, seatVariantId) {
    var module = getStructureModule();
    return app.domain.engineeringBomService.getEngineeringBomForContext({
      programId: programId,
      seatVariantId: seatVariantId,
      engineeringModuleId: module.id
    });
  }

  function getActiveStructureBom() {
    var context = app.core.contextService.getContext();
    if (!context.activeProgramId || !context.activeSeatVariantId) return null;
    return getStructureBomForContext(context.activeProgramId, context.activeSeatVariantId);
  }

  function createStructurePart(input) {
    return app.domain.partService.createPart(withStructureModule(Object.assign({}, input || {}, { partType: "PART" })));
  }

  function createStructureAssembly(input) {
    return app.domain.partService.createPart(withStructureModule(Object.assign({}, input || {}, { partType: "ASSEMBLY" })));
  }

  function updateStructurePart(id, patch) {
    assertStructurePartById(id);
    if (patch && patch.engineeringModuleId && patch.engineeringModuleId !== getStructureModule().id) {
      throw notStructureOwned("PART", id);
    }
    return app.domain.partService.updatePart(id, patch || {});
  }

  function deleteStructurePart(id) {
    assertStructurePartById(id);
    return app.domain.partService.deletePart(id);
  }

  function createStructureEngineeringBom(input) {
    return app.domain.engineeringBomService.createEngineeringBom(withStructureModule(input || {}));
  }

  function updateStructureEngineeringBom(id, patch) {
    assertStructureBomById(id);
    if (patch && patch.engineeringModuleId && patch.engineeringModuleId !== getStructureModule().id) {
      throw notStructureOwned("ENGINEERING_BOM", id);
    }
    return app.domain.engineeringBomService.updateEngineeringBom(id, patch || {});
  }

  function deleteStructureEngineeringBom(id) {
    assertStructureBomById(id);
    return app.domain.engineeringBomService.deleteEngineeringBom(id);
  }

  function addStructureBomItem(bomId, item) {
    assertStructureBomById(bomId);
    return app.domain.engineeringBomService.addBomItem(bomId, item);
  }

  function updateStructureBomItem(bomId, itemId, patch) {
    assertStructureBomById(bomId);
    return app.domain.engineeringBomService.updateBomItem(bomId, itemId, patch || {});
  }

  function removeStructureBomItem(bomId, itemId) {
    assertStructureBomById(bomId);
    return app.domain.engineeringBomService.removeBomItem(bomId, itemId);
  }

  function replaceStructureBomItems(bomId, items) {
    assertStructureBomById(bomId);
    return app.domain.engineeringBomService.replaceBomItems(bomId, items || []);
  }

  function setStructureBomStatus(bomId, lifecycleState) {
    assertStructureBomById(bomId);
    return app.domain.engineeringBomService.setBomStatus(bomId, lifecycleState);
  }

  function setStructureBomCompletionStatus(bomId, completionStatus) {
    assertStructureBomById(bomId);
    return app.domain.engineeringBomService.setBomCompletionStatus(bomId, completionStatus);
  }

  function replaceStructureRowsForContext(rows) {
    rows = clone(rows || []);
    return app.core.appState.transaction(function (state) {
      var context = state.context || {};
      if (!context.activeProgramId || !context.activeSeatVariantId) {
        throw new app.core.errors.BusinessOperationError("Structure BOM cannot be saved without an active Program and Seat Variant.", [
          { code: "STRUCTURE_CONTEXT_REQUIRED", message: "Select an active Program and Seat Variant before editing Structure.", objectType: "ENGINEERING_BOM", objectId: null }
        ]);
      }
      var module = findModuleByCode(state, MODULE_CODE);
      if (!module) throw notFound("ENGINEERING_MODULE", MODULE_CODE);
      validateWorkspaceRows(rows);
      if (!rows.length) return;

      var rootRows = rows.filter(function (row) {
        return isAssemblyRow(row) && !row.parentId;
      });
      if (rootRows.length !== 1) {
        throw businessError("STRUCTURE_ROOT_INVALID", "Structure BOM must contain exactly one root Assembly.", "ENGINEERING_BOM", null);
      }

      var partByNumber = indexPartsByNumber(state.parts);
      var partById = indexPartsById(state.parts);
      var rowIdToPart = {};

      rows.forEach(function (row) {
        var existingPart = resolveExistingPart(row, partById, partByNumber);
        var normalizedPart = app.domain.partService.normalizePart({
          id: existingPart ? existingPart.id : "PART-" + normalizePartNumber(row.partNumber).replace(/[^A-Z0-9]+/g, "-"),
          partNumber: row.partNumber,
          name: row.description,
          description: row.description,
          partType: isAssemblyRow(row) ? "ASSEMBLY" : "PART",
          engineeringModuleId: module.id,
          material: row.material,
          drawingNumber: row.drawingNumber,
          weight: row.weight,
          unitOfMeasure: row.unitOfMeasure || "EA",
          lifecycleState: toLifecycle(row.status),
          currentRevision: row.revision
        });
        if (existingPart) {
          if (existingPart.engineeringModuleId !== module.id) throw notStructureOwned("PART", existingPart.id);
          if (app.core.permissionService.isReleased(existingPart)) {
            assertReleasedPartUnchanged(existingPart, normalizedPart, row);
          } else {
            Object.assign(existingPart, normalizedPart, { id: existingPart.id });
            app.domain.partService.validatePart(existingPart, state.parts, state.engineeringModules, existingPart.id);
          }
          rowIdToPart[row.id] = existingPart;
          rowIdToPart[row.partNumber] = existingPart;
          return;
        }
        app.domain.partService.validatePart(normalizedPart, state.parts, state.engineeringModules);
        state.parts.push(normalizedPart);
        partByNumber[normalizePartNumber(normalizedPart.partNumber)] = normalizedPart;
        partById[normalizedPart.id] = normalizedPart;
        rowIdToPart[row.id] = normalizedPart;
        rowIdToPart[row.partNumber] = normalizedPart;
      });

      var rootPart = rowIdToPart[rootRows[0].id] || rowIdToPart[rootRows[0].partNumber];
      var bom = findStructureBom(state, context.activeProgramId, context.activeSeatVariantId, module.id);
      if (bom && app.core.permissionService.isReleased(bom)) {
        throw new app.core.errors.PermissionError("Released Structure BOM cannot be edited directly.", [
          { code: "RELEASED_OBJECT_IMMUTABLE", message: "Released Engineering BOMs cannot be edited directly.", objectType: "ENGINEERING_BOM", objectId: bom.id }
        ]);
      }

      var items = rows.filter(function (row) { return row.parentId; }).map(function (row, index) {
        var parentPart = rowIdToPart[row.parentId];
        var childPart = rowIdToPart[row.id] || rowIdToPart[row.partNumber];
        if (!parentPart || !childPart) {
          throw businessError("STRUCTURE_PARENT_MISSING", "Structure row parent could not be resolved.", "ENGINEERING_BOM", row.id);
        }
        return {
          id: row.bomItemId || "BOMITEM-" + normalizePartNumber(parentPart.partNumber + "-" + childPart.partNumber).replace(/[^A-Z0-9]+/g, "-"),
          parentPartId: parentPart.id,
          childPartId: childPart.id,
          quantity: row.quantity,
          unitOfMeasure: row.unitOfMeasure || "EA",
          sequence: row.sequence || ((index + 1) * 10),
          applicability: row.applicability || { requiredFeatureIds: [], excludedFeatureIds: [] }
        };
      });

      if (!bom) {
        bom = app.domain.engineeringBomService.normalizeEngineeringBom({
          id: "EBOM-STRUCTURE-" + context.activeSeatVariantId,
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
        action: "STRUCTURE_BOM_SAVED"
      });
    });
  }

  function withStructureModule(input) {
    var module = getStructureModule();
    if (input.engineeringModuleId && input.engineeringModuleId !== module.id) {
      throw notStructureOwned(input.rootPartId ? "ENGINEERING_BOM" : "PART", input.id || input.partNumber || input.rootPartId);
    }
    return Object.assign({}, input, { engineeringModuleId: module.id });
  }

  function assertStructurePartById(id) {
    var part = app.domain.partService.getPartById(id);
    if (!part) throw notFound("PART", id);
    if (part.engineeringModuleId !== getStructureModule().id) throw notStructureOwned("PART", id);
    return part;
  }

  function assertStructureBomById(id) {
    var bom = app.domain.engineeringBomService.getEngineeringBom(id);
    if (!bom) throw notFound("ENGINEERING_BOM", id);
    if (bom.engineeringModuleId !== getStructureModule().id) throw notStructureOwned("ENGINEERING_BOM", id);
    return bom;
  }

  function validateWorkspaceRows(rows) {
    var ids = {};
    var partNumbers = {};
    rows.forEach(function (row) {
      if (!row.partNumber) throw businessError("PART_NUMBER_REQUIRED", "Part Number is required.", "PART", row.id);
      if (!row.description) throw businessError("PART_NAME_REQUIRED", "Part Name is required.", "PART", row.id);
      var id = String(row.id || row.partNumber);
      if (ids[id]) throw businessError("STRUCTURE_ROW_ID_DUPLICATE", "Structure row IDs must be unique.", "ENGINEERING_BOM", id);
      ids[id] = row;
      var partNumber = normalizePartNumber(row.partNumber);
      if (partNumbers[partNumber]) throw businessError("PART_NUMBER_DUPLICATE", "Part Number must be unique.", "PART", row.id);
      partNumbers[partNumber] = row;
    });
    rows.forEach(function (row) {
      if (row.parentId && !ids[row.parentId]) {
        throw businessError("STRUCTURE_PARENT_MISSING", "Structure row parent does not exist.", "ENGINEERING_BOM", row.id);
      }
      if (row.parentId === row.id) {
        throw businessError("BOM_SELF_PARENT_INVALID", "A Part cannot be its own BOM parent.", "ENGINEERING_BOM", row.id);
      }
    });
    rows.forEach(function (row) {
      var seen = {};
      var current = row;
      while (current && current.parentId) {
        if (seen[current.id]) throw businessError("BOM_HIERARCHY_CYCLE", "Structure hierarchy must not contain cycles.", "ENGINEERING_BOM", row.id);
        seen[current.id] = true;
        current = ids[current.parentId];
      }
    });
  }

  function resolveExistingPart(row, partById, partByNumber) {
    if (row.partId && partById[row.partId]) return partById[row.partId];
    if (row.id && partByNumber[normalizePartNumber(row.id)]) return partByNumber[normalizePartNumber(row.id)];
    if (row.partNumber && partByNumber[normalizePartNumber(row.partNumber)]) return partByNumber[normalizePartNumber(row.partNumber)];
    return null;
  }

  function assertReleasedPartUnchanged(existingPart, normalizedPart, row) {
    var changed = normalizePartNumber(existingPart.partNumber) !== normalizePartNumber(normalizedPart.partNumber) ||
      trim(existingPart.description || existingPart.name) !== trim(normalizedPart.description || normalizedPart.name) ||
      trim(existingPart.material) !== trim(normalizedPart.material) ||
      trim(existingPart.currentRevision) !== trim(normalizedPart.currentRevision) ||
      trim(existingPart.weight) !== trim(normalizedPart.weight) ||
      toLifecycle(row.status) !== existingPart.lifecycleState;
    if (changed) {
      throw new app.core.errors.PermissionError("Released Structure Part cannot be edited directly.", [
        { code: "RELEASED_OBJECT_IMMUTABLE", message: "Released Parts cannot be edited directly.", objectType: "PART", objectId: existingPart.id }
      ]);
    }
  }

  function findStructureBom(state, programId, seatVariantId, moduleId) {
    return state.engineeringBoms.find(function (bom) {
      return bom.programId === programId && bom.seatVariantId === seatVariantId && bom.engineeringModuleId === moduleId;
    }) || null;
  }

  function findModuleByCode(state, code) {
    var normalized = app.domain.engineeringModuleService.normalizeCode(code);
    return state.engineeringModules.find(function (module) {
      return app.domain.engineeringModuleService.normalizeCode(module.code) === normalized;
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

  function trim(value) {
    return String(value == null ? "" : value).trim();
  }

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
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

  function notStructureOwned(objectType, id) {
    return new app.core.errors.BusinessOperationError("Object is not owned by Structure Engineering.", [
      { code: "STRUCTURE_OWNERSHIP_INVALID", message: "Structure workspace may only author Structure-owned engineering data.", objectType: objectType, objectId: id || null }
    ]);
  }

  app.domain.structureEngineeringService = {
    MODULE_CODE: MODULE_CODE,
    getStructureModule: getStructureModule,
    getStructureBomForContext: getStructureBomForContext,
    getActiveStructureBom: getActiveStructureBom,
    createStructurePart: createStructurePart,
    createStructureAssembly: createStructureAssembly,
    updateStructurePart: updateStructurePart,
    deleteStructurePart: deleteStructurePart,
    createStructureEngineeringBom: createStructureEngineeringBom,
    updateStructureEngineeringBom: updateStructureEngineeringBom,
    deleteStructureEngineeringBom: deleteStructureEngineeringBom,
    addStructureBomItem: addStructureBomItem,
    updateStructureBomItem: updateStructureBomItem,
    removeStructureBomItem: removeStructureBomItem,
    replaceStructureBomItems: replaceStructureBomItems,
    setStructureBomStatus: setStructureBomStatus,
    setStructureBomCompletionStatus: setStructureBomCompletionStatus,
    replaceStructureRowsForContext: replaceStructureRowsForContext
  };
})(typeof window !== "undefined" ? (window.DEP = window.DEP || {}) : (globalThis.DEP = globalThis.DEP || {}));
