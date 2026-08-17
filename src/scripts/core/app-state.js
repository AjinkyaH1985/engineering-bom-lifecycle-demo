(function (app) {
  app.core = app.core || {};

  var state = null;
  var subscribers = [];
  var stateVersion = 0;

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function now() {
    return new Date().toISOString();
  }

  function initialise() {
    var loaded = app.core.storageService.load();
    state = clone(loaded.state);
    var normalized = normalizeLoadedStateShape(state);
    var validation = app.core.validationService.validateReferences(state);
    if (!validation.valid) {
      var fallback = app.core.storageService.restoreForConfiguredMode("INVALID_PERSISTED_REFERENCES", validation.errors);
      state = clone(fallback.state);
      if (fallback.startupMode !== app.core.storageService.STARTUP_MODES.CLEAN_MANUAL_TEST) {
        recordAuditEvent(state, {
          objectType: "STATE",
          objectId: "ROOT",
          action: "STATE_RESET",
          details: "Invalid persisted references were replaced according to the configured startup mode."
        });
        persist();
      }
    } else if (loaded.recovered) {
      if (loaded.startupMode !== app.core.storageService.STARTUP_MODES.CLEAN_MANUAL_TEST) {
        recordAuditEvent(state, {
          objectType: "STATE",
          objectId: "ROOT",
          action: "STATE_INITIALISED",
          details: loaded.recoveryReason
        });
        persist();
      } else if (normalized) {
        persist();
      }
    } else if (normalized) {
      persist();
    }
    stateVersion += 1;
    return getState();
  }

  function ensureInitialised() {
    if (!state) initialise();
  }

  function normalizeLoadedStateShape(targetState) {
    targetState.metadata = targetState.metadata || {};
    if (!Array.isArray(targetState.metadata.importHistory)) targetState.metadata.importHistory = [];
    targetState.metadata.visualAssets = targetState.metadata.visualAssets || {};
    if (targetState.metadata.environmentMode === "CLEAN_MANUAL_TEST") {
      targetState.metadata.visualAssets.completeSeatImageReference = "";
    }
    if (!Array.isArray(targetState.commercialAssessments)) {
      targetState.commercialAssessments = [];
    }
    var commodityMigrated = app.migrations && app.migrations.commodityMaster
      ? app.migrations.commodityMaster.migrateState(targetState)
      : false;
    normalizePartImageReferences(targetState);
    if (Array.isArray(targetState.engineeringChanges) && app.domain && app.domain.engineeringChangeService) {
      targetState.engineeringChanges = targetState.engineeringChanges.map(app.domain.engineeringChangeService.normalizeEngineeringChange);
    }
    if (Array.isArray(targetState.revisions) && app.domain && app.domain.revisionService) {
      targetState.revisions = targetState.revisions.map(app.domain.revisionService.normalizeRevision);
    }
    return commodityMigrated;
  }

  function normalizePartImageReferences(targetState) {
    var partsById = {};
    (targetState.parts || []).forEach(function (part) {
      if (!part.internalPartNumber) part.internalPartNumber = part.partNumber || "";
      if (part.oemPartNumber == null) part.oemPartNumber = "";
      if (!part.category) part.category = categoryForPart(part);
      if (!part.imageReference) part.imageReference = imageForPart(part.id, part.engineeringModuleId);
      partsById[part.id] = part;
    });
    (targetState.engineeringBoms || []).forEach(function (bom) {
      (bom.items || []).forEach(function (item) {
        if (item.oemJit == null) item.oemJit = "";
        if (item.internalJit == null) item.internalJit = partsById[item.childPartId] && partsById[item.childPartId].partType === "PART" ? "JIT" : "";
      });
    });
    (targetState.engineeringProductStructures || []).forEach(function (structure) {
      (structure.items || []).forEach(function (item) {
        var part = partsById[item.partId];
        if (part && item.sourcePartSnapshot && !item.sourcePartSnapshot.imageReference) {
          item.sourcePartSnapshot.imageReference = part.imageReference || "";
        }
        if (part && item.sourcePartSnapshot) normalizeSnapshotFields(item.sourcePartSnapshot, part);
      });
    });
    (targetState.commercialAssessments || []).forEach(function (assessment) {
      (assessment.lineItems || []).forEach(function (line) {
        var part = partsById[line.partId];
        if (part && line.sourcePartSnapshot && !line.sourcePartSnapshot.imageReference) {
          line.sourcePartSnapshot.imageReference = part.imageReference || "";
        }
        if (part && line.sourcePartSnapshot) normalizeSnapshotFields(line.sourcePartSnapshot, part);
      });
    });
    (targetState.revisions || []).forEach(function (revision) {
      (revision.partsSnapshot || []).forEach(function (part) {
        if (!part.imageReference) part.imageReference = imageForPart(part.id, part.engineeringModuleId);
      });
      var revisionPartsById = {};
      (revision.partsSnapshot || []).forEach(function (part) {
        revisionPartsById[part.id] = part;
      });
      var eps = revision.engineeringProductStructureSnapshot || {};
      (eps.items || []).forEach(function (item) {
        var part = revisionPartsById[item.partId] || partsById[item.partId];
        if (part && item.sourcePartSnapshot && !item.sourcePartSnapshot.imageReference) {
          item.sourcePartSnapshot.imageReference = part.imageReference || "";
        }
        if (part && item.sourcePartSnapshot) normalizeSnapshotFields(item.sourcePartSnapshot, part);
      });
      var assessment = revision.commercialAssessmentSnapshot || {};
      (assessment.lineItems || []).forEach(function (line) {
        var part = revisionPartsById[line.partId] || partsById[line.partId];
        if (part && line.sourcePartSnapshot && !line.sourcePartSnapshot.imageReference) {
          line.sourcePartSnapshot.imageReference = part.imageReference || "";
        }
        if (part && line.sourcePartSnapshot) normalizeSnapshotFields(line.sourcePartSnapshot, part);
      });
    });
  }

  function normalizeSnapshotFields(snapshot, part) {
    if (!snapshot.internalPartNumber) snapshot.internalPartNumber = part.internalPartNumber || part.partNumber || "";
    if (snapshot.oemPartNumber == null) snapshot.oemPartNumber = part.oemPartNumber || "";
    if (!snapshot.category) snapshot.category = part.category || categoryForPart(part);
  }

  function imageForPart(partId, moduleId) {
    var moduleImages = {
      "MOD-STRUCTURE": "assets/portfolio/structure.svg",
      "MOD-FOAM": "assets/portfolio/foam.svg",
      "MOD-PLASTIC": "assets/portfolio/plastic.svg",
      "MOD-TRIM": "assets/portfolio/trim.svg",
      "MOD-HEAD-REST": "assets/portfolio/headrest.svg",
      "MOD-ARM-REST": "assets/portfolio/armrest.svg"
    };
    return moduleImages[moduleId] || "";
  }
  function categoryForPart(part) {
    if (!part) return "";
    if (part.partType === "ASSEMBLY") return "Assembly";
    var commodity = String(part.commodity || "").toUpperCase();
    if (commodity === "METAL") return "Stamping";
    if (commodity === "FASTENER") return "Fastener";
    if (commodity === "FOAM") return "Foam";
    if (commodity === "PLASTIC") return "Plastic";
    if (commodity === "TRIM") return "Trim";
    if (commodity === "MECHANISM") return "Mechanism";
    return part.commodity || "Other";
  }

  function getState() {
    ensureInitialised();
    return clone(state);
  }

  function getContext() {
    ensureInitialised();
    return clone(state.context || {});
  }

  function getVersion() {
    ensureInitialised();
    return stateVersion;
  }

  function getCollection(collectionName) {
    ensureInitialised();
    app.core.validationService.validateCollectionName(collectionName);
    return clone(state[collectionName]);
  }

  function getById(collectionName, id) {
    ensureInitialised();
    app.core.validationService.validateCollectionName(collectionName);
    var item = (state[collectionName] || []).find(function (candidate) {
      return candidate.id === id;
    });
    return item ? clone(item) : null;
  }

  function add(collectionName, object, options) {
    app.core.validationService.validateCollectionName(collectionName);
    return transaction(function (workingState) {
      if ((workingState[collectionName] || []).some(function (item) { return item.id === object.id; })) {
        throw new app.core.errors.ValidationError("Object ID already exists.", [
          { code: "STATE_DUPLICATE_ID", message: "Object ID already exists in collection.", objectType: collectionName, objectId: object.id }
        ]);
      }
      workingState[collectionName].push(clone(object));
      if (!options || options.audit !== false) {
        recordAuditEvent(workingState, {
          objectType: collectionName,
          objectId: object.id,
          action: "OBJECT_CREATED"
        });
      }
    });
  }

  function update(collectionName, id, patch, options) {
    app.core.validationService.validateCollectionName(collectionName);
    return transaction(function (workingState) {
      var collection = workingState[collectionName];
      var index = collection.findIndex(function (item) {
        return item.id === id;
      });
      if (index === -1) {
        throw new app.core.errors.ValidationError("Object was not found.", [
          { code: "STATE_OBJECT_NOT_FOUND", message: "Object was not found in collection.", objectType: collectionName, objectId: id }
        ]);
      }
      app.core.permissionService.assertCanEdit(collectionName, collection[index], workingState.context);
      collection[index] = Object.assign({}, collection[index], clone(patch), { id: id });
      if (!options || options.audit !== false) {
        recordAuditEvent(workingState, {
          objectType: collectionName,
          objectId: id,
          action: "OBJECT_UPDATED"
        });
      }
    });
  }

  function remove(collectionName, id, options) {
    app.core.validationService.validateCollectionName(collectionName);
    return transaction(function (workingState) {
      var collection = workingState[collectionName];
      var object = collection.find(function (item) {
        return item.id === id;
      });
      if (!object) return;
      app.core.permissionService.assertCanEdit(collectionName, object, workingState.context);
      workingState[collectionName] = collection.filter(function (item) {
        return item.id !== id;
      });
      if (!options || options.audit !== false) {
        recordAuditEvent(workingState, {
          objectType: collectionName,
          objectId: id,
          action: "OBJECT_REMOVED"
        });
      }
    });
  }

  function replaceState(nextState, options) {
    var workingState = clone(nextState);
    var validation = app.core.validationService.validateReferences(workingState);
    if (!validation.valid) {
      throw new app.core.errors.BusinessOperationError("Replacement state failed reference validation.", validation.errors);
    }
    state = workingState;
    stateVersion += 1;
    if (!options || options.persist !== false) persist();
    notify();
    return getState();
  }

  function transaction(operation, options) {
    ensureInitialised();
    var workingState = clone(state);
    try {
      operation(workingState);
      touch(workingState);
      var validation = app.core.validationService.validateReferences(workingState);
      if (!validation.valid) {
        throw new app.core.errors.BusinessOperationError("The operation would create invalid application state.", validation.errors);
      }
      if (!options || options.persist !== false) {
        app.core.storageService.save(workingState);
      }
      state = workingState;
      stateVersion += 1;
      notify();
      return getState();
    } catch (error) {
      throw error;
    }
  }

  function resetToSeed() {
    state = app.core.storageService.restoreSeed();
    stateVersion += 1;
    recordAuditEvent(state, {
      objectType: "STATE",
      objectId: "ROOT",
      action: "STATE_RESET"
    });
    persist();
    notify();
    return getState();
  }

  function subscribe(handler) {
    subscribers.push(handler);
    return function () {
      subscribers = subscribers.filter(function (subscriber) {
        return subscriber !== handler;
      });
    };
  }

  function notify() {
    if (!subscribers.length) return;
    var snapshot = getState();
    subscribers.forEach(function (handler) {
      handler(snapshot);
    });
  }

  function persist() {
    touch(state);
    app.core.storageService.save(state);
  }

  function touch(targetState) {
    targetState.metadata.lastUpdated = now();
    if (!targetState.metadata.createdAt) {
      targetState.metadata.createdAt = targetState.metadata.lastUpdated;
    }
  }

  function recordAuditEvent(targetState, event) {
    targetState.auditEvents.push(Object.assign({
      id: "AUD-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 7),
      performedBy: targetState.context.activeRole,
      performedAt: now()
    }, event));
  }

  app.core.appState = {
    initialise: initialise,
    initialize: initialise,
    getState: getState,
    getContext: getContext,
    getVersion: getVersion,
    getCollection: getCollection,
    getById: getById,
    add: add,
    update: update,
    remove: remove,
    replaceState: replaceState,
    transaction: transaction,
    resetToSeed: resetToSeed,
    subscribe: subscribe,
    _recordAuditEvent: recordAuditEvent
  };
})(typeof window !== "undefined" ? (window.DEP = window.DEP || {}) : (globalThis.DEP = globalThis.DEP || {}));
