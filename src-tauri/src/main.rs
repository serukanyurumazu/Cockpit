// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    // Agent hook commands run `cockpit --hook <provider>`: forward and exit without starting the UI.
    if args.first().map(String::as_str) == Some("--hook") {
        std::process::exit(cockpit_lib::hook_forward(&args[1..]));
    }
    cockpit_lib::run()
}
