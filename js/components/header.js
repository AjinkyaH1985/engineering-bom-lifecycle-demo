(function (app) {
  app.components = app.components || {};

  var svg = {
    menu: '<path d="M4 6h16M4 12h16M4 18h16" />',
    search: '<circle cx="11" cy="11" r="6.5"/><path d="M16 16l5 5"/>',
    bell: '<path d="M6 17V11a6 6 0 0 1 12 0v6l1.5 2h-15z"/><path d="M10 21a2 2 0 0 0 4 0"/>',
    user: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>'
  };

  function icon(name, size) {
    return '<svg viewBox="0 0 24 24" width="' + (size || 18) + '" height="' + (size || 18) + '" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + svg[name] + '</svg>';
  }

  function activeContextLabel() {
    try {
      var context = app.core.appState.getContext();
      var variant = context.activeSeatVariantId ? app.core.appState.getById("seatVariants", context.activeSeatVariantId) : null;
      if (!variant) return "No variant selected";
      return [variant.customer || variant.brand, variant.seatType || variant.seatFamily, variant.side, variant.grade]
        .filter(Boolean).join(" · ");
    } catch (error) {
      return "Select context";
    }
  }

  app.components.header = {
    icon: icon,
    render: function () {
      var escape = app.utils.escapeHtml;
      var searchWasOpen = document.body.classList.contains("search-open");
      app.utils.byId("app-header").innerHTML = [
        '<button type="button" class="nav-toggle" data-nav-toggle aria-label="Open navigation menu" aria-controls="app-navigation" aria-expanded="false">',
        icon("menu", 20),
        '</button>',
        '<div class="header-brand">',
        '<div class="brand-title">Engineering BOM Lifecycle</div>',
        '</div>',
        '<div class="header-toolbar">',
        '<span class="portfolio-note">Portfolio Demonstration &mdash; Synthetic automotive engineering data</span>',
        '<div class="hdr-search" data-hdr-search>',
        '<input type="search" class="hdr-search-input" data-hdr-search-input placeholder="Search parts, changes, screens" autocomplete="off" aria-label="Search parts, engineering changes and screens">',
        '<div class="hdr-popover hdr-search-results" data-hdr-search-results hidden role="listbox"></div>',
        '</div>',
        '<button type="button" class="hdr-icon" data-hdr-search-toggle aria-label="Search" title="Search">' + icon("search") + '</button>',
        '<button type="button" class="header-context-chip" data-goto-workspace="program" title="Active Finished-Good Variant. Open Programme Context to change it.">',
        '<span class="chip-label">Active</span><span class="chip-value">' + escape(activeContextLabel()) + '</span>',
        '</button>',
        '<button type="button" class="hdr-icon" data-hdr-bell aria-label="Notifications and recent activity" title="Notifications" aria-expanded="false">' + icon("bell") + '</button>',
        '<button type="button" class="hdr-avatar" data-hdr-avatar aria-label="User menu" title="Demo User" aria-expanded="false">' + icon("user") + '</button>',
        '</div>'
      ].join("");
      var open = document.body.classList.contains("nav-open");
      var toggle = document.querySelector("[data-nav-toggle]");
      if (toggle) toggle.setAttribute("aria-expanded", open ? "true" : "false");
      if (searchWasOpen) {
        var input = document.querySelector("[data-hdr-search-input]");
        if (input && app.components.shellTools) app.components.shellTools.restoreSearch(input);
      }
    }
  };

})(window.DEP = window.DEP || {});
