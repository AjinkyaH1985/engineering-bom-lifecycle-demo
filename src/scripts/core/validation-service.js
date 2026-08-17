(function (app) {
  app.core = app.core || {};

  var REQUIRED_COLLECTIONS = [
    "programs",
    "seatVariants",
    "features",
    "featureConfigurations",
    "engineeringModules",
    "parts",
    "engineeringBoms",
    "engineeringProductStructures",
    "commercialAssessments",
    "commercialRecords",
    "suppliers",
    "commodities",
    "commodityCategories",
    "variantCommodityMappings",
    "engineeringChanges",
    "revisions",
    "auditEvents"
  ];

  function result(errors, warnings) {
    return {
      valid: errors.length === 0,
      errors: errors,
      warnings: warnings || []
    };
  }

  function error(code, message, objectType, objectId) {
    return {
      code: code,
      message: message,
      objectType: objectType || null,
      objectId: objectId || null
    };
  }

  function validateCollectionName(collectionName) {
    if (REQUIRED_COLLECTIONS.indexOf(collectionName) === -1) {
      throw new app.core.errors.ValidationError("Unknown state collection: " + collectionName, [
        error("STATE_UNKNOWN_COLLECTION", "The requested collection is not part of the application state.", "STATE", collectionName)
      ]);
    }
  }

  function validateRootShape(state) {
    var errors = [];
    if (!state || typeof state !== "object") {
      errors.push(error("STATE_INVALID_ROOT", "Application state must be an object.", "STATE"));
      return result(errors);
    }
    if (!state.metadata || !state.metadata.schemaVersion) {
      errors.push(error("STATE_SCHEMA_MISSING", "State metadata.schemaVersion is required.", "STATE"));
    }
    if (!state.context || typeof state.context !== "object") {
      errors.push(error("STATE_CONTEXT_MISSING", "State context is required.", "STATE"));
    }
    REQUIRED_COLLECTIONS.forEach(function (collectionName) {
      if (!Array.isArray(state[collectionName])) {
        errors.push(error("STATE_COLLECTION_MISSING", collectionName + " must be an array.", "STATE", collectionName));
      }
    });
    if (Object.prototype.hasOwnProperty.call(state, "assemblies")) {
      errors.push(error("STATE_ASSEMBLIES_COLLECTION_FORBIDDEN", "Assemblies must be stored in parts using partType ASSEMBLY.", "STATE", "assemblies"));
    }
    return result(errors);
  }

  function validateReferences(state) {
    var root = validateRootShape(state);
    if (!root.valid) return root;

    var errors = [];
    var programIds = ids(state.programs);
    var variantIds = ids(state.seatVariants);
    var featureIds = ids(state.features);
    var moduleIds = ids(state.engineeringModules);
    var partIds = ids(state.parts);
    var supplierIds = ids(state.suppliers);
    var commodityIds = ids(state.commodities);
    var commodityCategoryIds = ids(state.commodityCategories);
    var ecnIds = ids(state.engineeringChanges);
    var engineeringProductStructureIds = ids(state.engineeringProductStructures);
    var partNumbers = {};
    var bomContextKeys = {};
    var changeNumbers = {};
    var revisionNumbers = {};
    var commodityCodes = {};
    var commodityCategoryNames = {};
    var variantCommodityKeys = {};

    state.commodityCategories.forEach(function (category) {
      var nameKey = String(category.name || "").trim().toUpperCase();
      if (!nameKey) errors.push(error("COMMODITY_CATEGORY_NAME_REQUIRED", "Commodity Category Name is required.", "COMMODITY_CATEGORY", category.id));
      if (nameKey && commodityCategoryNames[nameKey]) errors.push(error("COMMODITY_CATEGORY_NAME_DUPLICATE", "Commodity Category Name must be unique.", "COMMODITY_CATEGORY", category.id));
      commodityCategoryNames[nameKey] = true;
      if (["ACTIVE", "INACTIVE"].indexOf(category.status) === -1) errors.push(error("COMMODITY_CATEGORY_STATUS_INVALID", "Commodity Category status must be Active or Inactive.", "COMMODITY_CATEGORY", category.id));
    });

    state.commodities.forEach(function (commodity) {
      var codeKey = String(commodity.code || "").trim().toUpperCase();
      if (!codeKey) errors.push(error("COMMODITY_CODE_REQUIRED", "Commodity Code is required.", "COMMODITY", commodity.id));
      if (!String(commodity.name || "").trim()) errors.push(error("COMMODITY_NAME_REQUIRED", "Commodity Name is required.", "COMMODITY", commodity.id));
      if (codeKey && commodityCodes[codeKey]) errors.push(error("COMMODITY_CODE_DUPLICATE", "Commodity Code must be unique.", "COMMODITY", commodity.id));
      commodityCodes[codeKey] = true;
      requireReference(errors, "COMMODITY_CATEGORY_MISSING", commodity.categoryId, commodityCategoryIds, "COMMODITY", commodity.id);
      if (["ACTIVE", "INACTIVE"].indexOf(commodity.status) === -1) errors.push(error("COMMODITY_STATUS_INVALID", "Commodity status must be Active or Inactive.", "COMMODITY", commodity.id));
    });

    state.variantCommodityMappings.forEach(function (mapping) {
      requireReference(errors, "COMMODITY_MAPPING_VARIANT_MISSING", mapping.finishedGoodVariantId, variantIds, "VARIANT_COMMODITY_MAPPING", mapping.id);
      requireReference(errors, "COMMODITY_MAPPING_COMMODITY_MISSING", mapping.commodityId, commodityIds, "VARIANT_COMMODITY_MAPPING", mapping.id);
      var key = mapping.finishedGoodVariantId + "|" + mapping.commodityId;
      if (variantCommodityKeys[key]) errors.push(error("COMMODITY_MAPPING_DUPLICATE", "A Commodity may be mapped only once to a Finished-Good Variant.", "VARIANT_COMMODITY_MAPPING", mapping.id));
      variantCommodityKeys[key] = true;
    });

    requireReference(errors, "CONTEXT_PROGRAM_MISSING", state.context.activeProgramId, programIds, "CONTEXT", "activeProgramId");
    requireReference(errors, "CONTEXT_VARIANT_MISSING", state.context.activeSeatVariantId, variantIds, "CONTEXT", "activeSeatVariantId");
    requireReference(errors, "CONTEXT_FEATURE_CONFIGURATION_MISSING", state.context.activeFeatureConfigurationId, ids(state.featureConfigurations), "CONTEXT", "activeFeatureConfigurationId");
    var activeVariant = findById(state.seatVariants, state.context.activeSeatVariantId);
    var activeConfiguration = findById(state.featureConfigurations, state.context.activeFeatureConfigurationId);
    if (activeVariant && state.context.activeProgramId && activeVariant.programId !== state.context.activeProgramId) {
      errors.push(error("CONTEXT_VARIANT_PROGRAM_MISMATCH", "Active Seat Variant must belong to the active Program.", "CONTEXT", "activeSeatVariantId"));
    }
    if (activeConfiguration && activeVariant && activeConfiguration.seatVariantId !== activeVariant.id) {
      errors.push(error("CONTEXT_FEATURE_CONFIGURATION_VARIANT_MISMATCH", "Active Feature Configuration must belong to the active Seat Variant.", "CONTEXT", "activeFeatureConfigurationId"));
    }

    state.seatVariants.forEach(function (variant) {
      requireReference(errors, "VARIANT_PROGRAM_MISSING", variant.programId, programIds, "SEAT_VARIANT", variant.id);
    });

    state.featureConfigurations.forEach(function (configuration) {
      requireReference(errors, "FEATURE_CONFIGURATION_PROGRAM_MISSING", configuration.programId, programIds, "FEATURE_CONFIGURATION", configuration.id);
      requireReference(errors, "FEATURE_CONFIGURATION_VARIANT_MISSING", configuration.seatVariantId, variantIds, "FEATURE_CONFIGURATION", configuration.id);
      var configurationVariant = findById(state.seatVariants, configuration.seatVariantId);
      if (configurationVariant && configuration.programId && configurationVariant.programId !== configuration.programId) {
        errors.push(error("FEATURE_CONFIGURATION_PROGRAM_VARIANT_MISMATCH", "Feature Configuration Program must match its Seat Variant Program.", "FEATURE_CONFIGURATION", configuration.id));
      }
      (configuration.selectedFeatureIds || []).forEach(function (featureId) {
        requireReference(errors, "FEATURE_CONFIGURATION_FEATURE_MISSING", featureId, featureIds, "FEATURE_CONFIGURATION", configuration.id);
      });
      var selectedByFeatureId = {};
      (configuration.selections || []).forEach(function (selection) {
        var feature = findById(state.features, selection && selection.featureId);
        requireReference(errors, "FEATURE_CONFIGURATION_FEATURE_MISSING", selection && selection.featureId, featureIds, "FEATURE_CONFIGURATION", configuration.id);
        if (selection && selection.featureId) {
          if (selectedByFeatureId[selection.featureId]) {
            errors.push(error("FEATURE_CONFIGURATION_FEATURE_DUPLICATE", "A Feature may appear only once in a Feature Configuration.", "FEATURE_CONFIGURATION", configuration.id));
          }
          selectedByFeatureId[selection.featureId] = true;
        }
        if (feature && Array.isArray(feature.allowedValues) && feature.allowedValues.length && selection && selection.selectedValue) {
          var selectedValue = normalizeFeatureSelectionValue(feature, selection.selectedValue);
          if (feature.allowedValues.indexOf(selectedValue) === -1) {
            errors.push(error("FEATURE_CONFIGURATION_VALUE_INVALID", "Selected Feature value is not allowed for the referenced Feature.", "FEATURE_CONFIGURATION", configuration.id));
          }
        }
      });
    });

    state.parts.forEach(function (part) {
      requireReference(errors, "PART_MODULE_MISSING", part.engineeringModuleId, moduleIds, "PART", part.id);
      if (!part.partNumber) {
        errors.push(error("PART_NUMBER_REQUIRED", "Part Number is required.", "PART", part.id));
      }
      if (!part.name && !part.description) {
        errors.push(error("PART_NAME_REQUIRED", "Part Name is required.", "PART", part.id));
      }
      if (part.partNumber) {
        var partNumberKey = String(part.partNumber).trim().toUpperCase();
        if (partNumbers[partNumberKey]) {
          errors.push(error("PART_NUMBER_DUPLICATE", "Part Number must be unique.", "PART", part.id));
        }
        partNumbers[partNumberKey] = true;
      }
      if (["PART", "ASSEMBLY"].indexOf(part.partType) === -1) {
        errors.push(error("PART_TYPE_INVALID", "Part type must be PART or ASSEMBLY.", "PART", part.id));
      }
      if (part.lifecycleState && (app.data.referenceData.lifecycleStates || []).indexOf(part.lifecycleState) === -1) {
        errors.push(error("PART_LIFECYCLE_INVALID", "Part lifecycle status is not controlled.", "PART", part.id));
      }
      if (part.unitOfMeasure && (app.data.referenceData.unitsOfMeasure || []).indexOf(part.unitOfMeasure) === -1) {
        errors.push(error("PART_UNIT_INVALID", "Part unit of measure is not controlled.", "PART", part.id));
      }
    });

    state.engineeringBoms.forEach(function (bom) {
      requireReference(errors, "EBOM_PROGRAM_MISSING", bom.programId, programIds, "ENGINEERING_BOM", bom.id);
      requireReference(errors, "EBOM_VARIANT_MISSING", bom.seatVariantId, variantIds, "ENGINEERING_BOM", bom.id);
      requireReference(errors, "EBOM_MODULE_MISSING", bom.engineeringModuleId, moduleIds, "ENGINEERING_BOM", bom.id);
      requireReference(errors, "EBOM_ROOT_PART_MISSING", bom.rootPartId, partIds, "ENGINEERING_BOM", bom.id);
      var bomVariant = findById(state.seatVariants, bom.seatVariantId);
      if (bomVariant && bom.programId && bomVariant.programId !== bom.programId) {
        errors.push(error("EBOM_PROGRAM_VARIANT_MISMATCH", "Engineering BOM Seat Variant must belong to the referenced Program.", "ENGINEERING_BOM", bom.id));
      }
      var contextKey = [bom.programId, bom.seatVariantId, bom.engineeringModuleId].join("|");
      if (bomContextKeys[contextKey]) {
        errors.push(error("EBOM_DUPLICATE_CONTEXT", "Only one Engineering BOM per Program, Seat Variant, and Engineering Module is allowed.", "ENGINEERING_BOM", bom.id));
      }
      bomContextKeys[contextKey] = true;
      var rootPart = findById(state.parts, bom.rootPartId);
      if (rootPart && rootPart.partType !== "ASSEMBLY") {
        errors.push(error("EBOM_ROOT_NOT_ASSEMBLY", "Engineering BOM rootPartId must reference an ASSEMBLY part.", "ENGINEERING_BOM", bom.id));
      }
      if (rootPart && rootPart.engineeringModuleId !== bom.engineeringModuleId) {
        errors.push(error("EBOM_ROOT_MODULE_MISMATCH", "Engineering BOM root Part must belong to the BOM module.", "ENGINEERING_BOM", bom.id));
      }
      if (bom.lifecycleState && (app.data.referenceData.lifecycleStates || []).indexOf(bom.lifecycleState) === -1) {
        errors.push(error("EBOM_LIFECYCLE_INVALID", "Engineering BOM lifecycle status is not controlled.", "ENGINEERING_BOM", bom.id));
      }
      if (bom.completionStatus && (app.data.referenceData.engineeringBomCompletionStatuses || []).indexOf(bom.completionStatus) === -1) {
        errors.push(error("EBOM_COMPLETION_INVALID", "Engineering BOM completion status is not controlled.", "ENGINEERING_BOM", bom.id));
      }
      var duplicateBomRows = {};
      (bom.items || []).forEach(function (item) {
        requireReference(errors, "BOM_PARENT_PART_MISSING", item.parentPartId, partIds, "ENGINEERING_BOM_ITEM", item.id);
        requireReference(errors, "BOM_CHILD_PART_MISSING", item.childPartId, partIds, "ENGINEERING_BOM_ITEM", item.id);
        var parent = findById(state.parts, item.parentPartId);
        var child = findById(state.parts, item.childPartId);
        if (parent && parent.partType !== "ASSEMBLY") {
          errors.push(error("BOM_PARENT_NOT_ASSEMBLY", "BOM parentPartId must reference an ASSEMBLY part.", "ENGINEERING_BOM_ITEM", item.id));
        }
        if (parent && parent.engineeringModuleId !== bom.engineeringModuleId && (parent.allowedBomModuleIds || []).indexOf(bom.engineeringModuleId) === -1) {
          errors.push(error("BOM_PARENT_MODULE_MISMATCH", "BOM parent Part must belong to the BOM module.", "ENGINEERING_BOM_ITEM", item.id));
        }
        if (child && child.engineeringModuleId !== bom.engineeringModuleId && (child.allowedBomModuleIds || []).indexOf(bom.engineeringModuleId) === -1) {
          errors.push(error("BOM_CHILD_MODULE_MISMATCH", "BOM child Part must belong to the BOM module.", "ENGINEERING_BOM_ITEM", item.id));
        }
        if (item.parentPartId && item.childPartId && item.parentPartId === item.childPartId) {
          errors.push(error("BOM_SELF_PARENT_INVALID", "A Part cannot be its own BOM parent.", "ENGINEERING_BOM_ITEM", item.id));
        }
        if (Number(item.quantity) <= 0) {
          errors.push(error("BOM_QUANTITY_INVALID", "BOM quantity must be greater than zero.", "ENGINEERING_BOM_ITEM", item.id));
        }
        if ((app.data.referenceData.unitsOfMeasure || []).indexOf(item.unitOfMeasure) === -1) {
          errors.push(error("BOM_UNIT_INVALID", "BOM unit of measure is not controlled.", "ENGINEERING_BOM_ITEM", item.id));
        }
        var duplicateRowKey = item.parentPartId + ">" + item.childPartId;
        if (duplicateBomRows[duplicateRowKey]) {
          errors.push(error("BOM_DUPLICATE_ROW", "Duplicate child Part under the same parent is not allowed.", "ENGINEERING_BOM_ITEM", item.id));
        }
        duplicateBomRows[duplicateRowKey] = true;
        var applicability = item.applicability || {};
        (applicability.requiredFeatureIds || []).concat(applicability.excludedFeatureIds || []).forEach(function (featureId) {
          requireReference(errors, "BOM_APPLICABILITY_FEATURE_MISSING", featureId, featureIds, "ENGINEERING_BOM_ITEM", item.id);
        });
        (applicability.requiredValues || []).concat(applicability.excludedValues || []).forEach(function (condition) {
          var feature = findById(state.features, condition && condition.featureId);
          requireReference(errors, "BOM_APPLICABILITY_FEATURE_MISSING", condition && condition.featureId, featureIds, "ENGINEERING_BOM_ITEM", item.id);
          if (feature && Array.isArray(feature.allowedValues) && feature.allowedValues.length && feature.allowedValues.indexOf(condition.value) === -1) {
            errors.push(error("BOM_APPLICABILITY_VALUE_INVALID", "BOM applicability value is not allowed for the referenced Feature.", "ENGINEERING_BOM_ITEM", item.id));
          }
        });
      });
      validateBomReachability(errors, state, bom);
    });

    state.commercialRecords.forEach(function (record) {
      requireReference(errors, "COMMERCIAL_PROGRAM_MISSING", record.programId, programIds, "COMMERCIAL_RECORD", record.id);
      requireReference(errors, "COMMERCIAL_VARIANT_MISSING", record.seatVariantId, variantIds, "COMMERCIAL_RECORD", record.id);
      requireReference(errors, "COMMERCIAL_PART_MISSING", record.partId, partIds, "COMMERCIAL_RECORD", record.id);
      requireReference(errors, "COMMERCIAL_SUPPLIER_MISSING", record.supplierId, supplierIds, "COMMERCIAL_RECORD", record.id);
      requireReference(errors, "COMMERCIAL_COMMODITY_MISSING", record.commodityId, commodityIds, "COMMERCIAL_RECORD", record.id);
    });

    (state.commercialAssessments || []).forEach(function (assessment) {
      requireReference(errors, "COMMERCIAL_ASSESSMENT_PROGRAM_MISSING", assessment.programId, programIds, "COMMERCIAL_ASSESSMENT", assessment.id);
      requireReference(errors, "COMMERCIAL_ASSESSMENT_VARIANT_MISSING", assessment.seatVariantId, variantIds, "COMMERCIAL_ASSESSMENT", assessment.id);
      requireReference(errors, "COMMERCIAL_ASSESSMENT_EPS_MISSING", assessment.engineeringProductStructureId, engineeringProductStructureIds, "COMMERCIAL_ASSESSMENT", assessment.id);
      var assessmentVariant = findById(state.seatVariants, assessment.seatVariantId);
      if (assessmentVariant && assessment.programId && assessmentVariant.programId !== assessment.programId) {
        errors.push(error("COMMERCIAL_ASSESSMENT_PROGRAM_VARIANT_MISMATCH", "Commercial Assessment Seat Variant must belong to the referenced Program.", "COMMERCIAL_ASSESSMENT", assessment.id));
      }
      var structure = findById(state.engineeringProductStructures, assessment.engineeringProductStructureId);
      var structureItemIds = ids((structure && structure.items) || []);
      if (structure && (structure.programId !== assessment.programId || structure.seatVariantId !== assessment.seatVariantId)) {
        errors.push(error("COMMERCIAL_ASSESSMENT_EPS_CONTEXT_MISMATCH", "Commercial Assessment must reference the Engineering Product Structure for the same Program and Seat Variant.", "COMMERCIAL_ASSESSMENT", assessment.id));
      }
      (assessment.lineItems || []).forEach(function (line) {
        if (assessment.generationStatus === "CURRENT" && !line.obsolete && line.sourcingStatus !== "OBSOLETE") {
          requireReference(errors, "COMMERCIAL_LINE_EPS_ITEM_MISSING", line.engineeringProductStructureItemId, structureItemIds, "COMMERCIAL_LINE_ITEM", line.id);
        }
        if (line.partId) requireReference(errors, "COMMERCIAL_LINE_PART_MISSING", line.partId, partIds, "COMMERCIAL_LINE_ITEM", line.id);
        if (line.supplierId) requireReference(errors, "COMMERCIAL_LINE_SUPPLIER_MISSING", line.supplierId, supplierIds, "COMMERCIAL_LINE_ITEM", line.id);
        if (!line.currency) errors.push(error("COMMERCIAL_LINE_CURRENCY_REQUIRED", "Commercial Line currency is required.", "COMMERCIAL_LINE_ITEM", line.id));
        if (line.currency && (app.data.referenceData.currencies || []).indexOf(line.currency) === -1) {
          errors.push(error("COMMERCIAL_LINE_CURRENCY_INVALID", "Commercial Line currency is not controlled.", "COMMERCIAL_LINE_ITEM", line.id));
        }
        ["piecePrice", "toolingCost", "logisticsCost"].forEach(function (field) {
          if (Number(line[field] || 0) < 0) {
            errors.push(error("COMMERCIAL_LINE_COST_INVALID", "Commercial cost values must be non-negative.", "COMMERCIAL_LINE_ITEM", line.id));
          }
        });
        if (["SOURCED", "QUOTED"].indexOf(line.sourcingStatus) !== -1 && !line.supplierId && !line.supplier) {
          errors.push(error("COMMERCIAL_LINE_SUPPLIER_REQUIRED", "Supplier is required for sourced or quoted line items.", "COMMERCIAL_LINE_ITEM", line.id));
        }
      });
    });

    state.engineeringChanges.forEach(function (change) {
      var changeNumber = change.changeNumber || change.ecnNumber;
      if (!changeNumber) {
        errors.push(error("ENGINEERING_CHANGE_NUMBER_REQUIRED", "Engineering Change Number is required.", "ENGINEERING_CHANGE", change.id));
      } else {
        var changeNumberKey = String(changeNumber).trim().toUpperCase();
        if (changeNumbers[changeNumberKey]) {
          errors.push(error("ENGINEERING_CHANGE_NUMBER_DUPLICATE", "Engineering Change Number must be unique.", "ENGINEERING_CHANGE", change.id));
        }
        changeNumbers[changeNumberKey] = true;
      }
      if (change.status && (app.data.referenceData.ecnStatuses || []).indexOf(change.status) === -1) {
        errors.push(error("ENGINEERING_CHANGE_STATUS_INVALID", "Engineering Change status is not controlled.", "ENGINEERING_CHANGE", change.id));
      }
      if (!change.programId) errors.push(error("ECN_PROGRAM_REQUIRED", "Engineering Change must belong to a Program.", "ENGINEERING_CHANGE", change.id));
      if (!change.seatVariantId) errors.push(error("ECN_VARIANT_REQUIRED", "Engineering Change must belong to a Seat Variant.", "ENGINEERING_CHANGE", change.id));
      requireReference(errors, "ECN_PROGRAM_MISSING", change.programId, programIds, "ENGINEERING_CHANGE", change.id);
      requireReference(errors, "ECN_VARIANT_MISSING", change.seatVariantId, variantIds, "ENGINEERING_CHANGE", change.id);
      var changeVariant = findById(state.seatVariants, change.seatVariantId);
      if (changeVariant && change.programId && changeVariant.programId !== change.programId) {
        errors.push(error("ENGINEERING_CHANGE_PROGRAM_VARIANT_MISMATCH", "Engineering Change Seat Variant must belong to the referenced Program.", "ENGINEERING_CHANGE", change.id));
      }
      var affectedKeys = {};
      (change.affectedObjects || []).forEach(function (affected) {
        validateObjectReference(errors, state, affected, "ENGINEERING_CHANGE", change.id);
        if (affected && affected.objectType && affected.objectId) {
          var affectedKey = affected.objectType + "|" + affected.objectId;
          if (affectedKeys[affectedKey]) {
            errors.push(error("ENGINEERING_CHANGE_AFFECTED_DUPLICATE", "Affected object may be referenced only once.", "ENGINEERING_CHANGE", change.id));
          }
          affectedKeys[affectedKey] = true;
        }
      });
    });

    state.revisions.forEach(function (revision) {
      var revisionNumber = revision.revisionNumber || revision.revisionCode || revision.currentRevisionCode || revision.revision;
      var engineeringChangeId = revision.engineeringChangeId || revision.originatingEcnId || revision.ecnId || revision.ecnNumber;
      if (!revisionNumber) errors.push(error("REVISION_NUMBER_REQUIRED", "Revision Number is required.", "REVISION", revision.id));
      if (revisionNumber && revision.seatVariantId) {
        var revisionNumberKey = revision.seatVariantId + "|" + String(revisionNumber).trim().toUpperCase();
        if (revisionNumbers[revisionNumberKey]) {
          errors.push(error("REVISION_NUMBER_DUPLICATE", "Revision Number must be unique within a Seat Variant.", "REVISION", revision.id));
        }
        revisionNumbers[revisionNumberKey] = true;
      }
      requireReference(errors, "REVISION_PROGRAM_MISSING", revision.programId, programIds, "REVISION", revision.id);
      requireReference(errors, "REVISION_VARIANT_MISSING", revision.seatVariantId, variantIds, "REVISION", revision.id);
      var revisionVariant = findById(state.seatVariants, revision.seatVariantId);
      if (revisionVariant && revision.programId && revisionVariant.programId !== revision.programId) {
        errors.push(error("REVISION_PROGRAM_VARIANT_MISMATCH", "Revision Seat Variant must belong to the referenced Program.", "REVISION", revision.id));
      }
      requireReference(errors, "REVISION_CHANGE_MISSING", engineeringChangeId, ecnIds, "REVISION", revision.id);
      if (revision.lifecycleStatus && revision.lifecycleStatus !== "RELEASED" && revision.status !== "RELEASED") {
        errors.push(error("REVISION_LIFECYCLE_INVALID", "Revision lifecycle must be RELEASED.", "REVISION", revision.id));
      }
      if (!revision.featureConfigurationSnapshot || !revision.featureConfigurationSnapshot.id) {
        errors.push(error("REVISION_FEATURE_CONFIGURATION_SNAPSHOT_REQUIRED", "Feature Configuration snapshot is required.", "REVISION", revision.id));
      }
      if (!Array.isArray(revision.partsSnapshot) || !revision.partsSnapshot.length) {
        errors.push(error("REVISION_PARTS_SNAPSHOT_REQUIRED", "Parts snapshot is required.", "REVISION", revision.id));
      }
      if (!Array.isArray(revision.engineeringBomSnapshots) || !revision.engineeringBomSnapshots.length) {
        errors.push(error("REVISION_BOM_SNAPSHOT_REQUIRED", "Engineering BOM snapshots are required.", "REVISION", revision.id));
      }
      if (!revision.engineeringProductStructureSnapshot || !revision.engineeringProductStructureSnapshot.id) {
        errors.push(error("REVISION_EPS_SNAPSHOT_REQUIRED", "Engineering Product Structure snapshot is required.", "REVISION", revision.id));
      }
      if (!revision.commercialAssessmentSnapshot || !revision.commercialAssessmentSnapshot.id) {
        errors.push(error("REVISION_COMMERCIAL_ASSESSMENT_SNAPSHOT_REQUIRED", "Commercial Assessment snapshot is required.", "REVISION", revision.id));
      }
      if (!revision.snapshotHash) errors.push(error("REVISION_SNAPSHOT_HASH_REQUIRED", "Revision snapshot hash is required.", "REVISION", revision.id));
    });

    return result(errors);
  }

  function validateObjectReference(errors, state, reference, ownerType, ownerId) {
    if (reference && reference.objectType === "ENGINEERING_BOM_ITEM") {
      var bomItemExists = (state.engineeringBoms || []).some(function (bom) {
        return (bom.items || []).some(function (item) { return item.id === reference.objectId; });
      });
      if (!bomItemExists) errors.push(error("OBJECT_REFERENCE_MISSING", "Affected Engineering BOM Item does not exist.", ownerType, ownerId));
      return;
    }
    if (reference && reference.objectType === "ENGINEERING_PRODUCT_STRUCTURE_ITEM") {
      var epsItemExists = (state.engineeringProductStructures || []).some(function (structure) {
        return (structure.items || []).some(function (item) { return item.id === reference.objectId; });
      });
      if (!epsItemExists) errors.push(error("OBJECT_REFERENCE_MISSING", "Affected Complete Seat Item does not exist.", ownerType, ownerId));
      return;
    }
    if (reference && reference.objectType === "COMMERCIAL_LINE") {
      var commercialLineExists = (state.commercialAssessments || []).some(function (assessment) {
        return (assessment.lineItems || []).some(function (line) { return line.id === reference.objectId; });
      });
      if (!commercialLineExists) errors.push(error("OBJECT_REFERENCE_MISSING", "Affected Commercial Line does not exist.", ownerType, ownerId));
      return;
    }
    var collectionByType = {
      PART: "parts",
      ENGINEERING_BOM: "engineeringBoms",
      ENGINEERING_PRODUCT_STRUCTURE: "engineeringProductStructures",
      COMMERCIAL_ASSESSMENT: "commercialAssessments",
      FEATURE_CONFIGURATION: "featureConfigurations",
      COMMERCIAL_RECORD: "commercialRecords"
    };
    var collectionName = reference && collectionByType[reference.objectType];
    if (!collectionName) {
      errors.push(error("OBJECT_REFERENCE_TYPE_INVALID", "Affected object type is not supported.", ownerType, ownerId));
      return;
    }
    requireReference(errors, "OBJECT_REFERENCE_MISSING", reference.objectId, ids(state[collectionName]), ownerType, ownerId);
  }

  function normalizeFeatureSelectionValue(feature, value) {
    var selected = String(value == null ? "" : value).trim();
    if (feature && feature.valueType === "BOOLEAN" && selected.toUpperCase() === "SELECTED" && (feature.allowedValues || []).indexOf("YES") !== -1) return "YES";
    return selected;
  }

  function validateBomReachability(errors, state, bom) {
    var items = bom.items || [];
    var childrenByParent = {};
    items.forEach(function (item) {
      childrenByParent[item.parentPartId] = childrenByParent[item.parentPartId] || [];
      childrenByParent[item.parentPartId].push(item.childPartId);
    });
    var reachable = {};
    var visiting = {};
    function walk(partId, ancestors) {
      if (visiting[partId]) {
        errors.push(error("BOM_HIERARCHY_CYCLE", "BOM hierarchy must not contain cycles.", "ENGINEERING_BOM", bom.id));
        return;
      }
      visiting[partId] = true;
      reachable[partId] = true;
      (childrenByParent[partId] || []).forEach(function (childId) {
        if (ancestors.indexOf(childId) !== -1) {
          errors.push(error("BOM_HIERARCHY_CYCLE", "A Part must not be its own ancestor.", "ENGINEERING_BOM", bom.id));
          return;
        }
        walk(childId, ancestors.concat(partId));
      });
      delete visiting[partId];
    }
    if (bom.rootPartId) walk(bom.rootPartId, []);
    items.forEach(function (item) {
      if (!reachable[item.parentPartId] || !reachable[item.childPartId]) {
        errors.push(error("BOM_ORPHAN_ROW", "BOM item must be reachable from the root Assembly.", "ENGINEERING_BOM_ITEM", item.id));
      }
    });
  }

  function requireReference(errors, code, value, validIds, objectType, objectId) {
    if (!value) return;
    if (validIds.indexOf(value) === -1) {
      errors.push(error(code, "Referenced object does not exist: " + value, objectType, objectId));
    }
  }

  function ids(collection) {
    return (collection || []).map(function (item) {
      return item.id;
    });
  }

  function findById(collection, id) {
    return (collection || []).find(function (item) {
      return item.id === id;
    });
  }

  app.core.validationService = {
    REQUIRED_COLLECTIONS: REQUIRED_COLLECTIONS.slice(),
    validateCollectionName: validateCollectionName,
    validateRootShape: validateRootShape,
    validateReferences: validateReferences,
    validateObject: function () {
      return result([]);
    },
    validateOperation: function () {
      return result([]);
    },
    validateReleaseReadiness: function () {
      return result([], [{ code: "RELEASE_READINESS_NOT_IMPLEMENTED", message: "Release readiness is outside Milestone 1." }]);
    }
  };
})(typeof window !== "undefined" ? (window.DEP = window.DEP || {}) : (globalThis.DEP = globalThis.DEP || {}));
