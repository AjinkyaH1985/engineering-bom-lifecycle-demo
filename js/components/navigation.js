(function (app) {
  app.components = app.components || {};

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

  app.components.navigation = {
    groups: groups,
    render: function () {
      var currentWorkspace = app.state.getCurrentWorkspace();
      app.utils.byId("app-navigation").innerHTML = groups.map(function (group) {
        return '<div class="nav-group"><div class="nav-group-title">' + app.utils.escapeHtml(group.title) +
          '</div>' + group.items.map(function (item) {
            var active = item.id === currentWorkspace ? " active" : "";
            return '<button type="button" class="nav-item' + active + '" data-workspace="' + item.id +
              '"' + (active ? ' aria-current="page"' : "") +
              ' title="' + app.utils.escapeHtml(item.hint || item.label) + '">' +
              '<span class="nav-label">' + app.utils.escapeHtml(item.label) + '</span></button>';
          }).join("") + '</div>';
      }).join("");

      app.utils.byId("app-navigation").querySelectorAll("[data-workspace]").forEach(function (button) {
        button.onclick = function () {
          app.router.navigate(button.getAttribute("data-workspace"));
        };
      });
    }
  };
})(window.DEP = window.DEP || {});
