import type { PixelCell, PixelPrimitive, PropertyDefinition, PropertyType } from "../../renderer/types";
import { corePixelKeys } from "../constants";

export function normalizeId(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "_")
    .replace(/[^a-z0-9_]/g, "");
}

export function parseCsvValues(raw: string): string[] {
  return raw
    .split(",")
    .map((v) => v.trim())
    .filter((v) => v.length > 0);
}

export function parseBoolText(raw: string): boolean | null {
  const text = raw.trim().toLowerCase();
  if (["true", "1", "yes", "y", "on"].includes(text)) {
    return true;
  }
  if (["false", "0", "no", "n", "off"].includes(text)) {
    return false;
  }
  return null;
}

export function parseDefaultValue(propertyType: PropertyType, raw: string, enumValues: string[]): PixelPrimitive | null {
  switch (propertyType) {
    case "int": {
      const parsed = Number(raw);
      if (!Number.isFinite(parsed) || !Number.isInteger(parsed)) {
        return null;
      }
      return parsed;
    }
    case "float": {
      const parsed = Number(raw);
      if (!Number.isFinite(parsed)) {
        return null;
      }
      return parsed;
    }
    case "bool": {
      return parseBoolText(raw);
    }
    case "string":
      return raw;
    case "enum": {
      if (enumValues.length === 0) {
        return null;
      }
      if (!enumValues.includes(raw)) {
        return null;
      }
      return raw;
    }
    default:
      return null;
  }
}

export function coerceValueByProperty(property: PropertyDefinition, candidate: unknown): PixelPrimitive {
  const fallback = property.default_value;
  switch (property.type) {
    case "int": {
      const source = typeof candidate === "number" ? candidate : typeof candidate === "string" ? Number(candidate) : Number(fallback);
      if (!Number.isFinite(source)) {
        return Number(fallback) || 0;
      }
      return Math.trunc(source);
    }
    case "float": {
      const source = typeof candidate === "number" ? candidate : typeof candidate === "string" ? Number(candidate) : Number(fallback);
      if (!Number.isFinite(source)) {
        return Number(fallback) || 0;
      }
      return source;
    }
    case "bool": {
      if (typeof candidate === "boolean") {
        return candidate;
      }
      if (typeof candidate === "string") {
        const parsed = parseBoolText(candidate);
        if (parsed !== null) {
          return parsed;
        }
      }
      return Boolean(fallback);
    }
    case "string": {
      if (typeof candidate === "string") {
        return candidate;
      }
      return String(fallback ?? "");
    }
    case "enum": {
      const values = property.enum_values ?? [];
      const fallbackValue = typeof fallback === "string" ? fallback : values[0] ?? "";
      if (typeof candidate === "string" && values.includes(candidate)) {
        return candidate;
      }
      if (values.includes(fallbackValue)) {
        return fallbackValue;
      }
      return values[0] ?? "";
    }
    default:
      return String(fallback ?? "");
  }
}

export function getPixelDynamicProperties(pixel: PixelCell): Array<[string, unknown]> {
  return Object.entries(pixel).filter(([key]) => !corePixelKeys.has(key));
}

export function formatPropertyValue(value: unknown): string {
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

export function buildBrushOffsets(size: number): Array<{ dx: number; dy: number }> {
  const offsets: Array<{ dx: number; dy: number }> = [];
  const radius = Math.floor(size / 2);
  for (let y = -radius; y <= radius; y += 1) {
    for (let x = -radius; x <= radius; x += 1) {
      if (x * x + y * y <= radius * radius + 0.25) {
        offsets.push({ dx: x, dy: y });
      }
    }
  }
  return offsets.length > 0 ? offsets : [{ dx: 0, dy: 0 }];
}
