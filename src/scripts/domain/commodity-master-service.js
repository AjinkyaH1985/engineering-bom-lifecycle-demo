(function (app) {
  app.domain = app.domain || {};

  var ACTIVE = "ACTIVE";
  var INACTIVE = "INACTIVE";

  function listCommodities(criteria) {
    criteria = criteria || {};
    var state = app.core.appState.getState();
    var categoriesById = indexById(state.commodityCategories || []);
    var search = normalizeSearch(criteria.search);
    var rows = (state.commodities || []).map(function (commodity) {
      return toCommodityView(commodity, categoriesById[commodity.categoryId]);
    }).filter(function (commodity) {
      if (criteria.categoryId && commodity.categoryId !== criteria.categoryId) return false;
      if (criteria.status && commodity.status !== criteria.status) return false;
      if (!search) return true;
      return normalizeSearch([commodity.code, commodity.name, commodity.description].join(" ")).indexOf(search) !== -1;
    }).sort(compareCommodities);
    return clone(rows);
  }

  function getCommodity(id) {
    var state = app.core.appState.getState();
    var commodity = findById(state.commodities, id);
    if (!commodity) return null;
    return clone(toCommodityView(commodity, findById(state.commodityCategories, commodity.categoryId)));
  }

  function listActiveCommodities(criteria) {
    return listCommodities(Object.assign({}, criteria || {}, { status: ACTIVE }));
  }

  function getMappingsForFinishedGoodVariant(finishedGoodVariantId) {
    return app.core.appState.getCollection("variantCommodityMappings").filter(function (mapping) {
      return mapping.finishedGoodVariantId === finishedGoodVariantId;
    });
  }

  function createCommodity(input) {
    assertPermission("commodities", "create");
    return app.core.appState.transaction(function (state) {
      var commodity = normalizeCommodity(input, state);
      validateCommodity(commodity, state, null);
      state.commodities.push(commodity);
      audit(state, "COMMODITY", commodity.id, "COMMODITY_CREATED", ["code", "name", "categoryId", "status"]);
    });
  }

  function updateCommodity(id, patch) {
    assertPermission("commodities", "edit");
    return app.core.appState.transaction(function (state) {
      var current = requireById(state.commodities, id, "Commodity");
      var updated = normalizeCommodity(Object.assign({}, current, patch || {}, { id: current.id, createdBy: current.createdBy, createdAt: current.createdAt }), state);
      validateImmutableId(patch, current.id, "Commodity");
      validateCommodity(updated, state, current.id);
      var fields = changedFields(current, updated);
      Object.assign(current, updated);
      audit(state, "COMMODITY", id, "COMMODITY_UPDATED", fields);
    });
  }

  function setCommodityStatus(id, status) {
    assertPermission("commodities", "edit");
    status = normalizeStatus(status);
    return app.core.appState.transaction(function (state) {
      var commodity = requireById(state.commodities, id, "Commodity");
      commodity.status = status;
      touch(commodity, state);
      audit(state, "COMMODITY", id, status === ACTIVE ? "COMMODITY_ACTIVATED" : "COMMODITY_DEACTIVATED", ["status"]);
    });
  }

  function getCommodityUsage(id) {
    var state = app.core.appState.getState();
    var mappings = (state.variantCommodityMappings || []).filter(function (mapping) { return mapping.commodityId === id; });
    return {
      inUse: mappings.length > 0,
      mappingCount: mappings.length,
      finishedGoodVariantIds: mappings.map(function (mapping) { return mapping.finishedGoodVariantId; })
    };
  }

  function listCategories(criteria) {
    criteria = criteria || {};
    return app.core.appState.getCollection("commodityCategories").filter(function (category) {
      return !criteria.status || category.status === criteria.status;
    }).sort(function (left, right) {
      return numberOr(left.displaySequence, 9999) - numberOr(right.displaySequence, 9999) || left.name.localeCompare(right.name);
    });
  }

  function createCategory(input) {
    assertPermission("commodityCategories", "create");
    return app.core.appState.transaction(function (state) {
      var category = normalizeCategory(input, state);
      validateCategory(category, state, null);
      state.commodityCategories.push(category);
      audit(state, "COMMODITY_CATEGORY", category.id, "COMMODITY_CATEGORY_CREATED", ["name", "description", "displaySequence", "status"]);
    });
  }

  function updateCategory(id, patch) {
    assertPermission("commodityCategories", "edit");
    return app.core.appState.transaction(function (state) {
      var current = requireById(state.commodityCategories, id, "Commodity Category");
      validateImmutableId(patch, current.id, "Commodity Category");
      var updated = normalizeCategory(Object.assign({}, current, patch || {}, { id: current.id, createdBy: current.createdBy, createdAt: current.createdAt }), state);
      validateCategory(updated, state, current.id);
      var fields = changedFields(current, updated);
      Object.assign(current, updated);
      audit(state, "COMMODITY_CATEGORY", id, "COMMODITY_CATEGORY_UPDATED", fields);
    });
  }

  function setCategoryStatus(id, status) {
    assertPermission("commodityCategories", "edit");
    status = normalizeStatus(status);
    return app.core.appState.transaction(function (state) {
      var category = requireById(state.commodityCategories, id, "Commodity Category");
      category.status = status;
      touch(category, state);
      audit(state, "COMMODITY_CATEGORY", id, status === ACTIVE ? "COMMODITY_CATEGORY_ACTIVATED" : "COMMODITY_CATEGORY_DEACTIVATED", ["status"]);
    });
  }

  function getMappingWorkspaceData(criteria) {
    criteria = criteria || {};
    var state = app.core.appState.getState();
    var context = state.context || {};
    var variantId = criteria.finishedGoodVariantId || criteria.seatVariantId || context.activeSeatVariantId || "";
    var variant = findById(state.seatVariants, variantId);
    var program = variant ? findById(state.programs, variant.programId) : null;
    var categoriesById = indexById(state.commodityCategories || []);
    var mappings = (state.variantCommodityMappings || []).filter(function (mapping) {
      return mapping.finishedGoodVariantId === variantId;
    });
    var mappingByCommodityId = {};
    mappings.forEach(function (mapping) { mappingByCommodityId[mapping.commodityId] = mapping; });
    var commodities = (state.commodities || []).map(function (commodity) {
      var row = toCommodityView(commodity, categoriesById[commodity.categoryId]);
      row.assigned = Boolean(mappingByCommodityId[commodity.id]);
      row.mappingId = row.assigned ? mappingByCommodityId[commodity.id].id : "";
      row.selectable = commodity.status === ACTIVE || row.assigned;
      return row;
    }).sort(compareCommodities);
    return {
      program: clone(program),
      variant: clone(variant),
      commodities: clone(commodities),
      mappings: clone(mappings),
      assignedCommodityIds: mappings.map(function (mapping) { return mapping.commodityId; }),
      categories: listCategories(),
      canEdit: canManage("variantCommodityMappings"),
      identity: { programId: program && program.id || "", finishedGoodVariantId: variantId }
    };
  }

  function saveCommodityMappings(finishedGoodVariantId, commodityIds) {
    assertPermission("variantCommodityMappings", "edit");
    var selectedIds = (commodityIds || []).map(trim).filter(Boolean);
    return app.core.appState.transaction(function (state) {
      var variant = requireById(state.seatVariants, finishedGoodVariantId, "Finished-Good Variant");
      var commoditiesById = indexById(state.commodities || []);
      var current = (state.variantCommodityMappings || []).filter(function (mapping) {
        return mapping.finishedGoodVariantId === variant.id;
      });
      var currentIds = {};
      current.forEach(function (mapping) { currentIds[mapping.commodityId] = true; });
      selectedIds.forEach(function (commodityId) {
        var commodity = commoditiesById[commodityId];
        if (!commodity) fail("COMMODITY_MAPPING_REFERENCE_INVALID", "The selected Commodity does not exist.", "COMMODITY", commodityId);
        if (commodity.status !== ACTIVE && !currentIds[commodityId]) {
          fail("COMMODITY_MAPPING_INACTIVE", "Inactive Commodities cannot be selected for a new mapping.", "COMMODITY", commodityId);
        }
      });
      var selectedSet = {};
      selectedIds.forEach(function (id) {
        if (selectedSet[id]) fail("COMMODITY_MAPPING_DUPLICATE", "A Commodity may be assigned only once to a Finished-Good Variant.", "COMMODITY", id);
        selectedSet[id] = true;
      });
      state.variantCommodityMappings = (state.variantCommodityMappings || []).filter(function (mapping) {
        return mapping.finishedGoodVariantId !== variant.id || selectedSet[mapping.commodityId];
      });
      var retainedByCommodity = {};
      state.variantCommodityMappings.forEach(function (mapping) {
        if (mapping.finishedGoodVariantId === variant.id) retainedByCommodity[mapping.commodityId] = mapping;
      });
      selectedIds.forEach(function (commodityId) {
        var mapping = retainedByCommodity[commodityId];
        if (mapping) {
          mapping.status = ACTIVE;
          touch(mapping, state);
          return;
        }
        var stamp = auditFields(state);
        state.variantCommodityMappings.push(Object.assign({
          id: mappingId(variant.id, commodityId),
          finishedGoodVariantId: variant.id,
          commodityId: commodityId,
          status: ACTIVE,
          source: "USER_MAPPING"
        }, stamp));
      });
      audit(state, "FINISHED_GOOD_VARIANT", variant.id, "COMMODITY_MAPPING_SAVED", ["commodityIds"], {
        commodityIds: selectedIds,
        mappingCount: selectedIds.length
      });
    });
  }

  function normalizeCommodity(input, state) {
    input = input || {};
    var code = normalizeCode(input.code);
    var stamp = auditFields(state);
    return {
      id: trim(input.id) || uniqueId(state.commodities, "CMD-" + idToken(code)),
      code: code,
      name: trim(input.name),
      categoryId: trim(input.categoryId),
      description: trim(input.description),
      unitOfMeasure: trim(input.unitOfMeasure),
      displaySequence: optionalNumber(input.displaySequence),
      status: normalizeStatus(input.status || ACTIVE),
      createdBy: trim(input.createdBy) || stamp.createdBy,
      createdAt: input.createdAt || stamp.createdAt,
      updatedBy: stamp.updatedBy,
      updatedAt: stamp.updatedAt,
      sourceValues: clone(input.sourceValues || [])
    };
  }

  function normalizeCategory(input, state) {
    input = input || {};
    var name = trim(input.name);
    var stamp = auditFields(state);
    return {
      id: trim(input.id) || uniqueId(state.commodityCategories, "COMCAT-" + idToken(name)),
      name: name,
      description: trim(input.description),
      displaySequence: optionalNumber(input.displaySequence),
      status: normalizeStatus(input.status || ACTIVE),
      createdBy: trim(input.createdBy) || stamp.createdBy,
      createdAt: input.createdAt || stamp.createdAt,
      updatedBy: stamp.updatedBy,
      updatedAt: stamp.updatedAt
    };
  }

  function validateCommodity(commodity, state, existingId) {
    var errors = [];
    required(errors, commodity.code, "COMMODITY_CODE_REQUIRED", "Commodity Code is mandatory.", "COMMODITY", commodity.id);
    required(errors, commodity.name, "COMMODITY_NAME_REQUIRED", "Commodity Name is mandatory.", "COMMODITY", commodity.id);
    required(errors, commodity.categoryId, "COMMODITY_CATEGORY_REQUIRED", "Commodity Category is mandatory.", "COMMODITY", commodity.id);
    if (commodity.displaySequence !== null && !Number.isFinite(commodity.displaySequence)) issue(errors, "COMMODITY_SEQUENCE_INVALID", "Display Sequence must be numeric.", "COMMODITY", commodity.id);
    if ((state.commodities || []).some(function (item) { return item.id !== existingId && normalizeCode(item.code) === commodity.code; })) {
      issue(errors, "COMMODITY_CODE_DUPLICATE", "Commodity Code must be unique.", "COMMODITY", commodity.id);
    }
    var category = findById(state.commodityCategories, commodity.categoryId);
    if (!category) issue(errors, "COMMODITY_CATEGORY_INVALID", "Commodity Category does not exist.", "COMMODITY", commodity.id);
    if (category && category.status !== ACTIVE && (!existingId || findById(state.commodities, existingId).categoryId !== category.id)) {
      issue(errors, "COMMODITY_CATEGORY_INACTIVE", "Inactive categories cannot be selected for a new Commodity.", "COMMODITY_CATEGORY", category.id);
    }
    if (errors.length) throw new app.core.errors.BusinessOperationError("Commodity could not be saved.", errors);
  }

  function validateCategory(category, state, existingId) {
    var errors = [];
    required(errors, category.name, "COMMODITY_CATEGORY_NAME_REQUIRED", "Category Name is mandatory.", "COMMODITY_CATEGORY", category.id);
    if (category.displaySequence !== null && !Number.isFinite(category.displaySequence)) issue(errors, "COMMODITY_CATEGORY_SEQUENCE_INVALID", "Display Sequence must be numeric.", "COMMODITY_CATEGORY", category.id);
    if ((state.commodityCategories || []).some(function (item) { return item.id !== existingId && normalizeSearch(item.name) === normalizeSearch(category.name); })) {
      issue(errors, "COMMODITY_CATEGORY_DUPLICATE", "Commodity Category Name must be unique.", "COMMODITY_CATEGORY", category.id);
    }
    if (errors.length) throw new app.core.errors.BusinessOperationError("Commodity Category could not be saved.", errors);
  }

  function validateImmutableId(patch, id, label) {
    if (patch && patch.id !== undefined && patch.id !== id) fail("IMMUTABLE_ID", label + " ID is immutable.", label.toUpperCase().replace(/\s+/g, "_"), id);
  }

  function canManage(collectionName) {
    return app.core.permissionService.canCreate(collectionName, app.core.appState.getContext());
  }

  function assertPermission(collectionName, action) {
    if (canManage(collectionName)) return;
    throw new app.core.errors.PermissionError("You do not have permission to " + action + " this master data.", [{
      code: "PERMISSION_DENIED",
      message: "The active role does not have permission for this action.",
      objectType: collectionName,
      objectId: null
    }]);
  }

  function toCommodityView(commodity, category) {
    return Object.assign({}, commodity, {
      categoryName: category && category.name || "Unknown Category",
      categoryStatus: category && category.status || INACTIVE,
      lastUpdatedBy: commodity.updatedBy || commodity.createdBy || "",
      lastUpdatedDate: commodity.updatedAt || commodity.createdAt || ""
    });
  }

  function compareCommodities(left, right) {
    return numberOr(left.displaySequence, 9999) - numberOr(right.displaySequence, 9999) || left.code.localeCompare(right.code);
  }

  function changedFields(before, after) {
    return Object.keys(after).filter(function (key) { return JSON.stringify(before[key]) !== JSON.stringify(after[key]); });
  }

  function audit(state, objectType, objectId, action, fields, extra) {
    app.core.appState._recordAuditEvent(state, {
      objectType: objectType,
      objectId: objectId,
      action: action,
      details: JSON.stringify(Object.assign({ changedFields: fields || [] }, extra || {}))
    });
  }

  function touch(object, state) {
    object.updatedBy = state.context && state.context.activeRole || "SYSTEM";
    object.updatedAt = now();
  }

  function auditFields(state) {
    var stamp = now();
    var actor = state.context && state.context.activeRole || "SYSTEM";
    return { createdBy: actor, createdAt: stamp, updatedBy: actor, updatedAt: stamp };
  }

  function requireById(collection, id, label) {
    var item = findById(collection, id);
    if (!item) fail("OBJECT_NOT_FOUND", label + " was not found.", label.toUpperCase().replace(/\s+/g, "_"), id);
    return item;
  }

  function findById(collection, id) {
    return (collection || []).find(function (item) { return item.id === id; }) || null;
  }

  function indexById(collection) {
    return (collection || []).reduce(function (result, item) { if (item && item.id) result[item.id] = item; return result; }, {});
  }

  function required(errors, value, code, message, type, id) {
    if (!trim(value)) issue(errors, code, message, type, id);
  }

  function issue(errors, code, message, type, id) {
    errors.push({ code: code, message: message, objectType: type, objectId: id || null });
  }

  function fail(code, message, type, id) {
    throw new app.core.errors.BusinessOperationError(message, [{ code: code, message: message, objectType: type, objectId: id || null }]);
  }

  function optionalNumber(value) {
    if (value === "" || value == null) return null;
    var parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : NaN;
  }

  function numberOr(value, fallback) {
    return value === null || value === "" || !Number.isFinite(Number(value)) ? fallback : Number(value);
  }

  function normalizeStatus(value) {
    return String(value || ACTIVE).trim().toUpperCase() === INACTIVE ? INACTIVE : ACTIVE;
  }

  function normalizeCode(value) {
    return trim(value).toUpperCase().replace(/[^A-Z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  }

  function normalizeSearch(value) {
    return trim(value).toLowerCase();
  }

  function idToken(value) {
    return normalizeCode(value).replace(/_/g, "-") || Date.now().toString(36).toUpperCase();
  }

  function unique(values) {
    var seen = {};
    return (values || []).filter(function (value) { if (seen[value]) return false; seen[value] = true; return true; });
  }

  function uniqueId(collection, base) {
    var id = base;
    var index = 2;
    while ((collection || []).some(function (item) { return item.id === id; })) id = base + "-" + index++;
    return id;
  }

  function mappingId(variantId, commodityId) {
    return app.migrations && app.migrations.commodityMaster
      ? app.migrations.commodityMaster.mappingId(variantId, commodityId)
      : "VCM-" + idToken(variantId) + "-" + idToken(commodityId);
  }

  function clone(value) {
    return JSON.parse(JSON.stringify(value == null ? null : value));
  }

  function trim(value) {
    return String(value == null ? "" : value).trim();
  }

  function now() {
    return new Date().toISOString();
  }

  app.domain.commodityMasterService = {
    listCommodities: listCommodities,
    listActiveCommodities: listActiveCommodities,
    getCommodity: getCommodity,
    createCommodity: createCommodity,
    updateCommodity: updateCommodity,
    setCommodityStatus: setCommodityStatus,
    getCommodityUsage: getCommodityUsage,
    listCategories: listCategories,
    createCategory: createCategory,
    updateCategory: updateCategory,
    setCategoryStatus: setCategoryStatus,
    getMappingWorkspaceData: getMappingWorkspaceData,
    getMappingsForFinishedGoodVariant: getMappingsForFinishedGoodVariant,
    saveCommodityMappings: saveCommodityMappings,
    canManage: canManage,
    normalizeCommodity: normalizeCommodity,
    normalizeCategory: normalizeCategory
  };
})(typeof window !== "undefined" ? (window.DEP = window.DEP || {}) : (globalThis.DEP = globalThis.DEP || {}));
