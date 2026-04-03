use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use thiserror::Error;
#[cfg(feature = "desktop")]
use tauri::menu::{MenuBuilder, SubmenuBuilder};
#[cfg(feature = "desktop")]
use tauri::{Emitter, State};

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
    #[serde(default, flatten)]
    pub properties: HashMap<String, Value>,
}

impl PixelCell {
    fn normalize_legacy_shape(&mut self) {
        if let Some(legacy) = self.properties.remove("attrs") {
            if let Value::Object(attrs) = legacy {
                for (k, v) in attrs {
                    self.properties.entry(k).or_insert(v);
                }
            }
        }

        self.properties.remove("color");
        self.properties.remove("material");
        self.properties.remove("durability");
    }
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

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum PropertyType {
    Int,
    Float,
    Bool,
    String,
    Enum,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct PropertyDefinition {
    pub name: String,
    pub label: String,
    #[serde(rename = "type")]
    pub property_type: PropertyType,
    pub default_value: Value,
    #[serde(default)]
    pub enum_values: Vec<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct RegistrySnapshot {
    pub version: String,
    pub materials: Vec<MaterialDefinition>,
    #[serde(default)]
    pub properties: Vec<PropertyDefinition>,
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
struct LegacyRegistryConfig {
    version: String,
    materials_file: String,
    attributes_file: String,
    value_sets_file: String,
    schema_file: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
struct LegacyMaterialsFile {
    materials: Vec<MaterialDefinition>,
}

#[derive(Debug, Serialize, Deserialize)]
struct LegacyAttributeDefinition {
    id: String,
    label: String,
    value_set: String,
    required: Option<bool>,
}

#[derive(Debug, Serialize, Deserialize)]
struct LegacyAttributesFile {
    attributes: Vec<LegacyAttributeDefinition>,
}

#[derive(Debug, Serialize, Deserialize)]
struct LegacyValueSetsFile {
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
        let mut chunk = if path.exists() {
            let text = fs::read_to_string(path)?;
            serde_json::from_str::<ChunkData>(&text)?
        } else {
            ChunkData {
                coord,
                cells: HashMap::new(),
            }
        };

        let registry = self.registry.clone();
        for pixel in chunk.cells.values_mut() {
            pixel.normalize_legacy_shape();
            if let Some(snapshot) = registry.as_ref() {
                apply_property_defaults(pixel, snapshot);
            }
        }

        self.chunks.insert(coord, chunk.clone());
        Ok(chunk)
    }
}

#[cfg(feature = "desktop")]
#[derive(Default)]
struct AppState {
    runtime: Mutex<WorldRuntime>,
}

#[cfg(feature = "desktop")]
const MENU_NEW_WORLD: &str = "world.new";
#[cfg(feature = "desktop")]
const MENU_OPEN_WORLD: &str = "world.open";
#[cfg(feature = "desktop")]
const MENU_SAVE_WORLD: &str = "world.save";

#[derive(Debug, Error)]
enum AppError {
    #[error("世界尚未加载")]
    NotLoaded,
    #[error("索引库尚未加载")]
    RegistryUnavailable,
    #[error("I/O 错误: {0}")]
    Io(#[from] std::io::Error),
    #[error("JSON 解析错误: {0}")]
    Json(#[from] serde_json::Error),
    #[error("数据校验失败")]
    Validation { errors: Vec<ValidationError> },
    #[error("地图路径无效")]
    InvalidWorldPath,
    #[error("索引库无效: {0}")]
    InvalidRegistry(String),
    #[error("状态锁已损坏")]
    LockPoisoned,
}

fn default_registry_dir() -> PathBuf {
    std::env::current_dir()
        .unwrap_or_else(|_| PathBuf::from("."))
        .join("data")
        .join("registry")
}

fn sibling_registry_dir(world_dir: &Path) -> PathBuf {
    world_dir.parent().unwrap_or(world_dir).join("registry")
}

fn value_matches_type(value: &Value, property_type: &PropertyType) -> bool {
    match property_type {
        PropertyType::Int => value.as_i64().is_some() || value.as_u64().is_some(),
        PropertyType::Float => value.is_number(),
        PropertyType::Bool => value.is_boolean(),
        PropertyType::String => value.is_string(),
        PropertyType::Enum => value.is_string(),
    }
}

fn default_value_for_type(property_type: &PropertyType, enum_values: &[String]) -> Value {
    match property_type {
        PropertyType::Int => Value::from(0),
        PropertyType::Float => Value::from(0.0),
        PropertyType::Bool => Value::from(false),
        PropertyType::String => Value::from(""),
        PropertyType::Enum => Value::from(enum_values.first().cloned().unwrap_or_default()),
    }
}

fn normalize_registry_snapshot(snapshot: &mut RegistrySnapshot) {
    for property in &mut snapshot.properties {
        if property.default_value.is_null() {
            property.default_value = default_value_for_type(&property.property_type, &property.enum_values);
        }
        if property.property_type == PropertyType::Enum {
            if property.default_value.as_str().is_none() {
                property.default_value = default_value_for_type(&property.property_type, &property.enum_values);
            }
            if let Some(default_str) = property.default_value.as_str() {
                if !property.enum_values.is_empty() && !property.enum_values.iter().any(|v| v == default_str) {
                    property.default_value = Value::from(property.enum_values[0].clone());
                }
            }
        }
    }
}

fn convert_legacy_registry(
    version: String,
    materials: Vec<MaterialDefinition>,
    attributes: Vec<LegacyAttributeDefinition>,
    value_sets: HashMap<String, Vec<String>>,
) -> RegistrySnapshot {
    let mut properties = Vec::new();
    for attr in attributes {
        let options = value_sets.get(&attr.value_set).cloned().unwrap_or_default();
        if options.is_empty() {
            properties.push(PropertyDefinition {
                name: attr.id,
                label: attr.label,
                property_type: PropertyType::String,
                default_value: Value::from(""),
                enum_values: Vec::new(),
            });
        } else {
            properties.push(PropertyDefinition {
                name: attr.id,
                label: attr.label,
                property_type: PropertyType::Enum,
                default_value: Value::from(options[0].clone()),
                enum_values: options,
            });
        }
    }

    RegistrySnapshot {
        version,
        materials,
        properties,
    }
}

fn load_registry_from_dir(registry_dir: &Path) -> Result<RegistrySnapshot, AppError> {
    let registry_text = fs::read_to_string(registry_dir.join("registry.json"))?;
    let root: Value = serde_json::from_str(&registry_text)?;

    if root.get("properties").is_some() {
        let mut snapshot: RegistrySnapshot = serde_json::from_value(root)?;
        normalize_registry_snapshot(&mut snapshot);
        validate_registry_snapshot(&snapshot)?;
        return Ok(snapshot);
    }

    let config: LegacyRegistryConfig = serde_json::from_value(root)?;
    let materials: LegacyMaterialsFile = serde_json::from_str(&fs::read_to_string(
        registry_dir.join(config.materials_file.clone()),
    )?)?;
    let attributes: LegacyAttributesFile = serde_json::from_str(&fs::read_to_string(
        registry_dir.join(config.attributes_file.clone()),
    )?)?;
    let value_sets: LegacyValueSetsFile = serde_json::from_str(&fs::read_to_string(
        registry_dir.join(config.value_sets_file.clone()),
    )?)?;

    let mut snapshot = convert_legacy_registry(
        config.version,
        materials.materials,
        attributes.attributes,
        value_sets.value_sets,
    );
    normalize_registry_snapshot(&mut snapshot);
    validate_registry_snapshot(&snapshot)?;
    Ok(snapshot)
}

fn load_builtin_registry() -> Result<RegistrySnapshot, AppError> {
    let mut snapshot: RegistrySnapshot = serde_json::from_str(include_str!("../../data/registry/registry.json"))?;
    normalize_registry_snapshot(&mut snapshot);
    validate_registry_snapshot(&snapshot)?;
    Ok(snapshot)
}

fn load_registry_best_effort(preferred_dir: &Path) -> Result<RegistrySnapshot, AppError> {
    if preferred_dir.exists() {
        if let Ok(snapshot) = load_registry_from_dir(preferred_dir) {
            return Ok(snapshot);
        }
    }

    let fallback_dir = default_registry_dir();
    if fallback_dir.exists() {
        if let Ok(snapshot) = load_registry_from_dir(&fallback_dir) {
            return Ok(snapshot);
        }
    }

    load_builtin_registry()
}

fn validate_registry_snapshot(snapshot: &RegistrySnapshot) -> Result<(), AppError> {
    if snapshot.version.trim().is_empty() {
        return Err(AppError::InvalidRegistry("版本号不能为空".to_string()));
    }

    let mut material_ids: HashSet<&str> = HashSet::new();
    for material in &snapshot.materials {
        if material.id.trim().is_empty() {
            return Err(AppError::InvalidRegistry("材质 ID 不能为空".to_string()));
        }
        if !material_ids.insert(material.id.as_str()) {
            return Err(AppError::InvalidRegistry(format!(
                "材质 ID 重复 '{}'",
                material.id
            )));
        }
    }

    let mut property_names: HashSet<&str> = HashSet::new();
    for property in &snapshot.properties {
        if property.name.trim().is_empty() {
            return Err(AppError::InvalidRegistry("属性名不能为空".to_string()));
        }
        if matches!(property.name.as_str(), "color" | "material" | "durability" | "attrs") {
            return Err(AppError::InvalidRegistry(format!(
                "属性名 '{}' 是保留字段",
                property.name
            )));
        }
        if !property_names.insert(property.name.as_str()) {
            return Err(AppError::InvalidRegistry(format!(
                "属性名重复 '{}'",
                property.name
            )));
        }
        if property.label.trim().is_empty() {
            return Err(AppError::InvalidRegistry(format!(
                "属性 '{}' 的标签不能为空",
                property.name
            )));
        }
        if !value_matches_type(&property.default_value, &property.property_type) {
            return Err(AppError::InvalidRegistry(format!(
                "属性 '{}' 的默认值类型与声明不一致",
                property.name
            )));
        }

        if property.property_type == PropertyType::Enum {
            if property.enum_values.is_empty() {
                return Err(AppError::InvalidRegistry(format!(
                    "枚举属性 '{}' 的可选值不能为空",
                    property.name
                )));
            }
            let mut uniq: HashSet<&str> = HashSet::new();
            for item in &property.enum_values {
                let trimmed = item.trim();
                if trimmed.is_empty() {
                    return Err(AppError::InvalidRegistry(format!(
                        "枚举属性 '{}' 包含空值",
                        property.name
                    )));
                }
                if !uniq.insert(trimmed) {
                    return Err(AppError::InvalidRegistry(format!(
                        "枚举属性 '{}' 的可选值重复 '{}'",
                        property.name, trimmed
                    )));
                }
            }
            let Some(default_str) = property.default_value.as_str() else {
                return Err(AppError::InvalidRegistry(format!(
                    "枚举属性 '{}' 的默认值必须是字符串",
                    property.name
                )));
            };
            if !property.enum_values.iter().any(|v| v == default_str) {
                return Err(AppError::InvalidRegistry(format!(
                    "枚举属性 '{}' 的默认值 '{}' 不在可选值中",
                    property.name, default_str
                )));
            }
        }
    }

    Ok(())
}

fn write_registry_to_dir(registry_dir: &Path, snapshot: &RegistrySnapshot) -> Result<(), AppError> {
    fs::create_dir_all(registry_dir)?;
    fs::write(
        registry_dir.join("registry.json"),
        serde_json::to_string_pretty(snapshot)?,
    )?;
    Ok(())
}

fn apply_property_defaults(pixel: &mut PixelCell, registry: &RegistrySnapshot) {
    for property in &registry.properties {
        if !pixel.properties.contains_key(&property.name) {
            pixel
                .properties
                .insert(property.name.clone(), property.default_value.clone());
        }
    }
}

fn validate_pixel_with_registry(pixel: &PixelCell, registry: &RegistrySnapshot) -> Result<(), AppError> {
    let mut errors: Vec<ValidationError> = Vec::new();

    let material = registry.materials.iter().find(|m| m.id == pixel.material);
    if material.is_none() {
        errors.push(ValidationError {
            field: "material".to_string(),
            message: format!("未知材质: {}", pixel.material),
        });
    }

    if let Some(material_def) = material {
        if pixel.durability > material_def.max_durability {
            errors.push(ValidationError {
                field: "durability".to_string(),
                message: format!(
                    "耐久 {} 超过材质 {} 的最大值 {}",
                    pixel.durability, material_def.max_durability, material_def.id
                ),
            });
        }
    }

    let mut property_map: HashMap<&str, &PropertyDefinition> = HashMap::new();
    for property in &registry.properties {
        property_map.insert(property.name.as_str(), property);
    }

    for (key, value) in &pixel.properties {
        if matches!(key.as_str(), "color" | "material" | "durability" | "attrs") {
            errors.push(ValidationError {
                field: key.clone(),
                message: "该字段为系统保留字段".to_string(),
            });
            continue;
        }

        let Some(property) = property_map.get(key.as_str()) else {
            errors.push(ValidationError {
                field: key.clone(),
                message: "该属性未在索引库中定义".to_string(),
            });
            continue;
        };

        if !value_matches_type(value, &property.property_type) {
            errors.push(ValidationError {
                field: key.clone(),
                message: "属性值类型不匹配".to_string(),
            });
            continue;
        }

        if property.property_type == PropertyType::Enum {
            let Some(current) = value.as_str() else {
                errors.push(ValidationError {
                    field: key.clone(),
                    message: "枚举属性值必须是字符串".to_string(),
                });
                continue;
            };
            if !property.enum_values.iter().any(|item| item == current) {
                errors.push(ValidationError {
                    field: key.clone(),
                    message: format!("值 '{}' 不在枚举可选值中", current),
                });
            }
        }
    }

    if errors.is_empty() {
        Ok(())
    } else {
        Err(AppError::Validation { errors })
    }
}

fn normalize_and_validate_pixel(pixel: &mut PixelCell, registry: &RegistrySnapshot) -> Result<(), AppError> {
    pixel.normalize_legacy_shape();
    apply_property_defaults(pixel, registry);
    validate_pixel_with_registry(pixel, registry)
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

    let registry_dir = sibling_registry_dir(&world_dir);

    let world_meta_text = fs::read_to_string(&meta_path).map_err(|e| e.to_string())?;
    let meta: WorldMeta = serde_json::from_str(&world_meta_text).map_err(|e| e.to_string())?;
    let registry = load_registry_best_effort(&registry_dir).map_err(|e| e.to_string())?;

    let mut runtime = state
        .runtime
        .lock()
        .map_err(|_| AppError::LockPoisoned.to_string())?;
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
fn create_world(state: State<'_, AppState>, meta_path: String) -> Result<LoadWorldResponse, String> {
    let meta_path = PathBuf::from(meta_path);
    let world_dir = meta_path
        .parent()
        .ok_or(AppError::InvalidWorldPath)
        .map_err(|e| e.to_string())?
        .to_path_buf();

    fs::create_dir_all(world_dir.join("chunks")).map_err(|e| e.to_string())?;

    let registry_dir = sibling_registry_dir(&world_dir);
    let registry = load_registry_best_effort(&registry_dir).map_err(|e| e.to_string())?;
    if !registry_dir.exists() {
        write_registry_to_dir(&registry_dir, &registry).map_err(|e| e.to_string())?;
    }

    let meta = WorldMeta {
        version: "1.0.0".to_string(),
        registry_version: registry.version.clone(),
        small_pixel_size: 2,
        big_grid_size: 32,
        chunk_size: 32,
    };

    fs::write(
        &meta_path,
        serde_json::to_string_pretty(&meta).map_err(|e| e.to_string())?,
    )
    .map_err(|e| e.to_string())?;

    let initial_chunk = ChunkData {
        coord: ChunkCoord { x: 0, y: 0 },
        cells: HashMap::new(),
    };
    let chunk_path = world_dir.join("chunks").join("c_0_0.json");
    fs::write(
        &chunk_path,
        serde_json::to_string_pretty(&initial_chunk).map_err(|e| e.to_string())?,
    )
    .map_err(|e| e.to_string())?;

    let mut runtime = state
        .runtime
        .lock()
        .map_err(|_| AppError::LockPoisoned.to_string())?;
    runtime.world_meta_path = Some(meta_path);
    runtime.world_dir = Some(world_dir);
    runtime.registry_dir = Some(registry_dir);
    runtime.meta = Some(meta.clone());
    runtime.registry = Some(registry);
    runtime.chunks.clear();
    runtime.dirty_chunks.clear();
    runtime
        .chunks
        .insert(ChunkCoord { x: 0, y: 0 }, initial_chunk.clone());

    Ok(LoadWorldResponse {
        meta,
        initial_chunks: vec![initial_chunk],
    })
}

#[cfg(feature = "desktop")]
#[tauri::command]
fn load_chunks(state: State<'_, AppState>, chunk_coords: Vec<ChunkCoord>) -> Result<Vec<ChunkData>, String> {
    let mut runtime = state
        .runtime
        .lock()
        .map_err(|_| AppError::LockPoisoned.to_string())?;
    runtime.require_meta().map_err(|e| e.to_string())?;

    chunk_coords
        .into_iter()
        .map(|coord| runtime.load_chunk(coord).map_err(|e| e.to_string()))
        .collect()
}

#[cfg(feature = "desktop")]
#[tauri::command]
fn apply_pixel_patch(state: State<'_, AppState>, patches: Vec<PixelPatch>) -> Result<Vec<ChunkCoord>, String> {
    let mut runtime = state
        .runtime
        .lock()
        .map_err(|_| AppError::LockPoisoned.to_string())?;
    let meta = runtime.require_meta().map_err(|e| e.to_string())?.clone();
    let registry = runtime.require_registry().map_err(|e| e.to_string())?.clone();

    let mut touched: HashSet<ChunkCoord> = HashSet::new();
    for mut patch in patches {
        normalize_and_validate_pixel(&mut patch.pixel, &registry).map_err(|e| e.to_string())?;

        let chunk_size = meta.chunk_size as i32;
        let chunk_x = patch.world_x.div_euclid(chunk_size);
        let chunk_y = patch.world_y.div_euclid(chunk_size);
        let local_x = patch.world_x.rem_euclid(chunk_size);
        let local_y = patch.world_y.rem_euclid(chunk_size);
        let coord = ChunkCoord {
            x: chunk_x,
            y: chunk_y,
        };
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
    let mut runtime = state
        .runtime
        .lock()
        .map_err(|_| AppError::LockPoisoned.to_string())?;
    if let Some(snapshot) = runtime.registry.clone() {
        return Ok(snapshot);
    }

    let dir = runtime
        .registry_dir
        .clone()
        .unwrap_or_else(default_registry_dir);
    let snapshot = load_registry_best_effort(&dir).map_err(|e| e.to_string())?;
    runtime.registry = Some(snapshot.clone());
    runtime.registry_dir = Some(dir);
    Ok(snapshot)
}

#[cfg(feature = "desktop")]
#[tauri::command]
fn save_registry(state: State<'_, AppState>, snapshot: RegistrySnapshot) -> Result<RegistrySnapshot, String> {
    let mut normalized = snapshot;
    normalize_registry_snapshot(&mut normalized);
    validate_registry_snapshot(&normalized).map_err(|e| e.to_string())?;

    let mut runtime = state
        .runtime
        .lock()
        .map_err(|_| AppError::LockPoisoned.to_string())?;
    let dir = runtime
        .registry_dir
        .clone()
        .unwrap_or_else(default_registry_dir);
    write_registry_to_dir(&dir, &normalized).map_err(|e| e.to_string())?;

    if let Some(meta) = runtime.meta.as_mut() {
        meta.registry_version = normalized.version.clone();
    }

    runtime.registry_dir = Some(dir);
    runtime.registry = Some(normalized.clone());
    Ok(normalized)
}

#[cfg(feature = "desktop")]
#[tauri::command]
fn validate_pixel_payload(state: State<'_, AppState>, mut payload: PixelCell) -> Result<ValidatePixelResponse, String> {
    let mut runtime = state
        .runtime
        .lock()
        .map_err(|_| AppError::LockPoisoned.to_string())?;
    if runtime.registry.is_none() {
        let dir = runtime
            .registry_dir
            .clone()
            .unwrap_or_else(default_registry_dir);
        let snapshot = load_registry_best_effort(&dir).map_err(|e| e.to_string())?;
        runtime.registry = Some(snapshot);
        runtime.registry_dir = Some(dir);
    }

    let Some(registry) = runtime.registry.as_ref() else {
        return Err(AppError::RegistryUnavailable.to_string());
    };

    match normalize_and_validate_pixel(&mut payload, registry) {
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
    let mut runtime = state
        .runtime
        .lock()
        .map_err(|_| AppError::LockPoisoned.to_string())?;
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
#[tauri::command]
fn open_release_url(url: String) -> Result<(), String> {
    if !(url.starts_with("https://") || url.starts_with("http://")) {
        return Err("仅允许打开 http/https 链接".to_string());
    }

    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("cmd")
            .args(["/C", "start", "", &url])
            .spawn()
            .map_err(|e| e.to_string())?;
        Ok(())
    }

    #[cfg(not(target_os = "windows"))]
    {
        Err("当前仅在 Windows 环境支持打开外部链接".to_string())
    }
}

#[cfg(feature = "desktop")]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .menu(|app| {
            let world_submenu = SubmenuBuilder::new(app, "地图")
                .text(MENU_NEW_WORLD, "新建")
                .text(MENU_OPEN_WORLD, "打开")
                .text(MENU_SAVE_WORLD, "保存")
                .build()?;
            MenuBuilder::new(app).item(&world_submenu).build()
        })
        .on_menu_event(|app, event| match event.id().as_ref() {
            MENU_NEW_WORLD => {
                if let Err(err) = app.emit("menu:new-world", ()) {
                    eprintln!("failed to emit menu:new-world: {err}");
                }
            }
            MENU_OPEN_WORLD => {
                if let Err(err) = app.emit("menu:open-world", ()) {
                    eprintln!("failed to emit menu:open-world: {err}");
                }
            }
            MENU_SAVE_WORLD => {
                if let Err(err) = app.emit("menu:save-world", ()) {
                    eprintln!("failed to emit menu:save-world: {err}");
                }
            }
            _ => {}
        })
        .manage(AppState::default())
        .invoke_handler(tauri::generate_handler![
            load_world,
            create_world,
            load_chunks,
            apply_pixel_patch,
            load_registry,
            save_registry,
            validate_pixel_payload,
            save_world,
            open_release_url
        ])
        .run(tauri::generate_context!())
        .expect("运行 Tauri 应用失败");
}

#[cfg(not(feature = "desktop"))]
pub fn run() {
    panic!("desktop 功能已禁用；请启用 feature 'desktop' 后再运行");
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
    fn historical_chunk_with_attrs_is_compatible() {
        let old = serde_json::json!({
          "coord": {"x": 0, "y": 0},
          "cells": {
            "0,0": {
              "color": [1, 2, 3],
              "material": "soil",
              "durability": 5,
              "attrs": {
                "terrain": "plain"
              }
            }
          }
        });
        let mut parsed: ChunkData = serde_json::from_value(old).expect("legacy parse");
        let pixel = parsed.cells.get_mut("0,0").expect("pixel present");
        pixel.normalize_legacy_shape();
        assert_eq!(pixel.properties.get("terrain"), Some(&Value::from("plain")));
        assert!(!pixel.properties.contains_key("attrs"));
    }

    #[test]
    fn loads_registry_from_new_format_files() {
        let temp = tempdir().expect("temp dir");
        let root = temp.path();
        fs::write(
            root.join("registry.json"),
            serde_json::to_string(&serde_json::json!({
              "version": "1.0.0",
              "materials": [{"id": "soil", "label": "Soil", "max_durability": 100}],
              "properties": [
                {
                  "name": "terrain",
                  "label": "Terrain",
                  "type": "enum",
                  "default_value": "plain",
                  "enum_values": ["plain", "rock"]
                }
              ]
            }))
            .expect("registry.json"),
        )
        .expect("write registry");

        let snapshot = load_registry_from_dir(root).expect("load registry");
        assert_eq!(snapshot.version, "1.0.0");
        assert_eq!(snapshot.materials.len(), 1);
        assert_eq!(snapshot.properties.len(), 1);
        assert_eq!(snapshot.properties[0].name, "terrain");
    }
}
