(function (app) {
  app.components = app.components || {};

  var svg = {
    menu: '<path d="M4 6h16M4 12h16M4 18h16" />',
    bell: '<path d="M6 17V11a6 6 0 0 1 12 0v6l1.5 2h-15z"/><path d="M10 21a2 2 0 0 0 4 0"/>',
    user: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>'
  };

  function icon(name, size) {
    return '<svg viewBox="0 0 24 24" width="' + (size || 18) + '" height="' + (size || 18) + '" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + svg[name] + '</svg>';
  }

  app.components.header = {
    icon: icon,
    render: function () {
      app.utils.byId("app-header").innerHTML = [
        '<button type="button" class="nav-toggle" data-nav-toggle aria-label="Open navigation menu" aria-controls="app-navigation" aria-expanded="false">',
        icon("menu", 20),
        '</button>',
        '<div class="header-brand">',
        '<button type="button" class="brand-title" data-goto-workspace="dashboard" title="Go to Dashboard">Engineering BOM Lifecycle</button>',
        '</div>',
        '<div class="header-toolbar">',
        '<button type="button" class="hdr-icon" data-hdr-bell aria-label="Notifications and recent activity" title="Notifications" aria-expanded="false">' + icon("bell") + '</button>',
        '<button type="button" class="hdr-avatar" data-hdr-avatar aria-label="User menu" title="Demo User" aria-expanded="false">' + icon("user") + '</button>',
        '</div>'
      ].join("");
      var open = document.body.classList.contains("nav-open");
      var toggle = document.querySelector("[data-nav-toggle]");
      if (toggle) toggle.setAttribute("aria-expanded", open ? "true" : "false");
    }
  };

})(window.DEP = window.DEP || {});
