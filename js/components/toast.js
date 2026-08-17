(function (app) {
  app.components = app.components || {};
  app.components.toast = {
    show: function (notification) {
      var region = app.utils.byId("toast-region");
      var toast = document.createElement("div");
      toast.className = "toast";
      toast.textContent = notification.message;
      region.appendChild(toast);
      window.setTimeout(function () {
        toast.remove();
      }, 2600);
    }
  };
})(window.DEP = window.DEP || {});
