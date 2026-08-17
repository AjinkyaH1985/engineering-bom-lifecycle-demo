(function (app) {
  var workspaceMap = {};
  var transitionGuard = null;

  function performNavigate(id) {
    if (!workspaceMap[id]) id = "dashboard";
    var currentId = app.state.getCurrentWorkspace();
    var currentWorkspace = workspaceMap[currentId];
    if (currentWorkspace && currentWorkspace.beforeLeave) currentWorkspace.beforeLeave();
    transitionGuard = null;
    if (app.components && app.components.modal) app.components.modal.close();
    app.state.setWorkspace(id);
    app.components.navigation.render();
    app.router.render();
  }

  function requestTransition(transition) {
    transition = transition || {};
    if (!transitionGuard) {
      if (transition.proceed) transition.proceed();
      return true;
    }
    return transitionGuard(transition) !== false;
  }

  app.router = {
    register: function (id, workspace) {
      workspaceMap[id] = workspace;
    },
    start: function () {
      this.navigate("dashboard");
    },
    navigate: function (id) {
      var container = app.utils.byId("app-workspace");
      if (id === app.state.getCurrentWorkspace() && container && container.childNodes.length) return;
      requestTransition({
        type: "workspace",
        targetWorkspaceId: id,
        proceed: function () { performNavigate(id); }
      });
    },
    setTransitionGuard: function (guard) {
      transitionGuard = typeof guard === "function" ? guard : null;
    },
    clearTransitionGuard: function () {
      transitionGuard = null;
    },
    requestTransition: requestTransition,
    getWorkspace: function (id) {
      return workspaceMap[id] || null;
    },
    render: function () {
      var resolutionStartedAt = Date.now();
      var state = app.state.get();
      var dataResolutionMs = Date.now() - resolutionStartedAt;
      var workspace = workspaceMap[state.currentWorkspace] || workspaceMap.dashboard;
      var container = app.utils.byId("app-workspace");
      var renderStartedAt = Date.now();
      container.innerHTML = workspace.render(state);
      if (workspace.afterRender) {
        workspace.afterRender(container, state);
      }
      if (app.utils.bindWorkspaceHeaderContext) {
        app.utils.bindWorkspaceHeaderContext(container);
      }
      app.components.header.render();
      app.components.propertiesPanel.render();
      app.components.relatedTabs.render();
      app.components.statusBar.render();
      container.dataset.dataResolutionMs = String(dataResolutionMs);
      container.dataset.workspaceRenderMs = String(Date.now() - renderStartedAt);
      container.dataset.workspaceId = state.currentWorkspace;
      container.dataset.activeProgramId = state.program && state.program.id || "";
      container.dataset.activeFinishedGoodVariantId = state.variant && state.variant.id || "";
      container.dataset.activeFeatureConfigurationId = state.activeFeatureConfiguration && state.activeFeatureConfiguration.id || "";
      if (app.components.table && app.components.table.enhanceResizableTables) {
        app.components.table.enhanceResizableTables(container, state.currentWorkspace);
      }
    }
  };
})(window.DEP = window.DEP || {});
