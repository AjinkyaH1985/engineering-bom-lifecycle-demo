(function (app) {
  app.router.register("foam", app.utils.createEngineeringWorkspace({
    moduleKey: "foam",
    title: "Foam",
    subtitle: "Manage foam engineering BOM",
    owner: "Foam Engineer",
    allowEditing: true,
    actions: [
      { id: "add", label: "Add Part", primary: true },
      { id: "add-child", label: "Add Child" },
      { id: "edit", label: "Edit" },
      { id: "remove", label: "Remove" },
      { id: "complete", label: "Complete eBOM" },
      { id: "expand", label: "Expand All" },
      { id: "collapse", label: "Collapse All" }
    ]
  }));
})(window.DEP = window.DEP || {});
