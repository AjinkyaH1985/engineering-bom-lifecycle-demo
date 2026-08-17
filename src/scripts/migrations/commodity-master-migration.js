(function (app) {
  app.migrations = app.migrations || {};

  var MIGRATION_KEY = "commodityMasterSeparation";
  var MIGRATION_VERSION = "2.0.0";

  function migrateState(state) {
    state.metadata = state.metadata || {};
    state.metadata.migrations = state.metadata.migrations || {};
    state.commodities = Array.isArray(state.commodities) ? state.commodities : [];
    state.commodityCategories = Array.isArray(state.commodityCategories) ? state.commodityCategories : [];
    state.variantCommodityMappings = Array.isArray(state.variantCommodityMappings) ? state.variantCommodityMappings : [];

    var changed = ensureCategories(state);
    changed = removeDerivedCommodityMasterData(state) || changed;
    changed = normalizeCommodities(state) || changed;

    if (state.metadata.migrations[MIGRATION_KEY] !== MIGRATION_VERSION) {
      state.metadata.migrations[MIGRATION_KEY] = MIGRATION_VERSION;
      if (state.metadata.environmentMode !== "CLEAN_MANUAL_TEST") {
        state.auditEvents = Array.isArray(state.auditEvents) ? state.auditEvents : [];
        state.auditEvents.push({
          id: "AUD-COMMODITY-MASTER-MIGRATION-" + Date.now().toString(36),
          objectType: "STATE",
          objectId: "ROOT",
          action: "COMMODITY_MASTER_MIGRATED",
          details: "Commodity Master was separated from imported engineering Commodity classifications.",
          performedBy: state.context && state.context.activeRole || "SYSTEM",
          performedAt: now()
        });
      }
      changed = true;
    }
    return changed;
  }

  function ensureCategories(state) {
    var defaults = app.data && app.data.referenceData && app.data.referenceData.commodityCategories || [
      { id: "COMCAT-MATERIAL", name: "Material", description: "Material-based commodities", displaySequence: 10 },
      { id: "COMCAT-COMPONENT", name: "Component", description: "Purchased components and mechanisms", displaySequence: 20 },
      { id: "COMCAT-OTHER", name: "Other", description: "Other and imported commodities", displaySequence: 90 }
    ];
    var changed = false;
    defaults.forEach(function (category) {
      if (state.commodityCategories.some(function (item) { return item.id === category.id; })) return;
      state.commodityCategories.push(Object.assign({}, category, auditFields(state, "SYSTEM"), { status: "ACTIVE" }));
      changed = true;
    });
    return changed;
  }

  function removeDerivedCommodityMasterData(state) {
    var removedIds = {};
    var beforeCommodityCount = state.commodities.length;
    state.commodities = state.commodities.filter(function (commodity) {
      var derived = /^CMD-IMPORT-/.test(commodity.id || "") ||
        commodity.description === "Imported from engineering Part master data." ||
        /^Imported from .+\.xlsx$/i.test(commodity.description || "");
      if (derived) removedIds[commodity.id] = true;
      return !derived;
    });

    var beforeMappingCount = state.variantCommodityMappings.length;
    state.variantCommodityMappings = state.variantCommodityMappings.filter(function (mapping) {
      return !removedIds[mapping.commodityId] && mapping.source !== "MIGRATED_EBOM_USAGE";
    });
    return beforeCommodityCount !== state.commodities.length || beforeMappingCount !== state.variantCommodityMappings.length;
  }

  function normalizeCommodities(state) {
    var changed = false;
    state.commodities.forEach(function (commodity, index) {
      var code = normalizeCode(commodity.code || commodity.name || ("COMMODITY_" + (index + 1)));
      var stamp = commodity.createdAt || now();
      var normalized = {
        id: trim(commodity.id) || uniqueId(state.commodities, "CMD-" + idToken(code)),
        code: code,
        name: trim(commodity.name) || titleCase(code),
        categoryId: trim(commodity.categoryId) || categoryIdFor(code),
        description: trim(commodity.description),
        unitOfMeasure: trim(commodity.unitOfMeasure),
        displaySequence: finiteOrNull(commodity.displaySequence),
        status: normalizeStatus(commodity.status),
        createdBy: trim(commodity.createdBy) || "SYSTEM",
        createdAt: stamp,
        updatedBy: trim(commodity.updatedBy || commodity.lastUpdatedBy || commodity.createdBy) || "SYSTEM",
        updatedAt: commodity.updatedAt || commodity.lastUpdatedDate || stamp,
        sourceValues: unique((commodity.sourceValues || []).concat(commodity.name || commodity.code || ""))
      };
      if (JSON.stringify(commodity) !== JSON.stringify(normalized)) {
        state.commodities[index] = normalized;
        changed = true;
      }
    });
    return changed;
  }

  function categoryIdFor(code) {
    if (["METAL", "FOAM", "PLASTIC", "TRIM", "RUBBER"].indexOf(code) !== -1) return "COMCAT-MATERIAL";
    if (["MECHANISM", "FASTENER", "WIRING_HARNESS", "ELECTRONICS", "BOUGHT_OUT", "HARDWARE", "BELT_BUCKLE", "HR_BEZEL", "PE_COVER"].indexOf(code) !== -1) return "COMCAT-COMPONENT";
    return "COMCAT-OTHER";
  }

  function mappingId(variantId, commodityId) {
    return "VCM-" + idToken(variantId) + "-" + idToken(commodityId);
  }

  function auditFields(state, actor) {
    var stamp = now();
    var user = actor || state.context && state.context.activeRole || "SYSTEM";
    return { createdBy: user, createdAt: stamp, updatedBy: user, updatedAt: stamp };
  }

  function uniqueId(collection, base) {
    var id = base;
    var index = 2;
    while ((collection || []).some(function (item) { return item.id === id; })) id = base + "-" + index++;
    return id;
  }

  function indexById(items) {
    return (items || []).reduce(function (result, item) { if (item && item.id) result[item.id] = item; return result; }, {});
  }

  function unique(values) {
    var seen = {};
    return (values || []).map(trim).filter(function (value) {
      var key = value.toUpperCase();
      if (!value || seen[key]) return false;
      seen[key] = true;
      return true;
    });
  }

  function normalizeStatus(value) {
    return String(value || "ACTIVE").trim().toUpperCase() === "INACTIVE" ? "INACTIVE" : "ACTIVE";
  }

  function normalizeCode(value) {
    return trim(value).toUpperCase().replace(/[^A-Z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  }

  function idToken(value) {
    return normalizeCode(value).replace(/_/g, "-") || "UNASSIGNED";
  }

  function titleCase(value) {
    return trim(value).toLowerCase().replace(/(^|[\s_/-])([a-z])/g, function (_, prefix, letter) { return prefix + letter.toUpperCase(); }).replace(/_/g, " ");
  }

  function finiteOrNull(value) {
    if (value === "" || value == null) return null;
    var number = Number(value);
    return Number.isFinite(number) ? number : null;
  }

  function trim(value) {
    return String(value == null ? "" : value).trim();
  }

  function now() {
    return new Date().toISOString();
  }

  app.migrations.commodityMaster = {
    key: MIGRATION_KEY,
    version: MIGRATION_VERSION,
    migrateState: migrateState,
    mappingId: mappingId,
    categoryIdFor: categoryIdFor
  };
})(typeof window !== "undefined" ? (window.DEP = window.DEP || {}) : (globalThis.DEP = globalThis.DEP || {}));
