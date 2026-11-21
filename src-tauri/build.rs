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
            "hooks",
            InlinedPlugin::new()
                .commands(&["register", "write_config", "unregister", "ensure_antigravity_hooks"])
                .default_permission(DefaultPermissionRule::AllowAllCommands),
        )
        .plugin(
            "project",
            InlinedPlugin::new()
                .commands(&[
                    "git_status", "git_stamp", "unity_default_log", "is_unity_project",
                    "tail_start", "tail_stop", "read_tasks", "write_tasks", "unity_info", "create_worktree",
                ])
                .default_permission(DefaultPermissionRule::AllowAllCommands),
        )
        .plugin(
            "brain",
            InlinedPlugin::new()
                .commands(&["vault_for_project", "list", "search", "backlinks", "read", "write", "add_agent_pointer", "index_db"])
                .default_permission(DefaultPermissionRule::AllowAllCommands),
        )
        .plugin(
            "github",
            InlinedPlugin::new()
                .commands(&["owners", "repo_list", "repo_view", "my_prs", "local_clones"])
                .default_permission(DefaultPermissionRule::AllowAllCommands),
        )
        .plugin(
            "browser",
            InlinedPlugin::new()
                .commands(&["open", "set_bounds", "navigate", "action", "close_all", "labels"])
                .default_permission(DefaultPermissionRule::AllowAllCommands),
        ),
    )
    .expect("failed to run tauri-build");
}
