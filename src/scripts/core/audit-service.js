(function (app) {
  app.core = app.core || {};

  function recordEvent(event) {
    return app.core.appState.transaction(function (state) {
      app.core.appState._recordAuditEvent(state, event);
    });
  }

  function getEventsForObject(objectType, objectId) {
    return app.core.appState.getCollection("auditEvents").filter(function (event) {
      return event.objectType === objectType && event.objectId === objectId;
    });
  }

  app.core.auditService = {
    recordEvent: recordEvent,
    getEventsForObject: getEventsForObject
  };
})(typeof window !== "undefined" ? (window.DEP = window.DEP || {}) : (globalThis.DEP = globalThis.DEP || {}));
