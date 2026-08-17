(function (app) {
  app.domain = app.domain || {};

  var STATUS_VALUES = ["PLANNED", "ACTIVE", "ON_HOLD", "CLOSED"];

  function getSeatVariants(programId) {
    return app.core.appState.getCollection("seatVariants").filter(function (variant) {
      return !programId || variant.programId === programId;
    });
  }

  function getSeatVariantById(id) {
    return app.core.appState.getById("seatVariants", id);
  }

  function createSeatVariant(input) {
    var variant = normalizeSeatVariant(input || {});
    return app.core.appState.transaction(function (state) {
      validateSeatVariant(variant, state.seatVariants, state.programs);
      state.seatVariants.push(variant);
      app.core.appState._recordAuditEvent(state, {
        objectType: "SEAT_VARIANT",
        objectId: variant.id,
        action: "OBJECT_CREATED"
      });
    });
  }

  function updateSeatVariant(id, patch) {
    return app.core.appState.transaction(function (state) {
      var index = findIndex(state.seatVariants, id);
      if (index === -1) throw notFound("SEAT_VARIANT", id);
      if (patch && patch.id && patch.id !== id) throw immutableId("SEAT_VARIANT", id);
      if (patch && patch.programId && patch.programId !== state.seatVariants[index].programId) {
        throw new app.core.errors.BusinessOperationError("Seat Variant Program cannot be changed.", [
          { code: "SEAT_VARIANT_PROGRAM_IMMUTABLE", message: "A Seat Variant belongs to exactly one Program.", objectType: "SEAT_VARIANT", objectId: id }
        ]);
      }
      var updated = normalizeSeatVariant(Object.assign({}, state.seatVariants[index], patch || {}, { id: id }));
      validateSeatVariant(updated, state.seatVariants, state.programs, id);
      state.seatVariants[index] = updated;
      app.core.appState._recordAuditEvent(state, {
        objectType: "SEAT_VARIANT",
        objectId: id,
        action: "OBJECT_UPDATED"
      });
    });
  }

  function deleteSeatVariant(id) {
    return app.core.appState.transaction(function (state) {
      var index = findIndex(state.seatVariants, id);
      if (index === -1) throw notFound("SEAT_VARIANT", id);
      var dependencies = getSeatVariantDependencies(state, id);
      if (dependencies.length) {
        throw new app.core.errors.BusinessOperationError("Seat Variant cannot be deleted while dependent objects exist.", dependencies.map(function (dependency) {
          return {
            code: "SEAT_VARIANT_DELETE_BLOCKED",
            message: "Dependent " + dependency.collectionName + " record exists.",
            objectType: "SEAT_VARIANT",
            objectId: id
          };
        }));
      }
      state.seatVariants.splice(index, 1);
      if (state.context.activeSeatVariantId === id) {
        state.context.activeSeatVariantId = null;
        state.context.activeFeatureConfigurationId = null;
      }
      app.core.appState._recordAuditEvent(state, {
        objectType: "SEAT_VARIANT",
        objectId: id,
        action: "OBJECT_REMOVED"
      });
    });
  }

  function setActiveSeatVariant(id) {
    return app.core.contextService.setActiveSeatVariant(id);
  }

  function validateSeatVariant(variant, variants, programs, existingId) {
    var errors = [];
    if (!variant.id) push(errors, "SEAT_VARIANT_ID_REQUIRED", "Seat Variant ID is required.", variant.id);
    if (variant.id && variants.some(function (item) { return item.id !== existingId && item.id === variant.id; })) {
      push(errors, "SEAT_VARIANT_ID_DUPLICATE", "Seat Variant ID must be unique.", variant.id);
    }
    if (!variant.programId) push(errors, "SEAT_VARIANT_PROGRAM_REQUIRED", "Seat Variant must belong to one Program.", variant.id);
    if (variant.programId && !programs.some(function (program) { return program.id === variant.programId; })) {
      push(errors, "SEAT_VARIANT_PROGRAM_MISSING", "Seat Variant cannot reference an unknown Program.", variant.id);
    }
    if (!variant.variantCode) push(errors, "SEAT_VARIANT_CODE_REQUIRED", "Variant Code is required.", variant.id);
    if (!variant.variantName) push(errors, "SEAT_VARIANT_NAME_REQUIRED", "Variant Name is required.", variant.id);
    if (STATUS_VALUES.indexOf(variant.status) === -1) push(errors, "SEAT_VARIANT_STATUS_INVALID", "Seat Variant status is not controlled.", variant.id);
    if (variant.programId && variant.variantCode && variants.some(function (item) {
      return item.id !== existingId &&
        item.programId === variant.programId &&
        normalizeCode(item.variantCode) === normalizeCode(variant.variantCode);
    })) {
      push(errors, "SEAT_VARIANT_CODE_DUPLICATE", "Variant Code must be unique within its Program.", variant.id);
    }
    if (errors.length) throw new app.core.errors.BusinessOperationError("Seat Variant validation failed.", errors);
  }

  function normalizeSeatVariant(input) {
    var variantCode = trim(input.variantCode || input.code);
    var id = trim(input.id) || makeId("VAR", (input.programId || "") + "-" + variantCode);
    var status = normalizeStatus(input.status || input.lifecycleState || "PLANNED");
    return {
      id: id,
      programId: trim(input.programId),
      variantCode: variantCode,
      variantName: trim(input.variantName || input.name),
      seatFamily: trim(input.seatFamily),
      seatType: trim(input.seatType || input.seatFamily),
      brand: trim(input.brand),
      customer: trim(input.customer || input.brand),
      side: trim(input.side),
      grade: trim(input.grade),
      finishedGoodPartNumber: trim(input.finishedGoodPartNumber || input.fgPartNumber),
      oemFinishedGoodPartNumber: trim(input.oemFinishedGoodPartNumber || input.oemPartNumber),
      completeSeatImageReference: trim(input.completeSeatImageReference),
      sourceWorkbookImageAnchor: trim(input.sourceWorkbookImageAnchor),
      sourceImageMediaPath: trim(input.sourceImageMediaPath),
      sourceImageMimeType: trim(input.sourceImageMimeType),
      market: trim(input.market),
      status: status,
      lifecycleState: input.lifecycleState || statusToLifecycle(status)
    };
  }

  function getSeatVariantDependencies(state, seatVariantId) {
    var dependencies = [];
    [
      "featureConfigurations",
      "engineeringBoms",
      "engineeringProductStructures",
      "commercialAssessments",
      "commercialRecords",
      "engineeringChanges",
      "revisions"
    ].forEach(function (collectionName) {
      (state[collectionName] || []).forEach(function (item) {
        if (item.seatVariantId === seatVariantId) dependencies.push({ collectionName: collectionName, id: item.id });
      });
    });
    return dependencies;
  }

  function normalizeStatus(status) {
    var value = normalizeCode(status || "PLANNED");
    if (value === "IN_WORK") return "ACTIVE";
    if (value === "ACTIVE" || value === "PLANNED" || value === "ON_HOLD" || value === "CLOSED") return value;
    return "PLANNED";
  }

  function statusToLifecycle(status) {
    return status === "ACTIVE" ? "IN_WORK" : status;
  }

  function makeId(prefix, code) {
    return prefix + "-" + normalizeCode(code || Date.now().toString(36)).replace(/[^A-Z0-9]+/g, "-").replace(/^-|-$/g, "");
  }

  function trim(value) {
    return String(value == null ? "" : value).trim();
  }

  function normalizeCode(value) {
    return trim(value).toUpperCase().replace(/\s+/g, "_");
  }

  function findIndex(collection, id) {
    return collection.findIndex(function (item) {
      return item.id === id;
    });
  }

  function push(errors, code, message, objectId) {
    errors.push({ code: code, message: message, objectType: "SEAT_VARIANT", objectId: objectId || null });
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

  app.domain.seatVariantService = {
    getSeatVariants: getSeatVariants,
    getSeatVariantById: getSeatVariantById,
    createSeatVariant: createSeatVariant,
    updateSeatVariant: updateSeatVariant,
    deleteSeatVariant: deleteSeatVariant,
    setActiveSeatVariant: setActiveSeatVariant,
    normalizeSeatVariant: normalizeSeatVariant
  };
})(typeof window !== "undefined" ? (window.DEP = window.DEP || {}) : (globalThis.DEP = globalThis.DEP || {}));
