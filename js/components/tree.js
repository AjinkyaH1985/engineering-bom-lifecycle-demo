(function (app) {
  app.components = app.components || {};
  app.components.tree = {
    render: function (nodes) {
      return '<div class="placeholder-panel">' + nodes.map(function (node) {
        return '<button type="button" class="nav-item" data-node="' + app.utils.escapeHtml(node.id) +
          '"><span class="nav-code">+</span><span>' + app.utils.escapeHtml(node.label) + '</span></button>';
      }).join("") + '</div>';
    }
  };
})(window.DEP = window.DEP || {});
