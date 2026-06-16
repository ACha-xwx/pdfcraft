'use client';

import React, { useState, useCallback, useRef, useEffect } from 'react';
import { useTranslations } from 'next-intl';
import { FileUploader } from '../FileUploader';
import { ProcessingProgress, ProcessingStatus } from '../ProcessingProgress';
import { DownloadButton } from '../DownloadButton';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { ocrPDF, type OCROptions, type OCRLanguage, OCR_LANGUAGE_NAMES } from '@/lib/pdf/processors/ocr';
import { Select } from '@/components/ui/FormField';
import type { ProcessOutput } from '@/types/pdf';
import { 
  AlertCircle,
  Scan, 
  Settings2, 
  Trash2, 
  Check, 
  FileArchive,
  Loader2,
  X,
  Sparkles, 
  ShieldCheck,
  Languages
} from 'lucide-react';
import JSZip from 'jszip';

const MAX_BATCH_FILES = 10;

type BatchFileStatus = 'pending' | 'processing' | 'completed' | 'error';

interface OCRBatchFile {
  id: string;
  file: File;
  status: BatchFileStatus;
  progress: number;
  result?: Blob;
  filename?: string;
  textPreview?: string;
  error?: string;
}

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

function getOutputFilename(file: File, outputFormat: OCROptions['outputFormat']): string {
  const baseName = file.name.replace(/\.pdf$/i, '');
  return `${baseName}_ocr.${outputFormat === 'text' ? 'txt' : 'pdf'}`;
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

function readBlobText(blob: Blob): Promise<string> {
  if (typeof blob.text === 'function') {
    return blob.text();
  }

  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : '');
    reader.onerror = () => reject(reader.error || new Error('Failed to read OCR text preview.'));
    reader.readAsText(blob);
  });
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

export interface OCRPDFToolProps {
  className?: string;
}

export function OCRPDFTool({ className = '' }: OCRPDFToolProps) {
  const t = useTranslations('common');
  const tTools = useTranslations('tools');
  
  // State
  const [files, setFiles] = useState<OCRBatchFile[]>([]);
  const [status, setStatus] = useState<ProcessingStatus>('idle');
  const [progress, setProgress] = useState(0);
  const [progressMessage, setProgressMessage] = useState('');
  const [error, setError] = useState<string | null>(null);
  
  // Options state
  const [languages, setLanguages] = useState<OCRLanguage[]>(['eng']);
  const [outputFormat, setOutputFormat] = useState<OCROptions['outputFormat']>('searchable-pdf'); // Default to searchable PDF
  const [scale, setScale] = useState(2);
  const [pageRange, setPageRange] = useState('');
  
  // Canvas Ref for 3D Laser Mesh Scan animation
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animationRef = useRef<number>(0);
  const cancelledRef = useRef(false);

  // Render 3D wavy scanner grid in Canvas
  useEffect(() => {
    if (!canvasRef.current) return;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    canvas.width = 320;
    canvas.height = 200;

    let time = 0;

    const render = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      if (status === 'processing') {
        time += 0.05;
        
        ctx.strokeStyle = 'rgba(168, 85, 247, 0.25)'; // Purple mesh
        ctx.lineWidth = 1;

        const cols = 15;
        const rows = 10;
        const colWidth = canvas.width / cols;
        const rowHeight = canvas.height / rows;

        // Draw 3D projected perspective wireframe grid
        for (let r = 0; r <= rows; r++) {
          ctx.beginPath();
          for (let c = 0; c <= cols; c++) {
            // Apply 3D wavy distortion using sin/cos
            const z = Math.sin(c * 0.5 + time) * Math.cos(r * 0.4 + time) * 15;
            
            // 3D perspective projection formula
            const px = c * colWidth;
            const py = r * rowHeight + z;

            if (c === 0) {
              ctx.moveTo(px, py);
            } else {
              ctx.lineTo(px, py);
            }
          }
          ctx.stroke();
        }

        for (let c = 0; c <= cols; c++) {
          ctx.beginPath();
          for (let r = 0; r <= rows; r++) {
            const z = Math.sin(c * 0.5 + time) * Math.cos(r * 0.4 + time) * 15;
            const px = c * colWidth;
            const py = r * rowHeight + z;

            if (r === 0) {
              ctx.moveTo(px, py);
            } else {
              ctx.lineTo(px, py);
            }
          }
          ctx.stroke();
        }

        // Purple scanner laser line sliding top-to-bottom
        const laserY = (canvas.height / 2) + (canvas.height / 2.3) * Math.sin(time * 0.7);
        const gradient = ctx.createLinearGradient(0, laserY, canvas.width, laserY);
        gradient.addColorStop(0, 'rgba(168, 85, 247, 0)');
        gradient.addColorStop(0.5, 'rgba(168, 85, 247, 0.95)');
        gradient.addColorStop(1, 'rgba(168, 85, 247, 0)');

        ctx.strokeStyle = gradient;
        ctx.lineWidth = 4;
        ctx.shadowColor = 'rgba(168, 85, 247, 0.8)';
        ctx.shadowBlur = 12;
        ctx.beginPath();
        ctx.moveTo(10, laserY);
        ctx.lineTo(canvas.width - 10, laserY);
        ctx.stroke();
        ctx.shadowBlur = 0; // Reset
      } else {
        // Flat static tech grids in idle state
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.05)';
        ctx.lineWidth = 0.5;
        for (let x = 0; x < canvas.width; x += 20) {
          ctx.beginPath();
          ctx.moveTo(x, 0);
          ctx.lineTo(x, canvas.height);
          ctx.stroke();
        }
        for (let y = 0; y < canvas.height; y += 20) {
          ctx.beginPath();
          ctx.moveTo(0, y);
          ctx.lineTo(canvas.width, y);
          ctx.stroke();
        }
      }

      animationRef.current = requestAnimationFrame(render);
    };

    render();

    return () => {
      cancelAnimationFrame(animationRef.current);
    };
  }, [status]);

  const handleFilesSelected = useCallback((newFiles: File[]) => {
    if (newFiles.length === 0) return;

    const availableSlots = MAX_BATCH_FILES - files.length;
    if (availableSlots <= 0) {
      setError(`Maximum ${MAX_BATCH_FILES} PDF files allowed.`);
      return;
    }

    const acceptedFiles = newFiles.slice(0, availableSlots);
    const batchFiles: OCRBatchFile[] = acceptedFiles.map((file) => ({
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

  const handleUploadError = useCallback((errorMessage: string) => {
    setError(errorMessage);
  }, []);

  const handleRemoveFile = useCallback((id: string) => {
    setFiles((prev) => prev.filter((batchFile) => batchFile.id !== id));
    setError(null);

    if (files.length === 1) {
      setStatus('idle');
      setProgress(0);
      setProgressMessage('');
    }
  }, [files.length]);

  const handleClearFiles = useCallback(() => {
    setFiles([]);
    setError(null);
    setStatus('idle');
    setProgress(0);
  }, []);

  const toggleLanguage = useCallback((lang: OCRLanguage) => {
    setLanguages(prev => {
      if (prev.includes(lang)) {
        if (prev.length === 1) return prev;
        return prev.filter(l => l !== lang);
      }
      return [...prev, lang];
    });
  }, []);

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

  /**
   * Run OCR Parser
   */
  const handleOCR = useCallback(async () => {
    if (files.length === 0) {
      setError('Please upload one or more PDF files.');
      return;
    }

    const filesToProcess = files.map(({ id, file }) => ({ id, file }));
    const options: Partial<OCROptions> = {
      languages,
      outputFormat,
      scale,
      pages: parsePageRange(pageRange),
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
            ? { ...fileItem, status: 'processing', progress: 0, error: undefined, result: undefined, filename: undefined, textPreview: undefined }
            : fileItem
        )
      );
      setProgressMessage(`Processing ${index + 1}/${filesToProcess.length}: ${batchFile.file.name}`);

      try {
        const output: ProcessOutput = await ocrPDF(
          batchFile.file,
          options,
          (prog, message) => {
            if (!cancelledRef.current) {
              const overallProgress = Math.round(((index + prog / 100) / filesToProcess.length) * 100);
              setProgress(overallProgress);
              setProgressMessage(`Processing ${index + 1}/${filesToProcess.length}: ${message || batchFile.file.name}`);
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

        if (output.success && output.result && !Array.isArray(output.result)) {
          const blob = output.result;
          let textPreview: string | undefined;

          if (outputFormat === 'text') {
            const text = await readBlobText(blob);
            textPreview = text.length > 5000 ? `${text.substring(0, 5000)}\n...(truncated)` : text;
          }

          setFiles((prev) =>
            prev.map((fileItem) =>
              fileItem.id === batchFile.id
                ? {
                    ...fileItem,
                    status: 'completed',
                    progress: 100,
                    result: blob,
                    filename: output.filename || getOutputFilename(batchFile.file, outputFormat),
                    textPreview,
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
                    error: output.error?.message || 'Failed to perform OCR on PDF.',
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
    setError(failedCount > 0 ? `${failedCount} file(s) failed to process. See the file list for details.` : null);
  }, [files, languages, outputFormat, scale, pageRange]);

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

  const handleDownloadZip = useCallback(async () => {
    const completedFiles = files.filter((batchFile) => batchFile.status === 'completed' && batchFile.result);
    if (completedFiles.length === 0) return;

    const zip = new JSZip();
    const usedNames = new Set<string>();

    completedFiles.forEach((batchFile) => {
      if (!batchFile.result) return;
      const filename = getUniqueZipName(
        batchFile.filename || getOutputFilename(batchFile.file, outputFormat),
        usedNames
      );
      zip.file(filename, batchFile.result);
    });

    const zipBlob = await zip.generateAsync({ type: 'blob' });
    downloadBlob(zipBlob, 'ocr-results.zip');
  }, [files, outputFormat]);

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
  const canProcess = hasFiles && !isProcessing;
  const completedCount = files.filter((batchFile) => batchFile.status === 'completed').length;
  const errorCount = files.filter((batchFile) => batchFile.status === 'error').length;
  const hasCompletedFiles = completedCount > 0;
  const allCompleted = hasFiles && completedCount === files.length;
  const previewFiles = files.filter((batchFile) => batchFile.textPreview);

  const availableLanguages: OCRLanguage[] = ['eng', 'chi_sim', 'chi_tra', 'jpn', 'kor', 'spa', 'fra', 'deu', 'por', 'ara'];

  return (
    <div className={`space-y-6 ${className}`.trim()}>
      
      {/* File Upload Zone */}
      <FileUploader
        accept={['application/pdf', '.pdf']}
        multiple={true}
        maxFiles={MAX_BATCH_FILES}
        onFilesSelected={handleFilesSelected}
        onError={handleUploadError}
        disabled={isProcessing}
        label={tTools('ocrPdf.uploadLabel') || 'Upload PDF files'}
        description={tTools('ocrPdf.uploadDescription') || `Drag and drop scanned PDF files here, or click to browse. You can process up to ${MAX_BATCH_FILES} files sequentially.`}
      />

      {/* Error Block */}
      {error && (
        <div className="p-4 rounded-2xl bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-900/50 text-red-700 dark:text-red-400">
          <p className="text-sm font-semibold">{error}</p>
        </div>
      )}

      {/* File queue */}
      {hasFiles && (
        <Card variant="outlined" className="p-4 border-2 border-[hsl(var(--color-primary)/0.25)] rounded-2xl">
          <div className="flex items-center justify-between gap-3 mb-4">
            <h3 className="text-sm font-bold text-[hsl(var(--color-foreground))]">
              Files to OCR ({files.length})
            </h3>
            <Button variant="ghost" size="sm" onClick={handleClearFiles} disabled={isProcessing}>
              <Trash2 className="w-4 h-4" />
              {t('buttons.clearAll') || 'Clear All'}
            </Button>
          </div>

          <div className="space-y-2 max-h-72 overflow-y-auto">
            {files.map((batchFile) => (
              <div
                key={batchFile.id}
                className="flex items-center justify-between gap-3 p-3 rounded-xl bg-[hsl(var(--color-muted)/0.35)]"
              >
                <div className="flex items-center gap-3 flex-1 min-w-0">
                  {getStatusIcon(batchFile.status)}
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-sm text-[hsl(var(--color-foreground))] truncate">
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
                        <span className="text-xs text-blue-500">{batchFile.progress}%</span>
                      )}
                      {batchFile.status === 'completed' && batchFile.result && (
                        <span className="text-xs text-green-600">{formatSize(batchFile.result.size)}</span>
                      )}
                      {batchFile.status === 'error' && batchFile.error && (
                        <span className="text-xs text-red-600">{batchFile.error}</span>
                      )}
                    </div>
                  </div>
                </div>

                {batchFile.status === 'completed' && batchFile.result && (
                  <DownloadButton
                    file={batchFile.result}
                    filename={batchFile.filename || getOutputFilename(batchFile.file, outputFormat)}
                    variant="ghost"
                    size="sm"
                    showFileSize={false}
                  />
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
            ))}
          </div>
        </Card>
      )}

      {/* Primary Workspace */}
      {hasFiles && status !== 'complete' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-stretch">
          
          {/* LEFT: OCR Options */}
          <div className="lg:col-span-7 flex flex-col justify-between">
            <Card variant="default" className="flex-1 p-6 rounded-[2rem] border border-white/20 dark:border-zinc-800/40 bg-white/40 dark:bg-black/30 backdrop-blur-md flex flex-col justify-between shadow-xl space-y-6">
              
              <div className="space-y-4 flex-1">
                <div className="border-b border-[hsl(var(--color-border))] pb-3">
                  <h3 className="text-base font-bold text-[hsl(var(--color-foreground))] flex items-center gap-2">
                    <Settings2 className="w-5 h-5 text-[hsl(var(--color-primary))]" />
                    {t('ocr.optionsTitle')}
                  </h3>
                </div>

                {/* Multi language choice */}
                <div className="space-y-2">
                  <label className="text-xs font-bold text-[hsl(var(--color-muted-foreground))] uppercase tracking-wider flex items-center gap-1.5">
                    <Languages className="w-4 h-4" /> {t('ocr.selectLang')}
                  </label>
                  <div className="flex flex-wrap gap-1.5">
                    {availableLanguages.map(lang => (
                      <button
                        key={lang}
                        type="button"
                        onClick={() => toggleLanguage(lang)}
                        disabled={isProcessing}
                        className={`
                          px-3 py-1.5 rounded-xl text-xs font-bold transition-all border
                          ${languages.includes(lang)
                            ? 'bg-[hsl(var(--color-primary))] text-white border-[hsl(var(--color-primary))]'
                            : 'bg-white/50 dark:bg-zinc-800/50 text-zinc-600 border-[hsl(var(--color-border))]'
                          }
                        `}
                      >
                        {OCR_LANGUAGE_NAMES[lang]}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  {/* Format Output */}
                  <div>
                    <label className="block text-[11px] font-bold text-[hsl(var(--color-muted-foreground))] uppercase tracking-wider mb-2">
                      {t('ocr.outputFormat')}
                    </label>
                    <Select
                      value={outputFormat}
                      onChange={(e) => setOutputFormat(e.target.value as OCROptions['outputFormat'])}
                      disabled={isProcessing}
                    >
                      <option value="searchable-pdf">{t('ocr.formatSearchablePdf')}</option>
                      <option value="text">{t('ocr.formatText')}</option>
                    </Select>
                  </div>

                  {/* Resolution scale */}
                  <div>
                    <label className="block text-[11px] font-bold text-[hsl(var(--color-muted-foreground))] uppercase tracking-wider mb-2">
                      {t('ocr.accuracyTitle')}
                    </label>
                    <Select
                      value={scale}
                      onChange={(e) => setScale(parseFloat(e.target.value))}
                      disabled={isProcessing}
                    >
                      <option value="1">{t('ocr.accuracySd')}</option>
                      <option value="2">{t('ocr.accuracyHd')}</option>
                      <option value="3">{t('ocr.accuracyUd')}</option>
                    </Select>
                  </div>

                  {/* Range */}
                  <div>
                    <label className="block text-[11px] font-bold text-[hsl(var(--color-muted-foreground))] uppercase tracking-wider mb-2">
                      {t('ocr.specifyPages')}
                    </label>
                    <input
                      type="text"
                      value={pageRange}
                      onChange={(e) => setPageRange(e.target.value)}
                      placeholder={t('ocr.pagesPlaceholder')}
                      disabled={isProcessing}
                      className="w-full px-3 py-2 rounded-xl border border-[hsl(var(--color-border))] bg-white dark:bg-zinc-800 text-xs focus:ring-1 focus:ring-[hsl(var(--color-primary))]"
                    />
                  </div>
                </div>
              </div>

              {/* Start Trigger */}
              <div className="pt-4 border-t border-[hsl(var(--color-border))] mt-6">
                <Button
                  variant="primary"
                  size="lg"
                  className="w-full py-4 font-bold shadow-lg flex items-center justify-center gap-2"
                  onClick={handleOCR}
                  disabled={!canProcess}
                >
                  <Scan className="w-5 h-5" />
                  {t('ocr.startOcr')}
                </Button>
                {hasCompletedFiles && (
                  <Button
                    variant="secondary"
                    size="lg"
                    onClick={handleDownloadZip}
                    disabled={isProcessing}
                    className="w-full mt-3 font-bold"
                  >
                    <FileArchive className="w-4 h-4" />
                    {t('batchProcessing.downloadZip') || 'Download as ZIP'}
                  </Button>
                )}
              </div>

            </Card>
          </div>

          {/* RIGHT: 3D Holographic Wireframe Scan visualizer */}
          <div className="lg:col-span-5 flex flex-col justify-between">
            <Card variant="outlined" className="flex-1 p-6 bg-zinc-950 border-2 border-dashed border-[hsl(var(--color-border))] rounded-[2rem] flex flex-col items-center justify-center relative overflow-hidden shadow-inner h-full min-h-[380px]">
              
              {/* Scan grid canvas */}
              <div className="relative w-full aspect-video flex items-center justify-center z-10">
                <canvas ref={canvasRef} className="w-full max-w-[280px] h-full" />
                {/* Floating alert */}
                {status === 'processing' && (
                  <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                    <div className="px-3 py-1.5 rounded-full bg-purple-500/10 border border-purple-500/20 text-purple-400 font-bold text-[10px] tracking-widest uppercase animate-pulse">
                      Analyzing Pixels
                    </div>
                  </div>
                )}
              </div>

              {/* Info text box */}
              <div className="w-full mt-4 bg-zinc-900/50 border border-zinc-800 rounded-2xl p-4 z-20 space-y-1.5">
                <h4 className="text-[10px] font-black tracking-widest text-purple-400 uppercase flex items-center gap-1.5">
                  <Sparkles className="w-4 h-4 text-purple-400" />
                  {t('ocr.advantageTitle')}
                </h4>
                <p className="text-[10px] text-zinc-400 leading-relaxed pl-1">
                  {t.rich('ocr.advantageDesc', {
                    b: (chunks) => <b>{chunks}</b>
                  })}
                </p>
              </div>

            </Card>
          </div>

        </div>
      )}

      {/* Progress Block */}
      {isProcessing && progress > 5 && (
        <ProcessingProgress
          progress={progress}
          status={status}
          message={progressMessage}
          onCancel={handleCancel}
          showPercentage
        />
      )}

      {/* Complete Outcomes screen */}
      {allCompleted && (
        <Card variant="default" className="p-8 rounded-[2.5rem] bg-white/40 dark:bg-black/30 backdrop-blur-md border border-white/20 dark:border-zinc-800/40 text-center space-y-6 shadow-2xl">
          <div className="w-16 h-16 rounded-full bg-emerald-500/10 text-emerald-500 flex items-center justify-center mx-auto">
            <ShieldCheck className="w-10 h-10" />
          </div>

          <div className="space-y-2 max-w-sm mx-auto">
            <h3 className="text-base font-extrabold text-[hsl(var(--color-foreground))]">{t('ocr.successTitle')}</h3>
            <p className="text-xs text-[hsl(var(--color-muted-foreground))]">
              {outputFormat === 'searchable-pdf' 
                ? t('ocr.successSearchable') 
                : t('ocr.successText')
              }
            </p>
          </div>

          <div className="flex gap-3 justify-center max-w-xs mx-auto">
            <Button
              variant="primary"
              size="lg"
              onClick={handleDownloadZip}
              className="flex-1 font-bold shadow-lg"
              disabled={isProcessing}
            >
              <FileArchive className="w-4 h-4" />
              {t('batchProcessing.downloadZip') || 'Download as ZIP'}
            </Button>
          </div>
        </Card>
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

      {/* Pure text preview box */}
      {previewFiles.length > 0 && (
        <Card variant="outlined" size="lg" className="rounded-3xl shadow-sm">
          <h3 className="text-sm font-bold text-[hsl(var(--color-foreground))] mb-4">
            {t('ocr.previewTitle')}
          </h3>
          <div className="space-y-4">
            {previewFiles.map((batchFile) => (
              <div key={batchFile.id}>
                {previewFiles.length > 1 && (
                  <p className="text-sm font-semibold text-[hsl(var(--color-foreground))] mb-2">
                    {batchFile.file.name}
                  </p>
                )}
                <pre className="p-4 bg-[hsl(var(--color-muted)/0.35)] border border-[hsl(var(--color-border))] rounded-2xl overflow-auto max-h-64 text-xs font-mono text-[hsl(var(--color-foreground))] whitespace-pre-wrap leading-normal">
                  {batchFile.textPreview}
                </pre>
              </div>
            ))}
          </div>
        </Card>
      )}

    </div>
  );
}

export default OCRPDFTool;
