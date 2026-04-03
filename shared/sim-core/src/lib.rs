mod error;
mod observation;
mod schema;
mod sim;
mod types;

pub use error::SimError;
pub use observation::{compress_observation, expand_observation};
pub use schema::validate_planner_response_json;
pub use sim::SimCore;
pub use types::{
    CompressedObservation, ConflictReport, EventPreconditions, EventQueueItem, ObservationCell,
    ObservationSpan, PlannedEvent, PlannerRequest, PlannerResponse, SimConfig, StateCondition,
    TickOutcome, WorldRevision,
};

#[cfg(test)]
mod tests {
    use super::*;
    use pretty_assertions::assert_eq;
    use serde_json::{json, Value};
    use std::collections::HashMap;

    #[test]
    fn validates_planner_schema() {
        let valid = json!({
          "npc_id": "npc-1",
          "plan_id": "plan-1",
          "events": [
            {
              "event_id": "e-1",
              "npc_id": "npc-1",
              "plan_id": "plan-1",
              "seq": 0,
              "execute_tick": 1,
              "action": "move",
              "targets": ["tile:1,1"],
              "params": {"dx": 1, "dy": 0},
              "preconditions": {
                "expected_revisions": {"tile:1,1": 0},
                "state_conditions": []
              },
              "post_effect_hint": {"type": "move"}
            }
          ]
        });
        assert!(validate_planner_response_json(&valid).is_ok());

        let invalid = json!({
          "npc_id": "npc-1",
          "plan_id": "plan-1",
          "events": [
            {
              "event_id": "e-1",
              "npc_id": "npc-1",
              "plan_id": "plan-1",
              "seq": "zero",
              "execute_tick": 1,
              "action": "move",
              "preconditions": {}
            }
          ]
        });
        assert!(validate_planner_response_json(&invalid).is_err());
    }

    #[test]
    fn compress_expand_observation_roundtrip() {
        let cells = vec![
            ObservationCell {
                x: 1,
                y: 2,
                signature: "soil|10".to_string(),
            },
            ObservationCell {
                x: 2,
                y: 2,
                signature: "soil|10".to_string(),
            },
            ObservationCell {
                x: 3,
                y: 2,
                signature: "stone|20".to_string(),
            },
            ObservationCell {
                x: 5,
                y: 2,
                signature: "stone|20".to_string(),
            },
        ];

        let compressed = compress_observation(&cells);
        assert_eq!(compressed.spans.len(), 3);

        let expanded = expand_observation(&compressed);
        assert_eq!(expanded, {
            let mut sorted = cells.clone();
            sorted.sort_by_key(|c| (c.y, c.x, c.signature.clone()));
            sorted
        });
    }

    #[test]
    fn conflict_truncates_tail_and_replan() {
        let mut sim = SimCore::new(
            SimConfig {
                tick_hz: 10,
                queue_len_limit: 8,
                queue_replan_threshold: 2,
                planning_window: 5,
                max_npcs: 20,
            },
            vec!["npc-a".to_string(), "npc-b".to_string()],
        );

        sim.enqueue_plan(PlannerResponse {
            npc_id: "npc-a".to_string(),
            plan_id: "plan-a".to_string(),
            events: vec![
                PlannedEvent {
                    event_id: "a-1".to_string(),
                    npc_id: "npc-a".to_string(),
                    plan_id: "plan-a".to_string(),
                    seq: 0,
                    execute_tick: 1,
                    action: "gather".to_string(),
                    targets: vec!["tile:0,0".to_string(), "npc:npc-b".to_string()],
                    params: json!({}),
                    preconditions: EventPreconditions {
                        expected_revisions: HashMap::from([("tile:0,0".to_string(), 3)]),
                        state_conditions: vec![],
                    },
                    post_effect_hint: json!({}),
                },
                PlannedEvent {
                    event_id: "a-2".to_string(),
                    npc_id: "npc-a".to_string(),
                    plan_id: "plan-a".to_string(),
                    seq: 1,
                    execute_tick: 2,
                    action: "move".to_string(),
                    targets: vec!["tile:0,1".to_string()],
                    params: json!({}),
                    preconditions: EventPreconditions::default(),
                    post_effect_hint: json!({}),
                },
            ],
        })
        .expect("enqueue");

        let revisions = HashMap::from([("tile:0,0".to_string(), 1_u64)]);
        let outcome = sim.step_tick(
            |target| revisions.get(target).copied(),
            |_target, _key| -> Option<Value> { None },
        );

        assert_eq!(outcome.executed.len(), 0);
        assert_eq!(outcome.conflicts.len(), 1);
        assert!(outcome.replan_npcs.contains(&"npc-a".to_string()));
        assert!(outcome.replan_npcs.contains(&"npc-b".to_string()));

        let snapshot = sim.queue_snapshot();
        assert_eq!(snapshot["npc-a"].len(), 0);
    }
}
