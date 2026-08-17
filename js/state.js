(function (app) {
  var ROLE_LABELS = {
    ENGINEERING: "Engineering",
    COMMODITY_MANAGER: "Purchase / Commodity Manager",
    PROGRAM_MANAGER: "Program / CFT"
  };
  var ROLE_CODES = {
    Engineering: "ENGINEERING",
    "Purchase / Commodity Manager": "COMMODITY_MANAGER",
    "Program / CFT": "PROGRAM_MANAGER"
  };
  var MODULE_KEYS = {
    STRUCTURE: "structure",
    FOAM: "foam",
    PLASTIC: "plastic",
    TRIM: "trim",
    HEAD_REST: "headrest",
    ARM_REST: "armrest"
  };
  var uiState = {
    currentUser: { name: "Portfolio Engineer", role: "Lead Engineer" },
    currentSelection: null,
    notifications: [],
    engineeringWorkspaceViews: {},
    completeSeatView: { expandedNodeIds: [] }
  };

  function get() {
    var state = app.core.appState.getState();
    if (ensureValidContext(state)) state = app.core.appState.getState();
    var context = state.context || {};
    var activeProgram = findById(state.programs, context.activeProgramId) || {};
    var activeVariant = findById(state.seatVariants, context.activeSeatVariantId) || {};
    var activeConfig = getActiveConfiguration(state, activeVariant.id);
    var snapshot = {
      currentUser: clone(uiState.currentUser),
      currentWorkspace: mapWorkspaceFromContext(context.activeWorkspace),
      currentSelection: clone(uiState.currentSelection),
      currentRevision: getCurrentRevision(state, activeVariant.id),
      currentRole: ROLE_LABELS[context.activeRole] || "Engineering",
      lifecycleStatus: "In Engineering",
      program: toProgramProjection(activeProgram),
      variant: toVariantProjection(activeVariant),
      programs: state.programs.map(toProgramListProjection),
      seatVariants: clone(state.seatVariants),
      features: clone(state.features),
      featureConfigurations: clone(state.featureConfigurations),
      activeFeatureConfiguration: clone(activeConfig || null),
      featureMatrix: projectFeatureMatrix(state),
      demoConfigurations: projectFinishedGoodVariants(state),
      activeConfiguredSeat: projectConfiguredSeat(activeVariant, activeConfig, state.features),
      completeSeat: { expandedNodeIds: uiState.completeSeatView.expandedNodeIds.slice() },
      engineeringWorkspaceViews: clone(uiState.engineeringWorkspaceViews),
      engineeringBomContexts: {},
      commercialRecords: clone(state.commercialRecords || []),
      commercialAssessments: clone(state.commercialAssessments || []),
      suppliers: clone(state.suppliers || []),
      commodities: clone(state.commodities || []),
      commodityCategories: clone(state.commodityCategories || []),
      variantCommodityMappings: clone(state.variantCommodityMappings || []),
      engineeringChanges: clone((state.engineeringChanges || []).map(function (change) {
        return app.domain.engineeringChangeService ? app.domain.engineeringChangeService.normalizeEngineeringChange(change) : change;
      })),
      revisions: clone((state.revisions || []).map(function (revision) {
        return app.domain.revisionService ? app.domain.revisionService.normalizeRevision(revision) : revision;
      })),
      notifications: uiState.notifications.slice(),
      auditEvents: clone(state.auditEvents || [])
    };
    Object.keys(MODULE_KEYS).forEach(function (moduleCode) {
      var moduleKey = MODULE_KEYS[moduleCode];
      var projected = projectEngineeringContext(state, moduleCode);
      snapshot[moduleKey] = projected.rows;
      snapshot.engineeringBomContexts[moduleKey] = projected.bom;
      snapshot.engineeringWorkspaceViews[moduleKey] = snapshot.engineeringWorkspaceViews[moduleKey] || { expandedNodeIds: getDefaultExpandedRows(projected.rows) };
    });
    return snapshot;
  }

  function getCurrentWorkspace() {
    return mapWorkspaceFromContext(app.core.appState.getContext().activeWorkspace);
  }

  function setWorkspace(workspaceId) {
    app.core.contextService.setActiveWorkspace(workspaceId);
    uiState.currentSelection = null;
    emitStateChanged();
  }

  function setRole(role) {
    app.core.contextService.setActiveRole(ROLE_CODES[role] || role || "ENGINEERING");
    emitStateChanged();
    app.events.emit("role:changed", get().currentRole);
  }

  function setSelection(selection) {
    uiState.currentSelection = selection ? clone(selection) : null;
    emitStateChanged();
  }

  function clearSelection() {
    setSelection(null);
  }

  function resetContextScopedUiState() {
    uiState.currentSelection = null;
    uiState.engineeringWorkspaceViews = {};
    uiState.completeSeatView = { expandedNodeIds: [] };
  }

  function setFeatureMatrix(features, configuredSeat) {
    var appState = app.core.appState.getState();
    var activeVariant = findVariantByConfiguration(appState, configuredSeat) || findById(appState.seatVariants, appState.context.activeSeatVariantId);
    if (activeVariant) {
      var activeGradeKey = gradeKeyFromGrade(activeVariant.grade);
      features.forEach(function (feature) {
        if ((feature.valueType || "BOOLEAN") === "BOOLEAN" && feature.valuesByVariant && Object.prototype.hasOwnProperty.call(feature, activeGradeKey)) {
          feature.valuesByVariant[activeVariant.id] = feature[activeGradeKey] ? "YES" : "NO";
        }
      });
    }
    features.forEach(function (feature) {
      var current = app.domain.featureService.getFeatureById(feature.id);
      if (!current) return;
      app.domain.featureService.updateFeature(feature.id, {
        name: feature.name || current.name,
        description: feature.description || current.description,
        category: feature.category || current.category,
        valueType: feature.valueType || current.valueType,
        allowedValues: feature.allowedValues || current.allowedValues || [],
        applicabilityByGrade: {
          E2: Boolean(feature.e2),
          E3: Boolean(feature.e3),
          E4: Boolean(feature.e4),
          "E4+": Boolean(feature.e4plus)
        },
        remarks: feature.remarks || current.remarks || ""
      });
    });
    if (activeVariant) {
      var configuration = app.domain.featureConfigurationService.ensureConfigurationForSeatVariant(activeVariant.id, {
        name: activeVariant.variantName || activeVariant.variantCode || activeVariant.id,
        trimMaterial: getMatrixTrimValue(features, activeVariant.id) || "Fabric"
      });
      var refreshed = app.core.appState.getState();
      app.domain.featureConfigurationService.replaceSelections(configuration.id, deriveSelectionsFromMatrix(refreshed.features, features, activeVariant.id, activeVariant.grade));
      app.core.contextService.setActiveBusinessContext({
        programId: activeVariant.programId,
        seatVariantId: activeVariant.id
      });
    }
    emitStateChanged();
    app.events.emit("feature-matrix:saved", get().featureMatrix);
    app.events.emit("configuration:changed", get().activeConfiguredSeat);
  }

  function setCompleteSeatView(viewState) {
    uiState.completeSeatView = {
      expandedNodeIds: (viewState && viewState.expandedNodeIds || []).slice()
    };
    emitStateChanged();
    app.events.emit("complete-seat:saved", get().completeSeat);
  }

  function setEngineeringModule(moduleKey, rows, options) {
    var moduleCode = moduleCodeFromKey(moduleKey);
    app.domain.engineeringDisciplineService.saveModuleRows(moduleCode, rows || [], options || {});
    emitStateChanged();
    app.events.emit("engineering-module:saved", {
      moduleKey: moduleKey,
      rows: clone(get()[moduleKey] || [])
    });
  }

  function setEngineeringWorkspaceView(moduleKey, viewState) {
    uiState.engineeringWorkspaceViews[moduleKey] = {
      expandedNodeIds: (viewState && viewState.expandedNodeIds || []).slice()
    };
    emitStateChanged();
    app.events.emit("engineering-workspace:view-saved", {
      moduleKey: moduleKey,
      view: clone(uiState.engineeringWorkspaceViews[moduleKey])
    });
  }

  function addNotification(message, tone) {
    var notification = {
      id: app.utils.createId("NTF"),
      message: message,
      tone: tone || "info",
      createdAt: new Date().toISOString()
    };
    uiState.notifications.unshift(notification);
    emitStateChanged();
    app.events.emit("notification:created", notification);
  }

  function save() {
    addNotification("Saved successfully", "success");
  }

  function reset() {
    app.core.appState.resetToSeed();
    uiState.currentSelection = null;
    uiState.notifications = [];
    uiState.engineeringWorkspaceViews = {};
    uiState.completeSeatView = { expandedNodeIds: [] };
    ensureValidContext(app.core.appState.getState());
    emitStateChanged();
    app.events.emit("demo:reset", get());
    addNotification("Demo data reset", "success");
  }

  function repairContext() {
    ensureValidContext(app.core.appState.getState());
    emitStateChanged();
  }

  function ensureValidContext(state) {
    var context = state.context || {};
    var programs = state.programs || [];
    var variants = state.seatVariants || [];
    var configurations = state.featureConfigurations || [];
    if (!programs.length) return false;
    var activeProgram = findById(programs, context.activeProgramId);
    var activeVariant = findById(variants, context.activeSeatVariantId);
    var variantMatchesProgram = activeProgram && activeVariant && activeVariant.programId === activeProgram.id;
    var activeConfiguration = findById(configurations, context.activeFeatureConfigurationId);
    var configurationMatchesVariant = activeConfiguration && activeVariant && activeConfiguration.seatVariantId === activeVariant.id;
    if (activeProgram && variantMatchesProgram && configurationMatchesVariant) return false;
    // A Programme may be selected before its first Finished-Good Variant is created.
    // Keep that valid partial context instead of silently switching back to demo data.
    if (activeProgram && !activeVariant) return false;
    if (activeProgram && variantMatchesProgram) {
      var matchingConfiguration = configurations.find(function (configuration) {
        return configuration.seatVariantId === activeVariant.id && (configuration.status || "ACTIVE") === "ACTIVE";
      });
      if (matchingConfiguration) {
        app.core.appState.transaction(function (draft) {
          draft.context = Object.assign({}, draft.context, {
            activeProgramId: activeProgram.id,
            activeSeatVariantId: activeVariant.id,
            activeFeatureConfigurationId: matchingConfiguration.id
          });
          app.core.appState._recordAuditEvent(draft, {
            objectType: "CONTEXT",
            objectId: "ACTIVE_CONTEXT",
            action: "CONTEXT_REPAIRED",
            details: "Active Feature Configuration was aligned with the selected Finished-Good Variant."
          });
        });
        return true;
      }
      if (!configurations.some(function (configuration) { return configuration.seatVariantId === activeVariant.id; })) return false;
    }

    var repaired = chooseDefaultContext(state, activeProgram);
    app.core.appState.transaction(function (draft) {
      draft.context = Object.assign({}, draft.context, repaired);
      app.core.appState._recordAuditEvent(draft, {
        objectType: "CONTEXT",
        objectId: "ACTIVE_CONTEXT",
        action: "CONTEXT_REPAIRED",
        details: "Invalid persisted context was normalised for the source demo shell."
      });
    });
    return true;
  }

  function chooseDefaultContext(state, preferredProgram) {
    var programs = state.programs || [];
    var variants = state.seatVariants || [];
    var boms = state.engineeringBoms || [];
    var configurations = state.featureConfigurations || [];
    var candidatePrograms = preferredProgram ? [preferredProgram] : programs;
    var selectedProgram = candidatePrograms.find(function (program) {
      return variants.some(function (variant) {
        return variant.programId === program.id && hasVariantDemoData(variant.id, boms, configurations);
      });
    }) || programs.find(function (program) {
      return variants.some(function (variant) {
        return variant.programId === program.id && hasVariantDemoData(variant.id, boms, configurations);
      });
    }) || preferredProgram || programs[0];
    var selectedVariant = variants.find(function (variant) {
      return selectedProgram && variant.programId === selectedProgram.id && hasVariantDemoData(variant.id, boms, configurations);
    }) || variants.find(function (variant) {
      return selectedProgram && variant.programId === selectedProgram.id;
    }) || null;
    var selectedConfiguration = selectedVariant && configurations.find(function (configuration) {
      return configuration.seatVariantId === selectedVariant.id && (configuration.status || "ACTIVE") === "ACTIVE";
    });
    return {
      activeProgramId: selectedProgram && selectedProgram.id || null,
      activeSeatVariantId: selectedVariant && selectedVariant.id || null,
      activeFeatureConfigurationId: selectedConfiguration && selectedConfiguration.id || null
    };
  }

  function hasVariantDemoData(variantId, boms, configurations) {
    return configurations.some(function (configuration) {
      return configuration.seatVariantId === variantId;
    }) && boms.some(function (bom) {
      return bom.seatVariantId === variantId;
    });
  }

  function projectFeatureMatrix(state) {
    var configurationsByVariant = indexByKey(state.featureConfigurations || [], "seatVariantId");
    var activeVariantId = state.context && state.context.activeSeatVariantId;
    var activeVariant = findById(state.seatVariants || [], activeVariantId);
    var activeConfiguration = activeVariant && configurationsByVariant[activeVariant.id];
    var selectionByFeatureId = {};
    (activeConfiguration && activeConfiguration.selections || []).forEach(function (selection) {
      selectionByFeatureId[selection.featureId] = selection.selectedValue;
    });
    return (state.features || []).map(function (feature) {
      var applicability = feature.applicabilityByGrade || {};
      var valuesByVariant = {};
      if (activeVariant) {
        valuesByVariant[activeVariant.id] = Object.prototype.hasOwnProperty.call(selectionByFeatureId, feature.id)
          ? selectionByFeatureId[feature.id]
          : defaultFeatureValue(feature, activeVariant.grade, applicability);
      }
      return {
        id: feature.id,
        featureCode: feature.featureCode || feature.code || feature.id,
        name: feature.name,
        description: feature.description || "",
        category: feature.category || "",
        valueType: feature.valueType || "BOOLEAN",
        allowedValues: (feature.allowedValues || []).slice(),
        status: feature.status || "ACTIVE",
        valuesByVariant: valuesByVariant,
        e2: Boolean(applicability.E2),
        e3: Boolean(applicability.E3),
        e4: Boolean(applicability.E4),
        e4plus: Boolean(applicability["E4+"]),
        remarks: feature.remarks || ""
      };
    });
  }

  function projectConfiguredSeat(variant, configuration, features) {
    variant = variant || {};
    configuration = configuration || {};
    var featureById = {};
    (features || []).forEach(function (feature) {
      featureById[feature.id] = feature;
    });
    var selectedFeatures = [];
    var trimMaterial = configuration.trimMaterial || "";
    (configuration.selections || []).forEach(function (selection) {
      var feature = featureById[selection.featureId];
      if (!feature) return;
      if ((feature.featureCode || feature.code) === "TRIM_MATERIAL" || (feature.featureCode || feature.code) === "TRIM") trimMaterial = selection.selectedValue;
      else if (selection.selectedValue && selection.selectedValue !== "NO") selectedFeatures.push(feature.name);
    });
    return {
      id: configuration.id || variant.id || "",
      variantId: variant.id || "",
      featureConfigurationId: configuration.id || "",
      seatFamily: variant.seatFamily || "",
      brand: variant.brand || variant.customer || "",
      customer: variant.customer || variant.brand || "",
      seatType: variant.seatType || variant.seatFamily || "",
      variantCode: variant.variantCode || "",
      finishedGoodPartNumber: variant.finishedGoodPartNumber || "",
      oemFinishedGoodPartNumber: variant.oemFinishedGoodPartNumber || "",
      side: variant.side || "",
      grade: variant.grade || "",
      trimMaterial: trimMaterial || "",
      completeSeatImageReference: variant.completeSeatImageReference || "",
      selectedFeatures: selectedFeatures
    };
  }

  function projectEngineeringContext(state, moduleCode) {
    var module = findModuleByCode(state, moduleCode);
    if (!module) return { rows: [], bom: null };
    var context = state.context || {};
    var bom = (state.engineeringBoms || []).find(function (candidate) {
      return candidate.programId === context.activeProgramId &&
        candidate.seatVariantId === context.activeSeatVariantId &&
        candidate.engineeringModuleId === module.id;
    });
    if (!bom) return { rows: [], bom: null };
    var partsById = indexById(state.parts || []);
    var rows = [];
    var root = partsById[bom.rootPartId];
    if (root) rows.push(partToRow(root, null, null, bom));
    var rowIdByPartId = {};
    if (root) rowIdByPartId[root.id] = root.id;
    var orderedItems = (bom.items || []).slice().sort(function (a, b) {
      return Number(a.sequence || 0) - Number(b.sequence || 0) || String(a.id).localeCompare(String(b.id));
    });
    orderedItems.forEach(function (item) {
      var part = partsById[item.childPartId];
      if (part && part.partType === "ASSEMBLY" && !rowIdByPartId[part.id]) rowIdByPartId[part.id] = item.id;
    });
    orderedItems.forEach(function (item) {
      var part = partsById[item.childPartId];
      if (!part) return;
      var row = partToRow(part, rowIdByPartId[item.parentPartId] || item.parentPartId, item, bom);
      row.id = item.id;
      rows.push(row);
      if (!rowIdByPartId[part.id]) rowIdByPartId[part.id] = row.id;
    });
    return {
      rows: rows,
      bom: {
        id: bom.id,
        programId: bom.programId,
        seatVariantId: bom.seatVariantId,
        engineeringModuleId: bom.engineeringModuleId,
        rootPartId: bom.rootPartId,
        lifecycleState: bom.lifecycleState,
        completionStatus: bom.completionStatus,
        itemCount: (bom.items || []).length,
        moduleCode: module.code,
        moduleName: module.name || module.label || module.code
      }
    };
  }

  function partToRow(part, parentPartId, bomItem, bom) {
    return {
      id: part.id,
      partId: part.id,
      bomItemId: bomItem && bomItem.id || "",
      type: part.partType === "ASSEMBLY" ? "Assembly" : "Part",
      partNumber: part.partNumber || part.id,
      internalPartNumber: part.internalPartNumber || part.partNumber || "",
      oemPartNumber: part.oemPartNumber || "",
      description: part.description || part.name || "",
      category: part.category || "",
      revision: part.currentRevision || "",
      drawingNumber: part.drawingNumber || "",
      drawingRevision: part.drawingRevision || "",
      commodity: part.commodity || "",
      material: part.material || "",
      gauge: part.gauge || "",
      quantity: bomItem ? String(bomItem.quantity) : "1",
      oemJit: bomItem && bomItem.oemJit || "",
      internalJit: bomItem && bomItem.internalJit || "",
      unitOfMeasure: bomItem ? bomItem.unitOfMeasure : part.unitOfMeasure || "EA",
      cadWeight: part.cadWeight != null ? String(part.cadWeight) : "",
      totalCadWeight: bomItem && bomItem.totalCadWeight != null ? String(bomItem.totalCadWeight) : calculateTotalCadWeight(part, bomItem ? bomItem.quantity : 1),
      changeClassification: bomItem && bomItem.changeClassification || "UNCHANGED",
      remark: bomItem && bomItem.remark || "",
      imageReference: part.imageReference || "",
      threeDSharedDate: part.threeDSharedDate || "",
      twoDSharedDate: part.twoDSharedDate || "",
      weight: part.weight || (part.mass ? part.mass + " kg" : ""),
      status: lifecycleLabel(part.lifecycleState || bom.lifecycleState),
      parentId: parentPartId || null,
      applicability: bomItem && bomItem.applicability || { requiredFeatureIds: [], excludedFeatureIds: [], requiredValues: [], excludedValues: [] }
    };
  }

  function deriveSelectionsFromMatrix(appStateFeatures, matrixFeatures, variantId, grade) {
    var matrixById = {};
    matrixFeatures.forEach(function (feature) { matrixById[feature.id] = feature; });
    var gradeKey = gradeKeyFromGrade(grade);
    return appStateFeatures.filter(function (feature) {
      var matrixFeature = matrixById[feature.id];
      if (!matrixFeature) return false;
      var value = matrixFeature.valuesByVariant ? matrixFeature.valuesByVariant[variantId] : null;
      if (value != null && value !== "") {
        if ((feature.valueType || matrixFeature.valueType || "BOOLEAN") === "BOOLEAN") return String(value).toUpperCase() !== "NO";
        return true;
      }
      return matrixFeature[gradeKey];
    }).map(function (feature) {
      var matrixFeature = matrixById[feature.id];
      var value = matrixFeature.valuesByVariant ? matrixFeature.valuesByVariant[variantId] : "";
      if (value == null || value === "") value = matrixFeature[gradeKey] ? "YES" : "NO";
      return { featureId: feature.id, selectedValue: value };
    });
  }

  function findVariantByConfiguration(state, configuredSeat) {
    if (!configuredSeat) return null;
    return (state.seatVariants || []).find(function (variant) {
      return variant.id === configuredSeat.id ||
        variant.id === configuredSeat.variantId ||
        (variant.seatFamily === configuredSeat.seatFamily &&
          (variant.brand === configuredSeat.brand || variant.customer === configuredSeat.brand || variant.customer === configuredSeat.customer) &&
          (!configuredSeat.seatType || variant.seatType === configuredSeat.seatType) &&
          variant.side === configuredSeat.side &&
          variant.grade === configuredSeat.grade);
    }) || null;
  }

  function projectFinishedGoodVariants(state) {
    var programId = state.context && state.context.activeProgramId;
    var variants = (state.seatVariants || []).filter(function (variant) {
      return !programId || variant.programId === programId;
    });
    return variants.map(function (variant) {
      var configuration = getActiveConfiguration(state, variant.id) || {};
      var projected = projectConfiguredSeat(variant, configuration, state.features || []);
      projected.id = variant.id;
      projected.label = [
        variant.customer || variant.brand,
        variant.seatType || variant.seatFamily,
        variant.side,
        variant.grade,
        variant.finishedGoodPartNumber
      ].filter(Boolean).join(" / ");
      return projected;
    });
  }

  function defaultFeatureValue(feature, grade, applicability) {
    if ((feature.featureCode || feature.code) === "TRIM" || (feature.featureCode || feature.code) === "TRIM_MATERIAL") {
      return grade === "E4" || grade === "E4+" ? "TEP" : "Fabric";
    }
    if (feature.valueType === "BOOLEAN") {
      return applicability && applicability[grade] ? "YES" : "NO";
    }
    return "";
  }

  function getMatrixTrimValue(features, variantId) {
    var trim = (features || []).find(function (feature) {
      return feature.featureCode === "TRIM" || feature.featureCode === "TRIM_MATERIAL";
    });
    return trim && trim.valuesByVariant ? trim.valuesByVariant[variantId] : "";
  }

  function getActiveConfiguration(state, seatVariantId) {
    var contextId = state.context && state.context.activeFeatureConfigurationId;
    var active = findById(state.featureConfigurations, contextId);
    if (active && active.seatVariantId === seatVariantId) return active;
    return (state.featureConfigurations || []).find(function (configuration) {
      return configuration.seatVariantId === seatVariantId && configuration.status === "ACTIVE";
    }) || null;
  }

  function toProgramProjection(program) {
    return {
      id: program.id || "",
      programCode: program.programCode || program.code || "",
      programName: program.name || "",
      customer: program.customer || "",
      vehiclePlatform: program.vehiclePlatform || "",
      status: statusLabel(program.status)
    };
  }

  function toProgramListProjection(program) {
    return {
      id: program.id,
      name: program.name,
      customer: program.customer,
      platform: program.vehiclePlatform,
      status: statusLabel(program.status),
      owner: program.ownerRole || "Program Manager"
    };
  }

  function toVariantProjection(variant) {
    return {
      id: variant.id || "",
      variantName: variant.variantName || "",
      variantCode: variant.variantCode || "",
      customer: variant.customer || variant.brand || "",
      brand: variant.brand || variant.customer || "",
      seatFamily: variant.seatFamily || "",
      seatType: variant.seatType || variant.seatFamily || "",
      side: variant.side || "",
      grade: variant.grade || "",
      finishedGoodPartNumber: variant.finishedGoodPartNumber || "",
      oemFinishedGoodPartNumber: variant.oemFinishedGoodPartNumber || "",
      description: variant.variantCode || "",
      status: statusLabel(variant.status)
    };
  }

  function getCurrentRevision(state, seatVariantId) {
    var revisions = (state.revisions || []).filter(function (revision) {
      return revision.seatVariantId === seatVariantId;
    }).map(function (revision) {
      return app.domain.revisionService ? app.domain.revisionService.normalizeRevision(revision) : revision;
    }).sort(function (a, b) {
      return String(a.revisionNumber || "").localeCompare(String(b.revisionNumber || ""));
    });
    return revisions.length ? revisions[revisions.length - 1].revisionNumber : "";
  }

  function emitStateChanged() {
    app.events.emit("state:changed");
  }

  function resetTransientState() {
    uiState.currentSelection = null;
    uiState.notifications = [];
    uiState.engineeringWorkspaceViews = {};
    uiState.completeSeatView = { expandedNodeIds: [] };
  }

  function mapWorkspaceFromContext(workspaceId) {
    if (workspaceId === "program-management") return "program";
    return workspaceId || "dashboard";
  }

  function moduleCodeFromKey(moduleKey) {
    if (moduleKey === "headrest") return "HEAD_REST";
    if (moduleKey === "armrest") return "ARM_REST";
    return String(moduleKey || "").toUpperCase();
  }

  function findModuleByCode(state, code) {
    var normalized = String(code || "").toUpperCase().replace(/[\s-]+/g, "_");
    return (state.engineeringModules || []).find(function (module) {
      return String(module.code || "").toUpperCase().replace(/[\s-]+/g, "_") === normalized;
    }) || null;
  }

  function getDefaultExpandedRows(rows) {
    var hasChildren = {};
    (rows || []).forEach(function (row) {
      if (row.parentId) hasChildren[row.parentId] = true;
    });
    return (rows || []).filter(function (row) {
      return !row.parentId && hasChildren[row.id];
    }).map(function (row) { return row.id; });
  }

  function gradeKeyFromGrade(grade) {
    return String(grade || "E2").toLowerCase().replace("+", "plus");
  }

  function lifecycleLabel(status) {
    if (status === "RELEASED") return "Released";
    if (status === "IN_WORK") return "In Work";
    if (status === "COMPLETE") return "Complete";
    return "Planned";
  }

  function calculateTotalCadWeight(part, quantity) {
    var base = Number(part && (part.cadWeight != null ? part.cadWeight : part.mass));
    if (isNaN(base)) return "";
    return String(base * Number(quantity || 1));
  }

  function statusLabel(status) {
    return String(status || "").toLowerCase().replace(/(^|_)([a-z])/g, function (_, prefix, character) {
      return (prefix ? " " : "") + character.toUpperCase();
    });
  }

  function indexById(collection) {
    var index = {};
    (collection || []).forEach(function (item) {
      index[item.id] = item;
    });
    return index;
  }

  function indexByKey(collection, key) {
    var index = {};
    (collection || []).forEach(function (item) {
      index[item[key]] = item;
    });
    return index;
  }

  function findById(collection, id) {
    return (collection || []).find(function (item) { return item.id === id; }) || null;
  }

  function clone(value) {
    return JSON.parse(JSON.stringify(value == null ? null : value));
  }

  app.state = {
    get: get,
    getCurrentWorkspace: getCurrentWorkspace,
    setWorkspace: setWorkspace,
    setRole: setRole,
    setSelection: setSelection,
    clearSelection: clearSelection,
    resetContextScopedUiState: resetContextScopedUiState,
    setFeatureMatrix: setFeatureMatrix,
    setCompleteSeatView: setCompleteSeatView,
    setEngineeringModule: setEngineeringModule,
    setEngineeringWorkspaceView: setEngineeringWorkspaceView,
    addNotification: addNotification,
    save: save,
    reset: reset,
    repairContext: repairContext,
    resetTransientState: resetTransientState
  };
})(window.DEP = window.DEP || {});
