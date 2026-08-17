(function (app) {
  app.router.register("armrest", app.utils.createEngineeringWorkspace({
    moduleKey: "armrest",
    title: "Armrest",
    subtitle: "Manage armrest engineering BOM",
    owner: "Armrest Engineer",
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
