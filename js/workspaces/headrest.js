(function (app) {
  app.router.register("headrest", app.utils.createEngineeringWorkspace({
    moduleKey: "headrest",
    title: "Head Rest",
    subtitle: "Manage head rest engineering BOM",
    owner: "Head Rest Engineer",
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
