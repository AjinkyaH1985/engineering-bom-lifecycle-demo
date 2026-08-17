(function (app) {
  var MAX_COMPARE_VARIANTS = 3;
  var draftFeatures = [];
  var draftValues = {};
  var baselineValues = {};
  var activeVariant = null;
  var activeConfiguration = null;
  var availableVariants = [];
  var availableConfigurations = [];
  var selectedFeatureId = null;
  var expandedCategories = {};
  var viewMode = "normal";
  var comparisonVariantIds = [];
  var showOnlyDifferences = false;
  var dirty = false;

  var workspace = {
    render: function (state) {
      initialiseDraft(state);
      return renderWorkspace();
    },
    afterRender: function (container) {
      bindWorkspace(container);
      registerTransitionGuard();
    },
    beforeLeave: function () {
      resetViewState();
    }
  };

  app.router.register("feature-matrix", workspace);

  function initialiseDraft(state) {
    draftFeatures = app.utils.clone(state.features || []);
    activeVariant = app.utils.clone(state.variant || null);
    activeConfiguration = app.utils.clone(state.activeFeatureConfiguration || null);
    availableVariants = app.utils.clone((state.seatVariants || []).filter(function (variant) {
      return !state.program || !state.program.id || variant.programId === state.program.id;
    }));
    availableConfigurations = app.utils.clone(state.featureConfigurations || []);
    draftValues = valuesForConfiguration(draftFeatures, activeConfiguration, activeVariant, true);
    baselineValues = app.utils.clone(draftValues);
    selectedFeatureId = null;
    expandedCategories = buildExpandedCategories(draftFeatures, expandedCategories);
    dirty = false;
    if (viewMode === "compare") {
      comparisonVariantIds = comparisonVariantIds.filter(function (variantId) {
        return availableVariants.some(function (variant) { return variant.id === variantId; });
      }).slice(0, MAX_COMPARE_VARIANTS);
      if (comparisonVariantIds.length < 2) viewMode = "normal";
    }
  }

  function renderWorkspace() {
    var status = activeConfiguration ? "Configuration Active" : "Configuration Required";
    var actions = viewMode === "compare" ? [
      { id: "edit-active-variant", label: "Back to Active Variant", primary: true }
    ] : [
      { id: "add-feature", label: "Add Feature" },
      { id: "edit-feature", label: "Edit Feature", hidden: !selectedFeatureId },
      { id: "compare-variants", label: "Compare Variants" },
      { id: "save-feature-configuration", label: "Save Feature Configuration", primary: true, hidden: !dirty }
    ];
    return [
      app.utils.renderWorkspaceHeader({
        title: "Feature Matrix",
        purpose: viewMode === "compare" ? "Read-only Finished-Good Variant comparison" : "",
        status: status,
        actions: actions
      }),
      '<div class="workspace-body feature-matrix-workspace">',
      '<div class="placeholder-panel matrix-panel">',
      viewMode === "compare" ? renderComparisonView() : renderNormalView(),
      '</div>',
      '</div>'
    ].join("");
  }

  function renderNormalView() {
    if (!activeVariant || !activeVariant.id) {
      return app.utils.renderEmptyState(
        "Finished-Good Variant required",
        "Select a Programme and Finished-Good Variant to configure Features."
      );
    }
    var grouped = groupFeatures(draftFeatures);
    return [
      '<div class="feature-matrix-context">',
      '<span>Editing <strong>' + app.utils.escapeHtml(readableVariantLabel(activeVariant)) + '</strong></span>',
      '<span>' + draftFeatures.length + ' Features</span>',
      '</div>',
      '<div class="table-toolbar feature-matrix-toolbar">',
      '<input type="search" placeholder="Search Feature code, name or category" data-feature-filter aria-label="Search Features">',
      '<span class="feature-save-state" data-dirty-indicator>' + (dirty ? "Unsaved changes" : "Changes saved") + '</span>',
      '</div>',
      '<div class="feature-matrix-scroll">',
      '<table class="engineering-table feature-matrix-table feature-matrix-single">',
      '<thead><tr><th>Feature Code</th><th>Feature Name</th><th>Category</th><th>Value</th><th>Status</th></tr></thead>',
      '<tbody>',
      grouped.length ? grouped.map(renderFeatureGroup).join("") : '<tr><td colspan="5">' + app.utils.renderEmptyState(
        "No Feature definitions",
        "Add a Feature in Feature Master before configuring this variant."
      ) + '</td></tr>',
      '</tbody></table>',
      '</div>'
    ].join("");
  }

  function renderFeatureGroup(group) {
    var expanded = expandedCategories[group.name] !== false;
    return [
      '<tr class="feature-category-row" data-feature-category="' + app.utils.escapeHtml(group.name) + '">',
      '<td colspan="5"><button type="button" data-category-toggle="' + app.utils.escapeHtml(group.name) + '" aria-expanded="' + String(expanded) + '">',
      '<span aria-hidden="true">' + (expanded ? "-" : "+") + '</span>',
      app.utils.escapeHtml(group.name) + '<em>' + group.features.length + '</em></button></td></tr>',
      group.features.map(function (feature) {
        return renderFeatureRow(feature, group.name, expanded);
      }).join("")
    ].join("");
  }

  function renderFeatureRow(feature, category, expanded) {
    return [
      '<tr data-feature-id="' + app.utils.escapeHtml(feature.id) + '" data-category="' + app.utils.escapeHtml(category) + '"' + (expanded ? "" : " hidden") + '>',
      '<td>' + app.utils.escapeHtml(feature.featureCode || feature.code || feature.id) + '</td>',
      '<td>' + app.utils.escapeHtml(feature.name) + '</td>',
      '<td>' + app.utils.escapeHtml(category) + '</td>',
      '<td class="feature-value-cell">' + renderValueControl(feature, draftValues[feature.id]) + '</td>',
      '<td>' + app.utils.renderStatusBadge(feature.status || "ACTIVE") + '</td>',
      '</tr>'
    ].join("");
  }

  function renderValueControl(feature, value) {
    var type = String(feature.valueType || "BOOLEAN").toUpperCase();
    var attributes = ' data-feature-value="' + app.utils.escapeHtml(feature.id) + '" aria-label="' +
      app.utils.escapeHtml((feature.name || feature.featureCode) + " value") + '"';
    if (type === "BOOLEAN") {
      var checked = isAffirmative(value);
      return '<label class="feature-boolean-control"><input type="checkbox"' + attributes + (checked ? " checked" : "") +
        '><span data-boolean-label>' + (checked ? "Yes" : "No") + '</span></label>';
    }
    if (type === "ENUM" || (feature.allowedValues || []).length) {
      var options = (feature.allowedValues || []).slice();
      if (value && options.indexOf(value) === -1) options.unshift(value);
      return '<select' + attributes + '><option value="">Select</option>' + options.map(function (option) {
        return '<option value="' + app.utils.escapeHtml(option) + '"' + (String(option) === String(value) ? " selected" : "") + '>' +
          app.utils.escapeHtml(option) + '</option>';
      }).join("") + '</select>';
    }
    return '<input type="' + (type === "NUMBER" ? "number" : "text") + '"' + attributes +
      (type === "NUMBER" ? ' step="any"' : "") + ' value="' + app.utils.escapeHtml(value == null ? "" : value) + '">';
  }

  function renderComparisonView() {
    var model = buildComparisonModel(draftFeatures, availableVariants, availableConfigurations, comparisonVariantIds, showOnlyDifferences);
    return [
      '<div class="table-toolbar feature-compare-toolbar">',
      '<input type="search" placeholder="Search compared Features" data-compare-filter aria-label="Search compared Features">',
      '<label class="difference-toggle"><input type="checkbox" data-show-differences' + (showOnlyDifferences ? " checked" : "") + '> Show only differences</label>',
      '<button type="button" data-action="change-comparison">Change Variants</button>',
      '</div>',
      '<div class="feature-matrix-scroll feature-compare-scroll">',
      '<table class="engineering-table feature-matrix-table feature-compare-table">',
      '<thead><tr><th class="sticky-col sticky-code">Feature Code</th><th class="sticky-col sticky-name">Feature Name</th>',
      model.variants.map(function (variant) { return '<th>' + app.utils.escapeHtml(readableVariantLabel(variant)) + '</th>'; }).join(""),
      '</tr></thead><tbody>',
      model.rows.length ? model.rows.map(function (row) {
        return '<tr data-compare-feature><td class="sticky-col sticky-code">' + app.utils.escapeHtml(row.featureCode) +
          '</td><td class="sticky-col sticky-name">' + app.utils.escapeHtml(row.featureName) + '</td>' +
          row.values.map(function (value) {
            return '<td class="comparison-value' + (row.different ? " different" : "") + '">' + app.utils.escapeHtml(displayValue(value)) + '</td>';
          }).join("") + '</tr>';
      }).join("") : '<tr><td colspan="' + (model.variants.length + 2) + '">' + app.utils.renderEmptyState(
        showOnlyDifferences ? "No differences" : "No Features",
        showOnlyDifferences ? "The selected Finished-Good Variants have identical Feature values." : "No Feature definitions are available."
      ) + '</td></tr>',
      '</tbody></table></div>'
    ].join("");
  }

  function bindWorkspace(container) {
    bindFeatureRows(container);
    bindValueControls(container);
    bindCategoryControls(container);
    bindNormalActions(container);
    bindComparisonActions(container);
    var filter = container.querySelector("[data-feature-filter]");
    if (filter) filter.oninput = function () { filterNormalRows(container, filter.value); };
    var compareFilter = container.querySelector("[data-compare-filter]");
    if (compareFilter) compareFilter.oninput = function () { filterComparisonRows(container, compareFilter.value); };
  }

  function bindFeatureRows(container) {
    container.querySelectorAll("[data-feature-id]").forEach(function (row) {
      row.onclick = function () {
        selectedFeatureId = row.getAttribute("data-feature-id");
        container.querySelectorAll("tr.selected").forEach(function (selected) { selected.classList.remove("selected"); });
        row.classList.add("selected");
        var edit = container.querySelector('[data-action="edit-feature"]');
        if (edit) edit.hidden = false;
        var feature = findFeature(selectedFeatureId);
        if (feature) selectFeature(feature);
      };
    });
  }

  function bindValueControls(container) {
    container.querySelectorAll("[data-feature-value]").forEach(function (control) {
      control.onclick = function (event) { event.stopPropagation(); };
      control.oninput = function (event) {
        event.stopPropagation();
        setDraftValue(control.getAttribute("data-feature-value"), control.type === "checkbox" ? (control.checked ? "YES" : "NO") : control.value);
        if (control.type === "checkbox") {
          var label = control.parentElement.querySelector("[data-boolean-label]");
          if (label) label.textContent = control.checked ? "Yes" : "No";
        }
        updateDirtyUi(container);
      };
      control.onchange = control.oninput;
    });
  }

  function bindCategoryControls(container) {
    container.querySelectorAll("[data-category-toggle]").forEach(function (button) {
      button.onclick = function () {
        var category = button.getAttribute("data-category-toggle");
        expandedCategories[category] = expandedCategories[category] === false;
        rerender(container);
      };
    });
  }

  function bindNormalActions(container) {
    var save = container.querySelector('[data-action="save-feature-configuration"]');
    if (save) save.onclick = function () {
      try {
        if (saveDraftConfiguration()) {
          app.services.notificationService.notify("Feature Configuration saved", "success");
          app.router.render();
        } else {
          app.services.notificationService.notify("No Feature Configuration changes to save", "info");
        }
      } catch (error) {
        app.services.notificationService.notify(businessMessage(error, "Feature Configuration could not be saved"), "error");
      }
    };
    var add = container.querySelector('[data-action="add-feature"]');
    if (add) add.onclick = createFeatureFromPrompt;
    var edit = container.querySelector('[data-action="edit-feature"]');
    if (edit) edit.onclick = editSelectedFeature;
    var compare = container.querySelector('[data-action="compare-variants"]');
    if (compare) compare.onclick = function () {
      app.router.requestTransition({ type: "compare", proceed: openCompareSelector });
    };
  }

  function bindComparisonActions(container) {
    var back = container.querySelector('[data-action="edit-active-variant"]');
    if (back) back.onclick = function () {
      viewMode = "normal";
      showOnlyDifferences = false;
      rerender(container);
    };
    var change = container.querySelector('[data-action="change-comparison"]');
    if (change) change.onclick = openCompareSelector;
    var differences = container.querySelector("[data-show-differences]");
    if (differences) differences.onchange = function () {
      showOnlyDifferences = differences.checked;
      rerender(container);
    };
  }

  function registerTransitionGuard() {
    app.router.setTransitionGuard(function (transition) {
      if (!dirty) {
        if (transition.proceed) transition.proceed();
        return true;
      }
      openUnsavedChangesDialog(transition);
      return false;
    });
  }

  function openUnsavedChangesDialog(transition) {
    app.components.modal.open("Unsaved Feature Configuration", '<p class="modal-message">Save the active Finished-Good Variant changes before continuing?</p>', {
      onClose: function () { if (transition.cancel) transition.cancel(); }
    });
    var root = app.utils.byId("modal-root");
    var footer = root && root.querySelector(".modal-footer");
    if (!footer) return;
    footer.innerHTML = '<button type="button" data-unsaved-cancel>Cancel</button>' +
      '<button type="button" data-unsaved-discard>Discard Changes</button>' +
      '<button type="button" class="primary" data-unsaved-save>Save and Continue</button>';
    footer.querySelector("[data-unsaved-cancel]").onclick = function () {
      app.components.modal.close({ silent: true });
      if (transition.cancel) transition.cancel();
    };
    footer.querySelector("[data-unsaved-discard]").onclick = function () {
      dirty = false;
      app.components.modal.close({ silent: true });
      if (transition.proceed) transition.proceed();
    };
    footer.querySelector("[data-unsaved-save]").onclick = function () {
      try {
        saveDraftConfiguration();
        app.components.modal.close({ silent: true });
        app.services.notificationService.notify("Feature Configuration saved", "success");
        if (transition.proceed) transition.proceed();
      } catch (error) {
        app.services.notificationService.notify(businessMessage(error, "Feature Configuration could not be saved"), "error");
      }
    };
  }

  function openCompareSelector() {
    var selected = comparisonVariantIds.length ? comparisonVariantIds.slice() : defaultComparisonSelection();
    var body = [
      '<div class="variant-compare-selector">',
      '<input type="search" data-variant-compare-search placeholder="Search code, customer, seat type, grade or side" aria-label="Search Finished-Good Variants">',
      '<div class="variant-compare-count"><strong data-compare-count>' + selected.length + '</strong> of ' + MAX_COMPARE_VARIANTS + ' selected</div>',
      '<div class="variant-compare-list" data-variant-compare-list></div>',
      '<p class="field-error" data-compare-error hidden>Select two or three Finished-Good Variants.</p>',
      '</div>'
    ].join("");
    app.components.modal.open("Compare Finished-Good Variants", body);
    var root = app.utils.byId("modal-root");
    var footer = root.querySelector(".modal-footer");
    footer.innerHTML = '<button type="button" data-compare-cancel>Cancel</button><button type="button" class="primary" data-compare-confirm>Compare</button>';
    var search = root.querySelector("[data-variant-compare-search]");
    var list = root.querySelector("[data-variant-compare-list]");
    var confirm = root.querySelector("[data-compare-confirm]");
    function renderOptions() {
      var matches = filterVariants(availableVariants, search.value).slice(0, 60);
      list.innerHTML = matches.map(function (variant) {
        var checked = selected.indexOf(variant.id) !== -1;
        return '<label class="variant-compare-option"><input type="checkbox" value="' + app.utils.escapeHtml(variant.id) + '"' +
          (checked ? " checked" : "") + ((!checked && selected.length >= MAX_COMPARE_VARIANTS) ? " disabled" : "") + '>' +
          '<span><strong>' + app.utils.escapeHtml(variant.variantCode || variant.variantName || variant.id) + '</strong>' +
          '<small>' + app.utils.escapeHtml(readableVariantLabel(variant)) + '</small></span></label>';
      }).join("") || '<div class="variant-compare-empty">No matching Finished-Good Variants</div>';
      root.querySelector("[data-compare-count]").textContent = String(selected.length);
      confirm.disabled = selected.length < 2 || selected.length > MAX_COMPARE_VARIANTS;
      list.querySelectorAll('input[type="checkbox"]').forEach(function (checkbox) {
        checkbox.onchange = function () {
          if (checkbox.checked) {
            if (selected.length >= MAX_COMPARE_VARIANTS) {
              checkbox.checked = false;
              root.querySelector("[data-compare-error]").hidden = false;
              root.querySelector("[data-compare-error]").textContent = "Compare a maximum of three Finished-Good Variants.";
              return;
            }
            selected.push(checkbox.value);
          } else {
            selected = selected.filter(function (id) { return id !== checkbox.value; });
          }
          root.querySelector("[data-compare-error]").hidden = true;
          renderOptions();
        };
      });
    }
    search.oninput = renderOptions;
    footer.querySelector("[data-compare-cancel]").onclick = app.components.modal.close;
    confirm.onclick = function () {
      if (selected.length < 2 || selected.length > MAX_COMPARE_VARIANTS) return;
      comparisonVariantIds = selected.slice(0, MAX_COMPARE_VARIANTS);
      viewMode = "compare";
      showOnlyDifferences = false;
      app.components.modal.close();
      app.router.render();
    };
    renderOptions();
  }

  function saveDraftConfiguration() {
    if (!dirty) return false;
    if (!activeVariant || !activeVariant.id) throw new Error("Select a Finished-Good Variant before saving the Feature Configuration.");
    validateDraftValues();
    var configuration = app.domain.featureConfigurationService.ensureConfigurationForSeatVariant(activeVariant.id, {
      name: activeVariant.variantName || activeVariant.variantCode || activeVariant.id,
      trimMaterial: getTrimValue()
    });
    app.domain.featureConfigurationService.replaceSelections(configuration.id, draftFeatures.map(function (feature) {
      return { featureId: feature.id, selectedValue: draftValues[feature.id] };
    }));
    activeConfiguration = app.domain.featureConfigurationService.getConfigurationForSeatVariant(activeVariant.id);
    baselineValues = app.utils.clone(draftValues);
    dirty = false;
    app.events.emit("feature-matrix:saved", { variantId: activeVariant.id, configurationId: activeConfiguration && activeConfiguration.id });
    app.events.emit("configuration:changed", { variantId: activeVariant.id, configurationId: activeConfiguration && activeConfiguration.id });
    return true;
  }

  function validateDraftValues() {
    draftFeatures.forEach(function (feature) {
      var type = String(feature.valueType || "BOOLEAN").toUpperCase();
      var value = draftValues[feature.id];
      if (type === "NUMBER" && value !== "" && !isFinite(Number(value))) {
        throw new Error((feature.name || feature.featureCode) + " must contain a valid number.");
      }
      if ((type === "ENUM" || (feature.allowedValues || []).length) && value && (feature.allowedValues || []).indexOf(value) === -1) {
        throw new Error((feature.name || feature.featureCode) + " must use an allowed value.");
      }
    });
  }

  function setDraftValue(featureId, value) {
    draftValues[featureId] = value;
    dirty = !sameValueMap(draftValues, baselineValues);
  }

  function updateDirtyUi(container) {
    var indicator = container.querySelector("[data-dirty-indicator]");
    if (indicator) indicator.textContent = dirty ? "Unsaved changes" : "Changes saved";
    var save = container.querySelector('[data-action="save-feature-configuration"]');
    if (save) save.hidden = !dirty;
  }

  function rerender(container) {
    container.innerHTML = renderWorkspace();
    bindWorkspace(container);
    app.utils.bindWorkspaceHeaderContext(container);
    registerTransitionGuard();
  }

  function filterNormalRows(container, value) {
    var term = normalizeSearch(value);
    container.querySelectorAll("[data-feature-category]").forEach(function (categoryRow) {
      var category = categoryRow.getAttribute("data-feature-category");
      var rows = Array.from(container.querySelectorAll('[data-category="' + cssEscape(category) + '"]'));
      var visible = 0;
      rows.forEach(function (row) {
        var matches = !term || normalizeSearch(row.textContent).indexOf(term) !== -1;
        row.hidden = !matches || (!term && expandedCategories[category] === false);
        if (matches) visible += 1;
      });
      categoryRow.hidden = visible === 0;
    });
  }

  function filterComparisonRows(container, value) {
    var term = normalizeSearch(value);
    container.querySelectorAll("[data-compare-feature]").forEach(function (row) {
      row.hidden = term && normalizeSearch(row.textContent).indexOf(term) === -1;
    });
  }

  function groupFeatures(features) {
    var byCategory = {};
    (features || []).forEach(function (feature) {
      var category = String(feature.category || "Uncategorized").trim() || "Uncategorized";
      byCategory[category] = byCategory[category] || [];
      byCategory[category].push(feature);
    });
    return Object.keys(byCategory).sort().map(function (name) {
      return {
        name: name,
        features: byCategory[name].slice().sort(function (left, right) {
          return String(left.featureCode || left.name).localeCompare(String(right.featureCode || right.name));
        })
      };
    });
  }

  function buildExpandedCategories(features, existing) {
    var result = {};
    groupFeatures(features).forEach(function (group) {
      result[group.name] = existing[group.name] !== false;
    });
    return result;
  }

  function buildComparisonModel(features, variants, configurations, variantIds, differencesOnly) {
    if ((variantIds || []).length < 2) throw new Error("Select at least two Finished-Good Variants.");
    if (variantIds.length > MAX_COMPARE_VARIANTS) throw new Error("Compare a maximum of three Finished-Good Variants.");
    var variantById = indexById(variants);
    var configurationByVariantId = {};
    (configurations || []).forEach(function (configuration) {
      if (configuration.status === "ACTIVE") configurationByVariantId[configuration.seatVariantId] = configuration;
    });
    var selectedVariants = variantIds.map(function (id) { return variantById[id]; }).filter(Boolean);
    var rows = (features || []).map(function (feature) {
      var values = selectedVariants.map(function (variant) {
        var configuration = configurationByVariantId[variant.id];
        if (!configuration) return null;
        var selection = (configuration.selections || []).find(function (item) { return item.featureId === feature.id; });
        return selection ? selection.selectedValue : defaultFeatureValue(feature, variant);
      });
      return {
        featureId: feature.id,
        featureCode: feature.featureCode || feature.code || feature.id,
        featureName: feature.name,
        values: values,
        different: values.some(function (value) { return normalizedComparableValue(value) !== normalizedComparableValue(values[0]); })
      };
    });
    if (differencesOnly) rows = rows.filter(function (row) { return row.different; });
    return { variants: selectedVariants, rows: rows };
  }

  function valuesForConfiguration(features, configuration, variant, applyDefaults) {
    var selectionByFeatureId = {};
    (configuration && configuration.selections || []).forEach(function (selection) {
      selectionByFeatureId[selection.featureId] = selection.selectedValue;
    });
    var values = {};
    (features || []).forEach(function (feature) {
      values[feature.id] = Object.prototype.hasOwnProperty.call(selectionByFeatureId, feature.id)
        ? selectionByFeatureId[feature.id]
        : (applyDefaults ? defaultFeatureValue(feature, variant || {}) : null);
    });
    return values;
  }

  function defaultFeatureValue(feature, variant) {
    var type = String(feature.valueType || "BOOLEAN").toUpperCase();
    if (type === "BOOLEAN") {
      var applicability = feature.applicabilityByGrade || {};
      return applicability[variant && variant.grade] ? "YES" : "NO";
    }
    if ((feature.allowedValues || []).length) return feature.allowedValues[0];
    return "";
  }

  function filterVariants(variants, term) {
    var normalized = normalizeSearch(term);
    return (variants || []).filter(function (variant) {
      var haystack = normalizeSearch([
        variant.variantCode,
        variant.variantName,
        variant.customer,
        variant.brand,
        variant.seatType,
        variant.seatFamily,
        variant.grade,
        variant.side
      ].filter(Boolean).join(" "));
      return !normalized || normalized.split(/\s+/).every(function (token) { return haystack.indexOf(token) !== -1; });
    }).sort(function (left, right) { return readableVariantLabel(left).localeCompare(readableVariantLabel(right)); });
  }

  function defaultComparisonSelection() {
    var ids = [];
    if (activeVariant && activeVariant.id) ids.push(activeVariant.id);
    availableVariants.some(function (variant) {
      if (ids.indexOf(variant.id) === -1) ids.push(variant.id);
      return ids.length === 2;
    });
    return ids;
  }

  function readableVariantLabel(variant) {
    return [
      variant.customer || variant.brand,
      variant.seatType || variant.seatFamily,
      variant.side,
      variant.grade
    ].filter(Boolean).join(" ") || variant.variantCode || variant.variantName || variant.id || "Variant";
  }

  function displayValue(value) {
    if (value === null || value === undefined || value === "") return "-";
    if (String(value).toUpperCase() === "YES") return "Yes";
    if (String(value).toUpperCase() === "NO") return "No";
    return String(value);
  }

  function getTrimValue() {
    var trimFeature = draftFeatures.find(function (feature) {
      var code = feature.featureCode || feature.code;
      return code === "TRIM_MATERIAL" || code === "TRIM";
    });
    return trimFeature ? draftValues[trimFeature.id] || "" : "";
  }

  function createFeatureFromPrompt() {
    var code = window.prompt("Feature Code");
    if (!code) return;
    var name = window.prompt("Feature Name", code);
    if (!name) return;
    var category = window.prompt("Feature Category", "Uncategorized") || "Uncategorized";
    var type = (window.prompt("Value Type: BOOLEAN, ENUM, TEXT, NUMBER", "BOOLEAN") || "BOOLEAN").toUpperCase();
    var allowed = type === "ENUM" ? (window.prompt("Allowed Values, comma-separated", "") || "").split(",").map(trim).filter(Boolean) : (type === "BOOLEAN" ? ["YES", "NO"] : []);
    app.domain.featureService.createFeature({ featureCode: code, name: name, category: category, description: "", valueType: type, allowedValues: allowed, status: "ACTIVE" });
    app.services.notificationService.notify("Feature added", "success");
    app.router.render();
  }

  function editSelectedFeature() {
    var feature = findFeature(selectedFeatureId);
    if (!feature) return;
    var name = window.prompt("Feature Name", feature.name);
    if (!name) return;
    var category = window.prompt("Feature Category", feature.category || "Uncategorized") || "Uncategorized";
    app.domain.featureService.updateFeature(feature.id, {
      name: name,
      description: feature.description,
      category: category,
      valueType: feature.valueType,
      allowedValues: feature.allowedValues
    });
    app.services.notificationService.notify("Feature updated", "success");
    app.router.render();
  }

  function selectFeature(feature) {
    app.state.setSelection({
      type: "Feature",
      id: feature.id,
      name: feature.name,
      status: feature.status || "ACTIVE",
      owner: "Feature Master",
      featureCode: feature.featureCode,
      valueType: feature.valueType,
      remarks: feature.description || feature.remarks || ""
    });
  }

  function findFeature(featureId) {
    return draftFeatures.find(function (feature) { return feature.id === featureId; });
  }

  function sameValueMap(left, right) {
    var keys = Object.keys(left || {}).concat(Object.keys(right || {}));
    return keys.every(function (key) { return String(left[key] == null ? "" : left[key]) === String(right[key] == null ? "" : right[key]); });
  }

  function normalizedComparableValue(value) {
    return String(value == null ? "" : value).trim().toUpperCase();
  }

  function normalizeSearch(value) {
    return String(value || "").trim().toLowerCase();
  }

  function isAffirmative(value) {
    return value === true || String(value || "").toUpperCase() === "YES" || String(value || "").toUpperCase() === "TRUE";
  }

  function indexById(collection) {
    var result = {};
    (collection || []).forEach(function (item) { result[item.id] = item; });
    return result;
  }

  function cssEscape(value) {
    return String(value || "").replace(/(["\\])/g, "\\$1");
  }

  function businessMessage(error, fallback) {
    return error && error.errors && error.errors[0] && error.errors[0].message || error && error.message || fallback;
  }

  function trim(value) {
    return String(value == null ? "" : value).trim();
  }

  function resetViewState() {
    viewMode = "normal";
    comparisonVariantIds = [];
    showOnlyDifferences = false;
    selectedFeatureId = null;
    dirty = false;
    if (app.router && app.router.clearTransitionGuard) app.router.clearTransitionGuard();
  }

  app.featureMatrixView = {
    MAX_COMPARE_VARIANTS: MAX_COMPARE_VARIANTS,
    buildComparisonModel: buildComparisonModel,
    filterVariants: filterVariants,
    valuesForConfiguration: valuesForConfiguration,
    readableVariantLabel: readableVariantLabel,
    setDraftValue: setDraftValue,
    isDirty: function () { return dirty; }
  };
})(window.DEP = window.DEP || {});
