use bevy::prelude::Resource;
use std::env;
use std::path::PathBuf;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RenderFps {
    Fps30,
    Fps60,
    Fps120,
    Unlimited,
}

impl RenderFps {
    pub fn as_f32(self) -> Option<f32> {
        match self {
            Self::Fps30 => Some(30.0),
            Self::Fps60 => Some(60.0),
            Self::Fps120 => Some(120.0),
            Self::Unlimited => None,
        }
    }
}

#[derive(Debug, Clone, Resource)]
pub struct GameConfig {
    pub world_meta_path: PathBuf,
    pub render_fps: RenderFps,
    pub logic_hz: f64,
    pub npc_count: usize,
}

impl Default for GameConfig {
    fn default() -> Self {
        Self {
            world_meta_path: PathBuf::from("data/world/world.json"),
            render_fps: RenderFps::Unlimited,
            logic_hz: 10.0,
            npc_count: 20,
        }
    }
}

impl GameConfig {
    pub fn from_env() -> Self {
        let mut config = Self::default();

        if let Ok(path) = env::var("INK_TOWN_WORLD_META") {
            config.world_meta_path = PathBuf::from(path);
        }

        if let Ok(value) = env::var("INK_TOWN_RENDER_FPS") {
            config.render_fps = match value.trim().to_lowercase().as_str() {
                "30" => RenderFps::Fps30,
                "60" => RenderFps::Fps60,
                "120" => RenderFps::Fps120,
                _ => RenderFps::Unlimited,
            };
        }

        if let Ok(value) = env::var("INK_TOWN_LOGIC_HZ") {
            if let Ok(parsed) = value.parse::<f64>() {
                if parsed > 0.0 {
                    config.logic_hz = parsed;
                }
            }
        }

        if let Ok(value) = env::var("INK_TOWN_NPC_COUNT") {
            if let Ok(parsed) = value.parse::<usize>() {
                config.npc_count = parsed.max(1);
            }
        }

        config
    }
}
