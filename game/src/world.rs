use bevy::prelude::*;
use std::collections::HashMap;
use world_core::{ChunkCoord, ChunkData, WorldCoreError, WorldRuntime};

use crate::config::GameConfig;

#[derive(Resource)]
pub struct WorldState {
    pub runtime: WorldRuntime,
    pub chunk_size: i32,
    pub pixel_size: f32,
    pub big_grid_size: i32,
    pub chunks: HashMap<ChunkCoord, ChunkData>,
    pub needs_rebuild: bool,
}

#[derive(Component)]
pub struct PixelSprite;

#[derive(Component)]
pub struct MainCamera;

pub fn setup_camera(mut commands: Commands) {
    commands.spawn((Camera2dBundle::default(), MainCamera));
}

pub fn load_world_state(config: &GameConfig) -> Result<WorldState, WorldCoreError> {
    let mut runtime = WorldRuntime::new();
    let response = runtime.load_world(&config.world_meta_path)?;

    let mut chunks = HashMap::new();
    for chunk in response.initial_chunks {
        chunks.insert(chunk.coord, chunk);
    }

    Ok(WorldState {
        runtime,
        chunk_size: response.meta.chunk_size as i32,
        pixel_size: response.meta.small_pixel_size.max(1) as f32,
        big_grid_size: response.meta.big_grid_size as i32,
        chunks,
        needs_rebuild: true,
    })
}

pub fn chunk_cells_to_sprites(
    mut world_state: ResMut<WorldState>,
    mut commands: Commands,
    existing_tiles: Query<Entity, With<PixelSprite>>,
) {
    if !world_state.needs_rebuild {
        return;
    }
    world_state.needs_rebuild = false;

    for entity in &existing_tiles {
        commands.entity(entity).despawn();
    }

    for chunk in world_state.chunks.values() {
        for (local_key, cell) in &chunk.cells {
            let Some((local_x, local_y)) = parse_local_key(local_key) else {
                continue;
            };

            let world_x = chunk.coord.x * world_state.chunk_size + local_x;
            let world_y = chunk.coord.y * world_state.chunk_size + local_y;
            let color = Color::srgb_u8(cell.color[0], cell.color[1], cell.color[2]);
            commands.spawn((
                SpriteBundle {
                    sprite: Sprite {
                        color,
                        custom_size: Some(Vec2::splat(world_state.pixel_size)),
                        ..default()
                    },
                    transform: Transform::from_translation(Vec3::new(
                        world_x as f32 * world_state.pixel_size,
                        world_y as f32 * world_state.pixel_size,
                        0.0,
                    )),
                    ..default()
                },
                PixelSprite,
            ));
        }
    }
}

pub fn stream_visible_chunks(
    mut world_state: ResMut<WorldState>,
    camera_query: Query<&Transform, With<MainCamera>>,
) {
    let Ok(camera_tf) = camera_query.get_single() else {
        return;
    };

    let chunk_world_size = world_state.chunk_size as f32 * world_state.pixel_size;
    let center_chunk_x = (camera_tf.translation.x / chunk_world_size).floor() as i32;
    let center_chunk_y = (camera_tf.translation.y / chunk_world_size).floor() as i32;

    let mut to_load = Vec::new();
    for dy in -2..=2 {
        for dx in -2..=2 {
            let coord = ChunkCoord {
                x: center_chunk_x + dx,
                y: center_chunk_y + dy,
            };
            if !world_state.chunks.contains_key(&coord) {
                to_load.push(coord);
            }
        }
    }

    if to_load.is_empty() {
        return;
    }

    if let Ok(chunks) = world_state.runtime.load_chunks(&to_load) {
        for chunk in chunks {
            world_state.chunks.insert(chunk.coord, chunk);
        }
        world_state.needs_rebuild = true;
    }
}

pub fn draw_grid_overlay(world_state: Res<WorldState>, mut gizmos: Gizmos) {
    let chunk_world_size = world_state.chunk_size as f32 * world_state.pixel_size;
    let big_world_size = world_state.big_grid_size as f32 * world_state.pixel_size;

    let range = -40..=40;
    for i in range.clone() {
        let x = i as f32 * world_state.pixel_size;
        gizmos.line_2d(
            Vec2::new(x, -40.0 * chunk_world_size),
            Vec2::new(x, 40.0 * chunk_world_size),
            Color::srgba(0.8, 0.8, 0.8, 0.12),
        );

        let y = i as f32 * world_state.pixel_size;
        gizmos.line_2d(
            Vec2::new(-40.0 * chunk_world_size, y),
            Vec2::new(40.0 * chunk_world_size, y),
            Color::srgba(0.8, 0.8, 0.8, 0.12),
        );
    }

    for i in -20..=20 {
        let x = i as f32 * big_world_size;
        gizmos.line_2d(
            Vec2::new(x, -20.0 * big_world_size),
            Vec2::new(x, 20.0 * big_world_size),
            Color::srgba(0.1, 0.1, 0.1, 0.35),
        );

        let y = i as f32 * big_world_size;
        gizmos.line_2d(
            Vec2::new(-20.0 * big_world_size, y),
            Vec2::new(20.0 * big_world_size, y),
            Color::srgba(0.1, 0.1, 0.1, 0.35),
        );
    }
}

fn parse_local_key(value: &str) -> Option<(i32, i32)> {
    let mut parts = value.split(',');
    let x = parts.next()?.trim().parse::<i32>().ok()?;
    let y = parts.next()?.trim().parse::<i32>().ok()?;
    Some((x, y))
}
