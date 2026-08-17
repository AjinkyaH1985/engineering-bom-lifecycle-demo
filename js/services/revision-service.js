(function (app) {
  app.services = app.services || {};
  app.services.revisionService = {
    getCurrentRevision: function () {
      if (app.domain && app.domain.revisionService) {
        var history = app.domain.revisionService.getRevisionHistory();
        return history.length ? history[history.length - 1].revisionNumber : app.state.get().currentRevision;
      }
      return app.state.get().currentRevision;
    },
    getRevisionHistory: function () {
      if (app.domain && app.domain.revisionService) return app.domain.revisionService.getRevisionHistory();
      return app.state.get().revisions || [];
    }
  };
})(window.DEP = window.DEP || {});
