(function (app) {
  function bindGlobalEvents() {
    app.events.on("state:changed", function () {
      app.components.header.render();
      app.components.propertiesPanel.render();
      app.components.relatedTabs.render();
      app.components.statusBar.render();
      var relatedClose = app.utils.byId("app-tabs") && app.utils.byId("app-tabs").querySelector("[data-close-related]");
      if (relatedClose) relatedClose.onclick = function () {
        app.state.clearSelection();
      };
    });

    app.events.on("notification:created", function (notification) {
      app.components.toast.show(notification);
    });
  }

  app.start = function () {
    bindGlobalEvents();
    app.core.appState.initialise();
    if (app.domain.bomImportService && app.domain.bomImportService.normalizeExistingImportDuplicates) {
      app.domain.bomImportService.normalizeExistingImportDuplicates();
    }
    if (app.state.repairContext) app.state.repairContext();
    app.components.header.render();
    app.components.navigation.render();
    app.components.propertiesPanel.render();
    app.components.relatedTabs.render();
    app.components.statusBar.render();
    if (app.components.table && app.components.table.initializeColumnResizing) {
      app.components.table.initializeColumnResizing(app.utils.byId("app-workspace"));
    }
    app.router.start();
  };

  document.addEventListener("DOMContentLoaded", app.start);
})(window.DEP = window.DEP || {});
