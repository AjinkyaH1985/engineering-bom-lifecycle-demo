(function (app) {
  app.services = app.services || {};
  app.services.notificationService = {
    notify: function (message, tone) {
      app.state.addNotification(message, tone);
    }
  };
})(window.DEP = window.DEP || {});
