(function (app) {
  app.components = app.components || {};

  var RECENT_KEY = "engineeringBomLifecyclePortfolio.public.v2.ui.recentWorkspaces";
  var MAX_RECENT = 8;

  var groups = [
    { title: "Overview", items: [
      { id: "dashboard", label: "Dashboard", hint: "Review the active product context and its four operational indicators." }
    ] },
    { title: "Import", items: [
      { id: "import-bom", label: "Import BOM", hint: "Validate and import a supported source Excel BOM into an isolated Programme context." }
    ] },
    { title: "Context", items: [
      { id: "program", label: "Programme Context", hint: "Create or select the active Programme and Finished-Good Variant." }
    ] },
    { title: "Configuration", items: [
      { id: "feature-matrix", label: "Feature Matrix", hint: "Select features and applicability for the active Finished-Good Variant." }
    ] },
    { title: "Engineering", items: [
      { id: "structure", label: "Structure", hint: "Author the Structure Engineering eBOM." },
      { id: "foam", label: "Foam", hint: "Author the Foam Engineering eBOM." },
      { id: "plastic", label: "Plastic", hint: "Author the Plastic Engineering eBOM." },
      { id: "trim", label: "Trim", hint: "Author the Trim Engineering eBOM." },
      { id: "headrest", label: "Head Rest", hint: "Author the Head Rest Engineering eBOM." },
      { id: "armrest", label: "Arm Rest", hint: "Author the Arm Rest Engineering eBOM." }
    ] },
    { title: "Product Definition", items: [
      { id: "complete-seat", label: "Complete Seat JIT", hint: "Review the generated consolidated eBOM." }
    ] },
    { title: "Commercial", items: [
      { id: "bom-cost", label: "Commercial Assessment", hint: "Assess suppliers and cost against EPS leaf items." }
    ] },
    { title: "Governance", items: [
      { id: "engineering-change", label: "Engineering Change", hint: "Control modifications to released product data." },
      { id: "revision", label: "Revision History", hint: "Create and review immutable released baselines." },
      { id: "excel-export", label: "Excel Export", hint: "Reconstruct the source workbook from a released Revision snapshot." }
    ] },
    { title: "Admin", items: [
      { id: "commodity-management", label: "Commodity Master", hint: "Maintain the independent Commodity Master used for controlled classification." },
      { id: "admin-master-data", label: "Master Data", hint: "Configure engineering disciplines, suppliers, Commodity Categories, and visual assets." }
    ] }
  ];

  var activeTab = "apps";
  var collapsedGroups = {};
  var recent = loadRecent();
  var lastRecorded = null;

  function loadRecent() {
    try {
      var raw = window.sessionStorage && window.sessionStorage.getItem(RECENT_KEY);
      var parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? parsed.filter(function (id) { return typeof id === "string"; }).slice(0, MAX_RECENT) : [];
    } catch (error) {
      return [];
    }
  }

  function saveRecent() {
    try {
      if (window.sessionStorage) window.sessionStorage.setItem(RECENT_KEY, JSON.stringify(recent));
    } catch (error) { /* session storage is optional */ }
  }

  function recordVisit(workspaceId) {
    if (!workspaceId || workspaceId === lastRecorded) return;
    lastRecorded = workspaceId;
    recent = [workspaceId].concat(recent.filter(function (id) { return id !== workspaceId; })).slice(0, MAX_RECENT);
    saveRecent();
  }

  function findItem(id) {
    var found = null;
    groups.forEach(function (group) {
      group.items.forEach(function (item) { if (item.id === id) found = item; });
    });
    return found;
  }

  function navItem(item, currentWorkspace) {
    var escape = app.utils.escapeHtml;
    var active = item.id === currentWorkspace;
    return '<button type="button" class="nav-item' + (active ? " active" : "") + '" data-workspace="' + item.id + '"' +
      (active ? ' aria-current="page"' : "") + ' title="' + escape(item.hint || item.label) + '">' +
      (app.components.icons ? app.components.icons.workspace(item.id) : "") +
      '<span class="nav-label">' + escape(item.label) + '</span></button>';
  }

  function renderApps(currentWorkspace) {
    var escape = app.utils.escapeHtml;
    return groups.filter(function (group) { return group.title !== "Overview"; }).map(function (group) {
      var containsActive = group.items.some(function (item) { return item.id === currentWorkspace; });
      var collapsed = Boolean(collapsedGroups[group.title]) && !containsActive;
      return '<div class="nav-group' + (collapsed ? " is-collapsed" : "") + '">' +
        '<button type="button" class="nav-group-title" data-nav-group="' + escape(group.title) + '" aria-expanded="' + (collapsed ? "false" : "true") + '">' +
        '<span>' + escape(group.title) + '</span><span class="nav-group-chevron" aria-hidden="true"></span></button>' +
        '<div class="nav-group-items">' + group.items.map(function (item) { return navItem(item, currentWorkspace); }).join("") + '</div>' +
        '</div>';
    }).join("");
  }

  function renderRecent(currentWorkspace) {
    var items = recent.map(findItem).filter(Boolean);
    if (!items.length) return '<div class="nav-empty">No recent items yet. Screens you open appear here.</div>';
    return '<div class="nav-group"><div class="nav-group-items">' +
      items.map(function (item) { return navItem(item, currentWorkspace); }).join("") + '</div></div>';
  }

  function bind(root) {
    root.querySelectorAll("[data-nav-tab]").forEach(function (button) {
      button.onclick = function () {
        activeTab = button.getAttribute("data-nav-tab");
        app.components.navigation.render();
      };
    });
    root.querySelectorAll("[data-nav-group]").forEach(function (button) {
      button.onclick = function () {
        var title = button.getAttribute("data-nav-group");
        collapsedGroups[title] = !collapsedGroups[title];
        app.components.navigation.render();
      };
    });
    root.querySelectorAll("[data-workspace]").forEach(function (button) {
      button.onclick = function () {
        app.router.navigate(button.getAttribute("data-workspace"));
      };
    });
  }

  app.components.navigation = {
    groups: groups,
    getRecent: function () { return recent.slice(); },
    render: function () {
      var root = app.utils.byId("app-navigation");
      var currentWorkspace = app.state.getCurrentWorkspace();
      recordVisit(currentWorkspace);
      var homeActive = currentWorkspace === "dashboard";
      root.innerHTML = [
        '<div class="nav-head">',
        '<div class="nav-app-title">Engineering BOM Lifecycle</div>',
        '<button type="button" class="nav-home' + (homeActive ? " active" : "") + '" data-workspace="dashboard"' + (homeActive ? ' aria-current="page"' : "") + '>Dashboard</button>',
        '</div>',
        '<div class="nav-tabs" role="tablist">',
        '<button type="button" role="tab" class="' + (activeTab === "apps" ? "active" : "") + '" data-nav-tab="apps" aria-selected="' + (activeTab === "apps") + '">Apps</button>',
        '<button type="button" role="tab" class="' + (activeTab === "recent" ? "active" : "") + '" data-nav-tab="recent" aria-selected="' + (activeTab === "recent") + '">Recent Items</button>',
        '</div>',
        '<div class="nav-list" role="tabpanel">' + (activeTab === "recent" ? renderRecent(currentWorkspace) : renderApps(currentWorkspace)) + '</div>'
      ].join("");
      bind(root);
    }
  };
})(window.DEP = window.DEP || {});
