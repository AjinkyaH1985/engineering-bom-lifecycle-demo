(function (app) {
  app.components = app.components || {};
  app.components.propertiesPanel = {
    render: function () {
      var appRoot = app.utils.byId("app");
      var properties = app.utils.byId("app-properties");
      if (appRoot) appRoot.classList.remove("has-properties");
      if (properties) properties.innerHTML = "";
    }
  };
})(window.DEP = window.DEP || {});
