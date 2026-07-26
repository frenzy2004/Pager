"use client";

import { MochiFace } from "@/components/mochi/mochi-face";

interface MochiPetProps {
  open: boolean;
  disabled?: boolean;
  onToggle(): void;
}

export function MochiPet({
  open,
  disabled = false,
  onToggle,
}: MochiPetProps) {
  return (
    <div className={`mochi-launcher${open ? " is-open" : ""}`}>
      {!open && (
        <span className="mochi-nudge" aria-hidden="true">
          Drop me a screenshot
        </span>
      )}
      <button
        className="mochi-pet-button"
        type="button"
        aria-label={open ? "Close Mochi" : "Open Mochi"}
        aria-expanded={open}
        disabled={disabled}
        onClick={onToggle}
      >
        <MochiFace />
        <span className="mochi-pet-label">MOCHI</span>
      </button>
    </div>
  );
}
