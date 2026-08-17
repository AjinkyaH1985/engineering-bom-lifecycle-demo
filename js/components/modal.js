(function (app) {
  app.components = app.components || {};
  var escapeHandler = null;
  var closeHandler = null;

  app.components.modal = {
    close: function (options) {
      var root = app.utils.byId("modal-root");
      if (!root) return;
      var onClose = closeHandler;
      closeHandler = null;
      root.classList.remove("open");
      root.innerHTML = "";
      if (escapeHandler) {
        document.removeEventListener("keydown", escapeHandler);
        escapeHandler = null;
      }
      if (onClose && !(options && options.silent)) onClose();
    },
    open: function (title, body, options) {
      var root = app.utils.byId("modal-root");
      if (!root) return;
      app.components.modal.close({ silent: true });
      closeHandler = options && options.onClose || null;
      root.classList.add("open");
      root.innerHTML = '<div class="modal" role="dialog" aria-modal="true"><div class="modal-header"><strong>' + app.utils.escapeHtml(title) + '</strong>' +
        '<button type="button" class="modal-close" data-close aria-label="Close">Close</button>' +
        '</div><div class="modal-body">' + body +
        '</div><div class="modal-footer"><button type="button" data-close>Close</button></div></div>';
      root.querySelectorAll("[data-close]").forEach(function (button) {
        button.onclick = app.components.modal.close;
      });
      root.onclick = function (event) {
        if (event.target === root) app.components.modal.close();
      };
      escapeHandler = function (event) {
        if (event.key === "Escape") app.components.modal.close();
      };
      document.addEventListener("keydown", escapeHandler);
    }
  };
})(window.DEP = window.DEP || {});
