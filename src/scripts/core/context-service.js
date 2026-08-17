(function (app) {
  app.core = app.core || {};

  function getContext() {
    return app.core.appState.getContext();
  }

  function updateContext(patch) {
    return app.core.appState.transaction(function (state) {
      state.context = Object.assign({}, state.context, patch);
      app.core.appState._recordAuditEvent(state, {
        objectType: "CONTEXT",
        objectId: "ACTIVE_CONTEXT",
        action: "CONTEXT_CHANGED",
        details: Object.keys(patch).join(", ")
      });
    });
  }

  function setActiveBusinessContext(criteria) {
    criteria = criteria || {};
    var programId = criteria.programId || null;
    var seatVariantId = criteria.seatVariantId || null;
    if (!programId) {
      return updateContext({ activeProgramId: null, activeSeatVariantId: null, activeFeatureConfigurationId: null });
    }
    var program = app.core.appState.getById("programs", programId);
    if (!program) {
      throw new app.core.errors.ValidationError("Active Program does not exist.", [
        { code: "CONTEXT_PROGRAM_MISSING", message: "Cannot select an unknown Program.", objectType: "PROGRAM", objectId: programId }
      ]);
    }
    var variant = seatVariantId ? app.core.appState.getById("seatVariants", seatVariantId) : null;
    if (seatVariantId && !variant) {
      throw new app.core.errors.ValidationError("Active Seat Variant does not exist.", [
        { code: "CONTEXT_VARIANT_MISSING", message: "Cannot select an unknown Seat Variant.", objectType: "SEAT_VARIANT", objectId: seatVariantId }
      ]);
    }
    if (variant && variant.programId !== programId) {
      throw new app.core.errors.ValidationError("Active Seat Variant does not belong to the active Program.", [
        { code: "CONTEXT_VARIANT_PROGRAM_MISMATCH", message: "Cannot select a Finished-Good Variant outside the active Programme.", objectType: "SEAT_VARIANT", objectId: seatVariantId }
      ]);
    }
    return updateContext({
      activeProgramId: programId,
      activeSeatVariantId: variant ? variant.id : null,
      activeFeatureConfigurationId: variant ? getActiveConfigurationIdForSeatVariant(variant.id) : null
    });
  }

  function setActiveProgram(programId) {
    if (programId === null) return setActiveBusinessContext({ programId: null, seatVariantId: null });
    var context = getContext();
    var activeVariant = context.activeSeatVariantId ? app.core.appState.getById("seatVariants", context.activeSeatVariantId) : null;
    return setActiveBusinessContext({
      programId: programId,
      seatVariantId: activeVariant && activeVariant.programId === programId ? activeVariant.id : null
    });
  }

  function setActiveSeatVariant(seatVariantId) {
    if (seatVariantId === null) {
      return updateContext({ activeSeatVariantId: null, activeFeatureConfigurationId: null });
    }
    var variant = app.core.appState.getById("seatVariants", seatVariantId);
    if (!variant) {
      throw new app.core.errors.ValidationError("Active Seat Variant does not exist.", [
        { code: "CONTEXT_VARIANT_MISSING", message: "Cannot select an unknown Seat Variant.", objectType: "SEAT_VARIANT", objectId: seatVariantId }
      ]);
    }
    var context = getContext();
    if (context.activeProgramId && variant.programId !== context.activeProgramId) {
      throw new app.core.errors.ValidationError("Active Seat Variant does not belong to the active Program.", [
        { code: "CONTEXT_VARIANT_PROGRAM_MISMATCH", message: "Cannot select a Seat Variant outside the active Program.", objectType: "SEAT_VARIANT", objectId: seatVariantId }
      ]);
    }
    return setActiveBusinessContext({
      programId: context.activeProgramId || variant.programId,
      seatVariantId: seatVariantId
    });
  }

  function setActiveFeatureConfiguration(featureConfigurationId) {
    if (featureConfigurationId === null) {
      return updateContext({ activeFeatureConfigurationId: null });
    }
    var configuration = app.core.appState.getById("featureConfigurations", featureConfigurationId);
    if (!configuration) {
      throw new app.core.errors.ValidationError("Active Feature Configuration does not exist.", [
        { code: "CONTEXT_FEATURE_CONFIGURATION_MISSING", message: "Cannot select an unknown Feature Configuration.", objectType: "FEATURE_CONFIGURATION", objectId: featureConfigurationId }
      ]);
    }
    var context = getContext();
    if (context.activeSeatVariantId && configuration.seatVariantId !== context.activeSeatVariantId) {
      throw new app.core.errors.ValidationError("Active Feature Configuration does not belong to the active Seat Variant.", [
        { code: "CONTEXT_FEATURE_CONFIGURATION_VARIANT_MISMATCH", message: "Cannot select a Feature Configuration outside the active Seat Variant.", objectType: "FEATURE_CONFIGURATION", objectId: featureConfigurationId }
      ]);
    }
    return updateContext({
      activeProgramId: context.activeProgramId || configuration.programId,
      activeSeatVariantId: context.activeSeatVariantId || configuration.seatVariantId,
      activeFeatureConfigurationId: featureConfigurationId
    });
  }

  function setActiveRole(role) {
    var roles = (app.data.referenceData.roles || []).map(function (item) {
      return item.code;
    });
    if (roles.indexOf(role) === -1) {
      throw new app.core.errors.ValidationError("Active role is not recognised.", [
        { code: "CONTEXT_ROLE_INVALID", message: "Cannot select an unknown role.", objectType: "ROLE", objectId: role }
      ]);
    }
    return updateContext({ activeRole: role });
  }

  function setActiveWorkspace(workspaceId) {
    return updateContext({ activeWorkspace: workspaceId });
  }

  function getActiveConfigurationIdForSeatVariant(seatVariantId) {
    var configurations = app.core.appState.getCollection("featureConfigurations");
    var active = configurations.find(function (configuration) {
      return configuration.seatVariantId === seatVariantId && (configuration.status || "ACTIVE") === "ACTIVE";
    });
    return active ? active.id : null;
  }

  app.core.contextService = {
    getContext: getContext,
    setActiveBusinessContext: setActiveBusinessContext,
    setActiveProgram: setActiveProgram,
    setActiveSeatVariant: setActiveSeatVariant,
    setActiveFeatureConfiguration: setActiveFeatureConfiguration,
    setActiveRole: setActiveRole,
    setActiveWorkspace: setActiveWorkspace
  };
})(typeof window !== "undefined" ? (window.DEP = window.DEP || {}) : (globalThis.DEP = globalThis.DEP || {}));
