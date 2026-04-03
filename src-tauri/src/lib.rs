use jsonschema::{Draft, JSONSchema};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use thiserror::Error;
#[cfg(feature = "desktop")]
use tauri::State;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct WorldMeta {
    pub version: String,
    pub registry_version: String,
    pub small_pixel_size: u32,
    pub big_grid_size: u32,
    pub chunk_size: u32,
}

#[derive(Debug, Serialize, Deserialize, Clone, Copy, Eq, PartialEq, Hash)]
pub struct ChunkCoord {
    pub x: i32,
    pub y: i32,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct PixelCell {
    pub color: [u8; 3],
    pub material: String,
    pub durability: u32,
    #[serde(default)]
    pub attrs: HashMap<String, String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ChunkData {
    pub coord: ChunkCoord,
    #[serde(default)]
    pub cells: HashMap<String, PixelCell>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct MaterialDefinition {
    pub id: String,
    pub label: String,
    pub max_durability: u32,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct AttributeDefinition {
    pub id: String,
    pub label: String,
    pub value_set: String,
    pub required: bool,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct RegistrySnapshot {
    pub version: String,
    pub materials: Vec<MaterialDefinition>,
    pub attributes: Vec<AttributeDefinition>,
    pub value_sets: HashMap<String, Vec<String>>,
    pub schema: Value,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ValidationError {
    pub field: String,
    pub message: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ValidatePixelResponse {
    pub ok: bool,
    pub errors: Vec<ValidationError>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct LoadWorldResponse {
    pub meta: WorldMeta,
    pub initial_chunks: Vec<ChunkData>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct PixelPatch {
    pub world_x: i32,
    pub world_y: i32,
    pub pixel: PixelCell,
}

#[derive(Debug, Serialize, Deserialize)]
struct RegistryConfig {
    version: String,
    materials_file: String,
    attributes_file: String,
    value_sets_file: String,
    schema_file: String,
}

#[derive(Debug, Serialize, Deserialize)]
struct MaterialsFile {
    materials: Vec<MaterialDefinition>,
}

#[derive(Debug, Serialize, Deserialize)]
struct AttributesFile {
    attributes: Vec<AttributeDefinition>,
}

#[derive(Debug, Serialize, Deserialize)]
struct ValueSetsFile {
    value_sets: HashMap<String, Vec<String>>,
}

#[derive(Debug, Default)]
struct WorldRuntime {
    world_meta_path: Option<PathBuf>,
    world_dir: Option<PathBuf>,
    registry_dir: Option<PathBuf>,
    meta: Option<WorldMeta>,
    registry: Option<RegistrySnapshot>,
    chunks: HashMap<ChunkCoord, ChunkData>,
    dirty_chunks: HashSet<ChunkCoord>,
}

impl WorldRuntime {
    fn require_meta(&self) -> Result<&WorldMeta, AppError> {
        self.meta.as_ref().ok_or(AppError::NotLoaded)
    }

    fn require_world_dir(&self) -> Result<&PathBuf, AppError> {
        self.world_dir.as_ref().ok_or(AppError::NotLoaded)
    }

    fn require_registry(&self) -> Result<&RegistrySnapshot, AppError> {
        self.registry.as_ref().ok_or(AppError::RegistryUnavailable)
    }

    fn chunk_path(&self, coord: ChunkCoord) -> Result<PathBuf, AppError> {
        let mut path = self.require_world_dir()?.join("chunks");
        fs::create_dir_all(&path)?;
        path.push(format!("c_{}_{}.json", coord.x, coord.y));
        Ok(path)
    }

    fn load_chunk(&mut self, coord: ChunkCoord) -> Result<ChunkData, AppError> {
        if let Some(existing) = self.chunks.get(&coord) {
            return Ok(existing.clone());
        }

        let path = self.chunk_path(coord)?;
        let chunk = if path.exists() {
            let text = fs::read_to_string(path)?;
            serde_json::from_str::<ChunkData>(&text)?
        } else {
            ChunkData {
                coord,
                cells: HashMap::new(),
            }
        };

        self.chunks.insert(coord, chunk.clone());
        Ok(chunk)
    }
}

#[cfg(feature = "desktop")]
#[derive(Default)]
struct AppState {
    runtime: Mutex<WorldRuntime>,
}

#[derive(Debug, Error)]
enum AppError {
    #[error("world is not loaded")]
    NotLoaded,
    #[error("registry is not loaded")]
    RegistryUnavailable,
    #[error("I/O error: {0}")]
    Io(#[from] std::io::Error),
    #[error("JSON parse error: {0}")]
    Json(#[from] serde_json::Error),
    #[error("schema compile error: {0}")]
    SchemaCompile(String),
    #[error("validation failed")]
    Validation { errors: Vec<ValidationError> },
    #[error("invalid world path")]
    InvalidWorldPath,
    #[error("invalid registry: {0}")]
    InvalidRegistry(String),
    #[error("state lock poisoned")]
    LockPoisoned,
}

fn default_registry_dir() -> PathBuf {
    std::env::current_dir()
        .unwrap_or_else(|_| PathBuf::from("."))
        .join("data")
        .join("registry")
}

fn load_registry_from_dir(registry_dir: &Path) -> Result<RegistrySnapshot, AppError> {
    let registry_text = fs::read_to_string(registry_dir.join("registry.json"))?;
    let config: RegistryConfig = serde_json::from_str(&registry_text)?;

    let materials: MaterialsFile = serde_json::from_str(&fs::read_to_string(
        registry_dir.join(config.materials_file.clone()),
    )?)?;

    let attributes: AttributesFile = serde_json::from_str(&fs::read_to_string(
        registry_dir.join(config.attributes_file.clone()),
    )?)?;

    let value_sets: ValueSetsFile = serde_json::from_str(&fs::read_to_string(
        registry_dir.join(config.value_sets_file.clone()),
    )?)?;

    let schema: Value = serde_json::from_str(&fs::read_to_string(
        registry_dir.join(config.schema_file.clone()),
    )?)?;

    Ok(RegistrySnapshot {
        version: config.version,
        materials: materials.materials,
        attributes: attributes.attributes,
        value_sets: value_sets.value_sets,
        schema,
    })
}

fn validate_registry_snapshot(snapshot: &RegistrySnapshot) -> Result<(), AppError> {
    if snapshot.version.trim().is_empty() {
        return Err(AppError::InvalidRegistry("version cannot be empty".to_string()));
    }

    let mut material_ids: HashSet<&str> = HashSet::new();
    for material in &snapshot.materials {
        if material.id.trim().is_empty() {
            return Err(AppError::InvalidRegistry("material id cannot be empty".to_string()));
        }
        if !material_ids.insert(material.id.as_str()) {
            return Err(AppError::InvalidRegistry(format!(
                "duplicate material id '{}'",
                material.id
            )));
        }
    }

    let mut attr_ids: HashSet<&str> = HashSet::new();
    for attr in &snapshot.attributes {
        if attr.id.trim().is_empty() {
            return Err(AppError::InvalidRegistry("attribute id cannot be empty".to_string()));
        }
        if attr.value_set.trim().is_empty() {
            return Err(AppError::InvalidRegistry(format!(
                "attribute '{}' has empty value_set",
                attr.id
            )));
        }
        if !attr_ids.insert(attr.id.as_str()) {
            return Err(AppError::InvalidRegistry(format!(
                "duplicate attribute id '{}'",
                attr.id
            )));
        }
        if !snapshot.value_sets.contains_key(&attr.value_set) {
            return Err(AppError::InvalidRegistry(format!(
                "attribute '{}' references missing value_set '{}'",
                attr.id, attr.value_set
            )));
        }
    }

    for (set_id, values) in &snapshot.value_sets {
        if set_id.trim().is_empty() {
            return Err(AppError::InvalidRegistry("value_set id cannot be empty".to_string()));
        }
        let mut unique = HashSet::new();
        for value in values {
            let trimmed = value.trim();
            if trimmed.is_empty() {
                return Err(AppError::InvalidRegistry(format!(
                    "value_set '{}' contains empty value",
                    set_id
                )));
            }
            if !unique.insert(trimmed.to_string()) {
                return Err(AppError::InvalidRegistry(format!(
                    "value_set '{}' contains duplicate value '{}'",
                    set_id, trimmed
                )));
            }
        }
    }

    Ok(())
}

fn write_registry_to_dir(registry_dir: &Path, snapshot: &RegistrySnapshot) -> Result<(), AppError> {
    fs::create_dir_all(registry_dir)?;
    let registry_path = registry_dir.join("registry.json");
    let mut config = if registry_path.exists() {
        let text = fs::read_to_string(&registry_path)?;
        serde_json::from_str::<RegistryConfig>(&text)?
    } else {
        RegistryConfig {
            version: snapshot.version.clone(),
            materials_file: "materials.json".to_string(),
            attributes_file: "attributes.json".to_string(),
            value_sets_file: "value_sets.json".to_string(),
            schema_file: "pixel.schema.json".to_string(),
        }
    };
    config.version = snapshot.version.clone();

    fs::write(
        registry_dir.join(&config.materials_file),
        serde_json::to_string_pretty(&MaterialsFile {
            materials: snapshot.materials.clone(),
        })?,
    )?;
    fs::write(
        registry_dir.join(&config.attributes_file),
        serde_json::to_string_pretty(&AttributesFile {
            attributes: snapshot.attributes.clone(),
        })?,
    )?;
    fs::write(
        registry_dir.join(&config.value_sets_file),
        serde_json::to_string_pretty(&ValueSetsFile {
            value_sets: snapshot.value_sets.clone(),
        })?,
    )?;
    fs::write(
        registry_dir.join(&config.schema_file),
        serde_json::to_string_pretty(&snapshot.schema)?,
    )?;
    fs::write(registry_path, serde_json::to_string_pretty(&config)?)?;
    Ok(())
}

fn validate_pixel_with_schema(pixel: &PixelCell, schema: &Value) -> Result<(), AppError> {
    let compiled = JSONSchema::options()
        .with_draft(Draft::Draft7)
        .compile(schema)
        .map_err(|e| AppError::SchemaCompile(e.to_string()))?;

    let payload = serde_json::to_value(pixel)?;
    let result = compiled.validate(&payload);

    if let Err(errors) = result {
        let parsed = errors
            .map(|err| ValidationError {
                field: err.instance_path.to_string(),
                message: err.to_string(),
            })
            .collect::<Vec<_>>();
        return Err(AppError::Validation { errors: parsed });
    }

    Ok(())
}

fn validate_pixel_with_registry(pixel: &PixelCell, registry: &RegistrySnapshot) -> Result<(), AppError> {
    let mut errors: Vec<ValidationError> = Vec::new();

    let material = registry.materials.iter().find(|m| m.id == pixel.material);
    if material.is_none() {
        errors.push(ValidationError {
            field: "material".to_string(),
            message: format!("unknown material: {}", pixel.material),
        });
    }

    if let Some(material_def) = material {
        if pixel.durability > material_def.max_durability {
            errors.push(ValidationError {
                field: "durability".to_string(),
                message: format!(
                    "durability {} exceeds max {} for material {}",
                    pixel.durability, material_def.max_durability, material_def.id
                ),
            });
        }
    }

    for attr in &registry.attributes {
        if attr.required && !pixel.attrs.contains_key(&attr.id) {
            errors.push(ValidationError {
                field: format!("attrs.{}", attr.id),
                message: "required attribute missing".to_string(),
            });
        }
    }

    for (key, value) in &pixel.attrs {
        let Some(attr_def) = registry.attributes.iter().find(|a| a.id == *key) else {
            errors.push(ValidationError {
                field: format!("attrs.{}", key),
                message: "attribute is not defined in registry".to_string(),
            });
            continue;
        };

        let allowed = registry
            .value_sets
            .get(&attr_def.value_set)
            .cloned()
            .unwrap_or_default();
        if !allowed.contains(value) {
            errors.push(ValidationError {
                field: format!("attrs.{}", key),
                message: format!("value '{}' not in value set {}", value, attr_def.value_set),
            });
        }
    }

    if errors.is_empty() {
        Ok(())
    } else {
        Err(AppError::Validation { errors })
    }
}

fn validate_pixel(pixel: &PixelCell, registry: &RegistrySnapshot) -> Result<(), AppError> {
    validate_pixel_with_schema(pixel, &registry.schema)?;
    validate_pixel_with_registry(pixel, registry)?;
    Ok(())
}

#[cfg(feature = "desktop")]
#[tauri::command]
fn load_world(state: State<'_, AppState>, meta_path: String) -> Result<LoadWorldResponse, String> {
    let meta_path = PathBuf::from(meta_path);
    let world_dir = meta_path
        .parent()
        .ok_or(AppError::InvalidWorldPath)
        .map_err(|e| e.to_string())?
        .to_path_buf();

    let registry_dir = world_dir
        .parent()
        .map(|p| p.join("registry"))
        .filter(|p| p.exists())
        .unwrap_or_else(default_registry_dir);

    let world_meta_text = fs::read_to_string(&meta_path).map_err(|e| e.to_string())?;
    let meta: WorldMeta = serde_json::from_str(&world_meta_text).map_err(|e| e.to_string())?;
    let registry = load_registry_from_dir(&registry_dir).map_err(|e| e.to_string())?;

    let mut runtime = state.runtime.lock().map_err(|_| AppError::LockPoisoned.to_string())?;
    runtime.world_meta_path = Some(meta_path);
    runtime.world_dir = Some(world_dir);
    runtime.registry_dir = Some(registry_dir);
    runtime.meta = Some(meta.clone());
    runtime.registry = Some(registry);
    runtime.chunks.clear();
    runtime.dirty_chunks.clear();

    let initial = runtime
        .load_chunk(ChunkCoord { x: 0, y: 0 })
        .map_err(|e| e.to_string())?;

    Ok(LoadWorldResponse {
        meta,
        initial_chunks: vec![initial],
    })
}

#[cfg(feature = "desktop")]
#[tauri::command]
fn load_chunks(state: State<'_, AppState>, chunk_coords: Vec<ChunkCoord>) -> Result<Vec<ChunkData>, String> {
    let mut runtime = state.runtime.lock().map_err(|_| AppError::LockPoisoned.to_string())?;
    runtime.require_meta().map_err(|e| e.to_string())?;

    chunk_coords
        .into_iter()
        .map(|coord| runtime.load_chunk(coord).map_err(|e| e.to_string()))
        .collect()
}

#[cfg(feature = "desktop")]
#[tauri::command]
fn apply_pixel_patch(state: State<'_, AppState>, patches: Vec<PixelPatch>) -> Result<Vec<ChunkCoord>, String> {
    let mut runtime = state.runtime.lock().map_err(|_| AppError::LockPoisoned.to_string())?;
    let meta = runtime.require_meta().map_err(|e| e.to_string())?.clone();
    let registry = runtime.require_registry().map_err(|e| e.to_string())?.clone();

    let mut touched: HashSet<ChunkCoord> = HashSet::new();
    for patch in patches {
        validate_pixel(&patch.pixel, &registry).map_err(|e| e.to_string())?;

        let chunk_size = meta.chunk_size as i32;
        let chunk_x = patch.world_x.div_euclid(chunk_size);
        let chunk_y = patch.world_y.div_euclid(chunk_size);
        let local_x = patch.world_x.rem_euclid(chunk_size);
        let local_y = patch.world_y.rem_euclid(chunk_size);
        let coord = ChunkCoord { x: chunk_x, y: chunk_y };
        let mut chunk = runtime.load_chunk(coord).map_err(|e| e.to_string())?;
        chunk
            .cells
            .insert(format!("{},{}", local_x, local_y), patch.pixel);
        runtime.chunks.insert(coord, chunk);
        runtime.dirty_chunks.insert(coord);
        touched.insert(coord);
    }

    Ok(touched.into_iter().collect())
}

#[cfg(feature = "desktop")]
#[tauri::command]
fn load_registry(state: State<'_, AppState>) -> Result<RegistrySnapshot, String> {
    let mut runtime = state.runtime.lock().map_err(|_| AppError::LockPoisoned.to_string())?;
    if let Some(snapshot) = runtime.registry.clone() {
        return Ok(snapshot);
    }

    let dir = runtime
        .registry_dir
        .clone()
        .unwrap_or_else(default_registry_dir);
    let snapshot = load_registry_from_dir(&dir).map_err(|e| e.to_string())?;
    runtime.registry = Some(snapshot.clone());
    runtime.registry_dir = Some(dir);
    Ok(snapshot)
}

#[cfg(feature = "desktop")]
#[tauri::command]
fn save_registry(state: State<'_, AppState>, snapshot: RegistrySnapshot) -> Result<RegistrySnapshot, String> {
    validate_registry_snapshot(&snapshot).map_err(|e| e.to_string())?;

    let mut runtime = state.runtime.lock().map_err(|_| AppError::LockPoisoned.to_string())?;
    let dir = runtime
        .registry_dir
        .clone()
        .unwrap_or_else(default_registry_dir);
    write_registry_to_dir(&dir, &snapshot).map_err(|e| e.to_string())?;

    if let Some(meta) = runtime.meta.as_mut() {
        meta.registry_version = snapshot.version.clone();
    }

    runtime.registry_dir = Some(dir);
    runtime.registry = Some(snapshot.clone());
    Ok(snapshot)
}

#[cfg(feature = "desktop")]
#[tauri::command]
fn validate_pixel_payload(state: State<'_, AppState>, payload: PixelCell) -> Result<ValidatePixelResponse, String> {
    let mut runtime = state.runtime.lock().map_err(|_| AppError::LockPoisoned.to_string())?;
    if runtime.registry.is_none() {
        let dir = runtime
            .registry_dir
            .clone()
            .unwrap_or_else(default_registry_dir);
        let snapshot = load_registry_from_dir(&dir).map_err(|e| e.to_string())?;
        runtime.registry = Some(snapshot);
        runtime.registry_dir = Some(dir);
    }

    let Some(registry) = runtime.registry.as_ref() else {
        return Err(AppError::RegistryUnavailable.to_string());
    };

    match validate_pixel(&payload, registry) {
        Ok(()) => Ok(ValidatePixelResponse {
            ok: true,
            errors: Vec::new(),
        }),
        Err(AppError::Validation { errors }) => Ok(ValidatePixelResponse { ok: false, errors }),
        Err(other) => Err(other.to_string()),
    }
}

#[cfg(feature = "desktop")]
#[tauri::command]
fn save_world(state: State<'_, AppState>) -> Result<(), String> {
    let mut runtime = state.runtime.lock().map_err(|_| AppError::LockPoisoned.to_string())?;
    runtime.require_meta().map_err(|e| e.to_string())?;

    let dirty_coords = runtime.dirty_chunks.clone();
    for coord in dirty_coords {
        let Some(chunk) = runtime.chunks.get(&coord).cloned() else {
            continue;
        };
        let path = runtime.chunk_path(coord).map_err(|e| e.to_string())?;
        let text = serde_json::to_string_pretty(&chunk).map_err(|e| e.to_string())?;
        fs::write(path, text).map_err(|e| e.to_string())?;
    }

    if let (Some(meta_path), Some(meta)) = (runtime.world_meta_path.clone(), runtime.meta.clone()) {
        let text = serde_json::to_string_pretty(&meta).map_err(|e| e.to_string())?;
        fs::write(meta_path, text).map_err(|e| e.to_string())?;
    }

    runtime.dirty_chunks.clear();
    Ok(())
}

#[cfg(feature = "desktop")]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(AppState::default())
        .invoke_handler(tauri::generate_handler![
            load_world,
            load_chunks,
            apply_pixel_patch,
            load_registry,
            save_registry,
            validate_pixel_payload,
            save_world
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(not(feature = "desktop"))]
pub fn run() {
    panic!("desktop feature is disabled; enable feature 'desktop' to run the Tauri app");
}

#[cfg(test)]
mod tests {
    use super::*;
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
            attributes: vec![AttributeDefinition {
                id: "terrain".to_string(),
                label: "Terrain".to_string(),
                value_set: "terrain_kind".to_string(),
                required: true,
            }],
            value_sets: HashMap::from([(
                "terrain_kind".to_string(),
                vec!["plain".to_string(), "rock".to_string()],
            )]),
            schema: serde_json::json!({
              "$schema": "http://json-schema.org/draft-07/schema#",
              "type": "object",
              "required": ["color", "material", "durability", "attrs"],
              "properties": {
                "color": {
                  "type": "array",
                  "minItems": 3,
                  "maxItems": 3,
                  "items": {"type": "integer", "minimum": 0, "maximum": 255}
                },
                "material": {"type": "string"},
                "durability": {"type": "integer", "minimum": 0},
                "attrs": {
                  "type": "object",
                  "additionalProperties": {"type": "string"}
                }
              },
              "additionalProperties": false
            }),
        }
    }

    fn sample_pixel() -> PixelCell {
        PixelCell {
            color: [10, 20, 30],
            material: "soil".to_string(),
            durability: 40,
            attrs: HashMap::from([("terrain".to_string(), "plain".to_string())]),
        }
    }

    #[test]
    fn validates_valid_pixel() {
        let registry = sample_registry();
        let result = validate_pixel(&sample_pixel(), &registry);
        assert!(result.is_ok());
    }

    #[test]
    fn rejects_invalid_material_and_attrs() {
        let registry = sample_registry();
        let mut pixel = sample_pixel();
        pixel.material = "lava".to_string();
        pixel.attrs.insert("unknown".to_string(), "x".to_string());
        let result = validate_pixel(&pixel, &registry);
        assert!(matches!(result, Err(AppError::Validation { .. })));
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
    fn historical_chunk_without_attrs_is_compatible() {
        let old = serde_json::json!({
          "coord": {"x": 0, "y": 0},
          "cells": {
            "0,0": {
              "color": [1, 2, 3],
              "material": "soil",
              "durability": 5
            }
          }
        });
        let parsed: ChunkData = serde_json::from_value(old).expect("legacy parse");
        let pixel = parsed.cells.get("0,0").expect("pixel present");
        assert!(pixel.attrs.is_empty());
    }

    #[test]
    fn loads_registry_from_files() {
        let temp = tempdir().expect("temp dir");
        let root = temp.path();
        fs::write(
            root.join("registry.json"),
            serde_json::to_string(&serde_json::json!({
              "version": "1.0.0",
              "materials_file": "materials.json",
              "attributes_file": "attributes.json",
              "value_sets_file": "value_sets.json",
              "schema_file": "pixel.schema.json"
            }))
            .expect("registry.json"),
        )
        .expect("write registry");

        fs::write(
            root.join("materials.json"),
            serde_json::to_string(&serde_json::json!({
              "materials": [{"id": "soil", "label": "Soil", "max_durability": 100}]
            }))
            .expect("materials"),
        )
        .expect("write materials");

        fs::write(
            root.join("attributes.json"),
            serde_json::to_string(&serde_json::json!({
              "attributes": [{"id": "terrain", "label": "Terrain", "value_set": "terrain_kind", "required": false}]
            }))
            .expect("attributes"),
        )
        .expect("write attributes");

        fs::write(
            root.join("value_sets.json"),
            serde_json::to_string(&serde_json::json!({
              "value_sets": {"terrain_kind": ["plain"]}
            }))
            .expect("value sets"),
        )
        .expect("write values");

        fs::write(
            root.join("pixel.schema.json"),
            serde_json::to_string(&serde_json::json!({
              "$schema": "http://json-schema.org/draft-07/schema#",
              "type": "object",
              "required": ["color", "material", "durability", "attrs"],
              "properties": {
                "color": {
                  "type": "array",
                  "minItems": 3,
                  "maxItems": 3,
                  "items": {"type": "integer", "minimum": 0, "maximum": 255}
                },
                "material": {"type": "string"},
                "durability": {"type": "integer", "minimum": 0},
                "attrs": {
                  "type": "object",
                  "additionalProperties": {"type": "string"}
                }
              },
              "additionalProperties": false
            }))
            .expect("schema"),
        )
        .expect("write schema");

        let snapshot = load_registry_from_dir(root).expect("load registry");
        assert_eq!(snapshot.version, "1.0.0");
        assert_eq!(snapshot.materials.len(), 1);
        assert_eq!(snapshot.attributes.len(), 1);
        assert!(snapshot.value_sets.contains_key("terrain_kind"));
    }
}
