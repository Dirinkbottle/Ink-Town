use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashMap;

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq, Eq)]
pub struct WorldMeta {
    pub version: String,
    pub registry_version: String,
    pub small_pixel_size: u32,
    pub big_grid_size: u32,
    pub chunk_size: u32,
}

#[derive(Debug, Serialize, Deserialize, Clone, Copy, Eq, PartialEq, Hash, PartialOrd, Ord)]
pub struct ChunkCoord {
    pub x: i32,
    pub y: i32,
}

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq)]
pub struct PixelCell {
    pub color: [u8; 3],
    pub material: String,
    pub durability: u32,
    #[serde(default, flatten)]
    pub properties: HashMap<String, Value>,
}

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq)]
pub struct ChunkData {
    pub coord: ChunkCoord,
    #[serde(default)]
    pub cells: HashMap<String, PixelCell>,
}

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq, Eq)]
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

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq)]
pub struct PropertyDefinition {
    pub name: String,
    pub label: String,
    #[serde(rename = "type")]
    pub property_type: PropertyType,
    pub default_value: Value,
    #[serde(default)]
    pub enum_values: Vec<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq)]
pub struct RegistrySnapshot {
    pub version: String,
    pub materials: Vec<MaterialDefinition>,
    #[serde(default)]
    pub properties: Vec<PropertyDefinition>,
}

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq, Eq)]
pub struct ValidationError {
    pub field: String,
    pub message: String,
}

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq, Eq)]
pub struct ValidatePixelResponse {
    pub ok: bool,
    pub errors: Vec<ValidationError>,
}

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq)]
pub struct LoadWorldResponse {
    pub meta: WorldMeta,
    pub initial_chunks: Vec<ChunkData>,
}

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq)]
pub struct PixelPatch {
    pub world_x: i32,
    pub world_y: i32,
    pub pixel: PixelCell,
}
