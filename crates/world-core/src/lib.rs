mod error;
mod registry;
mod runtime;
mod types;

pub use error::WorldCoreError;
pub use registry::{
    default_registry_dir, load_registry_best_effort, load_registry_from_dir,
    normalize_registry_snapshot, sibling_registry_dir, validate_registry_snapshot,
    write_registry_to_dir,
};
pub use runtime::{
    apply_property_defaults, normalize_and_validate_pixel, validate_pixel_with_registry,
    WorldRuntime,
};
pub use types::{
    ChunkCoord, ChunkData, LoadWorldResponse, MaterialDefinition, PixelCell, PixelPatch,
    PropertyDefinition, PropertyType, RegistrySnapshot, ValidatePixelResponse, ValidationError,
    WorldMeta,
};

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::Value;
    use std::collections::HashMap;
    use std::fs;
    use tempfile::tempdir;

    fn sample_registry() -> RegistrySnapshot {
        RegistrySnapshot {
            version: "1.0.0".to_string(),
            materials: vec![
                MaterialDefinition {
                    id: "soil".to_string(),
                    label: "Soil".to_string(),
                    max_durability: 100,
                },
                MaterialDefinition {
                    id: "stone".to_string(),
                    label: "Stone".to_string(),
                    max_durability: 250,
                },
            ],
            properties: vec![
                PropertyDefinition {
                    name: "terrain".to_string(),
                    label: "Terrain".to_string(),
                    property_type: PropertyType::Enum,
                    default_value: Value::from("plain"),
                    enum_values: vec!["plain".to_string(), "rock".to_string()],
                },
                PropertyDefinition {
                    name: "humidity".to_string(),
                    label: "Humidity".to_string(),
                    property_type: PropertyType::String,
                    default_value: Value::from("normal"),
                    enum_values: Vec::new(),
                },
            ],
        }
    }

    fn sample_pixel() -> PixelCell {
        PixelCell {
            color: [10, 20, 30],
            material: "soil".to_string(),
            durability: 40,
            properties: HashMap::from([
                ("terrain".to_string(), Value::from("plain")),
                ("humidity".to_string(), Value::from("dry")),
            ]),
        }
    }

    #[test]
    fn validates_valid_pixel() {
        let registry = sample_registry();
        let mut pixel = sample_pixel();
        let result = normalize_and_validate_pixel(&mut pixel, &registry);
        assert!(result.is_ok());
    }

    #[test]
    fn rejects_invalid_material_and_properties() {
        let registry = sample_registry();
        let mut pixel = sample_pixel();
        pixel.material = "lava".to_string();
        pixel
            .properties
            .insert("unknown".to_string(), Value::from("x"));
        let result = normalize_and_validate_pixel(&mut pixel, &registry);
        assert!(matches!(result, Err(WorldCoreError::Validation { .. })));
    }

    #[test]
    fn chunk_roundtrip_preserves_cells() {
        let chunk = ChunkData {
            coord: ChunkCoord { x: 1, y: -2 },
            cells: HashMap::from([("3,4".to_string(), sample_pixel())]),
        };
        let text = serde_json::to_string(&chunk).expect("serialize chunk");
        let parsed: ChunkData = serde_json::from_str(&text).expect("deserialize chunk");
        assert_eq!(parsed.coord.x, 1);
        assert_eq!(parsed.coord.y, -2);
        assert!(parsed.cells.contains_key("3,4"));
    }

    #[test]
    fn applies_registry_defaults_to_old_cells_on_load() {
        let temp = tempdir().expect("temp dir");
        let root = temp.path();
        let world_dir = root.join("world");
        let chunks_dir = world_dir.join("chunks");
        let registry_dir = root.join("registry");

        fs::create_dir_all(&chunks_dir).expect("create chunks");
        fs::create_dir_all(&registry_dir).expect("create registry");

        fs::write(
            world_dir.join("world.json"),
            serde_json::to_string_pretty(&WorldMeta {
                version: "1.0.0".into(),
                registry_version: "2.0.0".into(),
                small_pixel_size: 2,
                big_grid_size: 32,
                chunk_size: 32,
            })
            .expect("serialize world"),
        )
        .expect("write world");

        fs::write(
            registry_dir.join("registry.json"),
            serde_json::to_string_pretty(&RegistrySnapshot {
                version: "2.0.0".into(),
                materials: vec![MaterialDefinition {
                    id: "soil".into(),
                    label: "Soil".into(),
                    max_durability: 100,
                }],
                properties: vec![PropertyDefinition {
                    name: "biome".into(),
                    label: "Biome".into(),
                    property_type: PropertyType::String,
                    default_value: Value::from("temperate"),
                    enum_values: vec![],
                }],
            })
            .expect("serialize registry"),
        )
        .expect("write registry");

        fs::write(
            chunks_dir.join("c_0_0.json"),
            r#"{
  "coord": {"x": 0, "y": 0},
  "cells": {
    "1,1": {
      "color": [1,2,3],
      "material": "soil",
      "durability": 10
    }
  }
}"#,
        )
        .expect("write chunk");

        let mut runtime = WorldRuntime::new();
        let response = runtime
            .load_world(world_dir.join("world.json"))
            .expect("load world");
        let pixel = &response.initial_chunks[0].cells["1,1"];
        assert_eq!(
            pixel.properties.get("biome"),
            Some(&Value::from("temperate"))
        );
    }
}
