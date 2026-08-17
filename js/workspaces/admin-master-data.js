(function (app) {
  var activeSection = "engineering-modules";

  app.router.register("admin-master-data", {
    render: function () {
      var data = app.domain.adminMasterDataService.getMasterData();
      return renderWorkspace(data);
    },
    afterRender: function (container) {
      bindSections(container);
      bindModuleSaves(container);
      bindSupplierSaves(container);
      bindCategorySaves(container);
      bindVisualAssetSave(container);
      bindCreateForms(container);
    }
  });

  function renderWorkspace(data) {
    return [
      app.utils.renderWorkspaceHeader({
        title: "Admin Master Data",
        purpose: "",
        showContext: false,
        status: "Configured",
        statusTitle: "Master data used by Programme, Feature Matrix, Engineering eBOM, Complete Seat, and Commercial Assessment."
      }),
      '<div class="workspace-body">',
      '<div class="placeholder-panel admin-master-panel">',
      renderSectionTabs(),
      activeSection === "engineering-modules" ? renderEngineeringModules(data.engineeringModules) : "",
      activeSection === "suppliers" ? renderSuppliers(data.suppliers) : "",
      activeSection === "commodity-categories" ? renderCommodityCategories(app.domain.commodityMasterService.listCategories()) : "",
      activeSection === "visual-assets" ? renderVisualAssets(data.visualAssets) : "",
      '</div>',
      '</div>'
    ].join("");
  }

  function renderSectionTabs() {
    var tabs = [
      ["engineering-modules", "Engineering Disciplines"],
      ["suppliers", "Suppliers"],
      ["commodity-categories", "Commodity Categories"],
      ["visual-assets", "Visual Assets"]
    ];
    return '<div class="admin-tabs">' + tabs.map(function (tab) {
      return '<button type="button" data-admin-section="' + tab[0] + '"' + (activeSection === tab[0] ? ' class="active"' : "") + '>' +
        app.utils.escapeHtml(tab[1]) + '</button>';
    }).join("") + '</div>';
  }

  function renderEngineeringModules(modules) {
    return [
      '<div class="admin-section-heading"><strong>Engineering Disciplines</strong><span>Configure required, optional, and feature-associated eBOM disciplines.</span></div>',
      '<table class="engineering-table admin-master-table"><thead><tr>',
      '<th>Code</th><th>Name</th><th>Required</th><th>Associated Feature Code</th><th>Applicable Seat Types</th><th>Action</th>',
      '</tr></thead><tbody>',
      modules.map(function (module) {
        return '<tr data-admin-module="' + app.utils.escapeHtml(module.id) + '">' +
          readOnlyCell(module.code) +
          inputCell("module-name", module.name || module.label || "") +
          '<td><input type="checkbox" data-admin-field="requiredByDefault"' + (module.requiredByDefault ? " checked" : "") + '></td>' +
          inputCell("requiredFeatureCode", module.requiredFeatureCode || module.featureCode || "") +
          inputCell("applicableSeatTypes", (module.applicableSeatTypes || []).join(", ")) +
          '<td><button type="button" data-save-module>Save</button></td>' +
          '</tr>';
      }).join(""),
      '</tbody></table>'
    ].join("");
  }

  function renderSuppliers(suppliers) {
    return [
      '<div class="admin-section-heading"><strong>Suppliers</strong><span>Commercial Assessment supplier master data.</span></div>',
      renderSupplierForm(),
      '<table class="engineering-table admin-master-table"><thead><tr>',
      '<th>Supplier Code</th><th>Supplier Name</th><th>Country</th><th>Status</th><th>Action</th>',
      '</tr></thead><tbody>',
      suppliers.map(function (supplier) {
        return '<tr data-admin-supplier="' + app.utils.escapeHtml(supplier.id) + '">' +
          inputCell("supplierCode", supplier.supplierCode || supplier.code || "") +
          inputCell("name", supplier.name || "") +
          inputCell("country", supplier.country || "") +
          inputCell("status", supplier.status || "APPROVED") +
          '<td><button type="button" data-save-supplier>Save</button></td>' +
          '</tr>';
      }).join(""),
      '</tbody></table>'
    ].join("");
  }

  function renderSupplierForm() {
    return [
      '<form class="inline-editor admin-create-form" data-create-supplier>',
      '<label>Supplier Code<input type="text" data-field="supplierCode" required></label>',
      '<label>Supplier Name<input type="text" data-field="name" required></label>',
      '<label>Country<input type="text" data-field="country" value="IN"></label>',
      '<label>Status<input type="text" data-field="status" value="APPROVED"></label>',
      '<button type="submit" class="primary">Add Supplier</button>',
      '</form>'
    ].join("");
  }

  function renderCommodities(commodities) {
    return [
      '<div class="admin-section-heading"><strong>Commodities</strong><span>Commodity labels used by eBOMs and Commercial Assessment roll-ups.</span></div>',
      renderCommodityForm(),
      '<table class="engineering-table admin-master-table"><thead><tr>',
      '<th>Commodity Code</th><th>Commodity Name</th><th>Action</th>',
      '</tr></thead><tbody>',
      commodities.map(function (commodity) {
        return '<tr data-admin-commodity="' + app.utils.escapeHtml(commodity.id) + '">' +
          inputCell("code", commodity.code || "") +
          inputCell("name", commodity.name || "") +
          '<td><button type="button" data-save-commodity>Save</button></td>' +
          '</tr>';
      }).join(""),
      '</tbody></table>'
    ].join("");
  }

  function renderCommodityForm() {
    return [
      '<form class="inline-editor admin-create-form" data-create-commodity>',
      '<label>Commodity Code<input type="text" data-field="code" required></label>',
      '<label>Commodity Name<input type="text" data-field="name" required></label>',
      '<button type="submit" class="primary">Add Commodity</button>',
      '</form>'
    ].join("");
  }

  function renderCommodityCategories(categories) {
    var canManage = app.domain.commodityMasterService.canManage("commodityCategories");
    return [
      '<div class="admin-section-heading"><strong>Commodity Categories</strong><span>Categories available to the independent Commodity Master.</span></div>',
      canManage ? renderCategoryForm() : '<p class="read-only-message">You have read-only access to Commodity Categories.</p>',
      '<table class="engineering-table admin-master-table"><thead><tr>',
      '<th>Category Name</th><th>Description</th><th>Display Sequence</th><th>Status</th><th>Action</th>',
      '</tr></thead><tbody>',
      categories.map(function (category) {
        return '<tr data-admin-category="' + app.utils.escapeHtml(category.id) + '">' +
          inputCell("name", category.name || "", !canManage) + inputCell("description", category.description || "", !canManage) +
          inputCell("displaySequence", category.displaySequence == null ? "" : category.displaySequence, !canManage, "number") +
          '<td>' + app.utils.renderStatusBadge(category.status) + '</td><td>' + (canManage ? '<button type="button" data-save-category>Save</button><button type="button" data-toggle-category>' + (category.status === "ACTIVE" ? "Deactivate" : "Activate") + '</button>' : "View only") + '</td></tr>';
      }).join(""),
      '</tbody></table>'
    ].join("");
  }

  function renderCategoryForm() {
    return '<form class="inline-editor admin-create-form" data-create-category>' +
      '<label>Category Name<input type="text" data-field="name" required></label>' +
      '<label>Description<input type="text" data-field="description"></label>' +
      '<label>Display Sequence<input type="number" data-field="displaySequence"></label>' +
      '<button type="submit" class="primary">Add Category</button></form>';
  }

  function renderVisualAssets(visualAssets) {
    visualAssets = visualAssets || {};
    return [
      '<div class="admin-section-heading"><strong>Visual Assets</strong><span>Maintain lightweight image references used by the portfolio demonstration. Store paths only, not image binary data.</span></div>',
      '<table class="engineering-table admin-reference-table"><thead><tr><th>Asset</th><th>Image Reference / Path</th><th>Preview</th><th>Action</th></tr></thead><tbody>',
      '<tr data-admin-visual-assets>',
      '<td>Complete Seat JIT</td>',
      inputCell("completeSeatImageReference", visualAssets.completeSeatImageReference || ""),
      '<td>' + (visualAssets.completeSeatImageReference
        ? '<img class="admin-asset-preview" src="' + app.utils.escapeHtml(visualAssets.completeSeatImageReference) + '" alt="Complete Seat preview">'
        : '<span>Provided by the imported workbook</span>') + '</td>',
      '<td><button type="button" data-save-visual-assets>Save</button></td>',
      '</tr>',
      '</tbody></table>'
    ].join("");
  }

  function bindSections(container) {
    container.querySelectorAll("[data-admin-section]").forEach(function (button) {
      button.onclick = function () {
        activeSection = button.getAttribute("data-admin-section");
        app.router.render();
      };
    });
  }

  function bindModuleSaves(container) {
    container.querySelectorAll("[data-save-module]").forEach(function (button) {
      button.onclick = function () {
        var row = button.closest("[data-admin-module]");
        runOperation(function () {
          app.domain.adminMasterDataService.updateEngineeringModule(row.getAttribute("data-admin-module"), {
            name: readField(row, "module-name"),
            requiredByDefault: Boolean(row.querySelector('[data-admin-field="requiredByDefault"]').checked),
            requiredFeatureCode: readField(row, "requiredFeatureCode"),
            featureCode: readField(row, "requiredFeatureCode"),
            applicableSeatTypes: readField(row, "applicableSeatTypes")
          });
        }, "Engineering discipline saved");
      };
    });
  }

  function bindSupplierSaves(container) {
    container.querySelectorAll("[data-save-supplier]").forEach(function (button) {
      button.onclick = function () {
        var row = button.closest("[data-admin-supplier]");
        runOperation(function () {
          app.domain.adminMasterDataService.updateSupplier(row.getAttribute("data-admin-supplier"), {
            supplierCode: readField(row, "supplierCode"),
            name: readField(row, "name"),
            country: readField(row, "country"),
            status: readField(row, "status")
          });
        }, "Supplier saved");
      };
    });
  }

  function bindCategorySaves(container) {
    container.querySelectorAll("[data-save-category]").forEach(function (button) {
      button.onclick = function () {
        var row = button.closest("[data-admin-category]");
        runOperation(function () {
          app.domain.commodityMasterService.updateCategory(row.getAttribute("data-admin-category"), {
            name: readField(row, "name"),
            description: readField(row, "description"),
            displaySequence: readField(row, "displaySequence")
          });
        }, "Commodity Category saved");
      };
    });
    container.querySelectorAll("[data-toggle-category]").forEach(function (button) {
      button.onclick = function () {
        var row = button.closest("[data-admin-category]");
        var category = app.domain.commodityMasterService.listCategories().find(function (item) { return item.id === row.getAttribute("data-admin-category"); });
        runOperation(function () {
          app.domain.commodityMasterService.setCategoryStatus(category.id, category.status === "ACTIVE" ? "INACTIVE" : "ACTIVE");
        }, category.status === "ACTIVE" ? "Commodity Category deactivated" : "Commodity Category activated");
      };
    });
  }

  function bindVisualAssetSave(container) {
    var button = container.querySelector("[data-save-visual-assets]");
    if (!button) return;
    button.onclick = function () {
      var row = button.closest("[data-admin-visual-assets]");
      runOperation(function () {
        app.domain.adminMasterDataService.updateVisualAssets({
          completeSeatImageReference: readField(row, "completeSeatImageReference")
        });
      }, "Visual asset saved");
    };
  }

  function bindCreateForms(container) {
    var supplierForm = container.querySelector("[data-create-supplier]");
    if (supplierForm) {
      supplierForm.onsubmit = function (event) {
        event.preventDefault();
        runOperation(function () {
          app.domain.adminMasterDataService.createSupplier(readForm(supplierForm));
        }, "Supplier added");
      };
    }
    var categoryForm = container.querySelector("[data-create-category]");
    if (categoryForm) {
      categoryForm.onsubmit = function (event) {
        event.preventDefault();
        runOperation(function () {
          app.domain.commodityMasterService.createCategory(readForm(categoryForm));
        }, "Commodity Category added");
      };
    }
  }

  function inputCell(fieldName, value, disabled, type) {
    return '<td><input type="' + (type || "text") + '" data-admin-field="' + app.utils.escapeHtml(fieldName) + '" value="' + app.utils.escapeHtml(value == null ? "" : value) + '"' + (disabled ? " disabled" : "") + '></td>';
  }

  function readOnlyCell(value) {
    return '<td class="read-only">' + app.utils.escapeHtml(value || "") + '</td>';
  }

  function readField(row, fieldName) {
    var field = row.querySelector('[data-admin-field="' + fieldName + '"]');
    return field ? field.value : "";
  }

  function readForm(form) {
    var values = {};
    form.querySelectorAll("[data-field]").forEach(function (field) {
      values[field.getAttribute("data-field")] = field.value;
    });
    return values;
  }

  function runOperation(operation, successMessage) {
    try {
      operation();
      app.services.notificationService.notify(successMessage, "success");
      app.router.render();
    } catch (error) {
      var detail = error && error.errors && error.errors[0] && error.errors[0].message;
      app.services.notificationService.notify(detail || error.message || "Master data update failed", "error");
    }
  }
})(window.DEP = window.DEP || {});
