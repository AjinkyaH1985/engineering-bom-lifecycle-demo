(function (app) {
  app.domain = app.domain || {};

  var IMAGE_MAPPING_VERSION = 2;

  function getImportHistory() {
    var state = app.core.appState.getState();
    return clone((state.metadata && state.metadata.importHistory) || []).sort(function (a, b) {
      return String(b.importedAt || b.validatedAt || "").localeCompare(String(a.importedAt || a.validatedAt || ""));
    });
  }

  function findCompletedImportByFingerprint(workbookFingerprint) {
    if (!workbookFingerprint) return null;
    return getImportHistory().find(function (item) {
      return item.status === "COMPLETED" && item.workbookFingerprint === workbookFingerprint;
    }) || null;
  }

  function findExistingImportForModel(model) {
    if (!model) return null;
    return findCompletedImportByFingerprint(model.workbookFingerprint);
  }

  function normalizeExistingImportDuplicates(options) {
    var current = app.core.appState.getState();
    var marker = current.metadata && current.metadata.migrations && current.metadata.migrations.bomImportDuplicateNormalization;
    if (marker && !(options && options.force)) return clone(marker);
    var report = { repairedImportIds: [], protectedImportIds: [], repairedPrograms: 0, repairedBoms: 0, repairedBomItems: 0, repairedParts: 0 };
    app.core.appState.transaction(function (state) {
      var history = ensureHistory(state);
      var completed = history.filter(function (item) { return item.status === "COMPLETED" && item.targetContextIds && item.targetContextIds.programId; });
      var groups = {};
      completed.forEach(function (record) {
        var key = record.workbookFingerprint || legacyImportIdentity(record);
        groups[key] = groups[key] || [];
        groups[key].push(record);
      });
      Object.keys(groups).forEach(function (key) {
        var records = groups[key].slice().sort(function (a, b) { return String(a.importedAt || "").localeCompare(String(b.importedAt || "")); });
        if (records.length < 2) return;
        var canonicalRecord = records[0];
        var canonicalSignature = importedContextSignature(state, canonicalRecord);
        records.slice(1).forEach(function (duplicateRecord) {
          if (!canonicalSignature || canonicalSignature !== importedContextSignature(state, duplicateRecord)) return;
          if (importContextHasDownstreamHistory(state, duplicateRecord)) {
            duplicateRecord.duplicateOfImportId = canonicalRecord.importId;
            duplicateRecord.duplicateNormalizationStatus = "REVIEW_REQUIRED";
            report.protectedImportIds.push(duplicateRecord.importId);
            return;
          }
          var removed = removeImportedContext(state, duplicateRecord, canonicalRecord);
          duplicateRecord.status = "DUPLICATE_REMOVED";
          duplicateRecord.duplicateOfImportId = canonicalRecord.importId;
          duplicateRecord.duplicateRemovedAt = new Date().toISOString();
          canonicalRecord.duplicateImportIdsRemoved = uniqueValues((canonicalRecord.duplicateImportIdsRemoved || []).concat(duplicateRecord.importId));
          report.repairedImportIds.push(duplicateRecord.importId);
          report.repairedPrograms += removed.programs;
          report.repairedBoms += removed.boms;
          report.repairedBomItems += removed.bomItems;
          report.repairedParts += removed.parts;
        });
      });
      state.metadata.migrations = state.metadata.migrations || {};
      state.metadata.migrations.bomImportDuplicateNormalization = Object.assign({ completedAt: new Date().toISOString() }, report);
      if (report.repairedImportIds.length || report.protectedImportIds.length) {
        app.core.appState._recordAuditEvent(state, {
          objectType: "BOM_IMPORT",
          objectId: "IMPORT-DUPLICATE-NORMALIZATION",
          action: "IMPORT_DUPLICATES_NORMALIZED",
          details: report.repairedImportIds.length + " duplicate import context(s) removed; " + report.protectedImportIds.length + " protected context(s) retained for review."
        });
      }
    });
    return clone(report);
  }

  function legacyImportIdentity(record) {
    var counts = record.recordCounts || {};
    var name = String(record.sourceWorkbookName || record.workbookName || "").toUpperCase().replace(/\s*\(\d+\)(?=\.XLSX$)/, "").replace(/\s+/g, " ").trim();
    return "LEGACY|" + [record.workbookType, name, counts.variants, counts.engineeringBoms, counts.bomItems].join("|");
  }

  function importedContextSignature(state, record) {
    var programId = record.targetContextIds && record.targetContextIds.programId;
    var program = (state.programs || []).find(function (item) { return item.id === programId; });
    if (!program) return "";
    var variantsById = indexById(state.seatVariants || []);
    var modulesById = indexById(state.engineeringModules || []);
    var partsById = indexById(state.parts || []);
    var rows = (state.engineeringBoms || []).filter(function (bom) { return bom.programId === programId; }).reduce(function (result, bom) {
      var variant = variantsById[bom.seatVariantId] || {};
      var module = modulesById[bom.engineeringModuleId] || {};
      (bom.items || []).forEach(function (item) {
        var parent = partsById[item.parentPartId] || {};
        var child = partsById[item.childPartId] || {};
        result.push([
          normalizeCode(module.code),
          normalizeCode(variant.variantCode),
          normalizeCode(item.sourceWorkbookSheet),
          String(item.sourceWorkbookRow || ""),
          normalizeImportedPartNumber(parent.partNumber),
          normalizeImportedPartNumber(child.partNumber),
          Number(item.quantity || 0)
        ].join("|"));
      });
      return result;
    }, []).sort();
    var variantCodes = (state.seatVariants || []).filter(function (variant) { return variant.programId === programId; }).map(function (variant) { return normalizeCode(variant.variantCode); }).sort();
    return stableHash(variantCodes.join(",") + "\n" + rows.join("\n"));
  }

  function normalizeImportedPartNumber(value) {
    var normalized = normalizePartNumber(value);
    var synthetic = /^IMP-.*-(STRUCTURE|FOAM|PLASTIC|TRIM|HEAD-REST|ARM-REST)-(ROOT|GROUP-\d+|ROW-\d+)$/.exec(normalized);
    if (synthetic) return "IMP-SYNTHETIC-" + synthetic[1] + "-" + synthetic[2];
    return /^IMP-.*-(?:ROOT|GROUP-\d+|ROW-\d+)$/.test(normalized) ? normalized.replace(/^IMP-[^-]+-[^-]+-/, "IMP-SYNTHETIC-") : normalized;
  }

  function importContextHasDownstreamHistory(state, record) {
    var programId = record.targetContextIds.programId;
    return ["engineeringProductStructures", "commercialAssessments", "engineeringChanges", "revisions"].some(function (collectionName) {
      return (state[collectionName] || []).some(function (item) { return item.programId === programId; });
    });
  }

  function removeImportedContext(state, duplicateRecord, canonicalRecord) {
    var duplicateProgramId = duplicateRecord.targetContextIds.programId;
    var canonicalProgramId = canonicalRecord.targetContextIds.programId;
    var duplicateVariants = (state.seatVariants || []).filter(function (variant) { return variant.programId === duplicateProgramId; });
    var duplicateVariantIds = duplicateVariants.map(function (variant) { return variant.id; });
    var candidatePartIds = {};
    var removedBoms = (state.engineeringBoms || []).filter(function (bom) { return bom.programId === duplicateProgramId; });
    removedBoms.forEach(function (bom) {
      candidatePartIds[bom.rootPartId] = true;
      (bom.items || []).forEach(function (item) { candidatePartIds[item.parentPartId] = true; candidatePartIds[item.childPartId] = true; });
    });
    var removedItemCount = removedBoms.reduce(function (count, bom) { return count + (bom.items || []).length; }, 0);
    state.engineeringBoms = (state.engineeringBoms || []).filter(function (bom) { return bom.programId !== duplicateProgramId; });
    state.variantCommodityMappings = (state.variantCommodityMappings || []).filter(function (mapping) {
      return duplicateVariantIds.indexOf(mapping.finishedGoodVariantId) === -1;
    });
    state.featureConfigurations = (state.featureConfigurations || []).filter(function (configuration) { return duplicateVariantIds.indexOf(configuration.seatVariantId) === -1; });
    state.seatVariants = (state.seatVariants || []).filter(function (variant) { return variant.programId !== duplicateProgramId; });
    state.programs = (state.programs || []).filter(function (program) { return program.id !== duplicateProgramId; });
    var removedPartCount = 0;
    state.parts = (state.parts || []).filter(function (part) {
      if (!candidatePartIds[part.id] || !/^PART-IMPORT-/.test(part.id) || partHasReferences(state, part.id)) return true;
      removedPartCount += 1;
      return false;
    });
    if (state.context && state.context.activeProgramId === duplicateProgramId) {
      var canonicalVariant = findEquivalentVariant(state, canonicalProgramId, duplicateRecord.targetContextIds.seatVariantId, duplicateVariants);
      var canonicalConfiguration = canonicalVariant && (state.featureConfigurations || []).find(function (configuration) { return configuration.seatVariantId === canonicalVariant.id; });
      state.context.activeProgramId = canonicalProgramId;
      state.context.activeSeatVariantId = canonicalVariant ? canonicalVariant.id : null;
      state.context.activeFeatureConfigurationId = canonicalConfiguration ? canonicalConfiguration.id : null;
    }
    return { programs: 1, boms: removedBoms.length, bomItems: removedItemCount, parts: removedPartCount };
  }

  function findEquivalentVariant(state, canonicalProgramId, duplicateVariantId, duplicateVariants) {
    var duplicate = duplicateVariants.find(function (variant) { return variant.id === duplicateVariantId; });
    return (state.seatVariants || []).find(function (variant) {
      return variant.programId === canonicalProgramId && duplicate && normalizeCode(variant.variantCode) === normalizeCode(duplicate.variantCode);
    }) || null;
  }

  function partHasReferences(state, partId) {
    if ((state.engineeringBoms || []).some(function (bom) {
      return bom.rootPartId === partId || (bom.items || []).some(function (item) { return item.parentPartId === partId || item.childPartId === partId; });
    })) return true;
    if ((state.engineeringProductStructures || []).some(function (structure) { return (structure.items || []).some(function (item) { return item.partId === partId; }); })) return true;
    if ((state.commercialAssessments || []).some(function (assessment) { return (assessment.lineItems || []).some(function (line) { return line.partId === partId; }); })) return true;
    if ((state.engineeringChanges || []).some(function (change) { return (change.affectedObjects || []).some(function (affected) { return affected.partId === partId || (affected.objectType === "PART" && affected.objectId === partId); }); })) return true;
    return false;
  }

  function recordWorkbookValidation(model) {
    var completed = findExistingImportForModel(model);
    if (completed) return clone(completed);
    var now = new Date().toISOString();
    return app.core.appState.transaction(function (state) {
      var history = ensureHistory(state);
      upsertHistory(history, {
        importId: model.importId,
        workbookFingerprint: model.workbookFingerprint,
        sourceWorkbookName: model.workbookName,
        workbookName: model.workbookName,
        workbookType: model.workbookType,
        status: model.valid ? "VALIDATED" : "VALIDATION_FAILED",
        validatedAt: now,
        recordCounts: clone(model.counts || {}),
        warningCount: model.counts && model.counts.warnings || 0,
        errorCount: model.counts && model.counts.errors || 0,
        targetContextIds: null
      });
      app.core.appState._recordAuditEvent(state, {
        objectType: "BOM_IMPORT",
        objectId: model.importId,
        action: "WORKBOOK_VALIDATED",
        details: model.workbookName + ": " + (model.valid ? "valid" : "validation failed")
      });
    });
  }

  function importWorkbook(model) {
    assertImportable(model);
    recordImportStarted(model);
    try {
      var result = commitImport(model);
      return result;
    } catch (cause) {
      recordImportFailed(model, cause);
      throw cause;
    }
  }

  function importWorkbookWithImages(model) {
    assertImportable(model);
    var imageService = app.domain.partImageService;
    var assets = model.imageAssets || [];
    if (!imageService || !assets.length) return Promise.resolve(importWorkbook(model));
    return imageService.persistAssets(assets).then(function (stored) {
      try {
        return importWorkbook(model);
      } catch (cause) {
        return imageService.removeAssets(stored.references).then(function () {
          throw cause;
        }, function () {
          throw cause;
        });
      }
    }, function (cause) {
      recordImportFailed(model, cause);
      throw cause;
    });
  }

  function needsPartImageRepair(importRecord) {
    return Boolean(importRecord && importRecord.status === "COMPLETED" && Number(importRecord.imageMappingVersion || 0) < IMAGE_MAPPING_VERSION);
  }

  function repairImportedPartImagesWithAssets(model) {
    var existingImport = findExistingImportForModel(model);
    if (!existingImport) return Promise.reject(businessError("The completed workbook import was not found.", "IMPORT_CONTEXT_MISSING", model && model.importId));
    if (!needsPartImageRepair(existingImport)) return Promise.resolve(clone(existingImport));
    var imageService = app.domain.partImageService;
    var assets = model.imageAssets || [];
    var persist = imageService && assets.length ? imageService.persistAssets(assets) : Promise.resolve({ stored: 0, references: [] });
    return persist.then(function (stored) {
      return repairImportedPartImages(model, existingImport, stored.stored || 0);
    });
  }

  function repairImportedPartImages(model, existingImport, storedAssetCount) {
    var corrected = null;
    app.core.appState.transaction(function (state) {
      var sourcesByNumber = {};
      (model.modules || []).forEach(function (sourceModule) {
        (sourceModule.parts || []).forEach(function (source) {
          var key = normalizePartNumber(source.partNumber);
          var current = sourcesByNumber[key];
          if (!current || (!current.source.imageReference && source.imageReference)) {
            sourcesByNumber[key] = { source: source, moduleCode: sourceModule.moduleCode };
          }
        });
      });
      var partsById = indexById(state.parts || []);
      var updatedPartIds = [];
      var preservedPartIds = [];
      (state.parts || []).forEach(function (part) {
        var mapped = sourcesByNumber[normalizePartNumber(part.partNumber)];
        if (!mapped || !partBelongsToImport(part, model.workbookFingerprint)) return;
        var source = mapped.source;
        var importerOwnsCurrentImage = isWorkbookManagedImage(part.imageReference, model.workbookFingerprint) || isPlaceholderImage(part.imageReference) || !part.imageReference;
        if (!importerOwnsCurrentImage) {
          preservedPartIds.push(part.id);
          return;
        }
        var nextReference = source.imageReference || moduleImageReference(mapped.moduleCode);
        if (part.imageReference !== nextReference) updatedPartIds.push(part.id);
        part.imageReference = nextReference;
        part.sourceImagePresent = Boolean(source.sourceImagePresent);
        part.sourceWorkbookImageAnchor = source.sourceWorkbookImageAnchor || "";
        part.sourceWorkbookImageAnchors = clone(source.sourceWorkbookImageAnchors || []);
        part.sourceWorkbookImageRow = source.sourceWorkbookImageRow || null;
        part.sourceWorkbookImageColumn = source.sourceWorkbookImageColumn || null;
        part.sourceImageMediaPath = source.sourceImageMediaPath || "";
        part.sourceImageMimeType = source.sourceImageMimeType || "";
      });
      refreshMutableImageSnapshots(state, partsById);
      var history = ensureHistory(state);
      var record = findHistory(history, existingImport.importId);
      record.imageMappingVersion = IMAGE_MAPPING_VERSION;
      record.imageMappingRepairedAt = new Date().toISOString();
      record.imageMappingRepair = {
        updatedParts: updatedPartIds.length,
        preservedUserImages: preservedPartIds.length,
        imageAssetsStored: storedAssetCount
      };
      app.core.appState._recordAuditEvent(state, {
        objectType: "BOM_IMPORT",
        objectId: record.importId,
        action: "PART_IMAGE_MAPPING_REPAIRED",
        details: updatedPartIds.length + " imported Part image association(s) corrected; " + preservedPartIds.length + " user-assigned image(s) preserved."
      });
      corrected = clone(record);
    });
    return corrected;
  }

  function partBelongsToImport(part, workbookFingerprint) {
    if (part.sourceWorkbookFingerprint === workbookFingerprint) return true;
    return (part.sourceWorkbookImageAnchors || []).some(function (anchor) {
      return isWorkbookManagedImage(part.imageReference, workbookFingerprint) && Boolean(anchor);
    });
  }

  function isWorkbookManagedImage(reference, workbookFingerprint) {
    var prefix = "eblp-part-image://" + encodeURIComponent(workbookFingerprint) + "/";
    return String(reference || "").indexOf(prefix) === 0;
  }

  function refreshMutableImageSnapshots(state, partsById) {
    (state.engineeringProductStructures || []).forEach(function (structure) {
      if (normalizeCode(structure.lifecycleState || structure.lifecycleStatus) === "RELEASED") return;
      (structure.items || []).forEach(function (item) {
        var part = partsById[item.partId];
        if (part && item.sourcePartSnapshot) item.sourcePartSnapshot.imageReference = part.imageReference || "";
      });
    });
    (state.commercialAssessments || []).forEach(function (assessment) {
      if (normalizeCode(assessment.lifecycleState || assessment.lifecycleStatus) === "RELEASED") return;
      (assessment.lineItems || []).forEach(function (line) {
        var part = partsById[line.partId];
        if (part && line.sourcePartSnapshot) line.sourcePartSnapshot.imageReference = part.imageReference || "";
      });
    });
  }

  function commitImport(model) {
    var summary = null;
    app.core.appState.transaction(function (state) {
      var token = idToken(model.importId);
      var programId = uniqueId(state.programs, "PGM-IMPORT-" + token);
      var program = app.domain.programService.normalizeProgram(Object.assign({}, model.program, { id: programId }));
      assertUniqueProgram(program, state.programs);
      state.programs.push(program);

      var variantIdBySource = {};
      var variants = model.variants.map(function (source) {
        var variant = app.domain.seatVariantService.normalizeSeatVariant(Object.assign({}, source, {
          id: uniqueId(state.seatVariants, "VAR-IMPORT-" + token + "-" + idToken(source.sourceKey)),
          programId: program.id
        }));
        assertUniqueVariant(variant, state.seatVariants);
        state.seatVariants.push(variant);
        variantIdBySource[source.sourceKey] = variant.id;
        return variant;
      });

      var featureIdByCode = {};
      var createdFeatures = [];
      var reusedFeatures = [];
      model.features.forEach(function (source) {
        var existing = state.features.find(function (feature) { return normalizeCode(feature.featureCode || feature.code) === normalizeCode(source.featureCode); });
        if (existing) {
          assertFeatureCompatibility(existing, source);
          featureIdByCode[source.featureCode] = existing.id;
          reusedFeatures.push(existing.id);
          return;
        }
        var feature = app.domain.featureService.normalizeFeature(Object.assign({}, source, {
          id: uniqueId(state.features, "FEAT-IMPORT-" + token + "-" + idToken(source.featureCode))
        }));
        app.domain.featureService.validateFeature(feature, state.features);
        state.features.push(feature);
        featureIdByCode[source.featureCode] = feature.id;
        createdFeatures.push(feature);
      });

      var configurations = model.featureConfigurations.map(function (source) {
        var variantId = variantIdBySource[source.variantSourceKey];
        var configuration = app.domain.featureConfigurationService.normalizeFeatureConfiguration({
          id: uniqueId(state.featureConfigurations, "FC-IMPORT-" + token + "-" + idToken(source.variantSourceKey)),
          programId: program.id,
          seatVariantId: variantId,
          name: source.name,
          status: "ACTIVE",
          lifecycleState: "IN_WORK",
          downstreamStatus: "NOT_GENERATED",
          trimMaterial: source.trimMaterial,
          selections: source.selections.map(function (selection) {
            return { featureId: featureIdByCode[selection.featureCode], selectedValue: selection.selectedValue };
          })
        });
        app.domain.featureConfigurationService.validateFeatureConfiguration(configuration, state.featureConfigurations, state.seatVariants, state.features);
        state.featureConfigurations.push(configuration);
        return configuration;
      });

      var partIdByModuleAndNumber = {};
      var partsByNumber = state.parts.reduce(function (result, part) {
        result[normalizePartNumber(part.partNumber)] = part;
        return result;
      }, {});
      var createdParts = [];
      var reusedParts = [];
      model.modules.forEach(function (sourceModule) {
        var module = requireOrCreateModule(state, sourceModule, token);
        sourceModule.resolvedModuleId = module.id;
        sourceModule.parts.forEach(function (source) {
          var numberKey = normalizePartNumber(source.partNumber);
          var existing = partsByNumber[numberKey];
          var allowedModuleCodes = (source.allowedBomModuleCodes || []).map(normalizeCode);
          var existingModule = existing && state.engineeringModules.find(function (candidate) { return candidate.id === existing.engineeringModuleId; });
          var sharedModuleUsage = existing && existingModule && allowedModuleCodes.length > 1 &&
            allowedModuleCodes.indexOf(normalizeCode(sourceModule.moduleCode)) !== -1 &&
            allowedModuleCodes.indexOf(normalizeCode(existingModule.code)) !== -1;
          if (existing && existing.engineeringModuleId !== module.id && !sharedModuleUsage) {
            throw businessError("Imported Part Number conflicts with another engineering discipline.", "IMPORT_PART_MODULE_CONFLICT", source.partNumber);
          }
          var part;
          if (existing) {
            assertPartCompatibility(existing, source, model.workbookFingerprint);
            mergePartSourceTraceability(existing, source, model.workbookFingerprint);
            if (source.imageReference && (!existing.imageReference || isPlaceholderImage(existing.imageReference))) {
              existing.imageReference = source.imageReference;
            }
            existing.allowedBomModuleIds = uniqueValues((existing.allowedBomModuleIds || [existing.engineeringModuleId]).concat(module.id));
            if (source.partType === "ASSEMBLY") existing.partType = "ASSEMBLY";
            part = existing;
            reusedParts.push(existing.id);
          } else {
            part = app.domain.partService.normalizePart(Object.assign({}, source, {
              id: uniqueId(state.parts, "PART-IMPORT-" + token + "-" + idToken(sourceModule.moduleCode) + "-" + idToken(source.partNumber)),
              engineeringModuleId: module.id,
              allowedBomModuleIds: [module.id],
              imageReference: source.imageReference || moduleImageReference(sourceModule.moduleCode),
              category: source.category || importedPartCategory(source)
            }));
            app.domain.partService.validatePart(part, state.parts, state.engineeringModules);
            state.parts.push(part);
            partsByNumber[numberKey] = part;
            createdParts.push(part);
          }
          partIdByModuleAndNumber[sourceModule.moduleCode + "|" + numberKey] = part.id;
        });
      });

      var createdBoms = [];
      model.modules.forEach(function (sourceModule) {
        var moduleId = sourceModule.resolvedModuleId;
        sourceModule.boms.forEach(function (source) {
          var variantId = variantIdBySource[source.variantSourceKey];
          var rootPartId = partIdByModuleAndNumber[sourceModule.moduleCode + "|" + normalizePartNumber(source.rootSourcePartNumber)];
          var bom = app.domain.engineeringBomService.normalizeEngineeringBom({
            id: uniqueId(state.engineeringBoms, "EBOM-IMPORT-" + token + "-" + idToken(sourceModule.moduleCode) + "-" + idToken(source.variantSourceKey)),
            programId: program.id,
            seatVariantId: variantId,
            engineeringModuleId: moduleId,
            rootPartId: rootPartId,
            lifecycleState: source.lifecycleState,
            completionStatus: source.completionStatus,
            items: source.items.map(function (item) {
              return {
                id: "BOMITEM-IMPORT-" + idToken(item.sourceOccurrenceKey || [model.workbookFingerprint, sourceModule.moduleCode, source.variantSourceKey, item.sourceWorkbookRow].join("-")),
                parentPartId: partIdByModuleAndNumber[sourceModule.moduleCode + "|" + normalizePartNumber(item.parentSourcePartNumber)],
                childPartId: partIdByModuleAndNumber[sourceModule.moduleCode + "|" + normalizePartNumber(item.childSourcePartNumber)],
                oemJit: item.oemJit,
                internalJit: item.internalJit,
                quantity: item.quantity,
                unitOfMeasure: item.unitOfMeasure,
                sequence: item.sequence,
                totalCadWeight: item.totalCadWeight,
                changeClassification: item.changeClassification,
                remark: item.remark,
                sourceWorkbookSheet: item.sourceWorkbookSheet || sourceModule.sheetName || "",
                sourceWorkbookRow: item.sourceWorkbookRow || "",
                sourceWorkbookFingerprint: model.workbookFingerprint,
                sourceOccurrenceKey: item.sourceOccurrenceKey || "",
                hierarchyPath: item.hierarchyPath || "",
                duplicateSourceRows: item.duplicateSourceRows || [],
                applicability: item.applicability
              };
            })
          });
          state.engineeringBoms.push(bom);
          app.domain.engineeringBomService.validateEngineeringBom(bom, state, bom.id);
          createdBoms.push(bom);
        });
      });

      var activeVariant = variants[0] || null;
      var activeConfiguration = activeVariant && configurations.find(function (configuration) { return configuration.seatVariantId === activeVariant.id; });
      state.context.activeProgramId = program.id;
      state.context.activeSeatVariantId = activeVariant ? activeVariant.id : null;
      state.context.activeFeatureConfigurationId = activeConfiguration ? activeConfiguration.id : null;
      summary = {
        importId: model.importId,
        workbookFingerprint: model.workbookFingerprint,
        sourceWorkbookName: model.workbookName,
        workbookName: model.workbookName,
        workbookType: model.workbookType,
        importedAt: new Date().toISOString(),
        status: "COMPLETED",
        imageMappingVersion: IMAGE_MAPPING_VERSION,
        programId: program.id,
        programCode: program.programCode,
        programName: program.name,
        variantIds: variants.map(function (variant) { return variant.id; }),
        variantCodes: variants.map(function (variant) { return variant.variantCode; }),
        featureConfigurationIds: configurations.map(function (configuration) { return configuration.id; }),
        recordCounts: {
          programs: 1,
          variants: variants.length,
          featuresCreated: createdFeatures.length,
          featuresReused: reusedFeatures.length,
          partsCreated: createdParts.length,
          partsReused: reusedParts.length,
          duplicateIdenticalPartOccurrences: model.counts.duplicateIdenticalPartOccurrences || 0,
          conflictingParts: model.counts.conflictingParts || 0,
          acceptedSourceVariances: model.counts.acceptedSourceVariances || 0,
          acceptedInactiveSourceVariances: model.counts.acceptedInactiveSourceVariances || 0,
          assemblies: createdParts.filter(function (part) { return part.partType === "ASSEMBLY"; }).length,
          engineeringBoms: createdBoms.length,
          engineeringBomsReused: 0,
          bomItems: createdBoms.reduce(function (count, bom) { return count + bom.items.length; }, 0),
          duplicateBomOccurrencesSkipped: model.counts.duplicateBomOccurrencesSkipped || 0,
          ignoredPresentationRows: model.counts.skippedRows || 0,
          partImagesImported: model.counts.partImagesMapped || 0,
          imageAssetsStored: model.counts.imageAssets || 0,
          unsupportedPartImages: model.counts.unsupportedPartImages || 0,
          commodityValuesDetected: model.commodities.length,
          commodities: 0
        },
        warningCount: model.counts.warnings,
        errorCount: 0,
        skippedRows: model.counts.skippedRows,
        targetContextIds: {
          programId: program.id,
          seatVariantId: activeVariant && activeVariant.id,
          featureConfigurationId: activeConfiguration && activeConfiguration.id
        }
      };
      upsertHistory(ensureHistory(state), summary);
      app.core.appState._recordAuditEvent(state, {
        objectType: "BOM_IMPORT",
        objectId: model.importId,
        action: "WORKBOOK_IMPORT_COMPLETED",
        details: model.workbookName + "; Programme " + program.programCode + "; " + summary.recordCounts.partsCreated + " Parts; " + summary.recordCounts.bomItems + " BOM items"
      });
    });
    return clone(summary);
  }

  function recordImportStarted(model) {
    app.core.appState.transaction(function (state) {
      var existing = findHistory(ensureHistory(state), model.importId) || {};
      upsertHistory(ensureHistory(state), Object.assign({}, existing, {
        importId: model.importId,
        workbookFingerprint: model.workbookFingerprint,
        sourceWorkbookName: model.workbookName,
        workbookName: model.workbookName,
        workbookType: model.workbookType,
        status: "IMPORTING",
        startedAt: new Date().toISOString(),
        recordCounts: clone(model.counts || {})
      }));
      app.core.appState._recordAuditEvent(state, {
        objectType: "BOM_IMPORT",
        objectId: model.importId,
        action: "WORKBOOK_IMPORT_STARTED",
        details: model.workbookName
      });
    });
  }

  function recordImportFailed(model, cause) {
    app.core.appState.transaction(function (state) {
      var existing = findHistory(ensureHistory(state), model.importId) || {};
      upsertHistory(ensureHistory(state), Object.assign({}, existing, {
        status: "FAILED",
        failedAt: new Date().toISOString(),
        failureMessage: businessMessage(cause),
        errorCount: Math.max(1, model.counts && model.counts.errors || 0)
      }));
      app.core.appState._recordAuditEvent(state, {
        objectType: "BOM_IMPORT",
        objectId: model.importId,
        action: "WORKBOOK_IMPORT_FAILED",
        details: model.workbookName + ": " + businessMessage(cause)
      });
    });
  }

  function openImportedProgramme(importId) {
    var record = getImportHistory().find(function (item) { return item.importId === importId; });
    if (!record || record.status !== "COMPLETED" || !record.targetContextIds) {
      throw businessError("Completed import context was not found.", "IMPORT_CONTEXT_MISSING", importId);
    }
    app.core.contextService.setActiveBusinessContext({
      programId: record.targetContextIds.programId,
      seatVariantId: record.targetContextIds.seatVariantId || null
    });
    return clone(record.targetContextIds);
  }

  function assertImportable(model) {
    if (!model || !model.supported) throw businessError("Unsupported workbook format.", "IMPORT_WORKBOOK_UNSUPPORTED", null);
    if (model.previewOnly) throw businessError("BOM Cost workbooks are preview-only in this milestone.", "IMPORT_COST_PREVIEW_ONLY", model.importId);
    if (!model.valid) throw new app.core.errors.BusinessOperationError("Workbook validation must pass before import.", (model.diagnostics || []).filter(function (item) { return item.severity === "ERROR"; }));
    var prior = findExistingImportForModel(model) || getImportHistory().find(function (item) { return item.importId === model.importId && item.status === "COMPLETED"; });
    if (prior) throw businessError("This workbook has already been imported.", "IMPORT_ALREADY_COMPLETED", prior.importId);
  }

  function requireOrCreateModule(state, sourceModule, token) {
    var code = normalizeCode(sourceModule.moduleCode);
    var existing = state.engineeringModules.find(function (module) { return normalizeCode(module.code) === code; });
    if (existing) return existing;
    var module = {
      id: uniqueId(state.engineeringModules, "MOD-IMPORT-" + token + "-" + idToken(code)),
      code: code,
      name: titleCase(code),
      ownerRole: "ENGINEERING",
      requiredByDefault: Boolean(sourceModule.required),
      applicableSeatTypes: []
    };
    state.engineeringModules.push(module);
    return module;
  }

  function moduleImageReference(moduleCode) {
    var references = {
      STRUCTURE: "assets/portfolio/structure.svg",
      FOAM: "assets/portfolio/foam.svg",
      PLASTIC: "assets/portfolio/plastic.svg",
      TRIM: "assets/portfolio/trim.svg",
      HEAD_REST: "assets/portfolio/headrest.svg",
      ARM_REST: "assets/portfolio/armrest.svg"
    };
    return references[normalizeCode(moduleCode)] || "";
  }

  function isPlaceholderImage(reference) {
    return /assets\/portfolio\/(?:structure|foam|plastic|trim|headrest|armrest)\.svg$/i.test(String(reference || ""));
  }

  function importedPartCategory(source) {
    if (source && source.partType === "ASSEMBLY") return "Assembly";
    return source && source.commodity || "Other";
  }

  function assertFeatureCompatibility(existing, source) {
    var allowed = existing.allowedValues || [];
    var invalid = (source.allowedValues || []).filter(function (value) { return allowed.length && allowed.indexOf(value) === -1; });
    if (existing.valueType !== source.valueType || invalid.length) {
      throw businessError("Imported Feature conflicts with the existing Feature Master.", "IMPORT_FEATURE_CONFLICT", source.featureCode);
    }
  }

  function assertPartCompatibility(existing, source, workbookFingerprint) {
    if (workbookFingerprint && existing.sourceWorkbookFingerprint === workbookFingerprint) return;
    var fields = [
      { existing: "currentRevision", source: "currentRevision", label: "Part Revision" },
      { existing: "drawingNumber", source: "drawingNumber", label: "Drawing Number" },
      { existing: "drawingRevision", source: "drawingRevision", label: "Drawing Revision" },
      { existing: "material", source: "material", label: "Material" },
      { existing: "commodity", source: "commodity", label: "Commodity" }
    ];
    var conflicts = fields.filter(function (field) {
      var before = normalizeIdentity(existing[field.existing]);
      var after = normalizeIdentity(source[field.source]);
      return before && after && before !== after;
    });
    if (!conflicts.length) return;
    var message = "Part " + source.partNumber + " conflicts with the existing Part Master: " + conflicts.map(function (field) {
      return field.label + " (existing: " + displayValue(existing[field.existing]) + ", imported: " + displayValue(source[field.source]) + ")";
    }).join("; ") + ".";
    throw businessError(message, "IMPORT_PART_ATTRIBUTE_CONFLICT", source.partNumber);
  }

  function mergePartSourceTraceability(part, source, workbookFingerprint) {
    var sheets = (part.sourceWorkbookSheets || []).concat(source.sourceWorkbookSheets || (source.sourceWorkbookSheet ? [source.sourceWorkbookSheet] : []));
    part.sourceWorkbookSheets = uniqueValues(sheets.map(function (value) { return String(value || "").trim(); }));
    var rows = (part.sourceWorkbookRows || []).concat(source.sourceWorkbookRows || []);
    var seen = {};
    part.sourceWorkbookRows = rows.filter(function (reference) {
      var key = String(reference && reference.sheet || "") + "|" + String(reference && reference.row || "");
      if (seen[key]) return false;
      seen[key] = true;
      return Boolean(reference && (reference.sheet || reference.row));
    });
    var variants = (part.sourceAttributeVariants || []).concat(source.sourceAttributeVariants || []);
    var variantKeys = {};
    part.sourceAttributeVariants = variants.filter(function (variant) {
      var key = [variant.sheet, variant.row, variant.currentRevision, variant.drawingNumber, variant.drawingRevision, variant.material, variant.commodity].join("|");
      if (variantKeys[key]) return false;
      variantKeys[key] = true;
      return true;
    });
    var anchors = (part.sourceWorkbookImageAnchors || (part.sourceWorkbookImageAnchor ? [part.sourceWorkbookImageAnchor] : []))
      .concat(source.sourceWorkbookImageAnchors || (source.sourceWorkbookImageAnchor ? [source.sourceWorkbookImageAnchor] : []));
    part.sourceWorkbookImageAnchors = uniqueValues(anchors);
    if (!part.sourceWorkbookImageAnchor && source.sourceWorkbookImageAnchor) part.sourceWorkbookImageAnchor = source.sourceWorkbookImageAnchor;
    if (!part.sourceWorkbookImageRow && source.sourceWorkbookImageRow) part.sourceWorkbookImageRow = source.sourceWorkbookImageRow;
    if (!part.sourceWorkbookImageColumn && source.sourceWorkbookImageColumn) part.sourceWorkbookImageColumn = source.sourceWorkbookImageColumn;
    if (!part.sourceImageMediaPath && source.sourceImageMediaPath) part.sourceImageMediaPath = source.sourceImageMediaPath;
    if (!part.sourceImageMimeType && source.sourceImageMimeType) part.sourceImageMimeType = source.sourceImageMimeType;
    part.sourceImagePresent = Boolean(part.sourceImagePresent || source.sourceImagePresent);
    if (!part.sourceWorkbookFingerprint) part.sourceWorkbookFingerprint = workbookFingerprint || source.sourceWorkbookFingerprint || "";
  }

  function assertUniqueProgram(program, programs) {
    if (programs.some(function (item) { return normalizeCode(item.programCode) === normalizeCode(program.programCode); })) {
      throw businessError("Imported Programme Code already exists.", "IMPORT_PROGRAM_DUPLICATE", program.programCode);
    }
  }

  function assertUniqueVariant(variant, variants) {
    if (variants.some(function (item) { return item.programId === variant.programId && normalizeCode(item.variantCode) === normalizeCode(variant.variantCode); })) {
      throw businessError("Imported Finished-Good Variant Code already exists in the imported Programme.", "IMPORT_VARIANT_DUPLICATE", variant.variantCode);
    }
  }

  function ensureHistory(state) {
    state.metadata = state.metadata || {};
    state.metadata.importHistory = Array.isArray(state.metadata.importHistory) ? state.metadata.importHistory : [];
    return state.metadata.importHistory;
  }

  function upsertHistory(history, record) {
    var index = history.findIndex(function (item) { return item.importId === record.importId; });
    if (index === -1) history.unshift(clone(record));
    else history[index] = Object.assign({}, history[index], clone(record));
    if (history.length > 20) history.splice(20);
  }

  function findHistory(history, importId) {
    return history.find(function (item) { return item.importId === importId; }) || null;
  }

  function uniqueId(collection, preferred) {
    var id = preferred;
    var suffix = 2;
    while ((collection || []).some(function (item) { return item.id === id; })) {
      id = preferred + "-" + suffix;
      suffix += 1;
    }
    return id;
  }

  function normalizeCode(value) {
    return String(value == null ? "" : value).trim().toUpperCase().replace(/[\s-]+/g, "_");
  }

  function normalizePartNumber(value) {
    return String(value == null ? "" : value).trim().toUpperCase().replace(/\s+/g, "");
  }

  function normalizeWorkbookName(value) {
    return String(value || "").trim().toUpperCase().replace(/\s*\(\d+\)(?=\.XLSX$)/, "").replace(/\s+/g, " ");
  }

  function normalizeIdentity(value) {
    return String(value == null ? "" : value).trim().toUpperCase().replace(/\s+/g, " ");
  }

  function displayValue(value) {
    var result = String(value == null ? "" : value).trim();
    return result || "(blank)";
  }

  function uniqueValues(values) {
    var seen = {};
    return (values || []).filter(function (value) {
      var key = String(value);
      if (!key || seen[key]) return false;
      seen[key] = true;
      return true;
    });
  }

  function indexById(items) {
    return (items || []).reduce(function (result, item) {
      if (item && item.id) result[item.id] = item;
      return result;
    }, {});
  }

  function stableHash(value) {
    var hash = 2166136261;
    var source = String(value || "");
    for (var index = 0; index < source.length; index += 1) {
      hash ^= source.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(16).toUpperCase().padStart(8, "0");
  }

  function idToken(value) {
    return normalizeCode(value).replace(/[^A-Z0-9_]+/g, "_").replace(/^_|_$/g, "").replace(/_/g, "-").slice(0, 42) || "UNSPECIFIED-" + stableHash(value);
  }

  function titleCase(value) {
    return String(value || "").split("_").map(function (word) { return word.charAt(0) + word.slice(1).toLowerCase(); }).join(" ");
  }

  function businessError(message, code, objectId) {
    return new app.core.errors.BusinessOperationError(message, [{ code: code, message: message, objectType: "BOM_IMPORT", objectId: objectId || null }]);
  }

  function businessMessage(error) {
    if (error && error.validationErrors && error.validationErrors[0] && error.validationErrors[0].message) return error.validationErrors[0].message;
    return error && error.message || "Import failed.";
  }

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  app.domain.bomImportService = {
    getImportHistory: getImportHistory,
    findCompletedImportByFingerprint: findCompletedImportByFingerprint,
    findExistingImportForModel: findExistingImportForModel,
    recordWorkbookValidation: recordWorkbookValidation,
    importWorkbook: importWorkbook,
    importWorkbookWithImages: importWorkbookWithImages,
    needsPartImageRepair: needsPartImageRepair,
    repairImportedPartImagesWithAssets: repairImportedPartImagesWithAssets,
    openImportedProgramme: openImportedProgramme,
    normalizeExistingImportDuplicates: normalizeExistingImportDuplicates,
    _commitImport: commitImport
  };
})(typeof window !== "undefined" ? (window.DEP = window.DEP || {}) : (globalThis.DEP = globalThis.DEP || {}));
