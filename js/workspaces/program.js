(function (app) {
  var selectedProgramId = null;
  var selectedVariantId = null;
  var activeEditor = null;

  var statusOptions = ["PLANNED", "ACTIVE", "ON_HOLD", "CLOSED"];

  app.router.register("program", {
    render: function () {
      var programs = app.domain.programService.getPrograms();
      var context = app.core.contextService.getContext();
      selectedProgramId = selectedProgramId || context.activeProgramId || (programs[0] && programs[0].id);
      var variants = app.domain.seatVariantService.getSeatVariants(selectedProgramId);
      selectedVariantId = selectedVariantId || context.activeSeatVariantId || (variants[0] && variants[0].id);
      return renderWorkspace(programs, variants, context);
    },
    afterRender: function (container) {
      bindActions(container);
      bindProgramRows(container);
      bindVariantRows(container);
      bindEditors(container);
    }
  });

  function renderWorkspace(programs, variants, context) {
    return [
      app.utils.renderWorkspaceHeader({
        title: "Programme Context",
        purpose: "",
        status: context.activeProgramId && context.activeSeatVariantId ? "Active Context" : "Context Required",
        actions: [
          { id: "new-program", label: "Add Programme", primary: !context.activeProgramId },
          { id: "new-variant", label: "Add Finished-Good Variant", primary: Boolean(context.activeProgramId) && !context.activeSeatVariantId },
          { id: "edit", label: "Edit" },
          { id: "delete", label: "Delete", destructive: true }
        ]
      }),
      '<div class="workspace-body">',
      '<div class="placeholder-panel">',
      renderContextBar(context),
      renderProgramEditor(),
      renderVariantEditor(programs),
      renderProgramsTable(programs),
      renderVariantsTable(variants),
      '</div>',
      '</div>'
    ].join("");
  }

  function renderContextBar(context) {
    var program = app.domain.programService.getProgramById(context.activeProgramId);
    var variant = app.domain.seatVariantService.getSeatVariantById(context.activeSeatVariantId);
    return '<div class="configuration-bar"><span>Programme: <strong>' +
      app.utils.escapeHtml(program ? program.programCode || program.name : "None") + '</strong></span><span>Customer / OEM: <strong>' +
      app.utils.escapeHtml(variant ? variant.customer || variant.brand || program.customer : "") + '</strong></span><span>Seat Type: <strong>' +
      app.utils.escapeHtml(variant ? variant.seatType || variant.seatFamily : "") + '</strong></span><span>Finished-Good Variant: <strong>' +
      app.utils.escapeHtml(variant ? variant.variantCode : "None") + '</strong></span></div>';
  }

  function renderProgramEditor() {
    return [
      '<form class="inline-editor" data-program-editor hidden>',
      '<input type="hidden" data-field="mode" value="create">',
      '<input type="hidden" data-field="id">',
      '<label>Program Code<input type="text" data-field="programCode" required></label>',
      '<label>Program Name<input type="text" data-field="name" required></label>',
      '<label>Customer<input type="text" data-field="customer"></label>',
      '<label>Platform<input type="text" data-field="vehiclePlatform"></label>',
      '<label>Status<select data-field="status">' + renderStatusOptions() + '</select></label>',
      '<button type="submit" class="primary">Save</button><button type="button" data-action="cancel-program">Cancel</button>',
      '</form>'
    ].join("");
  }

  function renderVariantEditor(programs) {
    return [
      '<form class="inline-editor" data-variant-editor hidden>',
      '<input type="hidden" data-field="mode" value="create">',
      '<input type="hidden" data-field="id">',
      '<label>Program<select data-field="programId">' + programs.map(function (program) {
        return '<option value="' + app.utils.escapeHtml(program.id) + '">' + app.utils.escapeHtml(program.name) + '</option>';
      }).join("") + '</select></label>',
      '<label>Variant Code<input type="text" data-field="variantCode" required></label>',
      '<label>Variant Name<input type="text" data-field="variantName" required></label>',
      '<label>Customer / OEM<input type="text" data-field="customer"></label>',
      '<label>Seat Type<input type="text" data-field="seatType"></label>',
      '<label>Side<input type="text" data-field="side"></label>',
      '<label>Grade<input type="text" data-field="grade"></label>',
      '<label>Finished-Good Part Number<input type="text" data-field="finishedGoodPartNumber"></label>',
      '<label>Status<select data-field="status">' + renderStatusOptions() + '</select></label>',
      '<button type="submit" class="primary">Save</button><button type="button" data-action="cancel-variant">Cancel</button>',
      '</form>'
    ].join("");
  }

  function renderStatusOptions(selected) {
    return statusOptions.map(function (status) {
      return '<option value="' + status + '"' + (selected === status ? " selected" : "") + '>' + formatStatus(status) + '</option>';
    }).join("");
  }

  function renderProgramsTable(programs) {
    return [
      '<table class="engineering-table program-table">',
      '<thead><tr><th>Program Code</th><th>Program Name</th><th>Customer</th><th>Platform</th><th>Status</th></tr></thead><tbody>',
      programs.map(function (program) {
        return '<tr data-program-id="' + app.utils.escapeHtml(program.id) + '"' + (program.id === selectedProgramId ? ' class="selected"' : '') + '>' +
          '<td>' + app.utils.escapeHtml(program.programCode || program.id) + '</td>' +
          '<td>' + app.utils.escapeHtml(program.name) + '</td>' +
          '<td>' + app.utils.escapeHtml(program.customer) + '</td>' +
          '<td>' + app.utils.escapeHtml(program.vehiclePlatform) + '</td>' +
          '<td>' + app.utils.escapeHtml(formatStatus(program.status)) + '</td>' +
          '</tr>';
      }).join(""),
      '</tbody></table>'
    ].join("");
  }

  function renderVariantsTable(variants) {
    return [
      '<div class="table-toolbar"><strong>Finished-Good Variants</strong></div>',
      '<table class="engineering-table seat-variant-table">',
      '<thead><tr><th>Variant Code</th><th>Variant Name</th><th>Customer / OEM</th><th>Seat Type</th><th>Side</th><th>Grade</th><th>Status</th></tr></thead><tbody>',
      variants.map(function (variant) {
        return '<tr data-variant-id="' + app.utils.escapeHtml(variant.id) + '"' + (variant.id === selectedVariantId ? ' class="selected"' : '') + '>' +
          '<td>' + app.utils.escapeHtml(variant.variantCode) + '</td>' +
          '<td>' + app.utils.escapeHtml(variant.variantName) + '</td>' +
          '<td>' + app.utils.escapeHtml(variant.customer || variant.brand || "") + '</td>' +
          '<td>' + app.utils.escapeHtml(variant.seatType || variant.seatFamily || "") + '</td>' +
          '<td>' + app.utils.escapeHtml(variant.side) + '</td>' +
          '<td>' + app.utils.escapeHtml(variant.grade) + '</td>' +
          '<td>' + app.utils.escapeHtml(formatStatus(variant.status)) + '</td>' +
          '</tr>';
      }).join(""),
      '</tbody></table>'
    ].join("");
  }

  function bindActions(container) {
    bindAction(container, "new-program", function () {
      activeEditor = "program";
      openProgramEditor(container, null);
    });
    bindAction(container, "new-variant", function () {
      activeEditor = "variant";
      openVariantEditor(container, null);
    });
    bindAction(container, "edit", function () {
      if (selectedVariantId) {
        activeEditor = "variant";
        openVariantEditor(container, app.domain.seatVariantService.getSeatVariantById(selectedVariantId));
        return;
      }
      activeEditor = "program";
      openProgramEditor(container, app.domain.programService.getProgramById(selectedProgramId));
    });
    bindAction(container, "delete", function () {
      runOperation(function () {
        if (selectedVariantId) {
          app.domain.seatVariantService.deleteSeatVariant(selectedVariantId);
          selectedVariantId = null;
        } else if (selectedProgramId) {
          app.domain.programService.deleteProgram(selectedProgramId);
          selectedProgramId = null;
        }
      }, "Deleted successfully");
    });
  }

  function bindProgramRows(container) {
    container.querySelectorAll("[data-program-id]").forEach(function (row) {
      row.onclick = function () {
        selectedProgramId = row.getAttribute("data-program-id");
        selectedVariantId = null;
        runOperation(function () {
          app.domain.programService.setActiveProgram(selectedProgramId);
          app.state.setSelection(toProgramSelection(app.domain.programService.getProgramById(selectedProgramId)));
        });
      };
    });
  }

  function bindVariantRows(container) {
    container.querySelectorAll("[data-variant-id]").forEach(function (row) {
      row.onclick = function () {
        selectedVariantId = row.getAttribute("data-variant-id");
        runOperation(function () {
          app.domain.seatVariantService.setActiveSeatVariant(selectedVariantId);
          app.state.setSelection(toVariantSelection(app.domain.seatVariantService.getSeatVariantById(selectedVariantId)));
        });
      };
    });
  }

  function bindEditors(container) {
    container.querySelector("[data-program-editor]").onsubmit = function (event) {
      event.preventDefault();
      activeEditor = "program";
      saveActiveEditor(container);
    };
    container.querySelector("[data-variant-editor]").onsubmit = function (event) {
      event.preventDefault();
      activeEditor = "variant";
      saveActiveEditor(container);
    };
    bindAction(container, "cancel-program", function () {
      hideEditor(container, "[data-program-editor]");
    });
    bindAction(container, "cancel-variant", function () {
      hideEditor(container, "[data-variant-editor]");
    });
  }

  function saveActiveEditor(container) {
    if (activeEditor === "program") {
      var program = readProgramEditor(container);
      runOperation(function () {
        if (program.mode === "edit") {
          app.domain.programService.updateProgram(program.id, program);
        } else {
          app.domain.programService.createProgram(program);
        }
        selectedProgramId = program.id || app.domain.programService.normalizeProgram(program).id;
        selectedVariantId = null;
        app.domain.programService.setActiveProgram(selectedProgramId);
      }, "Program saved");
      return;
    }
    if (activeEditor === "variant") {
      var variant = readVariantEditor(container);
      runOperation(function () {
        if (variant.mode === "edit") {
          app.domain.seatVariantService.updateSeatVariant(variant.id, variant);
        } else {
          app.domain.seatVariantService.createSeatVariant(variant);
        }
        selectedVariantId = variant.id || app.domain.seatVariantService.normalizeSeatVariant(variant).id;
        app.domain.seatVariantService.setActiveSeatVariant(selectedVariantId);
      }, "Finished-Good Variant saved");
    }
  }

  function openProgramEditor(container, program) {
    hideEditor(container, "[data-variant-editor]");
    var editor = container.querySelector("[data-program-editor]");
    field(editor, "mode").value = program ? "edit" : "create";
    field(editor, "id").value = program ? program.id : "";
    field(editor, "programCode").value = program ? program.programCode : "";
    field(editor, "name").value = program ? program.name : "";
    field(editor, "customer").value = program ? program.customer : "";
    field(editor, "vehiclePlatform").value = program ? program.vehiclePlatform : "";
    field(editor, "status").value = program ? program.status : "PLANNED";
    editor.hidden = false;
  }

  function openVariantEditor(container, variant) {
    hideEditor(container, "[data-program-editor]");
    var editor = container.querySelector("[data-variant-editor]");
    field(editor, "mode").value = variant ? "edit" : "create";
    field(editor, "id").value = variant ? variant.id : "";
    field(editor, "programId").value = variant ? variant.programId : selectedProgramId;
    field(editor, "variantCode").value = variant ? variant.variantCode : "";
    field(editor, "variantName").value = variant ? variant.variantName : "";
    field(editor, "customer").value = variant ? variant.customer || variant.brand || "" : "";
    field(editor, "seatType").value = variant ? variant.seatType || variant.seatFamily || "" : "";
    field(editor, "side").value = variant ? variant.side : "";
    field(editor, "grade").value = variant ? variant.grade : "";
    field(editor, "finishedGoodPartNumber").value = variant ? variant.finishedGoodPartNumber || "" : "";
    field(editor, "status").value = variant ? variant.status : "PLANNED";
    editor.hidden = false;
  }

  function readProgramEditor(container) {
    var editor = container.querySelector("[data-program-editor]");
    return {
      mode: field(editor, "mode").value,
      id: field(editor, "id").value.trim(),
      programCode: field(editor, "programCode").value.trim(),
      name: field(editor, "name").value.trim(),
      customer: field(editor, "customer").value.trim(),
      vehiclePlatform: field(editor, "vehiclePlatform").value.trim(),
      status: field(editor, "status").value
    };
  }

  function readVariantEditor(container) {
    var editor = container.querySelector("[data-variant-editor]");
    return {
      mode: field(editor, "mode").value,
      id: field(editor, "id").value.trim(),
      programId: field(editor, "programId").value,
      variantCode: field(editor, "variantCode").value.trim(),
      variantName: field(editor, "variantName").value.trim(),
      customer: field(editor, "customer").value.trim(),
      seatType: field(editor, "seatType").value.trim(),
      side: field(editor, "side").value.trim(),
      grade: field(editor, "grade").value.trim(),
      finishedGoodPartNumber: field(editor, "finishedGoodPartNumber").value.trim(),
      status: field(editor, "status").value
    };
  }

  function toProgramSelection(program) {
    return {
      type: "Program",
      id: program.id,
      name: program.name,
      status: formatStatus(program.status),
      owner: "Program Manager",
      remarks: program.programCode
    };
  }

  function toVariantSelection(variant) {
    return {
      type: "Finished-Good Variant",
      id: variant.id,
      name: variant.variantName,
      status: formatStatus(variant.status),
      owner: "Engineering",
      remarks: variant.variantCode
    };
  }

  function runOperation(operation, successMessage) {
    try {
      operation();
      if (successMessage && app.services && app.services.notificationService) {
        app.services.notificationService.notify(successMessage, "success");
      }
      app.router.render();
    } catch (error) {
      if (app.services && app.services.notificationService) {
        app.services.notificationService.notify(error.message, "error");
      }
    }
  }

  function hideEditor(container, selector) {
    var editor = container.querySelector(selector);
    if (editor) editor.hidden = true;
  }

  function bindAction(container, actionId, handler) {
    var button = container.querySelector('[data-action="' + actionId + '"]');
    if (button) button.onclick = handler;
  }

  function field(editor, name) {
    return editor.querySelector('[data-field="' + name + '"]');
  }

  function formatStatus(status) {
    return String(status || "").toLowerCase().replace(/(^|_)([a-z])/g, function (_, prefix, character) {
      return (prefix ? " " : "") + character.toUpperCase();
    });
  }
})(window.DEP = window.DEP || {});
