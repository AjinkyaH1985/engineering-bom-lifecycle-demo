# Public Portfolio Sanitization Report

## Publication Candidate

- Public project folder: `Engineering-BOM-Platform/`
- Application name: **Engineering BOM Lifecycle Platform**
- Intended future repository: `engineering-bom-lifecycle-demo`
- Edition: standalone static portfolio demonstration
- Source relationship: allow-listed runtime files were copied into a separate project; the source project was not modified.

## Content Included

The public project contains only the static application runtime, its required styles and scripts, the vendored JSZip runtime and licence, seven synthetic SVG assets, synthetic AppState seed data, two focused test scripts, this report, a concise architecture overview, and a recruiter-facing README.

The copied runtime categories are:

- application shell and workspace scripts
- AppState core services and domain services
- browser-local XLSX import and released-Revision export services
- required reference and initial-state definitions
- required CSS and reusable UI components
- JSZip 3.10.1 and its licence

## Content Intentionally Excluded

The following source-project categories were not copied:

- client workbooks and generated workbook exports
- embedded workbook images, drawings, CAD-derived images, and source screenshots
- browser evidence, test results, logs, state dumps, and backups
- historical milestone reports and client-specific documentation
- source-project development utilities and clean-state backup tooling
- source tests and fixtures containing client-derived examples
- repository metadata and local development artefacts

No `.xlsx`, `.xls`, raster screenshot, archive, state-backup, log, or browser-evidence file is present in the publication candidate.

## Identifier Audit

A private external scan manifest was used to search for known source identities without copying those confidential search terms into this public repository. The scan covered:

- organisation, customer, and OEM identities
- source programme and platform codes
- source Finished-Good Variant identifiers
- source Part and Drawing number prefixes
- source suppliers, business users, and workflow actors
- source workbook and worksheet-specific names
- source folder names and machine paths
- old storage, backup, cache, and image-reference namespaces

The final recursive scan returned no matches for the private identifier manifest. Generic engineering terms such as Programme, Customer / OEM, Part Number, Engineering BOM, and Complete Seat remain because they describe the product domain rather than a source identity.

## Replacements Performed

- Product branding is **Engineering BOM Lifecycle Platform**.
- The application header includes the subtle statement `Portfolio Demonstration — Synthetic automotive engineering data`.
- The browser title, export metadata, workbook titles, download filenames, README, and architecture overview use neutral portfolio branding.
- Customer, programme, variants, parts, drawings, suppliers, prices, ECNs, users, and revision examples are synthetic.
- Source-specific internal field aliases were replaced with neutral `internal` and `oem` terminology where practical.
- Import-reader and mapper names were made format-neutral.
- The public edition uses the isolated `engineeringBomLifecyclePortfolio.public.v2` storage namespace and a separate IndexedDB image namespace.

## Synthetic Demonstration Dataset

The default public AppState contains:

- 1 fictional programme: AX7
- 1 fictional customer: Orion Motors
- 3 fictional Finished-Good Variants: AX7-60P-E2, AX7-60P-E3, and AX7-60P-E4
- 10 typed Feature definitions and 3 independent Feature Configurations
- 19 fictional Parts with fictional Part and Drawing numbers
- 6 completed discipline Engineering BOMs
- 1 CURRENT generated Complete Seat JIT structure
- 6 Commodity master records and variant mappings
- 1 CURRENT Commercial Assessment with 13 commercial lines
- 3 fictional suppliers and fictional USD commercial values
- 2 fictional ECNs, including one implemented baseline ECN
- 1 immutable RELEASED Revision A

Seven original SVG illustrations were created specifically for this portfolio edition: complete seat, structure, foam, plastic, trim, head rest, and arm rest. No source image was copied or traced.

## Local Path and Asset Audit

The publication candidate contains no developer username, drive-letter path, user-home path, source-project path, or application-data path. Runtime references are relative paths. Static assets are limited to the seven synthetic SVG files; because SVG is text, each asset was also included in the recursive text scan.

## Validation Performed

Automated validation:

- public AppState and lifecycle test: 33 assertions passed
- JavaScript syntax sweep: 74 files passed
- AppState reference validation: passed
- generated XLSX package creation: passed
- released Revision export readiness: passed
- generated projection fingerprint regression: EPS CURRENT and Commercial Assessment CURRENT

Browser validation from the isolated public project:

- Dashboard loaded as the default workspace with synthetic KPI values.
- Feature Matrix rendered one active variant and supported two- and three-variant comparison.
- Show only differences reduced the comparison to changed Features.
- Structure, Foam, Plastic, Trim, Head Rest, and Arm Rest grids loaded synthetic hierarchy data.
- Complete Seat JIT loaded as CURRENT with source discipline and BOM traceability.
- All six synthetic discipline images and the complete-seat illustration loaded without broken references.
- Commercial Assessment loaded as CURRENT with fictional suppliers and prices.
- Engineering Change, Revision History, Commodity Master, Import BOM, and Excel Export loaded successfully.
- Revision A produced a browser download named from synthetic programme, variant, ECN, and revision data.
- Responsive checks passed at 1440, 1024, and 768 pixels with no page-level horizontal overflow.
- The image-preview dialog remained visible and closable at 768 pixels.
- Browser console warnings and errors: 0.

## Independence

The application is a static browser application and loads all runtime scripts, styles, seed data, and visual assets from this project. It does not reference or fetch files from the source project. Browser persistence is isolated by the public-only storage namespaces.

## Residual Risks

- The importer intentionally supports the known engineering workbook conventions implemented by the application; it is not a universal spreadsheet mapping engine.
- Browser-local storage is suitable for a portfolio demonstration, not multi-user production deployment.
- The synthetic seed demonstrates one released baseline. Recruiters can exercise additional edits, ECNs, revisions, and exports locally.
- Future changes should rerun the private identifier manifest, file-type audit, automated tests, and browser lifecycle validation before publication.

## Publication Recommendation

The candidate contains a purpose-built synthetic dataset, synthetic visual assets, neutral namespaces, and no copied confidential workbooks or evidence artefacts. The functional and privacy gates completed successfully.

SAFE FOR PUBLICATION
