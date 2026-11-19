"use client";

import { useEffect, useId, useRef, useState } from "react";
import { CameraIcon } from "../icons.js";

export type CaptureFormat = "png" | "svg";

const OPTIONS: { format: CaptureFormat; label: string; detail: (width: number) => string }[] = [
  { format: "png", label: "As an image", detail: (width) => `The full page, ${width}px wide at 2×. Scale it to 50% after pasting.` },
  { format: "svg", label: "As editable layers", detail: (width) => `${width}px wide. Text and shapes you can restyle; fonts and effects are approximate.` },
];

/** "Copy for Figma": captures the full page at the previewed device's fixed width, as an image or as layers. */
export function CaptureMenu({ busy, width, onCopy }: { busy: CaptureFormat | null; width: number; onCopy(format: CaptureFormat): void }) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    const onPointer = (event: MouseEvent) => {
      if (!root.current?.contains(event.target as Node)) close();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      close();
      root.current?.querySelector("button")?.focus();
    };
    document.addEventListener("mousedown", onPointer);
    document.addEventListener("keydown", onKey);
    // Clicking into the site's iframe blurs this window.
    window.addEventListener("blur", close);
    return () => {
      document.removeEventListener("mousedown", onPointer);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("blur", close);
    };
  }, [open]);

  return (
    <div className="se-menu" ref={root}>
      <button type="button" className="se-button" aria-expanded={open} aria-controls={id} disabled={busy !== null} onClick={() => setOpen((value) => !value)}>
        <CameraIcon />
        {busy ? "Capturing…" : "Copy for Figma"}
      </button>
      {open && (
        <div id={id} className="se-menu-list">
          {OPTIONS.map((option) => (
            <button
              key={option.format}
              type="button"
              className="se-menu-item"
              onClick={() => {
                setOpen(false);
                onCopy(option.format);
              }}
            >
              <span className="se-outline-label">{option.label}</span>
              <span className="se-outline-detail">{option.detail(width)}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
