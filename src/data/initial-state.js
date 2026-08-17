(function (app) {
  app.data = app.data || {};

  app.data.initialState = {
    metadata: {
      schemaVersion: "1.0.0",
      applicationVersion: "1.0.0",
      lastUpdated: null,
      createdAt: null,
      visualAssets: {
        completeSeatImageReference: ""
      },
      importHistory: []
    },
    context: {
      activeProgramId: null,
      activeSeatVariantId: null,
      activeFeatureConfigurationId: null,
      activeRole: "ENGINEERING",
      activeWorkspace: "dashboard",
      currentSelection: null
    },
    programs: [],
    seatVariants: [],
    features: [],
    featureConfigurations: [],
    engineeringModules: [],
    parts: [],
    engineeringBoms: [],
    engineeringProductStructures: [],
    commercialAssessments: [],
    commercialRecords: [],
    suppliers: [],
    commodities: [],
    commodityCategories: [],
    variantCommodityMappings: [],
    engineeringChanges: [],
    revisions: [],
    auditEvents: []
  };

  app.data.createCleanManualTestState = function () {
    var clean = JSON.parse(JSON.stringify(app.data.initialState));
    var preparedAt = new Date().toISOString();
    clean.metadata.environmentMode = "CLEAN_MANUAL_TEST";
    clean.metadata.cleanTestPreparedAt = preparedAt;
    clean.metadata.importHistory = [];
    clean.metadata.migrations = {
      commodityMasterSeparation: "2.0.0"
    };
    clean.commodityCategories = ((app.data.referenceData && app.data.referenceData.commodityCategories) || []).map(function (category) {
      return Object.assign({}, category, {
        sourceType: "SYSTEM_REFERENCE",
        createdBy: "SYSTEM",
        createdAt: preparedAt,
        updatedBy: "SYSTEM",
        updatedAt: preparedAt
      });
    });
    return clean;
  };
})(typeof window !== "undefined" ? (window.DEP = window.DEP || {}) : (globalThis.DEP = globalThis.DEP || {}));
