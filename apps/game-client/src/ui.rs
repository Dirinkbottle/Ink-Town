use bevy::prelude::*;
use bevy_egui::{egui, EguiContexts};

use crate::config::GameConfig;
use crate::sim_runtime::{SimState, TimeControl, TimeScale};

pub fn observer_ui(
    mut contexts: EguiContexts,
    config: Res<GameConfig>,
    mut sim: ResMut<SimState>,
    mut time: ResMut<TimeControl>,
) {
    egui::TopBottomPanel::top("top_bar").show(contexts.ctx_mut(), |ui| {
        ui.horizontal_wrapped(|ui| {
            ui.strong("Ink Town Game Observer V1");
            ui.separator();
            ui.label(format!("World: {}", config.world_meta_path.display()));
            ui.separator();
            ui.label(format!("Tick: {}", sim.core.current_tick()));
            ui.label(format!("Revision: {}", sim.core.world_revision()));
        });
    });

    egui::SidePanel::left("left_panel")
        .min_width(260.0)
        .show(contexts.ctx_mut(), |ui| {
            ui.heading("Time");
            ui.horizontal(|ui| {
                if ui
                    .selectable_label(time.scale == TimeScale::Paused, "Pause")
                    .clicked()
                {
                    time.scale = TimeScale::Paused;
                }
                if ui
                    .selectable_label(time.scale == TimeScale::X1, "1x")
                    .clicked()
                {
                    time.scale = TimeScale::X1;
                }
                if ui
                    .selectable_label(time.scale == TimeScale::X2, "2x")
                    .clicked()
                {
                    time.scale = TimeScale::X2;
                }
                if ui
                    .selectable_label(time.scale == TimeScale::X4, "4x")
                    .clicked()
                {
                    time.scale = TimeScale::X4;
                }
            });

            ui.separator();
            ui.heading("View");
            ui.checkbox(&mut sim.render_grid, "Show Grid");

            ui.separator();
            ui.heading("Queues");
            let mut queue_rows = sim
                .core
                .queue_snapshot()
                .into_iter()
                .collect::<Vec<(String, Vec<_>)>>();
            queue_rows.sort_by(|a, b| a.0.cmp(&b.0));

            egui::ScrollArea::vertical()
                .max_height(220.0)
                .show(ui, |ui| {
                    for (npc_id, events) in queue_rows {
                        let details = events
                            .iter()
                            .map(|item| {
                                format!("{}@{}", item.event.action, item.event.execute_tick)
                            })
                            .collect::<Vec<_>>()
                            .join(", ");
                        ui.label(format!("{} [{}] {}", npc_id, events.len(), details));
                    }
                });

            ui.separator();
            ui.heading("Conflicts");
            egui::ScrollArea::vertical()
                .max_height(220.0)
                .show(ui, |ui| {
                    for line in sim.recent_conflicts.iter().rev().take(20) {
                        ui.label(line);
                    }
                });
        });

    egui::Window::new("NPC Overlay")
        .anchor(egui::Align2::RIGHT_TOP, egui::vec2(-16.0, 48.0))
        .resizable(true)
        .show(contexts.ctx_mut(), |ui| {
            let mut rows = sim
                .npc_positions
                .iter()
                .map(|(npc_id, pos)| {
                    let action = sim
                        .npc_actions
                        .get(npc_id)
                        .cloned()
                        .unwrap_or_else(|| "idle".to_string());
                    (npc_id.clone(), *pos, action)
                })
                .collect::<Vec<_>>();
            rows.sort_by(|a, b| a.0.cmp(&b.0));

            egui::ScrollArea::vertical()
                .max_height(360.0)
                .show(ui, |ui| {
                    for (npc_id, pos, action) in rows {
                        ui.label(format!("{} @ ({}, {}) -> {}", npc_id, pos.x, pos.y, action));
                    }
                });
        });
}
