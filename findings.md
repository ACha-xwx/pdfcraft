# Findings & Decisions

## Requirements
- Add batch upload/processing to OCR PDF and PDF-to-PNG.
- Allow uploading multiple PDFs at once, then process them sequentially.
- Sync the work into `C:\Users\ACha_\Documents\GitHub\pdfcraft`, not the older `D:\Projects\pdfcraft` checkout.
- Avoid unrelated changes from the old checkout.

## Research Findings
- Latest repo started clean except for the in-progress OCR component port.
- Latest repo has no `AGENTS.md` discovered under `C:\Users\ACha_\Documents\GitHub\pdfcraft`.
- `FileUploader` already supports `multiple` and `maxFiles`.
- Latest OCR component has a newer visual/layout structure than the old checkout.
- Latest PDF-to-PNG component uses the newer `Select` component and should preserve that pattern.
- Old checkout's OCR and PDF-to-PNG batch logic is usable as behavior reference, but component files diverged enough that direct replacement would drop newer UI.
- OCR port in latest repo still needs a visible batch ZIP button for mixed success/failure batches, otherwise completed files are only downloadable one by one.
- PDF-to-PNG layout labels had mojibake in the latest repo. Since the touched area needed editing, labels were changed to ASCII `1x1`, `2x1`, etc. to avoid encoding breakage.

## Technical Decisions
| Decision | Rationale |
|----------|-----------|
| Use per-file batch state in each tool component | Keeps sequential processing local to the tool and avoids broader architecture changes. |
| Use JSZip in the components for batch downloads | Matches existing old-checkout implementation and already fits the project dependencies. |
| Preserve latest repo UI primitives | Reduces blast radius and avoids reverting newer UI changes. |
| Expose batch ZIP whenever at least one file completes | Mixed success/failure runs should still let the user retrieve successful outputs. |
| Keep tests focused on component orchestration | Processor behavior is already outside this UI change; tests mock processors and verify batch ordering. |

## Issues Encountered
| Issue | Resolution |
|-------|------------|
| Patch tool initially targeted `D:\Projects\pdfcraft` | Deleted the temporary planning files from old checkout and switched future patches to absolute latest-repo paths. |

## Resources
- Latest repo: `C:\Users\ACha_\Documents\GitHub\pdfcraft`
- Reference repo: `D:\Projects\pdfcraft`
- Target components:
  - `src/components/tools/ocr/OCRPDFTool.tsx`
  - `src/components/tools/pdf-to-image/PDFToImageTool.tsx`
  - `src/config/tools.ts`
  - `messages/en.json`
  - `messages/zh.json`

## Visual/Browser Findings
- No browser verification has been run yet.
