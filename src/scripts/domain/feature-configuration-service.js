(function (app) {
  app.domain = app.domain || {};

  var STATUS_VALUES = ["DRAFT", "ACTIVE", "SUPERSEDED"];

  function getConfigurationForSeatVariant(seatVariantId) {
    return app.core.appState.getCollection("featureConfigurations").find(function (configuration) {
      return configuration.seatVariantId === seatVariantId && configuration.status === "ACTIVE";
    }) || null;
  }

  function getFeatureConfigurationById(id) {
    return app.core.appState.getById("featureConfigurations", id);
  }

  function createFeatureConfiguration(input) {
    var configuration = normalizeFeatureConfiguration(input || {});
    return app.core.appState.transaction(function (state) {
      validateFeatureConfiguration(configuration, state.featureConfigurations, state.seatVariants, state.features);
      state.featureConfigurations.push(configuration);
      if (state.context.activeSeatVariantId === configuration.seatVariantId && configuration.status === "ACTIVE") {
        state.context.activeFeatureConfigurationId = configuration.id;
      }
      app.core.appState._recordAuditEvent(state, {
        objectType: "FEATURE_CONFIGURATION",
        objectId: configuration.id,
        action: "OBJECT_CREATED"
      });
    });
  }

  function updateFeatureConfiguration(id, patch) {
    return app.core.appState.transaction(function (state) {
      var index = findIndex(state.featureConfigurations, id);
      if (index === -1) throw notFound("FEATURE_CONFIGURATION", id);
      if (patch && patch.id && patch.id !== id) throw immutableId("FEATURE_CONFIGURATION", id);
      if (patch && patch.seatVariantId && patch.seatVariantId !== state.featureConfigurations[index].seatVariantId) {
        throw new app.core.errors.BusinessOperationError("Feature Configuration Seat Variant cannot be changed.", [
          { code: "FEATURE_CONFIGURATION_VARIANT_IMMUTABLE", message: "A Feature Configuration belongs to exactly one Seat Variant.", objectType: "FEATURE_CONFIGURATION", objectId: id }
        ]);
      }
      var updated = normalizeFeatureConfiguration(Object.assign({}, state.featureConfigurations[index], patch || {}, { id: id }));
      validateFeatureConfiguration(updated, state.featureConfigurations, state.seatVariants, state.features, id);
      state.featureConfigurations[index] = markStale(updated);
      syncActiveConfigurationContext(state, state.featureConfigurations[index]);
      app.core.appState._recordAuditEvent(state, {
        objectType: "FEATURE_CONFIGURATION",
        objectId: id,
        action: "FEATURE_CONFIGURATION_CHANGED"
      });
    });
  }

  function deleteFeatureConfiguration(id) {
    return app.core.appState.transaction(function (state) {
      var index = findIndex(state.featureConfigurations, id);
      if (index === -1) throw notFound("FEATURE_CONFIGURATION", id);
      var dependencies = getConfigurationDependencies(state, id);
      if (dependencies.length) {
        throw new app.core.errors.BusinessOperationError("Feature Configuration cannot be deleted while downstream references exist.", dependencies.map(function (dependency) {
          return {
            code: "FEATURE_CONFIGURATION_DELETE_BLOCKED",
            message: "Dependent " + dependency.collectionName + " record exists.",
            objectType: "FEATURE_CONFIGURATION",
            objectId: id
          };
        }));
      }
      state.featureConfigurations.splice(index, 1);
      if (state.context.activeFeatureConfigurationId === id) {
        state.context.activeFeatureConfigurationId = null;
      }
      app.core.appState._recordAuditEvent(state, {
        objectType: "FEATURE_CONFIGURATION",
        objectId: id,
        action: "OBJECT_REMOVED"
      });
    });
  }

  function setFeatureSelection(configurationId, featureId, selectedValue) {
    return updateSelections(configurationId, function (selections, feature) {
      var index = selections.findIndex(function (selection) {
        return selection.featureId === feature.id;
      });
      var next = { featureId: feature.id, selectedValue: normalizeSelectedValue(feature, selectedValue) };
      if (index === -1) selections.push(next);
      else selections[index] = next;
      return selections;
    }, featureId, "FEATURE_SELECTION_SET");
  }

  function removeFeatureSelection(configurationId, featureId) {
    return app.core.appState.transaction(function (state) {
      var configuration = findById(state.featureConfigurations, configurationId);
      if (!configuration) throw notFound("FEATURE_CONFIGURATION", configurationId);
      if (!findById(state.features, featureId)) throw notFound("FEATURE", featureId);
      configuration.selections = (configuration.selections || []).filter(function (selection) {
        return selection.featureId !== featureId;
      });
      markConfigurationStale(configuration);
      app.core.appState._recordAuditEvent(state, {
        objectType: "FEATURE_CONFIGURATION",
        objectId: configurationId,
        action: "FEATURE_SELECTION_REMOVED",
        details: featureId
      });
    });
  }

  function replaceSelections(configurationId, selections) {
    return app.core.appState.transaction(function (state) {
      var configuration = findById(state.featureConfigurations, configurationId);
      if (!configuration) throw notFound("FEATURE_CONFIGURATION", configurationId);
      configuration.selections = normalizeSelections(selections || [], state.features);
      validateFeatureConfiguration(configuration, state.featureConfigurations, state.seatVariants, state.features, configurationId);
      markConfigurationStale(configuration);
      app.core.appState._recordAuditEvent(state, {
        objectType: "FEATURE_CONFIGURATION",
        objectId: configurationId,
        action: "FEATURE_CONFIGURATION_CHANGED"
      });
    });
  }

  function setConfigurationStatus(configurationId, status) {
    return updateFeatureConfiguration(configurationId, { status: normalizeStatus(status) });
  }

  function ensureConfigurationForSeatVariant(seatVariantId, attributes) {
    var existing = getConfigurationForSeatVariant(seatVariantId);
    if (existing) return existing;
    var variant = app.core.appState.getById("seatVariants", seatVariantId);
    if (!variant) throw notFound("SEAT_VARIANT", seatVariantId);
    createFeatureConfiguration(Object.assign({
      id: makeId("FC", seatVariantId),
      programId: variant.programId,
      seatVariantId: seatVariantId,
      name: variant.variantName || variant.variantCode,
      status: "ACTIVE",
      selections: []
    }, attributes || {}));
    return getConfigurationForSeatVariant(seatVariantId);
  }

  function updateSelections(configurationId, mutator, featureId, action) {
    return app.core.appState.transaction(function (state) {
      var configuration = findById(state.featureConfigurations, configurationId);
      if (!configuration) throw notFound("FEATURE_CONFIGURATION", configurationId);
      var feature = findById(state.features, featureId);
      if (!feature) throw notFound("FEATURE", featureId);
      configuration.selections = mutator((configuration.selections || []).slice(), feature);
      validateFeatureConfiguration(configuration, state.featureConfigurations, state.seatVariants, state.features, configurationId);
      markConfigurationStale(configuration);
      app.core.appState._recordAuditEvent(state, {
        objectType: "FEATURE_CONFIGURATION",
        objectId: configurationId,
        action: action,
        details: featureId
      });
    });
  }

  function normalizeFeatureConfiguration(input) {
    var id = trim(input.id) || makeId("FC", input.seatVariantId || Date.now().toString(36));
    var selections = Array.isArray(input.selections) ? input.selections : (input.selectedFeatureIds || []).map(function (featureId) {
      return { featureId: featureId, selectedValue: "Selected" };
    });
    return {
      id: id,
      programId: trim(input.programId),
      seatVariantId: trim(input.seatVariantId),
      name: trim(input.name),
      status: normalizeStatus(input.status || "ACTIVE"),
      selections: selections.map(function (selection) {
        return {
          featureId: trim(selection.featureId),
          selectedValue: trim(selection.selectedValue || "Selected")
        };
      }),
      lifecycleState: input.lifecycleState || "IN_WORK",
      downstreamStatus: input.downstreamStatus || "NOT_GENERATED",
      staleReason: input.staleReason || "",
      trimMaterial: trim(input.trimMaterial)
    };
  }

  function validateFeatureConfiguration(configuration, configurations, variants, features, existingId) {
    var errors = [];
    var variant = findById(variants, configuration.seatVariantId);
    if (!configuration.id) push(errors, "FEATURE_CONFIGURATION_ID_REQUIRED", "Feature Configuration ID is required.", configuration.id);
    if (configuration.id && configurations.some(function (item) { return item.id !== existingId && item.id === configuration.id; })) {
      push(errors, "FEATURE_CONFIGURATION_ID_DUPLICATE", "Feature Configuration ID must be unique.", configuration.id);
    }
    if (!configuration.seatVariantId) push(errors, "FEATURE_CONFIGURATION_VARIANT_REQUIRED", "Feature Configuration must belong to one Seat Variant.", configuration.id);
    if (configuration.seatVariantId && !variant) {
      push(errors, "FEATURE_CONFIGURATION_VARIANT_MISSING", "Feature Configuration cannot reference an unknown Seat Variant.", configuration.id);
    }
    if (variant && configuration.programId && variant.programId !== configuration.programId) {
      push(errors, "FEATURE_CONFIGURATION_PROGRAM_VARIANT_MISMATCH", "Feature Configuration Program must match its Seat Variant Program.", configuration.id);
    }
    if (variant && !configuration.programId) configuration.programId = variant.programId;
    if (STATUS_VALUES.indexOf(configuration.status) === -1) push(errors, "FEATURE_CONFIGURATION_STATUS_INVALID", "Feature Configuration status is not controlled.", configuration.id);
    if (configuration.status === "ACTIVE" && configuration.seatVariantId && configurations.some(function (item) {
      return item.id !== existingId && item.seatVariantId === configuration.seatVariantId && item.status === "ACTIVE";
    })) {
      push(errors, "FEATURE_CONFIGURATION_ACTIVE_DUPLICATE", "A Seat Variant may have only one active Feature Configuration.", configuration.id);
    }
    validateSelections(errors, configuration, features);
    if (errors.length) throw new app.core.errors.BusinessOperationError("Feature Configuration validation failed.", errors);
  }

  function validateSelections(errors, configuration, features) {
    var seen = {};
    (configuration.selections || []).forEach(function (selection) {
      var feature = findById(features, selection.featureId);
      if (!selection.featureId || !feature) {
        push(errors, "FEATURE_CONFIGURATION_FEATURE_MISSING", "Feature Configuration selection cannot reference an unknown Feature.", configuration.id);
        return;
      }
      if (seen[selection.featureId]) {
        push(errors, "FEATURE_CONFIGURATION_FEATURE_DUPLICATE", "A Feature may appear only once in one configuration.", configuration.id);
      }
      seen[selection.featureId] = true;
      var normalizedValue = normalizeSelectedValue(feature, selection.selectedValue);
      var valueType = normalizeCode(feature.valueType || "BOOLEAN");
      if (valueType === "NUMBER" && normalizedValue && normalizedValue !== "Selected" && !isFinite(Number(normalizedValue))) {
        push(errors, "FEATURE_CONFIGURATION_NUMBER_INVALID", "Number Feature values must contain a valid number.", configuration.id);
      }
      if (Array.isArray(feature.allowedValues) && feature.allowedValues.length && normalizedValue && feature.allowedValues.indexOf(normalizedValue) === -1) {
        push(errors, "FEATURE_CONFIGURATION_VALUE_INVALID", "Selected Feature value is not allowed for the referenced Feature.", configuration.id);
      }
    });
  }

  function normalizeSelections(selections, features) {
    return selections.map(function (selection) {
      var feature = findById(features, selection.featureId);
      if (!feature) {
        return { featureId: trim(selection.featureId), selectedValue: trim(selection.selectedValue || "Selected") };
      }
      return {
        featureId: feature.id,
        selectedValue: normalizeSelectedValue(feature, selection.selectedValue)
      };
    });
  }

  function normalizeSelectedValue(feature, selectedValue) {
    var value = trim(selectedValue || "Selected");
    if (feature && feature.valueType === "BOOLEAN" && value.toUpperCase() === "SELECTED" && (feature.allowedValues || []).indexOf("YES") !== -1) return "YES";
    if (!value && Array.isArray(feature.allowedValues) && feature.allowedValues.length) return feature.allowedValues[0];
    return value || "Selected";
  }

  function markStale(configuration) {
    markConfigurationStale(configuration);
    return configuration;
  }

  function markConfigurationStale(configuration) {
    configuration.downstreamStatus = "STALE";
    configuration.staleReason = "FEATURE_CONFIGURATION_CHANGED";
  }

  function syncActiveConfigurationContext(state, configuration) {
    if (state.context.activeSeatVariantId === configuration.seatVariantId && configuration.status === "ACTIVE") {
      state.context.activeFeatureConfigurationId = configuration.id;
    }
  }

  function getConfigurationDependencies(state, configurationId) {
    var dependencies = [];
    ["engineeringProductStructures", "engineeringChanges", "revisions"].forEach(function (collectionName) {
      (state[collectionName] || []).forEach(function (item) {
        if (item.featureConfigurationId === configurationId) dependencies.push({ collectionName: collectionName, id: item.id });
      });
    });
    return dependencies;
  }

  function normalizeStatus(status) {
    var value = normalizeCode(status || "ACTIVE");
    if (STATUS_VALUES.indexOf(value) !== -1) return value;
    return "ACTIVE";
  }

  function makeId(prefix, code) {
    return prefix + "-" + normalizeCode(code || Date.now().toString(36)).replace(/[^A-Z0-9]+/g, "-").replace(/^-|-$/g, "");
  }

  function trim(value) {
    return String(value == null ? "" : value).trim();
  }

  function normalizeCode(value) {
    return trim(value).toUpperCase().replace(/\s+/g, "_");
  }

  function findById(collection, id) {
    return (collection || []).find(function (item) {
      return item.id === id;
    });
  }

  function findIndex(collection, id) {
    return collection.findIndex(function (item) {
      return item.id === id;
    });
  }

  function push(errors, code, message, objectId) {
    errors.push({ code: code, message: message, objectType: "FEATURE_CONFIGURATION", objectId: objectId || null });
  }

  function notFound(objectType, id) {
    return new app.core.errors.BusinessOperationError(objectType + " was not found.", [
      { code: objectType + "_NOT_FOUND", message: objectType + " was not found.", objectType: objectType, objectId: id }
    ]);
  }

  function immutableId(objectType, id) {
    return new app.core.errors.BusinessOperationError(objectType + " ID cannot be changed.", [
      { code: objectType + "_ID_IMMUTABLE", message: objectType + " ID is stable and immutable.", objectType: objectType, objectId: id }
    ]);
  }

  app.domain.featureConfigurationService = {
    createFeatureConfiguration: createFeatureConfiguration,
    updateFeatureConfiguration: updateFeatureConfiguration,
    deleteFeatureConfiguration: deleteFeatureConfiguration,
    getFeatureConfigurationById: getFeatureConfigurationById,
    getConfigurationForSeatVariant: getConfigurationForSeatVariant,
    setFeatureSelection: setFeatureSelection,
    removeFeatureSelection: removeFeatureSelection,
    replaceSelections: replaceSelections,
    setConfigurationStatus: setConfigurationStatus,
    ensureConfigurationForSeatVariant: ensureConfigurationForSeatVariant,
    normalizeFeatureConfiguration: normalizeFeatureConfiguration,
    validateFeatureConfiguration: validateFeatureConfiguration
  };
})(typeof window !== "undefined" ? (window.DEP = window.DEP || {}) : (globalThis.DEP = globalThis.DEP || {}));
