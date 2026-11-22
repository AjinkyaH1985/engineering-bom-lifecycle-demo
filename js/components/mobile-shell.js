(function (app) {
  app.components = app.components || {};

  var MOBILE_QUERY = "(max-width: 900px)";

  function setNavigationOpen(open) {
    document.body.classList.toggle("nav-open", open);
    var toggle = document.querySelector("[data-nav-toggle]");
    if (toggle) {
      toggle.setAttribute("aria-expanded", open ? "true" : "false");
      toggle.setAttribute("aria-label", open ? "Close navigation menu" : "Open navigation menu");
    }
  }

  function confirmReset() {
    app.components.modal.open("Reset demo data", [
      '<p class="reset-copy">This restores the original sample programme and removes every entry you made in this browser.</p>',
      '<p class="reset-copy muted">Your data is stored only in this browser, so nobody else is affected.</p>',
      '<div class="reset-actions">',
      '<button type="button" data-close>Cancel</button>',
      '<button type="button" class="primary" data-confirm-reset>Reset demo data</button>',
      '</div>'
    ].join(""), { hideFooter: true });
    var confirmButton = document.querySelector("#modal-root [data-confirm-reset]");
    if (confirmButton) {
      confirmButton.onclick = function () {
        try {
          app.core.storageService.restoreSeed();
        } catch (error) {
          app.state.addNotification("Reset failed: " + (error && error.message || "storage unavailable"), "error");
          return;
        }
        window.location.reload();
      };
    }
  }

  function toggleContext(button) {
    var wrapper = button.closest(".workspace-meta") || button.parentElement;
    var open = !wrapper.classList.contains("context-open");
    wrapper.classList.toggle("context-open", open);
    button.setAttribute("aria-expanded", open ? "true" : "false");
  }

  document.addEventListener("click", function (event) {
    var target = event.target;
    if (!target || !target.closest) return;
    if (target.closest("[data-nav-toggle]")) {
      if (window.matchMedia && window.matchMedia(MOBILE_QUERY).matches) {
        setNavigationOpen(!document.body.classList.contains("nav-open"));
      } else {
        // Desktop: collapse or restore the side navigation.
        var collapsed = document.body.classList.toggle("nav-collapsed");
        var toggle = target.closest("[data-nav-toggle]");
        toggle.setAttribute("aria-label", collapsed ? "Show navigation menu" : "Hide navigation menu");
      }
      return;
    }
    if (target.closest("#nav-backdrop")) {
      setNavigationOpen(false);
      return;
    }
    var reset = target.closest("[data-reset-demo]");
    if (reset) { confirmReset(); return; }
    var go = target.closest("[data-goto-workspace]");
    if (go) {
      app.router.navigate(go.getAttribute("data-goto-workspace"));
      return;
    }
    var context = target.closest("[data-context-toggle]");
    if (context) toggleContext(context);
  });

  // Capture phase: navigation re-renders the menu, which detaches the tapped button
  // before a bubbling listener could identify it.
  document.addEventListener("click", function (event) {
    var target = event.target;
    if (target && target.closest && target.closest("#app-navigation [data-workspace]")) setNavigationOpen(false);
  }, true);

  document.addEventListener("keydown", function (event) {
    if (event.key === "Escape" && document.body.classList.contains("nav-open")) setNavigationOpen(false);
  });

  if (window.matchMedia) {
    var query = window.matchMedia(MOBILE_QUERY);
    var onChange = function () { if (!query.matches) setNavigationOpen(false); };
    if (query.addEventListener) query.addEventListener("change", onChange);
    else if (query.addListener) query.addListener(onChange);
  }

  app.components.mobileShell = {
    openNavigation: function () { setNavigationOpen(true); },
    closeNavigation: function () { setNavigationOpen(false); },
    confirmReset: confirmReset
  };
})(window.DEP = window.DEP || {});
