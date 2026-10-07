import React, { useState, useRef, useEffect, useCallback } from 'react';
import { X, Download, ZoomIn, ZoomOut, RotateCw, ChevronLeft, ChevronRight } from 'lucide-react';
import { createPortal } from 'react-dom';
import { cx } from '../lib/utils';
import { api } from '../lib/api';

export interface ViewableAttachment {
  id: number;
  filename: string;
  stored_name: string;
  mime?: string;
  size?: number;
  file_path?: string;
}

const IMAGE_EXT = /\.(jpe?g|png|gif|webp|bmp|svg)$/i;
const PDF_EXT = /\.pdf$/i;
const WORD_EXT = /\.(docx?)$/i;
const EXCEL_EXT = /\.(xlsx?|csv)$/i;
const TEXT_EXT = /\.(txt|md|log|json|csv)$/i;

export function getFileType(storedName: string, mime?: string): 'image' | 'pdf' | 'word' | 'excel' | 'text' | 'other' {
  const ext = (storedName || '').toLowerCase();
  if (PDF_EXT.test(ext) || mime === 'application/pdf') return 'pdf';
  if (IMAGE_EXT.test(ext) || (mime && mime.startsWith('image/'))) return 'image';
  if (WORD_EXT.test(ext) || mime?.includes('wordprocessingml') || mime === 'application/msword') return 'word';
  if (EXCEL_EXT.test(ext) || mime?.includes('spreadsheetml') || mime === 'application/vnd.ms-excel' || mime === 'text/csv') return 'excel';
  if (TEXT_EXT.test(ext) || mime?.startsWith('text/')) return 'text';
  return 'other';
}

export function DocumentViewer({
  open,
  onClose,
  attachments,
  initialIndex = 0,
}: {
  open: boolean;
  onClose: () => void;
  attachments: ViewableAttachment[];
  initialIndex?: number;
}) {
  const [index, setIndex] = useState(initialIndex);
  const [zoom, setZoom] = useState(100);
  const [rotation, setRotation] = useState(0);
  const overlayRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open) {
      setIndex(initialIndex);
      setZoom(100);
      setRotation(0);
    }
  }, [open, initialIndex]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowLeft') setIndex((i) => (i > 0 ? i - 1 : i));
      if (e.key === 'ArrowRight') setIndex((i) => (i < attachments.length - 1 ? i + 1 : i));
    };
    window.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => { window.removeEventListener('keydown', onKey); document.body.style.overflow = ''; };
  }, [open, onClose, attachments.length]);

  if (!open || index >= attachments.length) return null;

  const doc = attachments[index];
  const fileInfo = getFileType(doc.stored_name || doc.file_path || '', doc.mime);
  const viewerUrl = `/api/uploads/file/${doc.stored_name}`;
  const downloadUrl = `/api/uploads/file/${doc.stored_name}/download`;

  const handlePrev = () => setIndex((i) => Math.max(0, i - 1));
  const handleNext = () => setIndex((i) => Math.min(attachments.length - 1, i + 1));
  const handleZoomIn = () => setZoom((z) => Math.min(300, z + 20));
  const handleZoomOut = () => setZoom((z) => Math.max(50, z - 20));
  const handleRotate = () => setRotation((r) => (r + 90) % 360);

  const renderPreview = () => {
    switch (fileInfo) {
      case 'image':
        return (
          <img
            src={viewerUrl}
            alt={doc.filename}
            style={{ transform: `rotate(${rotation}deg)`, maxWidth: `${zoom}%`, maxHeight: '90vh' }}
            className="max-w-full transition-transform object-contain"
          />
        );
      case 'pdf':
        return (
          <iframe
            src={viewerUrl}
            title={doc.filename}
            className="w-full h-[90vh] border-none"
          />
        );
      case 'text':
        return (
          <iframe
            src={viewerUrl}
            title={doc.filename}
            className="w-full h-[90vh] border-none bg-card2/30 font-mono text-sm"
          />
        );
      case 'word':
      case 'excel':
        return (
          <div className="text-center py-12">
            <div className="text-6xl mb-4 opacity-20">📄</div>
            <h3 className="text-lg font-semibold mb-2">Preview not available</h3>
            <p className="text-sm text-ink3 mb-4">{doc.filename} ({fileInfo.toUpperCase()})</p>
            <p className="text-xs text-ink4">Download the file to view its contents.</p>
          </div>
        );
      default:
        return (
          <div className="text-center py-12">
            <div className="text-6xl mb-4 opacity-20">📎</div>
            <h3 className="text-lg font-semibold mb-2">Preview not available</h3>
            <p className="text-sm text-ink3 mb-4">{doc.filename}</p>
            <p className="text-xs text-ink4">This file type cannot be previewed in-app.</p>
          </div>
        );
    }
  };

  return createPortal(
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center bg-black/80 backdrop-blur-sm"
      ref={overlayRef}
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="relative w-full max-w-5xl max-h-[95vh] flex flex-col">
        <div className="flex items-center justify-between p-3 border-b border-line bg-card">
          <div className="flex items-center gap-3">
            {attachments.length > 1 && index > 0 && (
              <button onClick={handlePrev} className="p-1.5 rounded-lg hover:bg-card2 text-ink2" title="Previous">
                <ChevronLeft size={18} />
              </button>
            )}
            <span className="text-sm font-medium text-ink2 truncate max-w-xs">
              {doc.filename}
            </span>
            {attachments.length > 1 && (
              <span className="text-xs text-ink4">({index + 1} / {attachments.length})</span>
            )}
          </div>
          <div className="flex items-center gap-1">
            {fileInfo === 'image' && (
              <>
                <button onClick={handleZoomOut} className="p-1.5 rounded-lg hover:bg-card2 text-ink2" title="Zoom out">
                  <ZoomOut size={16} />
                </button>
                <span className="text-xs text-ink3 w-12 text-center">{zoom}%</span>
                <button onClick={handleZoomIn} className="p-1.5 rounded-lg hover:bg-card2 text-ink2" title="Zoom in">
                  <ZoomIn size={16} />
                </button>
                <button onClick={handleRotate} className="p-1.5 rounded-lg hover:bg-card2 text-ink2" title="Rotate">
                  <RotateCw size={16} />
                </button>
              </>
            )}
            <a
              href={downloadUrl}
              className="p-1.5 rounded-lg hover:bg-card2 text-ink2"
              title="Download"
            >
              <Download size={16} />
            </a>
            <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-card2 text-ink2" title="Close">
              <X size={18} />
            </button>
          </div>
        </div>
        <div className="overflow-auto flex-1 flex items-center justify-center bg-black/20">
          {renderPreview()}
        </div>
        {attachments.length > 1 && index < attachments.length - 1 && (
          <button onClick={handleNext} className="absolute right-2 top-1/2 -translate-y-1/2 p-2 rounded-full hover:bg-card2 text-ink2" title="Next">
            <ChevronRight size={20} />
          </button>
        )}
      </div>
    </div>,
    document.body,
  );
}
