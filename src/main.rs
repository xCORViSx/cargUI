use std::cell::RefCell;
use std::collections::VecDeque;
use std::io::{BufRead, BufReader};
use std::process::{Child, Command, ExitStatus, Stdio};
use std::rc::Rc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;

use anyhow::{anyhow, Context, Result};
use shell_words::split;
use slint::{Model, ModelRc, SharedString, VecModel, Weak};

slint::include_modules!();

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum CommandGroup {
    Primary,
    Secondary,
}

#[derive(Debug, Clone)]
struct CommandSpec {
    label: &'static str,
    subcommand: &'static str,
    supports_release: bool,
    allows_program_args: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct SelectedCommand {
    group: CommandGroup,
    index: usize,
}

#[derive(Debug, Clone)]
struct QueuedCommand {
    display_name: String,
    fragments: Vec<String>,
    supports_release: bool,
    allows_program_args: bool,
}

struct CommandRunner {
    state: Arc<RunnerState>,
}

struct RunnerState {
    active: Mutex<Option<ActiveRun>>,
}

struct ActiveRun {
    cancel: Arc<AtomicBool>,
    child: Arc<Mutex<Option<Child>>>,
    _handle: thread::JoinHandle<()>,
}

impl CommandRunner {
    fn new() -> Self {
        Self {
            state: Arc::new(RunnerState {
                active: Mutex::new(None),
            }),
        }
    }

    fn start(
        &self,
        ui: Weak<AppWindow>,
        queue: Vec<QueuedCommand>,
        cargo_args: Vec<String>,
        program_args: Vec<String>,
        release_selected: bool,
    ) -> Result<()> {
        if queue.is_empty() {
            return Err(anyhow!("no commands selected"));
        }

        let mut active_slot = self.state.active.lock().unwrap();
        if active_slot.is_some() {
            return Err(anyhow!("another job is already running"));
        }

        let cancel = Arc::new(AtomicBool::new(false));
        let child_holder = Arc::new(Mutex::new(None));
        let runner_state = self.state.clone();

        let cancel_for_thread = cancel.clone();
        let child_for_thread = child_holder.clone();
        let handle = thread::Builder::new()
            .name("cargo-runner".into())
            .spawn(move || {
                run_queue(
                    ui,
                    queue,
                    cargo_args,
                    program_args,
                    release_selected,
                    cancel_for_thread,
                    child_for_thread,
                );
                let mut slot = runner_state.active.lock().unwrap();
                slot.take();
            })?;

        *active_slot = Some(ActiveRun {
            cancel,
            child: child_holder,
            _handle: handle,
        });

        Ok(())
    }

    fn stop(&self) {
        let (cancel, child_slot) = {
            let guard = self.state.active.lock().unwrap();
            if let Some(active) = guard.as_ref() {
                (Some(active.cancel.clone()), Some(active.child.clone()))
            } else {
                (None, None)
            }
        };

        if let Some(cancel) = cancel {
            cancel.store(true, Ordering::SeqCst);
        }

        if let Some(child_slot) = child_slot {
            if let Ok(mut child) = child_slot.lock() {
                if let Some(child) = child.as_mut() {
                    let _ = child.kill();
                }
            }
        }
    }
}

fn run_queue(
    ui: Weak<AppWindow>,
    queue: Vec<QueuedCommand>,
    cargo_args: Vec<String>,
    program_args: Vec<String>,
    release_selected: bool,
    cancel: Arc<AtomicBool>,
    child_holder: Arc<Mutex<Option<Child>>>,
) {
    let total = queue.len();
    if ui
        .upgrade_in_event_loop(move |app| {
            app.set_running(true);
            app.set_output_text(SharedString::from(""));
            app.set_status_text(format!("Running {total} command(s)…").into());
        })
        .is_err()
    {
        return;
    }

    for (idx, command) in queue.iter().enumerate() {
        if cancel.load(Ordering::SeqCst) {
            break;
        }

        let args = build_full_command(command, release_selected, &cargo_args, &program_args);
        let display = command.display_name.clone();

        if release_selected && !command.supports_release {
            let display_clone = display.clone();
            let _ = ui.upgrade_in_event_loop(move |app| {
                append_line(
                    &app,
                    &format!("ℹ ignoring --release for cargo {display_clone}"),
                );
            });
        }

        {
            let display_clone = display.clone();
            if ui
                .upgrade_in_event_loop(move |app| {
                    app.set_status_text(
                        format!("[{}/{}] cargo {}", idx + 1, total, display_clone).into(),
                    );
                })
                .is_err()
            {
                break;
            }
        }

        match spawn_and_stream(&args, &display, &ui, cancel.clone(), child_holder.clone()) {
            Ok(status) => {
                let display_clone = display.clone();
                let summary = if status.success() {
                    format!("✔ cargo {} completed", display_clone)
                } else {
                    format!("✖ cargo {} exited with status {}", display_clone, status)
                };
                let _ = ui.upgrade_in_event_loop(move |app| append_line(&app, &summary));
                if !status.success() {
                    break;
                }
            }
            Err(err) => {
                let display_clone = display.clone();
                let _ = ui.upgrade_in_event_loop(move |app| {
                    append_line(
                        &app,
                        &format!("⚠ failed to run cargo {}: {err}", display_clone),
                    );
                    app.set_status_text(format!("Failed: {err}").into());
                });
                break;
            }
        }
    }

    let cancelled = cancel.load(Ordering::SeqCst);
    let _ = ui.upgrade_in_event_loop(move |app| {
        app.set_running(false);
        app.set_status_text(if cancelled {
            SharedString::from("Cancelled")
        } else {
            SharedString::from("Idle")
        });
    });
}

fn spawn_and_stream(
    args: &[String],
    display: &str,
    ui: &Weak<AppWindow>,
    cancel: Arc<AtomicBool>,
    child_holder: Arc<Mutex<Option<Child>>>,
) -> Result<ExitStatus> {
    let mut cmd = Command::new("cargo");
    cmd.args(args)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .stdin(Stdio::null());

    let child = cmd
        .spawn()
        .with_context(|| format!("spawning cargo {display}"))?;

    let (stdout, stderr) = {
        let mut slot = child_holder.lock().unwrap();
        *slot = Some(child);
        let stdout = slot
            .as_mut()
            .and_then(|child| child.stdout.take())
            .ok_or_else(|| anyhow!("missing stdout pipe"))?;
        let stderr = slot
            .as_mut()
            .and_then(|child| child.stderr.take())
            .ok_or_else(|| anyhow!("missing stderr pipe"))?;
        (stdout, stderr)
    };

    let ui_out = ui.clone();
    let stdout_cancel = cancel.clone();
    let stdout_handle = thread::spawn(move || {
        let reader = BufReader::new(stdout);
        for line in reader.lines() {
            if stdout_cancel.load(Ordering::SeqCst) {
                break;
            }
            if let Ok(line) = line {
                let _ = ui_out.upgrade_in_event_loop(move |app| append_line(&app, &line));
            } else {
                break;
            }
        }
    });

    let ui_err = ui.clone();
    let stderr_cancel = cancel.clone();
    let stderr_handle = thread::spawn(move || {
        let reader = BufReader::new(stderr);
        for line in reader.lines() {
            if stderr_cancel.load(Ordering::SeqCst) {
                break;
            }
            if let Ok(line) = line {
                let _ = ui_err.upgrade_in_event_loop(move |app| {
                    append_line(&app, &format!("[stderr] {}", line));
                });
            } else {
                break;
            }
        }
    });

    let status = {
        let mut slot = child_holder.lock().unwrap();
        let mut child = slot
            .take()
            .ok_or_else(|| anyhow!("child process missing"))?;
        drop(slot);
        child.wait()?
    };

    stdout_handle.join().ok();
    stderr_handle.join().ok();

    Ok(status)
}

fn append_line(app: &AppWindow, line: &str) {
    let mut current = app.get_output_text().to_string();
    if !current.is_empty() {
        current.push('\n');
    }
    current.push_str(line);
    app.set_output_text(SharedString::from(current));
}

fn build_full_command(
    command: &QueuedCommand,
    release_selected: bool,
    cargo_args: &[String],
    program_args: &[String],
) -> Vec<String> {
    let mut args = command.fragments.clone();

    if release_selected && command.supports_release {
        args.push("--release".into());
    }

    args.extend(cargo_args.iter().cloned());

    if command.allows_program_args && !program_args.is_empty() {
        args.push("--".into());
        args.extend(program_args.iter().cloned());
    }

    args
}

struct AppController {
    ui: Weak<AppWindow>,
    primary_specs: Vec<CommandSpec>,
    secondary_specs: Vec<CommandSpec>,
    primary_model: Rc<VecModel<CommandEntry>>,
    secondary_model: Rc<VecModel<CommandEntry>>,
    selection: VecDeque<SelectedCommand>,
    runner: CommandRunner,
}

impl AppController {
    fn new(ui: &AppWindow) -> Rc<RefCell<Self>> {
        let primary_specs = vec![
            CommandSpec {
                label: "Build",
                subcommand: "build",
                supports_release: true,
                allows_program_args: false,
            },
            CommandSpec {
                label: "Run",
                subcommand: "run",
                supports_release: true,
                allows_program_args: true,
            },
        ];

        let secondary_specs = vec![
            CommandSpec {
                label: "Check",
                subcommand: "check",
                supports_release: true,
                allows_program_args: false,
            },
            CommandSpec {
                label: "Test",
                subcommand: "test",
                supports_release: true,
                allows_program_args: true,
            },
            CommandSpec {
                label: "Fmt",
                subcommand: "fmt",
                supports_release: false,
                allows_program_args: false,
            },
            CommandSpec {
                label: "Clean",
                subcommand: "clean",
                supports_release: false,
                allows_program_args: false,
            },
            CommandSpec {
                label: "Doc",
                subcommand: "doc",
                supports_release: true,
                allows_program_args: false,
            },
            CommandSpec {
                label: "Clippy",
                subcommand: "clippy",
                supports_release: true,
                allows_program_args: false,
            },
            CommandSpec {
                label: "Update",
                subcommand: "update",
                supports_release: false,
                allows_program_args: false,
            },
        ];

        let primary_model = Rc::new(VecModel::from(
            primary_specs
                .iter()
                .map(|spec| CommandEntry {
                    label: spec.label.into(),
                    selected: false,
                    compact: false,
                })
                .collect::<Vec<_>>(),
        ));

        let secondary_model = Rc::new(VecModel::from(
            secondary_specs
                .iter()
                .map(|spec| CommandEntry {
                    label: spec.label.into(),
                    selected: false,
                    compact: true,
                })
                .collect::<Vec<_>>(),
        ));

        ui.set_primary_commands(ModelRc::from(primary_model.clone()));
        ui.set_secondary_commands(ModelRc::from(secondary_model.clone()));
        ui.set_status_text(SharedString::from("Idle"));
        ui.set_release_enabled(true);
        ui.set_running(false);

        Rc::new(RefCell::new(Self {
            ui: ui.as_weak(),
            primary_specs,
            secondary_specs,
            primary_model,
            secondary_model,
            selection: VecDeque::new(),
            runner: CommandRunner::new(),
        }))
    }

    fn toggle_command(&mut self, group: CommandGroup, index: usize, extend: bool) {
        if !extend {
            self.selection.clear();
        }

        let candidate = SelectedCommand { group, index };
        if let Some(pos) = self.selection.iter().position(|sel| *sel == candidate) {
            self.selection.remove(pos);
        } else {
            self.selection.push_back(candidate);
        }

        if self.selection.is_empty() && !extend {
            self.selection.push_back(candidate);
        }

        self.update_selection_visuals();
        self.refresh_release_state();
    }

    fn update_selection_visuals(&mut self) {
        for row in 0..self.primary_model.row_count() {
            if let Some(mut entry) = self.primary_model.row_data(row) {
                let selected = self
                    .selection
                    .iter()
                    .any(|sel| sel.group == CommandGroup::Primary && sel.index == row as usize);
                if entry.selected != selected {
                    entry.selected = selected;
                    self.primary_model.set_row_data(row, entry);
                }
            }
        }

        for row in 0..self.secondary_model.row_count() {
            if let Some(mut entry) = self.secondary_model.row_data(row) {
                let selected = self
                    .selection
                    .iter()
                    .any(|sel| sel.group == CommandGroup::Secondary && sel.index == row as usize);
                if entry.selected != selected {
                    entry.selected = selected;
                    self.secondary_model.set_row_data(row, entry);
                }
            }
        }
    }

    fn refresh_release_state(&self) {
        let mut allowed = true;
        for sel in &self.selection {
            if let Some(spec) = self.spec_for(sel) {
                if !spec.supports_release {
                    allowed = false;
                    break;
                }
            }
        }

        if let Some(ui) = self.ui.upgrade() {
            if !allowed {
                ui.set_release_selected(false);
            }
            ui.set_release_enabled(allowed);
        }
    }

    fn spec_for(&self, sel: &SelectedCommand) -> Option<&CommandSpec> {
        match sel.group {
            CommandGroup::Primary => self.primary_specs.get(sel.index),
            CommandGroup::Secondary => self.secondary_specs.get(sel.index),
        }
    }

    fn run_selection(&self) {
        let ui = match self.ui.upgrade() {
            Some(ui) => ui,
            None => return,
        };

        let cargo_args = match parse_args(ui.get_cargo_args_text()) {
            Ok(args) => args,
            Err(err) => {
                let _ = ui.as_weak().upgrade_in_event_loop(move |app| {
                    append_line(&app, &format!("⚠ invalid cargo args: {err}"));
                    app.set_status_text(SharedString::from("Failed: invalid cargo args"));
                });
                return;
            }
        };

        let program_args = match parse_args(ui.get_program_args_text()) {
            Ok(args) => args,
            Err(err) => {
                let _ = ui.as_weak().upgrade_in_event_loop(move |app| {
                    append_line(&app, &format!("⚠ invalid program args: {err}"));
                    app.set_status_text(SharedString::from("Failed: invalid program args"));
                });
                return;
            }
        };

        let mut queue = Vec::new();
        let has_selection = !self.selection.is_empty();

        if !has_selection {
            let custom_text = ui.get_custom_command_text().to_string();
            if !custom_text.trim().is_empty() {
                let parts = match split(&custom_text) {
                    Ok(parts) => parts,
                    Err(err) => {
                        let _ = ui.as_weak().upgrade_in_event_loop(move |app| {
                            append_line(&app, &format!("⚠ invalid custom command: {err}"));
                            app.set_status_text(SharedString::from(
                                "Failed: invalid custom command",
                            ));
                        });
                        return;
                    }
                };

                let fragments = if parts.first().map(|s| s == "cargo").unwrap_or(false) {
                    parts[1..].to_vec()
                } else {
                    parts
                };

                if fragments.is_empty() {
                    let _ = ui.as_weak().upgrade_in_event_loop(move |app| {
                        append_line(&app, "⚠ custom command needs a subcommand");
                        app.set_status_text(SharedString::from("Custom command incomplete"));
                    });
                    return;
                }

                queue.push(QueuedCommand {
                    display_name: fragments.join(" "),
                    fragments,
                    supports_release: false,
                    allows_program_args: true,
                });
            }
        }

        for sel in &self.selection {
            if let Some(spec) = self.spec_for(sel) {
                queue.push(QueuedCommand {
                    display_name: spec.subcommand.into(),
                    fragments: vec![spec.subcommand.into()],
                    supports_release: spec.supports_release,
                    allows_program_args: spec.allows_program_args,
                });
            }
        }

        if queue.is_empty() {
            if let Some(run_spec) = self
                .primary_specs
                .iter()
                .find(|spec| spec.subcommand == "run")
            {
                queue.push(QueuedCommand {
                    display_name: run_spec.subcommand.into(),
                    fragments: vec![run_spec.subcommand.into()],
                    supports_release: run_spec.supports_release,
                    allows_program_args: run_spec.allows_program_args,
                });
            } else {
                let _ = ui.as_weak().upgrade_in_event_loop(move |app| {
                    app.set_status_text(SharedString::from("Select a command first"));
                });
                return;
            }
        }

        let release_selected = ui.get_release_selected();
        if let Err(err) = self.runner.start(
            ui.as_weak(),
            queue,
            cargo_args,
            program_args,
            release_selected,
        ) {
            let _ = ui.as_weak().upgrade_in_event_loop(move |app| {
                append_line(&app, &format!("⚠ {err}"));
                app.set_status_text(format!("Failed: {err}").into());
            });
        }
    }

    fn stop(&self) {
        self.runner.stop();
    }
}

fn parse_args(text: SharedString) -> Result<Vec<String>> {
    let text = text.to_string();
    if text.trim().is_empty() {
        Ok(vec![])
    } else {
        split(&text).context("parsing arguments")
    }
}

fn main() -> Result<()> {
    let ui = AppWindow::new()?;
    let controller = AppController::new(&ui);

    {
        let controller = controller.clone();
        ui.on_primary_command_clicked(move |index, extend| {
            controller
                .borrow_mut()
                .toggle_command(CommandGroup::Primary, index as usize, extend);
        });
    }

    {
        let controller = controller.clone();
        ui.on_secondary_command_clicked(move |index, extend| {
            controller
                .borrow_mut()
                .toggle_command(CommandGroup::Secondary, index as usize, extend);
        });
    }

    {
        let controller = controller.clone();
        ui.on_run_requested(move || {
            controller.borrow().run_selection();
        });
    }

    {
        let controller = controller.clone();
        ui.on_stop_requested(move || {
            controller.borrow().stop();
        });
    }

    ui.on_workspace_select_requested(|| {
        if let Some(folder) = rfd::FileDialog::new().pick_folder() {
            // TODO: Store and use the selected workspace folder
            println!("Selected workspace: {}", folder.display());
        }
    });

    ui.on_settings_requested(|| {
        // Placeholder for future preferences dialog.
    });

    ui.run()?;
    Ok(())
}
