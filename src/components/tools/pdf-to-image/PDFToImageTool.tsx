'use client';

import React, { useState, useCallback, useRef, useEffect } from 'react';
import { useTranslations } from 'next-intl';
import { AlertCircle, Check, FileArchive, Loader2, Trash2, X } from 'lucide-react';
import { FileUploader } from '../FileUploader';
import { ProcessingProgress, ProcessingStatus } from '../ProcessingProgress';
import { DownloadButton } from '../DownloadButton';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { pdfToImages, type ImageFormat, type PDFToImageOptions, type PageLayoutPreset } from '@/lib/pdf/processors/pdf-to-image';
import { Select } from '@/components/ui/FormField';
import type { ProcessOutput } from '@/types/pdf';
import JSZip from 'jszip';

const MAX_BATCH_FILES = 10;

type BatchFileStatus = 'pending' | 'processing' | 'completed' | 'error';

interface PDFToImageBatchFile {
  id: string;
  file: File;
  status: BatchFileStatus;
  progress: number;
  result?: Blob | Blob[];
  filename?: string;
  error?: string;
}

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

function getImageExtension(format: ImageFormat): string {
  return format === 'jpeg' ? 'jpg' : format;
}

function getBaseName(file: File): string {
  return file.name.replace(/\.pdf$/i, '');
}

function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

function getUniqueZipName(filename: string, usedNames: Set<string>): string {
  if (!usedNames.has(filename)) {
    usedNames.add(filename);
    return filename;
  }

  const extensionIndex = filename.lastIndexOf('.');
  const name = extensionIndex > -1 ? filename.slice(0, extensionIndex) : filename;
  const extension = extensionIndex > -1 ? filename.slice(extensionIndex) : '';
  let counter = 2;
  let candidate = `${name}_${counter}${extension}`;

  while (usedNames.has(candidate)) {
    counter += 1;
    candidate = `${name}_${counter}${extension}`;
  }

  usedNames.add(candidate);
  return candidate;
}

interface ImagePreviewProps {
  blob: Blob;
  alt: string;
  className?: string;
}

const ImagePreview: React.FC<ImagePreviewProps> = ({ blob, alt, className = '' }) => {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    const objectUrl = URL.createObjectURL(blob);
    setUrl(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [blob]);

  if (!url) return null;

  return <img src={url} alt={alt} className={className} />;
};

export interface PDFToImageToolProps {
  /** Custom class name */
  className?: string;
  /** Specific output format (e.g., 'jpg', 'png') */
  outputFormat?: ImageFormat;
}

/**
 * PDFToImageTool Component
 * Requirements: 5.1, 5.2
 *
 * Converts PDF pages to images (JPG, PNG, WebP, BMP, TIFF).
 */
export function PDFToImageTool({ className = '', outputFormat }: PDFToImageToolProps) {
  const t = useTranslations('common');
  const tTools = useTranslations('tools');

  // State
  const [files, setFiles] = useState<PDFToImageBatchFile[]>([]);
  const [status, setStatus] = useState<ProcessingStatus>('idle');
  const [progress, setProgress] = useState(0);
  const [progressMessage, setProgressMessage] = useState('');
  const [error, setError] = useState<string | null>(null);

  // Options state
  const [format, setFormat] = useState<ImageFormat>(outputFormat || 'png');
  const [quality, setQuality] = useState(0.92);
  const [scale, setScale] = useState(2);
  const [pageRange, setPageRange] = useState('');

  // Page layout state
  const [layoutPreset, setLayoutPreset] = useState<PageLayoutPreset>('1x1');
  const [customColumns, setCustomColumns] = useState(2);
  const [customRows, setCustomRows] = useState(2);
  const [skipFirstPage, setSkipFirstPage] = useState(false);

  // Ref for cancellation
  const cancelledRef = useRef(false);

  /**
   * Handle files selected from uploader
   */
  const handleFilesSelected = useCallback((newFiles: File[]) => {
    if (newFiles.length === 0) return;

    const availableSlots = MAX_BATCH_FILES - files.length;
    if (availableSlots <= 0) {
      setError(`Maximum ${MAX_BATCH_FILES} PDF files allowed.`);
      return;
    }

    const acceptedFiles = newFiles.slice(0, availableSlots);
    const batchFiles: PDFToImageBatchFile[] = acceptedFiles.map((file) => ({
      id: generateId(),
      file,
      status: 'pending',
      progress: 0,
    }));

    setFiles((prev) => [...prev, ...batchFiles]);
    setStatus('idle');
    setProgress(0);
    setProgressMessage('');
    setError(
      acceptedFiles.length < newFiles.length
        ? `Maximum ${MAX_BATCH_FILES} PDF files allowed. Added the first ${acceptedFiles.length}.`
        : null
    );
  }, [files.length]);

  /**
   * Handle file upload error
   */
  const handleUploadError = useCallback((errorMessage: string) => {
    setError(errorMessage);
  }, []);

  /**
   * Remove a file
   */
  const handleRemoveFile = useCallback((id: string) => {
    setFiles((prev) => prev.filter((batchFile) => batchFile.id !== id));
    setError(null);

    if (files.length === 1) {
      setStatus('idle');
      setProgress(0);
      setProgressMessage('');
    }
  }, [files.length]);

  /**
   * Clear all files
   */
  const handleClearFiles = useCallback(() => {
    setFiles([]);
    setError(null);
    setStatus('idle');
    setProgress(0);
    setProgressMessage('');
  }, []);

  /**
   * Parse page range string to array of page numbers
   */
  const parsePageRange = (rangeStr: string): number[] => {
    if (!rangeStr.trim()) return [];

    const pages: number[] = [];
    const parts = rangeStr.split(',');

    for (const part of parts) {
      const trimmed = part.trim();
      if (trimmed.includes('-')) {
        const [start, end] = trimmed.split('-').map(s => parseInt(s.trim(), 10));
        if (!isNaN(start) && !isNaN(end)) {
          for (let i = start; i <= end; i++) {
            if (!pages.includes(i)) pages.push(i);
          }
        }
      } else {
        const num = parseInt(trimmed, 10);
        if (!isNaN(num) && !pages.includes(num)) {
          pages.push(num);
        }
      }
    }

    return pages.sort((a, b) => a - b);
  };

  const getGridDimensions = useCallback((): [number, number] => {
    switch (layoutPreset) {
      case '1x1': return [1, 1];
      case '2x1': return [2, 1];
      case '1x2': return [1, 2];
      case '2x2': return [2, 2];
      case '3x3': return [3, 3];
      case 'custom': return [customColumns, customRows];
      default: return [1, 1];
    }
  }, [layoutPreset, customColumns, customRows]);

  /**
   * Handle convert operation
   */
  const handleConvert = useCallback(async () => {
    if (files.length === 0) {
      setError('Please upload one or more PDF files.');
      return;
    }

    const filesToProcess = files.map(({ id, file }) => ({ id, file }));
    const [cols, rows] = getGridDimensions();
    const options: Partial<PDFToImageOptions> = {
      format,
      quality,
      scale,
      pages: parsePageRange(pageRange),
      pageLayout: {
        preset: layoutPreset,
        columns: cols,
        rows,
        skipFirstPage,
      },
    };

    cancelledRef.current = false;
    setStatus('processing');
    setProgress(0);
    setProgressMessage('');
    setError(null);
    setFiles((prev) =>
      prev.map((batchFile) => ({
        id: batchFile.id,
        file: batchFile.file,
        status: 'pending',
        progress: 0,
      }))
    );

    let failedCount = 0;

    for (let index = 0; index < filesToProcess.length; index += 1) {
      const batchFile = filesToProcess[index];

      if (cancelledRef.current) break;

      setFiles((prev) =>
        prev.map((fileItem) =>
          fileItem.id === batchFile.id
            ? { ...fileItem, status: 'processing', progress: 0, error: undefined, result: undefined, filename: undefined }
            : fileItem
        )
      );
      setProgressMessage(`Converting ${index + 1}/${filesToProcess.length}: ${batchFile.file.name}`);

      try {
        const output: ProcessOutput = await pdfToImages(
          batchFile.file,
          options,
          (prog, message) => {
            if (!cancelledRef.current) {
              const overallProgress = Math.round(((index + prog / 100) / filesToProcess.length) * 100);
              setProgress(overallProgress);
              setProgressMessage(`Converting ${index + 1}/${filesToProcess.length}: ${message || batchFile.file.name}`);
              setFiles((prev) =>
                prev.map((fileItem) =>
                  fileItem.id === batchFile.id
                    ? { ...fileItem, progress: Math.round(prog) }
                    : fileItem
                )
              );
            }
          }
        );

        if (cancelledRef.current) break;

        if (output.success && output.result) {
          const result = output.result;
          setFiles((prev) =>
            prev.map((fileItem) =>
              fileItem.id === batchFile.id
                ? {
                    ...fileItem,
                    status: 'completed',
                    progress: 100,
                    result,
                    filename: output.filename,
                    error: undefined,
                  }
                : fileItem
            )
          );
        } else {
          failedCount += 1;
          setFiles((prev) =>
            prev.map((fileItem) =>
              fileItem.id === batchFile.id
                ? {
                    ...fileItem,
                    status: 'error',
                    progress: 100,
                    error: output.error?.message || 'Failed to convert PDF to images.',
                  }
                : fileItem
            )
          );
        }
      } catch (err) {
        if (!cancelledRef.current) {
          failedCount += 1;
          setFiles((prev) =>
            prev.map((fileItem) =>
              fileItem.id === batchFile.id
                ? {
                    ...fileItem,
                    status: 'error',
                    progress: 100,
                    error: err instanceof Error ? err.message : 'An unexpected error occurred.',
                  }
                : fileItem
            )
          );
        }
      }
    }

    if (cancelledRef.current) {
      setStatus('idle');
      setProgress(0);
      setProgressMessage('');
      return;
    }

    setProgress(100);
    setProgressMessage('');
    setStatus(failedCount > 0 ? 'error' : 'complete');
    setError(failedCount > 0 ? `${failedCount} file(s) failed to convert. See the file list for details.` : null);
  }, [files, getGridDimensions, format, quality, scale, pageRange, layoutPreset, skipFirstPage]);

  /**
   * Handle cancel operation
   */
  const handleCancel = useCallback(() => {
    cancelledRef.current = true;
    setStatus('idle');
    setProgress(0);
    setProgressMessage('');
    setFiles((prev) =>
      prev.map((batchFile) =>
        batchFile.status === 'processing'
          ? { ...batchFile, status: 'pending', progress: 0 }
          : batchFile
      )
    );
  }, []);

  /**
   * Download all images for one PDF as ZIP
   */
  const handleDownloadFileZip = useCallback(async (batchFile: PDFToImageBatchFile) => {
    if (!Array.isArray(batchFile.result)) return;

    const zip = new JSZip();
    const ext = getImageExtension(format);
    const baseName = getBaseName(batchFile.file);

    batchFile.result.forEach((blob, index) => {
      zip.file(`${baseName}_page_${index + 1}.${ext}`, blob);
    });

    const zipBlob = await zip.generateAsync({ type: 'blob' });
    downloadBlob(zipBlob, `${baseName}_images.zip`);
  }, [format]);

  /**
   * Download every completed image in the batch as one ZIP
   */
  const handleDownloadBatchZip = useCallback(async () => {
    const completedFiles = files.filter((batchFile) => batchFile.status === 'completed' && batchFile.result);
    if (completedFiles.length === 0) return;

    const zip = new JSZip();
    const usedNames = new Set<string>();
    const ext = getImageExtension(format);

    completedFiles.forEach((batchFile) => {
      if (!batchFile.result) return;

      const baseName = getBaseName(batchFile.file);

      if (Array.isArray(batchFile.result)) {
        batchFile.result.forEach((blob, index) => {
          zip.file(
            getUniqueZipName(`${baseName}_page_${index + 1}.${ext}`, usedNames),
            blob
          );
        });
      } else {
        zip.file(
          getUniqueZipName(batchFile.filename || `${baseName}.${ext}`, usedNames),
          batchFile.result
        );
      }
    });

    const zipBlob = await zip.generateAsync({ type: 'blob' });
    downloadBlob(zipBlob, `converted-${ext}-images.zip`);
  }, [files, format]);

  /**
   * Format file size
   */
  const formatSize = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const getStatusIcon = (fileStatus: BatchFileStatus) => {
    switch (fileStatus) {
      case 'pending':
        return <div className="w-4 h-4 rounded-full bg-gray-300" />;
      case 'processing':
        return <Loader2 className="w-4 h-4 animate-spin text-blue-500" />;
      case 'completed':
        return <Check className="w-4 h-4 text-green-500" />;
      case 'error':
        return <AlertCircle className="w-4 h-4 text-red-500" />;
    }
  };

  const getStatusLabel = (fileStatus: BatchFileStatus) => {
    switch (fileStatus) {
      case 'pending':
        return 'Pending';
      case 'processing':
        return 'Processing';
      case 'completed':
        return 'Complete';
      case 'error':
        return 'Error';
    }
  };

  const isProcessing = status === 'processing' || status === 'uploading';
  const hasFiles = files.length > 0;
  const canConvert = hasFiles && !isProcessing;
  const completedCount = files.filter((batchFile) => batchFile.status === 'completed').length;
  const errorCount = files.filter((batchFile) => batchFile.status === 'error').length;
  const hasCompletedFiles = completedCount > 0;
  const allCompleted = hasFiles && completedCount === files.length;
  const previewFiles = files.filter((batchFile) => batchFile.status === 'completed' && Array.isArray(batchFile.result) && batchFile.result.length > 1);
  const ext = getImageExtension(format);

  return (
    <div className={`space-y-6 ${className}`.trim()}>
      {/* File Upload Area */}
      <FileUploader
        accept={['application/pdf', '.pdf']}
        multiple={true}
        maxFiles={MAX_BATCH_FILES}
        onFilesSelected={handleFilesSelected}
        onError={handleUploadError}
        disabled={isProcessing}
        label={tTools('pdfToImage.uploadLabel') || 'Upload PDF files'}
        description={tTools('pdfToImage.uploadDescription') || `Drag and drop PDF files here, or click to browse. You can convert up to ${MAX_BATCH_FILES} files sequentially.`}
      />

      {/* Error Message */}
      {error && (
        <div
          className="p-4 rounded-[var(--radius-md)] bg-red-50 border border-red-200 text-red-700"
          role="alert"
        >
          <p className="text-sm">{error}</p>
        </div>
      )}

      {/* File List */}
      {hasFiles && (
        <Card variant="outlined" size="lg">
          <div className="flex items-center justify-between gap-3 mb-4">
            <h3 className="text-lg font-medium text-[hsl(var(--color-foreground))]">
              Files to Convert ({files.length})
            </h3>
            <Button
              variant="ghost"
              size="sm"
              onClick={handleClearFiles}
              disabled={isProcessing}
            >
              <Trash2 className="w-4 h-4" />
              {t('buttons.clearAll') || 'Clear All'}
            </Button>
          </div>

          <div className="space-y-2 max-h-72 overflow-y-auto">
            {files.map((batchFile) => {
              const resultCount = Array.isArray(batchFile.result) ? batchFile.result.length : batchFile.result ? 1 : 0;
              const singleResult = batchFile.result && !Array.isArray(batchFile.result) ? batchFile.result : null;

              return (
                <div
                  key={batchFile.id}
                  className="flex items-center justify-between gap-3 p-3 bg-[hsl(var(--color-muted)/0.3)] rounded-[var(--radius-md)]"
                >
                  <div className="flex items-center gap-3 flex-1 min-w-0">
                    {getStatusIcon(batchFile.status)}
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-[hsl(var(--color-foreground))] truncate">
                        {batchFile.file.name}
                      </p>
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                        <span className="text-xs text-[hsl(var(--color-muted-foreground))]">
                          {formatSize(batchFile.file.size)}
                        </span>
                        <span className="text-xs text-[hsl(var(--color-muted-foreground))]">
                          {getStatusLabel(batchFile.status)}
                        </span>
                        {batchFile.status === 'processing' && (
                          <span className="text-xs text-blue-500">
                            {batchFile.progress}%
                          </span>
                        )}
                        {batchFile.status === 'completed' && resultCount > 0 && (
                          <span className="text-xs text-green-600">
                            {resultCount} image{resultCount === 1 ? '' : 's'}
                          </span>
                        )}
                        {batchFile.status === 'error' && batchFile.error && (
                          <span className="text-xs text-red-600">
                            {batchFile.error}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>

                  {singleResult && (
                    <DownloadButton
                      file={singleResult}
                      filename={batchFile.filename || `${getBaseName(batchFile.file)}.${ext}`}
                      variant="ghost"
                      size="sm"
                      showFileSize={false}
                    />
                  )}

                  {Array.isArray(batchFile.result) && batchFile.result.length > 1 && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleDownloadFileZip(batchFile)}
                    >
                      <FileArchive className="w-4 h-4" />
                      ZIP
                    </Button>
                  )}

                  {!isProcessing && batchFile.status !== 'processing' && (
                    <button
                      type="button"
                      onClick={() => handleRemoveFile(batchFile.id)}
                      className="p-1 text-[hsl(var(--color-muted-foreground))] hover:text-red-500 transition-colors"
                      aria-label={`Remove ${batchFile.file.name}`}
                    >
                      <X className="w-4 h-4" />
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </Card>
      )}

      {/* Options Panel */}
      {hasFiles && (
        <Card variant="outlined">
          <h3 className="text-lg font-medium text-[hsl(var(--color-foreground))] mb-4">
            {tTools('pdfToImage.optionsTitle') || 'Conversion Options'}
          </h3>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {/* Output Format */}
            {!outputFormat && (
              <div>
                <label className="block text-sm font-medium text-[hsl(var(--color-foreground))] mb-2">
                  {tTools('pdfToImage.format') || 'Output Format'}
                </label>
                <Select
                  value={format}
                  onChange={(e) => setFormat(e.target.value as ImageFormat)}
                  disabled={isProcessing}
                >
                  <option value="png">PNG</option>
                  <option value="jpg">JPG</option>
                  <option value="webp">WebP</option>
                  <option value="bmp">BMP</option>
                  <option value="tiff">TIFF</option>
                </Select>
              </div>
            )}

            {/* Quality (for lossy formats) */}
            {['jpg', 'jpeg', 'webp'].includes(format) && (
              <div>
                <label className="block text-sm font-medium text-[hsl(var(--color-foreground))] mb-2">
                  {tTools('pdfToImage.quality') || 'Quality'} ({Math.round(quality * 100)}%)
                </label>
                <input
                  type="range"
                  min="0.1"
                  max="1"
                  step="0.05"
                  value={quality}
                  onChange={(e) => setQuality(parseFloat(e.target.value))}
                  disabled={isProcessing}
                  className="w-full"
                />
              </div>
            )}

            {/* Scale/DPI */}
            <div>
              <label className="block text-sm font-medium text-[hsl(var(--color-foreground))] mb-2">
                {tTools('pdfToImage.resolution') || 'Resolution'}
              </label>
              <Select
                value={scale}
                onChange={(e) => setScale(parseFloat(e.target.value))}
                disabled={isProcessing}
              >
                <option value="1">72 DPI (Low)</option>
                <option value="2">144 DPI (Medium)</option>
                <option value="3">216 DPI (High)</option>
                <option value="4">288 DPI (Very High)</option>
              </Select>
            </div>

            {/* Page Range */}
            <div>
              <label className="block text-sm font-medium text-[hsl(var(--color-foreground))] mb-2">
                {tTools('pdfToImage.pageRange') || 'Page Range'}
              </label>
              <input
                type="text"
                value={pageRange}
                onChange={(e) => setPageRange(e.target.value)}
                placeholder={tTools('pdfToImage.pageRangePlaceholder') || 'e.g., 1-3, 5, 7'}
                disabled={isProcessing}
                className="w-full px-3 py-2 rounded-[var(--radius-md)] border border-[hsl(var(--color-border))] bg-[hsl(var(--color-background))] text-[hsl(var(--color-foreground))] text-sm focus:outline-none focus:ring-2 focus:ring-[hsl(var(--color-primary))]"
              />
              <p className="text-xs text-[hsl(var(--color-muted-foreground))] mt-1">
                {tTools('pdfToImage.pageRangeHint') || 'Leave empty for all pages'}
              </p>
            </div>
          </div>

          {/* Page Layout Section */}
          <div className="mt-4 pt-4 border-t border-[hsl(var(--color-border))]">
            <label className="block text-sm font-medium text-[hsl(var(--color-foreground))] mb-3">
              {tTools('pdfToImage.layoutTitle') || 'Page Layout'}
            </label>

            {/* Layout Preset Selection */}
            <div className="grid grid-cols-3 sm:grid-cols-6 gap-2 mb-4">
              {([
                { value: '1x1', label: '1x1', cols: 1, rows: 1 },
                { value: '2x1', label: '2x1', cols: 2, rows: 1 },
                { value: '1x2', label: '1x2', cols: 1, rows: 2 },
                { value: '2x2', label: '2x2', cols: 2, rows: 2 },
                { value: '3x3', label: '3x3', cols: 3, rows: 3 },
                { value: 'custom', label: tTools('pdfToImage.customLayout') || 'Custom', cols: customColumns, rows: customRows },
              ] as const).map((preset) => (
                <button
                  key={preset.value}
                  type="button"
                  onClick={() => setLayoutPreset(preset.value)}
                  disabled={isProcessing}
                  className={`
                    p-3 rounded-lg border-2 transition-all flex flex-col items-center gap-1.5
                    ${layoutPreset === preset.value
                      ? 'border-[hsl(var(--color-primary))] bg-[hsl(var(--color-primary)/0.05)]'
                      : 'border-[hsl(var(--color-border))] hover:border-[hsl(var(--color-primary)/0.5)]'
                    }
                    disabled:opacity-50 disabled:cursor-not-allowed
                  `}
                >
                  {/* Mini grid preview */}
                  <div
                    className="grid gap-0.5"
                    style={{
                      gridTemplateColumns: `repeat(${preset.cols}, 1fr)`,
                      gridTemplateRows: `repeat(${preset.rows}, 1fr)`,
                      width: '32px',
                      height: '24px',
                    }}
                  >
                    {Array.from({ length: preset.cols * preset.rows }).map((_, idx) => (
                      <div
                        key={idx}
                        className={`rounded-sm ${layoutPreset === preset.value
                          ? 'bg-[hsl(var(--color-primary))]'
                          : 'bg-[hsl(var(--color-muted-foreground)/0.3)]'
                          }`}
                      />
                    ))}
                  </div>
                  <span className={`text-xs font-medium ${layoutPreset === preset.value
                    ? 'text-[hsl(var(--color-primary))]'
                    : 'text-[hsl(var(--color-muted-foreground))]'
                    }`}>
                    {preset.label}
                  </span>
                </button>
              ))}
            </div>

            {/* Custom Layout Inputs */}
            {layoutPreset === 'custom' && (
              <div className="flex gap-4 mb-4 p-3 rounded-lg bg-[hsl(var(--color-muted)/0.3)]">
                <div className="flex-1">
                  <label className="block text-xs font-medium text-[hsl(var(--color-foreground))] mb-1">
                    {tTools('pdfToImage.columns') || 'Columns'}
                  </label>
                  <input
                    type="number"
                    min={1}
                    max={10}
                    value={customColumns}
                    onChange={(e) => setCustomColumns(Math.max(1, Math.min(10, parseInt(e.target.value) || 1)))}
                    disabled={isProcessing}
                    className="w-full px-3 py-2 rounded-[var(--radius-md)] border border-[hsl(var(--color-border))] bg-[hsl(var(--color-background))] text-[hsl(var(--color-foreground))] text-sm focus:outline-none focus:ring-2 focus:ring-[hsl(var(--color-primary))]"
                  />
                </div>
                <div className="flex-1">
                  <label className="block text-xs font-medium text-[hsl(var(--color-foreground))] mb-1">
                    {tTools('pdfToImage.rows') || 'Rows'}
                  </label>
                  <input
                    type="number"
                    min={1}
                    max={10}
                    value={customRows}
                    onChange={(e) => setCustomRows(Math.max(1, Math.min(10, parseInt(e.target.value) || 1)))}
                    disabled={isProcessing}
                    className="w-full px-3 py-2 rounded-[var(--radius-md)] border border-[hsl(var(--color-border))] bg-[hsl(var(--color-background))] text-[hsl(var(--color-foreground))] text-sm focus:outline-none focus:ring-2 focus:ring-[hsl(var(--color-primary))]"
                  />
                </div>
              </div>
            )}

            {/* Skip First Page Option - only show when layout is not 1x1 */}
            {layoutPreset !== '1x1' && (
              <label className="flex items-center gap-3 cursor-pointer mb-4">
                <input
                  type="checkbox"
                  checked={skipFirstPage}
                  onChange={(e) => setSkipFirstPage(e.target.checked)}
                  disabled={isProcessing}
                  className="w-4 h-4 rounded border-[hsl(var(--color-border))] text-[hsl(var(--color-primary))] focus:ring-[hsl(var(--color-primary))]"
                />
                <span className="text-sm text-[hsl(var(--color-foreground))]">
                  {tTools('pdfToImage.skipFirstPage') || 'Without first/cover page'}
                </span>
              </label>
            )}

            {/* Layout Preview */}
            {layoutPreset !== '1x1' && (
              <div className="p-4 rounded-xl bg-gradient-to-br from-[hsl(var(--color-muted))] to-[hsl(var(--color-background))] border border-[hsl(var(--color-border))]">
                <div className="flex items-center gap-2 mb-3">
                  <div className="w-2 h-2 rounded-full bg-[hsl(var(--color-primary))]"></div>
                  <h4 className="text-sm font-semibold text-[hsl(var(--color-foreground))]">
                    {tTools('pdfToImage.layoutPreview') || 'Layout Preview'}
                  </h4>
                </div>

                <div className="flex flex-col sm:flex-row gap-4 items-center">
                  {/* Grid visualization */}
                  <div
                    className="border-2 border-[hsl(var(--color-primary)/0.3)] rounded-lg p-3 bg-white"
                    style={{ width: '140px', height: '100px' }}
                  >
                    <div
                      className="w-full h-full grid gap-1"
                      style={{
                        gridTemplateColumns: `repeat(${layoutPreset === 'custom' ? customColumns : parseInt(layoutPreset.split('x')[0])}, 1fr)`,
                        gridTemplateRows: `repeat(${layoutPreset === 'custom' ? customRows : parseInt(layoutPreset.split('x')[1])}, 1fr)`,
                      }}
                    >
                      {Array.from({ length: (layoutPreset === 'custom' ? customColumns * customRows : parseInt(layoutPreset.split('x')[0]) * parseInt(layoutPreset.split('x')[1])) }).map((_, idx) => (
                        <div
                          key={idx}
                          className="bg-gradient-to-br from-[hsl(var(--color-primary)/0.15)] to-[hsl(var(--color-primary)/0.05)] border border-[hsl(var(--color-primary)/0.2)] rounded flex items-center justify-center text-xs font-bold text-[hsl(var(--color-primary))]"
                        >
                          {idx + 1}
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Info */}
                  <div className="flex-1 text-sm text-[hsl(var(--color-muted-foreground))]">
                    <p>
                      <span className="font-medium text-[hsl(var(--color-foreground))]">
                        {layoutPreset === 'custom' ? `${customColumns}x${customRows}` : layoutPreset}
                      </span>
                      {' '}{tTools('pdfToImage.pagesPerImage') || 'pages per image'}
                    </p>
                    {skipFirstPage && (
                      <p className="mt-1 text-xs">
                        Note: {tTools('pdfToImage.skipFirstPageHint') || 'The first page (cover) will be rendered as a separate image'}
                      </p>
                    )}
                  </div>
                </div>
              </div>
            )}

            <p className="text-xs text-[hsl(var(--color-muted-foreground))] mt-3">
              {tTools('pdfToImage.layoutHint') || 'Combine multiple PDF pages into a single image with the selected grid layout.'}
            </p>
          </div>
        </Card>
      )}

      {/* Processing Progress */}
      {isProcessing && (
        <ProcessingProgress
          progress={progress}
          status={status}
          message={progressMessage}
          onCancel={handleCancel}
          showPercentage
        />
      )}

      {/* Action Buttons */}
      <div className="flex flex-wrap items-center gap-4">
        <Button
          variant="primary"
          size="lg"
          onClick={handleConvert}
          disabled={!canConvert}
          loading={isProcessing}
        >
          {isProcessing
            ? (t('status.processing') || 'Processing...')
            : (tTools('pdfToImage.convertButton') || 'Convert to Images')
          }
        </Button>

        {hasCompletedFiles && (
          <Button
            variant="secondary"
            size="lg"
            onClick={handleDownloadBatchZip}
            disabled={isProcessing}
          >
            <FileArchive className="w-4 h-4" />
            {tTools('pdfToImage.downloadZip') || 'Download All as ZIP'}
          </Button>
        )}
      </div>

      {/* Image Preview for multiple images */}
      {previewFiles.length > 0 && (
        <Card variant="outlined" size="lg">
          <h3 className="text-lg font-medium text-[hsl(var(--color-foreground))] mb-4">
            {tTools('pdfToImage.previewTitle') || 'Converted Images'} ({previewFiles.reduce((sum, batchFile) => sum + (Array.isArray(batchFile.result) ? batchFile.result.length : 0), 0)})
          </h3>
          <div className="space-y-6">
            {previewFiles.map((batchFile) => (
              <div key={batchFile.id}>
                {previewFiles.length > 1 && (
                  <p className="text-sm font-medium text-[hsl(var(--color-foreground))] mb-3">
                    {batchFile.file.name}
                  </p>
                )}
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
                  {(batchFile.result as Blob[]).map((blob, index) => (
                    <div key={index} className="relative group">
                      <div className="aspect-[3/4] rounded-[var(--radius-md)] border border-[hsl(var(--color-border))] overflow-hidden bg-[hsl(var(--color-muted)/0.3)]">
                        <ImagePreview
                          blob={blob}
                          alt={`${batchFile.file.name} page ${index + 1}`}
                          className="w-full h-full object-contain"
                        />
                      </div>
                      <span className="absolute top-2 left-2 px-2 py-1 rounded bg-black/50 text-white text-xs">
                        {index + 1}
                      </span>
                      <DownloadButton
                        file={blob}
                        filename={`${getBaseName(batchFile.file)}_page_${index + 1}.${ext}`}
                        variant="ghost"
                        size="sm"
                        className="absolute bottom-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity"
                        showFileSize={false}
                      />
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* Completion Message */}
      {allCompleted && (
        <div
          className="p-4 rounded-[var(--radius-md)] bg-green-50 border border-green-200 text-green-700"
          role="status"
        >
          <p className="text-sm font-medium">
            {tTools('pdfToImage.successMessage') || `PDF converted to images successfully for ${completedCount} file(s).`}
          </p>
        </div>
      )}

      {errorCount > 0 && !isProcessing && (
        <div
          className="p-4 rounded-[var(--radius-md)] bg-yellow-50 border border-yellow-200 text-yellow-800"
          role="status"
        >
          <p className="text-sm font-medium">
            {completedCount} file(s) completed, {errorCount} file(s) failed.
          </p>
        </div>
      )}
    </div>
  );
}

export default PDFToImageTool;
