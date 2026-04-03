use bevy::input::mouse::{MouseMotion, MouseWheel};
use bevy::prelude::*;

use crate::world::MainCamera;

#[derive(Resource, Default)]
pub struct CameraDragState {
    pub dragging: bool,
}

pub fn camera_pan_zoom(
    buttons: Res<ButtonInput<MouseButton>>,
    mut mouse_motion: EventReader<MouseMotion>,
    mut wheel: EventReader<MouseWheel>,
    mut camera_state: ResMut<CameraDragState>,
    mut query: Query<&mut Transform, With<MainCamera>>,
) {
    camera_state.dragging = buttons.pressed(MouseButton::Middle);

    let mut delta = Vec2::ZERO;
    for event in mouse_motion.read() {
        delta += event.delta;
    }

    if camera_state.dragging && delta.length_squared() > 0.0 {
        for mut transform in &mut query {
            transform.translation.x -= delta.x;
            transform.translation.y += delta.y;
        }
    }

    let mut scroll_y = 0.0_f32;
    for event in wheel.read() {
        scroll_y += event.y;
    }

    if scroll_y.abs() > f32::EPSILON {
        for mut transform in &mut query {
            let scale_delta = (1.0 - scroll_y * 0.08).clamp(0.2, 4.0);
            transform.scale =
                (transform.scale * scale_delta).clamp(Vec3::splat(0.2), Vec3::splat(16.0));
        }
    }
}
