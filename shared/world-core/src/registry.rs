use crate::error::WorldCoreError;
use crate::types::{PropertyDefinition, PropertyType, RegistrySnapshot};
use serde_json::Value;
use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};

pub fn default_registry_dir() -> PathBuf {
    std::env::current_dir()
        .unwrap_or_else(|_| PathBuf::from("."))
        .join("data")
        .join("registry")
}

pub fn sibling_registry_dir(world_dir: &Path) -> PathBuf {
    world_dir.parent().unwrap_or(world_dir).join("registry")
}

pub fn load_registry_from_dir(registry_dir: &Path) -> Result<RegistrySnapshot, WorldCoreError> {
    let registry_text = fs::read_to_string(registry_dir.join("registry.json"))?;
    let root: Value = serde_json::from_str(&registry_text)?;
    if root.get("properties").is_none() {
        return Err(WorldCoreError::InvalidRegistry(
            "registry.json must include properties field; legacy format is not supported"
                .to_string(),
        ));
    }

    let mut snapshot: RegistrySnapshot = serde_json::from_value(root)?;
    normalize_registry_snapshot(&mut snapshot);
    validate_registry_snapshot(&snapshot)?;
    Ok(snapshot)
}

pub fn load_builtin_registry() -> Result<RegistrySnapshot, WorldCoreError> {
    let mut snapshot: RegistrySnapshot =
        serde_json::from_str(include_str!("../../../data/registry/registry.json"))?;
    normalize_registry_snapshot(&mut snapshot);
    validate_registry_snapshot(&snapshot)?;
    Ok(snapshot)
}

pub fn load_registry_best_effort(preferred_dir: &Path) -> Result<RegistrySnapshot, WorldCoreError> {
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

pub fn write_registry_to_dir(
    registry_dir: &Path,
    snapshot: &RegistrySnapshot,
) -> Result<(), WorldCoreError> {
    fs::create_dir_all(registry_dir)?;
    fs::write(
        registry_dir.join("registry.json"),
        serde_json::to_string_pretty(snapshot)?,
    )?;
    Ok(())
}

pub fn normalize_registry_snapshot(snapshot: &mut RegistrySnapshot) {
    for property in &mut snapshot.properties {
        if property.default_value.is_null() {
            property.default_value =
                default_value_for_type(&property.property_type, &property.enum_values);
        }
        if property.property_type == PropertyType::Enum {
            if property.default_value.as_str().is_none() {
                property.default_value =
                    default_value_for_type(&property.property_type, &property.enum_values);
            }
            if let Some(default_str) = property.default_value.as_str() {
                if !property.enum_values.is_empty()
                    && !property.enum_values.iter().any(|v| v == default_str)
                {
                    property.default_value = Value::from(property.enum_values[0].clone());
                }
            }
        }
    }
}

pub fn validate_registry_snapshot(snapshot: &RegistrySnapshot) -> Result<(), WorldCoreError> {
    if snapshot.version.trim().is_empty() {
        return Err(WorldCoreError::InvalidRegistry(
            "registry version cannot be empty".to_string(),
        ));
    }

    let mut material_ids: HashSet<String> = HashSet::new();
    for material in &snapshot.materials {
        if material.id.trim().is_empty() {
            return Err(WorldCoreError::InvalidRegistry(
                "material id cannot be empty".to_string(),
            ));
        }
        if !material_ids.insert(material.id.clone()) {
            return Err(WorldCoreError::InvalidRegistry(format!(
                "material id duplicated '{}'",
                material.id
            )));
        }
    }

    let mut property_names: HashSet<String> = HashSet::new();
    for property in &snapshot.properties {
        validate_property_definition(property, &mut property_names)?;
    }

    Ok(())
}

fn validate_property_definition(
    property: &PropertyDefinition,
    property_names: &mut HashSet<String>,
) -> Result<(), WorldCoreError> {
    if property.name.trim().is_empty() {
        return Err(WorldCoreError::InvalidRegistry(
            "property name cannot be empty".to_string(),
        ));
    }
    if matches!(property.name.as_str(), "color" | "material" | "durability") {
        return Err(WorldCoreError::InvalidRegistry(format!(
            "property '{}' is reserved",
            property.name
        )));
    }
    if !property_names.insert(property.name.clone()) {
        return Err(WorldCoreError::InvalidRegistry(format!(
            "property duplicated '{}'",
            property.name
        )));
    }
    if property.label.trim().is_empty() {
        return Err(WorldCoreError::InvalidRegistry(format!(
            "property '{}' label cannot be empty",
            property.name
        )));
    }
    if !value_matches_type(&property.default_value, &property.property_type) {
        return Err(WorldCoreError::InvalidRegistry(format!(
            "property '{}' default type mismatched",
            property.name
        )));
    }

    if property.property_type == PropertyType::Enum {
        if property.enum_values.is_empty() {
            return Err(WorldCoreError::InvalidRegistry(format!(
                "enum property '{}' must have values",
                property.name
            )));
        }

        let mut uniq: HashSet<&str> = HashSet::new();
        for item in &property.enum_values {
            let trimmed = item.trim();
            if trimmed.is_empty() {
                return Err(WorldCoreError::InvalidRegistry(format!(
                    "enum property '{}' contains empty value",
                    property.name
                )));
            }
            if !uniq.insert(trimmed) {
                return Err(WorldCoreError::InvalidRegistry(format!(
                    "enum property '{}' duplicated value '{}'",
                    property.name, trimmed
                )));
            }
        }

        let Some(default_str) = property.default_value.as_str() else {
            return Err(WorldCoreError::InvalidRegistry(format!(
                "enum property '{}' default must be string",
                property.name
            )));
        };
        if !property.enum_values.iter().any(|v| v == default_str) {
            return Err(WorldCoreError::InvalidRegistry(format!(
                "enum property '{}' default '{}' not in enum values",
                property.name, default_str
            )));
        }
    }

    Ok(())
}

pub fn value_matches_type(value: &Value, property_type: &PropertyType) -> bool {
    match property_type {
        PropertyType::Int => value.as_i64().is_some() || value.as_u64().is_some(),
        PropertyType::Float => value.is_number(),
        PropertyType::Bool => value.is_boolean(),
        PropertyType::String => value.is_string(),
        PropertyType::Enum => value.is_string(),
    }
}

pub fn default_value_for_type(property_type: &PropertyType, enum_values: &[String]) -> Value {
    match property_type {
        PropertyType::Int => Value::from(0),
        PropertyType::Float => Value::from(0.0),
        PropertyType::Bool => Value::from(false),
        PropertyType::String => Value::from(""),
        PropertyType::Enum => Value::from(enum_values.first().cloned().unwrap_or_default()),
    }
}
