(function (app) {
  var selectedIds = [];
  var savedIds = [];
  var contextKey = "";
  var filters = { search: "", categoryId: "" };
  var dirty = false;

  app.router.register("commodity-mapping", {
    render: function () {
      var data = app.domain.commodityMasterService.getMappingWorkspaceData();
      var nextKey = data.identity.finishedGoodVariantId;
      if (contextKey !== nextKey) {
        contextKey = nextKey;
        selectedIds = data.assignedCommodityIds.slice();
        savedIds = data.assignedCommodityIds.slice();
        filters = { search: "", categoryId: "" };
        dirty = false;
      }
      configureGuard();
      return renderWorkspace(data);
    },
    afterRender: bindWorkspace,
    beforeLeave: function () {
      app.router.clearTransitionGuard();
      dirty = false;
    }
  });

  function renderWorkspace(data) {
    var validContext = Boolean(data.variant && data.program);
    var actions = [];
    if (data.canEdit && validContext && dirty) {
      actions.push({ id: "save-commodity-mapping", label: "Save Commodity Mapping", primary: true });
      actions.push({ id: "cancel-commodity-mapping", label: "Cancel" });
    }
    var rows = filterRows(data.commodities);
    return [
      app.utils.renderWorkspaceHeader({ title: "Commodity Mapping", purpose: "Finished-Good Variant Commodity Configuration", actions: actions }),
      '<div class="workspace-body"><section class="placeholder-panel commodity-mapping" data-commodity-mapping data-dirty="' + dirty + '">',
      validContext ? renderContent(data, rows) : app.utils.renderEmptyState("Select a Programme and Finished-Good Variant.", "Commodity assignments are maintained against one Finished-Good Variant."),
      '</section></div>'
    ].join("");
  }

  function renderContent(data, rows) {
    var assignedCount = selectedIds.length;
    return [
      '<div class="mapping-summary"><strong>' + assignedCount + '</strong><span>assigned commodities</span><small>' + escape(data.variant.variantCode || data.variant.variantName || data.variant.id) + '</small></div>',
      '<div class="commodity-master-toolbar">',
      '<label class="master-search"><span>Search Available Commodities</span><input type="search" data-mapping-search value="' + escape(filters.search) + '" placeholder="Commodity code or name"></label>',
      '<label><span>Category</span><select data-mapping-category><option value="">All Categories</option>' + data.categories.map(function (category) { return option(category.id, category.name, filters.categoryId); }).join("") + '</select></label>',
      '<button type="button" data-action="clear-mapping-filters">Clear Filters</button>',
      '</div>',
      '<div class="master-grid-scroll"><table class="engineering-table commodity-mapping-table"><thead><tr><th>Assigned</th><th>Commodity Code</th><th>Commodity Name</th><th>Category</th><th>Description</th><th>Status</th></tr></thead><tbody>',
      rows.length ? rows.map(function (commodity) {
        var checked = selectedIds.indexOf(commodity.id) !== -1;
        var disabled = !data.canEdit || (!commodity.selectable && !checked);
        return '<tr' + (checked ? ' class="selected"' : '') + '><td><input type="checkbox" data-map-commodity="' + escape(commodity.id) + '"' + (checked ? " checked" : "") + (disabled ? " disabled" : "") + ' aria-label="Assign ' + escape(commodity.name) + '"></td>' +
          cell(commodity.code) + cell(commodity.name) + cell(commodity.categoryName) + cell(commodity.description) +
          '<td>' + app.utils.renderStatusBadge(commodity.status) + (commodity.status === "INACTIVE" && checked ? '<small class="historical-label">Existing mapping retained</small>' : "") + '</td></tr>';
      }).join("") : '<tr><td colspan="6">' + app.utils.renderEmptyState("No commodities match the selected search or filters.", "Clear or change the filters.") + '</td></tr>',
      '</tbody></table></div>',
      data.canEdit ? "" : '<p class="read-only-message">You have read-only access to Commodity Mapping.</p>'
    ].join("");
  }

  function filterRows(commodities) {
    var search = filters.search.trim().toLowerCase();
    return commodities.filter(function (commodity) {
      if (filters.categoryId && commodity.categoryId !== filters.categoryId) return false;
      if (search && [commodity.code, commodity.name].join(" ").toLowerCase().indexOf(search) === -1) return false;
      return true;
    });
  }

  function bindWorkspace(container) {
    var search = container.querySelector("[data-mapping-search]");
    var category = container.querySelector("[data-mapping-category]");
    var timer;
    if (search) search.oninput = function () { clearTimeout(timer); timer = setTimeout(function () { filters.search = search.value; app.router.render(); }, 180); };
    if (category) category.onchange = function () { filters.categoryId = category.value; app.router.render(); };
    container.querySelectorAll("[data-map-commodity]").forEach(function (checkbox) {
      checkbox.onchange = function () {
        var id = checkbox.getAttribute("data-map-commodity");
        if (checkbox.checked && selectedIds.indexOf(id) === -1) selectedIds.push(id);
        if (!checkbox.checked) selectedIds = selectedIds.filter(function (item) { return item !== id; });
        dirty = !sameSet(selectedIds, savedIds);
        app.router.render();
      };
    });
    bindAction(container, "clear-mapping-filters", function () { filters = { search: "", categoryId: "" }; app.router.render(); });
    bindAction(container, "save-commodity-mapping", saveMappings);
    bindAction(container, "cancel-commodity-mapping", function () { selectedIds = savedIds.slice(); dirty = false; app.router.render(); });
  }

  function saveMappings(afterSave) {
    try {
      app.domain.commodityMasterService.saveCommodityMappings(contextKey, selectedIds);
      savedIds = selectedIds.slice();
      dirty = false;
      app.router.clearTransitionGuard();
      app.services.notificationService.notify("Commodity Mapping saved.", "success");
      if (typeof afterSave === "function") afterSave();
      else app.router.render();
    } catch (error) {
      app.services.notificationService.notify(businessMessage(error), "error");
    }
  }

  function configureGuard() {
    if (!dirty) {
      app.router.clearTransitionGuard();
      return;
    }
    app.router.setTransitionGuard(function (transition) {
      var body = '<p>Commodity Mapping has unsaved changes.</p><div class="form-actions">' +
        '<button type="button" class="primary" data-mapping-save-continue>Save and Continue</button>' +
        '<button type="button" data-mapping-discard>Discard Changes</button><button type="button" data-mapping-stay>Cancel</button></div>';
      app.components.modal.open("Unsaved Commodity Mapping", body);
      var root = app.utils.byId("modal-root");
      root.querySelector("[data-mapping-save-continue]").onclick = function () { saveMappings(function () { app.components.modal.close(); transition.proceed(); }); };
      root.querySelector("[data-mapping-discard]").onclick = function () { dirty = false; app.router.clearTransitionGuard(); app.components.modal.close(); transition.proceed(); };
      root.querySelector("[data-mapping-stay]").onclick = function () { app.components.modal.close(); if (transition.cancel) transition.cancel(); };
      return false;
    });
  }

  function sameSet(left, right) {
    if (left.length !== right.length) return false;
    var lookup = {};
    left.forEach(function (id) { lookup[id] = true; });
    return right.every(function (id) { return lookup[id]; });
  }

  function bindAction(container, action, handler) { var button = container.querySelector('[data-action="' + action + '"]'); if (button) button.onclick = handler; }
  function option(value, text, selected) { return '<option value="' + escape(value) + '"' + (value === selected ? " selected" : "") + '>' + escape(text) + '</option>'; }
  function cell(value) { return '<td>' + escape(value == null ? "" : value) + '</td>'; }
  function businessMessage(error) { var issues = error && error.validationErrors || []; return issues.length ? issues.map(function (issue) { return issue.message; }).join(" ") : error && error.message || "Commodity Mapping could not be saved."; }
  function escape(value) { return app.utils.escapeHtml(String(value == null ? "" : value)); }
})(window.DEP = window.DEP || {});
