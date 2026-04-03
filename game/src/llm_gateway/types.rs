use thiserror::Error;

#[derive(Debug, Error)]
pub enum GatewayError {
    #[error("provider call failed: {0}")]
    Provider(String),
    #[error("provider timeout after {0} seconds")]
    Timeout(u64),
    #[error("planner response schema invalid: {0}")]
    InvalidSchema(String),
    #[error("gateway retry exhausted: {0}")]
    RetryExhausted(String),
}
