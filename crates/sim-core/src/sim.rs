use crate::error::SimError;
use crate::types::{
    ConflictReport, EventQueueItem, PlannedEvent, PlannerResponse, SimConfig, TickOutcome,
    WorldRevision,
};
use serde_json::Value;
use std::collections::{HashMap, HashSet, VecDeque};

#[derive(Debug, Default)]
pub struct ReplanQueue {
    pending: HashSet<String>,
}

impl ReplanQueue {
    pub fn push(&mut self, npc_id: impl Into<String>) {
        self.pending.insert(npc_id.into());
    }

    pub fn push_many<I>(&mut self, npc_ids: I)
    where
        I: IntoIterator<Item = String>,
    {
        for npc_id in npc_ids {
            self.pending.insert(npc_id);
        }
    }

    pub fn drain(&mut self) -> Vec<String> {
        let mut values: Vec<String> = self.pending.drain().collect();
        values.sort();
        values
    }
}

pub struct SimCore {
    pub config: SimConfig,
    current_tick: u64,
    world_revision: WorldRevision,
    npc_queues: HashMap<String, VecDeque<EventQueueItem>>,
    recent_conflicts: VecDeque<ConflictReport>,
    replan_queue: ReplanQueue,
}

impl SimCore {
    pub fn new(config: SimConfig, npc_ids: impl IntoIterator<Item = String>) -> Self {
        let mut npc_queues = HashMap::new();
        for npc_id in npc_ids {
            npc_queues.insert(npc_id, VecDeque::new());
        }

        Self {
            config,
            current_tick: 0,
            world_revision: 0,
            npc_queues,
            recent_conflicts: VecDeque::new(),
            replan_queue: ReplanQueue::default(),
        }
    }

    pub fn current_tick(&self) -> u64 {
        self.current_tick
    }

    pub fn world_revision(&self) -> WorldRevision {
        self.world_revision
    }

    pub fn queue_snapshot(&self) -> HashMap<String, Vec<EventQueueItem>> {
        self.npc_queues
            .iter()
            .map(|(npc_id, queue)| (npc_id.clone(), queue.iter().cloned().collect()))
            .collect()
    }

    pub fn recent_conflicts(&self, max_count: usize) -> Vec<ConflictReport> {
        self.recent_conflicts
            .iter()
            .rev()
            .take(max_count)
            .cloned()
            .collect()
    }

    pub fn enqueue_plan(&mut self, response: PlannerResponse) -> Result<(), SimError> {
        let queue = self.npc_queues.entry(response.npc_id.clone()).or_default();

        let mut events = response.events;
        events.sort_by_key(|event| event.seq);
        for event in events {
            if queue.len() >= self.config.queue_len_limit {
                return Err(SimError::QueueOverflow(response.npc_id.clone()));
            }
            queue.push_back(EventQueueItem {
                npc_id: response.npc_id.clone(),
                event,
                queued_at_tick: self.current_tick,
            });
        }

        Ok(())
    }

    pub fn step_tick<F, G>(&mut self, mut revision_lookup: F, mut state_lookup: G) -> TickOutcome
    where
        F: FnMut(&str) -> Option<WorldRevision>,
        G: FnMut(&str, &str) -> Option<Value>,
    {
        self.current_tick += 1;

        let mut executed: Vec<PlannedEvent> = Vec::new();
        let mut conflicts: Vec<ConflictReport> = Vec::new();

        let npc_ids: Vec<String> = self.npc_queues.keys().cloned().collect();
        for npc_id in npc_ids {
            let Some(queue) = self.npc_queues.get_mut(&npc_id) else {
                continue;
            };

            let Some(next) = queue.front().cloned() else {
                self.replan_queue.push(npc_id.clone());
                continue;
            };
            if next.event.execute_tick > self.current_tick {
                continue;
            }

            if let Some(conflict) = Self::detect_conflicts(
                self.current_tick,
                &next.event,
                &mut revision_lookup,
                &mut state_lookup,
            ) {
                let dropped_events =
                    Self::truncate_queue_from_conflict(queue, &next.event.event_id);
                let related = Self::related_npcs(&next.event);

                let report = ConflictReport {
                    tick: self.current_tick,
                    npc_id: next.event.npc_id.clone(),
                    plan_id: next.event.plan_id.clone(),
                    event_id: next.event.event_id.clone(),
                    reason: conflict,
                    related_npcs: related.clone(),
                    dropped_events,
                };

                self.record_conflict(report.clone());
                self.replan_queue.push(npc_id.clone());
                self.replan_queue.push_many(related.clone());
                conflicts.push(report);
                continue;
            }

            queue.pop_front();
            executed.push(next.event);
            self.world_revision += 1;

            if queue.len() < self.config.queue_replan_threshold {
                self.replan_queue.push(npc_id.clone());
            }
        }

        TickOutcome {
            tick: self.current_tick,
            executed,
            conflicts,
            replan_npcs: self.replan_queue.drain(),
        }
    }

    pub fn detect_conflicts<F, G>(
        tick: u64,
        event: &PlannedEvent,
        revision_lookup: &mut F,
        state_lookup: &mut G,
    ) -> Option<String>
    where
        F: FnMut(&str) -> Option<WorldRevision>,
        G: FnMut(&str, &str) -> Option<Value>,
    {
        for (target, expected_revision) in &event.preconditions.expected_revisions {
            match revision_lookup(target) {
                Some(actual) if actual == *expected_revision => {}
                Some(actual) => {
                    return Some(format!(
                        "target '{}' revision mismatch at tick {}: expected {}, actual {}",
                        target, tick, expected_revision, actual
                    ));
                }
                None => {
                    return Some(format!(
                        "target '{}' revision missing at tick {}",
                        target, tick
                    ));
                }
            }
        }

        for condition in &event.preconditions.state_conditions {
            let actual = state_lookup(&condition.target, &condition.key);
            if actual.as_ref() != Some(&condition.expected) {
                return Some(format!(
                    "target '{}' state '{}' mismatch at tick {}",
                    condition.target, condition.key, tick
                ));
            }
        }

        None
    }

    pub fn replan(&mut self, npc_ids: &[String]) {
        for npc in npc_ids {
            self.replan_queue.push(npc.clone());
        }
    }

    fn record_conflict(&mut self, report: ConflictReport) {
        self.recent_conflicts.push_back(report);
        while self.recent_conflicts.len() > 200 {
            self.recent_conflicts.pop_front();
        }
    }

    fn truncate_queue_from_conflict(
        queue: &mut VecDeque<EventQueueItem>,
        event_id: &str,
    ) -> Vec<String> {
        let conflict_idx = queue
            .iter()
            .position(|item| item.event.event_id == event_id)
            .unwrap_or(0);

        let mut dropped = Vec::new();
        while queue.len() > conflict_idx {
            if let Some(item) = queue.pop_back() {
                dropped.push(item.event.event_id);
            }
        }
        dropped.reverse();
        dropped
    }

    fn related_npcs(event: &PlannedEvent) -> Vec<String> {
        let mut related = HashSet::new();
        for target in &event.targets {
            if let Some(npc_id) = target.strip_prefix("npc:") {
                if npc_id != event.npc_id {
                    related.insert(npc_id.to_string());
                }
            }
        }

        for key in event.preconditions.expected_revisions.keys() {
            if let Some(npc_id) = key.strip_prefix("npc:") {
                if npc_id != event.npc_id {
                    related.insert(npc_id.to_string());
                }
            }
        }

        let mut list: Vec<String> = related.into_iter().collect();
        list.sort();
        list
    }
}
