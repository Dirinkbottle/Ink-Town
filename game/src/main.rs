mod camera;
mod config;
mod llm_gateway;
mod sim_runtime;
mod ui;
mod world;

use bevy::prelude::*;
use bevy_egui::EguiPlugin;
use camera::{camera_pan_zoom, CameraDragState};
use config::{GameConfig, RenderFps};
use sim_runtime::{
    create_gateway, create_sim_state, simulation_tick, spawn_npcs, update_npc_visuals, SimState,
    TimeControl, TimeScale,
};
use std::time::{Duration, Instant};
use ui::observer_ui;
use world::{
    chunk_cells_to_sprites, draw_grid_overlay, load_world_state, setup_camera,
    stream_visible_chunks, WorldState,
};

#[derive(Resource)]
struct RenderLimiter {
    target_frame: Option<Duration>,
    last_frame: Instant,
}

fn main() {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "ink_town_game=info".into()),
        )
        .init();

    let config = GameConfig::from_env();
    let world_state = load_world_state(&config).unwrap_or_else(|err| {
        panic!(
            "failed to load world '{}': {err}",
            config.world_meta_path.display()
        )
    });
    let sim_state = create_sim_state(&config);
    let gateway_state = create_gateway().expect("failed to initialize llm gateway");

    let mut app = App::new();
    app.insert_resource(config.clone())
        .insert_resource(world_state)
        .insert_resource(sim_state)
        .insert_resource(gateway_state)
        .insert_resource(TimeControl {
            scale: TimeScale::X1,
        })
        .insert_resource(CameraDragState::default())
        .insert_resource(RenderLimiter {
            target_frame: config
                .render_fps
                .as_f32()
                .map(|fps| Duration::from_secs_f32(1.0 / fps)),
            last_frame: Instant::now(),
        })
        .insert_resource(Time::<Fixed>::from_hz(config.logic_hz))
        .add_plugins(DefaultPlugins.set(WindowPlugin {
            primary_window: Some(Window {
                title: "Ink Town Game".to_string(),
                present_mode: bevy::window::PresentMode::AutoNoVsync,
                ..default()
            }),
            ..default()
        }))
        .add_plugins(EguiPlugin)
        .add_systems(
            Startup,
            (setup_camera, chunk_cells_to_sprites, spawn_npcs).chain(),
        )
        .add_systems(
            Update,
            (
                limit_render_fps,
                camera_pan_zoom,
                stream_visible_chunks,
                chunk_cells_to_sprites,
                update_npc_visuals,
                observer_ui,
                conditional_grid_render,
            ),
        )
        .add_systems(FixedUpdate, simulation_tick);

    app.run();
}

fn limit_render_fps(config: Res<GameConfig>, mut limiter: ResMut<RenderLimiter>) {
    if matches!(config.render_fps, RenderFps::Unlimited) {
        limiter.last_frame = Instant::now();
        return;
    }

    let Some(target) = limiter.target_frame else {
        limiter.last_frame = Instant::now();
        return;
    };

    let elapsed = limiter.last_frame.elapsed();
    if elapsed < target {
        std::thread::sleep(target - elapsed);
    }
    limiter.last_frame = Instant::now();
}

fn conditional_grid_render(sim: Res<SimState>, world_state: Res<WorldState>, gizmos: Gizmos) {
    if sim.render_grid {
        draw_grid_overlay(world_state, gizmos);
    }
}
