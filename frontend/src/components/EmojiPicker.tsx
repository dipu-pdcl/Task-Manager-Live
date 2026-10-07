import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

const EMOJI_CATEGORIES = [
  {
    name: 'Smileys',
    emojis: ['😀', '😊', '😄', '😁', '😆', '😎', '🤗', '😍', '🥰', '😘', '😅', '🤣', '😂', '🙂', '🥲', '😔', '😢', '😭', '😡', '🤬', '🤔', '🤭', '🤫', '🤥', '😇', '🥳', '🥺', '😌', '🙃', '😉'],
  },
  {
    name: 'Gestures',
    emojis: ['👍', '👎', '👏', '🙌', '👐', '🙏', '🤝', '✊', '✋', '👌', '🤟', '🖐', '🖖', '🤚', '👋', '💪', '🦾', '🦵', '🦶'],
  },
  {
    name: 'Hearts',
    emojis: ['❤', '🧡', '💛', '💚', '💙', '💜', '🤍', '🖤', '🩷', '💔', '💕', '💞', '💟', '💝'],
  },
  {
    name: 'Objects',
    emojis: ['🎉', '🎊', '🔥', '💧', '✅', '❌', '⚠', 'ℹ', '⭐', '✨', '⚡', '🔔', '📅', '📎', '📄', '📌', '📍', '🚀', '💡'],
  },
];

export function EmojiPicker({ onEmojiSelect }: { onEmojiSelect: (emoji: string) => void }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);

  const toggle = (e: React.MouseEvent) => {
    e.preventDefault();
    if (open) {
      setOpen(false);
      setPos(null);
    } else {
      const rect = e.currentTarget.getBoundingClientRect();
      const spaceRight = window.innerWidth - rect.right;
      const spaceBelow = window.innerHeight - rect.bottom;
      let x = rect.right - 12;
      let y = rect.bottom + 8;
      if (spaceRight < 240 && rect.left > 240) x = rect.left - 228;
      if (spaceBelow < 260) {
        y = rect.top - 252;
        if (y < 12) y = 12;
      }
      setPos({ x, y });
      setOpen(true);
    }
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
        setPos(null);
      }
    };
    if (open) {
      document.body.style.overflow = 'hidden';
      window.addEventListener('keydown', onKey);
    }
    return () => {
      document.body.style.overflow = '';
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const handleSelect = (emoji: string) => {
    onEmojiSelect(emoji);
    setOpen(false);
    setPos(null);
  };

  return (
    <>
      <button
        type="button"
        onClick={toggle}
        className="p-2 rounded-lg hover:bg-card2 text-ink2 transition-colors text-lg"
        title="Add emoji"
      >
        😊
      </button>
      {open && pos &&
        createPortal(
          <div
            className="fixed z-[9999] bg-card border border-line rounded-xl shadow-2xl"
            style={{ left: pos.x, top: pos.y, width: 240, maxHeight: 260 }}
            onMouseDown={(e) => e.stopPropagation()}
          >
            <div className="p-1.5 border-b border-line bg-card2/50">
              <div className="text-[9px] text-ink3 font-semibold uppercase">Emoji</div>
            </div>
            <div className="p-1 overflow-y-auto" style={{ maxHeight: 'calc(260px - 32px)' }}>
              {EMOJI_CATEGORIES.map((cat) => (
                <div key={cat.name} className="mb-2">
                  <div className="text-[9px] text-ink3 font-semibold mb-1 px-1">{cat.name}</div>
                  <div className="grid grid-cols-5 sm:grid-cols-6 gap-1">
                    {cat.emojis.map((e) => (
                      <button
                        key={e}
                        type="button"
                        onClick={() => handleSelect(e)}
                        className="text-lg hover:bg-card2 rounded-lg transition-colors flex items-center justify-center"
                      >
                        {e}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}

export function useEmojiInsert(inputRef: React.RefObject<HTMLTextAreaElement>, value: string, setter: (v: string) => void) {
  return (emoji: string) => {
    const el = inputRef.current;
    const cursorPos = el?.selectionStart ?? value.length;
    const newText = value.slice(0, cursorPos) + emoji + value.slice(cursorPos);
    setter(newText);
    setTimeout(() => {
      el?.focus();
      const newPos = cursorPos + emoji.length;
      el?.setSelectionRange(newPos, newPos);
    }, 0);
  };
}
