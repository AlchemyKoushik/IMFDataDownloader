"use client";

import { useEffect } from "react";

import { FredComingSoonContent } from "@/components/fred/FredComingSoonContent";

interface FredComingSoonModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function FredComingSoonModal({ isOpen, onClose }: FredComingSoonModalProps) {
  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const previousOverflow = document.body.style.overflow;
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        onClose();
      }
    };

    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen, onClose]);

  if (!isOpen) {
    return null;
  }

  return (
    <div className="featureModalBackdrop" role="presentation" onClick={onClose}>
      <div
        aria-labelledby="fred-coming-soon-title"
        aria-modal="true"
        className="featureModalPanel"
        role="dialog"
        onClick={(event) => event.stopPropagation()}
        >
          <button
            aria-label="Close FRED coming soon dialog"
          className="featureModalClose"
          type="button"
          onClick={onClose}
        >
          <svg viewBox="0 0 20 20">
            <path d="m5.5 5.5 9 9m0-9-9 9" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="1.8" />
          </svg>
        </button>

        <div className="featureModalInner">
          <FredComingSoonContent compact onNavigate={onClose} titleId="fred-coming-soon-title" />

          <div className="featureModalFooter">
            <button className="featureModalGhost" type="button" onClick={onClose}>
              Keep Browsing
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
