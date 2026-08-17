(function (app) {
  app.importing = app.importing || {};

  var MODULE_SHEETS = [
    { code: "STRUCTURE", aliases: ["STRUCTURE"], required: true },
    { code: "FOAM", aliases: ["FOAM"], required: true },
    { code: "PLASTIC", aliases: ["PLASTIC"], required: true },
    { code: "TRIM", aliases: ["TRIM"], required: true },
    { code: "HEAD_REST", aliases: ["HR", "HEADREST", "HEAD REST"], required: true },
    { code: "ARM_REST", aliases: ["ARMREST", "ARM REST"], required: false }
  ];

  var FEATURE_CODE_ALIASES = {
    TRIM: "TRIM",
    TRIM_MATERIAL: "TRIM",
    HR: "COMFORT_HR",
    COMFORT_HR: "COMFORT_HR",
    HEADREST: "COMFORT_HR",
    HEAD_REST: "COMFORT_HR",
    ARMREST: "ARMREST",
    ARM_REST: "ARMREST",
    ISO_FIX: "ISOFIX",
    ISOFIX: "ISOFIX",
    TOP_TETHER: "TOP_TETHER",
    THREE_P_ELR: "3P_ELR",
    "3P_ELR": "3P_ELR",
    ELECTRICAL_ONE_TOUCH_FOLD: "ELECTRICAL_ONE_TOUCH_FOLD"
  };

  function detectWorkbook(workbook) {
    var names = (workbook.sheets || []).map(function (sheet) { return canonical(sheet.name); });
    var has = function (name) { return names.indexOf(canonical(name)) !== -1; };
    if (names.some(function (name) { return name.indexOf("SUMMARY") === 0; }) &&
        workbook.sheets.some(hasCostHeader)) {
      return supported("BOM_COST", "BOM Cost workbook", null);
    }
    if (!(has("FEATURE MATRIX") && has("COMPLETE SEAT JIT") && has("STRUCTURE"))) {
      return unsupported();
    }
    var context = detectEngineeringContext(workbook);
    if (context.seatType) {
      return supported(
        "ENGINEERING_" + context.seatType.replace(/[^A-Z0-9]+/g, "_"),
        context.seatType + " Engineering BOM",
        context.seatType,
        context
      );
    }
    return unsupported();
  }

  function mapWorkbook(workbook, fileMetadata) {
    var detection = detectWorkbook(workbook);
    var diagnostics = [];
    var workbookFingerprint = calculateWorkbookFingerprint(workbook, detection);
    var importId = (fileMetadata && fileMetadata.importId) || "IMP-" + workbookFingerprint.replace(/^WB-/, "");
    var model = {
      importId: importId,
      workbookFingerprint: workbookFingerprint,
      workbookName: fileMetadata && fileMetadata.name || "Selected workbook",
      workbookType: detection.type,
      workbookLabel: detection.label,
      seatType: detection.seatType,
      supported: detection.supported,
      previewOnly: detection.type === "BOM_COST",
      sheets: (workbook.sheets || []).map(sheetSummary),
      program: null,
      variants: [],
      features: [],
      featureConfigurations: [],
      modules: [],
      commodities: [],
      imageAssets: [],
      diagnostics: diagnostics,
      skippedRows: []
    };

    if (!detection.supported) {
      error(diagnostics, "Workbook", null, null, "", "Unsupported workbook format.", "Use a supported source Engineering BOM or BOM Cost workbook with the required business sheets and headers.");
      return finish(model);
    }
    if (model.previewOnly) {
      mapCostPreview(workbook, model);
      warning(diagnostics, "Workbook", null, null, "", "Commercial rows are preview-only in this milestone.", "Import an Engineering BOM workbook to create AppState engineering data.");
      return finish(model);
    }

    var featureSheet = findSheet(workbook, ["FEATURE MATRIX"]);
    if (!featureSheet) {
      error(diagnostics, "Feature Matrix", null, null, "", "Feature Matrix sheet is required.", "Add the known source Feature Matrix sheet.");
      return finish(model);
    }
    var featureMapping = parseFeatureMatrix(featureSheet, detection.seatType, diagnostics, detection.context);
    model.variants = featureMapping.variants;
    model.features = featureMapping.features;
    model.featureConfigurations = featureMapping.configurations;
    applyFinishedGoodReferences(findSheet(workbook, ["COMPLETE SEAT JIT"]), model.variants, workbookFingerprint);
    var sourceProgramCode = detection.context && detection.context.programCode || "IMPORTED";
    model.program = {
      sourceCode: sourceProgramCode,
      programCode: sourceProgramCode + "-IMP-" + compactToken(importId),
      name: sourceProgramCode + " " + detection.seatType + " Imported BOM",
      customer: unique(model.variants.map(function (variant) { return variant.customer; }).filter(Boolean)).join(" / "),
      vehiclePlatform: sourceProgramCode,
      status: "ACTIVE"
    };

    MODULE_SHEETS.forEach(function (definition) {
      var sheet = findSheet(workbook, definition.aliases);
      var required = definition.required || (definition.code === "ARM_REST" && detection.seatType === "60P");
      if (!sheet) {
        if (required) error(diagnostics, definition.code, null, null, "", "Required engineering sheet is missing.", "Restore the " + displayModule(definition.code) + " sheet.");
        return;
      }
      var module = parseEngineeringSheet(sheet, definition.code, model.variants, workbookFingerprint, diagnostics, model.skippedRows);
      module.required = required;
      model.modules.push(module);
    });

    validateSourcePartDuplicates(model, diagnostics);
    resolveSharedPartOwnership(model, workbookFingerprint, diagnostics);
    validatePartDuplicates(model, diagnostics);
    collectCommodities(model);
    model.imageAssets = collectPartImageAssets(workbook, model);
    var unsupportedPartImages = model.modules.reduce(function (count, module) {
      return count + module.parts.filter(function (part) { return part.sourceImagePresent && !part.imageReference; }).length;
    }, 0);
    if (unsupportedPartImages) {
      warning(diagnostics, "Workbook", null, "Part Images", unsupportedPartImages,
        unsupportedPartImages + " Part image(s) use a format that cannot be displayed in the browser.",
        "The engineering data will import normally; replace EMF images with PNG or JPEG when a browser preview is required.");
    }
    return finish(model);
  }

  function parseFeatureMatrix(sheet, seatType, diagnostics, workbookContext) {
    var variantRow = findVariantHeaderRow(sheet);
    if (!variantRow) {
      error(diagnostics, sheet.name, null, "Variants", "", "Finished-Good Variant columns were not found.", "Restore the Feature Matrix variant header.");
      return { variants: [], features: [], configurations: [] };
    }
    var featureColumn = findFeatureColumn(sheet, variantRow);
    var customerMarkers = collectCustomerMarkers(sheet, variantRow);
    var variants = [];
    for (var column = featureColumn + 1; column <= sheet.maxColumn; column += 1) {
      var header = text(cell(sheet, variantRow, column));
      if (!looksLikeVariant(header)) continue;
      var customer = customerFromVariantHeader(header, seatType) || customerForColumn(customerMarkers, column) || (workbookContext && workbookContext.customer) || "Unspecified";
      var sideMatch = /\b(RH|LH)\b/i.exec(header);
      var gradeMatch = /\b(E\d+)\b/i.exec(header);
      var grade = gradeMatch ? gradeMatch[1].toUpperCase() : "";
      if (grade && new RegExp(grade + "\\s*(?:\\+|\\(\\s*\\+?\\s*\\)|\\(O\\))", "i").test(header)) grade += "+";
      var side = sideMatch ? sideMatch[1].toUpperCase() : "";
      var sourceKey = [seatType, customerKey(customer), side, grade].filter(Boolean).join("-");
      variants.push({
        sourceKey: sourceKey,
        sourceColumn: column,
        variantCode: sourceKey,
        variantName: customer + " " + seatType + (side ? " " + side : "") + " " + grade,
        customer: customer,
        brand: customer,
        seatType: seatType,
        seatFamily: seatType,
        side: side,
        grade: grade,
        status: "ACTIVE"
      });
    }
    if (!variants.length) {
      error(diagnostics, sheet.name, variantRow, "Variants", "", "No valid Finished-Good Variant was detected.", "Use the source variant heading convention, including a grade such as E2 and an optional side such as RH or LH.");
    }

    var featureStart = variantRow + 1;
    while (featureStart <= sheet.maxRow && /FEATURE\s*LIST/i.test(text(cell(sheet, featureStart, featureColumn)))) featureStart += 1;
    var features = [];
    for (var row = featureStart; row <= sheet.maxRow; row += 1) {
      var name = text(cell(sheet, row, featureColumn));
      if (!name) continue;
      if (/^(TOTAL|NOTE|REMARK)/i.test(name)) continue;
      var values = variants.map(function (variant) { return normalizeFeatureValue(cell(sheet, row, variant.sourceColumn)); });
      if (!values.some(function (value) { return value !== ""; })) continue;
      var valueType = inferValueType(values);
      var allowedValues = valueType === "BOOLEAN" ? ["YES", "NO"] : unique(values.filter(function (value) { return value !== ""; }));
      var featureCode = featureCodeFromName(name);
      features.push({
        sourceRow: row,
        featureCode: featureCode,
        name: name.trim(),
        description: "Imported from " + sheet.name,
        category: featureCode === "TRIM" ? "Trim" : "Seat Configuration",
        valueType: valueType,
        allowedValues: allowedValues,
        status: "ACTIVE",
        valuesByVariant: variants.reduce(function (result, variant, index) {
          result[variant.sourceKey] = values[index];
          return result;
        }, {})
      });
    }
    if (!features.length) error(diagnostics, sheet.name, null, "Feature List", "", "No Feature rows were detected.", "Restore Feature names and configured values.");
    var configurations = variants.map(function (variant) {
      return {
        variantSourceKey: variant.sourceKey,
        name: variant.variantName,
        status: "ACTIVE",
        trimMaterial: valueForFeature(features, "TRIM", variant.sourceKey),
        selections: features.map(function (feature) {
          return { featureCode: feature.featureCode, selectedValue: feature.valuesByVariant[variant.sourceKey] };
        }).filter(function (selection) { return selection.selectedValue !== ""; })
      };
    });
    return { variants: variants, features: features, configurations: configurations };
  }

  function parseEngineeringSheet(sheet, moduleCode, variants, workbookFingerprint, diagnostics, skippedRows) {
    var header = findEngineeringHeader(sheet);
    var module = {
      moduleCode: moduleCode,
      sheetName: sheet.name,
      headerRow: header && header.row,
      parts: [],
      sourceRows: [],
      boms: [],
      imageCount: sheet.imageCount || 0
    };
    if (!header) {
      error(diagnostics, sheet.name, null, "Part Number", "", "Engineering header was not found.", "Restore Part Number and Part Description columns.");
      return module;
    }
    ["partNumber", "partDescription", "quantity"].forEach(function (field) {
      if (!header.columns[field]) error(diagnostics, sheet.name, header.row, field, "", "Required engineering column is missing.", "Restore the known source eBOM header.");
    });
    var applicabilityColumns = findApplicabilityColumns(sheet, header, variants.length);
    var sourceStack = {};
    var topGroup = null;
    var currentGroup = null;
    var pendingGroup = null;
    var sequence = 0;
    for (var row = header.row + 1; row <= sheet.maxRow; row += 1) {
      var rawPartNumber = cell(sheet, row, header.columns.partNumber);
      var partNumber = sourceText(rawPartNumber);
      var description = text(cell(sheet, row, header.columns.partDescription));
      var sourceLevel = findHierarchyLevel(sheet, row, header);
      var syntheticPart = false;
      var groupLabel = !partNumber && !sourceLevel ? findGroupLabel(sheet, row, header) : "";
      var ignoredReason = ignoredEngineeringRowReason(sheet, row, header, partNumber, description, groupLabel);
      if (ignoredReason) {
        skippedRows.push({ sheet: sheet.name, row: row, partNumber: partNumber, reason: ignoredReason });
        continue;
      }
      if (!partNumber && groupLabel) {
        sequence += 1;
        pendingGroup = {
          sourceId: moduleCode + "-ROW-" + row,
          sourceRow: row,
          sourcePartNumber: "IMP-" + compactToken(workbookFingerprint) + "-" + moduleCode.replace(/_/g, "-") + "-GROUP-" + sequence,
          description: groupLabel,
          level: null,
          parentSourceId: null,
          synthetic: true,
          partType: "ASSEMBLY",
          quantity: 1,
          unitOfMeasure: "EA",
          changeClassification: "UNCHANGED",
          variantInclusion: allVariants(variants)
        };
        continue;
      }
      if (!partNumber && description && sourceLevel) {
        sequence += 1;
        partNumber = "IMP-" + compactToken(workbookFingerprint) + "-" + moduleCode.replace(/_/g, "-") + "-ROW-" + row;
        syntheticPart = true;
        warning(diagnostics, sheet.name, row, "Part Number", "", "A hierarchy row without a Part Number was retained as a system assembly reference.", "Assign a source Part Number later if this row represents a controlled Part Master.");
      } else if (!partNumber) {
        var sourceIdentity = [
          sourceText(cell(sheet, row, header.columns.drawingNumber)),
          text(cell(sheet, row, header.columns.commodity)).replace(/^-$/, ""),
          text(cell(sheet, row, header.columns.material)).replace(/^-$/, "")
        ].join("").trim();
        if (description && !sourceIdentity) {
          skippedRows.push({ sheet: sheet.name, row: row, partNumber: "", reason: "Presentation-only row without Part Number" });
          warning(diagnostics, sheet.name, row, "Part Number", "", "Presentation-only row was skipped because it has no Part Number.", "Add a Part Number only if this row represents a controlled Part.");
        } else {
          error(diagnostics, sheet.name, row, "Part Number", "", "Part Number is required for an engineering row.", "Enter the source Part Number or convert the row to a named assembly group.");
        }
        continue;
      }
      if (!description) {
        error(diagnostics, sheet.name, row, "Part Description", partNumber, "Part Description is required.", "Enter the engineering Part Description.");
        continue;
      }
      if (!sourceLevel) sourceLevel = 1;
      if (pendingGroup) {
        var groupParent = !topGroup ? null : (sourceLevel > 1 ? sourceStack[sourceLevel - 1] : topGroup);
        if (topGroup && !groupParent) groupParent = topGroup;
        pendingGroup.parentSourceId = groupParent ? groupParent.sourceId : "ROOT";
        pendingGroup.level = groupParent ? groupParent.level + 1 : 1;
        pendingGroup.groupStartLevel = sourceLevel;
        module.sourceRows.push(pendingGroup);
        if (!topGroup) topGroup = pendingGroup;
        currentGroup = pendingGroup;
        pendingGroup = null;
      }
      if (currentGroup && sourceLevel < currentGroup.groupStartLevel) currentGroup = null;
      var parent = null;
      if (currentGroup && sourceLevel === currentGroup.groupStartLevel) parent = currentGroup;
      else if (sourceLevel > 1) parent = sourceStack[sourceLevel - 1];
      else if (topGroup) parent = topGroup;
      if (!parent && sourceLevel > 1) {
        var nearestLevel = Object.keys(sourceStack).map(Number).filter(function (candidate) { return candidate < sourceLevel; }).sort(function (a, b) { return b - a; })[0];
        if (nearestLevel) {
          parent = sourceStack[nearestLevel];
          warning(diagnostics, sheet.name, row, "Hierarchy", sourceLevel, "Skipped ASM level was attached to the nearest preceding assembly.", "Review the source level sequence if a different parent is intended.");
        }
      }
      var level = parent ? parent.level + 1 : 1;
      if (sourceLevel > 1 && !parent) {
        error(diagnostics, sheet.name, row, "Hierarchy", sourceLevel, "Hierarchy parent is missing.", "Add the preceding parent assembly or correct the ASM level.");
        continue;
      }
      Object.keys(sourceStack).forEach(function (key) { if (Number(key) >= sourceLevel) delete sourceStack[key]; });
      var classificationSource = [
        cell(sheet, row, header.columns.changeClassification),
        cell(sheet, row, header.columns.remark),
        cell(sheet, row, header.columns.threeDSharedDate),
        cell(sheet, row, header.columns.twoDSharedDate)
      ].join(" ");
      var classification = normalizeChangeClassification(classificationSource);
      var quantity = toNumber(cell(sheet, row, header.columns.quantity));
      var inclusion = variantInclusion(sheet, row, variants, applicabilityColumns);
      var imageAnchor = imageAnchorAtRow(sheet, row, header.columns.image);
      var sourceRow = {
        sourceId: moduleCode + "-ROW-" + row,
        sourceSheet: sheet.name,
        sourceRow: row,
        sourcePartNumber: partNumber,
        description: description,
        level: level,
        parentSourceId: parent ? parent.sourceId : "ROOT",
        synthetic: syntheticPart,
        partType: /\bASSY\b|ASSEMBLY|SUB[- ]?ASSY/i.test(description + " " + text(cell(sheet, row, header.columns.commodity))) ? "ASSEMBLY" : "PART",
        oemJit: text(cell(sheet, row, header.columns.oemJit)),
        internalJit: text(cell(sheet, row, header.columns.internalJit)),
        currentRevision: text(cell(sheet, row, header.columns.partRevision)) || "A.01",
        drawingNumber: sourceText(cell(sheet, row, header.columns.drawingNumber)),
        drawingRevision: sourceText(cell(sheet, row, header.columns.drawingRevision)),
        commodity: text(cell(sheet, row, header.columns.commodity)),
        material: text(cell(sheet, row, header.columns.material)),
        gauge: text(cell(sheet, row, header.columns.gauge)),
        quantity: quantity,
        unitOfMeasure: "EA",
        cadWeight: toNumberOrNull(cell(sheet, row, header.columns.cadWeight)),
        totalCadWeight: toNumberOrNull(cell(sheet, row, header.columns.totalCadWeight)),
        changeClassification: classification,
        remark: text(cell(sheet, row, header.columns.remark)),
        threeDSharedDate: text(cell(sheet, row, header.columns.threeDSharedDate)),
        twoDSharedDate: text(cell(sheet, row, header.columns.twoDSharedDate)),
        area: text(cell(sheet, row, header.columns.area)),
        surfaceFinish: text(cell(sheet, row, header.columns.surfaceFinish)),
        sourceImagePresent: Boolean(imageAnchor),
        sourceWorkbookImageAnchor: imageAnchor ? sheet.name + "!" + (imageAnchor.mediaPath || ("row-" + row)) : "",
        sourceWorkbookImageRow: imageAnchor ? imageAnchor.row : null,
        sourceWorkbookImageColumn: imageAnchor ? imageAnchor.column : null,
        sourceImageMediaPath: imageAnchor && imageAnchor.mediaPath || "",
        sourceImageMimeType: imageAnchor && imageAnchor.mimeType || "",
        imageReference: imageAnchor && imageAnchor.supported && imageAnchor.mediaPath
          ? partImageReference(workbookFingerprint, imageAnchor.mediaPath)
          : "",
        variantInclusion: inclusion
      };
      var appliesToAnyVariant = Object.keys(inclusion).some(function (key) { return inclusion[key]; });
      if ((quantity === null || quantity <= 0) && (classification === "DELETED" || !appliesToAnyVariant || quantity === null || (quantity === 0 && sourceRow.totalCadWeight === 0))) {
        skippedRows.push({ sheet: sheet.name, row: row, partNumber: partNumber, reason: "Non-positive or blank non-active usage" });
        warning(diagnostics, sheet.name, row, "Unit Quantity", quantity, "Non-active usage was not added to the eBOM; the Part master is preserved.", "Enter a positive quantity only if this usage is applicable.");
        sourceRow.skipBomUsage = true;
      } else if (quantity === null || quantity <= 0) {
        error(diagnostics, sheet.name, row, "Unit Quantity", quantity, "Unit Quantity must be greater than zero.", "Enter a positive numeric quantity.");
      }
      if (sourceRow.cadWeight !== null && sourceRow.cadWeight < 0) {
        error(diagnostics, sheet.name, row, "CAD Weight", sourceRow.cadWeight, "CAD Weight cannot be negative.", "Correct the source CAD Weight.");
      }
      module.sourceRows.push(sourceRow);
      sourceStack[sourceLevel] = sourceRow;
    }
    markParentAssemblies(module.sourceRows);
    module.parts = buildModuleParts(module, workbookFingerprint);
    module.boms = buildVariantBoms(module, variants, workbookFingerprint, diagnostics);
    return module;
  }

  function buildModuleParts(module, workbookFingerprint) {
    var grouped = {};
    var assemblyNumbers = {};
    module.sourceRows.forEach(function (row) {
      if (row.partType === "ASSEMBLY") assemblyNumbers[canonicalPartNumber(row.sourcePartNumber)] = true;
    });
    var root = {
      sourceId: "ROOT",
      sourcePartNumber: "IMP-" + compactToken(workbookFingerprint) + "-" + module.moduleCode.replace(/_/g, "-") + "-ROOT",
      description: displayModule(module.moduleCode) + " Imported Assembly",
      partType: "ASSEMBLY",
      synthetic: true,
      quantity: 1,
      unitOfMeasure: "EA"
    };
    [root].concat(module.sourceRows).forEach(function (row) {
      var key = canonicalPartNumber(row.sourcePartNumber);
      grouped[key] = grouped[key] || [];
      grouped[key].push(row);
    });
    return Object.keys(grouped).map(function (key) {
      var rows = grouped[key];
      var row = rows.find(function (candidate) { return !candidate.skipBomUsage; }) || rows[0];
      var imageRow = rows.find(function (candidate) { return !candidate.skipBomUsage && candidate.imageReference; }) ||
        rows.find(function (candidate) { return candidate.imageReference; }) || row;
      var references = rows.filter(function (candidate) { return candidate.sourceRow; }).map(function (candidate) {
        return { sheet: module.sheetName, row: candidate.sourceRow };
      });
      return {
        sourceId: row.sourceId,
        sourcePartNumber: row.sourcePartNumber,
        partNumber: row.sourcePartNumber,
        name: row.description,
        description: row.description,
        partType: assemblyNumbers[canonicalPartNumber(row.sourcePartNumber)] ? "ASSEMBLY" : (row.partType || "PART"),
        currentRevision: row.currentRevision || "A.01",
        drawingNumber: row.drawingNumber || "",
        drawingRevision: row.drawingRevision || "",
        commodity: row.commodity || "Other",
        sourceCommodityOriginal: row.commodity || "",
        sourceWorkbookSheet: module.sheetName,
        sourceWorkbookRow: row.sourceRow || "",
        sourceWorkbookFingerprint: workbookFingerprint,
        sourceWorkbookSheets: [module.sheetName],
        sourceWorkbookRows: references,
        sourceAttributeVariants: rows.filter(function (candidate) { return candidate.sourceRow; }).map(function (candidate) {
          return {
            sheet: module.sheetName,
            row: candidate.sourceRow,
            currentRevision: candidate.currentRevision || "",
            drawingNumber: candidate.drawingNumber || "",
            drawingRevision: candidate.drawingRevision || "",
            material: candidate.material || "",
            commodity: candidate.commodity || "",
            activeBomUsage: !candidate.skipBomUsage
          };
        }),
        material: row.material || "",
        gauge: row.gauge || "",
        cadWeight: row.cadWeight,
        threeDSharedDate: row.threeDSharedDate || "",
        twoDSharedDate: row.twoDSharedDate || "",
        lifecycleState: "DRAFT",
        unitOfMeasure: "EA",
        sourceImagePresent: Boolean(imageRow.sourceImagePresent),
        sourceWorkbookImageAnchor: imageRow.sourceWorkbookImageAnchor || "",
        sourceWorkbookImageAnchors: unique(rows.map(function (candidate) { return candidate.sourceWorkbookImageAnchor; }).filter(Boolean)),
        sourceWorkbookImageRow: imageRow.sourceWorkbookImageRow || null,
        sourceWorkbookImageColumn: imageRow.sourceWorkbookImageColumn || null,
        sourceImageMediaPath: imageRow.sourceImageMediaPath || "",
        sourceImageMimeType: imageRow.sourceImageMimeType || "",
        imageReference: imageRow.imageReference || "",
        sourceTechnicalAttributes: { area: row.area || "", surfaceFinish: row.surfaceFinish || "" },
        synthetic: Boolean(row.synthetic)
      };
    });
  }

  function buildVariantBoms(module, variants, workbookFingerprint, diagnostics) {
    var rowsById = module.sourceRows.reduce(function (result, row) { result[row.sourceId] = row; return result; }, {});
    return variants.map(function (variant) {
      var included = {};
      module.sourceRows.forEach(function (row) {
        included[row.sourceId] = row.variantInclusion[variant.sourceKey] !== false;
      });
      var items = [];
      module.sourceRows.forEach(function (row, index) {
        if (!included[row.sourceId] || row.skipBomUsage) return;
        var parentId = row.parentSourceId || "ROOT";
        while (parentId !== "ROOT" && !included[parentId]) {
          var parent = rowsById[parentId];
          parentId = parent ? parent.parentSourceId : "ROOT";
        }
        var hierarchyPath = sourceHierarchyPath(row, rowsById);
        var occurrenceKey = makeOccurrenceKey({
          workbookFingerprint: workbookFingerprint,
          sourceSheet: module.sheetName,
          variantSourceKey: variant.sourceKey,
          moduleCode: module.moduleCode,
          hierarchyPath: hierarchyPath,
          parentSourceId: parentId,
          partNumber: row.sourcePartNumber,
          sourceRow: row.sourceRow || ""
        });
        items.push({
          sourceId: row.sourceId,
          parentSourceId: parentId,
          childSourcePartNumber: row.sourcePartNumber,
          parentSourcePartNumber: parentId === "ROOT" ? module.parts[0].partNumber : sourcePartNumber(module.sourceRows, parentId),
          oemJit: row.oemJit || "",
          internalJit: row.internalJit || "",
          quantity: row.quantity || 1,
          unitOfMeasure: row.unitOfMeasure || "EA",
          sequence: (index + 1) * 10,
          totalCadWeight: row.totalCadWeight,
          changeClassification: row.changeClassification || "UNCHANGED",
          remark: row.remark || "",
          sourceWorkbookSheet: module.sheetName,
          sourceWorkbookRow: row.sourceRow || "",
          sourceWorkbookFingerprint: workbookFingerprint,
          sourceOccurrenceKey: occurrenceKey,
          hierarchyPath: hierarchyPath,
          applicability: null
        });
      });
      items = combineDuplicateUsages(items, module.sheetName, variant.sourceKey, diagnostics);
      validateMappedHierarchy(module.sheetName, variant.sourceKey, items, module.parts[0].partNumber, diagnostics);
      return {
        variantSourceKey: variant.sourceKey,
        rootSourcePartNumber: module.parts[0].partNumber,
        completionStatus: "IN_PROGRESS",
        lifecycleState: "DRAFT",
        items: items
      };
    });
  }

  function combineDuplicateUsages(items, sheetName, variantKey, diagnostics) {
    var combined = {};
    var result = [];
    items.forEach(function (item) {
      var key = canonicalPartNumber(item.parentSourcePartNumber) + ">" + canonicalPartNumber(item.childSourcePartNumber);
      if (!combined[key]) {
        item.duplicateSourceRows = [];
        combined[key] = item;
        result.push(item);
        return;
      }
      combined[key].quantity += item.quantity;
      if (combined[key].totalCadWeight !== null && item.totalCadWeight !== null) combined[key].totalCadWeight += item.totalCadWeight;
      combined[key].remark = unique([combined[key].remark, item.remark].filter(Boolean)).join("; ");
      combined[key].duplicateSourceRows.push(item.sourceWorkbookRow);
      warning(diagnostics, sheetName, null, "Hierarchy", key, "Repeated usage was combined deterministically for " + variantKey + ".", "Review the summed quantity in the import preview.");
    });
    return result;
  }

  function resolveSharedPartOwnership(model, workbookFingerprint, diagnostics) {
    var modulesByPartNumber = {};
    model.modules.forEach(function (module) {
      module.parts.forEach(function (part) {
        if (part.synthetic) return;
        var key = canonicalPartNumber(part.partNumber);
        modulesByPartNumber[key] = modulesByPartNumber[key] || [];
        if (modulesByPartNumber[key].indexOf(module.moduleCode) === -1) modulesByPartNumber[key].push(module.moduleCode);
      });
    });
    model.modules.forEach(function (module) {
      module.parts.forEach(function (part) {
        var moduleCodes = modulesByPartNumber[canonicalPartNumber(part.partNumber)] || [module.moduleCode];
        part.allowedBomModuleCodes = moduleCodes.slice();
        if (moduleCodes.length > 1 && moduleCodes[0] !== module.moduleCode) {
          warning(diagnostics, module.sheetName, part.sourceWorkbookRow, "Part Number", part.partNumber, "Existing Part Master is reused in the " + displayModule(module.moduleCode) + " eBOM.", "Technical ownership remains with " + displayModule(moduleCodes[0]) + "; this source occurrence keeps its discipline traceability.");
        }
      });
    });
  }

  function findEngineeringHeader(sheet) {
    for (var row = 1; row <= Math.min(sheet.maxRow, 20); row += 1) {
      var labels = {};
      for (var column = 1; column <= Math.min(sheet.maxColumn, 80); column += 1) {
        labels[column] = canonical(cell(sheet, row, column));
      }
      var partNumberColumn = findColumn(labels, ["PART NUMBER"]);
      var descriptionColumn = findColumn(labels, ["PART DESCRIPTION"]);
      if (!partNumberColumn || !descriptionColumn) continue;
      return {
        row: row,
        labels: labels,
        levelColumns: Object.keys(labels).map(Number).filter(function (column) { return /^[1-9]$/.test(labels[column]); }),
        columns: {
          oemJit: findColumn(labels, ["OEM JIT", "INTERNAL JIT"]),
          internalJit: findColumn(labels, ["INTERNAL JIT"]),
          partNumber: partNumberColumn,
          partRevision: findColumn(labels, ["PART REV", "PART REVISION"]),
          drawingNumber: findColumn(labels, ["DRAWING NUMBER", "DRAWING NO"]),
          drawingRevision: findColumn(labels, ["DWG REV", "DRAWING REVISION"]),
          partDescription: descriptionColumn,
          image: findColumn(labels, ["IMAGE", "IMAGES", "PART IMAGE", "PICTURE", "PREVIEW"]),
          commodity: findColumn(labels, ["COMMODITY"]),
          material: findColumn(labels, ["MATERIAL"]),
          gauge: findColumn(labels, ["GAUGE", "GAUGE MM"]),
          area: findColumn(labels, ["AREA MM2", "AREA"]),
          surfaceFinish: findColumn(labels, ["SURFACE FINISH"]),
          quantity: findColumn(labels, ["UNIT QUANTITY", "UNIT QTY"]),
          cadWeight: findColumn(labels, ["CAD WEIGHT"]),
          totalCadWeight: findColumn(labels, ["TOTAL CAD WEIGHT"]),
          changeClassification: findColumn(labels, ["NEW C O DELETED", "NEW C O DELETED.", "NEW C/O/DELETED"]),
          remark: findColumnContains(labels, "REMARK"),
          threeDSharedDate: findColumnContains(labels, "3D"),
          twoDSharedDate: findColumnContains(labels, "2D")
        }
      };
    }
    return null;
  }

  function findApplicabilityColumns(sheet, header, variantCount) {
    var start = (header.columns.changeClassification || header.columns.totalCadWeight || header.columns.quantity) + 1;
    var end = (header.columns.remark || sheet.maxColumn + 1) - 1;
    var candidates = [];
    for (var column = start; column <= end; column += 1) {
      var count = 0;
      for (var row = header.row + 1; row <= sheet.maxRow; row += 1) {
        var value = cell(sheet, row, column);
        if (value === 1 || value === "1" || value === true) count += 1;
      }
      if (count) candidates.push(column);
    }
    return candidates.length >= variantCount ? candidates.slice(0, variantCount) : [];
  }

  function variantInclusion(sheet, row, variants, columns) {
    if (!columns.length) return allVariants(variants);
    var hasMarker = columns.some(function (column) { return cell(sheet, row, column) !== ""; });
    return variants.reduce(function (result, variant, index) {
      result[variant.sourceKey] = !hasMarker || isTruthyMarker(cell(sheet, row, columns[index]));
      return result;
    }, {});
  }

  function validateMappedHierarchy(sheetName, variantKey, items, rootPartNumber, diagnostics) {
    var knownChildren = {};
    knownChildren[canonicalPartNumber(rootPartNumber)] = true;
    items.forEach(function (item) { knownChildren[canonicalPartNumber(item.childSourcePartNumber)] = true; });
    var paths = {};
    items.forEach(function (item) {
      if (!knownChildren[canonicalPartNumber(item.parentSourcePartNumber)]) {
        error(diagnostics, sheetName, null, "Hierarchy", item.childSourcePartNumber, "BOM item has an unknown parent in " + variantKey + ".", "Correct the source hierarchy.");
      }
      var path = canonicalPartNumber(item.parentSourcePartNumber) + ">" + canonicalPartNumber(item.childSourcePartNumber);
      if (paths[path]) error(diagnostics, sheetName, null, "Hierarchy", path, "Duplicate BOM usage exists under the same parent.", "Remove the duplicate source row.");
      paths[path] = true;
      if (canonicalPartNumber(item.parentSourcePartNumber) === canonicalPartNumber(item.childSourcePartNumber)) {
        error(diagnostics, sheetName, null, "Hierarchy", path, "A Part cannot be its own parent.", "Correct the source hierarchy.");
      }
    });
  }

  function validatePartDuplicates(model, diagnostics) {
    var seen = {};
    model.modules.forEach(function (module) {
      module.parts.forEach(function (part) {
        if (part.synthetic) return;
        var key = canonicalPartNumber(part.partNumber);
        var previous = seen[key];
        if (!previous) {
          seen[key] = { moduleCode: module.moduleCode, part: part, sheet: module.sheetName };
          return;
        }
        if (previous.moduleCode !== module.moduleCode) {
          warning(diagnostics, module.sheetName, part.sourceWorkbookRow, "Part Number", part.partNumber, "Part Number is reused by more than one engineering discipline.", "One Part Master will be referenced by each valid source eBOM occurrence.");
          return;
        }
        if (canonical(previous.part.description) !== canonical(part.description)) {
          error(diagnostics, module.sheetName, null, "Part Number", part.partNumber, "Duplicate Part Number has conflicting descriptions.", "Use one authoritative Part description.");
        }
      });
    });
  }

  function validateSourcePartDuplicates(model, diagnostics) {
    var seen = {};
    var inactiveRows = [];
    var identicalOccurrences = 0;
    var conflicts = 0;
    model.modules.forEach(function (module) {
      module.sourceRows.forEach(function (row) {
        if (row.synthetic) return;
        if (row.skipBomUsage) {
          inactiveRows.push({ moduleCode: module.moduleCode, row: row, sheetName: module.sheetName });
          return;
        }
        var key = canonicalPartNumber(row.sourcePartNumber);
        var previous = seen[key];
        if (!previous) {
          seen[key] = { moduleCode: module.moduleCode, row: row, sheetName: module.sheetName };
          return;
        }
        var conflictingFields = partConflictFields(previous.row, row);
        if (conflictingFields.length) {
          conflicts += 1;
          conflictingFields.forEach(function (field) {
            error(
              diagnostics,
              module.sheetName,
              row.sourceRow,
              field.label,
              row.sourcePartNumber,
              "Part " + row.sourcePartNumber + " has conflicting " + field.label + " values: " + previous.sheetName + " row " + previous.row.sourceRow + ": " + displayValue(field.previous) + "; " + module.sheetName + " row " + row.sourceRow + ": " + displayValue(field.current) + ".",
              "Use one authoritative " + field.label + " for this Part Number before import."
            );
          });
        } else if (normalizedIdentityText(previous.row.description) !== normalizedIdentityText(row.description)) {
          warning(diagnostics, module.sheetName, row.sourceRow, "Part Number", row.sourcePartNumber, "Repeated Part Number uses a different source description but the same Drawing reference.", "The first mapped Part description will be used; review the source wording if needed.");
        } else {
          identicalOccurrences += 1;
        }
      });
    });
    inactiveRows.forEach(function (entry) {
      var row = entry.row;
      var key = canonicalPartNumber(row.sourcePartNumber);
      var previous = seen[key];
      if (!previous) {
        seen[key] = entry;
        return;
      }
      var conflictingFields = partConflictFields(previous.row, row);
      if (conflictingFields.length && !previous.row.skipBomUsage) {
        warning(
          diagnostics,
          entry.sheetName,
          row.sourceRow,
          conflictingFields.map(function (field) { return field.label; }).join(", "),
          row.sourcePartNumber,
          "Non-active source values differ from the active Part Master for Part " + row.sourcePartNumber + ". The non-active usage is excluded from the eBOM and retained only in source traceability.",
          "No correction is required unless this zero-quantity usage should be active; if so, align its technical values and enter a positive quantity."
        );
        model.acceptedInactiveSourceVariances = (model.acceptedInactiveSourceVariances || 0) + 1;
      } else if (conflictingFields.length) {
        conflicts += 1;
        conflictingFields.forEach(function (field) {
          error(
            diagnostics,
            entry.sheetName,
            row.sourceRow,
            field.label,
            row.sourcePartNumber,
            "Part " + row.sourcePartNumber + " has conflicting " + field.label + " values in non-active source rows: " + previous.sheetName + " row " + previous.row.sourceRow + ": " + displayValue(field.previous) + "; " + entry.sheetName + " row " + row.sourceRow + ": " + displayValue(field.current) + ".",
            "Use one authoritative " + field.label + " for this Part Number before import."
          );
        });
      } else {
        identicalOccurrences += 1;
      }
    });
    model.duplicatePartOccurrences = identicalOccurrences;
    model.conflictingPartCount = conflicts;
  }

  function partConflictFields(previous, current) {
    return [
      { key: "currentRevision", label: "Part Revision" },
      { key: "drawingNumber", label: "Drawing Number" },
      { key: "drawingRevision", label: "Drawing Revision" },
      { key: "material", label: "Material" },
      { key: "commodity", label: "Commodity" }
    ].filter(function (field) {
      var before = canonical(previous[field.key]);
      var after = canonical(current[field.key]);
      field.previous = previous[field.key];
      field.current = current[field.key];
      return before && after && before !== after;
    });
  }

  function mapCostPreview(workbook, model) {
    var source = workbook.sheets.find(hasCostHeader);
    var headerRow = source ? findRowContaining(source, ["PART NUMBER", "UNIT RATE", "SUPPLIER"]) : null;
    model.costPreview = { sheetName: source && source.name, headerRow: headerRow, rows: [] };
    if (!source || !headerRow) return;
    var columns = headerColumns(source, headerRow);
    for (var row = headerRow + 1; row <= source.maxRow && model.costPreview.rows.length < 100; row += 1) {
      var partNumber = text(cell(source, row, findColumn(columns, ["PART NUMBER"])));
      if (!partNumber) continue;
      model.costPreview.rows.push({
        sourceRow: row,
        partNumber: partNumber,
        description: text(cell(source, row, findColumn(columns, ["PART DESCRIPTION"]))),
        commodity: text(cell(source, row, findColumn(columns, ["COMMODITY"]))),
        supplier: text(cell(source, row, findColumn(columns, ["SUPPLIER"]))),
        unitRate: cell(source, row, findColumn(columns, ["UNIT RATE"]))
      });
    }
  }

  function applyFinishedGoodReferences(sheet, variants, workbookFingerprint) {
    if (!sheet || !variants.length) return;
    var internalRow = findLabelRow(sheet, /INTERNAL PART (?:NO|NUMBER)|COMPLETE SEAT NUMBERS[- ]INTERNAL/i);
    var oemRow = findLabelRow(sheet, /OEM PART (?:NO|NUMBER)|COMPLETE SEAT NUMBERS[- ]OEM/i);
    var imageRow = findLabelRow(sheet, /^(?:SEAT\s+COMPLETE\s+IMAGE|COMPLETE\s+SEAT\s+IMAGE|IMAGE)$/i);
    var internalValues = internalRow ? valuesAfterLabel(sheet, internalRow.row, internalRow.column) : [];
    var oemValues = oemRow ? valuesAfterLabel(sheet, oemRow.row, oemRow.column) : [];
    variants.forEach(function (variant, index) {
      variant.finishedGoodPartNumber = internalValues[index] || "";
      variant.oemFinishedGoodPartNumber = oemValues[index] || "";
      var imageColumn = imageRow ? imageRow.column + index + 1 : null;
      var imageAnchor = imageRow && (sheet.imageAnchors || []).find(function (anchor) {
        return anchor.row === imageRow.row && anchor.column === imageColumn && anchor.supported && anchor.mediaPath;
      });
      variant.completeSeatImageReference = imageAnchor ? partImageReference(workbookFingerprint, imageAnchor.mediaPath) : "";
      variant.sourceWorkbookImageAnchor = imageAnchor ? sheet.name + "!R" + imageAnchor.row + "C" + imageAnchor.column : "";
      variant.sourceImageMediaPath = imageAnchor && imageAnchor.mediaPath || "";
      variant.sourceImageMimeType = imageAnchor && imageAnchor.mimeType || "";
    });
  }

  function finish(model) {
    var errors = model.diagnostics.filter(function (item) { return item.severity === "ERROR"; });
    var warnings = model.diagnostics.filter(function (item) { return item.severity === "WARNING"; });
    var parts = model.modules.reduce(function (all, module) { return all.concat(module.parts); }, []);
    var boms = model.modules.reduce(function (all, module) { return all.concat(module.boms); }, []);
    model.counts = {
      parts: parts.filter(function (part) { return part.partType === "PART"; }).length,
      assemblies: parts.filter(function (part) { return part.partType === "ASSEMBLY"; }).length,
      bomItems: boms.reduce(function (count, bom) { return count + bom.items.length; }, 0),
      engineeringBoms: boms.length,
      features: model.features.length,
      variants: model.variants.length,
      commodities: model.commodities.length,
      errors: errors.length,
      warnings: warnings.length,
      skippedRows: model.skippedRows.length,
      duplicateIdenticalPartOccurrences: model.duplicatePartOccurrences || 0,
      conflictingParts: model.conflictingPartCount || 0,
      acceptedSourceVariances: model.acceptedSourceVariances || 0,
      acceptedInactiveSourceVariances: model.acceptedInactiveSourceVariances || 0,
      duplicateBomOccurrencesSkipped: boms.reduce(function (count, bom) {
        return count + (bom.items || []).reduce(function (total, item) { return total + (item.duplicateSourceRows || []).length; }, 0);
      }, 0),
      partImagesMapped: parts.filter(function (part) { return Boolean(part.imageReference); }).length,
      imageAssets: (model.imageAssets || []).length,
      unsupportedPartImages: parts.filter(function (part) { return part.sourceImagePresent && !part.imageReference; }).length
    };
    model.valid = model.supported && !model.previewOnly && errors.length === 0;
    return model;
  }

  function collectCommodities(model) {
    var values = [];
    model.modules.forEach(function (module) {
      module.parts.forEach(function (part) { if (part.commodity) values.push(part.commodity); });
    });
    model.commodities = unique(values.map(function (value) {
      return { code: commodityCode(value), name: String(value).trim() };
    }), function (item) { return item.code; });
  }

  function collectPartImageAssets(workbook, model) {
    var usedReferences = {};
    model.modules.forEach(function (module) {
      module.parts.forEach(function (part) {
        if (part.imageReference && part.sourceImageMediaPath) usedReferences[part.sourceImageMediaPath] = part.imageReference;
      });
    });
    model.variants.forEach(function (variant) {
      if (variant.completeSeatImageReference && variant.sourceImageMediaPath) {
        usedReferences[variant.sourceImageMediaPath] = variant.completeSeatImageReference;
      }
    });
    return (workbook.mediaAssets || []).filter(function (asset) {
      return asset.supported && usedReferences[asset.mediaPath];
    }).map(function (asset) {
      return {
        reference: usedReferences[asset.mediaPath],
        mediaPath: asset.mediaPath,
        mimeType: asset.mimeType,
        byteLength: asset.byteLength,
        base64: asset.base64,
        sourceWorkbookFingerprint: model.workbookFingerprint
      };
    });
  }

  function partImageReference(workbookFingerprint, mediaPath) {
    if (app.domain.partImageService) return app.domain.partImageService.createReference(workbookFingerprint, mediaPath);
    return "eblp-part-image://" + encodeURIComponent(workbookFingerprint) + "/" + String(mediaPath).split("/").map(encodeURIComponent).join("/");
  }

  function findVariantHeaderRow(sheet) {
    for (var row = 1; row <= Math.min(sheet.maxRow, 12); row += 1) {
      var count = 0;
      for (var column = 1; column <= sheet.maxColumn; column += 1) if (looksLikeVariant(text(cell(sheet, row, column)))) count += 1;
      if (count >= 2) return row;
    }
    return null;
  }

  function findFeatureColumn(sheet, variantRow) {
    for (var column = 1; column <= sheet.maxColumn; column += 1) {
      if (/VARIANTS|FEATURE LIST/i.test(text(cell(sheet, variantRow, column)))) return column;
      if (/FEATURE LIST/i.test(text(cell(sheet, variantRow + 1, column)))) return column;
    }
    return 3;
  }

  function collectCustomerMarkers(sheet, variantRow) {
    var markers = [];
    var configuredCustomers = app.data && app.data.referenceData && app.data.referenceData.customers || [];
    for (var row = 1; row < variantRow; row += 1) {
      for (var column = 1; column <= sheet.maxColumn; column += 1) {
        var value = text(cell(sheet, row, column));
        configuredCustomers.forEach(function (customer) {
          if (canonical(value) === canonical(customer)) markers.push({ column: column, customer: customer });
        });
      }
    }
    return markers.sort(function (a, b) { return a.column - b.column; });
  }

  function customerForColumn(markers, column) {
    var current = null;
    markers.forEach(function (marker) { if (marker.column <= column) current = marker.customer; });
    return current;
  }

  function findGroupLabel(sheet, row, header) {
    var preferred = [header.columns.partDescription, header.columns.commodity, 2, 3].filter(Boolean);
    for (var index = 0; index < preferred.length; index += 1) {
      var value = text(cell(sheet, row, preferred[index]));
      if (value && /ASSEMB|COMPONENT|PHANTOM|FANTUM|BACK TRIM|CUSHION TRIM|HR TRIM|PLASTIC/i.test(value)) return value;
    }
    return "";
  }

  function findHierarchyLevel(sheet, row, header) {
    for (var index = 0; index < header.levelColumns.length; index += 1) {
      var column = header.levelColumns[index];
      var value = cell(sheet, row, column);
      if (value !== "" && value !== null && value !== undefined) return Number(header.labels[column]);
    }
    return 0;
  }

  function markParentAssemblies(rows) {
    var parents = {};
    rows.forEach(function (row) { if (row.parentSourceId && row.parentSourceId !== "ROOT") parents[row.parentSourceId] = true; });
    rows.forEach(function (row) { if (parents[row.sourceId]) row.partType = "ASSEMBLY"; });
  }

  function imageAnchorAtRow(sheet, row, imageColumn) {
    var candidates = (sheet.imageAnchors || []).filter(function (anchor) {
      return Boolean(anchor && anchor.mediaPath && anchor.row === row && (!imageColumn || anchor.column === imageColumn));
    });
    return candidates.find(function (anchor) { return anchor.supported; }) || candidates[0] || null;
  }

  function allVariants(variants) {
    return variants.reduce(function (result, variant) { result[variant.sourceKey] = true; return result; }, {});
  }

  function sourcePartNumber(rows, sourceId) {
    var row = rows.find(function (candidate) { return candidate.sourceId === sourceId; });
    return row ? row.sourcePartNumber : "";
  }

  function ignoredEngineeringRowReason(sheet, row, header, partNumber, description, groupLabel) {
    var normalizedPart = canonical(partNumber);
    var normalizedDescription = canonical(description);
    if (normalizedPart === "PART NUMBER" || normalizedDescription === "PART DESCRIPTION") return "Repeated print header";
    if (!partNumber && /^(SUB ?TOTAL|TOTAL|GRAND TOTAL|NOTE|REMARKS?)\b/.test(normalizedDescription)) return "Subtotal or note row";
    if (!partNumber && !description && !groupLabel && imageAnchorAtRow(sheet, row, header.columns.image)) return "Image-only anchor row";
    if (!partNumber && !description && !groupLabel) return "Blank or formatting-only row";
    return "";
  }

  function sourceHierarchyPath(row, rowsById) {
    var segments = [];
    var current = row;
    var guard = 0;
    while (current && guard < 100) {
      segments.unshift(canonicalPartNumber(current.sourcePartNumber) + "@" + (current.sourceRow || current.sourceId));
      current = current.parentSourceId && current.parentSourceId !== "ROOT" ? rowsById[current.parentSourceId] : null;
      guard += 1;
    }
    return segments.join("/");
  }

  function makeOccurrenceKey(input) {
    return "OCC-" + stableHash([
      input.workbookFingerprint,
      canonical(input.sourceSheet),
      canonical(input.variantSourceKey),
      canonical(input.moduleCode),
      input.hierarchyPath,
      input.parentSourceId,
      canonicalPartNumber(input.partNumber),
      input.sourceRow
    ].join("|"));
  }

  function calculateWorkbookFingerprint(workbook, detection) {
    var sheets = (workbook.sheets || []).filter(function (sheet) {
      var name = canonical(sheet.name);
      if (detection.type === "BOM_COST") return name.indexOf("SUMMARY") === 0 || hasCostHeader(sheet);
      return name === "FEATURE MATRIX" || name === "COMPLETE SEAT JIT" || MODULE_SHEETS.some(function (definition) {
        return definition.aliases.map(canonical).indexOf(name) !== -1;
      });
    }).slice().sort(function (a, b) { return canonical(a.name).localeCompare(canonical(b.name)); });
    var chunks = [detection.type || "UNSUPPORTED"];
    sheets.forEach(function (sheet) {
      chunks.push("S:" + canonical(sheet.name));
      Object.keys(sheet.cells || {}).sort(cellReferenceSort).forEach(function (reference) {
        var value = fingerprintValue(sheet.cells[reference] && sheet.cells[reference].value);
        if (value !== "") chunks.push(reference.toUpperCase() + "=" + value);
      });
    });
    return "WB-" + stableHash(chunks.join("\n"));
  }

  function cellReferenceSort(left, right) {
    var leftMatch = /^([A-Z]+)(\d+)$/i.exec(left) || [];
    var rightMatch = /^([A-Z]+)(\d+)$/i.exec(right) || [];
    var rowDifference = Number(leftMatch[2] || 0) - Number(rightMatch[2] || 0);
    if (rowDifference) return rowDifference;
    return String(leftMatch[1] || "").localeCompare(String(rightMatch[1] || ""));
  }

  function fingerprintValue(value) {
    if (value === null || value === undefined || value === "") return "";
    if (typeof value === "number") return String(Number(value));
    if (typeof value === "boolean") return value ? "TRUE" : "FALSE";
    return String(value).replace(/\r\n?/g, "\n").replace(/[ \t]+/g, " ").trim().toUpperCase();
  }

  function stableHash(value) {
    var first = 2166136261;
    var second = 3339675911;
    var source = String(value || "");
    for (var index = 0; index < source.length; index += 1) {
      var code = source.charCodeAt(index);
      first ^= code;
      first = Math.imul(first, 16777619);
      second ^= code + index;
      second = Math.imul(second, 2246822519);
    }
    return (first >>> 0).toString(16).padStart(8, "0").toUpperCase() + (second >>> 0).toString(16).padStart(8, "0").toUpperCase();
  }

  function displayValue(value) {
    var result = text(value);
    return result || "(blank)";
  }

  function findSheet(workbook, aliases) {
    var canonicalAliases = aliases.map(canonical);
    return (workbook.sheets || []).find(function (sheet) { return canonicalAliases.indexOf(canonical(sheet.name)) !== -1; }) || null;
  }

  function sheetSummary(sheet) {
    return {
      name: sheet.name,
      state: sheet.state || "visible",
      rows: sheet.maxRow || 0,
      columns: sheet.maxColumn || 0,
      formulas: sheet.formulaCount || 0,
      images: sheet.imageCount || 0,
      mergedRanges: (sheet.merges || []).length,
      hiddenRows: (sheet.hiddenRows || []).length,
      hiddenColumns: (sheet.hiddenColumns || []).length
    };
  }

  function hasCostHeader(sheet) {
    return Boolean(findRowContaining(sheet, ["PART NUMBER", "UNIT RATE", "SUPPLIER"]));
  }

  function findRowContaining(sheet, required) {
    for (var row = 1; row <= Math.min(sheet.maxRow, 15); row += 1) {
      var values = [];
      for (var column = 1; column <= sheet.maxColumn; column += 1) values.push(canonical(cell(sheet, row, column)));
      if (required.every(function (label) { return values.indexOf(canonical(label)) !== -1; })) return row;
    }
    return null;
  }

  function headerColumns(sheet, row) {
    var columns = {};
    for (var column = 1; column <= sheet.maxColumn; column += 1) columns[column] = canonical(cell(sheet, row, column));
    return columns;
  }

  function findColumn(labels, aliases) {
    var normalized = aliases.map(canonical);
    return Object.keys(labels).map(Number).find(function (column) { return normalized.indexOf(labels[column]) !== -1; }) || null;
  }

  function findColumnContains(labels, token) {
    token = canonical(token);
    return Object.keys(labels).map(Number).find(function (column) { return labels[column].indexOf(token) !== -1; }) || null;
  }

  function findLabelRow(sheet, pattern) {
    for (var row = 1; row <= Math.min(sheet.maxRow, 12); row += 1) {
      for (var column = 1; column <= sheet.maxColumn; column += 1) {
        if (pattern.test(text(cell(sheet, row, column)))) return { row: row, column: column };
      }
    }
    return null;
  }

  function valuesAfterLabel(sheet, row, column) {
    var values = [];
    for (var current = column + 1; current <= sheet.maxColumn; current += 1) {
      var value = sourceText(cell(sheet, row, current));
      if (value) values.push(value);
    }
    if (values.length === 1 && /[,;]/.test(values[0])) values = values[0].split(/[,;]/).map(function (value) { return value.trim(); }).filter(Boolean);
    return values;
  }

  function firstText(sheet, limit) {
    var values = [];
    for (var row = 1; row <= Math.min(sheet.maxRow, limit || 10); row += 1) {
      for (var column = 1; column <= Math.min(sheet.maxColumn, 20); column += 1) {
        var value = text(cell(sheet, row, column));
        if (value) values.push(value);
      }
    }
    return values.join(" ");
  }

  function detectEngineeringContext(workbook) {
    var titleSheets = [
      findSheet(workbook, ["REVISION HISTORY"]),
      findSheet(workbook, ["FEATURE MATRIX"]),
      findSheet(workbook, ["COMPLETE SEAT JIT"]),
      findSheet(workbook, ["STRUCTURE"])
    ].filter(Boolean);
    var title = titleSheets.map(function (sheet) { return firstText(sheet, 6); }).join(" ").toUpperCase();
    var seatMatch = /\b(\d{2}\s*P|\d\s*R)\b/i.exec(title);
    var programMatch = /\b([A-Z]\d[A-Z]\d)\b/i.exec(title);
    var customer = findWorkbookLabelValue(workbook, /^CUSTOMER(?:\s*\/\s*OEM)?$/i) || customerFromTitle(title, programMatch && programMatch[1]);
    return {
      programCode: programMatch ? programMatch[1].toUpperCase() : "",
      seatType: seatMatch ? seatMatch[1].replace(/\s+/g, "").toUpperCase() : "",
      customer: titleCaseCustomer(customer)
    };
  }

  function findWorkbookLabelValue(workbook, pattern) {
    var sheets = workbook.sheets || [];
    for (var sheetIndex = 0; sheetIndex < sheets.length; sheetIndex += 1) {
      var sheet = sheets[sheetIndex];
      for (var row = 1; row <= Math.min(sheet.maxRow, 15); row += 1) {
        for (var column = 1; column <= Math.min(sheet.maxColumn, 20); column += 1) {
          if (!pattern.test(text(cell(sheet, row, column)))) continue;
          for (var valueColumn = column + 1; valueColumn <= Math.min(sheet.maxColumn, column + 4); valueColumn += 1) {
            var value = text(cell(sheet, row, valueColumn));
            if (value) return value;
          }
        }
      }
    }
    return "";
  }

  function customerFromTitle(title, programCode) {
    if (!programCode) return "";
    var prefix = title.split(new RegExp("\\b" + programCode + "\\b", "i"))[0] || "";
    var tokens = prefix.replace(/[^A-Z/& ]+/gi, " ").replace(/\s+/g, " ").trim().split(" ");
    return tokens.length ? tokens.slice(-3).join(" ") : "";
  }

  function customerFromVariantHeader(header, seatType) {
    var value = text(header);
    if (!value) return "";
    value = value.replace(new RegExp("\\b" + String(seatType || "").replace(/[^A-Z0-9]/gi, "\\$&") + "\\b", "ig"), " ");
    value = value.replace(/\b(?:RH|LH)\b/ig, " ").replace(/\bE\d+\b\s*(?:\+|\([^)]*\))?/ig, " ");
    value = value.replace(/[^A-Z0-9&/ ]+/ig, " ").replace(/\s+/g, " ").trim();
    return /[A-Z]/i.test(value) ? titleCaseCustomer(value) : "";
  }

  function customerKey(customer) {
    var value = canonical(customer).replace(/[^A-Z0-9]+/g, "");
    return value.slice(0, 3) || "CUS";
  }

  function titleCaseCustomer(value) {
    return text(value).toLowerCase().replace(/\b[a-z]/g, function (letter) { return letter.toUpperCase(); });
  }

  function cell(sheet, row, column) {
    if (!column) return "";
    return app.importing.xlsxReader.getCell(sheet, row, column);
  }

  function looksLikeVariant(value) {
    return /(?:^|[-\s])E\d+(?:\s*(?:\+|\([^)]*\)))?(?:$|[-\s])/i.test(value || "");
  }

  function inferValueType(values) {
    var nonEmpty = values.filter(function (value) { return value !== ""; });
    if (nonEmpty.length && nonEmpty.every(function (value) { return value === "YES" || value === "NO"; })) return "BOOLEAN";
    if (nonEmpty.length && nonEmpty.every(function (value) { return /^-?\d+(?:\.\d+)?$/.test(value); })) return "NUMBER";
    if (unique(nonEmpty).length <= 12) return "ENUM";
    return "TEXT";
  }

  function normalizeFeatureValue(value) {
    var normalized = text(value).trim();
    if (/^(YES|Y|TRUE|1)$/i.test(normalized)) return "YES";
    if (/^(NO|N|FALSE|0)$/i.test(normalized)) return "NO";
    return normalized;
  }

  function featureCodeFromName(name) {
    var code = canonical(name).replace(/\bONE TOUCH\b/, "ONE_TOUCH").replace(/\s+/g, "_");
    return FEATURE_CODE_ALIASES[code] || code.replace(/[^A-Z0-9_]+/g, "_").replace(/^_|_$/g, "");
  }

  function valueForFeature(features, code, variantKey) {
    var feature = features.find(function (item) { return item.featureCode === code; });
    return feature ? feature.valuesByVariant[variantKey] || "" : "";
  }

  function normalizeChangeClassification(value) {
    var normalized = canonical(value).replace(/\s+/g, "_");
    if (!normalized) return "UNCHANGED";
    if (/DELETE/.test(normalized)) return "DELETED";
    if (/^NEW/.test(normalized)) return "NEW";
    if (/^(C_O|CO|CARRY_OVER|CARRYOVER)/.test(normalized)) return "CARRY_OVER";
    if (/MODIF/.test(normalized)) return "MODIFIED";
    if (/REPLAC/.test(normalized)) return "REPLACED";
    return "UNCHANGED";
  }

  function commodityCode(value) {
    return canonical(value || "OTHER").replace(/[^A-Z0-9]+/g, "_").replace(/^_|_$/g, "") || "OTHER";
  }

  function isTruthyMarker(value) {
    return value === true || value === 1 || value === "1" || /^(YES|Y|X)$/i.test(text(value));
  }

  function sourceText(value) {
    var result = text(value);
    return result.charAt(0) === "=" ? "" : result;
  }

  function toNumber(value) {
    if (value === "" || value === null || value === undefined) return null;
    var number = Number(String(value).replace(/,/g, "").replace(/[^\d.-]/g, ""));
    return isNaN(number) ? null : number;
  }

  function toNumberOrNull(value) {
    return toNumber(value);
  }

  function error(list, sheet, row, column, value, message, correction) {
    list.push(diagnostic("ERROR", sheet, row, column, value, message, correction));
  }

  function warning(list, sheet, row, column, value, message, correction) {
    list.push(diagnostic("WARNING", sheet, row, column, value, message, correction));
  }

  function diagnostic(severity, sheet, row, column, value, message, correction) {
    return { severity: severity, sheet: sheet, row: row || null, column: column || "", value: value == null ? "" : value, message: message, correction: correction };
  }

  function supported(type, label, seatType, context) { return { supported: true, type: type, label: label, seatType: seatType, context: context || null }; }
  function unsupported() { return { supported: false, type: "UNSUPPORTED", label: "Unsupported workbook", seatType: null }; }
  function displayModule(code) { return code.split("_").map(function (word) { return word.charAt(0) + word.slice(1).toLowerCase(); }).join(" "); }
  function canonical(value) { return text(value).toUpperCase().replace(/[.,]/g, "").replace(/[\/_-]+/g, " ").replace(/\s+/g, " ").trim(); }
  function normalizedIdentityText(value) { return canonical(value).split(" ").filter(Boolean).sort().join(" "); }
  function canonicalPartNumber(value) { return text(value).toUpperCase().replace(/\s+/g, ""); }
  function text(value) { return String(value == null ? "" : value).trim(); }
  function compactToken(value) { return canonical(value).replace(/\s+/g, "-").replace(/[^A-Z0-9-]/g, "").slice(-14) || "UNSPECIFIED"; }
  function makeId(prefix, value) { return prefix + "-" + compactToken(value); }
  function unique(values, keySelector) {
    var seen = {};
    return (values || []).filter(function (value) {
      var key = keySelector ? keySelector(value) : String(value);
      if (seen[key]) return false;
      seen[key] = true;
      return true;
    });
  }

  app.importing.bomImportMapper = {
    detectWorkbook: detectWorkbook,
    mapWorkbook: mapWorkbook,
    parseFeatureMatrix: parseFeatureMatrix,
    parseEngineeringSheet: parseEngineeringSheet,
    normalizeChangeClassification: normalizeChangeClassification,
    inferValueType: inferValueType,
    canonicalSheetName: canonical,
    calculateWorkbookFingerprint: calculateWorkbookFingerprint,
    makeOccurrenceKey: makeOccurrenceKey
  };
})(typeof window !== "undefined" ? (window.DEP = window.DEP || {}) : (globalThis.DEP = globalThis.DEP || {}));
