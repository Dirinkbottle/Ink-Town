mod provider;
mod types;

pub use provider::{MockProvider, OpenAiCompatibleProvider, PlannerProvider};
pub use types::GatewayError;

use sim_core::{validate_planner_response_json, PlannerRequest, PlannerResponse};
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::Semaphore;

#[derive(Clone)]
pub struct LlmGateway {
    provider: Arc<dyn PlannerProvider>,
    semaphore: Arc<Semaphore>,
    timeout: Duration,
    retries: u32,
}

impl LlmGateway {
    pub fn new(provider: Arc<dyn PlannerProvider>) -> Self {
        Self {
            provider,
            semaphore: Arc::new(Semaphore::new(8)),
            timeout: Duration::from_secs(8),
            retries: 2,
        }
    }

    pub fn with_limits(mut self, parallel_limit: usize, timeout: Duration, retries: u32) -> Self {
        self.semaphore = Arc::new(Semaphore::new(parallel_limit.max(1)));
        self.timeout = timeout;
        self.retries = retries;
        self
    }

    pub async fn plan_for_npc(
        &self,
        request: PlannerRequest,
    ) -> Result<PlannerResponse, GatewayError> {
        let mut attempt = 0;
        loop {
            let permit = self
                .semaphore
                .acquire()
                .await
                .map_err(|err| GatewayError::Provider(err.to_string()))?;

            let call = self.provider.plan_raw(&request);
            let timed = tokio::time::timeout(self.timeout, call).await;
            drop(permit);

            match timed {
                Ok(Ok(json_value)) => match validate_planner_response_json(&json_value) {
                    Ok(response) => return Ok(response),
                    Err(err) => {
                        attempt += 1;
                        if attempt > self.retries {
                            return Err(GatewayError::InvalidSchema(err.to_string()));
                        }
                    }
                },
                Ok(Err(err)) => {
                    attempt += 1;
                    if attempt > self.retries {
                        return Err(GatewayError::RetryExhausted(err.to_string()));
                    }
                }
                Err(_) => {
                    attempt += 1;
                    if attempt > self.retries {
                        return Err(GatewayError::Timeout(self.timeout.as_secs()));
                    }
                }
            }

            let backoff_ms = 200_u64.saturating_mul(2_u64.pow(attempt.min(8)));
            tokio::time::sleep(Duration::from_millis(backoff_ms)).await;
        }
    }
}
