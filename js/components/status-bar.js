(function (app) {
  app.components = app.components || {};
  app.components.statusBar = {
    render: function () {
      app.utils.byId("app-status").innerHTML = "";
    }
  };
})(window.DEP = window.DEP || {});
