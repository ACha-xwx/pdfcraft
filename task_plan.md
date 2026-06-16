# Task Plan: Batch PDF Tool Sync

## Goal
Sync the batch OCR PDF and PDF-to-PNG functionality into `C:\Users\ACha_\Documents\GitHub\pdfcraft` without carrying over unrelated changes from the older `D:\Projects\pdfcraft` checkout.

## Current Phase
Phase 4

## Phases

### Phase 1: Requirements & Discovery
- [x] Confirm latest repository path.
- [x] Check current git status and local instructions.
- [x] Identify old checkout as reference source only.
- **Status:** complete

### Phase 2: Port Implementation
- [x] Finish OCR batch port and clean up unused state.
- [x] Port PDF-to-PNG batch conversion.
- [x] Update tool config and locale messages.
- [x] Add focused component tests.
- **Status:** complete

### Phase 3: Verification
- [x] Run targeted Vitest tests.
- [x] Run type check and report only relevant failures.
- [x] Run diff whitespace check.
- **Status:** complete

### Phase 4: Delivery
- [x] Review touched files.
- [x] Summarize synced changes and caveats.
- **Status:** complete

## Key Questions
1. Can the newer UI structure in the latest repo keep its current styling while gaining batch behavior?
2. Do mixed success/failure batches still expose downloads for completed files?

## Decisions Made
| Decision | Rationale |
|----------|-----------|
| Treat `D:\Projects\pdfcraft` as a reference only | The latest repo is newer and has different component structure. |
| Keep edits scoped to OCR PDF, PDF-to-PNG, messages, config, and focused tests | Avoid syncing unrelated changes from the old checkout. |
| Expose batch ZIP whenever at least one file completes | Mixed success/failure runs should still let the user retrieve successful outputs. |
| Keep PDF-to-image default batch limit at 10 and pass 20 only for PNG | The user asked for OCR PDF and PDF-to-PNG only. |
| Replace OCR native selects with segmented buttons while preserving option copy | The issue was visual fit, not wording. |

## Errors Encountered
| Error | Attempt | Resolution |
|-------|---------|------------|
| Planning files were created in the old checkout because the patch tool used the thread cwd | 1 | Removed those three planning files from the old checkout and recreated them with absolute paths in the latest repo. |
| Vitest could not resolve local packages because the latest repo had no `node_modules` | 1 | Installing dependencies with `npm ci --ignore-scripts` before rerunning verification. |
| `npm ci --ignore-scripts` kept running beyond several minutes | 1 | Stopped the npm process after key test dependencies appeared, then continued with targeted verification. |
| Local Next dev server returned 500 during browser verification because the partial `node_modules` install is missing `next/dist/compiled/source-map08/mappings.wasm` | 1 | Stopped the temporary dev server and relied on targeted component tests plus static review; reinstall dependencies before browser QA. |

## Notes
- Follow the existing component style in the latest repo.
- Batch processing should be sequential, with per-file status and downloads.
