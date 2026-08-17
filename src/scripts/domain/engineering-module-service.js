(function (app) {
  app.domain = app.domain || {};

  function listEngineeringModules() {
    return app.core.appState.getCollection("engineeringModules");
  }

  function getEngineeringModuleById(id) {
    return app.core.appState.getById("engineeringModules", id);
  }

  function getEngineeringModuleByCode(code) {
    var normalized = normalizeCode(code);
    return listEngineeringModules().find(function (module) {
      return normalizeCode(module.code) === normalized;
    }) || null;
  }

  function requireModuleByCode(code) {
    var module = getEngineeringModuleByCode(code);
    if (!module) {
      throw new app.core.errors.BusinessOperationError("Engineering Module was not found.", [
        { code: "ENGINEERING_MODULE_NOT_FOUND", message: "Engineering Module was not found.", objectType: "ENGINEERING_MODULE", objectId: code }
      ]);
    }
    return module;
  }

  function normalizeCode(value) {
    return String(value == null ? "" : value).trim().toUpperCase().replace(/[\s-]+/g, "_");
  }

  app.domain.engineeringModuleService = {
    listEngineeringModules: listEngineeringModules,
    getEngineeringModuleById: getEngineeringModuleById,
    getEngineeringModuleByCode: getEngineeringModuleByCode,
    requireModuleByCode: requireModuleByCode,
    normalizeCode: normalizeCode
  };
})(typeof window !== "undefined" ? (window.DEP = window.DEP || {}) : (globalThis.DEP = globalThis.DEP || {}));
