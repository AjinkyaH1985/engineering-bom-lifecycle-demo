(function (app) {
  app.services = app.services || {};
  app.services.validationService = {
    hasValue: function (value) {
      return value !== undefined && value !== null && String(value).trim() !== "";
    }
  };
})(window.DEP = window.DEP || {});
