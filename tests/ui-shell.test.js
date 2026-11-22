const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const html = fs.readFileSync(path.join(root, "index.html"), "utf8");

(function indexReferencesExistingFiles() {
  const refs = [];
  html.replace(/(?:src|href)="([^"]+)"/g, (_, ref) => {
    if (!/^(https?:|#|data:)/.test(ref)) refs.push(ref.split("?")[0]);
  });
  const missing = refs.filter((ref) => !fs.existsSync(path.join(root, ref)));
  assert.deepStrictEqual(missing, [], "index.html references missing files: " + missing.join(", "));
})();

(function responsiveShellIsWired() {
  assert.ok(/<meta name="viewport" content="[^"]*width=device-width/.test(html), "Viewport meta tag is required for mobile");
  assert.ok(html.includes('id="nav-backdrop"'), "Navigation backdrop element is required");
  assert.ok(html.indexOf("css/responsive.css") > html.indexOf("css/refresh.css"), "responsive.css must load after the base styles");
  assert.ok(html.indexOf("css/fiori.css") > html.indexOf("css/responsive.css"), "fiori.css must load last");
  ["context-menu.js", "mobile-shell.js", "shell-tools.js"].forEach((name) => {
    assert.ok(html.includes("js/components/" + name), name + " must be loaded");
    assert.ok(html.indexOf("js/components/" + name) < html.indexOf("js/app.js"), name + " must load before app.js");
  });
  const css = fs.readFileSync(path.join(root, "css/responsive.css"), "utf8");
  assert.ok(/@media \(max-width: 900px\)/.test(css), "Mobile breakpoint is required");
  assert.ok(/body\.nav-open/.test(css), "Off-canvas navigation state is required");
})();

(function navigationKeepsAllWorkspaces() {
  const navigation = fs.readFileSync(path.join(root, "js/components/navigation.js"), "utf8");
  ["dashboard", "import-bom", "program", "feature-matrix", "structure", "foam", "plastic", "trim", "headrest",
    "armrest", "complete-seat", "bom-cost", "engineering-change", "revision", "excel-export",
    "commodity-management", "admin-master-data"].forEach((id) => {
    assert.ok(navigation.includes('id: "' + id + '"'), "Navigation must keep the " + id + " workspace");
  });
})();

(function publicNamespaceIsUsed() {
  ["js/components/navigation.js", "js/components/shell-tools.js", "js/components/mobile-shell.js"].forEach((file) => {
    const text = fs.readFileSync(path.join(root, file), "utf8");
    assert.ok(!/bomLifecycleDemo\./.test(text), file + " must not use the private demo storage namespace");
  });
})();

(function resetStaysReachable() {
  const tools = fs.readFileSync(path.join(root, "js/components/shell-tools.js"), "utf8");
  const header = fs.readFileSync(path.join(root, "js/components/header.js"), "utf8");
  assert.ok(tools.includes("Reset demo data"), "Reset demo data must stay available from the user menu");
  assert.ok(header.includes("data-hdr-avatar"), "The user menu button must stay in the header");
  assert.ok(!header.includes("portfolio-note") && !header.includes("header-context-chip") && !header.includes("data-hdr-search"),
    "Header must not show the portfolio note, active-variant chip or search");
})();

console.log("UI shell tests passed");
