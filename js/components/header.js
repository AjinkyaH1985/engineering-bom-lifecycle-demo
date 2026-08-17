(function (app) {
  app.components = app.components || {};
  app.components.header = {
    render: function () {
      app.utils.byId("app-header").innerHTML = [
        '<div class="header-brand">',
        '<div class="brand-mark">EBL</div>',
        '<div class="brand-title">Engineering BOM Lifecycle Platform</div>',
        '</div>',
        '<div class="header-toolbar"><span class="portfolio-note">Portfolio Demonstration &mdash; Synthetic automotive engineering data</span></div>'
      ].join("");
    }
  };

})(window.DEP = window.DEP || {});
