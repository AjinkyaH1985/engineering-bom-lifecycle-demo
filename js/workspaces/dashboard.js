(function (app) {
  var expanded = null;
  var treeView = "structure";
  var openFields = {};
  var treeNodes = [];
  var activeHit = -1;

  var GUIDE_STEPS = [
    { target: "program", title: "Programme Context", text: "Pick a variant, or create your own programme and variant." },
    { target: "feature-matrix", title: "Feature Matrix", text: "Switch features on or off for the active variant." },
    { target: "structure", title: "Engineering eBOM", text: "Add a part or assembly in Structure, Foam, Plastic or Trim." },
    { target: "complete-seat", title: "Complete Seat JIT", text: "Generate the read-only seat structure from all eBOMs." },
    { target: "bom-cost", title: "Commercial Assessment", text: "Enter supplier and price for the generated lines." },
    { target: "engineering-change", title: "Engineering Change", text: "Raise an ECN, approve it and implement it." },
    { target: "revision", title: "Revision History", text: "Release an immutable revision and compare it." }
  ];

  var MODULE_WORKSPACES = {
    "MOD-STRUCTURE": "structure",
    "MOD-FOAM": "foam",
    "MOD-PLASTIC": "plastic",
    "MOD-TRIM": "trim",
    "MOD-HEAD-REST": "headrest",
    "MOD-ARM-REST": "armrest"
  };

  app.router.register("dashboard", {
    render: function () {
      return renderDashboard(app.domain.dashboardService.getDashboardSummary());
    },
    afterRender: function (container) {
      bindContainer(container);
    }
  });

  /* ------------------------------------------------------------------ */
  /* Data                                                                */
  /* ------------------------------------------------------------------ */

  function readModel() {
    var model = { program: null, variant: null, config: null, variants: [], changes: [], context: {} };
    try {
      var store = app.core.appState;
      var context = store.getContext();
      model.context = context;
      model.program = context.activeProgramId ? store.getById("programs", context.activeProgramId) : null;
      model.variant = context.activeSeatVariantId ? store.getById("seatVariants", context.activeSeatVariantId) : null;
      model.config = context.activeFeatureConfigurationId ? store.getById("featureConfigurations", context.activeFeatureConfigurationId) : null;
      if (model.program) {
        model.variants = store.getCollection("seatVariants").filter(function (variant) { return variant.programId === model.program.id; });
        model.changes = store.getCollection("engineeringChanges").filter(function (change) {
          return change.programId === model.program.id;
        });
      }
    } catch (error) {
      /* leave the model empty */
    }
    return model;
  }

  function variantLabel(variant) {
    return [variant.customer || variant.brand, variant.seatType || variant.seatFamily, variant.side, variant.grade].filter(Boolean).join(" · ");
  }

  function statusText(value) {
    return String(value || "").toLowerCase().replace(/_/g, " ").replace(/(^|\s)([a-z])/g, function (_, space, letter) {
      return space + letter.toUpperCase();
    });
  }

  /* ------------------------------------------------------------------ */
  /* Rendering                                                           */
  /* ------------------------------------------------------------------ */

  function renderDashboard(summary) {
    var model = readModel();
    var hasVariant = summary.hasActiveVariant;
    return [
      '<div class="dashboard-heading"><h1>Dashboard</h1>',
      '<button type="button" class="fi-help" data-fi-help aria-label="About this page" title="About this page">?</button></div>',
      '<div class="workspace-body dashboard-workspace">',
      renderKpis(summary),
      hasVariant ? '' : renderEmpty(),
      '<div class="fi-grid">',
      renderProgrammePanel(model),
      renderVariantPanel(model),
      renderChangesPanel(model),
      renderResultPanel(model),
      '</div>',
      renderGuide(),
      '</div>'
    ].join("");
  }

  function renderKpis(summary) {
    var revisions = summary.releasedRevisions;
    return [
      '<section class="dashboard-kpi-grid" aria-label="Product context summary">',
      kpiCard({
        label: "Pending PO",
        value: summary.pendingPo.count,
        supporting: summary.pendingPo.assessmentId ? "Sourced lines missing a PO Number" : "No active Commercial Assessment",
        title: "Counts active supplied lines at Quoted, Nominated, or Sourced status until a PO Number is saved."
      }),
      kpiCard({
        label: "Completed BOMs",
        value: summary.completedBoms.completed + " / " + summary.completedBoms.required,
        supporting: "Applicable Engineering eBOMs completed",
        target: summary.completedBoms.targetWorkspaceId,
        title: summary.completedBoms.targetWorkspaceId
          ? (summary.completedBoms.firstIncompleteModuleCode
            ? "Open the first incomplete applicable Engineering eBOM"
            : "Open Complete Seat JIT")
          : ""
      }),
      kpiCard({
        label: "Total ECNs",
        value: summary.engineeringChanges.total,
        supporting: summary.engineeringChanges.open + " Open / " + summary.engineeringChanges.implemented + " Implemented",
        target: "engineering-change",
        title: "Open Engineering Change"
      }),
      kpiCard({
        label: "Total Released",
        value: revisions.count,
        supporting: revisions.latestRevisionNumber ? "Latest: Revision " + revisions.latestRevisionNumber : "No released Revision",
        target: "revision",
        title: "Open Revision History"
      }),
      '</section>'
    ].join("");
  }

  function kpiCard(input) {
    var tag = input.target ? "button" : "article";
    return [
      '<', tag,
      input.target ? ' type="button" data-dashboard-target="' + escape(input.target) + '"' : '',
      ' class="dashboard-kpi-card', input.target ? ' is-actionable' : '', '"',
      input.title ? ' title="' + escape(input.title) + '"' : '',
      '>',
      '<span class="dashboard-kpi-label">', escape(input.label), '</span>',
      '<strong class="dashboard-kpi-value">', escape(input.value), '</strong>',
      '<span class="dashboard-kpi-supporting">', escape(input.supporting), '</span>',
      '</', tag, '>'
    ].join("");
  }

  function renderEmpty() {
    return '<div class="dashboard-empty">No active Finished-Good Variant. Import a BOM workbook, or create a Programme and Finished-Good Variant in Programme Context, to begin.</div>';
  }

  function fields(key, rows) {
    var open = Boolean(openFields[key]);
    return '<div class="fi-fields' + (open ? ' show-more' : '') + '">' + rows.map(function (row) {
      return '<div class="fi-field' + (row[2] ? ' fi-more' : '') + '"><span class="fi-label">' + escape(row[0]) + ':</span>' +
        '<span class="fi-value">' + (row[1] === "" || row[1] == null ? '<span class="fi-empty">-</span>' : escape(row[1])) + '</span></div>';
    }).join("") + '</div>';
  }

  function panel(key, title, body, actions, hasMore) {
    return '<section class="fi-panel" data-panel="' + key + '">' +
      '<div class="fi-panel-head"><strong>' + escape(title) + '</strong>' +
      (hasMore ? '<button type="button" class="fi-link" data-more-fields="' + key + '" aria-expanded="' + Boolean(openFields[key]) + '">' + (openFields[key] ? "Fewer Fields" : "More Fields") + '</button>' : '') +
      '</div><div class="fi-panel-body">' + body + '</div>' +
      (actions ? '<div class="fi-panel-actions">' + actions + '</div>' : '') +
      '</section>';
  }

  function goButton(label, target, extra) {
    return '<button type="button" class="fi-btn" data-dashboard-target="' + escape(target) + '"' + (extra || '') + '>' + escape(label) + '</button>';
  }

  function renderProgrammePanel(model) {
    var program = model.program;
    if (!program) {
      return panel("programme", "Programme:", '<div class="fi-none">No active Programme.</div>', goButton("Create Programme", "program"), false);
    }
    return panel("programme", "Programme (" + (program.programCode || program.id) + "):", fields("programme", [
      ["Programme Code", program.programCode || program.code],
      ["Programme Name", program.name],
      ["Customer / OEM", program.customer],
      ["Vehicle Platform", program.vehiclePlatform],
      ["Status", statusText(program.status)],
      ["Owner Role", statusText(program.ownerRole), true],
      ["Lifecycle", statusText(program.lifecycleState), true],
      ["Finished-Good Variants", String(model.variants.length), true],
      ["Programme ID", program.id, true]
    ]), goButton("Change", "program") + goButton("Add Variant", "program"), true);
  }

  function renderVariantPanel(model) {
    var variant = model.variant;
    if (!variant) {
      return panel("variant", "Finished-Good Variant:", '<div class="fi-none">No active Finished-Good Variant.</div>', goButton("Select Variant", "program"), false);
    }
    var selections = model.config && model.config.selections || [];
    var enabled = selections.filter(function (selection) { return selection.selectedValue && selection.selectedValue !== "NO"; }).length;
    return panel("variant", "Finished-Good Variant (" + (variant.finishedGoodPartNumber || variant.variantCode || variant.id) + "):", fields("variant", [
      ["Customer / OEM", variant.customer || variant.brand],
      ["Seat Type", variant.seatType || variant.seatFamily],
      ["Side / Grade", [variant.side, variant.grade].filter(Boolean).join(" / ")],
      ["Trim Material", model.config && model.config.trimMaterial],
      ["Finished-Good Part No.", variant.finishedGoodPartNumber],
      ["Customer Part No.", variant.rnFinishedGoodPartNumber || variant.finishedGoodRnPartNumber, true],
      ["Variant Code", variant.variantCode, true],
      ["Features Selected", selections.length ? enabled + " of " + selections.length : "", true],
      ["Status", statusText(variant.status), true]
    ]), goButton("Change", "program") + goButton("Feature Matrix", "feature-matrix"), true);
  }

  function renderChangesPanel(model) {
    var changes = model.changes.filter(function (change) {
      return !model.variant || change.seatVariantId === model.variant.id;
    }).sort(function (a, b) {
      return String(b.updatedAt || b.createdAt || "").localeCompare(String(a.updatedAt || a.createdAt || ""));
    }).slice(0, 6);
    var rows = changes.length ? changes.map(function (change) {
      var stamp = String(change.updatedAt || change.createdAt || "");
      return '<tr data-dashboard-target="engineering-change" class="fi-click-row">' +
        '<td>' + escape(stamp.slice(0, 10)) + '</td><td>' + escape(stamp.slice(11, 16)) + '</td>' +
        '<td>' + escape(change.changeNumber || change.id) + '</td><td>' + escape(change.title || "") + '</td>' +
        '<td>' + app.utils.renderStatusBadge(change.status) + '</td></tr>';
    }).join("") : '<tr><td colspan="5" class="fi-none">No engineering changes for this variant.</td></tr>';
    return '<section class="fi-panel" data-panel="changes">' +
      '<div class="fi-panel-head"><strong>Last Engineering Changes:</strong>' +
      '<button type="button" class="fi-link" data-dashboard-target="engineering-change">Engineering Change Overview</button></div>' +
      '<div class="fi-panel-body fi-flush">' +
      '<div class="fi-searchbar"><input type="search" class="fi-search" data-changes-filter placeholder="Search" aria-label="Search engineering changes"></div>' +
      '<div class="fi-table-wrap"><table class="fi-table"><thead><tr><th>Date</th><th>Time</th><th>Number</th><th>Description</th><th>Status</th></tr></thead>' +
      '<tbody data-changes-body>' + rows + '</tbody></table></div></div></section>';
  }

  var TREE_ICONS = {
    programme: '<path d="M3 6h6l2 2h10v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
    variant: '<path d="M8 3v9a4 4 0 0 0 4 4h7"/><path d="M8 8h5a3 3 0 0 1 3 3v5"/><path d="M5 16h14v4H7a2 2 0 0 1-2-2z"/>',
    folder: '<path d="M3 6h6l2 2h10v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
    module: '<path d="M12 2l8 4.5v11L12 22l-8-4.5v-11z"/><path d="M4 6.5l8 4.5 8-4.5M12 11v11"/>',
    seat: '<circle cx="12" cy="4" r="2"/><circle cx="5" cy="19" r="2"/><circle cx="12" cy="19" r="2"/><circle cx="19" cy="19" r="2"/><path d="M12 6v5M5 17v-4h14v4M12 11v6"/>',
    commercial: '<rect x="4" y="2" width="16" height="20" rx="2"/><path d="M8 6h8M8 10h2M14 10h2M8 14h2M14 14h2"/>',
    change: '<path d="M20 7h-7a4 4 0 0 0-4 4v1"/><path d="M17 4l3 3-3 3"/><path d="M4 17h7a4 4 0 0 0 4-4v-1"/><path d="M7 20l-3-3 3-3"/>',
    revision: '<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5M12 7v5l3 2"/>'
  };

  function treeIcon(name) {
    return '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + (TREE_ICONS[name] || TREE_ICONS.folder) + '</svg>';
  }

  function viewTitle() {
    return treeView === "changes" ? "Engineering Changes" : "Product Structure";
  }

  function renderResultPanel(model) {
    buildTree(model);
    return '<section class="fi-panel fi-result" data-panel="result">' +
      '<div class="fi-panel-head"><strong>Result List:</strong></div>' +
      '<div class="fi-toolbar" role="toolbar" aria-label="Result list actions">' +
      '<button type="button" class="fi-tool is-strong" data-tree-views aria-haspopup="true" aria-expanded="false">' + escape(viewTitle()) + ' <span class="fi-caret"></span></button>' +
      '<button type="button" class="fi-tool" data-tree-actions aria-haspopup="true" aria-expanded="false">Actions <span class="fi-caret"></span></button>' +
      '<button type="button" class="fi-tool" data-tree-expand>Expand</button>' +
      '<button type="button" class="fi-tool" data-tree-collapse>Collapse</button>' +
      '<button type="button" class="fi-tool" data-tree-position>Position</button>' +
      '<button type="button" class="fi-tool" data-tree-next>Next Hit</button>' +
      '<button type="button" class="fi-tool fi-tool-icon" data-tree-more aria-haspopup="true" aria-label="More actions" aria-expanded="false">…</button>' +
      '</div>' +
      '<div class="fi-table-wrap fi-tree-wrap"><table class="fi-table fi-tree"><thead><tr><th>Description</th><th>Additional Information</th><th>ID</th></tr></thead>' +
      '<tbody data-tree-body>' + renderTreeRows() + '</tbody></table></div></section>';
  }

  function renderGuide() {
    return [
      '<section class="demo-guide" aria-label="Try the lifecycle">',
      '<div class="demo-guide-head"><strong>Try the lifecycle</strong>',
      '<span>Sample data only. Everything you enter stays in this browser. Use <em>Reset demo data</em> in the side menu or user menu to start over.</span></div>',
      '<ol class="demo-guide-steps">',
      GUIDE_STEPS.map(function (step) {
        return '<li><button type="button" data-dashboard-target="' + escape(step.target) + '">' +
          '<strong>' + escape(step.title) + '</strong><span>' + escape(step.text) + '</span></button></li>';
      }).join(""),
      '</ol>',
      '</section>'
    ].join("");
  }

  /* ------------------------------------------------------------------ */
  /* Result list tree                                                    */
  /* ------------------------------------------------------------------ */

  function buildTree(model) {
    treeNodes = [];
    if (!model.program) return;
    var store = app.core.appState;
    var program = model.program;
    var activeId = model.variant && model.variant.id;
    var modules = store.getCollection("engineeringModules");
    var boms = store.getCollection("engineeringBoms");
    var structures = store.getCollection("engineeringProductStructures");
    var assessments = store.getCollection("commercialAssessments");
    var revisions = store.getCollection("revisions");

    var progId = "prog:" + program.id;
    treeNodes.push({
      id: progId, parent: null, level: 0, type: "programme", icon: "programme",
      label: (program.programCode || program.id) + " - " + (program.name || ""),
      info: model.variants.length + " Finished-Good Variant(s) · " + (program.vehiclePlatform || ""),
      ref: program.id, go: "program", programId: program.id
    });

    if (treeView === "changes") {
      var groups = [
        ["Open", ["DRAFT", "SUBMITTED", "APPROVED", "IMPLEMENTING"]],
        ["Implemented", ["IMPLEMENTED"]],
        ["Rejected / Cancelled", ["REJECTED", "CANCELLED"]]
      ];
      groups.forEach(function (group) {
        var items = model.changes.filter(function (change) { return group[1].indexOf(change.status) !== -1; });
        var folderId = "grp:" + group[0];
        treeNodes.push({ id: folderId, parent: progId, level: 1, type: "folder", icon: "folder", label: group[0], info: items.length + " change(s)", ref: "", go: "engineering-change" });
        items.forEach(function (change) {
          var variant = model.variants.filter(function (item) { return item.id === change.seatVariantId; })[0];
          treeNodes.push({
            id: "ecn:" + change.id, parent: folderId, level: 2, type: "change", icon: "change",
            label: (change.changeNumber || change.id) + " - " + (change.title || ""),
            info: statusText(change.status) + (variant ? " · " + variantLabel(variant) : ""),
            ref: change.changeNumber || change.id, go: "engineering-change", variantId: change.seatVariantId, programId: program.id
          });
        });
      });
    } else {
      model.variants.forEach(function (variant) {
        var vid = "var:" + variant.id;
        var isActive = variant.id === activeId;
        treeNodes.push({
          id: vid, parent: progId, level: 1, type: "variant", icon: "variant", active: isActive,
          label: variantLabel(variant),
          info: (isActive ? "Active variant · " : "") + (variant.variantCode || variant.variantName || ""),
          ref: variant.finishedGoodPartNumber || variant.id, go: "program", variantId: variant.id, programId: program.id
        });
        var variantBoms = boms.filter(function (bom) { return bom.seatVariantId === variant.id; });
        var complete = variantBoms.filter(function (bom) { return bom.completionStatus === "COMPLETE"; }).length;
        var bomFolder = "boms:" + variant.id;
        treeNodes.push({ id: bomFolder, parent: vid, level: 2, type: "folder", icon: "folder", label: "Engineering eBOMs", info: complete + " of " + variantBoms.length + " complete", ref: "", go: "structure", variantId: variant.id, programId: program.id });
        variantBoms.forEach(function (bom) {
          var module = modules.filter(function (item) { return item.id === bom.engineeringModuleId; })[0] || {};
          treeNodes.push({
            id: "mod:" + bom.id, parent: bomFolder, level: 3, type: "module", icon: "module",
            label: module.name || module.label || module.code || bom.engineeringModuleId,
            info: statusText(bom.completionStatus) + " · " + (bom.items || []).length + " item(s)",
            ref: bom.id, go: MODULE_WORKSPACES[bom.engineeringModuleId] || "structure", variantId: variant.id, programId: program.id
          });
        });
        var structure = structures.filter(function (item) { return item.seatVariantId === variant.id; })[0];
        treeNodes.push({
          id: "eps:" + variant.id, parent: vid, level: 2, type: "seat", icon: "seat",
          label: "Complete Seat JIT", info: structure ? statusText(structure.generationStatus) : "Not generated",
          ref: structure ? structure.id : "", go: "complete-seat", variantId: variant.id, programId: program.id
        });
        var assessment = assessments.filter(function (item) { return item.seatVariantId === variant.id; })[0];
        treeNodes.push({
          id: "ca:" + variant.id, parent: vid, level: 2, type: "commercial", icon: "commercial",
          label: "Commercial Assessment", info: assessment ? statusText(assessment.generationStatus) : "Not generated",
          ref: assessment ? assessment.id : "", go: "bom-cost", variantId: variant.id, programId: program.id
        });
        var variantRevs = revisions.filter(function (revision) { return revision.seatVariantId === variant.id; });
        var revFolder = "revs:" + variant.id;
        treeNodes.push({ id: revFolder, parent: vid, level: 2, type: "folder", icon: "revision", label: "Revisions", info: variantRevs.length ? variantRevs.length + " released" : "None released", ref: "", go: "revision", variantId: variant.id, programId: program.id });
        variantRevs.forEach(function (revision) {
          treeNodes.push({
            id: "rev:" + revision.id, parent: revFolder, level: 3, type: "revision", icon: "revision",
            label: "Revision " + revision.revisionNumber, info: statusText(revision.lifecycleStatus) + (revision.title ? " · " + revision.title : ""),
            ref: revision.id, go: "revision", variantId: variant.id, programId: program.id
          });
        });
      });
    }

    var parents = {};
    treeNodes.forEach(function (node) { if (node.parent) parents[node.parent] = true; });
    treeNodes.forEach(function (node) { node.hasChildren = Boolean(parents[node.id]); });

    if (!expanded) {
      expanded = {};
      expanded[progId] = true;
      if (treeView === "changes") {
        expanded["grp:Open"] = true;
      } else if (activeId) {
        expanded["var:" + activeId] = true;
        expanded["boms:" + activeId] = true;
      }
    }
  }

  function isVisible(node) {
    var parentId = node.parent;
    while (parentId) {
      if (!expanded[parentId]) return false;
      var parent = treeNodes.filter(function (item) { return item.id === parentId; })[0];
      parentId = parent && parent.parent;
    }
    return true;
  }

  function renderTreeRows() {
    if (!treeNodes.length) return '<tr><td colspan="3" class="fi-none">No programme is active.</td></tr>';
    return treeNodes.filter(isVisible).map(function (node) {
      var open = Boolean(expanded[node.id]);
      return '<tr class="fi-row' + (node.active ? ' is-active' : '') + '" data-node="' + escape(node.id) + '">' +
        '<td class="fi-desc"><div class="fi-desc-inner" style="padding-left:' + (node.level * 18) + 'px">' +
        (node.hasChildren
          ? '<button type="button" class="fi-toggle" data-node-toggle="' + escape(node.id) + '" aria-expanded="' + open + '" aria-label="' + (open ? "Collapse" : "Expand") + '"><span class="fi-chev' + (open ? ' is-open' : '') + '"></span></button>'
          : '<span class="fi-toggle-spacer"></span>') +
        '<button type="button" class="fi-node-icon" data-node-menu="' + escape(node.id) + '" aria-haspopup="true" aria-label="Actions for ' + escape(node.label) + '" title="Actions">' + treeIcon(node.icon) + '</button>' +
        '<span class="fi-node-label">' + escape(node.label) + '</span></div></td>' +
        '<td class="fi-info">' + escape(node.info) + '</td>' +
        '<td class="fi-idcell">' + (node.ref ? '<button type="button" class="fi-id" data-node-go="' + escape(node.id) + '">' + escape(node.ref) + '</button>' : '') + '</td></tr>';
    }).join("");
  }

  function findNode(id) {
    return treeNodes.filter(function (node) { return node.id === id; })[0] || null;
  }

  function withVariant(node, then) {
    var currentVariantId = app.core.appState.getContext().activeSeatVariantId;
    if (!node || !node.variantId || node.variantId === currentVariantId) { then(); return; }
    app.router.requestTransition({
      type: "context",
      contextField: "finished-good-variant",
      proceed: function () {
        app.core.contextService.setActiveBusinessContext({ programId: node.programId, seatVariantId: node.variantId });
        if (app.state && app.state.resetContextScopedUiState) app.state.resetContextScopedUiState();
        app.events.emit("state:changed");
        then();
      }
    });
  }

  function openWorkspace(node, workspaceId) {
    withVariant(node, function () {
      if (workspaceId === "dashboard") app.router.render(); else app.router.navigate(workspaceId);
    });
  }

  function createChange(node) {
    withVariant(node, function () {
      app.router.navigate("engineering-change");
      window.setTimeout(function () {
        var button = document.querySelector('#app-workspace [data-action="create-change"]');
        if (button) button.click();
      }, 60);
    });
  }

  function menuFor(node) {
    var activeVariantId = app.core.appState.getContext().activeSeatVariantId;
    var open = function (id) { return function () { openWorkspace(node, id); }; };
    if (node.type === "programme") {
      return [
        { label: "Display Programme", icon: "view", onSelect: open("program") },
        { label: "Change Programme", icon: "edit", onSelect: open("program") },
        { separator: true },
        { label: "Add Finished-Good Variant", icon: "plus", onSelect: open("program") }
      ];
    }
    if (node.type === "variant") {
      var isActive = node.variantId === activeVariantId;
      return [
        { label: "Display Variant", icon: "view", onSelect: open("program") },
        { label: "Feature Matrix", icon: "edit", onSelect: open("feature-matrix") },
        { label: isActive ? "Active Variant" : "Set as Active Variant", icon: "check", disabled: isActive, onSelect: open("dashboard") },
        { label: "Create", icon: "plus", children: [
          { label: "Create Engineering Change", icon: "plus", onSelect: function () { createChange(node); } },
          { label: "Generate Complete Seat", icon: "plus", onSelect: open("complete-seat") },
          { label: "Generate Commercial Assessment", icon: "plus", onSelect: open("bom-cost") }
        ] },
        { separator: true },
        { label: "Unselect Variant", icon: "close", disabled: true }
      ];
    }
    if (node.type === "module") {
      return [
        { label: "Display eBOM", icon: "view", onSelect: open(node.go) },
        { label: "Open Complete Seat JIT", icon: "doc", onSelect: open("complete-seat") },
        { label: "Create", icon: "plus", children: [
          { label: "Create Engineering Change", icon: "plus", onSelect: function () { createChange(node); } }
        ] }
      ];
    }
    if (node.type === "change") {
      return [
        { label: "Display Engineering Change", icon: "view", onSelect: open("engineering-change") },
        { label: "Open Revision History", icon: "doc", onSelect: open("revision") }
      ];
    }
    if (node.type === "revision") {
      return [
        { label: "Display Revision", icon: "view", onSelect: open("revision") },
        { label: "Excel Export", icon: "doc", onSelect: open("excel-export") }
      ];
    }
    return [{ label: "Display", icon: "view", onSelect: open(node.go) }];
  }

  function refreshTree(container) {
    var body = container.querySelector("[data-tree-body]");
    if (body) body.innerHTML = renderTreeRows();
  }

  function setView(container, view) {
    treeView = view;
    expanded = null;
    activeHit = -1;
    var model = readModel();
    var host = container.querySelector('[data-panel="result"]');
    if (host) host.outerHTML = renderResultPanel(model);
  }

  function expandAncestors(node) {
    var parentId = node.parent;
    while (parentId) {
      expanded[parentId] = true;
      var parent = findNode(parentId);
      parentId = parent && parent.parent;
    }
  }

  /* ------------------------------------------------------------------ */
  /* Events                                                              */
  /* ------------------------------------------------------------------ */

  function bindContainer(container) {
    container.onclick = function (event) {
      var target = event.target;
      var more = target.closest("[data-more-fields]");
      if (more) {
        var key = more.getAttribute("data-more-fields");
        openFields[key] = !openFields[key];
        var panelElement = container.querySelector('[data-panel="' + key + '"]');
        if (panelElement) {
          panelElement.querySelector(".fi-fields").classList.toggle("show-more", openFields[key]);
          more.textContent = openFields[key] ? "Fewer Fields" : "More Fields";
          more.setAttribute("aria-expanded", String(openFields[key]));
        }
        return;
      }
      if (target.closest("[data-fi-help]")) {
        app.components.modal.open("About this page", '<p class="reset-copy">The Dashboard summarises the active Programme and Finished-Good Variant. Use the Result List to browse the product structure. The icon at the start of each row opens an action menu that jumps to the right screen or creates something new.</p>');
        return;
      }
      var toggle = target.closest("[data-node-toggle]");
      if (toggle) {
        var nodeId = toggle.getAttribute("data-node-toggle");
        expanded[nodeId] = !expanded[nodeId];
        refreshTree(container);
        return;
      }
      var menuButton = target.closest("[data-node-menu]");
      if (menuButton) {
        var node = findNode(menuButton.getAttribute("data-node-menu"));
        if (node) {
          container.querySelectorAll(".fi-row.is-menu").forEach(function (row) { row.classList.remove("is-menu"); });
          menuButton.closest(".fi-row").classList.add("is-menu");
          app.components.contextMenu.open({ anchor: menuButton, items: menuFor(node) });
        }
        return;
      }
      var goButton = target.closest("[data-node-go]");
      if (goButton) {
        var goNode = findNode(goButton.getAttribute("data-node-go"));
        if (goNode) openWorkspace(goNode, goNode.go);
        return;
      }
      var views = target.closest("[data-tree-views]");
      if (views) {
        app.components.contextMenu.open({
          anchor: views,
          items: [
            { label: "Product Structure", icon: "list", disabled: treeView === "structure", onSelect: function () { setView(container, "structure"); } },
            { label: "Engineering Changes", icon: "list", disabled: treeView === "changes", onSelect: function () { setView(container, "changes"); } }
          ]
        });
        return;
      }
      var actions = target.closest("[data-tree-actions]");
      if (actions) {
        var context = app.core.appState.getContext();
        var activeNode = { variantId: context.activeSeatVariantId, programId: context.activeProgramId };
        app.components.contextMenu.open({
          anchor: actions,
          items: [
            { label: "Generate Complete Seat", icon: "plus", onSelect: function () { app.router.navigate("complete-seat"); } },
            { label: "Generate Commercial Assessment", icon: "plus", onSelect: function () { app.router.navigate("bom-cost"); } },
            { label: "Create Engineering Change", icon: "plus", onSelect: function () { createChange(activeNode); } },
            { separator: true },
            { label: "Release Revision", icon: "check", onSelect: function () { app.router.navigate("revision"); } }
          ]
        });
        return;
      }
      var moreMenu = target.closest("[data-tree-more]");
      if (moreMenu) {
        app.components.contextMenu.open({
          anchor: moreMenu,
          items: [
            { label: "Open Programme Context", icon: "view", onSelect: function () { app.router.navigate("program"); } },
            { label: "Reset demo data", icon: "flag", onSelect: function () { app.components.mobileShell.confirmReset(); } }
          ]
        });
        return;
      }
      if (target.closest("[data-tree-expand]")) {
        treeNodes.forEach(function (item) { if (item.hasChildren) expanded[item.id] = true; });
        refreshTree(container);
        return;
      }
      if (target.closest("[data-tree-collapse]")) {
        expanded = {};
        if (treeNodes[0]) expanded[treeNodes[0].id] = true;
        refreshTree(container);
        return;
      }
      if (target.closest("[data-tree-position]")) {
        var current = treeNodes.filter(function (item) { return item.active; })[0];
        if (current) {
          expandAncestors(current);
          refreshTree(container);
          var currentRow = container.querySelector('.fi-row[data-node="' + current.id + '"]');
          if (currentRow) { currentRow.scrollIntoView({ block: "nearest" }); currentRow.classList.add("is-selected"); }
        }
        return;
      }
      if (target.closest("[data-tree-next]")) {
        var hits = treeNodes.filter(function (item) { return item.type === "variant" || item.type === "change"; });
        if (hits.length) {
          activeHit = (activeHit + 1) % hits.length;
          var hit = hits[activeHit];
          expandAncestors(hit);
          refreshTree(container);
          container.querySelectorAll(".fi-row.is-selected").forEach(function (item) { item.classList.remove("is-selected"); });
          var hitRow = container.querySelector('.fi-row[data-node="' + hit.id + '"]');
          if (hitRow) { hitRow.classList.add("is-selected"); hitRow.scrollIntoView({ block: "nearest" }); }
        }
        return;
      }
      var row = target.closest(".fi-row");
      if (row && !target.closest("button")) {
        container.querySelectorAll(".fi-row.is-selected").forEach(function (item) { item.classList.remove("is-selected"); });
        row.classList.add("is-selected");
        return;
      }
      var card = target.closest("[data-dashboard-target]");
      if (!card || card.disabled) return;
      app.router.navigate(card.getAttribute("data-dashboard-target"));
    };

    var filter = container.querySelector("[data-changes-filter]");
    if (filter) {
      filter.oninput = function () {
        var term = filter.value.trim().toLowerCase();
        container.querySelectorAll("[data-changes-body] tr").forEach(function (row) {
          row.hidden = Boolean(term) && row.innerText.toLowerCase().indexOf(term) === -1;
        });
      };
    }
  }

  function escape(value) {
    return app.utils.escapeHtml(String(value == null ? "" : value));
  }
})(window.DEP = window.DEP || {});
