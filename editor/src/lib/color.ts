import type { RGB } from "../renderer/types";

export function rgbToHex(rgb: RGB): string {
  const [r, g, b] = rgb;
  return `#${[r, g, b]
    .map((x) => {
      const n = Math.max(0, Math.min(255, x));
      return n.toString(16).padStart(2, "0");
    })
    .join("")}`;
}

export function hexToRgb(hex: string): RGB {
  const cleaned = hex.replace("#", "").slice(0, 6);
  const normalized = cleaned.length === 3 ? cleaned.split("").map((c) => `${c}${c}`).join("") : cleaned.padEnd(6, "0");
  const r = Number.parseInt(normalized.slice(0, 2), 16);
  const g = Number.parseInt(normalized.slice(2, 4), 16);
  const b = Number.parseInt(normalized.slice(4, 6), 16);
  return [r, g, b];
}
