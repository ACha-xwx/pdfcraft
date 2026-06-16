import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { OCRPDFTool } from '@/components/tools/ocr/OCRPDFTool';
import { ocrPDF } from '@/lib/pdf/processors/ocr';

const translationMap: Record<string, string> = {
  'buttons.upload': 'Upload Files',
  'buttons.clearAll': 'Clear All',
  'buttons.download': 'Download',
  'batchProcessing.downloadZip': 'Download as ZIP',
  'status.processing': 'Processing',
  'buttons.cancel': 'Cancel',
  'fileUploader.dragDrop': 'Drag and drop files here, or click to browse',
  'fileUploader.support': 'Support',
  'fileUploader.dropToUpload': 'Drop files here',
  'ocr.startOcr': 'Start OCR',
  'ocr.optionsTitle': 'OCR Options',
  'ocr.selectLang': 'Languages',
  'ocr.outputFormat': 'Output Format',
  'ocr.formatSearchablePdf': 'Searchable PDF',
  'ocr.formatText': 'Text File',
  'ocr.accuracyTitle': 'Accuracy',
  'ocr.accuracySd': 'Standard',
  'ocr.accuracyHd': 'High',
  'ocr.accuracyUd': 'Ultra',
  'ocr.specifyPages': 'Pages',
  'ocr.pagesPlaceholder': 'e.g., 1-3',
  'ocr.advantageTitle': 'OCR Advantage',
  'ocr.advantageDesc': 'OCR advantage text',
  'ocr.successTitle': 'OCR Complete',
  'ocr.successSearchable': 'Searchable PDFs ready',
  'ocr.successText': 'Text files ready',
  'ocr.previewTitle': 'Extracted Text Preview',
  'ocrPdf.uploadLabel': 'Upload PDF Files',
  'ocrPdf.uploadDescription': 'Upload scanned PDFs',
};

vi.mock('next-intl', () => ({
  useTranslations: () => {
    const t = (key: string) => translationMap[key] || key;
    t.rich = (key: string) => translationMap[key] || key;
    return t;
  },
}));

vi.mock('pdf-lib', () => ({
  PDFDocument: {
    load: vi.fn(async () => ({})),
  },
}));

vi.mock('@/lib/pdf/processors/ocr', async () => {
  const actual = await vi.importActual<typeof import('@/lib/pdf/processors/ocr')>('@/lib/pdf/processors/ocr');
  return {
    ...actual,
    ocrPDF: vi.fn(),
  };
});

function createPdfFile(name: string): File {
  return new File(['%PDF-1.4'], name, { type: 'application/pdf' });
}

describe('OCRPDFTool batch processing', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    HTMLCanvasElement.prototype.getContext = vi.fn(() => ({
      clearRect: vi.fn(),
      beginPath: vi.fn(),
      moveTo: vi.fn(),
      lineTo: vi.fn(),
      stroke: vi.fn(),
      createLinearGradient: vi.fn(() => ({
        addColorStop: vi.fn(),
      })),
      set strokeStyle(_value: string | CanvasGradient) {},
      set lineWidth(_value: number) {},
      set shadowColor(_value: string) {},
      set shadowBlur(_value: number) {},
    })) as unknown as typeof HTMLCanvasElement.prototype.getContext;
  });

  it('uploads multiple PDFs and processes them sequentially', async () => {
    const firstFile = createPdfFile('first.pdf');
    const secondFile = createPdfFile('second.pdf');
    const calls: string[] = [];

    vi.mocked(ocrPDF).mockImplementation(async (file, _options, onProgress) => {
      calls.push(file.name);
      onProgress?.(100, `Done ${file.name}`);
      return {
        success: true,
        result: new Blob([`text for ${file.name}`], { type: 'text/plain' }),
        filename: `${file.name.replace(/\.pdf$/i, '')}_ocr.txt`,
      };
    });

    render(<OCRPDFTool />);

    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    Object.defineProperty(input, 'files', {
      value: [firstFile, secondFile],
      configurable: true,
    });
    fireEvent.change(input);

    await waitFor(() => {
      expect(screen.getByText('Files to OCR (2)')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: /start ocr/i }));

    await waitFor(() => {
      expect(ocrPDF).toHaveBeenCalledTimes(2);
    });

    expect(calls).toEqual(['first.pdf', 'second.pdf']);
    await waitFor(() => {
      expect(screen.getAllByText('Complete')).toHaveLength(2);
    });
    expect(screen.getByRole('button', { name: /download as zip/i })).toBeInTheDocument();
  });
});
