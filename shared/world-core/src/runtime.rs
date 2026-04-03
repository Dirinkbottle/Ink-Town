use crate::error::WorldCoreError;
use crate::registry::{
    default_registry_dir, load_registry_best_effort, normalize_registry_snapshot,
    sibling_registry_dir, validate_registry_snapshot, value_matches_type, write_registry_to_dir,
};
use crate::types::{
    ChunkCoord, ChunkData, LoadWorldResponse, PixelCell, PixelPatch, PropertyDefinition,
    PropertyType, RegistrySnapshot, ValidatePixelResponse, ValidationError, WorldMeta,
};
use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::{Path, PathBuf};

#[derive(Debug, Default)]
pub struct WorldRuntime {
    world_meta_path: Option<PathBuf>,
    world_dir: Option<PathBuf>,
    registry_dir: Option<PathBuf>,
    meta: Option<WorldMeta>,
    registry: Option<RegistrySnapshot>,
    chunks: HashMap<ChunkCoord, ChunkData>,
    dirty_chunks: HashSet<ChunkCoord>,
}

impl WorldRuntime {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn load_world(
        &mut self,
        meta_path: impl AsRef<Path>,
    ) -> Result<LoadWorldResponse, WorldCoreError> {
        let meta_path = meta_path.as_ref().to_path_buf();
        let world_dir = meta_path
            .parent()
            .ok_or(WorldCoreError::InvalidWorldPath)?
            .to_path_buf();

        let registry_dir = sibling_registry_dir(&world_dir);
        let world_meta_text = fs::read_to_string(&meta_path)?;
        let meta: WorldMeta = serde_json::from_str(&world_meta_text)?;
        let registry = load_registry_best_effort(&registry_dir)?;

        self.world_meta_path = Some(meta_path);
        self.world_dir = Some(world_dir);
        self.registry_dir = Some(registry_dir);
        self.meta = Some(meta.clone());
        self.registry = Some(registry);
        self.chunks.clear();
        self.dirty_chunks.clear();

        let initial = self.load_chunk(ChunkCoord { x: 0, y: 0 })?;
        Ok(LoadWorldResponse {
            meta,
            initial_chunks: vec![initial],
        })
    }

    pub fn create_world(
        &mut self,
        meta_path: impl AsRef<Path>,
    ) -> Result<LoadWorldResponse, WorldCoreError> {
        let meta_path = meta_path.as_ref().to_path_buf();
        let world_dir = meta_path
            .parent()
            .ok_or(WorldCoreError::InvalidWorldPath)?
            .to_path_buf();

        fs::create_dir_all(&world_dir)?;
        fs::create_dir_all(world_dir.join("chunks"))?;

        let registry_dir = sibling_registry_dir(&world_dir);
        let registry = load_registry_best_effort(&registry_dir)?;
        if !registry_dir.exists() {
            write_registry_to_dir(&registry_dir, &registry)?;
        }

        let meta = WorldMeta {
            version: "1.0.0".to_string(),
            registry_version: registry.version.clone(),
            small_pixel_size: 2,
            big_grid_size: 32,
            chunk_size: 32,
        };

        fs::write(&meta_path, serde_json::to_string_pretty(&meta)?)?;
        let initial_chunk = ChunkData {
            coord: ChunkCoord { x: 0, y: 0 },
            cells: HashMap::new(),
        };
        fs::write(
            world_dir.join("chunks").join("c_0_0.json"),
            serde_json::to_string_pretty(&initial_chunk)?,
        )?;

        self.world_meta_path = Some(meta_path);
        self.world_dir = Some(world_dir);
        self.registry_dir = Some(registry_dir);
        self.meta = Some(meta.clone());
        self.registry = Some(registry);
        self.chunks.clear();
        self.dirty_chunks.clear();
        self.chunks
            .insert(initial_chunk.coord, initial_chunk.clone());

        Ok(LoadWorldResponse {
            meta,
            initial_chunks: vec![initial_chunk],
        })
    }

    pub fn load_chunks(
        &mut self,
        chunk_coords: &[ChunkCoord],
    ) -> Result<Vec<ChunkData>, WorldCoreError> {
        self.require_meta()?;
        chunk_coords
            .iter()
            .copied()
            .map(|coord| self.load_chunk(coord))
            .collect()
    }

    pub fn apply_pixel_patch(
        &mut self,
        patches: &[PixelPatch],
    ) -> Result<Vec<ChunkCoord>, WorldCoreError> {
        let meta = self.require_meta()?.clone();
        let registry = self.require_registry()?.clone();

        let mut touched: HashSet<ChunkCoord> = HashSet::new();
        for patch in patches {
            let mut pixel = patch.pixel.clone();
            normalize_and_validate_pixel(&mut pixel, &registry)?;

            let chunk_size = meta.chunk_size as i32;
            let chunk_x = patch.world_x.div_euclid(chunk_size);
            let chunk_y = patch.world_y.div_euclid(chunk_size);
            let local_x = patch.world_x.rem_euclid(chunk_size);
            let local_y = patch.world_y.rem_euclid(chunk_size);
            let coord = ChunkCoord {
                x: chunk_x,
                y: chunk_y,
            };
            let mut chunk = self.load_chunk(coord)?;
            chunk
                .cells
                .insert(format!("{},{}", local_x, local_y), pixel);

            self.chunks.insert(coord, chunk);
            self.dirty_chunks.insert(coord);
            touched.insert(coord);
        }

        let mut list: Vec<ChunkCoord> = touched.into_iter().collect();
        list.sort_unstable();
        Ok(list)
    }

    pub fn load_registry(&mut self) -> Result<RegistrySnapshot, WorldCoreError> {
        if let Some(snapshot) = self.registry.clone() {
            return Ok(snapshot);
        }

        let dir = self
            .registry_dir
            .clone()
            .unwrap_or_else(default_registry_dir);
        let snapshot = load_registry_best_effort(&dir)?;
        self.registry = Some(snapshot.clone());
        self.registry_dir = Some(dir);
        Ok(snapshot)
    }

    pub fn save_registry(
        &mut self,
        snapshot: RegistrySnapshot,
    ) -> Result<RegistrySnapshot, WorldCoreError> {
        let mut normalized = snapshot;
        normalize_registry_snapshot(&mut normalized);
        validate_registry_snapshot(&normalized)?;

        let dir = self
            .registry_dir
            .clone()
            .unwrap_or_else(default_registry_dir);
        write_registry_to_dir(&dir, &normalized)?;

        if let Some(meta) = self.meta.as_mut() {
            meta.registry_version = normalized.version.clone();
        }

        self.registry_dir = Some(dir);
        self.registry = Some(normalized.clone());
        Ok(normalized)
    }

    pub fn validate_pixel_payload(
        &mut self,
        mut payload: PixelCell,
    ) -> Result<ValidatePixelResponse, WorldCoreError> {
        if self.registry.is_none() {
            let dir = self
                .registry_dir
                .clone()
                .unwrap_or_else(default_registry_dir);
            let snapshot = load_registry_best_effort(&dir)?;
            self.registry = Some(snapshot);
            self.registry_dir = Some(dir);
        }

        let Some(registry) = self.registry.as_ref() else {
            return Err(WorldCoreError::RegistryUnavailable);
        };

        match normalize_and_validate_pixel(&mut payload, registry) {
            Ok(()) => Ok(ValidatePixelResponse {
                ok: true,
                errors: Vec::new(),
            }),
            Err(WorldCoreError::Validation { errors }) => {
                Ok(ValidatePixelResponse { ok: false, errors })
            }
            Err(other) => Err(other),
        }
    }

    pub fn save_world(&mut self) -> Result<(), WorldCoreError> {
        self.require_meta()?;

        let dirty_coords = self.dirty_chunks.clone();
        for coord in dirty_coords {
            let Some(chunk) = self.chunks.get(&coord).cloned() else {
                continue;
            };
            let path = self.chunk_path(coord)?;
            fs::write(path, serde_json::to_string_pretty(&chunk)?)?;
        }

        if let (Some(meta_path), Some(meta)) = (self.world_meta_path.clone(), self.meta.clone()) {
            fs::write(meta_path, serde_json::to_string_pretty(&meta)?)?;
        }

        self.dirty_chunks.clear();
        Ok(())
    }

    pub fn meta(&self) -> Option<&WorldMeta> {
        self.meta.as_ref()
    }

    pub fn registry(&self) -> Option<&RegistrySnapshot> {
        self.registry.as_ref()
    }

    pub fn loaded_chunks(&self) -> &HashMap<ChunkCoord, ChunkData> {
        &self.chunks
    }

    fn require_meta(&self) -> Result<&WorldMeta, WorldCoreError> {
        self.meta.as_ref().ok_or(WorldCoreError::NotLoaded)
    }

    fn require_world_dir(&self) -> Result<&PathBuf, WorldCoreError> {
        self.world_dir.as_ref().ok_or(WorldCoreError::NotLoaded)
    }

    fn require_registry(&self) -> Result<&RegistrySnapshot, WorldCoreError> {
        self.registry
            .as_ref()
            .ok_or(WorldCoreError::RegistryUnavailable)
    }

    fn chunk_path(&self, coord: ChunkCoord) -> Result<PathBuf, WorldCoreError> {
        let mut path = self.require_world_dir()?.join("chunks");
        fs::create_dir_all(&path)?;
        path.push(format!("c_{}_{}.json", coord.x, coord.y));
        Ok(path)
    }

    fn load_chunk(&mut self, coord: ChunkCoord) -> Result<ChunkData, WorldCoreError> {
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
            if let Some(snapshot) = registry.as_ref() {
                apply_property_defaults(pixel, snapshot);
            }
        }

        self.chunks.insert(coord, chunk.clone());
        Ok(chunk)
    }
}

pub fn apply_property_defaults(pixel: &mut PixelCell, registry: &RegistrySnapshot) {
    for property in &registry.properties {
        if !pixel.properties.contains_key(&property.name) {
            pixel
                .properties
                .insert(property.name.clone(), property.default_value.clone());
        }
    }
}

pub fn validate_pixel_with_registry(
    pixel: &PixelCell,
    registry: &RegistrySnapshot,
) -> Result<(), WorldCoreError> {
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
                    "durability {} exceeds material {} max {}",
                    pixel.durability, material_def.id, material_def.max_durability
                ),
            });
        }
    }

    let property_map: HashMap<&str, &PropertyDefinition> = registry
        .properties
        .iter()
        .map(|property| (property.name.as_str(), property))
        .collect();

    for (key, value) in &pixel.properties {
        if matches!(key.as_str(), "color" | "material" | "durability") {
            errors.push(ValidationError {
                field: key.clone(),
                message: "reserved system field".to_string(),
            });
            continue;
        }

        let Some(property) = property_map.get(key.as_str()) else {
            errors.push(ValidationError {
                field: key.clone(),
                message: "property is not declared in registry".to_string(),
            });
            continue;
        };

        if !value_matches_type(value, &property.property_type) {
            errors.push(ValidationError {
                field: key.clone(),
                message: "property value type mismatch".to_string(),
            });
            continue;
        }

        if property.property_type == PropertyType::Enum {
            let Some(current) = value.as_str() else {
                errors.push(ValidationError {
                    field: key.clone(),
                    message: "enum property must be string".to_string(),
                });
                continue;
            };
            if !property.enum_values.iter().any(|item| item == current) {
                errors.push(ValidationError {
                    field: key.clone(),
                    message: format!("value '{}' not in enum values", current),
                });
            }
        }
    }

    if errors.is_empty() {
        Ok(())
    } else {
        Err(WorldCoreError::Validation { errors })
    }
}

pub fn normalize_and_validate_pixel(
    pixel: &mut PixelCell,
    registry: &RegistrySnapshot,
) -> Result<(), WorldCoreError> {
    apply_property_defaults(pixel, registry);
    validate_pixel_with_registry(pixel, registry)
}
