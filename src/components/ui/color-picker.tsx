"use client";

import { PALETTE, paletteVar, type PaletteColor } from "@/lib/constants";
import { cn } from "@/lib/utils";

export function ColorPicker({
  value,
  onChange,
}: {
  value?: PaletteColor;
  onChange: (color: PaletteColor) => void;
}) {
  return (
    <div role="radiogroup" aria-label="Colour" className="flex flex-wrap gap-2">
      {PALETTE.map((color) => (
        <button
          key={color}
          type="button"
          role="radio"
          aria-checked={value === color}
          aria-label={color}
          title={color}
          onClick={() => onChange(color)}
          className={cn(
            "size-8 rounded-full border-2 transition-transform duration-150",
            value === color ? "border-foreground scale-110" : "border-transparent",
          )}
          style={{ background: paletteVar(color) }}
        />
      ))}
    </div>
  );
}
