(function (app) {
  app.domain = app.domain || {};

  function getMasterData() {
    var state = app.core.appState.getState();
    return {
      engineeringModules: clone(state.engineeringModules || []),
      suppliers: clone(state.suppliers || []),
      commodities: clone(state.commodities || []),
      commodityCategories: clone(state.commodityCategories || []),
      visualAssets: clone((state.metadata && state.metadata.visualAssets) || {}),
      referenceValues: getReferenceValues(state)
    };
  }

  function updateEngineeringModule(id, patch) {
    return app.core.appState.transaction(function (state) {
      var module = findById(state.engineeringModules, id);
      if (!module) throw notFound("ENGINEERING_MODULE", id);
      var updated = normalizeEngineeringModule(Object.assign({}, module, patch || {}, { id: id, code: module.code }));
      validateEngineeringModule(updated, state.engineeringModules, id);
      Object.assign(module, updated);
      app.core.appState._recordAuditEvent(state, {
        objectType: "ENGINEERING_MODULE",
        objectId: id,
        action: "MASTER_DATA_UPDATED"
      });
    });
  }

  function createSupplier(input) {
    var supplier = normalizeSupplier(input || {});
    return app.core.appState.transaction(function (state) {
      validateSupplier(supplier, state.suppliers);
      state.suppliers.push(supplier);
      app.core.appState._recordAuditEvent(state, {
        objectType: "SUPPLIER",
        objectId: supplier.id,
        action: "MASTER_DATA_CREATED"
      });
    });
  }

  function updateSupplier(id, patch) {
    return app.core.appState.transaction(function (state) {
      var supplier = findById(state.suppliers, id);
      if (!supplier) throw notFound("SUPPLIER", id);
      var updated = normalizeSupplier(Object.assign({}, supplier, patch || {}, { id: id }));
      validateSupplier(updated, state.suppliers, id);
      Object.assign(supplier, updated);
      app.core.appState._recordAuditEvent(state, {
        objectType: "SUPPLIER",
        objectId: id,
        action: "MASTER_DATA_UPDATED"
      });
    });
  }

  function createCommodity(input) {
    return app.domain.commodityMasterService.createCommodity(input || {});
  }

  function updateCommodity(id, patch) {
    return app.domain.commodityMasterService.updateCommodity(id, patch || {});
  }

  function updateVisualAssets(patch) {
    return app.core.appState.transaction(function (state) {
      state.metadata = state.metadata || {};
      state.metadata.visualAssets = state.metadata.visualAssets || {};
      state.metadata.visualAssets.completeSeatImageReference = trim((patch || {}).completeSeatImageReference);
      app.core.appState._recordAuditEvent(state, {
        objectType: "VISUAL_ASSET",
        objectId: "COMPLETE_SEAT",
        action: "MASTER_DATA_UPDATED"
      });
    });
  }

  function getReferenceValues(state) {
    var variants = state.seatVariants || [];
    return {
      customers: unique((app.data.referenceData.customers || []).concat(variants.map(function (variant) { return variant.customer || variant.brand; }))),
      seatTypes: unique((app.data.referenceData.seatTypes || []).concat(variants.map(function (variant) { return variant.seatType || variant.seatFamily; }))),
      sides: unique((app.data.referenceData.sides || []).concat(variants.map(function (variant) { return variant.side; }))),
      grades: unique((app.data.referenceData.seatGrades || []).concat(variants.map(function (variant) { return variant.grade; }))),
      currencies: unique(app.data.referenceData.currencies || []),
      unitsOfMeasure: unique(app.data.referenceData.unitsOfMeasure || []),
      changeClassifications: unique(app.data.referenceData.changeClassifications || [])
    };
  }

  function normalizeEngineeringModule(input) {
    return {
      id: trim(input.id),
      code: normalizeCode(input.code),
      name: trim(input.name || input.label || input.code),
      label: trim(input.label || input.name || input.code),
      ownerRole: trim(input.ownerRole || "ENGINEERING"),
      requiredByDefault: Boolean(input.requiredByDefault),
      requiredFeatureCode: normalizeCode(input.requiredFeatureCode || input.featureCode || ""),
      featureCode: normalizeCode(input.featureCode || input.requiredFeatureCode || ""),
      applicableSeatTypes: normalizeList(input.applicableSeatTypes)
    };
  }

  function normalizeSupplier(input) {
    var supplierCode = normalizeCode(input.supplierCode || input.code || input.name);
    return {
      id: trim(input.id) || "SUP-" + supplierCode,
      supplierCode: supplierCode,
      name: trim(input.name),
      country: trim(input.country || "IN"),
      status: normalizeStatus(input.status || "APPROVED")
    };
  }

  function normalizeCommodity(input) {
    var code = normalizeCode(input.code || input.name);
    return {
      id: trim(input.id) || "CMD-" + code,
      code: code,
      name: trim(input.name || input.code)
    };
  }

  function validateEngineeringModule(module, modules, existingId) {
    var errors = [];
    if (!module.id) push(errors, "ENGINEERING_MODULE_ID_REQUIRED", "Engineering Module ID is required.", "ENGINEERING_MODULE", module.id);
    if (!module.code) push(errors, "ENGINEERING_MODULE_CODE_REQUIRED", "Engineering Module Code is required.", "ENGINEERING_MODULE", module.id);
    if (!module.name) push(errors, "ENGINEERING_MODULE_NAME_REQUIRED", "Engineering Module Name is required.", "ENGINEERING_MODULE", module.id);
    if (module.code && modules.some(function (item) {
      return item.id !== existingId && normalizeCode(item.code) === module.code;
    })) push(errors, "ENGINEERING_MODULE_CODE_DUPLICATE", "Engineering Module Code must be unique.", "ENGINEERING_MODULE", module.id);
    if (errors.length) throw new app.core.errors.BusinessOperationError("Engineering Module master data is invalid.", errors);
  }

  function validateSupplier(supplier, suppliers, existingId) {
    var errors = [];
    if (!supplier.id) push(errors, "SUPPLIER_ID_REQUIRED", "Supplier ID is required.", "SUPPLIER", supplier.id);
    if (!supplier.supplierCode) push(errors, "SUPPLIER_CODE_REQUIRED", "Supplier Code is required.", "SUPPLIER", supplier.id);
    if (!supplier.name) push(errors, "SUPPLIER_NAME_REQUIRED", "Supplier Name is required.", "SUPPLIER", supplier.id);
    if (supplier.id && suppliers.some(function (item) { return item.id !== existingId && item.id === supplier.id; })) {
      push(errors, "SUPPLIER_ID_DUPLICATE", "Supplier ID must be unique.", "SUPPLIER", supplier.id);
    }
    if (supplier.supplierCode && suppliers.some(function (item) {
      return item.id !== existingId && normalizeCode(item.supplierCode) === supplier.supplierCode;
    })) push(errors, "SUPPLIER_CODE_DUPLICATE", "Supplier Code must be unique.", "SUPPLIER", supplier.id);
    if (errors.length) throw new app.core.errors.BusinessOperationError("Supplier master data is invalid.", errors);
  }

  function validateCommodity(commodity, commodities, existingId) {
    var errors = [];
    if (!commodity.id) push(errors, "COMMODITY_ID_REQUIRED", "Commodity ID is required.", "COMMODITY", commodity.id);
    if (!commodity.code) push(errors, "COMMODITY_CODE_REQUIRED", "Commodity Code is required.", "COMMODITY", commodity.id);
    if (!commodity.name) push(errors, "COMMODITY_NAME_REQUIRED", "Commodity Name is required.", "COMMODITY", commodity.id);
    if (commodity.id && commodities.some(function (item) { return item.id !== existingId && item.id === commodity.id; })) {
      push(errors, "COMMODITY_ID_DUPLICATE", "Commodity ID must be unique.", "COMMODITY", commodity.id);
    }
    if (commodity.code && commodities.some(function (item) {
      return item.id !== existingId && normalizeCode(item.code) === commodity.code;
    })) push(errors, "COMMODITY_CODE_DUPLICATE", "Commodity Code must be unique.", "COMMODITY", commodity.id);
    if (errors.length) throw new app.core.errors.BusinessOperationError("Commodity master data is invalid.", errors);
  }

  function normalizeList(value) {
    if (Array.isArray(value)) return value.map(trim).filter(Boolean);
    return String(value || "").split(",").map(trim).filter(Boolean);
  }

  function normalizeStatus(value) {
    var status = normalizeCode(value || "ACTIVE");
    return status || "ACTIVE";
  }

  function normalizeCode(value) {
    return trim(value).toUpperCase().replace(/[\s-]+/g, "_");
  }

  function trim(value) {
    return String(value == null ? "" : value).trim();
  }

  function findById(collection, id) {
    return (collection || []).find(function (item) { return item.id === id; }) || null;
  }

  function unique(values) {
    var seen = {};
    return (values || []).map(trim).filter(function (value) {
      if (!value || seen[value]) return false;
      seen[value] = true;
      return true;
    }).sort();
  }

  function clone(value) {
    return JSON.parse(JSON.stringify(value == null ? null : value));
  }

  function notFound(objectType, id) {
    return new app.core.errors.BusinessOperationError(objectType + " was not found.", [
      { code: objectType + "_NOT_FOUND", message: objectType + " was not found.", objectType: objectType, objectId: id }
    ]);
  }

  function push(errors, code, message, objectType, objectId) {
    errors.push({ code: code, message: message, objectType: objectType, objectId: objectId || null });
  }

  app.domain.adminMasterDataService = {
    getMasterData: getMasterData,
    updateEngineeringModule: updateEngineeringModule,
    createSupplier: createSupplier,
    updateSupplier: updateSupplier,
    createCommodity: createCommodity,
    updateCommodity: updateCommodity,
    updateVisualAssets: updateVisualAssets,
    normalizeEngineeringModule: normalizeEngineeringModule,
    normalizeSupplier: normalizeSupplier,
    normalizeCommodity: normalizeCommodity
  };
})(typeof window !== "undefined" ? (window.DEP = window.DEP || {}) : (globalThis.DEP = globalThis.DEP || {}));
