(function (app) {
  app.components = app.components || {};
  app.components.toolbar = {
    render: function (actions) {
      return '<div class="workspace-actions">' + actions.map(function (action) {
        var classes = [];
        if (action.primary) classes.push("primary");
        if (action.destructive) classes.push("destructive");
        if (action.tertiary) classes.push("tertiary");
        return '<button type="button" data-action="' + app.utils.escapeHtml(action.id) + '"' +
          (classes.length ? ' class="' + classes.join(" ") + '"' : "") +
          (action.hidden ? " hidden" : "") +
          (action.disabled ? " disabled" : "") +
          (action.title ? ' title="' + app.utils.escapeHtml(action.title) + '"' : "") +
          (action.ariaLabel ? ' aria-label="' + app.utils.escapeHtml(action.ariaLabel) + '"' : "") +
          '>' + app.utils.escapeHtml(action.label) + '</button>';
      }).join("") + '</div>';
    }
  };
})(window.DEP = window.DEP || {});
