(function (app) {
  app.domain = app.domain || {};

  var STATUS_VALUES = ["PLANNED", "ACTIVE", "ON_HOLD", "CLOSED"];

  function getPrograms() {
    return app.core.appState.getCollection("programs");
  }

  function getProgramById(id) {
    return app.core.appState.getById("programs", id);
  }

  function createProgram(input) {
    var program = normalizeProgram(input || {});
    return app.core.appState.transaction(function (state) {
      validateProgram(program, state.programs);
      state.programs.push(program);
      app.core.appState._recordAuditEvent(state, {
        objectType: "PROGRAM",
        objectId: program.id,
        action: "OBJECT_CREATED"
      });
    });
  }

  function updateProgram(id, patch) {
    return app.core.appState.transaction(function (state) {
      var index = findIndex(state.programs, id);
      if (index === -1) throw notFound("PROGRAM", id);
      if (patch && patch.id && patch.id !== id) throw immutableId("PROGRAM", id);
      var updated = normalizeProgram(Object.assign({}, state.programs[index], patch || {}, { id: id }));
      validateProgram(updated, state.programs, id);
      state.programs[index] = updated;
      app.core.appState._recordAuditEvent(state, {
        objectType: "PROGRAM",
        objectId: id,
        action: "OBJECT_UPDATED"
      });
    });
  }

  function deleteProgram(id) {
    return app.core.appState.transaction(function (state) {
      var index = findIndex(state.programs, id);
      if (index === -1) throw notFound("PROGRAM", id);
      var dependencies = getProgramDependencies(state, id);
      if (dependencies.length) {
        throw new app.core.errors.BusinessOperationError("Program cannot be deleted while dependent objects exist.", dependencies.map(function (dependency) {
          return {
            code: "PROGRAM_DELETE_BLOCKED",
            message: "Dependent " + dependency.collectionName + " record exists.",
            objectType: "PROGRAM",
            objectId: id
          };
        }));
      }
      state.programs.splice(index, 1);
      if (state.context.activeProgramId === id) {
        state.context.activeProgramId = null;
        state.context.activeSeatVariantId = null;
        state.context.activeFeatureConfigurationId = null;
      }
      app.core.appState._recordAuditEvent(state, {
        objectType: "PROGRAM",
        objectId: id,
        action: "OBJECT_REMOVED"
      });
    });
  }

  function setActiveProgram(id) {
    return app.core.contextService.setActiveProgram(id);
  }

  function validateProgram(program, programs, existingId) {
    var errors = [];
    if (!program.id) push(errors, "PROGRAM_ID_REQUIRED", "Program ID is required.", program.id);
    if (program.id && programs.some(function (item) { return item.id !== existingId && item.id === program.id; })) {
      push(errors, "PROGRAM_ID_DUPLICATE", "Program ID must be unique.", program.id);
    }
    if (!program.programCode) push(errors, "PROGRAM_CODE_REQUIRED", "Program Code is required.", program.id);
    if (!program.name) push(errors, "PROGRAM_NAME_REQUIRED", "Program Name is required.", program.id);
    if (STATUS_VALUES.indexOf(program.status) === -1) push(errors, "PROGRAM_STATUS_INVALID", "Program status is not controlled.", program.id);
    if (program.programCode && programs.some(function (item) {
      return item.id !== existingId && normalizeCode(item.programCode || item.programNumber) === normalizeCode(program.programCode);
    })) {
      push(errors, "PROGRAM_CODE_DUPLICATE", "Program Code must be unique.", program.id);
    }
    if (errors.length) throw new app.core.errors.BusinessOperationError("Program validation failed.", errors);
  }

  function normalizeProgram(input) {
    var programCode = trim(input.programCode || input.programNumber || input.code);
    var id = trim(input.id) || makeId("PGM", programCode);
    var status = normalizeStatus(input.status || input.lifecycleState || "PLANNED");
    return {
      id: id,
      programCode: programCode,
      programNumber: programCode,
      name: trim(input.name || input.programName),
      customer: trim(input.customer),
      vehiclePlatform: trim(input.vehiclePlatform || input.platform),
      status: status,
      lifecycleState: input.lifecycleState || statusToLifecycle(status),
      ownerRole: input.ownerRole || "PROGRAM_MANAGER"
    };
  }

  function getProgramDependencies(state, programId) {
    var dependencies = [];
    [
      "seatVariants",
      "featureConfigurations",
      "engineeringBoms",
      "engineeringProductStructures",
      "commercialAssessments",
      "commercialRecords",
      "engineeringChanges",
      "revisions"
    ].forEach(function (collectionName) {
      (state[collectionName] || []).forEach(function (item) {
        if (item.programId === programId) dependencies.push({ collectionName: collectionName, id: item.id });
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
    errors.push({ code: code, message: message, objectType: "PROGRAM", objectId: objectId || null });
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

  app.domain.programService = {
    getPrograms: getPrograms,
    getProgramById: getProgramById,
    createProgram: createProgram,
    updateProgram: updateProgram,
    deleteProgram: deleteProgram,
    setActiveProgram: setActiveProgram,
    normalizeProgram: normalizeProgram
  };
})(typeof window !== "undefined" ? (window.DEP = window.DEP || {}) : (globalThis.DEP = globalThis.DEP || {}));
