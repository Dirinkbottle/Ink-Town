import type { PixelPrimitive, PropertyDefinition } from "../../../renderer/types";

interface BrushPropertiesSectionProps {
  properties: PropertyDefinition[];
  brushProperties: Record<string, PixelPrimitive>;
  enumOptions: Record<string, string[]>;
  onChangeProperty: (name: string, value: PixelPrimitive) => void;
}

export function BrushPropertiesSection(props: BrushPropertiesSectionProps) {
  const { properties, brushProperties, enumOptions, onChangeProperty } = props;
  return (
    <>
      {properties.map((property) => {
        const value = brushProperties[property.name];
        if (property.type === "enum") {
          return (
            <div className="row" key={property.name}>
              <label>{property.label}</label>
              <select
                value={typeof value === "string" ? value : String(property.default_value ?? "")}
                onChange={(e) => onChangeProperty(property.name, e.target.value)}
              >
                {(enumOptions[property.name] ?? []).map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            </div>
          );
        }

        if (property.type === "bool") {
          return (
            <div className="row" key={property.name}>
              <label>{property.label}</label>
              <input
                type="checkbox"
                checked={Boolean(value ?? property.default_value)}
                onChange={(e) => onChangeProperty(property.name, e.target.checked)}
              />
            </div>
          );
        }

        const isNumber = property.type === "int" || property.type === "float";
        return (
          <div className="row" key={property.name}>
            <label>{property.label}</label>
            <input
              type={isNumber ? "number" : "text"}
              step={property.type === "float" ? "0.01" : "1"}
              value={value === undefined ? String(property.default_value ?? "") : String(value)}
              onChange={(e) => {
                const nextRaw = e.target.value;
                if (!isNumber) {
                  onChangeProperty(property.name, nextRaw);
                  return;
                }

                const parsed = Number(nextRaw);
                if (!Number.isFinite(parsed)) {
                  onChangeProperty(property.name, 0);
                  return;
                }
                onChangeProperty(property.name, property.type === "int" ? Math.trunc(parsed) : parsed);
              }}
            />
          </div>
        );
      })}
    </>
  );
}
