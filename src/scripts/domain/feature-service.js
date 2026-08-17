(function (app) {
  app.domain = app.domain || {};

  var STATUS_VALUES = ["DRAFT", "ACTIVE", "INACTIVE"];

  function listFeatures() {
    return app.core.appState.getCollection("features");
  }

  function getFeatureById(id) {
    return app.core.appState.getById("features", id);
  }

  function createFeature(input) {
    var feature = normalizeFeature(input || {});
    return app.core.appState.transaction(function (state) {
      validateFeature(feature, state.features);
      state.features.push(feature);
      app.core.appState._recordAuditEvent(state, {
        objectType: "FEATURE",
        objectId: feature.id,
        action: "OBJECT_CREATED"
      });
    });
  }

  function updateFeature(id, patch) {
    return app.core.appState.transaction(function (state) {
      var index = findIndex(state.features, id);
      if (index === -1) throw notFound("FEATURE", id);
      if (patch && patch.id && patch.id !== id) throw immutableId("FEATURE", id);
      var updated = normalizeFeature(Object.assign({}, state.features[index], patch || {}, { id: id }));
      validateFeature(updated, state.features, id);
      state.features[index] = updated;
      app.core.appState._recordAuditEvent(state, {
        objectType: "FEATURE",
        objectId: id,
        action: "OBJECT_UPDATED"
      });
    });
  }

  function deleteFeature(id) {
    return app.core.appState.transaction(function (state) {
      var index = findIndex(state.features, id);
      if (index === -1) throw notFound("FEATURE", id);
      var references = state.featureConfigurations.filter(function (configuration) {
        return getSelectionFeatureIds(configuration).indexOf(id) !== -1;
      });
      if (references.length) {
        throw new app.core.errors.BusinessOperationError("Feature cannot be deleted while referenced by a Feature Configuration.", references.map(function (configuration) {
          return {
            code: "FEATURE_DELETE_BLOCKED",
            message: "Feature is referenced by Feature Configuration " + configuration.id + ".",
            objectType: "FEATURE",
            objectId: id
          };
        }));
      }
      state.features.splice(index, 1);
      app.core.appState._recordAuditEvent(state, {
        objectType: "FEATURE",
        objectId: id,
        action: "OBJECT_REMOVED"
      });
    });
  }

  function normalizeFeature(input) {
    var featureCode = trim(input.featureCode || input.code);
    var id = trim(input.id) || makeId("FEAT", featureCode);
    var allowedValues = Array.isArray(input.allowedValues) ? input.allowedValues.map(trim).filter(Boolean) : [];
    return {
      id: id,
      featureCode: featureCode,
      code: featureCode,
      name: trim(input.name || input.featureName),
      category: trim(input.category),
      description: trim(input.description),
      valueType: normalizeValueType(input.valueType || input.type),
      status: normalizeStatus(input.status || "ACTIVE"),
      allowedValues: allowedValues,
      applicabilityByGrade: normalizeApplicability(input.applicabilityByGrade, input),
      remarks: trim(input.remarks)
    };
  }

  function validateFeature(feature, features, existingId) {
    var errors = [];
    if (!feature.id) push(errors, "FEATURE_ID_REQUIRED", "Feature ID is required.", feature.id);
    if (feature.id && features.some(function (item) { return item.id !== existingId && item.id === feature.id; })) {
      push(errors, "FEATURE_ID_DUPLICATE", "Feature ID must be unique.", feature.id);
    }
    if (!feature.featureCode) push(errors, "FEATURE_CODE_REQUIRED", "Feature Code is required.", feature.id);
    if (!feature.name) push(errors, "FEATURE_NAME_REQUIRED", "Feature Name is required.", feature.id);
    if ((app.data.referenceData.featureValueTypes || []).indexOf(feature.valueType) === -1) push(errors, "FEATURE_VALUE_TYPE_INVALID", "Feature value type is not controlled.", feature.id);
    if (STATUS_VALUES.indexOf(feature.status) === -1) push(errors, "FEATURE_STATUS_INVALID", "Feature status is not controlled.", feature.id);
    if (feature.featureCode && features.some(function (item) {
      return item.id !== existingId && normalizeCode(item.featureCode || item.code) === normalizeCode(feature.featureCode);
    })) {
      push(errors, "FEATURE_CODE_DUPLICATE", "Feature Code must be unique.", feature.id);
    }
    if (errors.length) throw new app.core.errors.BusinessOperationError("Feature validation failed.", errors);
  }

  function getSelectionFeatureIds(configuration) {
    var ids = (configuration.selectedFeatureIds || []).slice();
    (configuration.selections || []).forEach(function (selection) {
      if (selection && selection.featureId) ids.push(selection.featureId);
    });
    return ids;
  }

  function normalizeApplicability(applicability, input) {
    var source = applicability || {};
    return {
      E2: toBoolean(source.E2 !== undefined ? source.E2 : input.e2),
      E3: toBoolean(source.E3 !== undefined ? source.E3 : input.e3),
      E4: toBoolean(source.E4 !== undefined ? source.E4 : input.e4),
      "E4+": toBoolean(source["E4+"] !== undefined ? source["E4+"] : input.e4plus)
    };
  }

  function normalizeStatus(status) {
    var value = normalizeCode(status || "ACTIVE");
    if (value === "IN_WORK") return "ACTIVE";
    if (STATUS_VALUES.indexOf(value) !== -1) return value;
    return "ACTIVE";
  }

  function normalizeValueType(value) {
    var normalized = normalizeCode(value || "BOOLEAN");
    if ((app.data.referenceData.featureValueTypes || []).indexOf(normalized) !== -1) return normalized;
    return "BOOLEAN";
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

  function toBoolean(value) {
    return value === true || value === "true" || value === "Yes" || value === "YES" || value === 1;
  }

  function findIndex(collection, id) {
    return collection.findIndex(function (item) {
      return item.id === id;
    });
  }

  function push(errors, code, message, objectId) {
    errors.push({ code: code, message: message, objectType: "FEATURE", objectId: objectId || null });
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

  app.domain.featureService = {
    createFeature: createFeature,
    updateFeature: updateFeature,
    deleteFeature: deleteFeature,
    getFeatureById: getFeatureById,
    listFeatures: listFeatures,
    normalizeFeature: normalizeFeature,
    validateFeature: validateFeature
  };
})(typeof window !== "undefined" ? (window.DEP = window.DEP || {}) : (globalThis.DEP = globalThis.DEP || {}));
