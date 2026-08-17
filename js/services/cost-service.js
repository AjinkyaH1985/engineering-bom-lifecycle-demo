(function (app) {
  app.services = app.services || {};

  app.services.costService = {
    listCosts: function () {
      var assessment = getAssessment();
      return assessment ? assessment.lineItems : [];
    },
    calculateConfiguredSeatCost: function (state) {
      var assessment = getAssessment();
      if (!assessment) {
        return {
          config: state.activeConfiguredSeat || {},
          assessment: null,
          lines: [],
          commodityTotals: [],
          summary: getSummary([])
        };
      }
      return calculateFromAssessment(state, assessment);
    }
  };

  function getAssessment() {
    if (!app.domain || !app.domain.commercialAssessmentService) return null;
    return app.domain.commercialAssessmentService.getCommercialAssessmentForContext();
  }

  function calculateFromAssessment(state, assessment) {
    var impactsByLineId = {};
    (state.engineeringChanges || []).forEach(function (change) {
      if (change.programId !== assessment.programId || change.seatVariantId !== assessment.seatVariantId) return;
      (change.commodityImpact || []).forEach(function (impact) {
        if (!impact.commercialLineId) return;
        impactsByLineId[impact.commercialLineId] = impactsByLineId[impact.commercialLineId] || [];
        impactsByLineId[impact.commercialLineId].push({ change: change, impact: impact });
      });
    });
    var lines = (assessment.lineItems || []).map(function (line) {
      var snapshot = line.sourcePartSnapshot || {};
      var quantity = toNumber(line.quantity || 1);
      var piecePrice = toNumber(line.piecePrice);
      var toolingCost = toNumber(line.toolingCost);
      var logisticsCost = toNumber(line.logisticsCost);
      var impacts = impactsByLineId[line.id] || [];
      var activeImpact = impacts.find(function (entry) {
        return ["APPROVED", "IMPLEMENTING"].indexOf(entry.change.status) !== -1;
      }) || impacts[0] || null;
      return {
        id: line.id,
        engineeringProductStructureItemId: line.engineeringProductStructureItemId,
        partNumber: snapshot.partNumber || line.partId,
        internalPartNumber: snapshot.internalPartNumber || snapshot.partNumber || line.partId,
        oemPartNumber: snapshot.oemPartNumber || "",
        description: snapshot.description || snapshot.name || "",
        category: snapshot.category || "",
        revision: snapshot.revision || "",
        drawingNumber: snapshot.drawingNumber || "",
        drawingRevision: snapshot.drawingRevision || "",
        imageReference: snapshot.imageReference || "",
        changeClassification: snapshot.changeClassification || line.changeClassification || "",
        commodity: snapshot.commodity || "Other",
        material: snapshot.material || "",
        gauge: snapshot.gauge || "",
        quantity: quantity,
        unitQuantity: quantity,
        supplier: line.supplier || "",
        supplierId: line.supplierId || "",
        supplierPartNumber: line.supplierPartNumber || "",
        commodityManager: line.commodityManager || "",
        sta: line.sta || "",
        poNumber: line.poNumber || "",
        poType: line.poType || "",
        poQuantity: line.poQuantity || quantity,
        scheduleGiven: line.scheduleGiven || "",
        quotation: line.quotation || "",
        currency: line.currency || "INR",
        piecePrice: piecePrice,
        unitCost: piecePrice,
        extendedCost: quantity * piecePrice,
        toolingCost: toolingCost,
        toolCost: toolingCost,
        logisticsCost: logisticsCost,
        sourcingStatus: line.sourcingStatus || "NOT_SOURCED",
        commercialStatus: line.commercialStatus || line.sourcingStatus || "NOT_STARTED",
        ecnNumber: impacts.map(function (entry) { return entry.change.changeNumber || entry.change.ecnNumber; }).join(", "),
        ecnStatus: impacts.map(function (entry) { return entry.change.status; }).join(", "),
        ecnImpactStatus: activeImpact && activeImpact.impact.impactStatus || "NOT_IMPACTED",
        previousUnitRate: activeImpact && activeImpact.impact.previousUnitRate != null ? activeImpact.impact.previousUnitRate : piecePrice,
        costDelta: activeImpact && activeImpact.impact.costDelta != null ? activeImpact.impact.costDelta : 0,
        activeEngineeringChangeId: activeImpact && ["APPROVED", "IMPLEMENTING"].indexOf(activeImpact.change.status) !== -1 ? activeImpact.change.id : "",
        notes: line.notes || "",
        remarks: line.notes || "",
        obsolete: Boolean(line.obsolete),
        sourceWorkspace: "Engineering Product Structure",
        updatedAt: line.updatedAt || "",
        updatedBy: line.updatedBy || ""
      };
    });
    return {
      config: state.activeConfiguredSeat || {},
      assessment: assessment,
      lines: lines,
      commodityTotals: getCommodityTotals(lines),
      summary: getSummary(lines)
    };
  }

  function getCommodityTotals(lines) {
    var totals = {};
    lines.forEach(function (line) {
      if (line.obsolete) return;
      if (!totals[line.commodity]) {
        totals[line.commodity] = { commodity: line.commodity, partCount: 0, subtotal: 0 };
      }
      totals[line.commodity].partCount += 1;
      totals[line.commodity].subtotal += line.extendedCost;
    });
    return Object.keys(totals).sort().map(function (commodity) {
      return totals[commodity];
    });
  }

  function getSummary(lines) {
    var suppliers = {};
    var totalPartCost = 0;
    var totalToolCost = 0;
    var totalLogisticsCost = 0;
    var pricedPartCount = 0;
    var unpricedPartCount = 0;
    lines.forEach(function (line) {
      if (line.obsolete) return;
      totalPartCost += line.extendedCost;
      totalToolCost += toNumber(line.toolingCost || line.toolCost);
      totalLogisticsCost += toNumber(line.logisticsCost);
      if (line.supplier) suppliers[line.supplier] = true;
      if (toNumber(line.unitCost || line.piecePrice) > 0) pricedPartCount += 1;
      else unpricedPartCount += 1;
    });
    return {
      totalPartCost: totalPartCost,
      totalToolCost: totalToolCost,
      totalLogisticsCost: totalLogisticsCost,
      overallTotal: totalPartCost + totalToolCost + totalLogisticsCost,
      supplierCount: Object.keys(suppliers).length,
      pricedPartCount: pricedPartCount,
      unpricedPartCount: unpricedPartCount,
      feasibilityStatus: unpricedPartCount ? "Open" : "Costed"
    };
  }

  function toNumber(value) {
    var number = Number(value);
    return isNaN(number) ? 0 : number;
  }
})(window.DEP = window.DEP || {});
