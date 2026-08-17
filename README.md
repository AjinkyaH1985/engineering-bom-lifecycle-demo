# Engineering BOM Lifecycle Platform

A static, browser-based portfolio demonstration of an automotive engineering product-data workflow. It shows how spreadsheet-oriented Engineering BOM work can be represented as controlled, traceable business objects without requiring a backend service.

> **All organisations, programmes, part numbers, suppliers, commercial values and engineering data in this public demonstration are fictional and created solely for portfolio purposes.**

## Demonstrated Workflow

```text
Dashboard
  -> Feature Configuration
  -> Discipline Engineering eBOMs
  -> Generated Complete Seat JIT
  -> Commodity Master and Mapping
  -> Commercial Assessment
  -> Engineering Change / ECN
  -> Immutable Revision
  -> Released Revision Excel Export
```

The included synthetic AX7 dataset contains three Finished-Good Variants for Orion Motors. The active AX7-60P-E3 configuration includes six completed Engineering eBOMs, a generated Complete Seat structure, commercial sourcing data, an implemented ECN, and released Revision A. A second draft ECN provides a starting point for demonstrating a controlled change leading toward Revision B.

## Capabilities

- Shared programme and Finished-Good Variant context
- Typed Feature Configuration with two- and three-variant comparison
- Structure, Foam, Plastic, Trim, Head Rest, and Arm Rest eBOM authoring
- Deterministic, read-only Complete Seat JIT generation
- Part image metadata and synthetic technical previews
- Independent Commodity Master and variant mapping
- Commercial Assessment with supplier, pricing, tooling, logistics, and totals
- Engineering Change lifecycle and affected-object control
- Immutable Revision snapshots and structured comparison
- Local `.xlsx` import with validation, preview, fingerprinting, and atomic commit
- Released Revision `.xlsx` export

## Architecture

The application is intentionally framework-free and runs entirely in the browser:

- **AppState** is the authoritative application model.
- **Domain services** own validation, transactions, audit, lifecycle, and generation rules.
- **Workspace modules** render compact enterprise grids and call domain services.
- **localStorage** persists the portfolio state under a dedicated public-edition namespace.
- **IndexedDB** is used only for image references extracted from a workbook during a browser session.
- **JSZip** supports local Open XML workbook import and export.

No application data is sent to a server or external service.

## Run Locally

Serve the folder with any static web server. For example:

```powershell
python -m http.server 8000 --bind 127.0.0.1
```

Then open `http://127.0.0.1:8000/`.

Opening `index.html` directly is not recommended because browser security restrictions can block local workbook and asset handling.

## Tests

Node.js is used only for the lightweight validation scripts; the application itself has no Node runtime dependency.

```powershell
npm test
npm run test:syntax
```

The public tests validate the synthetic seed, AppState references, context isolation, eBOM completion, Complete Seat and Commercial status, Commodity mapping, released Revision readiness, and generation of an openable `.xlsx` byte package.

## GitHub Pages Readiness

The project uses relative runtime paths and contains a `.nojekyll` marker, so it can be hosted as a static GitHub Pages site after repository publication. No Git repository or remote has been created as part of the sanitization build.

## Scope

This is a portfolio demonstration, not a production PLM product. It intentionally omits authentication, enterprise RBAC administration, backend APIs, ERP integration, CAD integration, supplier portals, notifications, and production deployment controls.

Portfolio Demonstration — Synthetic automotive engineering data
