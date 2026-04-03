use thiserror::Error;

#[derive(Debug, Error)]
pub enum SimError {
    #[error("queue for npc '{0}' exceeds configured limit")]
    QueueOverflow(String),
    #[error("planner response schema invalid: {0}")]
    Schema(String),
    #[error("planner response parse failed: {0}")]
    Parse(String),
}
