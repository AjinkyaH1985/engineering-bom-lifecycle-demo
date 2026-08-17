(function (app) {
  app.components = app.components || {};
  app.components.relatedTabs = {
    render: function () {
      var appRoot = app.utils.byId("app");
      var tabs = app.utils.byId("app-tabs");
      if (tabs) tabs.innerHTML = "";
      if (appRoot) appRoot.classList.remove("has-tabs");
    }
  };
})(window.DEP = window.DEP || {});
