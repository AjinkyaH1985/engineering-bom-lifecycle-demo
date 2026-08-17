(function (app) {
  app.domain = app.domain || {};

  var MIME_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  var FIXED_ZIP_DATE = new Date("2000-01-01T00:00:00.000Z");
  var GOOD_STATUSES = ["ACTIVE", "COMPLETE", "CURRENT", "IMPLEMENTED", "RELEASED"];
  var WARNING_STATUSES = ["APPROVED", "DRAFT", "IN_PROGRESS", "STALE", "SUBMITTED"];

  function listReleasedRevisions(criteria) {
    criteria = criteria || {};
    return app.core.appState.getCollection("revisions").map(function (revision) {
      return app.domain.revisionService.normalizeRevision(revision);
    }).filter(function (revision) {
      return revision.lifecycleStatus === "RELEASED" &&
        (!criteria.programId || revision.programId === criteria.programId) &&
        (!criteria.seatVariantId || revision.seatVariantId === criteria.seatVariantId);
    }).sort(function (left, right) {
      var contextOrder = String(left.programId + "|" + left.seatVariantId).localeCompare(String(right.programId + "|" + right.seatVariantId));
      return contextOrder || String(left.releasedAt || "").localeCompare(String(right.releasedAt || ""));
    });
  }

  function getRevisionExportReadiness(revisionId) {
    var revision = revisionId ? app.domain.revisionService.getRevision(revisionId) : null;
    return validateRevisionSnapshot(revision);
  }

  function validateRevisionSnapshot(revision) {
    var errors = [];
    var warnings = [];
    if (!revision) {
      errors.push(issue("REVISION_REQUIRED", "Select a released Revision to export."));
      return { exportAllowed: false, errors: errors, warnings: warnings, revision: null };
    }
    if (revision.lifecycleStatus !== "RELEASED") errors.push(issue("REVISION_NOT_RELEASED", "Only a RELEASED Revision can be exported."));
    if (!revision.featureConfigurationSnapshot || !revision.featureConfigurationSnapshot.id) {
      errors.push(issue("REVISION_FEATURE_SNAPSHOT_MISSING", "The selected Revision does not contain a Feature Configuration snapshot."));
    }
    if (!Array.isArray(revision.partsSnapshot) || !revision.partsSnapshot.length ||
      !Array.isArray(revision.engineeringBomSnapshots) || !revision.engineeringBomSnapshots.length) {
      errors.push(issue("REVISION_ENGINEERING_SNAPSHOT_MISSING", "The selected Revision does not contain the released Engineering snapshot."));
    }
    if (!revision.engineeringProductStructureSnapshot || !revision.engineeringProductStructureSnapshot.id) {
      errors.push(issue("REVISION_COMPLETE_SEAT_SNAPSHOT_MISSING", "The selected Revision does not contain the released Complete Seat JIT snapshot."));
    }
    if (!revision.commercialAssessmentSnapshot || !revision.commercialAssessmentSnapshot.id) {
      errors.push(issue("REVISION_COMMERCIAL_SNAPSHOT_MISSING", "The selected Revision does not contain the released Commercial Assessment snapshot."));
    }
    if (!revision.programSnapshot || !revision.programSnapshot.id || !revision.seatVariantSnapshot || !revision.seatVariantSnapshot.id) {
      warnings.push(issue("REVISION_CONTEXT_LABELS_LEGACY", "This earlier Revision predates export context labels; stable IDs will be used where labels are unavailable."));
    }
    if (!(revision.featureDefinitionsSnapshot || []).length) {
      warnings.push(issue("REVISION_FEATURE_DEFINITIONS_LEGACY", "This earlier Revision predates Feature definition snapshots; Feature IDs will be exported as fallback identifiers."));
    }
    if (!revision.engineeringChangeSnapshot || !revision.engineeringChangeSnapshot.id) {
      warnings.push(issue("REVISION_ECN_DETAILS_LEGACY", "This earlier Revision contains only the Engineering Change reference; detailed ECN fields are unavailable."));
    }
    return { exportAllowed: errors.length === 0, errors: errors, warnings: warnings, revision: clone(revision) };
  }

  function buildRevisionWorkbookModel(revisionId, options) {
    var readiness = getRevisionExportReadiness(revisionId);
    if (!readiness.exportAllowed) {
      throw new app.core.errors.BusinessOperationError("Released Revision export validation failed.", readiness.errors);
    }
    return buildWorkbookModelFromRevision(readiness.revision, options);
  }

  function buildWorkbookModelFromRevision(revision, options) {
    options = options || {};
    var readiness = validateRevisionSnapshot(revision);
    if (!readiness.exportAllowed) {
      throw new app.core.errors.BusinessOperationError("Released Revision export validation failed.", readiness.errors);
    }
    revision = readiness.revision;
    var exportedAt = options.exportedAt || new Date().toISOString();
    var indexes = buildSnapshotIndexes(revision);
    var sheets = [];
    sheets.push(buildExportSummarySheet(revision, indexes, exportedAt));
    sheets.push(buildRevisionHistorySheet(revision));
    sheets.push(buildFeatureMatrixSheet(revision, indexes));
    applicableBomSnapshots(revision, indexes).forEach(function (entry) {
      sheets.push(buildEngineeringBomSheet(entry.bom, entry.module, indexes, revision));
    });
    sheets.push(buildCompleteSeatSheet(revision, indexes));
    sheets.push(buildCommoditySummarySheet(revision, indexes));
    sheets.push(buildCommercialAssessmentSheet(revision, indexes));
    sheets.push(buildEcnSummarySheet(revision, indexes));
    return {
      revisionId: revision.id,
      revisionNumber: revision.revisionNumber,
      snapshotHash: revision.snapshotHash,
      exportedAt: exportedAt,
      fileName: buildFileName(revision),
      warnings: readiness.warnings,
      sheets: sheets,
      sheetNames: sheets.map(function (sheet) { return sheet.name; })
    };
  }

  function generateRevisionWorkbook(revisionId, options) {
    var model = buildRevisionWorkbookModel(revisionId, options);
    return createWorkbookPackage(model).then(function (bytes) {
      return { bytes: bytes, fileName: model.fileName, mimeType: MIME_TYPE, model: model };
    });
  }

  function downloadReleasedRevision(revisionId, options) {
    return generateRevisionWorkbook(revisionId, options).then(function (result) {
      if (typeof document === "undefined" || typeof Blob === "undefined" || typeof URL === "undefined") return result;
      var blob = new Blob([result.bytes], { type: result.mimeType });
      var url = URL.createObjectURL(blob);
      var anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = result.fileName;
      anchor.style.display = "none";
      document.body.appendChild(anchor);
      anchor.click();
      document.body.removeChild(anchor);
      setTimeout(function () { URL.revokeObjectURL(url); }, 0);
      return result;
    });
  }

  function buildSnapshotIndexes(revision) {
    return {
      parts: indexBy(revision.partsSnapshot, "id"),
      features: indexBy(revision.featureDefinitionsSnapshot, "id"),
      modules: indexBy(revision.engineeringModuleSnapshots, "id"),
      boms: indexBy(revision.engineeringBomSnapshots, "id"),
      epsItems: indexBy((revision.engineeringProductStructureSnapshot || {}).items, "id")
    };
  }

  function buildExportSummarySheet(revision, indexes, exportedAt) {
    var program = revision.programSnapshot || {};
    var variant = revision.seatVariantSnapshot || {};
    var change = revision.engineeringChangeSnapshot || {};
    var featureCount = featureRows(revision, indexes).length;
    var activeCommercialLines = activeLines(revision.commercialAssessmentSnapshot);
    var commodityCount = unique(activeCommercialLines.map(function (line) {
      return normalizedCommodity(indexes.parts[line.partId]);
    })).length;
    var rows = [
      ["Programme", program.programCode || program.code || program.name || revision.programId],
      ["Customer / OEM", variant.customer || variant.brand || variant.oem || program.customer || program.oem || ""],
      ["Seat Type", variant.seatType || variant.seatFamily || ""],
      ["Finished-Good Variant", variant.variantCode || variant.variantName || revision.seatVariantId],
      ["Revision", revision.revisionNumber],
      ["Release Date", dateCell(revision.releasedAt)],
      ["ECN", change.changeNumber || revision.engineeringChangeId],
      ["Export Date", dateCell(exportedAt)],
      ["Feature Count", featureCount],
      ["Part Count", (revision.partsSnapshot || []).length],
      ["Engineering BOM Count", applicableBomSnapshots(revision, indexes).length],
      ["Complete Seat Count", ((revision.engineeringProductStructureSnapshot || {}).items || []).length],
      ["Commodity Count", commodityCount],
      ["Commercial Count", activeCommercialLines.length],
      ["Source Workbook", sourceWorkbookLabel(revision)]
    ];
    commercialTotalsByCurrency(revision.commercialAssessmentSnapshot).forEach(function (total) {
      rows.push(["Currency Total (" + total.currency + ")", currencyCell(total.overallTotal)]);
    });
    return makeSheet("Export Summary", "Released Product Definition Export", [
      column("Field", 30), column("Value", 70, "wrap")
    ], rows, revision);
  }

  function buildRevisionHistorySheet(revision) {
    var change = revision.engineeringChangeSnapshot || {};
    return makeSheet("Revision History", "Released Revision History", [
      column("Revision", 12), column("Title", 32, "wrap"), column("Description", 46, "wrap"),
      column("Release Date", 20, "date"), column("Released By", 20), column("Lifecycle", 16, "status"),
      column("ECN Number", 20), column("Snapshot Hash", 24), column("Generation Version", 18), column("Notes", 42, "wrap")
    ], [[
      revision.revisionNumber, revision.title, revision.description, dateCell(revision.releasedAt), revision.releasedBy,
      statusCell(revision.lifecycleStatus), change.changeNumber || revision.engineeringChangeId, revision.snapshotHash,
      revision.generationVersion, revision.notes
    ]], revision);
  }

  function buildFeatureMatrixSheet(revision, indexes) {
    return makeSheet("Feature Matrix", "Feature Matrix - Selected Finished-Good Variant", [
      column("Feature Code", 24), column("Feature Name", 30), column("Category", 22), column("Value", 24), column("Status", 15, "status")
    ], featureRows(revision, indexes).map(function (row) {
      return [row.code, row.name, row.category, displayValue(row.value), statusCell(row.status)];
    }), revision);
  }

  function featureRows(revision, indexes) {
    var configuration = revision.featureConfigurationSnapshot || {};
    var selections = configuration.selections || [];
    var selectionByFeature = indexBy(selections, "featureId");
    var definitions = (revision.featureDefinitionsSnapshot || []).slice();
    if (!definitions.length) {
      definitions = selections.map(function (selection) {
        return { id: selection.featureId, featureCode: selection.featureId, name: selection.featureId, category: "", status: "ACTIVE" };
      });
    }
    return definitions.map(function (feature) {
      var selection = selectionByFeature[feature.id];
      return {
        code: feature.featureCode || feature.code || feature.id,
        name: feature.name || feature.featureCode || feature.id,
        category: feature.category || "Uncategorized",
        value: selection ? selection.selectedValue : "",
        status: feature.status || "ACTIVE"
      };
    }).sort(function (left, right) { return String(left.code).localeCompare(String(right.code)); });
  }

  function applicableBomSnapshots(revision, indexes) {
    return (revision.engineeringBomSnapshots || []).filter(function (bom) {
      return Boolean(bom && (bom.rootPartId || (bom.items || []).length));
    }).map(function (bom) {
      return { bom: bom, module: indexes.modules[bom.engineeringModuleId] || fallbackModule(bom) };
    }).sort(function (left, right) {
      var sequence = moduleExportOrder(left.module) - moduleExportOrder(right.module);
      return sequence || moduleLabel(left.module).localeCompare(moduleLabel(right.module));
    });
  }

  function moduleExportOrder(module) {
    var key = String(module.moduleCode || module.code || module.name || "").toUpperCase().replace(/[\s-]+/g, "_");
    var order = { STRUCTURE: 10, FOAM: 20, PLASTIC: 30, TRIM: 40, HEAD_REST: 50, HEADREST: 50, ARM_REST: 60, ARMREST: 60 };
    return order[key] || (1000 + Number(module.displaySequence || 0));
  }

  function buildEngineeringBomSheet(bom, module, indexes, revision) {
    var rows = flattenBomHierarchy(bom, indexes.parts).map(function (entry) {
      var part = entry.part || {};
      var item = entry.item || {};
      var quantity = entry.isRoot ? 1 : number(item.quantity);
      var cadWeight = nullableNumber(part.cadWeight);
      var totalWeight = item.totalCadWeight !== undefined ? nullableNumber(item.totalCadWeight) : (cadWeight === null ? null : cadWeight * quantity);
      return [
        textCell("L" + entry.level, { indent: entry.level }), part.partNumber || "", part.currentRevision || "",
        part.drawingNumber || "", part.drawingRevision || "", wrapCell(part.description || part.name || ""),
        part.commodity || part.sourceCommodityOriginal || "", part.imageReference || "", part.material || "", part.gauge || "",
        quantity, part.unitOfMeasure || item.unitOfMeasure || "EA", numberCell(cadWeight), numberCell(totalWeight),
        classificationCell(item.changeClassification || (entry.isRoot ? "ASSEMBLY" : "UNCHANGED")),
        releaseInformation(part, bom), wrapCell(item.remarks || ""), item.sourceWorkbookSheet || part.sourceWorkbookSheet || "",
        item.sourceWorkbookRow || part.sourceWorkbookRow || ""
      ];
    });
    return makeSheet(sheetNameForModule(module), moduleLabel(module) + " Engineering eBOM", [
      column("Hierarchy / ASM Level", 20), column("Part Number", 24), column("Part Revision", 14),
      column("Drawing Number", 24), column("Drawing Revision", 16), column("Part Description", 42, "wrap"),
      column("Commodity", 20), column("Image Reference", 36, "wrap"), column("Material", 24), column("Gauge", 12),
      column("Quantity", 12, "number"), column("Unit", 10), column("CAD Weight", 14, "number"),
      column("Total Weight", 14, "number"), column("Change Classification", 22, "status"),
      column("Release Information", 28, "wrap"), column("Remarks", 40, "wrap"), column("Source Sheet", 20), column("Source Row", 12)
    ], rows, revision);
  }

  function flattenBomHierarchy(bom, partsById) {
    var children = {};
    (bom.items || []).forEach(function (item) {
      var key = item.parentPartId || "";
      children[key] = children[key] || [];
      children[key].push(item);
    });
    Object.keys(children).forEach(function (key) { children[key].sort(compareSequence); });
    var rows = [];
    var visited = {};
    function walk(parentPartId, level, ancestorParts) {
      (children[parentPartId] || []).forEach(function (item) {
        if (visited[item.id]) return;
        visited[item.id] = true;
        rows.push({ level: level, item: item, part: partsById[item.childPartId] || {}, isRoot: false });
        if (!ancestorParts[item.childPartId]) {
          var nextAncestors = Object.assign({}, ancestorParts);
          nextAncestors[item.childPartId] = true;
          walk(item.childPartId, level + 1, nextAncestors);
        }
      });
    }
    var rootId = bom.rootPartId;
    if (rootId) {
      rows.push({ level: 0, item: null, part: partsById[rootId] || { id: rootId }, isRoot: true });
      var ancestors = {};
      ancestors[rootId] = true;
      walk(rootId, 1, ancestors);
    }
    (bom.items || []).sort(compareSequence).forEach(function (item) {
      if (!visited[item.id]) rows.push({ level: Number(item.level || 0), item: item, part: partsById[item.childPartId] || {}, isRoot: false });
    });
    return rows;
  }

  function buildCompleteSeatSheet(revision, indexes) {
    var structure = revision.engineeringProductStructureSnapshot || {};
    var rows = flattenGeneratedHierarchy(structure.items || []).map(function (entry) {
      var item = entry.item;
      var part = indexes.parts[item.partId] || {};
      var module = indexes.modules[item.sourceEngineeringModuleId] || fallbackModule(indexes.boms[item.sourceEngineeringBomId] || {});
      return [
        textCell(completeSeatHierarchyLabel(entry, part), { indent: entry.level }), entry.level, moduleLabel(module), part.partNumber || (entry.level === 0 ? "COMPLETE-SEAT" : ""),
        part.currentRevision || "", part.drawingNumber || "", part.drawingRevision || "", wrapCell(part.description || part.name || entry.label),
        part.commodity || part.sourceCommodityOriginal || "", part.imageReference || "", part.material || "", part.gauge || "",
        number(item.quantity), number(item.calculatedQuantity === undefined ? item.quantity : item.calculatedQuantity), item.unitOfMeasure || "EA",
        numberCell(nullableNumber(part.cadWeight)), numberCell(nullableNumber(item.totalCadWeight)), classificationCell(item.changeClassification || "UNCHANGED"),
        item.applicabilityResult || "UNCONDITIONAL", item.sourceEngineeringBomId || "", item.sourceBomItemId || "", item.partId || ""
      ];
    });
    return makeSheet("Complete Seat JIT", "Complete Seat JIT - Released Generated Structure", [
      column("Full Hierarchy", 42), column("Level", 10), column("Source Discipline", 20), column("Part Number", 24),
      column("Part Revision", 14), column("Drawing Number", 24), column("Drawing Revision", 16),
      column("Part Description", 42, "wrap"), column("Commodity", 20), column("Image Reference", 36, "wrap"),
      column("Material", 24), column("Gauge", 12), column("Unit Quantity", 14, "number"),
      column("Calculated Quantity", 18, "number"), column("Unit", 10), column("CAD Weight", 14, "number"),
      column("Total CAD Weight", 18, "number"), column("Change Classification", 22, "status"),
      column("Applicability", 18), column("Source eBOM", 28), column("Source BOM Item", 28), column("Part ID", 28)
    ], rows, revision);
  }

  function flattenGeneratedHierarchy(items) {
    var byParent = {};
    (items || []).forEach(function (item) {
      var key = item.parentGeneratedItemId || "__ROOT__";
      byParent[key] = byParent[key] || [];
      byParent[key].push(item);
    });
    Object.keys(byParent).forEach(function (key) { byParent[key].sort(compareSequence); });
    var rows = [];
    var visited = {};
    function walk(parentId, level) {
      (byParent[parentId] || []).forEach(function (item) {
        if (visited[item.id]) return;
        visited[item.id] = true;
        var label = item.partId || (level === 0 ? "Complete Seat Assembly" : "Module Assembly");
        rows.push({ item: item, level: level, label: label });
        walk(item.id, level + 1);
      });
    }
    walk("__ROOT__", 0);
    (items || []).forEach(function (item) {
      if (!visited[item.id]) rows.push({ item: item, level: Number(item.level || 0), label: item.partId || "Unlinked Item" });
    });
    return rows;
  }

  function completeSeatHierarchyLabel(entry, part) {
    if (entry.level === 0 && !part.partNumber) return "Complete Seat Assembly";
    var number = part.partNumber || entry.item.partId || "Generated Item";
    var description = part.description || part.name || "";
    return description && description !== number ? number + " - " + description : number;
  }

  function buildCommoditySummarySheet(revision, indexes) {
    var groups = {};
    activeLines(revision.commercialAssessmentSnapshot).forEach(function (line) {
      var part = indexes.parts[line.partId] || {};
      var commodity = normalizedCommodity(part);
      var currency = line.currency || "UNSPECIFIED";
      var key = commodity + "|" + currency;
      var group = groups[key] || (groups[key] = {
        commodity: commodity, currency: currency, partIds: {}, suppliers: {}, priced: 0, unpriced: 0,
        piece: 0, tooling: 0, logistics: 0, complete: 0, count: 0
      });
      group.partIds[line.partId || line.id] = true;
      if (line.supplier) group.suppliers[line.supplier] = true;
      var priced = isFiniteNumber(line.piecePrice);
      group.priced += priced ? 1 : 0;
      group.unpriced += priced ? 0 : 1;
      group.piece += number(line.quantity) * number(line.piecePrice);
      group.tooling += number(line.toolingCost);
      group.logistics += number(line.logisticsCost);
      group.complete += lineIsComplete(line, commodity) ? 1 : 0;
      group.count += 1;
    });
    var rows = Object.keys(groups).sort().map(function (key) {
      var group = groups[key];
      return [
        group.commodity, group.currency, group.count, Object.keys(group.suppliers).length,
        group.priced, group.unpriced, currencyCell(group.piece), currencyCell(group.tooling), currencyCell(group.logistics),
        currencyCell(group.piece + group.tooling + group.logistics), group.complete + " / " + group.count
      ];
    });
    return makeSheet("Commodity Summary", "Commodity Summary - Released Commercial Baseline", [
      column("Commodity", 24), column("Currency", 12), column("Part Count", 12, "number"), column("Supplier Count", 15, "number"),
      column("Priced Parts", 14, "number"), column("Unpriced Parts", 15, "number"), column("Piece Cost Total", 18, "currency"),
      column("Tooling Total", 16, "currency"), column("Logistics Total", 16, "currency"), column("Commodity Total", 18, "currency"),
      column("Commercial Completeness", 24)
    ], rows, revision);
  }

  function buildCommercialAssessmentSheet(revision, indexes) {
    var rows = (revision.commercialAssessmentSnapshot.lineItems || []).map(function (line) {
      var part = indexes.parts[line.partId] || {};
      var epsItem = indexes.epsItems[line.engineeringProductStructureItemId] || {};
      var module = indexes.modules[epsItem.sourceEngineeringModuleId] || fallbackModule(indexes.boms[epsItem.sourceEngineeringBomId] || {});
      var quantity = number(line.quantity || epsItem.calculatedQuantity || epsItem.quantity);
      var piece = number(line.piecePrice);
      return [
        part.commodity || part.sourceCommodityOriginal || "Unassigned Commodity", moduleLabel(module), epsItem.sourceEngineeringBomId || "",
        part.partNumber || line.partId || "", part.currentRevision || "", part.drawingNumber || "", part.drawingRevision || "",
        wrapCell(part.description || part.name || ""), quantity, line.supplier || "", line.supplierPartNumber || "",
        line.currency || "", currencyCell(piece), currencyCell(quantity * piece), currencyCell(number(line.toolingCost)),
        currencyCell(number(line.logisticsCost)), currencyCell(quantity * piece + number(line.toolingCost) + number(line.logisticsCost)),
        statusCell(line.sourcingStatus || "NOT_STARTED"), statusCell(line.commercialStatus || "NOT_STARTED"),
        line.ecnNumber || (line.ecnReferences || []).join(", "), wrapCell(line.notes || ""), line.obsolete ? "Yes" : "No",
        line.id || line.sourceCommercialLineId
      ];
    });
    commercialTotalsByCurrency(revision.commercialAssessmentSnapshot).forEach(function (total) {
      rows.push([
        "TOTAL", "", "", "", "", "", "", "Released total for " + total.currency, "", "", "", total.currency,
        "", currencyCell(total.pieceTotal), currencyCell(total.toolingTotal), currencyCell(total.logisticsTotal),
        currencyCell(total.overallTotal), "", statusCell("RELEASED"), "", "", "", ""
      ]);
    });
    return makeSheet("Commercial Assessment", "Commercial Assessment - Released Baseline", [
      column("Commodity", 22), column("Source Discipline", 20), column("Source eBOM", 28), column("Part Number", 24),
      column("Part Revision", 14), column("Drawing Number", 24), column("Drawing Revision", 16),
      column("Part Description", 42, "wrap"), column("Quantity", 12, "number"), column("Supplier", 28),
      column("Supplier Part Number", 24), column("Currency", 12), column("Piece Price", 15, "currency"),
      column("Piece Total", 15, "currency"), column("Tooling", 15, "currency"), column("Logistics", 15, "currency"),
      column("Line Total", 16, "currency"), column("Sourcing Status", 20, "status"), column("Commercial Status", 20, "status"),
      column("ECN", 20), column("Remarks", 40, "wrap"), column("Obsolete", 12), column("Commercial Line Reference", 30)
    ], rows, revision);
  }

  function buildEcnSummarySheet(revision, indexes) {
    var change = revision.engineeringChangeSnapshot || {};
    var affected = change.affectedObjects || [];
    var parts = unique(affected.filter(function (item) { return item.objectType === "PART"; }).map(function (item) {
      var part = indexes.parts[item.objectId];
      return part && part.partNumber || item.partId || item.objectId;
    }));
    var boms = unique(affected.filter(function (item) { return item.objectType === "ENGINEERING_BOM" || item.objectType === "ENGINEERING_BOM_ITEM"; }).map(function (item) {
      return item.sourceBomId || item.objectId;
    }));
    var commodities = unique((change.commodityImpact || []).map(function (impact) {
      return impact.commodity || impact.normalizedCommodity || "Unassigned Commodity";
    }));
    var deltas = (change.commercialImpactSummary && change.commercialImpactSummary.totalsByCurrency || []).map(function (total) {
      return (total.currency || "UNSPECIFIED") + " " + number(total.costDelta).toFixed(2);
    }).join(" | ");
    return makeSheet("ECN Summary", "Engineering Change Summary", [column("Field", 30), column("Value", 90, "wrap")], [
      ["ECN Number", change.changeNumber || revision.engineeringChangeId],
      ["Title", change.title || revision.title],
      ["Reason", wrapCell(change.reason || revision.notes)],
      ["Owner", change.owner || ""],
      ["Requester", change.requester || ""],
      ["Status", statusCell(change.status || "IMPLEMENTED")],
      ["Created Date", dateCell(change.createdAt)],
      ["Approved Date", dateCell(change.approvedAt)],
      ["Implemented Date", dateCell(change.implementedAt || revision.releasedAt)],
      ["Affected Parts", parts.join(", ")],
      ["Affected BOMs", boms.join(", ")],
      ["Affected Commodities", commodities.join(", ")],
      ["Cost Delta", deltas || "No cost delta"],
      ["Resulting Revision", revision.revisionNumber + " (" + revision.id + ")"]
    ], revision);
  }

  function commercialTotalsByCurrency(assessment) {
    if ((assessment.totalsByCurrency || []).length) return assessment.totalsByCurrency.map(normalizeTotal);
    var totals = {};
    activeLines(assessment).forEach(function (line) {
      var currency = line.currency || "UNSPECIFIED";
      var total = totals[currency] || (totals[currency] = { currency: currency, pieceTotal: 0, toolingTotal: 0, logisticsTotal: 0, overallTotal: 0 });
      total.pieceTotal += number(line.quantity) * number(line.piecePrice);
      total.toolingTotal += number(line.toolingCost);
      total.logisticsTotal += number(line.logisticsCost);
      total.overallTotal = total.pieceTotal + total.toolingTotal + total.logisticsTotal;
    });
    return Object.keys(totals).sort().map(function (currency) { return totals[currency]; });
  }

  function normalizeTotal(total) {
    return {
      currency: total.currency || "UNSPECIFIED",
      pieceTotal: number(total.pieceTotal !== undefined ? total.pieceTotal : total.piece),
      toolingTotal: number(total.toolingTotal !== undefined ? total.toolingTotal : total.tooling),
      logisticsTotal: number(total.logisticsTotal !== undefined ? total.logisticsTotal : total.logistics),
      overallTotal: number(total.overallTotal !== undefined ? total.overallTotal : total.total)
    };
  }

  function activeLines(assessment) {
    return (assessment && assessment.lineItems || []).filter(function (line) { return !line.obsolete; });
  }

  function lineIsComplete(line, commodity) {
    return commodity !== "Unassigned Commodity" && Boolean(line.supplier) && Boolean(line.currency) &&
      isFiniteNumber(line.piecePrice) && Boolean(line.sourcingStatus);
  }

  function normalizedCommodity(part) {
    var value = String(part && (part.commodity || part.sourceCommodityOriginal) || "").trim();
    if (!value) return "Unassigned Commodity";
    return value.replace(/\s+/g, " ").toUpperCase();
  }

  function sourceWorkbookLabel(revision) {
    return (revision.sourceWorkbookSnapshots || []).map(function (entry) {
      return entry.sourceWorkbookName || entry.workbookName || entry.workbookFingerprint;
    }).filter(Boolean).join(", ") || "Not recorded in released snapshot";
  }

  function buildFileName(revision) {
    var program = revision.programSnapshot || {};
    var variant = revision.seatVariantSnapshot || {};
    var change = revision.engineeringChangeSnapshot || {};
    var tokens = [
      program.programCode || program.code || program.name || revision.programId,
      variant.seatType || variant.seatFamily || "SEAT",
      variant.variantCode || variant.variantName || revision.seatVariantId
    ];
    if (change.changeNumber || revision.engineeringChangeId) tokens.push(change.changeNumber || revision.engineeringChangeId);
    tokens.push("REV-" + revision.revisionNumber);
    return tokens.map(fileToken).filter(Boolean).join("_") + ".xlsx";
  }

  function makeSheet(name, title, columns, rows, revision) {
    return {
      name: safeSheetName(name),
      title: title,
      subtitle: "Revision " + revision.revisionNumber + " | Released " + String(revision.releasedAt || "").replace("T", " ").replace("Z", " UTC") + " | Snapshot " + (revision.snapshotHash || "-"),
      columns: columns,
      rows: rows
    };
  }

  function column(label, width, type) {
    return { label: label, width: width, type: type || "text" };
  }

  function textCell(value, options) {
    return Object.assign({ value: value, type: "text" }, options || {});
  }

  function wrapCell(value) { return { value: value || "", type: "wrap" }; }
  function statusCell(value) { return { value: value || "", type: "status" }; }
  function classificationCell(value) { return { value: value || "", type: "classification" }; }
  function dateCell(value) { return value ? { value: value, type: "date" } : ""; }
  function numberCell(value) { return value === null || value === undefined ? "" : { value: value, type: "number" }; }
  function currencyCell(value) { return { value: number(value), type: "currency" }; }

  function createWorkbookPackage(model) {
    var Zip = typeof window !== "undefined" && window.JSZip || typeof globalThis !== "undefined" && globalThis.JSZip;
    if (!Zip) return Promise.reject(new Error("The local Excel packaging library is unavailable."));
    var zip = new Zip();
    addZipFile(zip, "[Content_Types].xml", contentTypesXml(model.sheets));
    addZipFile(zip, "_rels/.rels", rootRelationshipsXml());
    addZipFile(zip, "docProps/app.xml", appPropertiesXml(model.sheets));
    addZipFile(zip, "docProps/core.xml", corePropertiesXml(model));
    addZipFile(zip, "xl/workbook.xml", workbookXml(model.sheets));
    addZipFile(zip, "xl/_rels/workbook.xml.rels", workbookRelationshipsXml(model.sheets));
    addZipFile(zip, "xl/styles.xml", stylesXml());
    model.sheets.forEach(function (sheet, index) {
      addZipFile(zip, "xl/worksheets/sheet" + (index + 1) + ".xml", worksheetXml(sheet));
    });
    return zip.generateAsync({
      type: "uint8array",
      compression: "DEFLATE",
      compressionOptions: { level: 6 },
      platform: "DOS"
    });
  }

  function addZipFile(zip, path, content) {
    zip.file(path, content, { date: FIXED_ZIP_DATE, createFolders: false });
  }

  function worksheetXml(sheet) {
    var headerRow = 4;
    var dataStartRow = 5;
    var lastColumn = columnLetter(sheet.columns.length);
    var lastRow = Math.max(headerRow, headerRow + sheet.rows.length);
    var rows = [];
    rows.push(xmlRow(1, [textCell(sheet.title, { style: 1 })], sheet.columns, 24));
    rows.push(xmlRow(2, [textCell(sheet.subtitle, { style: 2 })], sheet.columns, 20));
    rows.push('<row r="3" ht="8" customHeight="1"/>');
    rows.push(xmlRow(headerRow, sheet.columns.map(function (entry) { return textCell(entry.label, { style: 3 }); }), sheet.columns, 34));
    sheet.rows.forEach(function (row, index) { rows.push(xmlRow(dataStartRow + index, row, sheet.columns, 20)); });
    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
      '<sheetViews><sheetView workbookViewId="0"><pane ySplit="4" topLeftCell="A5" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>' +
      '<sheetFormatPr defaultRowHeight="18"/>' + columnsXml(sheet.columns) +
      '<sheetData>' + rows.join("") + '</sheetData>' +
      (sheet.rows.length ? '<autoFilter ref="A4:' + lastColumn + lastRow + '"/>' : "") +
      '<mergeCells count="2"><mergeCell ref="A1:' + lastColumn + '1"/><mergeCell ref="A2:' + lastColumn + '2"/></mergeCells>' +
      '<pageMargins left="0.25" right="0.25" top="0.5" bottom="0.5" header="0.2" footer="0.2"/>' +
      '<pageSetup orientation="landscape" fitToWidth="1" fitToHeight="0"/>' +
      '</worksheet>';
  }

  function xmlRow(rowNumber, values, columns, height) {
    var cells = [];
    (values || []).forEach(function (input, index) {
      var column = columns[index] || {};
      cells.push(xmlCell(rowNumber, index + 1, input, column));
    });
    return '<row r="' + rowNumber + '" ht="' + height + '" customHeight="1">' + cells.join("") + '</row>';
  }

  function xmlCell(rowNumber, columnNumber, input, column) {
    var descriptor = input && typeof input === "object" && Object.prototype.hasOwnProperty.call(input, "value")
      ? input : { value: input };
    var value = descriptor.value;
    var type = descriptor.type || column.type || "text";
    var style = descriptor.style !== undefined ? descriptor.style : styleFor(type, value, descriptor.indent);
    var reference = columnLetter(columnNumber) + rowNumber;
    if (value === null || value === undefined || value === "") return '<c r="' + reference + '" s="' + style + '"/>';
    if (type === "date") {
      var serial = excelDateSerial(value);
      if (serial !== null) return '<c r="' + reference + '" s="4"><v>' + serial + '</v></c>';
    }
    if ((type === "number" || type === "currency") && isFiniteNumber(value)) {
      return '<c r="' + reference + '" s="' + style + '"><v>' + Number(value) + '</v></c>';
    }
    return '<c r="' + reference + '" s="' + style + '" t="inlineStr"><is><t xml:space="preserve">' + escapeXml(safeString(value)) + '</t></is></c>';
  }

  function styleFor(type, value, indent) {
    if (indent !== undefined) return 10 + Math.min(8, Math.max(0, Number(indent) || 0));
    if (type === "date") return 4;
    if (type === "number" || type === "currency") return 5;
    if (type === "wrap") return 8;
    if (type === "classification") {
      var classification = String(value || "").toUpperCase();
      if (classification === "DELETED") return 9;
      if (["NEW", "MODIFIED", "REPLACED"].indexOf(classification) !== -1) return 7;
      return 19;
    }
    if (type === "status") {
      var status = String(value || "").toUpperCase();
      if (GOOD_STATUSES.indexOf(status) !== -1) return 6;
      if (WARNING_STATUSES.indexOf(status) !== -1) return 7;
      return 9;
    }
    return 19;
  }

  function columnsXml(columns) {
    return '<cols>' + columns.map(function (entry, index) {
      return '<col min="' + (index + 1) + '" max="' + (index + 1) + '" width="' + Math.max(8, Math.min(70, Number(entry.width || 16))) + '" customWidth="1"/>';
    }).join("") + '</cols>';
  }

  function contentTypesXml(sheets) {
    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="xml" ContentType="application/xml"/>' +
      '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
      '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
      sheets.map(function (_, index) { return '<Override PartName="/xl/worksheets/sheet' + (index + 1) + '.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>'; }).join("") +
      '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>' +
      '<Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>' +
      '</Types>';
  }

  function rootRelationshipsXml() {
    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
      '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>' +
      '<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>' +
      '</Relationships>';
  }

  function workbookXml(sheets) {
    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
      '<bookViews><workbookView xWindow="0" yWindow="0" windowWidth="24000" windowHeight="14000"/></bookViews>' +
      '<sheets>' + sheets.map(function (sheet, index) {
        return '<sheet name="' + escapeXml(sheet.name) + '" sheetId="' + (index + 1) + '" r:id="rId' + (index + 1) + '"/>';
      }).join("") + '</sheets><calcPr calcId="191029" fullCalcOnLoad="1"/></workbook>';
  }

  function workbookRelationshipsXml(sheets) {
    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      sheets.map(function (_, index) {
        return '<Relationship Id="rId' + (index + 1) + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet' + (index + 1) + '.xml"/>';
      }).join("") +
      '<Relationship Id="rId' + (sheets.length + 1) + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>' +
      '</Relationships>';
  }

  function appPropertiesXml(sheets) {
    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">' +
      '<Application>Engineering BOM Lifecycle Platform</Application><DocSecurity>0</DocSecurity><ScaleCrop>false</ScaleCrop>' +
      '<HeadingPairs><vt:vector size="2" baseType="variant"><vt:variant><vt:lpstr>Worksheets</vt:lpstr></vt:variant><vt:variant><vt:i4>' + sheets.length + '</vt:i4></vt:variant></vt:vector></HeadingPairs>' +
      '<TitlesOfParts><vt:vector size="' + sheets.length + '" baseType="lpstr">' + sheets.map(function (sheet) { return '<vt:lpstr>' + escapeXml(sheet.name) + '</vt:lpstr>'; }).join("") + '</vt:vector></TitlesOfParts>' +
      '<Company>Engineering Portfolio</Company><LinksUpToDate>false</LinksUpToDate><SharedDoc>false</SharedDoc><HyperlinksChanged>false</HyperlinksChanged><AppVersion>1.0</AppVersion></Properties>';
  }

  function corePropertiesXml(model) {
    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:dcmitype="http://purl.org/dc/dcmitype/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">' +
      '<dc:title>Released Revision ' + escapeXml(model.revisionNumber) + '</dc:title><dc:subject>Released Engineering Product Definition</dc:subject>' +
      '<dc:creator>Engineering BOM Lifecycle Platform</dc:creator><cp:lastModifiedBy>Engineering BOM Lifecycle Platform</cp:lastModifiedBy>' +
      '<dcterms:created xsi:type="dcterms:W3CDTF">' + escapeXml(model.exportedAt) + '</dcterms:created>' +
      '<dcterms:modified xsi:type="dcterms:W3CDTF">' + escapeXml(model.exportedAt) + '</dcterms:modified>' +
      '</cp:coreProperties>';
  }

  function stylesXml() {
    var indentXfs = [];
    for (var indent = 0; indent <= 8; indent += 1) {
      indentXfs.push('<xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyAlignment="1"><alignment horizontal="left" vertical="center" indent="' + indent + '"/></xf>');
    }
    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
      '<numFmts count="2"><numFmt numFmtId="164" formatCode="yyyy-mm-dd hh:mm"/><numFmt numFmtId="165" formatCode="#,##0.00"/></numFmts>' +
      '<fonts count="3"><font><sz val="11"/><name val="Calibri"/><family val="2"/></font><font><b/><color rgb="FFFFFFFF"/><sz val="14"/><name val="Calibri"/></font><font><b/><color rgb="FF172033"/><sz val="11"/><name val="Calibri"/></font></fonts>' +
      '<fills count="7"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF243447"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFDDE7F2"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFE2F2E8"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFFFF1CC"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFF8D7DA"/><bgColor indexed="64"/></patternFill></fill></fills>' +
      '<borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border><border><left style="thin"><color rgb="FFD4DCE5"/></left><right style="thin"><color rgb="FFD4DCE5"/></right><top style="thin"><color rgb="FFD4DCE5"/></top><bottom style="thin"><color rgb="FFD4DCE5"/></bottom><diagonal/></border></borders>' +
      '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
      '<cellXfs count="20">' +
      '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>' +
      '<xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyAlignment="1"><alignment horizontal="left" vertical="center"/></xf>' +
      '<xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment horizontal="left" vertical="center"/></xf>' +
      '<xf numFmtId="0" fontId="2" fillId="3" borderId="1" xfId="0" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>' +
      '<xf numFmtId="164" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1"/>' +
      '<xf numFmtId="165" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1"/>' +
      '<xf numFmtId="0" fontId="0" fillId="4" borderId="1" xfId="0" applyAlignment="1"><alignment horizontal="center"/></xf>' +
      '<xf numFmtId="0" fontId="0" fillId="5" borderId="1" xfId="0" applyAlignment="1"><alignment horizontal="center"/></xf>' +
      '<xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>' +
      '<xf numFmtId="0" fontId="0" fillId="6" borderId="1" xfId="0" applyAlignment="1"><alignment horizontal="center"/></xf>' +
      indentXfs.join("") +
      '<xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0"/>' +
      '</cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>';
  }

  function fallbackModule(bom) {
    var value = String(bom.engineeringModuleId || bom.name || bom.id || "Engineering");
    var code = value.replace(/^.*?(STRUCTURE|FOAM|PLASTIC|TRIM|HEAD[_ -]?REST|ARM[_ -]?REST).*$/i, "$1").replace(/[ -]/g, "_").toUpperCase();
    return { id: bom.engineeringModuleId || "", moduleCode: code, code: code, name: titleCase(code) };
  }

  function moduleLabel(module) {
    return module && (module.name || titleCase(module.moduleCode || module.code || module.id)) || "System";
  }

  function sheetNameForModule(module) {
    var label = moduleLabel(module);
    if (/head\s*_?rest/i.test(label)) return "Head Rest";
    if (/arm\s*_?rest/i.test(label)) return "Arm Rest";
    return safeSheetName(label);
  }

  function releaseInformation(part, bom) {
    var fields = [part.lifecycleStatus || "", part.releasedAt || "", bom.completionStatus || ""];
    return fields.filter(Boolean).join(" | ");
  }

  function compareSequence(left, right) {
    var sequence = number(left.sequence) - number(right.sequence);
    return sequence || String(left.id || left.childPartId || "").localeCompare(String(right.id || right.childPartId || ""));
  }

  function displayValue(value) {
    if (value === true || String(value).toUpperCase() === "YES" || String(value).toUpperCase() === "TRUE") return "Yes";
    if (value === false || String(value).toUpperCase() === "NO" || String(value).toUpperCase() === "FALSE") return "No";
    return value === null || value === undefined ? "" : value;
  }

  function indexBy(collection, key) {
    var result = {};
    (collection || []).forEach(function (item) { if (item && item[key]) result[item[key]] = item; });
    return result;
  }

  function unique(values) {
    var seen = {};
    return (values || []).filter(function (value) {
      var key = String(value || "");
      if (!key || seen[key]) return false;
      seen[key] = true;
      return true;
    });
  }

  function issue(code, message) { return { code: code, message: message, objectType: "REVISION_EXPORT" }; }
  function number(value) { return isFiniteNumber(value) ? Number(value) : 0; }
  function nullableNumber(value) { return isFiniteNumber(value) ? Number(value) : null; }
  function isFiniteNumber(value) { return value !== null && value !== undefined && value !== "" && isFinite(Number(value)); }

  function excelDateSerial(value) {
    var time = Date.parse(value);
    if (!isFinite(time)) return null;
    return Number((time / 86400000 + 25569).toFixed(8));
  }

  function columnLetter(value) {
    var result = "";
    while (value > 0) {
      value -= 1;
      result = String.fromCharCode(65 + (value % 26)) + result;
      value = Math.floor(value / 26);
    }
    return result || "A";
  }

  function fileToken(value) {
    return String(value || "").trim().replace(/[^A-Za-z0-9+.-]+/g, "-").replace(/^-+|-+$/g, "");
  }

  function safeSheetName(value) {
    return String(value || "Sheet").replace(/[\\\/?*\[\]:]/g, " ").trim().slice(0, 31) || "Sheet";
  }

  function safeString(value) { return String(value === null || value === undefined ? "" : value).slice(0, 32767); }
  function escapeXml(value) { return String(value || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;"); }
  function titleCase(value) { return String(value || "").replace(/_/g, " ").toLowerCase().replace(/\b\w/g, function (letter) { return letter.toUpperCase(); }); }
  function clone(value) { return JSON.parse(JSON.stringify(value == null ? null : value)); }

  app.domain.revisionExcelExportService = {
    MIME_TYPE: MIME_TYPE,
    listReleasedRevisions: listReleasedRevisions,
    getRevisionExportReadiness: getRevisionExportReadiness,
    validateRevisionSnapshot: validateRevisionSnapshot,
    buildRevisionWorkbookModel: buildRevisionWorkbookModel,
    buildWorkbookModelFromRevision: buildWorkbookModelFromRevision,
    generateRevisionWorkbook: generateRevisionWorkbook,
    downloadReleasedRevision: downloadReleasedRevision,
    buildFileName: buildFileName
  };
})(typeof window !== "undefined" ? (window.DEP = window.DEP || {}) : (globalThis.DEP = globalThis.DEP || {}));
