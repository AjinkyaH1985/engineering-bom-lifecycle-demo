(function (app) {
  app.domain = app.domain || {};

  var STATUSES = ["DRAFT", "SUBMITTED", "APPROVED", "IMPLEMENTING", "IMPLEMENTED", "REJECTED", "CANCELLED"];
  var TERMINAL_STATUSES = ["IMPLEMENTED", "REJECTED", "CANCELLED"];
  var VALID_TRANSITIONS = {
    DRAFT: ["SUBMITTED", "CANCELLED"],
    SUBMITTED: ["APPROVED", "REJECTED", "CANCELLED"],
    APPROVED: ["IMPLEMENTING", "CANCELLED"],
    IMPLEMENTING: ["IMPLEMENTED"],
    IMPLEMENTED: [],
    REJECTED: [],
    CANCELLED: []
  };
  var AFFECTED_TYPES = [
    "PART",
    "ENGINEERING_BOM",
    "ENGINEERING_BOM_ITEM",
    "ENGINEERING_PRODUCT_STRUCTURE",
    "ENGINEERING_PRODUCT_STRUCTURE_ITEM",
    "COMMERCIAL_ASSESSMENT",
    "COMMERCIAL_LINE"
  ];

  function listEngineeringChanges(criteria) {
    criteria = criteria || {};
    return app.core.appState.getCollection("engineeringChanges").map(normalizeEngineeringChange).filter(function (change) {
      return (!criteria.programId || change.programId === criteria.programId) &&
        (!criteria.seatVariantId || change.seatVariantId === criteria.seatVariantId);
    });
  }

  function getEngineeringChange(idOrNumber) {
    var value = trim(idOrNumber);
    return listEngineeringChanges().find(function (change) {
      return change.id === value || change.changeNumber === value || change.ecnNumber === value;
    }) || null;
  }

  function createEngineeringChange(input) {
    var change = normalizeEngineeringChange(input || {});
    change.status = "DRAFT";
    return app.core.appState.transaction(function (state) {
      if (app.domain.engineeringChangeImpactService) {
        change.affectedObjects = (change.affectedObjects || []).map(function (affected) {
          return app.domain.engineeringChangeImpactService._enrichAffectedObjectInState(state, affected);
        });
      }
      validateChange(change, state, null);
      state.engineeringChanges.push(change);
      if (change.impactTrackingEnabled && app.domain.engineeringChangeImpactService) {
        app.domain.engineeringChangeImpactService._recalculateInState(state, change, { audit: false });
      }
      audit(state, change.id, "ENGINEERING_CHANGE_CREATED", { changeNumber: change.changeNumber });
    });
  }

  function updateEngineeringChange(id, patch) {
    return app.core.appState.transaction(function (state) {
      var index = findIndex(state.engineeringChanges, id);
      if (index === -1) throw notFound("ENGINEERING_CHANGE", id);
      var current = normalizeEngineeringChange(state.engineeringChanges[index]);
      if (patch && patch.id && patch.id !== id) throw immutableId("ENGINEERING_CHANGE", id);
      assertChangeEditable(current, "update");
      var updated = normalizeEngineeringChange(Object.assign({}, current, patch || {}, {
        id: id,
        status: current.status,
        createdAt: current.createdAt,
        updatedAt: now(),
        updatedBy: (state.context && state.context.activeRole) || current.updatedBy || current.owner || ""
      }));
      validateChange(updated, state, id);
      state.engineeringChanges[index] = updated;
      audit(state, id, "ENGINEERING_CHANGE_UPDATED");
    });
  }

  function deleteDraftEngineeringChange(id) {
    return app.core.appState.transaction(function (state) {
      var index = findIndex(state.engineeringChanges, id);
      if (index === -1) throw notFound("ENGINEERING_CHANGE", id);
      var change = normalizeEngineeringChange(state.engineeringChanges[index]);
      if (change.status !== "DRAFT") {
        throw businessError("ENGINEERING_CHANGE_DELETE_BLOCKED", "Only Draft Engineering Changes can be deleted.", "ENGINEERING_CHANGE", id);
      }
      state.engineeringChanges.splice(index, 1);
      audit(state, id, "ENGINEERING_CHANGE_DELETED");
    });
  }

  function submitEngineeringChange(id) {
    return transition(id, "SUBMITTED", {});
  }

  function approveEngineeringChange(id, comment) {
    return transition(id, "APPROVED", { approvedAt: now(), comment: comment });
  }

  function rejectEngineeringChange(id, comment) {
    return transition(id, "REJECTED", { comment: comment });
  }

  function cancelEngineeringChange(id, comment) {
    return transition(id, "CANCELLED", { comment: comment });
  }

  function startImplementation(id) {
    return transition(id, "IMPLEMENTING", {});
  }

  function completeImplementation(id, comment) {
    return transition(id, "IMPLEMENTED", { implementedAt: now(), comment: comment });
  }

  function transition(id, targetStatus, options) {
    targetStatus = normalizeStatus(targetStatus);
    options = options || {};
    return app.core.appState.transaction(function (state) {
      var index = findIndex(state.engineeringChanges, id);
      if (index === -1) throw notFound("ENGINEERING_CHANGE", id);
      var change = normalizeEngineeringChange(state.engineeringChanges[index]);
      validateTransition(change.status, targetStatus);
      if (targetStatus === "SUBMITTED" && !(change.affectedObjects || []).length) {
        throw businessError("ENGINEERING_CHANGE_AFFECTED_OBJECT_REQUIRED", "Engineering Change must reference at least one affected object before submit.", "ENGINEERING_CHANGE", id);
      }
      if (targetStatus === "IMPLEMENTED") {
        validateImplementationReadiness(state, change);
      }
      if (targetStatus === "IMPLEMENTING" && change.impactTrackingEnabled && app.domain.engineeringChangeImpactService) {
        app.domain.engineeringChangeImpactService._captureImplementationBaselineInState(state, change);
      }
      change.status = targetStatus;
      change.updatedAt = now();
      change.updatedBy = (state.context && state.context.activeRole) || change.updatedBy || change.owner || "";
      if (options.approvedAt) change.approvedAt = options.approvedAt;
      if (options.implementedAt) change.implementedAt = options.implementedAt;
      if (options.comment) {
        change.comments = change.comments.concat(normalizeComment(options.comment, state.context.activeRole));
      }
      validateChange(change, state, id);
      state.engineeringChanges[index] = change;
      if (change.impactTrackingEnabled && app.domain.engineeringChangeImpactService) {
        app.domain.engineeringChangeImpactService._recalculateInState(state, change, { audit: false });
      }
      audit(state, id, "ENGINEERING_CHANGE_" + targetStatus, { fromStatus: currentStatusForAudit(change, targetStatus), toStatus: targetStatus });
    });
  }

  function addAffectedObject(id, affectedObject) {
    return app.core.appState.transaction(function (state) {
      var change = requireChangeForDraftEdit(state, id);
      var affected = normalizeAffectedObject(affectedObject || {});
      if (app.domain.engineeringChangeImpactService) {
        affected = app.domain.engineeringChangeImpactService._enrichAffectedObjectInState(state, affected);
      }
      change.affectedObjects = (change.affectedObjects || []).concat(affected);
      change.impactTrackingEnabled = true;
      change.updatedAt = now();
      change.updatedBy = (state.context && state.context.activeRole) || change.updatedBy || change.owner || "";
      validateChange(change, state, id);
      if (app.domain.engineeringChangeImpactService) {
        app.domain.engineeringChangeImpactService._recalculateInState(state, change, { audit: false });
      }
      audit(state, id, "ENGINEERING_CHANGE_AFFECTED_OBJECT_ADDED", {
        objectType: affected.objectType,
        objectId: affected.objectId,
        commodity: affected.commodity || ""
      });
    });
  }

  function removeAffectedObject(id, objectType, objectId) {
    objectType = normalizeObjectType(objectType);
    objectId = trim(objectId);
    return app.core.appState.transaction(function (state) {
      var change = requireChangeForDraftEdit(state, id);
      change.affectedObjects = (change.affectedObjects || []).filter(function (affected) {
        return !(normalizeObjectType(affected.objectType) === objectType && affected.objectId === objectId);
      });
      change.impactTrackingEnabled = true;
      change.updatedAt = now();
      change.updatedBy = (state.context && state.context.activeRole) || change.updatedBy || change.owner || "";
      validateChange(change, state, id);
      if (app.domain.engineeringChangeImpactService) {
        app.domain.engineeringChangeImpactService._recalculateInState(state, change, { audit: false });
      }
      audit(state, id, "ENGINEERING_CHANGE_AFFECTED_OBJECT_REMOVED", { objectType: objectType, objectId: objectId });
    });
  }

  function addComment(id, text) {
    return app.core.appState.transaction(function (state) {
      var index = findIndex(state.engineeringChanges, id);
      if (index === -1) throw notFound("ENGINEERING_CHANGE", id);
      var change = normalizeEngineeringChange(state.engineeringChanges[index]);
      if (TERMINAL_STATUSES.indexOf(change.status) !== -1) {
        throw businessError("ENGINEERING_CHANGE_IMMUTABLE", "Terminal Engineering Changes are immutable.", "ENGINEERING_CHANGE", id);
      }
      change.comments = change.comments.concat(normalizeComment(text, state.context.activeRole));
      change.updatedAt = now();
      change.updatedBy = (state.context && state.context.activeRole) || change.updatedBy || change.owner || "";
      state.engineeringChanges[index] = change;
      audit(state, id, "ENGINEERING_CHANGE_COMMENT_ADDED");
    });
  }

  function validateTransition(currentStatus, targetStatus) {
    currentStatus = normalizeStatus(currentStatus);
    targetStatus = normalizeStatus(targetStatus);
    if ((VALID_TRANSITIONS[currentStatus] || []).indexOf(targetStatus) === -1) {
      throw businessError("ENGINEERING_CHANGE_TRANSITION_INVALID", "Engineering Change transition is not allowed.", "ENGINEERING_CHANGE", currentStatus + ">" + targetStatus);
    }
    return true;
  }

  function canModifyReleasedObject(objectType, objectId, options) {
    options = options || {};
    var state = options.state || app.core.appState.getState();
    var changeId = options.engineeringChangeId || options.changeId || options.activeEngineeringChangeId;
    if (!changeId) return false;
    var change = findChange(state, changeId);
    if (!change) return false;
    change = normalizeEngineeringChange(change);
    if (["APPROVED", "IMPLEMENTING"].indexOf(change.status) === -1) return false;
    return (change.affectedObjects || []).some(function (affected) {
      return normalizeObjectType(affected.objectType) === normalizeObjectType(objectType) && affected.objectId === objectId;
    });
  }

  function validateImplementationReadiness(state, change) {
    if (change.impactTrackingEnabled && app.domain.engineeringChangeImpactService) {
      app.domain.engineeringChangeImpactService._recalculateInState(state, change, { audit: false });
      var readiness = app.domain.engineeringChangeImpactService._buildReadinessInState(state, change, change.commodityImpact || []);
      change.implementationReadiness = readiness;
      if (!readiness.ready) {
        audit(state, change.id, "ECN_IMPLEMENTATION_BLOCKED", {
          blockingErrors: readiness.blockingErrors
        });
        throw new app.core.errors.BusinessOperationError("Engineering Change implementation is not ready.", readiness.blockingErrors);
      }
      return readiness;
    }
    var structure = (state.engineeringProductStructures || []).find(function (item) {
      return item.programId === change.programId && item.seatVariantId === change.seatVariantId;
    });
    var assessment = (state.commercialAssessments || []).find(function (item) {
      return item.programId === change.programId && item.seatVariantId === change.seatVariantId;
    });
    var errors = [];
    if (!structure) {
      push(errors, "ENGINEERING_CHANGE_EPS_REQUIRED", "Complete Seat JIT must be generated before implementation is completed.", change.id);
    } else if (structure.generationStatus !== "CURRENT") {
      push(errors, "ENGINEERING_CHANGE_EPS_NOT_CURRENT", "Complete Seat JIT must be CURRENT before implementation is completed.", change.id);
    }
    if (!assessment) {
      push(errors, "ENGINEERING_CHANGE_COMMERCIAL_REQUIRED", "Commercial Assessment must be generated before implementation is completed.", change.id);
    } else if (assessment.generationStatus !== "CURRENT") {
      push(errors, "ENGINEERING_CHANGE_COMMERCIAL_NOT_CURRENT", "Commercial Assessment must be CURRENT before implementation is completed.", change.id);
    }
    if (errors.length) {
      throw new app.core.errors.BusinessOperationError("Engineering Change implementation cannot be completed until downstream data is current.", errors);
    }
  }

  function normalizeEngineeringChange(input) {
    var context = app.core && app.core.contextService ? app.core.contextService.getContext() : {};
    var changeNumber = trim(input.changeNumber || input.ecnNumber);
    var id = trim(input.id) || makeId("EC", changeNumber || Date.now().toString(36));
    var createdAt = trim(input.createdAt || input.createdDate) || now();
    return {
      id: id,
      changeNumber: changeNumber,
      ecnNumber: changeNumber,
      title: trim(input.title),
      description: trim(input.description),
      reason: trim(input.reason),
      priority: normalizePriority(input.priority),
      type: normalizeType(input.type),
      status: normalizeStatus(input.status || "DRAFT"),
      programId: trim(input.programId || context.activeProgramId),
      seatVariantId: trim(input.seatVariantId || context.activeSeatVariantId),
      requester: trim(input.requester || input.requestedBy),
      requestedBy: trim(input.requester || input.requestedBy),
      owner: trim(input.owner),
      createdAt: createdAt,
      createdDate: createdAt.slice(0, 10),
      updatedAt: trim(input.updatedAt) || createdAt,
      updatedBy: trim(input.updatedBy || input.changedBy || input.owner || input.requester || input.requestedBy),
      approvedAt: trim(input.approvedAt),
      implementedAt: trim(input.implementedAt),
      affectedObjects: (input.affectedObjects || []).map(normalizeAffectedObject),
      tasks: (input.tasks || []).map(normalizeTask),
      comments: normalizeComments(input.comments, input.approvalComments),
      commercialImpact: trim(input.commercialImpact),
      engineeringImpact: trim(input.engineeringImpact),
      approvalComments: trim(input.approvalComments),
      engineeringImpactItems: cloneArray(input.engineeringImpactItems),
      commodityImpact: cloneArray(input.commodityImpact),
      commercialImpactSummary: cloneObject(input.commercialImpactSummary),
      implementationReadiness: cloneObject(input.implementationReadiness),
      resultingRevisionId: trim(input.resultingRevisionId),
      impactLastCalculatedAt: trim(input.impactLastCalculatedAt),
      impactSourceFingerprints: cloneObject(input.impactSourceFingerprints),
      implementationBaseline: cloneObject(input.implementationBaseline),
      impactTrackingEnabled: Boolean(input.impactTrackingEnabled),
      engineeringReviewStatus: normalizeReviewStatus(input.engineeringReviewStatus),
      commodityReviewStatus: normalizeReviewStatus(input.commodityReviewStatus),
      audit: (input.audit || []).slice()
    };
  }

  function normalizeAffectedObject(input) {
    if (typeof input === "string") {
      return {
        objectType: inferObjectType(input),
        objectId: trim(input),
        action: "MODIFY",
        impact: "",
        disposition: "AFFECTED"
      };
    }
    return {
      objectType: normalizeObjectType(input.objectType || input.type),
      objectId: trim(input.objectId || input.id),
      action: normalizeCode(input.action || "MODIFY"),
      impact: trim(input.impact),
      disposition: normalizeCode(input.disposition || "AFFECTED"),
      sourceDiscipline: trim(input.sourceDiscipline),
      sourceBomId: trim(input.sourceBomId),
      sourceBomItemId: trim(input.sourceBomItemId),
      partId: trim(input.partId),
      commercialLineId: trim(input.commercialLineId),
      changedFields: cloneArray(input.changedFields),
      lastModifiedAt: trim(input.lastModifiedAt)
    };
  }

  function validateChange(change, state, existingId) {
    var errors = [];
    if (!change.id) push(errors, "ENGINEERING_CHANGE_ID_REQUIRED", "Engineering Change ID is required.", change.id);
    if (change.id && state.engineeringChanges.some(function (item) { return item.id !== existingId && item.id === change.id; })) {
      push(errors, "ENGINEERING_CHANGE_ID_DUPLICATE", "Engineering Change ID must be unique.", change.id);
    }
    if (!change.changeNumber) push(errors, "ENGINEERING_CHANGE_NUMBER_REQUIRED", "Change Number is required.", change.id);
    if (change.changeNumber && state.engineeringChanges.some(function (item) {
      var other = normalizeEngineeringChange(item);
      return other.id !== existingId && normalizeCode(other.changeNumber) === normalizeCode(change.changeNumber);
    })) {
      push(errors, "ENGINEERING_CHANGE_NUMBER_DUPLICATE", "Change Number must be unique.", change.id);
    }
    if (!change.title) push(errors, "ENGINEERING_CHANGE_TITLE_REQUIRED", "Title is required.", change.id);
    if (!change.reason) push(errors, "ENGINEERING_CHANGE_REASON_REQUIRED", "Reason is required.", change.id);
    if (STATUSES.indexOf(change.status) === -1) push(errors, "ENGINEERING_CHANGE_STATUS_INVALID", "Engineering Change status is not controlled.", change.id);
    if (!change.programId) push(errors, "ECN_PROGRAM_REQUIRED", "Engineering Change must belong to a Program.", change.id);
    if (!change.seatVariantId) push(errors, "ECN_VARIANT_REQUIRED", "Engineering Change must belong to a Seat Variant.", change.id);
    if (change.programId && !findById(state.programs, change.programId)) push(errors, "ECN_PROGRAM_MISSING", "Program reference is invalid.", change.id);
    if (change.seatVariantId && !findById(state.seatVariants, change.seatVariantId)) push(errors, "ECN_VARIANT_MISSING", "Seat Variant reference is invalid.", change.id);
    var variant = findById(state.seatVariants, change.seatVariantId);
    if (change.programId && variant && variant.programId !== change.programId) {
      push(errors, "ENGINEERING_CHANGE_PROGRAM_VARIANT_MISMATCH", "Seat Variant must belong to Program.", change.id);
    }
    validateAffectedObjects(errors, change, state);
    if (errors.length) throw new app.core.errors.BusinessOperationError("Engineering Change validation failed.", errors);
  }

  function validateAffectedObjects(errors, change, state) {
    var seen = {};
    (change.affectedObjects || []).forEach(function (affected) {
      if (AFFECTED_TYPES.indexOf(affected.objectType) === -1) {
        push(errors, "ENGINEERING_CHANGE_AFFECTED_TYPE_INVALID", "Affected object type is not supported.", change.id);
        return;
      }
      if (!affected.objectId) {
        push(errors, "ENGINEERING_CHANGE_AFFECTED_ID_REQUIRED", "Affected object ID is required.", change.id);
        return;
      }
      var key = affected.objectType + "|" + affected.objectId;
      if (seen[key]) push(errors, "ENGINEERING_CHANGE_AFFECTED_DUPLICATE", "Affected object may be referenced only once.", change.id);
      seen[key] = true;
      if (!findAffectedTarget(state, affected.objectType, affected.objectId)) {
        push(errors, "OBJECT_REFERENCE_MISSING", "Affected object reference does not exist.", change.id);
      }
    });
  }

  function requireChangeForDraftEdit(state, id) {
    var change = findChange(state, id);
    if (!change) throw notFound("ENGINEERING_CHANGE", id);
    change = normalizeEngineeringChange(change);
    if (change.status !== "DRAFT") {
      throw businessError("ENGINEERING_CHANGE_LOCKED", "Only Draft Engineering Changes can be edited.", "ENGINEERING_CHANGE", id);
    }
    var index = findIndex(state.engineeringChanges, change.id);
    state.engineeringChanges[index] = change;
    return state.engineeringChanges[index];
  }

  function assertChangeEditable(change) {
    if (change.status !== "DRAFT") {
      throw businessError("ENGINEERING_CHANGE_LOCKED", "Only Draft Engineering Changes can be edited.", "ENGINEERING_CHANGE", change.id);
    }
  }

  function findAffectedTarget(state, objectType, objectId) {
    objectType = normalizeObjectType(objectType);
    if (objectType === "ENGINEERING_BOM_ITEM") {
      return (state.engineeringBoms || []).reduce(function (found, bom) {
        return found || (bom.items || []).find(function (item) { return item.id === objectId; }) || null;
      }, null);
    }
    if (objectType === "ENGINEERING_PRODUCT_STRUCTURE_ITEM") {
      return (state.engineeringProductStructures || []).reduce(function (found, structure) {
        return found || (structure.items || []).find(function (item) { return item.id === objectId; }) || null;
      }, null);
    }
    if (objectType === "COMMERCIAL_LINE") {
      return (state.commercialAssessments || []).reduce(function (found, assessment) {
        return found || (assessment.lineItems || []).find(function (line) { return line.id === objectId; }) || null;
      }, null);
    }
    var collectionName = {
      PART: "parts",
      ENGINEERING_BOM: "engineeringBoms",
      ENGINEERING_PRODUCT_STRUCTURE: "engineeringProductStructures",
      COMMERCIAL_ASSESSMENT: "commercialAssessments"
    }[normalizeObjectType(objectType)];
    return collectionName ? findById(state[collectionName], objectId) : null;
  }

  function findChange(state, idOrNumber) {
    var value = trim(idOrNumber);
    return (state.engineeringChanges || []).find(function (change) {
      var normalized = normalizeEngineeringChange(change);
      return normalized.id === value || normalized.changeNumber === value || normalized.ecnNumber === value;
    }) || null;
  }

  function normalizeStatus(status) {
    var value = normalizeCode(status || "DRAFT");
    if (value === "RELEASED") return "IMPLEMENTED";
    if (value === "COMMERCIAL_REVIEW" || value === "TECHNICAL_REVIEW" || value === "UNDER_REVIEW" || value === "IMPACT_ASSESSMENT") return "SUBMITTED";
    return STATUSES.indexOf(value) === -1 ? "DRAFT" : value;
  }

  function normalizePriority(priority) {
    var value = normalizeCode(priority || "MEDIUM");
    return ["LOW", "MEDIUM", "HIGH", "CRITICAL"].indexOf(value) === -1 ? "MEDIUM" : value;
  }

  function normalizeType(type) {
    var value = normalizeCode(type || "ENGINEERING_CHANGE");
    return value || "ENGINEERING_CHANGE";
  }

  function normalizeTask(input) {
    return Object.assign({}, input || {});
  }

  function normalizeComments(comments, approvalComments) {
    var result = Array.isArray(comments) ? comments.map(function (comment) {
      return typeof comment === "string" ? normalizeComment(comment) : Object.assign({}, comment);
    }) : [];
    if (approvalComments && !result.length) result.push(normalizeComment(approvalComments));
    return result;
  }

  function normalizeComment(text, role) {
    return {
      id: makeId("COMMENT", Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 6)),
      text: trim(text),
      createdBy: role || "",
      createdAt: now()
    };
  }

  function inferObjectType(value) {
    var text = trim(value).toUpperCase();
    if (text.indexOf("EBOM") === 0) return "ENGINEERING_BOM";
    if (text.indexOf("EPS") === 0) return "ENGINEERING_PRODUCT_STRUCTURE";
    if (text.indexOf("CA-") === 0) return "COMMERCIAL_ASSESSMENT";
    return "PART";
  }

  function normalizeObjectType(value) {
    var normalized = normalizeCode(value || "");
    if (normalized === "BOM" || normalized === "EBOM") return "ENGINEERING_BOM";
    if (normalized === "BOM_ITEM" || normalized === "EBOM_ITEM") return "ENGINEERING_BOM_ITEM";
    if (normalized === "COMPLETE_SEAT" || normalized === "EPS") return "ENGINEERING_PRODUCT_STRUCTURE";
    if (normalized === "COMPLETE_SEAT_ITEM" || normalized === "EPS_ITEM") return "ENGINEERING_PRODUCT_STRUCTURE_ITEM";
    if (normalized === "COMMERCIAL") return "COMMERCIAL_ASSESSMENT";
    if (normalized === "COMMERCIAL_ASSESSMENT_LINE") return "COMMERCIAL_LINE";
    return normalized;
  }

  function audit(state, id, action, details) {
    app.core.appState._recordAuditEvent(state, {
      objectType: "ENGINEERING_CHANGE",
      objectId: id,
      action: action,
      details: details ? JSON.stringify(Object.assign({
        engineeringChangeId: id,
        programId: state.context && state.context.activeProgramId,
        seatVariantId: state.context && state.context.activeSeatVariantId
      }, details)) : ""
    });
    var change = findById(state.engineeringChanges, id);
    if (change) {
      change.audit = (change.audit || []).concat({
        action: action,
        performedBy: state.context.activeRole,
        performedAt: now(),
        details: cloneObject(details)
      });
    }
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

  function businessError(code, message, objectType, objectId) {
    return new app.core.errors.BusinessOperationError(message, [
      { code: code, message: message, objectType: objectType, objectId: objectId || null }
    ]);
  }

  function push(errors, code, message, objectId) {
    errors.push({ code: code, message: message, objectType: "ENGINEERING_CHANGE", objectId: objectId || null });
  }

  function makeId(prefix, value) {
    return prefix + "-" + normalizeCode(value || Date.now().toString(36)).replace(/[^A-Z0-9]+/g, "-").replace(/^-|-$/g, "");
  }

  function findById(collection, id) {
    return (collection || []).find(function (item) { return item.id === id; }) || null;
  }

  function findIndex(collection, id) {
    return (collection || []).findIndex(function (item) { return item.id === id; });
  }

  function normalizeCode(value) {
    return trim(value).toUpperCase().replace(/[\s-]+/g, "_");
  }

  function trim(value) {
    return String(value == null ? "" : value).trim();
  }

  function now() {
    return new Date().toISOString();
  }

  function normalizeReviewStatus(value) {
    var normalized = normalizeCode(value || "NOT_STARTED");
    return ["NOT_STARTED", "IN_PROGRESS", "COMPLETE", "NOT_APPLICABLE"].indexOf(normalized) === -1 ? "NOT_STARTED" : normalized;
  }

  function cloneArray(value) {
    return Array.isArray(value) ? JSON.parse(JSON.stringify(value)) : [];
  }

  function cloneObject(value) {
    return value && typeof value === "object" && !Array.isArray(value) ? JSON.parse(JSON.stringify(value)) : {};
  }

  function currentStatusForAudit(change, targetStatus) {
    var transitions = { SUBMITTED: "DRAFT", APPROVED: "SUBMITTED", REJECTED: "SUBMITTED", CANCELLED: "OPEN", IMPLEMENTING: "APPROVED", IMPLEMENTED: "IMPLEMENTING" };
    return transitions[targetStatus] || change.status;
  }

  function recalculateEngineeringChangeImpact(id, options) {
    if (!app.domain.engineeringChangeImpactService) return getEngineeringChange(id);
    return app.domain.engineeringChangeImpactService.recalculateEngineeringChangeImpact(id, options);
  }

  function getImplementationReadiness(id) {
    if (!app.domain.engineeringChangeImpactService) return { ready: false, checks: [], blockingErrors: [] };
    return app.domain.engineeringChangeImpactService.getImplementationReadiness(id);
  }

  function completeEngineeringReview(id, comment) {
    return app.domain.engineeringChangeImpactService.completeEngineeringReview(id, comment);
  }

  function completeCommodityReview(id, comment) {
    return app.domain.engineeringChangeImpactService.completeCommodityReview(id, comment);
  }

  app.domain.engineeringChangeService = {
    STATUSES: STATUSES.slice(),
    listEngineeringChanges: listEngineeringChanges,
    getEngineeringChange: getEngineeringChange,
    createEngineeringChange: createEngineeringChange,
    updateEngineeringChange: updateEngineeringChange,
    deleteDraftEngineeringChange: deleteDraftEngineeringChange,
    submitEngineeringChange: submitEngineeringChange,
    approveEngineeringChange: approveEngineeringChange,
    rejectEngineeringChange: rejectEngineeringChange,
    cancelEngineeringChange: cancelEngineeringChange,
    startImplementation: startImplementation,
    completeImplementation: completeImplementation,
    addAffectedObject: addAffectedObject,
    removeAffectedObject: removeAffectedObject,
    addComment: addComment,
    recalculateEngineeringChangeImpact: recalculateEngineeringChangeImpact,
    getImplementationReadiness: getImplementationReadiness,
    completeEngineeringReview: completeEngineeringReview,
    completeCommodityReview: completeCommodityReview,
    validateTransition: validateTransition,
    canModifyReleasedObject: canModifyReleasedObject,
    normalizeEngineeringChange: normalizeEngineeringChange,
    normalizeAffectedObject: normalizeAffectedObject
  };
})(typeof window !== "undefined" ? (window.DEP = window.DEP || {}) : (globalThis.DEP = globalThis.DEP || {}));
