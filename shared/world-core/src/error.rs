use crate::types::ValidationError;
use thiserror::Error;

#[derive(Debug, Error)]
pub enum WorldCoreError {
    #[error("world is not loaded")]
    NotLoaded,
    #[error("registry is not loaded")]
    RegistryUnavailable,
    #[error("I/O error: {0}")]
    Io(#[from] std::io::Error),
    #[error("JSON parse error: {0}")]
    Json(#[from] serde_json::Error),
    #[error("validation failed")]
    Validation { errors: Vec<ValidationError> },
    #[error("invalid world path")]
    InvalidWorldPath,
    #[error("invalid registry: {0}")]
    InvalidRegistry(String),
}
