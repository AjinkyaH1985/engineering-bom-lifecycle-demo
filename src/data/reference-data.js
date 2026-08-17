(function (app) {
  app.data = app.data || {};

  var roles = [
    { id: "ROLE-ADMINISTRATOR", code: "ADMINISTRATOR", label: "Administrator" },
    { id: "ROLE-ENGINEERING", code: "ENGINEERING", label: "Engineering" },
    { id: "ROLE-COMMODITY", code: "COMMODITY_MANAGER", label: "Purchase / Commodity Manager" },
    { id: "ROLE-PROGRAM", code: "PROGRAM_MANAGER", label: "Program / CFT" }
  ];

  var engineeringModules = [
    { id: "MOD-STRUCTURE", code: "STRUCTURE", label: "Structure", requiredByDefault: true },
    { id: "MOD-FOAM", code: "FOAM", label: "Foam", requiredByDefault: true },
    { id: "MOD-PLASTIC", code: "PLASTIC", label: "Plastic", requiredByDefault: true },
    { id: "MOD-TRIM", code: "TRIM", label: "Trim", requiredByDefault: true },
    { id: "MOD-HEAD-REST", code: "HEAD_REST", label: "Head Rest", requiredByDefault: false, requiredFeatureCode: "COMFORT_HR", applicableSeatTypes: ["40P", "60P", "3R"] },
    { id: "MOD-ARM-REST", code: "ARM_REST", label: "Arm Rest", requiredByDefault: false, requiredFeatureCode: "ARMREST", applicableSeatTypes: ["60P", "3R"] }
  ];

  var commodityCategories = [
    { id: "COMCAT-MATERIAL", name: "Material", description: "Material-based commodities", displaySequence: 10, status: "ACTIVE" },
    { id: "COMCAT-COMPONENT", name: "Component", description: "Purchased components and mechanisms", displaySequence: 20, status: "ACTIVE" },
    { id: "COMCAT-OTHER", name: "Other", description: "Other and imported commodities", displaySequence: 90, status: "ACTIVE" }
  ];

  app.data.referenceData = {
    schemaVersion: "1.0.0",
    roles: roles,
    engineeringModules: engineeringModules,
    commodityCategories: commodityCategories,
    lifecycleStates: ["DRAFT", "IN_WORK", "COMPLETE", "APPROVED", "RELEASED", "SUPERSEDED"],
    engineeringBomCompletionStatuses: ["NOT_STARTED", "IN_PROGRESS", "COMPLETE", "BLOCKED"],
    engineeringProductStructureGenerationStatuses: ["NOT_GENERATED", "CURRENT", "STALE", "GENERATION_FAILED"],
    commercialAssessmentGenerationStatuses: ["NOT_GENERATED", "CURRENT", "STALE", "GENERATION_FAILED"],
    commercialAssessmentSourcingStatuses: ["NOT_SOURCED", "RFQ", "QUOTED", "NOMINATED", "SOURCED", "OBSOLETE"],
    commercialLineStatuses: ["NOT_STARTED", "IN_PROGRESS", "COMPLETE", "STALE", "IMPACTED_BY_ECN", "OBSOLETE"],
    programStatuses: ["PLANNED", "ACTIVE", "ON_HOLD", "CLOSED"],
    seatVariantStatuses: ["PLANNED", "ACTIVE", "ON_HOLD", "CLOSED"],
    featureStatuses: ["DRAFT", "ACTIVE", "INACTIVE"],
    featureConfigurationStatuses: ["DRAFT", "ACTIVE", "SUPERSEDED"],
    seatGrades: ["E2", "E3", "E4", "E4+"],
    customers: ["Orion Motors"],
    seatTypes: ["60P"],
    sides: ["RH", "LH"],
    featureValueTypes: ["BOOLEAN", "ENUM", "TEXT", "NUMBER"],
    changeClassifications: ["NEW", "CARRY_OVER", "MODIFIED", "DELETED", "REPLACED", "UNCHANGED"],
    ecnStatuses: ["DRAFT", "SUBMITTED", "APPROVED", "IMPLEMENTING", "IMPLEMENTED", "REJECTED", "CANCELLED"],
    partTypes: ["PART", "ASSEMBLY"],
    unitsOfMeasure: ["EA", "KG", "M"],
    currencies: ["GBP", "INR", "EUR", "USD"],
    commodityCodes: [
      "METAL",
      "MECHANISM",
      "FOAM",
      "TRIM",
      "PLASTIC",
      "FASTENER",
      "WIRING_HARNESS",
      "ELECTRONICS",
      "RUBBER",
      "BOUGHT_OUT",
      "HARDWARE",
      "BELT_BUCKLE",
      "OTHER"
    ],
    auditableActions: [
      "STATE_INITIALISED",
      "STATE_RESET",
      "OBJECT_CREATED",
      "OBJECT_UPDATED",
      "OBJECT_REMOVED",
      "CONTEXT_CHANGED",
      "FEATURE_CONFIGURATION_CHANGED",
      "LEGACY_FEATURE_CONFIGURATION_MIGRATION",
      "VALIDATION_FAILED"
    ]
  };
})(typeof window !== "undefined" ? (window.DEP = window.DEP || {}) : (globalThis.DEP = globalThis.DEP || {}));
