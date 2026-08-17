(function (app) {
  app.services = app.services || {};
  app.services.featureService = {
    listEnabledFeatures: function () {
      var state = app.state.get();
      var selectedFeatures = (state.activeConfiguredSeat && state.activeConfiguredSeat.selectedFeatures) || [];
      return state.featureMatrix.filter(function (feature) {
        return selectedFeatures.indexOf(feature.name) !== -1;
      });
    }
  };
})(window.DEP = window.DEP || {});
