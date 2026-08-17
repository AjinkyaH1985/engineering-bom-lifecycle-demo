(function (app) {
  var filters = { search: "", categoryId: "", status: "" };
  var page = 1;
  var pageSize = 20;

  app.router.register("commodity-management", {
    render: function () {
      var service = app.domain.commodityMasterService;
      var rows = service.listCommodities(filters);
      var categories = service.listCategories();
      var pageCount = Math.max(1, Math.ceil(rows.length / pageSize));
      page = Math.min(page, pageCount);
      var canEdit = service.canManage("commodities");
      return [
        app.utils.renderWorkspaceHeader({
          title: "Commodity Master",
          purpose: "",
          showContext: false,
          actions: canEdit ? [{ id: "add-commodity", label: "Add Commodity", primary: true }] : []
        }),
        '<div class="workspace-body"><section class="placeholder-panel commodity-master" data-commodity-master>',
        renderFilters(categories),
        renderTable(rows.slice((page - 1) * pageSize, page * pageSize), canEdit),
        renderPagination(pageCount, rows.length),
        '</section></div>'
      ].join("");
    },
    afterRender: bindWorkspace
  });

  function renderFilters(categories) {
    return [
      '<div class="commodity-master-toolbar">',
      '<label class="master-search"><span>Search</span><input type="search" data-commodity-search value="' + escape(filters.search) + '" placeholder="Code, name or description"></label>',
      '<label><span>Category</span><select data-commodity-category-filter><option value="">All Categories</option>',
      categories.map(function (category) { return option(category.id, category.name, filters.categoryId); }).join(""),
      '</select></label>',
      '<label><span>Status</span><select data-commodity-status-filter><option value="">All Statuses</option>' + option("ACTIVE", "Active", filters.status) + option("INACTIVE", "Inactive", filters.status) + '</select></label>',
      '<button type="button" data-action="clear-commodity-filters">Clear Filters</button>',
      '</div>'
    ].join("");
  }

  function renderTable(rows, canEdit) {
    var body;
    if (!rows.length) {
      var filtered = filters.search || filters.categoryId || filters.status;
      body = '<tr><td colspan="10">' + app.utils.renderEmptyState(
        filtered ? "No commodities match the selected search or filters." : "No commodities are available.",
        filtered ? "Clear or change the filters." : (canEdit ? "Select Add Commodity to create the first commodity." : "")
      ) + '</td></tr>';
    } else {
      body = rows.map(function (commodity) {
        return '<tr data-commodity-id="' + escape(commodity.id) + '">' +
          cell(commodity.code) + cell(commodity.name) + cell(commodity.categoryName) + cell(commodity.description) +
          cell(commodity.unitOfMeasure || "-") + cell(commodity.displaySequence == null ? "-" : commodity.displaySequence) +
          '<td>' + app.utils.renderStatusBadge(commodity.status) + '</td>' + cell(commodity.lastUpdatedBy || "-") +
          cell(formatDate(commodity.lastUpdatedDate)) +
          '<td class="master-row-actions"><button type="button" data-action="view-commodity">View</button>' +
          (canEdit ? '<button type="button" data-action="edit-commodity">Edit</button><button type="button" data-action="toggle-commodity">' + (commodity.status === "ACTIVE" ? "Deactivate" : "Activate") + '</button>' : "") +
          '</td></tr>';
      }).join("");
    }
    return '<div class="master-grid-scroll"><table class="engineering-table commodity-master-table"><thead><tr>' +
      '<th>Commodity Code</th><th>Commodity Name</th><th>Commodity Category</th><th>Description</th><th>Unit of Measure</th>' +
      '<th>Display Sequence</th><th>Status</th><th>Last Updated By</th><th>Last Updated Date</th><th>Actions</th>' +
      '</tr></thead><tbody>' + body + '</tbody></table></div>';
  }

  function renderPagination(pageCount, total) {
    if (total <= pageSize) return '<div class="commodity-pagination"><span>' + total + ' commodities</span></div>';
    return '<div class="commodity-pagination"><button type="button" data-action="previous-commodity-page"' + (page === 1 ? " disabled" : "") + '>Previous</button>' +
      '<span>Page ' + page + ' of ' + pageCount + ' · ' + total + ' commodities</span>' +
      '<button type="button" data-action="next-commodity-page"' + (page === pageCount ? " disabled" : "") + '>Next</button></div>';
  }

  function bindWorkspace(container) {
    var search = container.querySelector("[data-commodity-search]");
    var timer;
    if (search) search.oninput = function () {
      clearTimeout(timer);
      timer = setTimeout(function () { filters.search = search.value; page = 1; app.router.render(); }, 180);
    };
    bindFilter(container, "[data-commodity-category-filter]", "categoryId");
    bindFilter(container, "[data-commodity-status-filter]", "status");
    bindAction(container, "clear-commodity-filters", function () { filters = { search: "", categoryId: "", status: "" }; page = 1; app.router.render(); });
    bindAction(container, "previous-commodity-page", function () { page = Math.max(1, page - 1); app.router.render(); });
    bindAction(container, "next-commodity-page", function () { page += 1; app.router.render(); });
    bindAction(container, "add-commodity", function () { openCommodityForm(null); });
    container.querySelectorAll("[data-commodity-id]").forEach(function (row) {
      var id = row.getAttribute("data-commodity-id");
      var view = row.querySelector('[data-action="view-commodity"]');
      var edit = row.querySelector('[data-action="edit-commodity"]');
      var toggle = row.querySelector('[data-action="toggle-commodity"]');
      if (view) view.onclick = function () { openCommodityDetails(id); };
      if (edit) edit.onclick = function () { openCommodityForm(app.domain.commodityMasterService.getCommodity(id)); };
      if (toggle) toggle.onclick = function () { confirmStatusChange(id); };
    });
  }

  function openCommodityDetails(id) {
    var commodity = app.domain.commodityMasterService.getCommodity(id);
    if (!commodity) return;
    app.components.modal.open("Commodity Details", '<dl class="master-detail-list">' +
      detail("Commodity Code", commodity.code) + detail("Commodity Name", commodity.name) + detail("Commodity Category", commodity.categoryName) +
      detail("Description", commodity.description || "-") + detail("Unit of Measure", commodity.unitOfMeasure || "-") +
      detail("Display Sequence", commodity.displaySequence == null ? "-" : commodity.displaySequence) + detail("Status", label(commodity.status)) +
      detail("Created By", commodity.createdBy) + detail("Created Date", formatDate(commodity.createdAt)) +
      detail("Last Updated By", commodity.lastUpdatedBy) + detail("Last Updated Date", formatDate(commodity.lastUpdatedDate)) + '</dl>');
  }

  function openCommodityForm(commodity) {
    var editing = Boolean(commodity);
    var categories = app.domain.commodityMasterService.listCategories().filter(function (category) {
      return category.status === "ACTIVE" || editing && category.id === commodity.categoryId;
    });
    var values = commodity || { status: "ACTIVE" };
    var body = '<form class="master-form" data-commodity-form>' +
      field("Commodity Code", "code", values.code, true) + field("Commodity Name", "name", values.name, true) +
      '<label>Commodity Category<select data-field="categoryId" required><option value="">Select Category</option>' + categories.map(function (category) { return option(category.id, category.name + (category.status === "INACTIVE" ? " (Inactive)" : ""), values.categoryId); }).join("") + '</select></label>' +
      field("Description", "description", values.description) +
      '<label>Unit of Measure<select data-field="unitOfMeasure"><option value="">Not specified</option>' + (app.data.referenceData.unitsOfMeasure || []).map(function (unit) { return option(unit, unit, values.unitOfMeasure); }).join("") + '</select></label>' +
      field("Display Sequence", "displaySequence", values.displaySequence, false, "number") +
      '<label>Status<select data-field="status">' + option("ACTIVE", "Active", values.status) + option("INACTIVE", "Inactive", values.status) + '</select></label>' +
      '<div class="form-validation" data-form-error aria-live="polite"></div>' +
      '<div class="form-actions"><button type="submit" class="primary">' + (editing ? "Save Commodity" : "Add Commodity") + '</button><button type="button" data-cancel-form>Cancel</button></div></form>';
    app.components.modal.open(editing ? "Edit Commodity" : "Add Commodity", body);
    var root = app.utils.byId("modal-root");
    var form = root.querySelector("[data-commodity-form]");
    root.querySelector("[data-cancel-form]").onclick = app.components.modal.close;
    form.onsubmit = function (event) {
      event.preventDefault();
      var button = form.querySelector('[type="submit"]');
      setBusy(button, true);
      try {
        var input = readForm(form);
        if (editing) app.domain.commodityMasterService.updateCommodity(commodity.id, input);
        else app.domain.commodityMasterService.createCommodity(input);
        app.components.modal.close();
        app.services.notificationService.notify(editing ? "Commodity updated." : "Commodity created.", "success");
        app.router.render();
      } catch (error) {
        form.querySelector("[data-form-error]").textContent = businessMessage(error);
        setBusy(button, false);
      }
    };
  }

  function confirmStatusChange(id) {
    var commodity = app.domain.commodityMasterService.getCommodity(id);
    var activating = commodity.status !== "ACTIVE";
    var usage = app.domain.commodityMasterService.getCommodityUsage(id);
    var warning = !activating && usage.inUse
      ? '<p class="validation-summary compact">This Commodity is currently used by ' + usage.mappingCount + ' Finished-Good Variant mapping(s). Existing mappings and history will be preserved, but it will not be available for new mappings.</p>'
      : "";
    var body = warning + '<p>' + (activating ? "Activate" : "Deactivate") + ' <strong>' + escape(commodity.code) + '</strong>?</p>' +
      '<div class="form-actions"><button type="button" class="primary" data-confirm-status>' + (activating ? "Activate" : "Deactivate") + '</button><button type="button" data-cancel-status>Cancel</button></div>';
    app.components.modal.open((activating ? "Activate" : "Deactivate") + " Commodity", body);
    var root = app.utils.byId("modal-root");
    root.querySelector("[data-cancel-status]").onclick = app.components.modal.close;
    root.querySelector("[data-confirm-status]").onclick = function () {
      try {
        app.domain.commodityMasterService.setCommodityStatus(id, activating ? "ACTIVE" : "INACTIVE");
        app.components.modal.close();
        app.services.notificationService.notify("Commodity " + (activating ? "activated." : "deactivated."), "success");
        app.router.render();
      } catch (error) { app.services.notificationService.notify(businessMessage(error), "error"); }
    };
  }

  function bindFilter(container, selector, field) {
    var control = container.querySelector(selector);
    if (control) control.onchange = function () { filters[field] = control.value; page = 1; app.router.render(); };
  }

  function bindAction(container, action, handler) {
    var button = container.querySelector('[data-action="' + action + '"]');
    if (button) button.onclick = handler;
  }

  function field(title, name, value, required, type) {
    return '<label>' + escape(title) + '<input type="' + (type || "text") + '" data-field="' + name + '" value="' + escape(value == null ? "" : value) + '"' + (required ? " required" : "") + '></label>';
  }

  function readForm(form) {
    var values = {};
    form.querySelectorAll("[data-field]").forEach(function (field) { values[field.getAttribute("data-field")] = field.value; });
    return values;
  }

  function setBusy(button, busy) {
    if (!button.dataset.label) button.dataset.label = button.textContent;
    button.disabled = busy;
    button.textContent = busy ? "Saving..." : button.dataset.label;
  }
  function cell(value) { return '<td>' + escape(value == null ? "" : value) + '</td>'; }
  function detail(term, value) { return '<div><dt>' + escape(term) + '</dt><dd>' + escape(value == null ? "" : value) + '</dd></div>'; }
  function option(value, text, selected) { return '<option value="' + escape(value) + '"' + (value === selected ? " selected" : "") + '>' + escape(text) + '</option>'; }
  function label(value) { return String(value || "").toLowerCase().replace(/(^|_)([a-z])/g, function (_, gap, letter) { return (gap ? " " : "") + letter.toUpperCase(); }); }
  function formatDate(value) { if (!value) return "-"; var date = new Date(value); return Number.isNaN(date.getTime()) ? value : date.toLocaleString("en-GB"); }
  function businessMessage(error) { var issues = error && error.validationErrors || []; return issues.length ? issues.map(function (issue) { return issue.message; }).join(" ") : error && error.message || "The operation could not be completed."; }
  function escape(value) { return app.utils.escapeHtml(String(value == null ? "" : value)); }
})(window.DEP = window.DEP || {});
