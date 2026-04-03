use super::types::GatewayError;
use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sim_core::PlannerRequest;

#[async_trait]
pub trait PlannerProvider: Send + Sync + 'static {
    async fn plan_raw(&self, request: &PlannerRequest) -> Result<Value, GatewayError>;
}

#[derive(Debug, Clone)]
pub struct OpenAiCompatibleProvider {
    pub endpoint: String,
    pub api_key: String,
    pub model: String,
    pub client: reqwest::Client,
}

#[derive(Debug, Deserialize)]
struct ChatCompletionResponse {
    choices: Vec<ChatChoice>,
}

#[derive(Debug, Deserialize)]
struct ChatChoice {
    message: ChatMessage,
}

#[derive(Debug, Deserialize)]
struct ChatMessage {
    content: String,
}

#[derive(Debug, Serialize)]
struct ChatCompletionRequest {
    model: String,
    response_format: Value,
    messages: Vec<Value>,
}

impl OpenAiCompatibleProvider {
    pub fn from_env() -> Option<Self> {
        let api_key = std::env::var("OPENAI_API_KEY").ok()?;
        let endpoint = std::env::var("OPENAI_BASE_URL")
            .unwrap_or_else(|_| "https://api.openai.com/v1".to_string());
        let model = std::env::var("OPENAI_MODEL").unwrap_or_else(|_| "gpt-4.1-mini".to_string());

        Some(Self {
            endpoint,
            api_key,
            model,
            client: reqwest::Client::new(),
        })
    }
}

#[async_trait]
impl PlannerProvider for OpenAiCompatibleProvider {
    async fn plan_raw(&self, request: &PlannerRequest) -> Result<Value, GatewayError> {
        let payload = ChatCompletionRequest {
            model: self.model.clone(),
            response_format: json!({
                "type": "json_object"
            }),
            messages: vec![
                json!({
                    "role": "system",
                    "content": "You are a planner for an NPC simulation. Return strict JSON only."
                }),
                json!({
                    "role": "user",
                    "content": format!(
                        "Plan 3-5 actions. Request JSON: {}",
                        serde_json::to_string(request)
                            .map_err(|err| GatewayError::Provider(err.to_string()))?
                    )
                }),
            ],
        };

        let url = format!("{}/chat/completions", self.endpoint.trim_end_matches('/'));
        let response = self
            .client
            .post(url)
            .bearer_auth(&self.api_key)
            .json(&payload)
            .send()
            .await
            .map_err(|err| GatewayError::Provider(err.to_string()))?
            .error_for_status()
            .map_err(|err| GatewayError::Provider(err.to_string()))?;

        let body: ChatCompletionResponse = response
            .json()
            .await
            .map_err(|err| GatewayError::Provider(err.to_string()))?;

        let content = body
            .choices
            .first()
            .map(|choice| choice.message.content.as_str())
            .ok_or_else(|| GatewayError::Provider("missing response choice".to_string()))?;

        serde_json::from_str(content).map_err(|err| GatewayError::Provider(err.to_string()))
    }
}

#[derive(Debug, Clone, Default)]
pub struct MockProvider;

#[async_trait]
impl PlannerProvider for MockProvider {
    async fn plan_raw(&self, request: &PlannerRequest) -> Result<Value, GatewayError> {
        let start_tick = request.current_tick + 1;
        Ok(json!({
          "npc_id": request.npc_id,
          "plan_id": format!("plan-{}-{}", request.npc_id, request.current_tick),
          "events": [
            {
              "event_id": format!("{}-{}", request.npc_id, start_tick),
              "npc_id": request.npc_id,
              "plan_id": format!("plan-{}-{}", request.npc_id, request.current_tick),
              "seq": 0,
              "execute_tick": start_tick,
              "action": "idle",
              "targets": [],
              "params": {},
              "preconditions": {
                "expected_revisions": {},
                "state_conditions": []
              },
              "post_effect_hint": {"kind": "noop"}
            },
            {
              "event_id": format!("{}-{}", request.npc_id, start_tick + 1),
              "npc_id": request.npc_id,
              "plan_id": format!("plan-{}-{}", request.npc_id, request.current_tick),
              "seq": 1,
              "execute_tick": start_tick + 1,
              "action": "scan",
              "targets": [],
              "params": {},
              "preconditions": {
                "expected_revisions": {},
                "state_conditions": []
              },
              "post_effect_hint": {"kind": "sense"}
            }
          ]
        }))
    }
}
