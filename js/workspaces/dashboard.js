(function (app) {
  app.router.register("dashboard", {
    render: function () {
      return renderDashboard(app.domain.dashboardService.getDashboardSummary());
    },
    afterRender: function (container) {
      container.onclick = function (event) {
        var card = event.target.closest("[data-dashboard-target]");
        if (!card || card.disabled) return;
        app.router.navigate(card.getAttribute("data-dashboard-target"));
      };
    }
  });

  function renderDashboard(summary) {
    return [
      '<div class="dashboard-heading"><h1>Dashboard</h1></div>',
      '<div class="workspace-body dashboard-workspace">',
      renderKpis(summary),
      summary.hasActiveVariant ? '' : renderEmpty(),
      '</div>'
    ].join("");
  }

  function renderKpis(summary) {
    var revisions = summary.releasedRevisions;
    return [
      '<section class="dashboard-kpi-grid" aria-label="Product context summary">',
      kpiCard({
        label: "Pending PO",
        value: summary.pendingPo.count,
        supporting: summary.pendingPo.assessmentId ? "Sourced lines missing a PO Number" : "No active Commercial Assessment",
        title: "Counts active supplied lines at Quoted, Nominated, or Sourced status until a PO Number is saved."
      }),
      kpiCard({
        label: "Completed BOMs",
        value: summary.completedBoms.completed + " / " + summary.completedBoms.required,
        supporting: "Applicable Engineering eBOMs completed",
        target: summary.completedBoms.targetWorkspaceId,
        title: summary.completedBoms.targetWorkspaceId
          ? (summary.completedBoms.firstIncompleteModuleCode
            ? "Open the first incomplete applicable Engineering eBOM"
            : "Open Complete Seat JIT")
          : ""
      }),
      kpiCard({
        label: "Total ECNs",
        value: summary.engineeringChanges.total,
        supporting: summary.engineeringChanges.open + " Open / " + summary.engineeringChanges.implemented + " Implemented",
        target: "engineering-change",
        title: "Open Engineering Change"
      }),
      kpiCard({
        label: "Total Released",
        value: revisions.count,
        supporting: revisions.latestRevisionNumber ? "Latest: Revision " + revisions.latestRevisionNumber : "No released Revision",
        target: "revision",
        title: "Open Revision History"
      }),
      '</section>'
    ].join("");
  }

  function kpiCard(input) {
    var tag = input.target ? "button" : "article";
    return [
      '<', tag,
      input.target ? ' type="button" data-dashboard-target="' + escape(input.target) + '"' : '',
      ' class="dashboard-kpi-card', input.target ? ' is-actionable' : '', '"',
      input.title ? ' title="' + escape(input.title) + '"' : '',
      '>',
      '<span class="dashboard-kpi-label">', escape(input.label), '</span>',
      '<strong class="dashboard-kpi-value">', escape(input.value), '</strong>',
      '<span class="dashboard-kpi-supporting">', escape(input.supporting), '</span>',
      '</', tag, '>'
    ].join("");
  }

  function renderEmpty() {
    return '<div class="dashboard-empty">No active Finished-Good Variant. Import a BOM workbook to begin.</div>';
  }

  function escape(value) {
    return app.utils.escapeHtml(String(value == null ? "" : value));
  }
})(window.DEP = window.DEP || {});
