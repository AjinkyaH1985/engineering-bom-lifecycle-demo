(function (app) {
  app.domain = app.domain || {};

  var cache = null;
  var MODULE_WORKSPACES = {
    STRUCTURE: "structure",
    FOAM: "foam",
    PLASTIC: "plastic",
    TRIM: "trim",
    HEAD_REST: "headrest",
    ARM_REST: "armrest"
  };
  var OPEN_CHANGE_STATUSES = ["DRAFT", "SUBMITTED", "APPROVED", "IMPLEMENTING"];

  function getDashboardSummary(criteria) {
    criteria = criteria || {};
    var context = app.core.contextService.getContext();
    var programId = criteria.programId || context.activeProgramId;
    var seatVariantId = criteria.seatVariantId || context.activeSeatVariantId;
    var version = app.core.appState.getVersion();
    var cacheKey = [version, programId || "", seatVariantId || ""].join("|");
    if (cache && cache.key === cacheKey) return clone(cache.value);

    var startedAt = Date.now();
    var state = app.core.appState.getState();
    var program = findById(state.programs, programId);
    var variant = findById(state.seatVariants, seatVariantId);
    var revisions = getReleasedRevisions(state, programId, seatVariantId);
    var latestRevision = revisions.length ? revisions[revisions.length - 1] : null;
    var assessment = getCurrentAssessment(state, programId, seatVariantId);
    var pendingPo = countPendingPoLines(assessment);
    var bomSummary = getBomSummary(state, programId, seatVariantId);
    var changeSummary = getChangeSummary(state, programId, seatVariantId);
    var value = {
      hasActiveVariant: Boolean(program && variant && variant.programId === program.id),
      context: {
        programId: program && program.id || null,
        programme: programmeLabel(program),
        customer: variant && (variant.customer || variant.brand || variant.oem) || program && (program.customer || program.oem) || "Not available",
        seatType: variant && (variant.seatType || variant.seatFamily) || "Not available",
        seatVariantId: variant && variant.id || null,
        finishedGoodVariant: variant && (variant.variantCode || variant.variantName || variant.id) || "Not available",
        latestRevision: latestRevision ? "Revision " + latestRevision.revisionNumber : "No released Revision"
      },
      pendingPo: {
        count: pendingPo,
        assessmentId: assessment && assessment.id || null,
        assessmentStatus: assessment && (assessment.generationStatus || assessment.status) || "NOT_AVAILABLE"
      },
      completedBoms: bomSummary,
      engineeringChanges: changeSummary,
      releasedRevisions: {
        count: revisions.length,
        latestRevisionId: latestRevision && latestRevision.id || null,
        latestRevisionNumber: latestRevision && latestRevision.revisionNumber || null
      },
      resolvedAt: new Date().toISOString(),
      resolutionMs: Date.now() - startedAt
    };
    cache = { key: cacheKey, value: clone(value) };
    return value;
  }

  function getBomSummary(state, programId, seatVariantId) {
    if (!programId || !seatVariantId) return emptyBomSummary();
    var entries = app.domain.engineeringProductStructureService.getEngineeringBomApplicability({
      state: state,
      programId: programId,
      seatVariantId: seatVariantId
    }).filter(function (entry) { return entry.required; });
    var completed = entries.filter(function (entry) { return entry.completionStatus === "COMPLETE"; }).length;
    var firstIncomplete = entries.find(function (entry) { return entry.completionStatus !== "COMPLETE"; });
    return {
      completed: completed,
      required: entries.length,
      firstIncompleteModuleCode: firstIncomplete && firstIncomplete.moduleCode || null,
      targetWorkspaceId: firstIncomplete
        ? MODULE_WORKSPACES[normalizeModuleCode(firstIncomplete.moduleCode)] || null
        : entries.length ? "complete-seat" : null
    };
  }

  function emptyBomSummary() {
    return { completed: 0, required: 0, firstIncompleteModuleCode: null, targetWorkspaceId: null };
  }

  function getChangeSummary(state, programId, seatVariantId) {
    var changes = (state.engineeringChanges || []).filter(function (change) {
      return change.programId === programId && change.seatVariantId === seatVariantId &&
        ["REJECTED", "CANCELLED"].indexOf(normalizeStatus(change.status)) === -1;
    });
    var open = changes.filter(function (change) { return OPEN_CHANGE_STATUSES.indexOf(normalizeStatus(change.status)) !== -1; }).length;
    var implemented = changes.filter(function (change) { return normalizeStatus(change.status) === "IMPLEMENTED"; }).length;
    return { total: open + implemented, open: open, implemented: implemented };
  }

  function countPendingPoLines(assessment) {
    if (!assessment) return 0;
    return (assessment.lineItems || []).filter(function (line) {
      if (line.obsolete || normalizeStatus(line.sourcingStatus) === "OBSOLETE" ||
        normalizeStatus(line.commercialStatus || line.status) === "OBSOLETE") return false;
      var changeClass = normalizeStatus(line.changeClassification || (line.sourcePartSnapshot || {}).changeClassification);
      if (changeClass === "DELETED") return false;
      if (!trim(line.supplierId || line.supplier)) return false;
      var sourcingStatus = normalizeStatus(line.sourcingStatus);
      var poStatus = normalizeStatus(line.poStatus);
      var purchasingStarted = ["QUOTED", "NOMINATED", "SOURCED"].indexOf(sourcingStatus) !== -1 || Boolean(poStatus);
      if (!purchasingStarted) return false;
      var pendingStatus = ["PENDING", "NOT_STARTED", "AWAITING_PO", "OPEN"].indexOf(poStatus) !== -1;
      return !trim(line.poNumber) || pendingStatus;
    }).length;
  }

  function getCurrentAssessment(state, programId, seatVariantId) {
    return (state.commercialAssessments || []).filter(function (assessment) {
      return assessment.programId === programId && assessment.seatVariantId === seatVariantId;
    }).sort(function (a, b) {
      return String(a.updatedAt || a.createdAt || "").localeCompare(String(b.updatedAt || b.createdAt || ""));
    }).pop() || null;
  }

  function getReleasedRevisions(state, programId, seatVariantId) {
    return (state.revisions || []).filter(function (revision) {
      return revision.programId === programId && revision.seatVariantId === seatVariantId &&
        normalizeStatus(revision.lifecycleStatus) === "RELEASED";
    }).sort(function (a, b) {
      var dateOrder = String(a.releasedAt || a.createdAt || "").localeCompare(String(b.releasedAt || b.createdAt || ""));
      return dateOrder || String(a.revisionNumber || "").localeCompare(String(b.revisionNumber || ""));
    });
  }

  function programmeLabel(program) {
    return program && (program.programCode || program.code || program.programName || program.name || program.id) || "Not available";
  }

  function normalizeModuleCode(value) {
    return String(value || "").trim().toUpperCase().replace(/[\s-]+/g, "_");
  }

  function normalizeStatus(value) {
    return String(value || "").trim().toUpperCase().replace(/[\s-]+/g, "_");
  }

  function trim(value) {
    return String(value == null ? "" : value).trim();
  }

  function findById(collection, id) {
    return (collection || []).find(function (item) { return item.id === id; }) || null;
  }

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  app.domain.dashboardService = {
    getDashboardSummary: getDashboardSummary
  };
})(typeof window !== "undefined" ? (window.DEP = window.DEP || {}) : (globalThis.DEP = globalThis.DEP || {}));
