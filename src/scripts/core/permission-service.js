(function (app) {
  app.core = app.core || {};

  var EDIT_ROLES = {
    programs: ["PROGRAM_MANAGER"],
    seatVariants: ["PROGRAM_MANAGER", "ENGINEERING"],
    features: ["ENGINEERING"],
    featureConfigurations: ["ENGINEERING", "PROGRAM_MANAGER"],
    engineeringModules: ["ENGINEERING"],
    parts: ["ENGINEERING"],
    engineeringBoms: ["ENGINEERING"],
    engineeringProductStructures: ["ENGINEERING", "PROGRAM_MANAGER"],
    commercialAssessments: ["COMMODITY_MANAGER"],
    commercialRecords: ["COMMODITY_MANAGER"],
    suppliers: ["COMMODITY_MANAGER"],
    commodities: ["ADMINISTRATOR", "COMMODITY_MANAGER", "ENGINEERING"],
    commodityCategories: ["ADMINISTRATOR", "ENGINEERING"],
    variantCommodityMappings: ["ADMINISTRATOR", "COMMODITY_MANAGER", "PROGRAM_MANAGER"],
    engineeringChanges: ["ENGINEERING", "PROGRAM_MANAGER", "COMMODITY_MANAGER"],
    revisions: [],
    auditEvents: []
  };

  function getRole(contextOrRole) {
    if (!contextOrRole) return "ENGINEERING";
    if (typeof contextOrRole === "string") return contextOrRole;
    return contextOrRole.activeRole || "ENGINEERING";
  }

  function canView() {
    return true;
  }

  function canCreate(collectionName, contextOrRole) {
    if (getRole(contextOrRole) === "ADMINISTRATOR" && collectionName !== "revisions" && collectionName !== "auditEvents") return true;
    return (EDIT_ROLES[collectionName] || []).indexOf(getRole(contextOrRole)) !== -1;
  }

  function canEdit(collectionName, object, contextOrRole) {
    if (!canCreate(collectionName, contextOrRole)) return false;
    if (isReleased(object)) return canModifyReleasedObject(collectionToObjectType(collectionName), object && object.id, contextOrRole);
    if (collectionName === "revisions" || collectionName === "auditEvents") return false;
    return true;
  }

  function canDelete(collectionName, object, contextOrRole) {
    return canEdit(collectionName, object, contextOrRole);
  }

  function canTransition(role, object, targetState) {
    if (!object || isReleased(object)) return false;
    if (targetState === "RELEASED") {
      return ["PROGRAM_MANAGER", "ENGINEERING"].indexOf(getRole(role)) !== -1;
    }
    return canCreate("engineeringChanges", role);
  }

  function assertCanEdit(collectionName, object, contextOrRole) {
    if (!canEdit(collectionName, object, contextOrRole)) {
      throw new app.core.errors.PermissionError("Object cannot be edited in its current role or lifecycle state.", [
        {
          code: isReleased(object) ? "RELEASED_OBJECT_IMMUTABLE" : "PERMISSION_DENIED",
          message: isReleased(object) ? "Released objects cannot be edited directly." : "The active role cannot edit this collection.",
          objectType: collectionName,
          objectId: object && object.id
        }
      ]);
    }
  }

  function isReleased(object) {
    return Boolean(object && (object.lifecycleState === "RELEASED" || object.lifecycleStatus === "RELEASED" || object.status === "RELEASED"));
  }

  function canModifyReleasedObject(objectType, objectId, contextOrRole) {
    var context = typeof contextOrRole === "object" ? contextOrRole : {};
    var state = context.state || null;
    var changeId = context.engineeringChangeId || context.changeId || context.activeEngineeringChangeId;
    if (!state || !changeId || !objectType || !objectId) return false;
    var change = (state.engineeringChanges || []).find(function (candidate) {
      return candidate.id === changeId || candidate.changeNumber === changeId || candidate.ecnNumber === changeId;
    });
    if (!change || ["APPROVED", "IMPLEMENTING"].indexOf(change.status) === -1) return false;
    return (change.affectedObjects || []).some(function (affected) {
      return normalizeObjectType(affected.objectType) === normalizeObjectType(objectType) && affected.objectId === objectId;
    });
  }

  function collectionToObjectType(collectionName) {
    return {
      parts: "PART",
      engineeringBoms: "ENGINEERING_BOM",
      engineeringProductStructures: "ENGINEERING_PRODUCT_STRUCTURE",
      commercialAssessments: "COMMERCIAL_ASSESSMENT"
    }[collectionName] || String(collectionName || "").toUpperCase();
  }

  function normalizeObjectType(value) {
    var normalized = String(value == null ? "" : value).trim().toUpperCase().replace(/[\s-]+/g, "_");
    if (normalized === "BOM" || normalized === "EBOM") return "ENGINEERING_BOM";
    if (normalized === "BOM_ITEM" || normalized === "EBOM_ITEM") return "ENGINEERING_BOM_ITEM";
    if (normalized === "COMPLETE_SEAT" || normalized === "EPS") return "ENGINEERING_PRODUCT_STRUCTURE";
    if (normalized === "COMPLETE_SEAT_ITEM" || normalized === "EPS_ITEM") return "ENGINEERING_PRODUCT_STRUCTURE_ITEM";
    if (normalized === "COMMERCIAL") return "COMMERCIAL_ASSESSMENT";
    if (normalized === "COMMERCIAL_ASSESSMENT_LINE") return "COMMERCIAL_LINE";
    return normalized;
  }

  app.core.permissionService = {
    canView: canView,
    canCreate: canCreate,
    canEdit: canEdit,
    canDelete: canDelete,
    canTransition: canTransition,
    assertCanEdit: assertCanEdit,
    isReleased: isReleased,
    canModifyReleasedObject: canModifyReleasedObject
  };
})(typeof window !== "undefined" ? (window.DEP = window.DEP || {}) : (globalThis.DEP = globalThis.DEP || {}));
