use tauri_build::{Attributes, DefaultPermissionRule, InlinedPlugin};

fn main() {
    tauri_build::try_build(
        Attributes::new().plugin(
            "pty",
            InlinedPlugin::new()
                .commands(&["spawn", "write", "resize", "ack", "kill"])
                .default_permission(DefaultPermissionRule::AllowAllCommands),
        )
        .plugin(
            "browser",
            InlinedPlugin::new()
                .commands(&["open", "set_bounds", "navigate", "action"])
                .default_permission(DefaultPermissionRule::AllowAllCommands),
        ),
    )
    .expect("failed to run tauri-build");
}
