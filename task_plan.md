# Task Plan: Batch PDF Tool Sync

## Goal
Sync the batch OCR PDF and PDF-to-PNG functionality into `C:\Users\ACha_\Documents\GitHub\pdfcraft` without carrying over unrelated changes from the older `D:\Projects\pdfcraft` checkout.

## Current Phase
Phase 3

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
- [ ] Run targeted Vitest tests.
- [ ] Run type check and report only relevant failures.
- [ ] Run diff whitespace check.
- **Status:** in_progress

### Phase 4: Delivery
- [ ] Review touched files.
- [ ] Summarize synced changes and caveats.
- **Status:** pending

## Key Questions
1. Can the newer UI structure in the latest repo keep its current styling while gaining batch behavior?
2. Do mixed success/failure batches still expose downloads for completed files?

## Decisions Made
| Decision | Rationale |
|----------|-----------|
| Treat `D:\Projects\pdfcraft` as a reference only | The latest repo is newer and has different component structure. |
| Keep edits scoped to OCR PDF, PDF-to-PNG, messages, config, and focused tests | Avoid syncing unrelated changes from the old checkout. |
| Expose batch ZIP whenever at least one file completes | Mixed success/failure runs should still let the user retrieve successful outputs. |

## Errors Encountered
| Error | Attempt | Resolution |
|-------|---------|------------|
| Planning files were created in the old checkout because the patch tool used the thread cwd | 1 | Removed those three planning files from the old checkout and recreated them with absolute paths in the latest repo. |
| Vitest could not resolve local packages because the latest repo had no `node_modules` | 1 | Installing dependencies with `npm ci --ignore-scripts` before rerunning verification. |
| `npm ci --ignore-scripts` kept running beyond several minutes | 1 | Stopped the npm process after key test dependencies appeared, then continued with targeted verification. |

## Notes
- Follow the existing component style in the latest repo.
- Batch processing should be sequential, with per-file status and downloads.
