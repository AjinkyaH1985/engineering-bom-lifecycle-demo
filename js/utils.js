(function (app) {
  app.utils = {
    clone: function (value) {
      return JSON.parse(JSON.stringify(value));
    },
    createId: function (prefix) {
      return prefix + "-" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
    },
    formatDate: function (value) {
      if (!value) return "";
      return new Date(value).toLocaleDateString();
    },
    escapeHtml: function (value) {
      return String(value == null ? "" : value)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
    },
    byId: function (id) {
      return document.getElementById(id);
    },
    workspaceLabel: function (workspaceId) {
      var labels = {
        program: "Programme and Finished-Good Variant",
        "feature-matrix": "Feature Matrix",
        "complete-seat": "Complete Seat JIT",
        structure: "Structure Engineering",
        foam: "Foam Engineering",
        plastic: "Plastic Engineering",
        trim: "Trim Engineering",
        headrest: "Head Rest Engineering",
        armrest: "Arm Rest Engineering",
        "commodity-management": "Commodity Management",
        "commodity-mapping": "Commodity Mapping",
        "bom-cost": "Commercial Assessment",
        suppliers: "Suppliers",
        revision: "Revision History",
        "engineering-change": "Engineering Change",
        "admin-master-data": "Admin Master Data"
      };
      return labels[workspaceId] || statusLabel(workspaceId || "Program");
    },
    renderStatusBadge: function (status, title) {
      var value = String(status || "Unknown");
      var normalized = value.toLowerCase().replace(/[\s_]+/g, "-");
      return '<span class="status-badge status-' + app.utils.escapeHtml(normalized) + '"' +
        (title ? ' title="' + app.utils.escapeHtml(title) + '"' : "") + '>' +
        app.utils.escapeHtml(statusLabel(value)) + '</span>';
    },
    renderWorkspaceHeader: function (options) {
      options = options || {};
      var state = app.state && app.state.get ? app.state.get() : {};
      var program = state.program || {};
      var variant = state.variant || {};
      var context = options.showContext === false ? [] : [renderContextSelectors(state)];
      if (options.status) context.push('<span class="workspace-meta-item">Status ' + app.utils.renderStatusBadge(options.status, options.statusTitle) + '</span>');
      if (options.nextStep) context.push(metaItem("Next", options.nextStep));
      return [
        '<div class="workspace-header">',
        '<div class="workspace-title">',
        '<h1 title="' + app.utils.escapeHtml(options.title || "") + '">' + app.utils.escapeHtml(options.title || "") + '</h1>',
        '<span>' + app.utils.escapeHtml(options.purpose || options.subtitle || "") + '</span>',
        '<div class="workspace-meta">' + context.join("") + '</div>',
        '</div>',
        app.components.toolbar.render(options.actions || []),
        '</div>'
      ].join("");
    },
    bindWorkspaceHeaderContext: function (container) {
      var programSelect = container.querySelector("[data-context-program]");
      var customerSelect = container.querySelector("[data-context-customer]");
      var seatTypeSelect = container.querySelector("[data-context-seat-type]");
      var variantSelect = container.querySelector("[data-context-variant]");
      var variantSearch = container.querySelector("[data-context-variant-search]");
      var boundState = app.state.get();
      var boundVariant = boundState.variant || {};
      var boundCustomer = boundVariant.customer || boundVariant.brand || "";
      var boundSeatType = boundVariant.seatType || boundVariant.seatFamily || "";
      if (programSelect) {
        programSelect.onchange = function () {
          var programId = programSelect.value || null;
          requestContextTransition("programme", function () {
            var variants = app.domain.seatVariantService.getSeatVariants(programId);
            app.core.contextService.setActiveBusinessContext({
              programId: programId,
              seatVariantId: variants[0] && variants[0].id || null
            });
            finishBusinessContextChange();
          }, function () { programSelect.value = app.core.contextService.getContext().activeProgramId || ""; });
        };
      }
      if (customerSelect) {
        customerSelect.onchange = function () {
          requestContextTransition("customer", function () {
            setFirstVariantMatching({ customer: customerSelect.value || null, seatType: null });
          }, function () { customerSelect.value = boundCustomer; });
        };
      }
      if (seatTypeSelect) {
        seatTypeSelect.onchange = function () {
          requestContextTransition("seat-type", function () {
            setFirstVariantMatching({ seatType: seatTypeSelect.value || null });
          }, function () { seatTypeSelect.value = boundSeatType; });
        };
      }
      if (variantSelect) {
        variantSelect.onchange = function () {
          var variantId = variantSelect.value || null;
          requestContextTransition("finished-good-variant", function () {
            app.core.contextService.setActiveBusinessContext({
              programId: app.core.contextService.getContext().activeProgramId,
              seatVariantId: variantId
            });
            finishBusinessContextChange();
          }, function () { variantSelect.value = app.core.contextService.getContext().activeSeatVariantId || ""; });
        };
      }
      if (variantSearch && variantSelect) bindVariantSearch(variantSearch, variantSelect);
    },
    renderEmptyState: function (title, message, nextStep) {
      return '<div class="empty-state"><strong>' + app.utils.escapeHtml(title || "No data available") +
        '</strong><span>' + app.utils.escapeHtml(message || "") + '</span>' +
        (nextStep ? '<em>' + app.utils.escapeHtml(nextStep) + '</em>' : "") + '</div>';
    },
    renderPartPreviewButton: function (part, key) {
      part = part || {};
      var previewKey = key || part.id || part.partId || part.partNumber || "";
      var hasImage = Boolean(part.imageReference);
      return '<button type="button" class="part-preview-button ' + (hasImage ? "has-image" : "no-image") +
        '" data-part-preview="' + app.utils.escapeHtml(previewKey) + '" aria-label="' +
        app.utils.escapeHtml("Open part image preview for " + (part.partNumber || part.description || "part")) + '">' +
        (hasImage
          ? partImageMarkup(part.imageReference, "", "")
          : '<span class="part-preview-placeholder" aria-hidden="true">IMG</span>') +
        '</button>';
    },
    bindPartPreviewButtons: function (container, resolvePart) {
      hydratePartImages(container);
      container.querySelectorAll("[data-part-preview]").forEach(function (button) {
        button.onclick = function (event) {
          event.stopPropagation();
          var part = resolvePart(button.getAttribute("data-part-preview"));
          if (part) app.utils.openPartImagePreview(part);
        };
      });
    },
    openPartImagePreview: function (part) {
      part = part || {};
      var image = part.imageReference
        ? partImageMarkup(part.imageReference, "part-preview-large-image", part.partNumber || "Part image")
        : '<div class="part-preview-large-placeholder">No image reference</div>';
      app.components.modal.open("Part Image", [
        '<div class="part-preview-modal">',
        '<div class="part-preview-large">' + image + '</div>',
        '<table class="part-preview-details"><tbody>',
        previewDetail("Part Number", part.partNumber),
        previewDetail("Part Description", part.description || part.name),
        previewDetail("Part Revision", part.revision || part.currentRevision),
        previewDetail("Drawing Number", part.drawingNumber),
        previewDetail("Drawing Revision", part.drawingRevision),
        previewDetail("Commodity", part.commodity),
        previewDetail("Material", part.material),
        '</tbody></table>',
        '</div>'
      ].join(""));
      hydratePartImages(app.utils.byId("modal-root"));
    },
    openCompleteSeatImagePreview: function (completeSeat) {
      completeSeat = completeSeat || {};
      var image = completeSeat.imageReference
        ? partImageMarkup(completeSeat.imageReference, "part-preview-large-image complete-seat-preview-large-image", "Complete Seat image")
        : '<div class="part-preview-large-placeholder">No Complete Seat image reference</div>';
      app.components.modal.open("Complete Seat Image", [
        '<div class="part-preview-modal complete-seat-preview-modal">',
        '<div class="part-preview-large">' + image + '</div>',
        '<table class="part-preview-details"><tbody>',
        previewDetail("Programme", completeSeat.programme),
        previewDetail("Customer / OEM", completeSeat.customer),
        previewDetail("Seat Type", completeSeat.seatType),
        previewDetail("Finished-Good Variant", completeSeat.finishedGoodVariant),
        previewDetail("Side", completeSeat.side),
        previewDetail("Grade", completeSeat.grade),
        previewDetail("Trim Material", completeSeat.trimMaterial),
        previewDetail("Revision", completeSeat.revision),
        previewDetail("Generation Status", completeSeat.generationStatus),
        previewDetail("Generated", completeSeat.generatedAt),
        '</tbody></table>',
        '</div>'
      ].join(""));
      hydratePartImages(app.utils.byId("modal-root"));
    },
    renderWorkspaceShell: function (config, rows) {
      var table = app.components.table.render(config.columns, rows);
      return app.utils.renderWorkspaceHeader({
        title: config.title,
        purpose: config.subtitle,
        status: config.status,
        nextStep: config.nextStep,
        actions: config.actions || []
      }) + '<div class="workspace-body">' + table + '</div>';
    },
    bindWorkspaceRows: function (container, rows, type, owner) {
      container.querySelectorAll("[data-row-id]").forEach(function (rowEl) {
        rowEl.onclick = function () {
          var row = rows.find(function (item) {
            return item.id === rowEl.getAttribute("data-row-id");
          });
          if (!row) return;
          container.querySelectorAll("tr.selected").forEach(function (selected) {
            selected.classList.remove("selected");
          });
          rowEl.classList.add("selected");
          app.state.setSelection({
            type: type,
            id: row.id,
            name: row.name || row.description,
            status: row.status || "Planned",
            owner: owner,
            revision: row.revision || app.state.get().currentRevision,
            lastModified: row.lastModified || "2026-07-23"
          });
        };
      });
    },
    createEngineeringWorkspace: function (config) {
      var expandedNodeIds = [];
      var allRows = [];
      var visibleRows = [];
      var rowsByParent = {};
      var currentBom = null;
      var currentSelection = null;
      var currentContextValid = false;
      var completionFeedback = null;
      var feedbackBomId = null;
      var searchTimer = null;
      var searchTerm = "";

      return {
        render: function (state) {
          expandedNodeIds = ((state.engineeringWorkspaceViews[config.moduleKey] || {}).expandedNodeIds || []).slice();
          allRows = state[config.moduleKey] || [];
          currentBom = (state.engineeringBomContexts || {})[config.moduleKey] || null;
          currentSelection = state.currentSelection && state.currentSelection.workspace === config.moduleKey ? state.currentSelection : null;
          currentContextValid = Boolean(state.program && state.program.id && state.variant && state.variant.id);
          if (feedbackBomId && (!currentBom || currentBom.id !== feedbackBomId)) completionFeedback = null;
          feedbackBomId = currentBom && currentBom.id || null;
          rowsByParent = indexRowsByParent(allRows);
          visibleRows = buildVisibleRows(allRows, expandedNodeIds);
          return renderWorkspace(config, visibleRows, state);
        },
        afterRender: function (container) {
          bindRows(container);
          bindToggles(container);
          bindChangeClassificationControls(container);
          bindActions(container);
        }
      };

      function renderWorkspace(workspaceConfig, rows, state) {
        var hasRows = allRows.length > 0;
        var selectedRow = getWorkspaceSelection(workspaceConfig);
        var hasExpandableRows = Object.keys(rowsByParent).some(function (parentId) { return parentId !== "__ROOT__" && rowsByParent[parentId].length; });
        return [
          app.utils.renderWorkspaceHeader({
            title: workspaceConfig.title + " Engineering",
            purpose: "",
            status: getBomStatus(rows),
            actions: getEngineeringActions(workspaceConfig, hasRows, selectedRow)
          }),
          '<div class="workspace-body">',
          '<div class="placeholder-panel" data-engineering-workspace="' + app.utils.escapeHtml(workspaceConfig.moduleKey) + '"' +
            (currentBom ? ' data-engineering-bom-id="' + app.utils.escapeHtml(currentBom.id) + '" data-engineering-module-id="' + app.utils.escapeHtml(currentBom.engineeringModuleId) + '" data-engineering-row-count="' + allRows.length + '"' : '') + '>',
          workspaceConfig.allowEditing ? renderEditor(workspaceConfig) : "",
          renderCompletionFeedback(),
          hasRows ? '<div class="table-toolbar"><input type="search" placeholder="Search ' + app.utils.escapeHtml(workspaceConfig.title.toLowerCase()) + '" data-engineering-filter>' +
            (hasExpandableRows ? '<div class="hierarchy-actions" role="group" aria-label="Hierarchy display">' +
              '<button type="button" data-action="expand" title="Show every hierarchy level"><span aria-hidden="true">+</span> Expand All</button>' +
              '<button type="button" data-action="collapse" title="Show only top-level assemblies"><span aria-hidden="true">-</span> Collapse All</button>' +
              '</div>' : '') +
            '</div>' : '',
          '<table class="engineering-table engineering-bom-table">',
          '<thead><tr><th>Hierarchy / ASM Level</th><th>Preview</th><th>Part Number</th><th>Part Rev</th><th>Drawing Number</th><th>Dwg Rev</th>',
          '<th>Part Description</th><th>Commodity</th><th>Material</th><th>Gauge</th><th>Unit Qty</th><th>CAD Weight</th>',
          '<th>Total CAD Weight</th><th>Change Class</th><th>Remark</th><th>3D Shared</th><th>2D Shared</th><th>Status</th></tr></thead>',
          '<tbody>',
          rows.length ? rows.map(renderRow).join("") : '<tr><td colspan="18">' + renderEngineeringEmptyState() + '</td></tr>',
          '</tbody></table></div></div>'
        ].join("");
      }

      function getEngineeringActions(workspaceConfig, hasRows, selectedRow) {
        if (!workspaceConfig.allowEditing) return [];
        var actions = [{ id: "add", label: "Add Part", primary: true }];
        if (hasRows && shouldShowComplete()) {
          actions.push({ id: "complete", label: "Complete eBOM" });
        }
        if (!selectedRow) return actions;
        if (selectedRow.type === "Assembly") {
          actions.push({ id: "add-child", label: "Add Child" });
        }
        actions.push({ id: "edit", label: "Edit" });
        if (selectedRow.parentId) {
          actions.push({ id: "remove", label: "Remove", destructive: true });
        }
        return actions;
      }

      function shouldShowComplete() {
        return allRows.length > 0 && currentBom && currentBom.completionStatus !== "COMPLETE";
      }

      function getWorkspaceSelection(workspaceConfig) {
        if (!currentSelection || currentSelection.workspace !== workspaceConfig.moduleKey) return null;
        return allRows.find(function (row) {
          return row.id === currentSelection.rowId;
        }) || null;
      }

      function renderEngineeringEmptyState() {
        if (!currentContextValid) {
          return app.utils.renderEmptyState("Context required", "Select a Programme and Finished-Good Variant before authoring this eBOM.");
        }
        return app.utils.renderEmptyState("No parts in this eBOM.", "");
      }

      function renderGuidance(workspaceConfig, rows) {
        var hasReleasedRows = rows.some(function (row) { return row.status === "Released"; });
        return '<div class="workspace-guidance">' +
          '<strong>' + app.utils.escapeHtml(workspaceConfig.title) + ' ownership:</strong> ' +
          '<span>Engineering authors this module BOM. Commercial and Complete Seat consume it as read-only source data.</span>' +
          (hasReleasedRows ? '<span>' + app.utils.renderStatusBadge("Released", "Released rows are locked and require an approved Engineering Change.") + '</span>' : '') +
          '</div>';
      }

      function getBomStatus(rows) {
        if (currentBom && currentBom.lifecycleState === "RELEASED") return "Released";
        if (currentBom && currentBom.completionStatus === "COMPLETE") return "Complete";
        if (!rows.length) return "Not Started";
        return "In Progress";
      }

      function renderEditor(workspaceConfig) {
        return [
          '<form class="inline-editor" data-engineering-editor hidden>',
          '<input type="hidden" data-field="mode" value="add">',
          '<input type="hidden" data-field="id">',
          '<label>Part Number<input type="text" data-field="partNumber" required></label>',
          '<label>Part Description<input type="text" data-field="description" required></label>',
          '<label>Part Rev<input type="text" data-field="revision" value="A.01" required></label>',
          '<label>Drawing Number<input type="text" data-field="drawingNumber"></label>',
          '<label>Dwg Rev<input type="text" data-field="drawingRevision"></label>',
          '<label>Commodity<input type="text" data-field="commodity"></label>',
          '<label>Material<input type="text" data-field="material"></label>',
          '<label>Gauge<input type="text" data-field="gauge"></label>',
          '<label>Unit Qty<input type="text" data-field="quantity" value="1" required></label>',
          '<label>CAD Weight<input type="text" data-field="cadWeight"></label>',
          '<label>Image Reference<input type="text" data-field="imageReference" placeholder="assets/portfolio/part-image.svg"></label>',
          '<label>Change Class<select data-field="changeClassification"><option value="NEW">New</option><option value="CARRY_OVER">Carry Over</option><option value="DELETED">Deleted</option></select></label>',
          '<label>Remark<input type="text" data-field="remark"></label>',
          '<label>Status<select data-field="status"><option>In Work</option><option>Released</option><option>Planned</option></select></label>',
          '<button type="submit" class="primary">Apply</button>',
          '<button type="button" data-action="cancel-edit">Cancel</button>',
          '</form>'
        ].join("");
      }

      function renderRow(row) {
        var expanded = expandedNodeIds.indexOf(row.id) !== -1;
        var selectedClass = currentSelection && currentSelection.workspace === config.moduleKey && currentSelection.rowId === row.id ? ' class="selected"' : '';
        var toggle = row.hasChildren
          ? '<button type="button" class="tree-toggle" data-toggle-node="' + app.utils.escapeHtml(row.id) + '">' + (expanded ? "-" : "+") + '</button>'
          : '<span class="tree-spacer"></span>';
        return [
          '<tr data-engineering-node="' + app.utils.escapeHtml(row.id) + '"' + selectedClass + '>',
          '<td><div class="tree-cell" style="padding-left:' + (row.level * 18) + 'px">' + toggle +
            '<span title="' + app.utils.escapeHtml(row.type + " level " + String(row.level || 0)) + '">' +
            app.utils.escapeHtml(row.description || row.partNumber) + '</span></div></td>',
          '<td class="preview-cell">' + app.utils.renderPartPreviewButton(row, row.id) + '</td>',
          '<td>' + app.utils.escapeHtml(row.partNumber) + '</td>',
          '<td>' + app.utils.escapeHtml(row.revision) + '</td>',
          '<td>' + app.utils.escapeHtml(row.drawingNumber || "") + '</td>',
          '<td>' + app.utils.escapeHtml(row.drawingRevision || "") + '</td>',
          '<td>' + app.utils.escapeHtml(row.description) + '</td>',
          '<td>' + app.utils.escapeHtml(row.commodity || "") + '</td>',
          '<td>' + app.utils.escapeHtml(row.material) + '</td>',
          '<td>' + app.utils.escapeHtml(row.gauge || "") + '</td>',
          '<td>' + app.utils.escapeHtml(row.quantity) + '</td>',
          '<td>' + app.utils.escapeHtml(row.cadWeight || row.weight || "") + '</td>',
          '<td>' + app.utils.escapeHtml(row.totalCadWeight || "") + '</td>',
          '<td class="change-classification-cell">' + renderChangeClassificationControl(row) + '</td>',
          '<td>' + app.utils.escapeHtml(row.remark || "") + '</td>',
          '<td>' + app.utils.escapeHtml(row.threeDSharedDate || "") + '</td>',
          '<td>' + app.utils.escapeHtml(row.twoDSharedDate || "") + '</td>',
          '<td>' + app.utils.escapeHtml(row.status) + '</td>',
          '</tr>'
        ].join("");
      }

      function buildVisibleRows(rows, expandedIds) {
        return walkRows(null, 0, expandedIds);
      }

      function indexRowsByParent(rows) {
        var index = {};
        (rows || []).forEach(function (row) {
          var key = row.parentId || "__ROOT__";
          index[key] = index[key] || [];
          index[key].push(row);
        });
        return index;
      }

      function walkRows(parentId, level, expandedIds) {
        var visible = [];
        var siblings = rowsByParent[parentId || "__ROOT__"] || [];
        siblings.forEach(function (row) {
          var children = rowsByParent[row.id] || [];
          visible.push(Object.assign({}, row, {
            level: level,
            hasChildren: children.length > 0
          }));
          if (children.length && expandedIds.indexOf(row.id) !== -1) {
            visible = visible.concat(walkRows(row.id, level + 1, expandedIds));
          }
        });
        return visible;
      }

      function bindRows(container) {
        container.querySelectorAll("[data-engineering-node]").forEach(function (rowEl) {
          rowEl.onclick = function (event) {
            if (event && event.target && event.target.closest && event.target.closest("[data-change-classification]")) return;
            var row = findRow(rowEl.getAttribute("data-engineering-node"));
            if (!row) return;
            markSelected(container, rowEl);
            app.state.setSelection({
              workspace: config.moduleKey,
              rowId: row.id,
              type: row.type,
              id: row.partNumber,
              name: row.description,
              status: row.status,
              owner: config.owner,
              revision: row.revision,
              drawingNumber: row.drawingNumber,
              drawingRevision: row.drawingRevision,
              material: row.material,
              commodity: row.commodity,
              gauge: row.gauge,
              quantity: row.quantity,
              weight: row.cadWeight || row.weight,
              totalCadWeight: row.totalCadWeight,
              changeClassification: row.changeClassification,
              lastModified: "2026-07-23",
              remarks: row.remark || (row.type === "Assembly" ? "Engineering assembly node" : "Engineering BOM part")
            });
            if (config.allowEditing) {
              container.dataset.selectedEngineeringNode = row.id;
            }
            app.router.render();
          };
        });
        app.utils.bindPartPreviewButtons(container, function (rowId) {
          return allRows.find(function (row) { return row.id === rowId; }) || visibleRows.find(function (row) { return row.id === rowId; });
        });
      }

      function bindToggles(container) {
        container.querySelectorAll("[data-toggle-node]").forEach(function (button) {
          button.onclick = function (event) {
            event.stopPropagation();
            toggleExpanded(button.getAttribute("data-toggle-node"));
            app.state.setEngineeringWorkspaceView(config.moduleKey, { expandedNodeIds: expandedNodeIds });
            app.router.render();
          };
        });
      }

      function bindChangeClassificationControls(container) {
        var table = container.querySelector(".engineering-bom-table");
        if (!table) return;
        table.onchange = function (event) {
          var control = event.target && event.target.closest ? event.target.closest("[data-change-classification]") : null;
          if (!control) return;
          updateChangeClassification(control);
        };
      }

      function updateChangeClassification(control) {
        var rowId = control.getAttribute("data-change-classification");
        var row = allRows.find(function (item) { return item.id === rowId; });
        if (!row || !row.bomItemId || !currentBom) return;
        var previousValue = normalizeEditableChangeClassification(row.changeClassification);
        var nextValue = normalizeEditableChangeClassification(control.value);
        if (previousValue === nextValue) return;
        control.disabled = true;
        try {
          app.domain.engineeringDisciplineService.updateModuleBomItem(
            moduleCodeFromKey(config.moduleKey),
            currentBom.id,
            row.bomItemId,
            { changeClassification: nextValue },
            resolveEngineeringChangeOptions(row, currentBom)
          );
          app.events.emit("engineering-module:saved", {
            moduleKey: config.moduleKey,
            bomId: currentBom.id,
            bomItemId: row.bomItemId,
            changedFields: ["changeClassification"]
          });
          app.services.notificationService.notify(
            "Change Classification updated to " + changeClassificationLabel(nextValue) + " for " + (row.partNumber || row.description) + ".",
            "success"
          );
          app.router.render();
        } catch (error) {
          control.value = previousValue;
          control.disabled = false;
          app.services.notificationService.notify(
            businessMessage(error, "Change Classification could not be updated."),
            "warning"
          );
        }
      }

      function bindActions(container) {
        bindAction(container, "add", function () {
          openEditor(container, "add");
        });
        bindAction(container, "add-child", function () {
          openEditor(container, "add-child");
        });
        bindAction(container, "edit", function () {
          openEditor(container, "edit");
        });
        bindAction(container, "remove", function () {
          removeSelectedRow(container);
        });
        bindAction(container, "complete", function (event) {
          var button = event && event.currentTarget;
          if (button) button.disabled = true;
          try {
            if (!currentBom) throw new app.core.errors.BusinessOperationError("The selected Engineering eBOM was not found.", []);
            app.domain.engineeringDisciplineService.completeModuleBom(
              moduleCodeFromKey(config.moduleKey),
              currentBom.id,
              resolveEngineeringChangeOptions(getWorkspaceSelection(config), currentBom)
            );
            completionFeedback = { tone: "success", message: config.title + " eBOM completed successfully.", errors: [] };
            app.services.notificationService.notify(completionFeedback.message, "success");
            app.events.emit("engineering-module:saved", { moduleKey: config.moduleKey, bomId: currentBom.id, completionStatus: "COMPLETE" });
          } catch (error) {
            var errors = (error && (error.validationErrors || error.errors)) || [];
            completionFeedback = {
              tone: "warning",
              message: config.title + " eBOM cannot be completed. " + errors.length + " validation issue" + (errors.length === 1 ? "" : "s") + " require correction.",
              errors: errors
            };
            app.services.notificationService.notify(businessMessage(error, completionFeedback.message), "warning");
          }
          app.router.render();
        });
        bindAction(container, "refresh", function () {
          app.router.render();
          app.services.notificationService.notify(config.title + " refreshed", "info");
        });
        bindAction(container, "expand", function () {
          expandedNodeIds = allRows.filter(function (row) {
            return Boolean(rowsByParent[row.id] && rowsByParent[row.id].length);
          }).map(function (row) {
            return row.id;
          });
          app.state.setEngineeringWorkspaceView(config.moduleKey, { expandedNodeIds: expandedNodeIds });
          app.router.render();
        });
        bindAction(container, "collapse", function () {
          expandedNodeIds = [];
          app.state.setEngineeringWorkspaceView(config.moduleKey, { expandedNodeIds: expandedNodeIds });
          app.router.render();
        });
        bindAction(container, "search", function () {
          filterRows(container);
        });
        var filterInput = container.querySelector("[data-engineering-filter]");
        if (filterInput) {
          filterInput.oninput = function () {
            clearTimeout(searchTimer);
            searchTimer = setTimeout(function () { filterRows(container); }, 120);
          };
        }
        bindEditor(container);
      }

      function bindAction(container, actionId, handler) {
        var button = container.querySelector('[data-action="' + actionId + '"]');
        if (button) {
          button.onclick = handler;
        }
      }

      function businessMessage(error, fallback) {
        var errors = error && (error.validationErrors || error.errors) || [];
        var detail = errors[0] && errors[0].message;
        return detail || (error && error.message) || fallback;
      }

      function renderCompletionFeedback() {
        if (!completionFeedback) return "";
        var errors = completionFeedback.errors || [];
        var rowsByBomItemId = {};
        allRows.forEach(function (row) {
          if (row.bomItemId) rowsByBomItemId[row.bomItemId] = row;
        });
        return '<div class="validation-summary engineering-completion-feedback ' + app.utils.escapeHtml(completionFeedback.tone || "warning") + '" data-engineering-validation>' +
          '<strong>' + app.utils.escapeHtml(completionFeedback.message) + '</strong>' +
          (errors.length ? '<ul>' + errors.slice(0, 8).map(function (error) {
            var row = rowsByBomItemId[error.objectId];
            var reference = row && row.partNumber ? row.partNumber + ": " : "";
            return '<li>' + app.utils.escapeHtml(reference + (error.message || "Engineering BOM validation failed.")) + '</li>';
          }).join("") + '</ul>' : '') +
          (errors.length > 8 ? '<div>' + app.utils.escapeHtml(String(errors.length - 8)) + ' additional issues are not shown.</div>' : '') +
          '</div>';
      }

      function filterRows(container) {
        var filter = container.querySelector("[data-engineering-filter]");
        if (!filter) return;
        searchTerm = filter.value.trim().toLowerCase();
        visibleRows = searchTerm ? buildSearchRows(searchTerm) : buildVisibleRows(allRows, expandedNodeIds);
        refreshTableBody(container);
      }

      function buildSearchRows(term) {
        var rowsById = {};
        var includedIds = {};
        allRows.forEach(function (row) { rowsById[row.id] = row; });
        allRows.forEach(function (row) {
          var searchable = [
            row.partNumber,
            row.description,
            row.revision,
            row.drawingNumber,
            row.drawingRevision,
            row.commodity,
            row.material,
            row.changeClassification,
            row.remark,
            row.status
          ].join(" ").toLowerCase();
          if (searchable.indexOf(term) === -1) return;
          includedIds[row.id] = true;
          var parentId = row.parentId;
          while (parentId && rowsById[parentId] && !includedIds[parentId]) {
            includedIds[parentId] = true;
            parentId = rowsById[parentId].parentId;
          }
        });
        return walkSearchRows(null, 0, includedIds);
      }

      function walkSearchRows(parentId, level, includedIds) {
        var matches = [];
        (rowsByParent[parentId || "__ROOT__"] || []).forEach(function (row) {
          if (!includedIds[row.id]) return;
          var children = rowsByParent[row.id] || [];
          matches.push(Object.assign({}, row, { level: level, hasChildren: children.length > 0 }));
          matches = matches.concat(walkSearchRows(row.id, level + 1, includedIds));
        });
        return matches;
      }

      function bindEditor(container) {
        var editor = container.querySelector("[data-engineering-editor]");
        if (!editor) return;
        editor.onsubmit = function (event) {
          event.preventDefault();
          try {
            applyEditor(container, editor);
            editor.hidden = true;
            visibleRows = buildVisibleRows(allRows, expandedNodeIds);
            refreshTableBody(container);
          } catch (error) {
            app.services.notificationService.notify(businessMessage(error, config.title + " eBOM update was blocked"), "warning");
          }
        };
        bindAction(container, "cancel-edit", function () {
          editor.hidden = true;
        });
      }

      function openEditor(container, mode) {
        var editor = container.querySelector("[data-engineering-editor]");
        if (!editor) return;
        var selectedRow = findRow(container.dataset.selectedEngineeringNode);
        var editRow = mode === "edit" ? selectedRow : null;
        if (mode === "edit" && !editRow) return;
        field(editor, "mode").value = mode;
        field(editor, "id").value = editRow ? editRow.id : "";
          field(editor, "partNumber").value = editRow ? editRow.partNumber : "";
          field(editor, "description").value = editRow ? editRow.description : "";
          field(editor, "revision").value = editRow ? editRow.revision : "A.01";
          field(editor, "drawingNumber").value = editRow ? editRow.drawingNumber || "" : "";
          field(editor, "drawingRevision").value = editRow ? editRow.drawingRevision || "" : "";
          field(editor, "commodity").value = editRow ? editRow.commodity || "" : "";
          field(editor, "material").value = editRow ? editRow.material : "";
          field(editor, "gauge").value = editRow ? editRow.gauge || "" : "";
          field(editor, "quantity").value = editRow ? editRow.quantity : "1";
          field(editor, "cadWeight").value = editRow ? editRow.cadWeight || editRow.weight || "" : "";
          field(editor, "imageReference").value = editRow ? editRow.imageReference || "" : "";
          field(editor, "changeClassification").value = editRow ? normalizeEditableChangeClassification(editRow.changeClassification) : "NEW";
          field(editor, "remark").value = editRow ? editRow.remark || "" : "";
          field(editor, "status").value = editRow ? editRow.status : "In Work";
          editor.hidden = false;
          field(editor, "partNumber").focus();
      }

      function applyEditor(container, editor) {
        var mode = field(editor, "mode").value;
        var id = field(editor, "id").value;
        var partNumber = field(editor, "partNumber").value.trim();
        var targetParentId = getTargetParentId(container);
        var existingRow = mode === "edit" ? allRows.find(function (item) { return item.id === id; }) : null;
        var row = Object.assign({}, existingRow || {}, {
          id: mode === "edit" ? id : partNumber,
          type: mode === "edit" ? getEditedType(id) : "Part",
          partNumber: partNumber,
          description: field(editor, "description").value.trim(),
          revision: field(editor, "revision").value.trim(),
          drawingNumber: field(editor, "drawingNumber").value.trim(),
          drawingRevision: field(editor, "drawingRevision").value.trim(),
          commodity: field(editor, "commodity").value.trim(),
          material: field(editor, "material").value.trim(),
          gauge: field(editor, "gauge").value.trim(),
          quantity: field(editor, "quantity").value.trim(),
          cadWeight: field(editor, "cadWeight").value.trim(),
          totalCadWeight: calculateEditorTotal(field(editor, "cadWeight").value, field(editor, "quantity").value),
          changeClassification: field(editor, "changeClassification").value,
          remark: field(editor, "remark").value.trim(),
          status: field(editor, "status").value,
          parentId: mode === "edit" ? getEditedParentId(id) : targetParentId,
          imageReference: getEditorImageReference(editor, mode === "edit" ? getEditedImageReference(id) : "")
        });
        if (mode === "edit") {
          allRows = allRows.map(function (item) {
            return item.id === id ? row : item;
          });
        } else {
          allRows.push(row);
          if (expandedNodeIds.indexOf(row.parentId) === -1) {
            expandedNodeIds.push(row.parentId);
          }
        }
        app.state.setEngineeringModule(config.moduleKey, allRows, resolveEngineeringChangeOptions(findRow(id), currentBom));
        // The domain service assigns stable Part and BOM item identifiers.
        // Continue from the authoritative projection so selection and later edits
        // never retain the temporary row ID used by the editor.
        allRows = app.utils.clone(app.state.get()[config.moduleKey] || []);
        app.state.setEngineeringWorkspaceView(config.moduleKey, { expandedNodeIds: expandedNodeIds });
        app.services.notificationService.notify(config.title + " eBOM updated", "success");
      }

      function removeSelectedRow(container) {
        var selectedId = container.dataset.selectedEngineeringNode;
        var selected = findRow(selectedId);
        if (!selected || !selected.parentId) return;
        var removeIds = collectDescendantIds(selectedId);
        removeIds[selectedId] = true;
        allRows = allRows.filter(function (row) {
          return !removeIds[row.id];
        });
        app.state.setEngineeringModule(config.moduleKey, allRows, resolveEngineeringChangeOptions(selected, currentBom));
        app.services.notificationService.notify(config.title + " row removed", "success");
        app.router.render();
      }

      function collectDescendantIds(parentId) {
        var ids = {};
        allRows.filter(function (row) { return row.parentId === parentId; }).forEach(function (child) {
          ids[child.id] = true;
          Object.assign(ids, collectDescendantIds(child.id));
        });
        return ids;
      }

      function refreshTableBody(container) {
        var tbody = container.querySelector(".engineering-bom-table tbody");
        tbody.innerHTML = visibleRows.map(renderRow).join("");
        bindRows(container);
        bindToggles(container);
        bindChangeClassificationControls(container);
      }

      function getTargetParentId(container) {
        var selectedRow = findRow(container.dataset.selectedEngineeringNode);
        if (selectedRow && selectedRow.type === "Assembly") {
          return selectedRow.id;
        }
        if (selectedRow && selectedRow.parentId) {
          return selectedRow.parentId;
        }
        var root = allRows.find(function (row) {
          return row.type === "Assembly" && (row.parentId === null || row.parentId === undefined);
        });
        return root ? root.id : null;
      }

      function calculateEditorTotal(weight, quantity) {
        var numericWeight = Number(weight);
        var numericQuantity = Number(quantity || 1);
        if (isNaN(numericWeight) || isNaN(numericQuantity)) return "";
        return String(numericWeight * numericQuantity);
      }

      function moduleCodeFromKey(moduleKey) {
        if (moduleKey === "headrest") return "HEAD_REST";
        if (moduleKey === "armrest") return "ARM_REST";
        return String(moduleKey || "").toUpperCase();
      }

      function getEditedType(id) {
        var row = allRows.find(function (item) { return item.id === id; });
        return row ? row.type : "Part";
      }

      function getEditedParentId(id) {
        var row = allRows.find(function (item) { return item.id === id; });
        return row ? row.parentId : null;
      }

      function getEditedImageReference(id) {
        var row = allRows.find(function (item) { return item.id === id; });
        return row ? row.imageReference || "" : "";
      }

      function getEditorImageReference(editor, existingReference) {
        var explicitReference = field(editor, "imageReference").value.trim();
        if (explicitReference) return explicitReference;
        return existingReference || "";
      }

      function renderChangeClassificationControl(row) {
        var value = normalizeEditableChangeClassification(row.changeClassification);
        if (!config.allowEditing || !row.bomItemId) {
          return '<span class="change-classification-value">' + app.utils.escapeHtml(changeClassificationLabel(value)) + '</span>';
        }
        return '<select class="change-classification-select" data-change-classification="' + app.utils.escapeHtml(row.id) +
          '" aria-label="Change Classification for ' + app.utils.escapeHtml(row.partNumber || row.description || "BOM item") + '">' +
          changeClassificationOption("NEW", "New", value) +
          changeClassificationOption("CARRY_OVER", "Carry Over", value) +
          changeClassificationOption("DELETED", "Deleted", value) +
          '</select>';
      }

      function changeClassificationOption(value, label, selectedValue) {
        return '<option value="' + value + '"' + (value === selectedValue ? " selected" : "") + '>' + label + '</option>';
      }

      function normalizeEditableChangeClassification(value) {
        var normalized = String(value || "").trim().toUpperCase().replace(/[\s-]+/g, "_");
        if (normalized === "NEW") return "NEW";
        if (normalized === "DELETED") return "DELETED";
        return "CARRY_OVER";
      }

      function changeClassificationLabel(value) {
        if (value === "NEW") return "New";
        if (value === "DELETED") return "Deleted";
        return "Carry Over";
      }

      function resolveEngineeringChangeOptions(row, bom) {
        if (!app.domain || !app.domain.engineeringChangeService) return {};
        var candidates = [];
        if (row) {
          if (row.partId) candidates.push("PART|" + row.partId);
          if (row.bomItemId) candidates.push("ENGINEERING_BOM_ITEM|" + row.bomItemId);
        }
        if (bom && bom.id) candidates.push("ENGINEERING_BOM|" + bom.id);
        var context = app.core.contextService.getContext();
        var change = app.domain.engineeringChangeService.listEngineeringChanges({
          programId: context.activeProgramId,
          seatVariantId: context.activeSeatVariantId
        }).find(function (candidate) {
          if (["APPROVED", "IMPLEMENTING"].indexOf(candidate.status) === -1) return false;
          return (candidate.affectedObjects || []).some(function (affected) {
            return candidates.indexOf(affected.objectType + "|" + affected.objectId) !== -1;
          });
        });
        return change ? { engineeringChangeId: change.id } : {};
      }

      function field(editor, name) {
        return editor.querySelector('[data-field="' + name + '"]');
      }

      function toggleExpanded(id) {
        expandedNodeIds = expandedNodeIds.indexOf(id) === -1
          ? expandedNodeIds.concat(id)
          : expandedNodeIds.filter(function (nodeId) { return nodeId !== id; });
      }

      function findRow(id) {
        return visibleRows.find(function (row) {
          return row.id === id;
        });
      }

      function markSelected(container, rowEl) {
        container.querySelectorAll("tr.selected").forEach(function (selected) {
          selected.classList.remove("selected");
        });
        rowEl.classList.add("selected");
      }
    }
  };
  function statusLabel(status) {
    return String(status || "").toLowerCase().replace(/(^|[\s_-])([a-z0-9])/g, function (_, prefix, character) {
      return (prefix ? " " : "") + character.toUpperCase();
    }).trim();
  }

  function metaItem(label, value) {
    return '<span class="workspace-meta-item">' + app.utils.escapeHtml(label) +
      ' <strong title="' + app.utils.escapeHtml(value) + '">' + app.utils.escapeHtml(value) + '</strong></span>';
  }

  function renderContextSelectors(state) {
    var program = state.program || {};
    var variant = state.variant || {};
    var programs = state.programs || [];
    var variants = state.seatVariants || [];
    var activeProgramId = program.id || "";
    var programVariants = variants.filter(function (item) {
      return !activeProgramId || item.programId === activeProgramId;
    });
    var activeCustomer = variant.customer || variant.brand || "";
    var activeSeatType = variant.seatType || variant.seatFamily || "";
    var customerVariants = programVariants.filter(function (item) {
      var customer = item.customer || item.brand || "";
      return !activeCustomer || customer === activeCustomer;
    });
    var filteredVariants = customerVariants.filter(function (item) {
      var seatType = item.seatType || item.seatFamily || "";
      return !activeSeatType || seatType === activeSeatType;
    });
    filteredVariants.sort(compareVariantLabels);
    var visibleVariants = limitVariantOptions(filteredVariants, variant.id || "", 50);
    return [
      '<div class="context-filter-row">',
      contextSelect("Programme", "data-context-program", programs.map(function (item) {
        return { value: item.id, label: item.programCode || item.name || item.id };
      }), activeProgramId),
      contextSelect("Customer / OEM", "data-context-customer", unique(programVariants.map(function (item) {
        return item.customer || item.brand || "";
      })).map(optionValue), activeCustomer),
      contextSelect("Seat Type", "data-context-seat-type", unique(customerVariants.map(function (item) {
        return item.seatType || item.seatFamily || "";
      })).map(optionValue), activeSeatType),
      '<label class="context-filter context-variant-search"><span>Find Variant</span><input type="search" data-context-variant-search placeholder="Code, grade or side" autocomplete="off"></label>',
      contextSelect("Finished-Good Variant", "data-context-variant", visibleVariants.map(function (item) {
        return { value: item.id, label: item.variantCode || item.variantName || item.id };
      }), variant.id || ""),
      '</div>'
    ].join("");
  }

  function contextSelect(label, attribute, options, selectedValue) {
    return '<label class="context-filter"><span>' + app.utils.escapeHtml(label) + '</span><select ' + attribute + '>' +
      (options || []).map(function (option) {
        return '<option value="' + app.utils.escapeHtml(option.value) + '"' + (option.value === selectedValue ? " selected" : "") + '>' +
          app.utils.escapeHtml(option.label) + '</option>';
      }).join("") +
      '</select></label>';
  }

  function optionValue(value) {
    return { value: value, label: value || "-" };
  }

  function setFirstVariantMatching(criteria) {
    var state = app.state.get();
    var currentVariant = state.variant || {};
    var targetCustomer = criteria.customer !== undefined ? criteria.customer : (currentVariant.customer || currentVariant.brand || "");
    var targetSeatType = criteria.seatType !== undefined ? criteria.seatType : (currentVariant.seatType || currentVariant.seatFamily || "");
    var programId = state.program && state.program.id;
    var match = (state.seatVariants || []).find(function (variant) {
      var customer = variant.customer || variant.brand || "";
      var seatType = variant.seatType || variant.seatFamily || "";
      return variant.programId === programId &&
        (!targetCustomer || customer === targetCustomer) &&
        (!targetSeatType || seatType === targetSeatType);
    });
    if (match) {
      app.core.contextService.setActiveBusinessContext({ programId: programId, seatVariantId: match.id });
      finishBusinessContextChange();
    }
  }

  function finishBusinessContextChange() {
    if (app.components && app.components.modal) app.components.modal.close({ silent: true });
    if (app.state && app.state.resetContextScopedUiState) app.state.resetContextScopedUiState();
    if (app.events) app.events.emit("state:changed");
    app.router.render();
  }

  function requestContextTransition(contextField, proceed, cancel) {
    if (app.router && app.router.requestTransition) {
      app.router.requestTransition({
        type: "context",
        contextField: contextField,
        proceed: proceed,
        cancel: cancel
      });
      return;
    }
    proceed();
  }

  function bindVariantSearch(search, select) {
    search.oninput = function () {
      var state = app.state.get();
      var activeProgramId = state.program && state.program.id || "";
      var current = state.variant || {};
      var customer = current.customer || current.brand || "";
      var seatType = current.seatType || current.seatFamily || "";
      var term = normalizeSearch(search.value);
      var matches = (state.seatVariants || []).filter(function (variant) {
        if (activeProgramId && variant.programId !== activeProgramId) return false;
        if (customer && (variant.customer || variant.brand || "") !== customer) return false;
        if (seatType && (variant.seatType || variant.seatFamily || "") !== seatType) return false;
        var haystack = variantSearchText(variant);
        return !term || term.split(/\s+/).every(function (token) { return haystack.indexOf(token) !== -1; });
      }).sort(compareVariantLabels);
      var limited = limitVariantOptions(matches, current.id || "", 50);
      select.innerHTML = limited.map(function (variant) {
        return '<option value="' + app.utils.escapeHtml(variant.id) + '"' + (variant.id === current.id ? " selected" : "") + '>' +
          app.utils.escapeHtml(variant.variantCode || variant.variantName || variant.id) + '</option>';
      }).join("");
    };
  }

  function variantSearchText(variant) {
    return normalizeSearch([
      variant.variantCode,
      variant.variantName,
      variant.customer,
      variant.brand,
      variant.seatType,
      variant.seatFamily,
      variant.grade,
      variant.side
    ].filter(Boolean).join(" "));
  }

  function normalizeSearch(value) {
    return String(value || "").trim().toLowerCase();
  }

  function compareVariantLabels(left, right) {
    return variantSearchText(left).localeCompare(variantSearchText(right));
  }

  function limitVariantOptions(variants, activeVariantId, limit) {
    var result = (variants || []).slice(0, limit);
    if (activeVariantId && !result.some(function (variant) { return variant.id === activeVariantId; })) {
      var active = (variants || []).find(function (variant) { return variant.id === activeVariantId; });
      if (active) result.unshift(active);
    }
    return result;
  }

  function unique(values) {
    var seen = {};
    return (values || []).filter(function (value) {
      if (!value || seen[value]) return false;
      seen[value] = true;
      return true;
    }).sort();
  }

  function partImageMarkup(reference, className, alt) {
    var service = app.domain && app.domain.partImageService;
    var managed = service && service.isManagedReference(reference);
    return '<img class="' + app.utils.escapeHtml((className || "") + (managed ? " part-image-loading" : "")) + '"' +
      (managed
        ? ' data-part-image-reference="' + app.utils.escapeHtml(reference) + '"'
        : ' src="' + app.utils.escapeHtml(reference) + '"') +
      ' alt="' + app.utils.escapeHtml(alt || "") + '">';
  }

  function hydratePartImages(container) {
    var service = app.domain && app.domain.partImageService;
    if (service && container) service.hydrateImageElements(container);
  }

  function previewDetail(label, value) {
    return '<tr><th>' + app.utils.escapeHtml(label) + '</th><td>' + app.utils.escapeHtml(value || "-") + '</td></tr>';
  }
})(window.DEP = window.DEP || {});
