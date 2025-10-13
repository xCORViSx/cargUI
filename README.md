# cargUI - Visual Cargo Interface for VS Code

A comprehensive VS Code extension that provides a graphical interface for all Cargo commands. Build, test, and manage Rust projects without typing terminal commands.

![Version](https://img.shields.io/badge/version-0.2.0-blue)
![VS Code](https://img.shields.io/badge/VS%20Code-1.85.0+-green)
![Rust](https://img.shields.io/badge/Rust-2021+-orange)

## ✨ Features at a Glance

### Core Functionality
- **📦 Targets** - Checkbox selection for binaries, examples, tests, benchmarks
- **⚙️ Features** - Toggle Cargo features with checkboxes  
- **🔧 Build Modes** - Switch between Debug/Release builds
- **📸 Snapshots** - Save/restore entire configurations (auto-created on first load)
- **⚡ Watch Mode** - Auto-recompile on file changes (powered by cargo-watch)
- **📁 Workspaces** - Full multi-crate workspace support with context switching

### Why cargUI?
- **No more typing** - Click instead of remembering command flags
- **Visual state** - See what's enabled at a glance
- **Quick switching** - Snapshots for different dev scenarios
- **Workspace-aware** - Handles complex multi-crate projects elegantly
- **Persistent** - Remembers your last state across VS Code restarts

## 🚀 Quick Start

1. Open any Rust project with `Cargo.toml`
2. Find **Cargo** tree view in Explorer sidebar
3. Check a target → Click **Build/Run/Test**
4. Done! Terminal opens with cargo command

**Example:** Check "main" target + "serde" feature → Click Run
```bash
→ cargo run --bin main --features serde
```

## 📖 Complete Feature Guide

### 1. Targets System

**What it does:** Automatically discovers all buildable targets in your project

**Tree view shows:**
- `src/main.rs` → Binary target
- `src/bin/*.rs` → Additional binaries
- `examples/*.rs` → Example programs
- `tests/*.rs` → Integration tests  
- `benches/*.rs` → Benchmarks

**Usage:**
- **Check targets** you want to build
- Click **Build/Run/Test** buttons
- Multiple targets build sequentially
- **Toggle All** button checks/unchecks everything

**Commands:**
- Build: `cargo build --bin target1 --bin target2`
- Run: `cargo run --bin target`
- Test: `cargo test --test integration_test`

### 2. Features Management

**What it does:** Parses `[features]` from Cargo.toml and lets you enable them

**Example Cargo.toml:**
```toml
[features]
default = ["json"]
json = ["serde_json"]
async = ["tokio"]
```

**Usage:**
- **Check features** to enable
- Combine multiple features
- **Toggle All** for quick selection
- Features apply to all cargo commands

**Commands:**
```bash
cargo build --features json,async
cargo test --features json
cargo run --features async
```

### 3. Build Modes (Debug/Release)

**What it does:** Toggle between debug and optimized builds

**Click "Mode: Debug"** to switch to:
- `Mode: Release` → Adds `--release` flag to all commands
- Affects: build, run, test, bench, doc

**Note:** Build mode resets to Debug on VS Code restart (use snapshots to preserve release configurations)

### 4. Snapshots (Build Configurations)

**What it does:** Save complete UI state as named configuration

**A snapshot stores:**
- Build mode (debug/release)
- Checked targets
- Checked features
- Checked arguments
- Checked environment variables
- Workspace context (selected member + checked members)

**Default snapshots** (auto-created on first load):
- Projects with `src/main.rs` → "main" snapshot
- Library projects → "lib" snapshot
- Workspace projects → One snapshot per member

**Workflow:**
1. Configure UI (check targets, features, etc.)
2. Click **[+]** in SNAPSHOTS category
3. Enter name: "production" / "dev" / "testing"
4. Snapshot saved

**Applying snapshots:**
- **Click snapshot** → Restores entire state
- **Click again** → Deactivates (returns to default)
- Active snapshot shown in bold

**Editing snapshots:**
- Right-click → **Edit**
- Two options:
  - Rename and keep saved state
  - Rename and update with current UI state

**Use cases:**
```
"dev" → debug mode, all features, verbose logging
"production" → release mode, minimal features, optimized
"testing" → debug mode, test targets only, test fixtures enabled
"frontend-dev" → workspace: ui + api packages, dev features
```

### 5. Arguments System

**What it does:** Reusable argument templates passed to your program (after `--`)

**Default arguments:**
- `--verbose`
- `--quiet`
- `--color always`
- `--jobs 4`

**Usage:**
1. Click **[+]** to add new argument
2. Enter: `--port 8080` or `--debug` or `--config ./dev.toml`
3. **Check arguments** you want active
4. Arguments append to cargo run/test commands

**Command example:**
```bash
# Checked: --verbose, --port 8080
cargo run --bin server -- --verbose --port 8080
```

**CRUD Operations:**
- **Add** - Click [+] button
- **Edit** - Right-click → Edit (renames argument)
- **Remove** - Right-click → Remove (with confirmation)
- **Reset** - Right-click category → Reset to defaults

### 6. Environment Variables

**What it does:** Set environment variables for cargo commands

**Default variables:**
- `RUST_BACKTRACE=1`
- `RUST_LOG=info`
- `CARGO_INCREMENTAL=1`

**Usage:**
1. Click **[+]** to add variable
2. Enter in `KEY=VALUE` format: `DATABASE_URL=postgres://localhost`
3. **Check variables** you want active
4. Variables prepend to cargo commands

**Command example:**
```bash
# Checked: RUST_BACKTRACE=1, RUST_LOG=debug
RUST_BACKTRACE=1 RUST_LOG=debug cargo run
```

**Common use cases:**
- Logging configuration (`RUST_LOG=debug`)
- Build optimization (`CARGO_PROFILE_RELEASE_LTO=true`)
- Test environment (`TEST_MODE=integration`)
- API keys for integration tests

### 7. Watch Mode

**What it does:** Auto-recompile when files change (requires `cargo-watch`)

**Watch actions:**
- **check** - Fast compilation check (recommended for development)
- **build** - Full build on every change
- **run** - Run binary on every change (for servers)
- **test** - Run tests on every change
- **clippy** - Lint on every change

**Usage:**
1. Click **"Watch: Inactive"**
2. Select action (e.g., "check")
3. Watch starts in terminal
4. Edit any `.rs` file
5. Auto-runs: `cargo watch -x check`

**Features:**
- Respects checked features
- Respects release mode
- Respects environment variables
- Shows in dedicated terminal

**Stop watch:**
- Click **"Watch: Active"** 
- Or close the watch terminal

**First-time setup:**
- Extension detects if `cargo-watch` missing
- Shows install prompt
- Runs: `cargo install cargo-watch`

### 8. Cargo Workspaces (Multi-Crate Projects)

**What it does:** Full support for workspace projects with multiple crates

**Workspace detection:** Automatically finds workspace members from:
```toml
[workspace]
members = ["cli", "api", "core", "utils"]
```

**Two selection modes:**

**A) Label Click (Context Selection):**
- Click package name → Selects as active context
- Tree view updates to show that package's targets/features
- Use this when focusing on one package

**B) Checkbox Click (Build Selection):**
- Check package checkbox → Include in build
- Check multiple → Multi-package builds
- Use this for building combinations

**Special "All Members" option:**
- Click label → Runs `cargo build --workspace` (builds everything)
- Check box → Same as checking all individual members

**Command examples:**
```bash
# Context: core, Checked: core only
cargo build --package core --bin core-app

# Context: api, Checked: api + core
cargo build --package api --package core

# Context: All Members (any checks ignored)
cargo build --workspace
```

**Workspace Snapshots:**
Snapshots remember workspace state:
```json
{
  "name": "backend-dev",
  "workspaceMember": "api",           // ← Selected context
  "checkedWorkspaceMembers": ["api", "core"],  // ← Build these
  "features": ["database"],
  "mode": "debug"
}
```

**Applying snapshot:**
1. Selects "api" (shows api's targets/features)
2. Checks "api" + "core" boxes
3. Enables "database" feature
4. Next build: `cargo build --package api --package core --features database`

**Workspace UI:**
- Category hidden for single-crate projects (auto-detects)
- Snapshot count shows only context-relevant snapshots
- Filtering prevents snapshot confusion

### 9. Custom Commands

**What it does:** Save frequently-used cargo commands for one-click execution

**Default commands:**
- Clippy Lint: `cargo clippy`
- Search Crates: `cargo search serde`
- Add Dependency: `cargo add tokio`
- Tree Dependencies: `cargo tree`
- Update: `cargo update`
- Bench: `cargo bench`

**Usage:**
1. Click **[+]** in Custom Commands
2. Enter name: "Update All"
3. Enter command: `cargo update`
4. Click command to execute in terminal

**Advanced examples:**
```bash
# Cross-compilation
cargo build --target x86_64-unknown-linux-gnu --release

# Specific test with nocapture
cargo test my_test -- --nocapture

# Documentation with private items
cargo doc --no-deps --document-private-items --open

# Show outdated dependencies (requires cargo-outdated)
cargo outdated

# Security audit (requires cargo-audit)
cargo audit
```

### 10. Standard Cargo Commands

**Always available via buttons:**
- **Build** - `cargo build [targets] [features]`
- **Run** - `cargo run [target] [features] [-- args]`
- **Test** - `cargo test [targets] [features]`
- **Check** - `cargo check [targets] [features]`
- **Clean** - `cargo clean`
- **Fix** - `cargo fix` (automatically fixes compiler warnings)
- **Format** - `cargo fmt`
- **Doc** - `cargo doc [features]`

All commands respect:
- Current build mode (debug/release)
- Checked targets
- Checked features  
- Checked arguments (for run/test)
- Checked environment variables
- Workspace context

### 11. Smart Detection (NEW! 🎉)

**What it does:** Automatically finds unregistered .rs files and undeclared feature flags, helping you organize them according to Cargo conventions

**Detection triggers:**
- When workspace opens
- When Cargo.toml changes
- When .rs files are added/modified
- When tree view refreshes

**What it detects:**

**Stray .rs files:**
- **Scans entire `src/` directory recursively** for any `.rs` files
- Excludes registered targets (main.rs, lib.rs, [[bin]], [[example]], etc.)
- **Automatically skips referenced modules** - checks for `mod`, `use`, and `include!` statements
- Only shows files that are truly unregistered and unreferenced
- Asks you what type each file should be: binary, example, test, or benchmark
- **Offers to move files to conventional directories** (src/bin/, examples/, tests/, benches/)

**Undeclared features:**
- `#[cfg(feature = "name")]` attributes in code
- Features used but not declared in `[features]` section
- Scans all `.rs` files in src/, tests/, benches/, examples/

**Interactive workflow:**
1. Detection runs automatically (2-second debounce)
2. For stray .rs files: "What type of target is 'stray_file' (src/stray_file.rs)?"
   - Choose: Binary, Example, Test, Benchmark, or Skip
3. After resolving types: "Move showcase_example.rs to examples/ directory?"
   - Choose: Move to conventional directory or Keep in current location
4. Shows summary: "Found 2 unregistered targets and 3 undeclared features. Configure them?"
5. Click **Configure** → QuickPick UI opens with all items
6. Select items to add (all pre-selected)
7. Click apply → Files moved (if requested) and Cargo.toml updated automatically

**File organization actions:**

When you configure a target, the extension offers to move it to the standard Cargo directory:

| Target Type | Conventional Directory | Action |
|-------------|------------------------|--------|
| Binary      | `src/bin/`            | Moves file and updates path in Cargo.toml |
| Example     | `examples/`           | Moves file and updates path in Cargo.toml |
| Test        | `tests/`              | Moves file and updates path in Cargo.toml |
| Benchmark   | `benches/`            | Moves file and updates path in Cargo.toml |

**Benefits of moving:**
- ✅ Follows Rust best practices and conventions
- ✅ Makes project structure immediately clear to other developers
- ✅ Keeps src/ clean and focused on library/binary code
- ✅ Automatic path updates ensure Cargo.toml stays in sync
- ✅ Creates target directories if they don't exist

**Options:**
- **Configure** - Opens interactive selection UI
- **Ignore** - Dismiss notification (will show again later)
- **Don't Show Again** - Permanently disable for this workspace
- **Skip** - For individual files you want to leave unregistered

**Example detection:**
```rust
// src/showcase_example.rs (found anywhere in src/)
// Smart detection will ask: "What type should this be?" → Example
// Then ask: "Move to examples/ directory?" → Yes
#[cfg(feature = "showcase")]  // ← also detected as undeclared
fn main() {
    println!("Example program!");
}
```

**After configuration (with move):**

File moved from `src/showcase_example.rs` to `examples/showcase_example.rs`

```toml
[[example]]
name = "showcase-example"
path = "examples/showcase_example.rs"

[features]
showcase = []
```

**Why this is useful:**
- Catch forgotten module files that should be targets
- Organize files according to Cargo conventions automatically
- Keep your project structure clean and maintainable
- **Automatically ignores helper modules** - no false positives from utility code

**How module detection works:**
The extension scans all `.rs` files looking for references:
- `mod helper_module;` - Module declarations
- `use crate::utils::helper;` - Use statements
- `include!("constants.rs")` - Include macros

If a file is referenced by any of these, it's automatically excluded from detection. This means:
- ✅ Helper modules used by your code: **ignored**
- ✅ Utility files imported elsewhere: **ignored**
- ✅ Shared constants/types: **ignored**
- ⚠️ Standalone executables with `main()`: **detected**
- ⚠️ Orphaned test/benchmark files: **detected**

**Workspace support:**
- Detects across all workspace members
- Groups items by member in UI
- Updates correct Cargo.toml for each member

## 📦 Installation

### From Marketplace

1. Open VS Code
2. Go to Extensions (Cmd+Shift+X)
3. Search "cargUI"
4. Click Install

### From Source

```bash
git clone <repository-url>
cd Cargui
npm install
npm run compile
# Press F5 in VS Code to launch extension development host
```

## ⌨️ Keyboard Shortcuts

**macOS:**
- `Cmd+K Alt+1` - Run
- `Cmd+K Alt+2` - Build
- `Cmd+K Alt+3` - Check
- `Cmd+K Alt+4` - Test
- `Cmd+K Alt+5` - Format (rustfmt)
- `Cmd+K Alt+6` - Clean
- `Cmd+K Alt+7` - Fix (cargo fix)
- `Cmd+K Alt+8` - Doc
- `Cmd+K Alt+9` - Update
- `Cmd+Delete` - Delete selected item (arguments, env vars, snapshots, custom commands)

**Windows/Linux:**
- `Ctrl+K Alt+1` through `Ctrl+K Alt+9` - Same commands as above
- `Ctrl+Delete` - Delete selected item

## 🎓 Common Workflows

### Single Package Development

**Scenario:** Working on a binary with feature flags

1. Check "main" target
2. Check "database" and "logging" features
3. Set mode to Debug
4. Click Run
5. Save as "dev" snapshot

**Result:** `cargo run --bin main --features database,logging`

### Workspace Development

**Scenario:** Multi-crate project, focusing on API package

1. Click "api" label (select context - see api's targets)
2. Check "api" checkbox (include in build)
3. Check "shared" checkbox (build dependency too)
4. Check features you need
5. Click Build

**Result:** `cargo build --package api --package shared --features ...`

### Testing Workflow

**Scenario:** Run specific integration test with logging

1. Check test target: `integration_tests`
2. Add env var: `RUST_LOG=debug`
3. Check the env var
4. Click Test

**Result:** `RUST_LOG=debug cargo test --test integration_tests`

### Watch Mode Development

**Scenario:** Fast feedback loop while coding

1. Check your main target
2. Click "Watch: Inactive"
3. Select "check" action
4. Edit code
5. Instant compilation feedback in terminal

**Result:** `cargo watch -x check` (runs automatically on save)

## 🔧 Configuration

All settings auto-initialize on first load. Stored in workspace `.vscode/settings.json`:

```json
{
  "cargui.arguments": [
    "--verbose",
    "--quiet"
  ],
  "cargui.environmentVariables": [
    "RUST_BACKTRACE=1"
  ],
  "cargui.snapshots": [
    {
      "name": "main",
      "mode": "debug",
      "targets": ["main"],
      "features": [],
      "workspaceMember": "core"
    }
  ],
  "cargui.customCommands": [
    {
      "name": "Update All",
      "command": "cargo update"
    }
  ],
  "cargui.activeSnapshot": "main"
}
```

**State Persistence:**

- ✅ Snapshots persist (stored in settings.json)
- ✅ Active snapshot persists (last applied snapshot)
- ✅ Checked states persist within extension session
- ❌ Build mode does NOT persist (resets to Debug on restart)
- ❌ Workspace selection does NOT persist (resets on restart)
- ❌ Individual checkbox states don't persist across restarts

**💡 Tip:** Use snapshots to save your preferred configurations, including build mode and workspace context.

**Philosophy:** Snapshots are the persistence mechanism. Configure your common states as snapshots, then quick-toggle between them.

## 🎨 UI Tree Structure

```
📂 Cargo
├── 🔧 Mode: Debug                    [Click to toggle]
├── ⚡ Watch: Inactive                [Click to configure]
│
├── 📁 WORKSPACE MEMBERS              [Only shows if multi-crate]
│   ├── All Members                   [Click: build --workspace]
│   ├── ☑ api ✓ Selected             [Label: context | Checkbox: include in build]
│   ├── ☐ core                        [...]
│   └── ☐ utils                       [...]
│
├── 📸 SNAPSHOTS (main)               [Active snapshot name]
│   ├── ★ main                        [Bold if active, click to apply/deactivate]
│   ├── dev                           [...]
│   └── production                    [...] [Right-click for edit/delete]
│       [+] Create   [↻] Reset
│
├── 📦 TARGETS
│   ├── ☑ main                        [Click checkbox or label to toggle]
│   ├── ☐ cli-tool                    [...]
│   └── ☐ server                      [...]
│       [Toggle All]
│
├── ⚙️ FEATURES
│   ├── ☑ json                        [...]
│   ├── ☐ async                       [...]
│   └── ☐ database                    [...]
│       [Toggle All]
│
├── 🔧 ARGUMENTS
│   ├── ☑ --verbose                   [Program arguments (after --)]
│   └── ☐ --port 8080                 [...]
│       [+] Add   [↻] Reset
│
├── 🌍 ENVIRONMENT VARIABLES
│   ├── ☑ RUST_BACKTRACE=1           [...]
│   └── ☐ RUST_LOG=debug             [...]
│       [+] Add   [↻] Reset
│
└── 🖥️ CUSTOM COMMANDS
    ├── Search Crates                 [Click to run]
    ├── Add Dependency                [...]
    └── Tree Dependencies             [...]
        [+] Add   [↻] Reset

[Build] [Run] [Test] [Check] [Clean] [Clippy] [Fmt] [Doc]
```

## 🐛 Troubleshooting

**Q: Extension doesn't appear in sidebar**  
A: Ensure you're in a Rust project with `Cargo.toml` in workspace root

**Q: Targets not showing**  
A: Check that your `Cargo.toml` has proper `[[bin]]`, `[[example]]` sections or files in standard locations

**Q: Watch mode fails**  
A: Install cargo-watch: `cargo install cargo-watch`

**Q: Workspace members not detected**  
A: Verify `[workspace]` section in root `Cargo.toml` with `members = [...]`

**Q: Snapshots from different workspace showing**  
A: Fixed in v0.2.0 - snapshots now filter by workspace context

**Q: Features not discovered**  
A: Ensure `[features]` section exists in `Cargo.toml`

## 📚 Documentation

- **TESTING.md** - Manual testing guide for all features
- **WORKSPACE.md** - Comprehensive workspace feature documentation
- **cargui-demo/** - Example multi-crate workspace for testing

## 🤝 Contributing

### Development Setup

```bash
git clone <repo>
cd Cargui
npm install
npm run watch    # Auto-compile on changes
# Press F5 to launch Extension Development Host
```

### Project Structure

```
Cargui/
├── src/
│   └── extension.ts          # Main extension (2500+ lines)
├── cargui-demo/              # Test workspace (4 crates)
│   ├── crates/
│   │   ├── api-service/
│   │   ├── core-lib/
│   │   ├── demo-project/
│   │   └── utils/
│   └── Cargo.toml            # Workspace root
├── package.json              # Extension manifest
├── tsconfig.json
└── README.md
```

## 🚀 Roadmap

- [x] Smart detection for unregistered targets and undeclared features
- [ ] Visual Cargo.toml editor
- [ ] Dependency graph visualization
- [ ] Cross-compilation target selector
- [ ] Benchmark comparison runner
- [ ] Profile-guided optimization helper

## 🔔 Release Notes

### v0.3.0 - Smart Detection (Current)
- ✅ **Smart Detection System** - Automatically detects unregistered .rs files and undeclared features
- ✅ Finds binaries in `src/bin/` not registered in `[[bin]]` sections
- ✅ Scans code for `#[cfg(feature = "...")]` attributes not declared in `[features]`
- ✅ Interactive configuration UI with multi-select
- ✅ One-click Cargo.toml modification
- ✅ Workspace-aware detection across all members
- ✅ "Don't Show Again" option with workspace storage
- ✅ Automatic detection on file changes (debounced)

### v0.2.0 - Workspace Support
- ✅ Full Cargo workspace support
- ✅ Multi-package build selection
- ✅ Workspace-aware snapshots with filtering
- ✅ Auto-created default snapshots
- ✅ Context-aware target/feature discovery
- ✅ Generic snapshot naming ("main"/"lib")
- ✅ Conditional UI (hides workspace category for single projects)

### v0.1.0 - Initial Release
- ✅ Target discovery and checkbox selection
- ✅ Feature management
- ✅ Snapshots system
- ✅ Watch mode integration
- ✅ Arguments and environment variables
- ✅ Custom commands

## 📄 License

MIT License - See LICENSE file

## 👏 Acknowledgments

Built with:
- **VS Code Extension API** - Extension framework
- **@iarna/toml** - Cargo.toml parsing
- **TypeScript** - Type-safe development
- **cargo-watch** - File watching functionality

## 🔗 Links

- [GitHub Repository](#)
- [VS Code Marketplace](#)
- [Issue Tracker](#)
- [Changelog](#)

---

**Made with ❤️ for the Rust community**

*Simplifying Cargo workflows, one checkbox at a time.*
