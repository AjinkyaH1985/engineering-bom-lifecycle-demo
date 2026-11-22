(function (app) {
  app.components = app.components || {};

  var MODULE_WORKSPACE = {
    "MOD-STRUCTURE": "structure",
    "MOD-FOAM": "foam",
    "MOD-PLASTIC": "plastic",
    "MOD-TRIM": "trim",
    "MOD-HEAD-REST": "headrest",
    "MOD-ARM-REST": "armrest"
  };
  var popover = null;
  var searchTimer = null;
  var lastQuery = "";

  function escape(value) {
    return app.utils.escapeHtml(String(value == null ? "" : value));
  }

  function byId(id) { return document.getElementById(id); }

  /* ---------- Search ---------- */

  function runSearch(query) {
    query = String(query || "").trim().toLowerCase();
    var results = { screens: [], parts: [], changes: [] };
    if (query.length < 2) return results;
    app.components.navigation.groups.forEach(function (group) {
      group.items.forEach(function (item) {
        if (item.label.toLowerCase().indexOf(query) !== -1 || group.title.toLowerCase().indexOf(query) !== -1) {
          results.screens.push({ label: item.label, sub: group.title, go: item.id });
        }
      });
    });
    app.core.appState.getCollection("parts").forEach(function (part) {
      if (results.parts.length >= 6) return;
      var haystack = [part.partNumber, part.tmPartNumber, part.description, part.name].join(" ").toLowerCase();
      if (haystack.indexOf(query) === -1) return;
      var workspace = MODULE_WORKSPACE[part.engineeringModuleId];
      if (!workspace) return;
      results.parts.push({
        label: part.partNumber,
        sub: part.description || part.name || "",
        go: workspace,
        filter: part.partNumber
      });
    });
    app.core.appState.getCollection("engineeringChanges").forEach(function (change) {
      if (results.changes.length >= 5) return;
      var haystack = [change.changeNumber, change.title, change.owner].join(" ").toLowerCase();
      if (haystack.indexOf(query) === -1) return;
      results.changes.push({ label: change.changeNumber, sub: change.title || "", go: "engineering-change" });
    });
    return results;
  }

  var currentResults = [];

  function renderResults(results, query) {
    var box = document.querySelector("[data-hdr-search-results]");
    if (!box) return;
    currentResults = [];
    var sections = [
      ["Screens", results.screens],
      ["Parts", results.parts],
      ["Engineering Changes", results.changes]
    ];
    var html = sections.filter(function (section) { return section[1].length; }).map(function (section) {
      return '<div class="hdr-result-group"><div class="hdr-result-title">' + escape(section[0]) + '</div>' +
        section[1].map(function (item) {
          currentResults.push(item);
          return '<button type="button" class="hdr-result" role="option" data-hdr-result="' + (currentResults.length - 1) + '">' +
            '<strong>' + escape(item.label) + '</strong><span>' + escape(item.sub) + '</span></button>';
        }).join("") + '</div>';
    }).join("");
    if (!html) {
      html = String(query || "").trim().length < 2
        ? '<div class="hdr-empty">Type at least 2 characters.</div>'
        : '<div class="hdr-empty">No matches for "' + escape(query) + '".</div>';
    }
    box.innerHTML = html;
    box.hidden = false;
  }

  function chooseResult(item) {
    closeSearch();
    app.router.navigate(item.go);
    if (item.filter) {
      window.setTimeout(function () {
        var input = document.querySelector("#app-workspace [data-engineering-filter]");
        if (!input) return;
        input.value = item.filter;
        input.dispatchEvent(new Event("input", { bubbles: true }));
      }, 60);
    }
  }

  function openSearch() {
    var input = document.querySelector("[data-hdr-search-input]");
    if (!input) return;
    document.body.classList.add("search-open");
    input.focus();
    if (input.value) renderResults(runSearch(input.value), input.value);
  }

  function closeSearch() {
    document.body.classList.remove("search-open");
    var box = document.querySelector("[data-hdr-search-results]");
    if (box) box.hidden = true;
    var input = document.querySelector("[data-hdr-search-input]");
    if (input) input.value = "";
    lastQuery = "";
  }

  function restoreSearch(input) {
    if (lastQuery) input.value = lastQuery;
    input.focus();
  }

  /* ---------- Popovers ---------- */

  function closePopover() {
    if (!popover) return;
    if (popover.element.parentNode) popover.element.parentNode.removeChild(popover.element);
    document.removeEventListener("mousedown", popover.onOutside, true);
    document.removeEventListener("keydown", popover.onKey, true);
    if (popover.anchor) popover.anchor.setAttribute("aria-expanded", "false");
    popover = null;
  }

  function showPopover(anchor, html, className) {
    closePopover();
    if (app.components.contextMenu) app.components.contextMenu.close();
    var element = document.createElement("div");
    element.className = "hdr-popover hdr-popover-floating " + (className || "");
    element.innerHTML = html;
    document.body.appendChild(element);
    var rect = anchor.getBoundingClientRect();
    var width = element.offsetWidth;
    element.style.top = (rect.bottom + 6) + "px";
    element.style.left = Math.max(8, Math.min(rect.right - width, window.innerWidth - width - 8)) + "px";
    popover = {
      element: element,
      anchor: anchor,
      onOutside: function (event) {
        if (!element.contains(event.target) && !anchor.contains(event.target)) closePopover();
      },
      onKey: function (event) { if (event.key === "Escape") closePopover(); }
    };
    document.addEventListener("mousedown", popover.onOutside, true);
    document.addEventListener("keydown", popover.onKey, true);
    anchor.setAttribute("aria-expanded", "true");
  }

  function humanize(action) {
    return String(action || "").toLowerCase().replace(/_/g, " ").replace(/^./, function (c) { return c.toUpperCase(); });
  }

  function formatTime(iso) {
    var date = new Date(iso);
    if (isNaN(date.getTime())) return "";
    return date.toLocaleDateString(undefined, { day: "2-digit", month: "short" }) + " " +
      date.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  }

  function openBell(anchor) {
    var notices = [];
    try { notices = (app.state.get().notifications || []).slice(0, 5); } catch (error) { notices = []; }
    var events = app.core.appState.getCollection("auditEvents").filter(function (event) {
      return ["CONTEXT_CHANGED", "STATE_INITIALISED", "CONTEXT_REPAIRED"].indexOf(event.action) === -1;
    }).slice(-8).reverse();
    var html = '<div class="hdr-popover-head">Notifications</div>' +
      (notices.length
        ? notices.map(function (notice) {
          return '<div class="hdr-note tone-' + escape(notice.tone || "info") + '"><span>' + escape(notice.message) + '</span><time>' + escape(formatTime(notice.createdAt)) + '</time></div>';
        }).join("")
        : '<div class="hdr-empty">No new notifications in this session.</div>') +
      '<div class="hdr-popover-head">Recent activity</div>' +
      (events.length
        ? events.map(function (event) {
          return '<div class="hdr-note"><span>' + escape(humanize(event.action)) + (event.objectId ? ' <em>' + escape(String(event.objectId).slice(0, 28)) + '</em>' : "") +
            '</span><time>' + escape(formatTime(event.performedAt)) + '</time></div>';
        }).join("")
        : '<div class="hdr-empty">Activity appears here as you work.</div>');
    showPopover(anchor, html, "hdr-popover-notes");
  }

  function openAbout() {
    app.components.modal.open("About this demo", [
      '<p class="reset-copy">An interactive sample of an engineering BOM lifecycle: configuration, discipline eBOMs, a generated Complete Seat, commercial assessment, engineering change and revisions.</p>',
      '<p class="reset-copy">All programmes, parts, suppliers and prices are <strong>fictional sample data</strong>. Entries you make are saved only in this browser, and <em>Reset demo data</em> restores the original sample.</p>'
    ].join(""));
  }

  function openUserMenu(anchor) {
    closePopover();
    app.components.contextMenu.open({
      anchor: anchor,
      items: [
        { label: "About this demo", icon: "doc", onSelect: openAbout },
        { label: "Reset demo data", icon: "flag", onSelect: function () { app.components.mobileShell.confirmReset(); } }
      ]
    });
  }

  /* ---------- Events ---------- */

  document.addEventListener("click", function (event) {
    var target = event.target;
    if (!target || !target.closest) return;
    if (target.closest("[data-hdr-search-toggle]")) {
      if (document.body.classList.contains("search-open")) closeSearch(); else openSearch();
      return;
    }
    var result = target.closest("[data-hdr-result]");
    if (result) {
      var item = currentResults[Number(result.getAttribute("data-hdr-result"))];
      if (item) chooseResult(item);
      return;
    }
    var bell = target.closest("[data-hdr-bell]");
    if (bell) {
      if (popover && popover.anchor === bell) closePopover(); else openBell(bell);
      return;
    }
    var avatar = target.closest("[data-hdr-avatar]");
    if (avatar) {
      if (app.components.contextMenu.isOpen()) app.components.contextMenu.close(); else openUserMenu(avatar);
      return;
    }
    if (document.body.classList.contains("search-open") && !target.closest("[data-hdr-search]")) closeSearch();
  });

  document.addEventListener("input", function (event) {
    var input = event.target;
    if (!input || !input.matches || !input.matches("[data-hdr-search-input]")) return;
    lastQuery = input.value;
    window.clearTimeout(searchTimer);
    searchTimer = window.setTimeout(function () { renderResults(runSearch(input.value), input.value); }, 120);
  });

  document.addEventListener("keydown", function (event) {
    var input = event.target;
    if (event.key === "Escape" && document.body.classList.contains("search-open")) {
      closeSearch();
      return;
    }
    if (event.key === "Enter" && input && input.matches && input.matches("[data-hdr-search-input]") && currentResults.length) {
      event.preventDefault();
      chooseResult(currentResults[0]);
    }
  });

  app.components.shellTools = {
    openSearch: openSearch,
    closeSearch: closeSearch,
    restoreSearch: restoreSearch,
    runSearch: runSearch
  };
})(window.DEP = window.DEP || {});
