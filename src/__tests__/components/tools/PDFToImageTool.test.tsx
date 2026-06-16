import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { PDFToImageTool } from '@/components/tools/pdf-to-image/PDFToImageTool';
import { pdfToImages } from '@/lib/pdf/processors/pdf-to-image';

const translationMap: Record<string, string> = {
  'buttons.upload': 'Upload Files',
  'buttons.clearAll': 'Clear All',
  'buttons.download': 'Download',
  'status.processing': 'Processing',
  'buttons.cancel': 'Cancel',
  'fileUploader.dragDrop': 'Drag and drop files here, or click to browse',
  'fileUploader.support': 'Support',
  'fileUploader.dropToUpload': 'Drop files here',
  'pdfToImage.uploadLabel': 'Upload PDF Files',
  'pdfToImage.uploadDescription': 'Upload PDFs',
  'pdfToImage.optionsTitle': 'Conversion Options',
  'pdfToImage.format': 'Output Format',
  'pdfToImage.quality': 'Quality',
  'pdfToImage.resolution': 'Resolution',
  'pdfToImage.pageRange': 'Page Range',
  'pdfToImage.pageRangePlaceholder': 'e.g., 1-3',
  'pdfToImage.pageRangeHint': 'Leave empty',
  'pdfToImage.layoutTitle': 'Page Layout',
  'pdfToImage.customLayout': 'Custom',
  'pdfToImage.columns': 'Columns',
  'pdfToImage.rows': 'Rows',
  'pdfToImage.skipFirstPage': 'Without first/cover page',
  'pdfToImage.skipFirstPageHint': 'Cover page separate',
  'pdfToImage.layoutPreview': 'Layout Preview',
  'pdfToImage.pagesPerImage': 'pages per image',
  'pdfToImage.layoutHint': 'Layout hint',
  'pdfToImage.convertButton': 'Convert to Images',
  'pdfToImage.downloadZip': 'Download All as ZIP',
  'pdfToImage.previewTitle': 'Converted Images',
  'pdfToImage.successMessage': 'Conversion complete',
};

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => translationMap[key] || key,
}));

vi.mock('pdf-lib', () => ({
  PDFDocument: {
    load: vi.fn(async () => ({})),
  },
}));

vi.mock('@/lib/pdf/processors/pdf-to-image', async () => {
  const actual = await vi.importActual<typeof import('@/lib/pdf/processors/pdf-to-image')>('@/lib/pdf/processors/pdf-to-image');
  return {
    ...actual,
    pdfToImages: vi.fn(),
  };
});

function createPdfFile(name: string): File {
  return new File(['%PDF-1.4'], name, { type: 'application/pdf' });
}

describe('PDFToImageTool batch processing', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('uploads multiple PDFs and converts them sequentially', async () => {
    const firstFile = createPdfFile('first.pdf');
    const secondFile = createPdfFile('second.pdf');
    const calls: string[] = [];

    vi.mocked(pdfToImages).mockImplementation(async (file, _options, onProgress) => {
      calls.push(file.name);
      onProgress?.(100, `Done ${file.name}`);
      return {
        success: true,
        result: new Blob([`image for ${file.name}`], { type: 'image/png' }),
        filename: `${file.name.replace(/\.pdf$/i, '')}.png`,
      };
    });

    render(<PDFToImageTool outputFormat="png" />);

    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    Object.defineProperty(input, 'files', {
      value: [firstFile, secondFile],
      configurable: true,
    });
    fireEvent.change(input);

    await waitFor(() => {
      expect(screen.getByText('Files to Convert (2)')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: /convert to images/i }));

    await waitFor(() => {
      expect(pdfToImages).toHaveBeenCalledTimes(2);
    });

    expect(calls).toEqual(['first.pdf', 'second.pdf']);
    await waitFor(() => {
      expect(screen.getAllByText('Complete')).toHaveLength(2);
    });
    expect(screen.getByRole('button', { name: /download all as zip/i })).toBeInTheDocument();
  });
});
