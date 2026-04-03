use crate::config::GameConfig;
use crate::llm_gateway::{LlmGateway, MockProvider, OpenAiCompatibleProvider, PlannerProvider};
use crate::world::WorldState;
use bevy::prelude::*;
use serde_json::Value;
use sim_core::{
    compress_observation, CompressedObservation, EventPreconditions, ObservationCell, PlannedEvent,
    PlannerRequest, PlannerResponse, SimConfig, SimCore,
};
use std::collections::HashMap;
use std::sync::Arc;
use world_core::ChunkCoord;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TimeScale {
    Paused,
    X1,
    X2,
    X4,
}

impl TimeScale {
    pub fn logic_steps(self) -> u32 {
        match self {
            Self::Paused => 0,
            Self::X1 => 1,
            Self::X2 => 2,
            Self::X4 => 4,
        }
    }
}

#[derive(Resource)]
pub struct TimeControl {
    pub scale: TimeScale,
}

#[derive(Resource)]
pub struct SimState {
    pub core: SimCore,
    pub npc_positions: HashMap<String, IVec2>,
    pub npc_actions: HashMap<String, String>,
    pub recent_conflicts: Vec<String>,
    pub render_grid: bool,
}

#[derive(Resource)]
pub struct GatewayState {
    pub runtime: tokio::runtime::Runtime,
    pub gateway: LlmGateway,
}

#[derive(Component)]
pub struct NpcSprite {
    pub npc_id: String,
}

#[derive(Component)]
pub struct NpcLabel {
    pub npc_id: String,
}

pub fn create_gateway() -> anyhow::Result<GatewayState> {
    let provider: Arc<dyn PlannerProvider> =
        if let Some(openai) = OpenAiCompatibleProvider::from_env() {
            Arc::new(openai)
        } else {
            Arc::new(MockProvider)
        };

    let runtime = tokio::runtime::Builder::new_multi_thread()
        .enable_all()
        .build()?;
    let gateway = LlmGateway::new(provider).with_limits(8, std::time::Duration::from_secs(8), 2);

    Ok(GatewayState { runtime, gateway })
}

pub fn create_sim_state(config: &GameConfig) -> SimState {
    let npc_ids = (0..config.npc_count)
        .map(|i| format!("npc-{:02}", i + 1))
        .collect::<Vec<_>>();

    let mut npc_positions = HashMap::new();
    let mut npc_actions = HashMap::new();

    for (idx, npc_id) in npc_ids.iter().enumerate() {
        let x = (idx as i32 % 10) - 5;
        let y = (idx as i32 / 10) - 1;
        npc_positions.insert(npc_id.clone(), IVec2::new(x, y));
        npc_actions.insert(npc_id.clone(), "init".to_string());
    }

    let sim = SimCore::new(
        SimConfig {
            tick_hz: config.logic_hz.round().max(1.0) as u32,
            queue_len_limit: 8,
            queue_replan_threshold: 2,
            planning_window: 5,
            max_npcs: config.npc_count,
        },
        npc_ids,
    );

    SimState {
        core: sim,
        npc_positions,
        npc_actions,
        recent_conflicts: Vec::new(),
        render_grid: true,
    }
}

pub fn spawn_npcs(mut commands: Commands, world_state: Res<WorldState>, sim: Res<SimState>) {
    for npc_id in sim.npc_positions.keys() {
        commands.spawn((
            SpriteBundle {
                sprite: Sprite {
                    color: Color::srgb(0.95, 0.2, 0.2),
                    custom_size: Some(Vec2::splat(world_state.pixel_size * 2.0)),
                    ..default()
                },
                ..default()
            },
            NpcSprite {
                npc_id: npc_id.clone(),
            },
        ));

        commands.spawn((
            Text2dBundle {
                text: Text::from_section(
                    npc_id.clone(),
                    TextStyle {
                        font_size: 12.0,
                        color: Color::BLACK,
                        ..default()
                    },
                ),
                ..default()
            },
            NpcLabel {
                npc_id: npc_id.clone(),
            },
        ));
    }
}

pub fn update_npc_visuals(
    world_state: Res<WorldState>,
    sim: Res<SimState>,
    mut sprite_query: Query<(&NpcSprite, &mut Transform)>,
    mut label_query: Query<(&NpcLabel, &mut Transform, &mut Text), Without<NpcSprite>>,
) {
    for (npc, mut transform) in &mut sprite_query {
        if let Some(pos) = sim.npc_positions.get(&npc.npc_id) {
            transform.translation = Vec3::new(
                pos.x as f32 * world_state.pixel_size,
                pos.y as f32 * world_state.pixel_size,
                5.0,
            );
        }
    }

    for (label, mut transform, mut text) in &mut label_query {
        if let Some(pos) = sim.npc_positions.get(&label.npc_id) {
            transform.translation = Vec3::new(
                pos.x as f32 * world_state.pixel_size,
                pos.y as f32 * world_state.pixel_size + world_state.pixel_size * 2.4,
                6.0,
            );

            let action = sim
                .npc_actions
                .get(&label.npc_id)
                .cloned()
                .unwrap_or_else(|| "idle".to_string());
            text.sections[0].value = format!("{} | {}", label.npc_id, action);
        }
    }
}

pub fn simulation_tick(
    mut sim: ResMut<SimState>,
    world_state: Res<WorldState>,
    time_control: Res<TimeControl>,
    gateway_state: Res<GatewayState>,
) {
    let steps = time_control.scale.logic_steps();
    if steps == 0 {
        return;
    }

    for _ in 0..steps {
        let revisions = HashMap::<String, u64>::new();
        let outcome = sim.core.step_tick(
            |target| revisions.get(target).copied(),
            |_target, _key| -> Option<Value> { None },
        );

        for event in &outcome.executed {
            apply_executed_event(&mut sim, event);
        }

        for conflict in &outcome.conflicts {
            sim.recent_conflicts.push(format!(
                "tick {} | {} | {}",
                conflict.tick, conflict.npc_id, conflict.reason
            ));
        }

        if sim.recent_conflicts.len() > 100 {
            let drain_count = sim.recent_conflicts.len() - 100;
            sim.recent_conflicts.drain(0..drain_count);
        }

        if !outcome.replan_npcs.is_empty() {
            let planned = plan_for_npcs(
                &gateway_state,
                &world_state,
                &sim,
                &outcome.replan_npcs,
                outcome.tick,
            );
            for response in planned {
                if let Err(err) = sim.core.enqueue_plan(response) {
                    sim.recent_conflicts
                        .push(format!("enqueue failed: {}", err));
                }
            }
        }
    }
}

fn plan_for_npcs(
    gateway_state: &GatewayState,
    world_state: &WorldState,
    sim: &SimState,
    npc_ids: &[String],
    current_tick: u64,
) -> Vec<PlannerResponse> {
    let mut plans = Vec::new();
    for npc_id in npc_ids {
        let observation = build_observation(world_state, sim, npc_id);
        let request = PlannerRequest {
            npc_id: npc_id.clone(),
            current_tick,
            planning_window: sim.core.config.planning_window,
            observation,
        };

        let result = gateway_state
            .runtime
            .block_on(gateway_state.gateway.plan_for_npc(request));

        match result {
            Ok(response) => plans.push(response),
            Err(_err) => {
                plans.push(fallback_plan(npc_id, current_tick));
            }
        }
    }
    plans
}

fn build_observation(
    world_state: &WorldState,
    sim: &SimState,
    npc_id: &str,
) -> CompressedObservation {
    let center = sim
        .npc_positions
        .get(npc_id)
        .copied()
        .unwrap_or(IVec2::ZERO);

    let radius = 15_i32;
    let mut cells = Vec::new();

    for y in (center.y - radius)..=(center.y + radius) {
        for x in (center.x - radius)..=(center.x + radius) {
            let signature = lookup_signature(world_state, x, y);
            cells.push(ObservationCell { x, y, signature });
        }
    }

    compress_observation(&cells)
}

fn lookup_signature(world_state: &WorldState, world_x: i32, world_y: i32) -> String {
    let chunk_x = world_x.div_euclid(world_state.chunk_size);
    let chunk_y = world_y.div_euclid(world_state.chunk_size);
    let local_x = world_x.rem_euclid(world_state.chunk_size);
    let local_y = world_y.rem_euclid(world_state.chunk_size);
    let key = format!("{},{}", local_x, local_y);

    if let Some(chunk) = world_state.chunks.get(&ChunkCoord {
        x: chunk_x,
        y: chunk_y,
    }) {
        if let Some(cell) = chunk.cells.get(&key) {
            return format!(
                "{:03}-{:03}-{:03}|{}|{}",
                cell.color[0], cell.color[1], cell.color[2], cell.material, cell.durability
            );
        }
    }

    "000-000-000|void|0".to_string()
}

fn fallback_plan(npc_id: &str, current_tick: u64) -> PlannerResponse {
    PlannerResponse {
        npc_id: npc_id.to_string(),
        plan_id: format!("fallback-{}-{}", npc_id, current_tick),
        events: vec![
            PlannedEvent {
                event_id: format!("{}-fallback-{}", npc_id, current_tick + 1),
                npc_id: npc_id.to_string(),
                plan_id: format!("fallback-{}-{}", npc_id, current_tick),
                seq: 0,
                execute_tick: current_tick + 1,
                action: "idle".to_string(),
                targets: vec![],
                params: Value::Object(serde_json::Map::new()),
                preconditions: EventPreconditions::default(),
                post_effect_hint: Value::Object(serde_json::Map::new()),
            },
            PlannedEvent {
                event_id: format!("{}-fallback-{}", npc_id, current_tick + 2),
                npc_id: npc_id.to_string(),
                plan_id: format!("fallback-{}-{}", npc_id, current_tick),
                seq: 1,
                execute_tick: current_tick + 2,
                action: "scan".to_string(),
                targets: vec![],
                params: Value::Object(serde_json::Map::new()),
                preconditions: EventPreconditions::default(),
                post_effect_hint: Value::Object(serde_json::Map::new()),
            },
        ],
    }
}

fn apply_executed_event(sim: &mut SimState, event: &PlannedEvent) {
    if let Some(pos) = sim.npc_positions.get_mut(&event.npc_id) {
        if event.action == "move" {
            let dx = event
                .params
                .get("dx")
                .and_then(|v| v.as_i64())
                .unwrap_or_default() as i32;
            let dy = event
                .params
                .get("dy")
                .and_then(|v| v.as_i64())
                .unwrap_or_default() as i32;
            *pos += IVec2::new(dx, dy);
        } else if event.action == "wander" {
            pos.x += 1;
        }
    }

    sim.npc_actions
        .insert(event.npc_id.clone(), event.action.clone());
}
