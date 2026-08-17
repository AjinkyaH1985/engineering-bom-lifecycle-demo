(function (app) {
  var COLUMN_WIDTH_STORAGE_KEY = "engineeringBomLifecyclePortfolio.public.v2.ui.tableColumnWidths.v1";
  var MIN_COLUMN_WIDTH = 64;
  var MAX_AUTOFIT_WIDTH = 560;
  var initializedRoot = null;
  var observer = null;

  function readPreferences() {
    try {
      return JSON.parse(window.localStorage.getItem(COLUMN_WIDTH_STORAGE_KEY) || "{}") || {};
    } catch (error) {
      return {};
    }
  }

  function writePreferences(preferences) {
    try {
      window.localStorage.setItem(COLUMN_WIDTH_STORAGE_KEY, JSON.stringify(preferences || {}));
    } catch (error) {
      // Column widths are a non-critical UI preference.
    }
  }

  function hashText(value) {
    var hash = 2166136261;
    var textValue = String(value || "");
    for (var index = 0; index < textValue.length; index += 1) {
      hash ^= textValue.charCodeAt(index);
      hash += (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24);
    }
    return (hash >>> 0).toString(36);
  }

  function getHeaderCells(table) {
    if (!table || !table.tHead || !table.tHead.rows.length) return [];
    return Array.prototype.slice.call(table.tHead.rows[0].cells || []).filter(function (cell) {
      return cell.tagName === "TH" && Number(cell.colSpan || 1) === 1;
    });
  }

  function getWorkspaceId(table, fallbackWorkspaceId) {
    var workspace = table && table.closest ? table.closest("#app-workspace") : null;
    return fallbackWorkspaceId || (workspace && workspace.dataset.workspaceId) ||
      (app.state && app.state.getCurrentWorkspace ? app.state.getCurrentWorkspace() : "workspace");
  }

  function getTableKey(table, workspaceId, headerCells) {
    if (table.dataset.columnWidthKey) return table.dataset.columnWidthKey;
    var labels = headerCells.map(function (cell) {
      return String(cell.textContent || "").trim().replace(/\s+/g, " ");
    }).join("|");
    var classSignature = Array.prototype.slice.call(table.classList || []).filter(function (className) {
      return className !== "engineering-table" && className !== "resizable-columns" && className !== "resizable-data-table";
    }).sort().join(".");
    return String(workspaceId || "workspace") + ":" + (classSignature || "table") + ":" + hashText(labels);
  }

  function measureInitialWidths(headerCells) {
    return headerCells.map(function (cell) {
      var measured = cell.getBoundingSourceRect ? cell.getBoundingSourceRect().width : 0;
      return Math.max(MIN_COLUMN_WIDTH, Math.round(measured || cell.offsetWidth || 120));
    });
  }

  function normalizeWidths(widths, count, fallbackWidths) {
    if (!Array.isArray(widths) || widths.length !== count) return fallbackWidths.slice();
    return widths.map(function (width, index) {
      var numeric = Number(width);
      return isFinite(numeric) && numeric >= MIN_COLUMN_WIDTH ? Math.round(numeric) : fallbackWidths[index];
    });
  }

  function ensureColgroup(table, count) {
    var existing = table.querySelector("colgroup[data-resizable-columns]");
    if (existing && existing.parentNode === table && existing.children.length === count) return existing;
    if (existing) existing.remove();
    var colgroup = document.createElement("colgroup");
    colgroup.setAttribute("data-resizable-columns", "true");
    for (var index = 0; index < count; index += 1) colgroup.appendChild(document.createElement("col"));
    table.insertBefore(colgroup, table.firstChild);
    return colgroup;
  }

  function applyWidths(table, colgroup, widths) {
    var total = 0;
    widths.forEach(function (width, index) {
      var normalized = Math.max(MIN_COLUMN_WIDTH, Math.round(Number(width) || MIN_COLUMN_WIDTH));
      colgroup.children[index].style.width = normalized + "px";
      total += normalized;
    });
    table.style.width = total + "px";
    table.style.minWidth = total + "px";
  }

  function saveWidths(table, tableKey, widths) {
    var preferences = readPreferences();
    preferences[tableKey] = widths.map(function (width) { return Math.round(width); });
    writePreferences(preferences);
    table.dataset.columnWidths = preferences[tableKey].join(",");
  }

  function getAutoFitWidth(table, columnIndex, headerCell) {
    var maximum = Math.max(MIN_COLUMN_WIDTH, headerCell.scrollWidth + 22);
    var rows = table.tBodies && table.tBodies.length ? table.tBodies[0].rows : [];
    var limit = Math.min(rows.length, 1000);
    for (var rowIndex = 0; rowIndex < limit; rowIndex += 1) {
      var cell = rows[rowIndex].cells[columnIndex];
      if (cell && !cell.hasAttribute("colspan")) maximum = Math.max(maximum, cell.scrollWidth + 18);
    }
    return Math.min(MAX_AUTOFIT_WIDTH, Math.ceil(maximum));
  }

  function addResizeHandle(table, headerCell, columnIndex, colgroup, widths, tableKey) {
    var handle = document.createElement("span");
    handle.className = "column-resize-handle";
    handle.setAttribute("role", "separator");
    handle.setAttribute("aria-orientation", "vertical");
    handle.setAttribute("aria-label", "Resize " + (String(headerCell.textContent || "column").trim() || "column"));
    handle.setAttribute("tabindex", "0");
    handle.setAttribute("title", "Drag to resize. Double-click to fit content.");
    handle.dataset.columnIndex = String(columnIndex);

    handle.addEventListener("pointerdown", function (event) {
      if (event.button !== undefined && event.button !== 0) return;
      event.preventDefault();
      event.stopPropagation();
      var startX = event.sourceX;
      var startWidth = widths[columnIndex];
      document.body.classList.add("column-resizing");
      table.classList.add("is-column-resizing");
      if (handle.setPointerCapture && event.pointerId !== undefined) handle.setPointerCapture(event.pointerId);

      function move(moveEvent) {
        widths[columnIndex] = Math.max(MIN_COLUMN_WIDTH, startWidth + moveEvent.sourceX - startX);
        applyWidths(table, colgroup, widths);
      }

      function stop(stopEvent) {
        document.removeEventListener("pointermove", move);
        document.removeEventListener("pointerup", stop);
        document.removeEventListener("pointercancel", stop);
        document.body.classList.remove("column-resizing");
        table.classList.remove("is-column-resizing");
        if (handle.releasePointerCapture && stopEvent.pointerId !== undefined && handle.hasPointerCapture && handle.hasPointerCapture(stopEvent.pointerId)) {
          handle.releasePointerCapture(stopEvent.pointerId);
        }
        saveWidths(table, tableKey, widths);
      }

      document.addEventListener("pointermove", move);
      document.addEventListener("pointerup", stop);
      document.addEventListener("pointercancel", stop);
    });

    handle.addEventListener("dblclick", function (event) {
      event.preventDefault();
      event.stopPropagation();
      widths[columnIndex] = getAutoFitWidth(table, columnIndex, headerCell);
      applyWidths(table, colgroup, widths);
      saveWidths(table, tableKey, widths);
    });

    handle.addEventListener("keydown", function (event) {
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
      event.preventDefault();
      event.stopPropagation();
      var increment = event.shiftKey ? 32 : 16;
      widths[columnIndex] = Math.max(MIN_COLUMN_WIDTH, widths[columnIndex] + (event.key === "ArrowRight" ? increment : -increment));
      applyWidths(table, colgroup, widths);
      saveWidths(table, tableKey, widths);
    });

    headerCell.appendChild(handle);
  }

  function enhanceTable(table, fallbackWorkspaceId) {
    if (!table || table.dataset.columnResizingEnabled === "true") return false;
    var headerCells = getHeaderCells(table);
    if (!headerCells.length || headerCells.length !== table.tHead.rows[0].cells.length) return false;
    var workspaceId = getWorkspaceId(table, fallbackWorkspaceId);
    var tableKey = getTableKey(table, workspaceId, headerCells);
    var measuredWidths = measureInitialWidths(headerCells);
    var widths = normalizeWidths(readPreferences()[tableKey], headerCells.length, measuredWidths);
    var colgroup = ensureColgroup(table, headerCells.length);

    table.dataset.columnResizingEnabled = "true";
    table.dataset.columnWidthKey = tableKey;
    table.classList.add("resizable-columns", "resizable-data-table");
    applyWidths(table, colgroup, widths);
    table.dataset.columnWidths = widths.join(",");
    headerCells.forEach(function (headerCell, columnIndex) {
      addResizeHandle(table, headerCell, columnIndex, colgroup, widths, tableKey);
    });
    return true;
  }

  function enhanceResizableTables(root, workspaceId) {
    if (!root || !root.querySelectorAll) return 0;
    var count = 0;
    Array.prototype.slice.call(root.querySelectorAll("table")).forEach(function (table) {
      if (enhanceTable(table, workspaceId)) count += 1;
    });
    return count;
  }

  function initializeColumnResizing(root) {
    if (!root || initializedRoot === root) return;
    if (observer) observer.disconnect();
    initializedRoot = root;
    enhanceResizableTables(root);
    if (typeof MutationObserver === "undefined") return;
    observer = new MutationObserver(function (mutations) {
      var needsEnhancement = mutations.some(function (mutation) {
        return mutation.addedNodes && mutation.addedNodes.length;
      });
      if (needsEnhancement) enhanceResizableTables(root, root.dataset.workspaceId);
    });
    observer.observe(root, { childList: true, subtree: true });
  }

  app.components = app.components || {};
  app.components.table = {
    render: function (columns, rows) {
      return '<div class="placeholder-panel"><div class="table-toolbar"><input type="search" placeholder="Filter">' +
        '<button type="button">Search</button><button type="button">Refresh</button></div><table class="engineering-table"><thead><tr>' +
        columns.map(function (column) { return '<th>' + app.utils.escapeHtml(column.label) + '</th>'; }).join("") +
        '</tr></thead><tbody>' + rows.map(function (row) {
          return '<tr data-row-id="' + app.utils.escapeHtml(row.id) + '">' + columns.map(function (column) {
            return '<td>' + app.utils.escapeHtml(row[column.key]) + '</td>';
          }).join("") + '</tr>';
        }).join("") + '</tbody></table></div>';
    },
    enhanceResizableTables: enhanceResizableTables,
    initializeColumnResizing: initializeColumnResizing,
    columnWidthStorageKey: COLUMN_WIDTH_STORAGE_KEY,
    normalizeWidths: normalizeWidths
  };
})(window.DEP = window.DEP || {});
