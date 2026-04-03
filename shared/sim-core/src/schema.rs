use crate::error::SimError;
use crate::types::PlannerResponse;
use jsonschema::JSONSchema;
use serde_json::{json, Value};
use std::sync::OnceLock;

fn planner_response_schema() -> &'static JSONSchema {
    static SCHEMA: OnceLock<JSONSchema> = OnceLock::new();
    SCHEMA.get_or_init(|| {
        JSONSchema::compile(&json!({
          "type": "object",
          "required": ["npc_id", "plan_id", "events"],
          "properties": {
            "npc_id": {"type": "string", "minLength": 1},
            "plan_id": {"type": "string", "minLength": 1},
            "events": {
              "type": "array",
              "items": {
                "type": "object",
                "required": [
                  "event_id",
                  "npc_id",
                  "plan_id",
                  "seq",
                  "execute_tick",
                  "action",
                  "preconditions"
                ],
                "properties": {
                  "event_id": {"type": "string", "minLength": 1},
                  "npc_id": {"type": "string", "minLength": 1},
                  "plan_id": {"type": "string", "minLength": 1},
                  "seq": {"type": "integer", "minimum": 0},
                  "execute_tick": {"type": "integer", "minimum": 0},
                  "action": {"type": "string", "minLength": 1},
                  "targets": {
                    "type": "array",
                    "items": {"type": "string"}
                  },
                  "params": {"type": ["object", "array", "string", "number", "boolean", "null"]},
                  "post_effect_hint": {"type": ["object", "array", "string", "number", "boolean", "null"]},
                  "preconditions": {
                    "type": "object",
                    "properties": {
                      "expected_revisions": {
                        "type": "object",
                        "additionalProperties": {"type": "integer", "minimum": 0}
                      },
                      "state_conditions": {
                        "type": "array",
                        "items": {
                          "type": "object",
                          "required": ["target", "key", "expected"],
                          "properties": {
                            "target": {"type": "string"},
                            "key": {"type": "string"},
                            "expected": {}
                          }
                        }
                      }
                    },
                    "additionalProperties": false
                  }
                },
                "additionalProperties": false
              }
            }
          },
          "additionalProperties": false
        }))
        .expect("planner schema must be valid")
    })
}

pub fn validate_planner_response_json(value: &Value) -> Result<PlannerResponse, SimError> {
    let schema = planner_response_schema();
    if let Err(errors) = schema.validate(value) {
        let joined = errors
            .map(|err| err.to_string())
            .collect::<Vec<_>>()
            .join("; ");
        return Err(SimError::Schema(joined));
    }

    serde_json::from_value(value.clone()).map_err(|err| SimError::Parse(err.to_string()))
}
