import React, { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { X, ZoomIn, ZoomOut, Download, ChevronLeft, ChevronRight, RotateCw } from 'lucide-react';
import { cx } from '../lib/utils';
import type { Attachment, ChatAttachment } from '../lib/types';

type AnyAttachment = Attachment | ChatAttachment;

interface AttachmentViewerProps {
  open: boolean;
  onClose: () => void;
  attachments: AnyAttachment[];
  initialIndex?: number;
}

const IMAGE_EXTS = ['jpg', 'jpeg', 'png', 'gif', 'webp'];
const PDF_EXTS = ['pdf'];

function getFileType(att: AnyAttachment): 'image' | 'pdf' | 'other' {
  const ext = (att.stored_name || att.filename || '').split('.').pop()?.toLowerCase() || '';
  if (IMAGE_EXTS.includes(ext)) return 'image';
  if (PDF_EXTS.includes(ext)) return 'pdf';
  return 'other';
}

function getExt(att: AnyAttachment): string {
  return (att.stored_name || att.filename || '').split('.').pop()?.toLowerCase() || '';
}

export function AttachmentViewer({ open, onClose, attachments, initialIndex = 0 }: AttachmentViewerProps) {
  const [current, setCurrent] = React.useState(initialIndex);
  const [zoom, setZoom] = React.useState(1);
  const [rotate, setRotate] = React.useState(0);

  useEffect(() => {
    setCurrent(initialIndex);
    setZoom(1);
    setRotate(0);
  }, [initialIndex]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowLeft') setCurrent((c) => Math.max(0, c - 1));
      if (e.key === 'ArrowRight') setCurrent((c) => Math.min(attachments.length - 1, c + 1));
    };
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [open, onClose, attachments.length]);

  if (!open || !attachments || attachments.length === 0) return null;

  const att = attachments[current];
  const fileType = getFileType(att);
  const fileUrl = `/api/uploads/file/${att.stored_name}`;
  const sizeStr = att.size >= 1024 * 1024
    ? `${(att.size / (1024 * 1024)).toFixed(1)} MB`
    : `${(att.size / 1024).toFixed(1)} KB`;

  return createPortal(
    <div
      className="fixed inset-0 z-[10000] bg-black/90 flex items-center justify-center"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="relative w-full h-full max-w-6xl max-h-full flex flex-col">
        <div className="flex items-center justify-between p-3 border-b border-white/10 bg-black/30">
          <div className="flex items-center gap-2 text-sm text-ink">
            <span className="text-white font-medium">{att.filename}</span>
            <span className="text-white/40">•</span>
            <span className="text-white/60 text-xs">{sizeStr}</span>
            <span className="text-white/40">•</span>
            <span className="text-white/60 text-xs">{current + 1} / {attachments.length}</span>
          </div>
          <div className="flex items-center gap-1">
            {fileType === 'image' && (
              <>
                <button
                  onClick={() => setZoom((z) => Math.max(0.2, Math.round(z * 0.8 * 10) / 10))}
                  className="p-1.5 rounded-lg hover:bg-white/10 text-white transition-colors"
                  title="Zoom out"
                >
                  <ZoomOut size={16} />
                </button>
                <button
                  onClick={() => setZoom(1)}
                  className="p-1.5 rounded-lg hover:bg-white/10 text-white transition-colors"
                  title="Reset zoom"
                >
                  <RotateCw size={16} />
                </button>
                <button
                  onClick={() => setZoom((z) => Math.min(5, Math.round(z * 1.25 * 10) / 10))}
                  className="p-1.5 rounded-lg hover:bg-white/10 text-white transition-colors"
                  title="Zoom in"
                >
                  <ZoomIn size={16} />
                </button>
              </>
            )}
            <a
              href={`/api/uploads/file/${att.stored_name}/download`}
              download={att.filename}
              className="p-1.5 rounded-lg hover:bg-white/10 text-white transition-colors"
              title="Download"
              onClick={(e) => e.stopPropagation()}
            >
              <Download size={16} />
            </a>
            <button
              onClick={onClose}
              className="p-1.5 rounded-lg hover:bg-white/10 text-white transition-colors"
              title="Close (Esc)"
            >
              <X size={18} />
            </button>
          </div>
        </div>

        <div className="flex-1 flex items-center justify-center overflow-auto p-4">
          {fileType === 'image' && (
            <img
              src={fileUrl}
              alt={att.filename}
              className="max-w-full max-h-full object-contain transition-transform duration-100"
              style={{
                transform: `scale(${zoom}) rotate(${rotate}deg)`,
                cursor: zoom > 1 ? 'zoom-out' : 'zoom-in',
              }}
              onClick={() => setZoom((z) => (z > 1 ? 1 : 2))}
              onError={(e) => { (e.target as HTMLImageElement).src = fileUrl; }}
              loading="eager"
            />
          )}
          {fileType === 'pdf' && (
            <iframe
              src={`${fileUrl}#zoom=100&pagewrap=true&toolbar=0&navpanes=0&scrollbar=1`}
              title={att.filename}
              className="w-full h-full border-none"
              style={{ minHeight: '500px' }}
            />
          )}
          {fileType === 'other' && (
            <div className="text-center text-white/60">
              <div className="text-4xl mb-2">
                {getExt(att).toUpperCase()}
              </div>
              <p className="text-sm">{att.filename}</p>
              <p className="text-xs mt-2 text-white/40">Preview not available. Use the download button above.</p>
            </div>
          )}
        </div>

        {attachments.length > 1 && (
          <div className="p-2 border-t border-white/10 bg-black/30 flex justify-center gap-4">
            <button
              onClick={() => setCurrent((c) => Math.max(0, c - 1))}
              disabled={current === 0}
              className={cx(
                'p-2 rounded-lg text-white transition-colors',
                current === 0 ? 'opacity-30 cursor-default' : 'hover:bg-white/10'
              )}
              title="Previous"
            >
              <ChevronLeft size={18} />
            </button>
            <button
              onClick={() => setCurrent((c) => Math.min(attachments.length - 1, c + 1))}
              disabled={current === attachments.length - 1}
              className={cx(
                'p-2 rounded-lg text-white transition-colors',
                current === attachments.length - 1 ? 'opacity-30 cursor-default' : 'hover:bg-white/10'
              )}
              title="Next"
            >
              <ChevronRight size={18} />
            </button>
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}
