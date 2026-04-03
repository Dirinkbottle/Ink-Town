use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashMap;

pub type WorldRevision = u64;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct PlannerRequest {
    pub npc_id: String,
    pub current_tick: u64,
    pub planning_window: u32,
    pub observation: CompressedObservation,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct PlannerResponse {
    pub npc_id: String,
    pub plan_id: String,
    pub events: Vec<PlannedEvent>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct PlannedEvent {
    pub event_id: String,
    pub npc_id: String,
    pub plan_id: String,
    pub seq: u32,
    pub execute_tick: u64,
    pub action: String,
    #[serde(default)]
    pub targets: Vec<String>,
    #[serde(default)]
    pub params: Value,
    pub preconditions: EventPreconditions,
    #[serde(default)]
    pub post_effect_hint: Value,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
pub struct EventPreconditions {
    #[serde(default)]
    pub expected_revisions: HashMap<String, WorldRevision>,
    #[serde(default)]
    pub state_conditions: Vec<StateCondition>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct StateCondition {
    pub target: String,
    pub key: String,
    pub expected: Value,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct EventQueueItem {
    pub npc_id: String,
    pub event: PlannedEvent,
    pub queued_at_tick: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ConflictReport {
    pub tick: u64,
    pub npc_id: String,
    pub plan_id: String,
    pub event_id: String,
    pub reason: String,
    #[serde(default)]
    pub related_npcs: Vec<String>,
    #[serde(default)]
    pub dropped_events: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ObservationCell {
    pub x: i32,
    pub y: i32,
    pub signature: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ObservationSpan {
    pub x1: i32,
    pub x2: i32,
    pub y: i32,
    pub signature: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Default)]
pub struct CompressedObservation {
    #[serde(default)]
    pub spans: Vec<ObservationSpan>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct SimConfig {
    pub tick_hz: u32,
    pub queue_len_limit: usize,
    pub queue_replan_threshold: usize,
    pub planning_window: u32,
    pub max_npcs: usize,
}

impl Default for SimConfig {
    fn default() -> Self {
        Self {
            tick_hz: 10,
            queue_len_limit: 8,
            queue_replan_threshold: 2,
            planning_window: 5,
            max_npcs: 20,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct TickOutcome {
    pub tick: u64,
    pub executed: Vec<PlannedEvent>,
    pub conflicts: Vec<ConflictReport>,
    pub replan_npcs: Vec<String>,
}
