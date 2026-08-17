# Architecture Overview

## Runtime Layers

1. `src/data/` defines neutral reference values, an empty root shape, and the synthetic AX7 seed.
2. `src/scripts/core/` provides AppState, persistence, context, permissions, audit, validation, and business errors.
3. `src/scripts/domain/` contains business services for engineering, commercial, governance, import, and export operations.
4. `src/scripts/import/` parses local Open XML workbooks and maps supported engineering structures.
5. `js/workspaces/` renders each user workspace and delegates business changes to domain services.
6. `css/` provides the compact enterprise grid and responsive application shell.

## Ownership Boundaries

- Engineering owns Parts, Engineering eBOMs, and generated Complete Seat JIT.
- Commercial owns supplier and cost information in Commercial Assessment lines.
- Engineering Change authorizes controlled modifications to released objects.
- Revision stores immutable released snapshots and is the only source for released Excel export.

## Persistence

The public edition uses the versioned `engineeringBomLifecyclePortfolio.public.v2` storage namespace. It does not read storage namespaces from any other edition. Workbook binaries are never stored in AppState or localStorage.

## Synthetic Dataset

The AX7 dataset was created from fictional programme, feature, part, drawing, supplier, price, ECN, and revision inputs. Synthetic SVG illustrations were created specifically for this edition and are not derived from external engineering media.
