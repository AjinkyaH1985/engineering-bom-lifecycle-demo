(function (app) {
  app.domain = app.domain || {};

  function listPartsByModule(engineeringModuleId) {
    return app.core.appState.getCollection("parts").filter(function (part) {
      return part.engineeringModuleId === engineeringModuleId;
    });
  }

  function listAssembliesByModule(engineeringModuleId) {
    return listPartsByModule(engineeringModuleId).filter(function (part) {
      return part.partType === "ASSEMBLY";
    });
  }

  function getPartById(id) {
    return app.core.appState.getById("parts", id);
  }

  function getPartByNumber(partNumber) {
    var normalized = normalizePartNumber(partNumber);
    return app.core.appState.getCollection("parts").find(function (part) {
      return normalizePartNumber(part.partNumber) === normalized;
    }) || null;
  }

  function createPart(input) {
    var part = normalizePart(input || {});
    return app.core.appState.transaction(function (state) {
      validatePart(part, state.parts, state.engineeringModules);
      state.parts.push(part);
      app.core.appState._recordAuditEvent(state, {
        objectType: "PART",
        objectId: part.id,
        action: "OBJECT_CREATED"
      });
    });
  }

  function updatePart(id, patch, options) {
    return app.core.appState.transaction(function (state) {
      var index = findIndex(state.parts, id);
      if (index === -1) throw notFound("PART", id);
      if (patch && patch.id && patch.id !== id) throw immutableId("PART", id);
      app.core.permissionService.assertCanEdit("parts", state.parts[index], operationContext(state, options));
      if (patch && patch.engineeringModuleId && patch.engineeringModuleId !== state.parts[index].engineeringModuleId) {
        throw new app.core.errors.BusinessOperationError("Part Engineering Module cannot be changed.", [
          { code: "PART_MODULE_IMMUTABLE", message: "A Part belongs to one Engineering Module.", objectType: "PART", objectId: id }
        ]);
      }
      var updated = normalizePart(Object.assign({}, state.parts[index], patch || {}, { id: id }));
      validatePart(updated, state.parts, state.engineeringModules, id);
      state.parts[index] = updated;
      app.core.appState._recordAuditEvent(state, {
        objectType: "PART",
        objectId: id,
        action: "OBJECT_UPDATED"
      });
      if (app.domain.engineeringChangeImpactService && options && (options.engineeringChangeId || options.changeId)) {
        app.domain.engineeringChangeImpactService._markAffectedObjectModifiedInState(
          state,
          options.engineeringChangeId || options.changeId,
          "PART",
          id,
          Object.keys(patch || {})
        );
      }
    });
  }

  function deletePart(id, options) {
    return app.core.appState.transaction(function (state) {
      var index = findIndex(state.parts, id);
      if (index === -1) throw notFound("PART", id);
      app.core.permissionService.assertCanEdit("parts", state.parts[index], operationContext(state, options));
      var dependencies = getPartDependencies(state, id);
      if (dependencies.length) {
        throw new app.core.errors.BusinessOperationError("Part cannot be deleted while referenced.", dependencies.map(function (dependency) {
          return {
            code: "PART_DELETE_BLOCKED",
            message: "Dependent " + dependency.collectionName + " record exists.",
            objectType: "PART",
            objectId: id
          };
        }));
      }
      state.parts.splice(index, 1);
      app.core.appState._recordAuditEvent(state, {
        objectType: "PART",
        objectId: id,
        action: "OBJECT_REMOVED"
      });
    });
  }

  function normalizePart(input) {
    var partNumber = trim(input.partNumber || input.number);
    var id = trim(input.id) || makeId("PART", partNumber);
    var partType = normalizePartType(input.partType || input.type);
    var name = trim(input.name || input.partName || input.description);
    var description = trim(input.description || input.name || input.partName);
    return {
      id: id,
      partNumber: partNumber,
      internalPartNumber: trim(input.internalPartNumber || input.partNumber || input.number),
      oemPartNumber: trim(input.oemPartNumber || input.customerPartNumber),
      name: name,
      description: description,
      category: trim(input.category),
      partType: partType,
      engineeringModuleId: trim(input.engineeringModuleId),
      allowedBomModuleIds: uniqueStrings(input.allowedBomModuleIds || (input.engineeringModuleId ? [input.engineeringModuleId] : [])),
      material: trim(input.material),
      commodity: trim(input.commodity),
      gauge: trim(input.gauge || input.gaugeMm),
      imageReference: trim(input.imageReference || input.image || input.images),
      sourceImagePresent: Boolean(input.sourceImagePresent),
      sourceWorkbookImageAnchor: trim(input.sourceWorkbookImageAnchor),
      sourceWorkbookImageAnchors: uniqueStrings(input.sourceWorkbookImageAnchors || (input.sourceWorkbookImageAnchor ? [input.sourceWorkbookImageAnchor] : [])),
      sourceWorkbookImageRow: input.sourceWorkbookImageRow == null ? null : Number(input.sourceWorkbookImageRow),
      sourceWorkbookImageColumn: input.sourceWorkbookImageColumn == null ? null : Number(input.sourceWorkbookImageColumn),
      sourceImageMediaPath: trim(input.sourceImageMediaPath),
      sourceImageMimeType: trim(input.sourceImageMimeType),
      drawingNumber: trim(input.drawingNumber || input.drawingReference),
      drawingRevision: trim(input.drawingRevision || input.dwgRevision || input.dwgRev),
      cadWeight: toNumberOrNull(input.cadWeight !== undefined ? input.cadWeight : input.mass),
      threeDSharedDate: trim(input.threeDSharedDate || input["3dSharedDate"] || input.threeDReleasedDate),
      twoDSharedDate: trim(input.twoDSharedDate || input["2dSharedDate"] || input.twoDReleasedDate),
      mass: toNumberOrNull(input.mass),
      weight: trim(input.weight || formatMass(input.mass)),
      unitOfMeasure: trim(input.unitOfMeasure || "EA"),
      lifecycleState: normalizeLifecycle(input.lifecycleState || input.status || "DRAFT"),
      currentRevision: trim(input.currentRevision || input.revision || "A.01"),
      technicalAttributes: cloneObject(input.technicalAttributes || input.sourceTechnicalAttributes),
      sourceWorkbookFingerprint: trim(input.sourceWorkbookFingerprint),
      sourceWorkbookSheets: uniqueStrings(input.sourceWorkbookSheets || (input.sourceWorkbookSheet ? [input.sourceWorkbookSheet] : [])),
      sourceWorkbookRows: cloneArray(input.sourceWorkbookRows || (input.sourceWorkbookRow ? [{ sheet: input.sourceWorkbookSheet || "", row: input.sourceWorkbookRow }] : [])),
      sourceAttributeVariants: cloneArray(input.sourceAttributeVariants),
      sourceCommodityOriginal: trim(input.sourceCommodityOriginal),
      synthetic: Boolean(input.synthetic)
    };
  }

  function validatePart(part, parts, modules, existingId) {
    var errors = [];
    if (!part.id) push(errors, "PART_ID_REQUIRED", "Part ID is required.", part.id);
    if (part.id && parts.some(function (item) { return item.id !== existingId && item.id === part.id; })) {
      push(errors, "PART_ID_DUPLICATE", "Part ID must be unique.", part.id);
    }
    if (!part.partNumber) push(errors, "PART_NUMBER_REQUIRED", "Part Number is required.", part.id);
    if (!part.name) push(errors, "PART_NAME_REQUIRED", "Part Name is required.", part.id);
    if (!part.engineeringModuleId) push(errors, "PART_MODULE_REQUIRED", "Engineering Module reference is required.", part.id);
    if (part.engineeringModuleId && !findById(modules, part.engineeringModuleId)) {
      push(errors, "PART_MODULE_MISSING", "Part cannot reference an unknown Engineering Module.", part.id);
    }
    if (["PART", "ASSEMBLY"].indexOf(part.partType) === -1) {
      push(errors, "PART_TYPE_INVALID", "Part Type must be PART or ASSEMBLY.", part.id);
    }
    if ((app.data.referenceData.lifecycleStates || []).indexOf(part.lifecycleState) === -1) {
      push(errors, "PART_LIFECYCLE_INVALID", "Part lifecycle status is not controlled.", part.id);
    }
    if (part.unitOfMeasure && (app.data.referenceData.unitsOfMeasure || []).indexOf(part.unitOfMeasure) === -1) {
      push(errors, "PART_UNIT_INVALID", "Part unit of measure is not controlled.", part.id);
    }
    if (part.partNumber && parts.some(function (item) {
      return item.id !== existingId && normalizePartNumber(item.partNumber) === normalizePartNumber(part.partNumber);
    })) {
      push(errors, "PART_NUMBER_DUPLICATE", "Part Number must be unique.", part.id);
    }
    if (errors.length) throw new app.core.errors.BusinessOperationError("Part validation failed.", errors);
  }

  function getPartDependencies(state, partId) {
    var dependencies = [];
    (state.engineeringBoms || []).forEach(function (bom) {
      if (bom.rootPartId === partId) dependencies.push({ collectionName: "engineeringBoms", id: bom.id });
      (bom.items || []).forEach(function (item) {
        if (item.parentPartId === partId || item.childPartId === partId) {
          dependencies.push({ collectionName: "engineeringBoms", id: bom.id });
        }
      });
    });
    (state.commercialRecords || []).forEach(function (record) {
      if (record.partId === partId) dependencies.push({ collectionName: "commercialRecords", id: record.id });
    });
    return dependencies;
  }

  function normalizePartType(value) {
    var normalized = normalizeCode(value || "PART");
    if (normalized === "ASSEMBLY") return "ASSEMBLY";
    return "PART";
  }

  function normalizeLifecycle(value) {
    var normalized = normalizeCode(value || "DRAFT");
    if (normalized === "IN_WORK" || normalized === "INWORK") return "IN_WORK";
    if (normalized === "PLANNED") return "DRAFT";
    if (normalized === "RELEASED") return "RELEASED";
    if ((app.data.referenceData.lifecycleStates || []).indexOf(normalized) !== -1) return normalized;
    return "DRAFT";
  }

  function normalizePartNumber(value) {
    return trim(value).toUpperCase();
  }

  function normalizeCode(value) {
    return trim(value).toUpperCase().replace(/[\s-]+/g, "_");
  }

  function trim(value) {
    return String(value == null ? "" : value).trim();
  }

  function toNumberOrNull(value) {
    if (value === "" || value === null || value === undefined) return null;
    var number = Number(String(value).replace(/[^\d.-]/g, ""));
    return isNaN(number) ? null : number;
  }

  function formatMass(value) {
    var mass = toNumberOrNull(value);
    return mass === null ? "" : mass + " kg";
  }

  function cloneObject(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) return {};
    return JSON.parse(JSON.stringify(value));
  }

  function cloneArray(value) {
    return Array.isArray(value) ? JSON.parse(JSON.stringify(value)) : [];
  }

  function uniqueStrings(values) {
    var seen = {};
    return (values || []).map(trim).filter(function (value) {
      if (!value || seen[value]) return false;
      seen[value] = true;
      return true;
    });
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

  function push(errors, code, message, objectId) {
    errors.push({ code: code, message: message, objectType: "PART", objectId: objectId || null });
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

  function immutableId(objectType, id) {
    return new app.core.errors.BusinessOperationError(objectType + " ID cannot be changed.", [
      { code: objectType + "_ID_IMMUTABLE", message: objectType + " ID is stable and immutable.", objectType: objectType, objectId: id }
    ]);
  }

  app.domain.partService = {
    createPart: createPart,
    updatePart: updatePart,
    deletePart: deletePart,
    getPartById: getPartById,
    getPartByNumber: getPartByNumber,
    listPartsByModule: listPartsByModule,
    listAssembliesByModule: listAssembliesByModule,
    normalizePart: normalizePart,
    validatePart: validatePart,
    normalizeLifecycle: normalizeLifecycle
  };
})(typeof window !== "undefined" ? (window.DEP = window.DEP || {}) : (globalThis.DEP = globalThis.DEP || {}));
