# cargUI

A lightweight desktop utility built with Rust and [Slint](https://slint.dev/) that lets you run common `cargo` workflows without touching the terminal. Select a command, tweak the arguments, and watch live output stream into the window.

## Features

- One-click access to key `cargo` commands.
- Optional **release** toggle (ignored automatically when a command does not support `--release`).
- Dedicated fields for extra cargo flags and program arguments (the latter is appended after `--` for `cargo run` / `cargo test`).
- Live log viewer with stderr tagging so you can see build errors as they happen.
- "Custom" mode: supply any other `cargo` subcommand by typing the full command (for example `fmt -- --check`).

## Keybinds

- Enter : Run (same as just clicking Run)
- Ctrl^C : Stop (same as you would in a terminal)
- Shift+click... => Enter : Select multiple commands to execute serially

## Prerequisites

- Rust 1.79 or newer (the project currently targets the 2024 edition).
- `cargo` available on your PATH.
- macOS, Linux, or Windows capable of running Slint's winit backend.

## Running the app

```bash
cargo run
```

The binary launches immediately and blocks the terminal while the window is open. Use the dropdown to pick a command, supply any optional flags, and hit **Run**. Output will populate in the lower panel.

### Tips

- When choosing **Custom**, enter the entire subcommand (for example `bench -- --filter foo`).
- Program arguments are only applied to `run` and `test`. For other commands they are ignored.
- If you toggle **Release** for a command that does not support `--release`, the flag is ignored and the checkbox resets after you start the job.
- Use the **Stop** button to cancel long-running tasks; the status bar will update once the process terminates.

## Development

- Format the code before committing: `cargo fmt`
- Check for compile errors quickly: `cargo check`

The Slint UI is embedded inline in `src/main.rs`. Adjust the command list or extend the UI there.
