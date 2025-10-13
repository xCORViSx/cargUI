# cargUI - The Complete Rust Development Interface for VS Code

**A comprehensive VS Code extension that transforms your Rust development workflow.** cargUI provides a unified visual interface for Cargo, Rustup, project organization, and code analysis—all accessible from your sidebar.

[![VS Code Marketplace](https://img.shields.io/vscode-marketplace/v/xCORViSx.cargui.svg?label=VS%20Code%20Marketplace&logo=visual-studio-code)](https://marketplace.visualstudio.com/items?itemName=xCORViSx.cargui)
[![Installs](https://img.shields.io/vscode-marketplace/i/xCORViSx.cargui.svg)](https://marketplace.visualstudio.com/items?itemName=xCORViSx.cargui)
[![Rating](https://img.shields.io/vscode-marketplace/r/xCORViSx.cargui.svg)](https://marketplace.visualstudio.com/items?itemName=xCORViSx.cargui)
[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

---

## 🎯 What is cargUI?

cargUI started as a simple GUI for Cargo commands, but has evolved into a **complete Rust development companion** covering:

- **🎨 Project Organization** - Smart detection, module visualization, target management
- **⚙️ Cargo Integration** - Visual interface for all Cargo commands and features  
- **🦀 Rust Toolchain** - Rustup integration and toolchain management
- **📦 Workspace Support** - Intelligent multi-crate workspace handling
- **🔍 Code Intelligence** - Module health indicators, dependency tracking
- **📸 Configuration** - Snapshots for different development scenarios

### Why cargUI?

**Stop typing terminal commands.** Start working visually:

✅ **Click** to build, run, test with precise configurations  
✅ **See** project structure, modules, targets, and dependencies  
✅ **Detect** unregistered files and missing declarations automatically  
✅ **Switch** between development scenarios with snapshots  
✅ **Track** dependency versions and module health in real-time  
✅ **Manage** Rust toolchains without memorizing rustup commands  

---

## 🚀 Quick Start

1. **Install** the extension from VS Code Marketplace
2. **Open** any Rust project with `Cargo.toml`
3. **Find** the Cargo tree view in your Explorer sidebar
4. **Check** a target → Click **Build/Run/Test**

**Example:** Check "main" + "serde" feature → Click Run
```bash
→ cargo run --bin main --features serde
```

---

## ✨ Feature Overview

### 🏗️ Project Organization & Intelligence

<details>
<summary><b>Smart Detection System</b> - Auto-discover unregistered targets and missing features</summary>

**Automatically finds:**
- Unregistered `.rs` files anywhere in `src/`
- `#[cfg(feature = "...")]` attributes not declared in `[features]`
- Files that should be binaries, examples, tests, or benchmarks

**Smart filtering:**
- Skips helper modules (checks for `mod`, `use`, `include!` statements)
- Only shows truly orphaned files
- No false positives from utility code

**Interactive workflow:**
1. Detection runs automatically (or via command palette)
2. Classify each unknown file: Binary? Example? Test? Benchmark?
3. Choose to move files to conventional directories
4. One-click Cargo.toml update

**File organization:**

| Target Type | Conventional Directory | Auto-Move Option |
|-------------|------------------------|------------------|
| Binary      | `src/bin/`            | ✅ Yes           |
| Example     | `examples/`           | ✅ Yes           |
| Test        | `tests/`              | ✅ Yes           |
| Benchmark   | `benches/`            | ✅ Yes           |

Follows Rust best practices automatically!

</details>

<details>
<summary><b>Module Visualization</b> - See your entire module tree with health indicators</summary>

**Color-coded modules:**

🟢 **Green** - Well-maintained public API (documented + public)  
🔵 **Blue** - Public modules (part of your API)  
🟡 **Yellow** - Missing documentation  
🟠 **Orange** - Undeclared modules (not in `mod` statements)  
⚪ **Default** - Private internal modules with docs  

**Module information:**
- Visibility (`pub mod` vs private)
- Documentation status (`///` or `//!` comments)
- Test presence (`#[test]`, `#[cfg(test)]`)
- Directory vs single-file modules
- Hierarchical structure

**Click any module to open the file instantly!**

</details>

<details>
<summary><b>Dependency Management</b> - Track versions and update status</summary>

**Version tracking:**
- 🟢 Green = Latest version (up to date!)
- 🟡 Yellow = Update available
- 🔵 Blue = Workspace dependency  
- 🟠 Orange = Git/path dependency

**Organized by type:**
- **Production** - Runtime dependencies
- **Dev** - Development/testing dependencies
- **Build** - Build script dependencies
- **Workspace** - Shared workspace dependencies

**Real-time crates.io integration** - Shows latest available versions automatically

</details>

---

### ⚙️ Cargo Command Integration

<details>
<summary><b>Target System</b> - Visual management of all buildable targets</summary>

**Auto-discovers:**
- `src/lib.rs` - Library target ⭐
- `src/main.rs` - Main binary ⭐
- `src/bin/*.rs` - Additional binaries
- `examples/*.rs` - Example programs
- `tests/*.rs` - Integration tests
- `benches/*.rs` - Benchmarks
- `[lib]` section in Cargo.toml - Custom library configurations

**Primary targets (⭐):**
- Main binary (`src/main.rs`) and library (`src/lib.rs`) targets are marked with a star icon
- Auto-selected when no targets are checked
- Keyboard shortcuts work with library-only crates!
- Both receive identical special treatment and features

**Color-coded health:**

🔵 **Blue** - Custom location (non-standard path)  
🟠 **Orange** - Incorrect declaration (name/path mismatch)  
🔴 **Red** - Unknown path or unregistered

**Features:**
- Multi-select for batch builds
- Drag & drop to reclassify unknown targets
- One-click run/build/test/doc
- "Toggle All" for quick selection
- Library target support for `cargo build --lib`, `cargo test --lib`, `cargo doc --lib`

</details>

<details>
<summary><b>Feature Flags</b> - Visual feature management</summary>

Parses `[features]` from Cargo.toml:

```toml
[features]
default = ["json"]
json = ["serde_json"]
async = ["tokio"]
database = ["sqlx"]
```

**Usage:**
- Check features to enable
- Combine multiple features
- See feature dependencies
- Toggle all on/off

**Commands use your selections:**
```bash
cargo build --features json,async,database
cargo test --features json
```

</details>

<details>
<summary><b>Build Modes</b> - Debug/Release toggle</summary>

**Click "Mode: Debug"** to switch to Release:
- Adds `--release` to all commands
- Affects build, run, test, bench, doc

**Note:** Resets to Debug on VS Code restart. Use snapshots to preserve release configurations!

</details>

<details>
<summary><b>Snapshots</b> - Save complete build configurations</summary>

**A snapshot stores:**
- Build mode (debug/release)
- Checked targets
- Checked features
- Arguments and environment variables
- Workspace context

**Auto-created snapshots:**
- Binary projects (with `src/main.rs`) → "main" snapshot
- Library projects (with `src/lib.rs`) → "lib" snapshot
- Mixed projects (both) → Both snapshots created
- Workspace projects → One per member

**Workflow:**
1. Configure UI (targets, features, mode)
2. Click **[+]** in SNAPSHOTS
3. Name it: "dev", "production", "testing"
4. Click to apply/deactivate

**Use cases:**
- `dev` → debug, all features, verbose
- `production` → release, minimal features
- `testing` → test targets, fixtures enabled
- `frontend-dev` → specific workspace members

</details>

<details>
<summary><b>Watch Mode</b> - Auto-recompile on file changes</summary>

**Requires:** `cargo-watch` (extension offers to install)

**Watch actions:**
- **check** - Fast compilation check (recommended)
- **build** - Full build on changes
- **run** - Run binary on changes (for servers)
- **test** - Run tests on changes
- **clippy** - Lint on changes

**Usage:**
1. Click "Watch: Inactive"
2. Select action
3. Edit any `.rs` file
4. Auto-runs: `cargo watch -x check`

Respects all your settings (features, env vars, etc.)!

</details>

---

### 🦀 Rust Toolchain Management

<details>
<summary><b>Rust Edition Selector</b> - Manage your Rust edition</summary>

**Features:**
- Shows current edition from `Cargo.toml` (e.g., "Edition: 2021")
- Click to change edition with a dropdown menu
- Automatically fetches available editions from the official Rust Edition Guide
- Future-proof: New editions appear automatically when documented by the Rust team
- Updates `Cargo.toml` while preserving file formatting

**How it works:**
- Fetches edition list from `https://github.com/rust-lang/edition-guide`
- Parses the official documentation to find all available editions
- Falls back to known editions (2015, 2018, 2021, 2024) if offline

**How to Use:**
1. View current edition at the top of the tree
2. Click "Edition: 2021" to open selector
3. Choose a new edition from the dropdown
4. `Cargo.toml` updates automatically ✅

</details>

<details>
<summary><b>Rustup Integration</b> - Manage toolchains visually</summary>

**Status bar shows:**
- Current toolchain (stable/beta/nightly)
- Version number
- Click for details

**No more memorizing rustup commands!**
- See toolchain info at a glance
- Check for updates visually
- Switch toolchains from UI

</details>

---

### 📦 Workspace Support

<details>
<summary><b>Multi-Crate Workspaces</b> - Full support for complex projects</summary>

**Detects workspace structure:**
```toml
[workspace]
members = ["cli", "api", "core", "utils"]
```

**Two selection modes:**

**Label Click** (Context Selection):
- Click package name → Sets as active context
- Tree updates to show that package's targets/features
- Use when focusing on one crate

**Checkbox Click** (Build Selection):
- Check packages → Include in build
- Multi-select for combined builds
- Use for building multiple crates

**Special "All Members":**
- Click → `cargo build --workspace` (builds everything)
- Check → Same as checking all individually

**Commands:**
```bash
# Context: core, Checked: core only
cargo build --package core

# Context: api, Checked: api + core
cargo build --package api --package core

# All Members selected
cargo build --workspace
```

**Workspace snapshots** remember your context and selections!

</details>

---

### 🛠️ Additional Features

<details>
<summary><b>Arguments</b> - Program arguments (after <code>--</code>)</summary>

**Add reusable arguments:**
- `--verbose`
- `--port 8080`
- `--config dev.toml`

**Check to enable:**
```bash
cargo run --bin server -- --verbose --port 8080
```

**Defaults included**, add your own via **[+]** button

</details>

<details>
<summary><b>Environment Variables</b> - Set env vars for cargo commands</summary>

**Common variables:**
- `RUST_BACKTRACE=1` - Stack traces
- `RUST_LOG=debug` - Logging level
- `DATABASE_URL=...` - Test database

**Commands:**
```bash
RUST_BACKTRACE=1 RUST_LOG=debug cargo run
```

</details>

<details>
<summary><b>Custom Commands</b> - Save frequently-used cargo commands</summary>

**Default commands:**
- `cargo clippy` - Lint
- `cargo search <crate>` - Search crates
- `cargo add <crate>` - Add dependency
- `cargo tree` - Dependency tree
- `cargo update` - Update dependencies

**Add your own:**
```bash
cargo build --target x86_64-unknown-linux-gnu
cargo test --nocapture
cargo doc --document-private-items --open
```

Click to execute in terminal!

</details>

---

## ⌨️ Keyboard Shortcuts

**Works with both binary and library targets!** If no target is checked, shortcuts automatically use `src/main.rs` or `src/lib.rs`.

### macOS
- `Cmd+K Alt+1` - Run
- `Cmd+K Alt+2` - Build  
- `Cmd+K Alt+3` - Check
- `Cmd+K Alt+4` - Test
- `Cmd+K Alt+5` - Format (rustfmt)
- `Cmd+K Alt+6` - Clean
- `Cmd+K Alt+7` - Fix (cargo fix)
- `Cmd+K Alt+8` - Doc
- `Cmd+K Alt+9` - Update
- `Cmd+Delete` - Delete selected item

### Windows/Linux  
- `Ctrl+K Alt+1-9` - Same as macOS
- `Ctrl+Delete` - Delete selected item

---

## 🎓 Common Workflows

### Single Crate Development

```
1. Check "main" target
2. Enable "database" and "logging" features
3. Set mode to Debug
4. Click Run
5. Save as "dev" snapshot
```

**Result:** `cargo run --bin main --features database,logging`

### Multi-Crate Workspace

```
1. Click "api" label (set context)
2. Check "api" + "shared" checkboxes
3. Enable features
4. Click Build
```

**Result:** `cargo build --package api --package shared --features ...`

### Testing with Logging

```
1. Check test: "integration_tests"
2. Add env var: RUST_LOG=debug
3. Check the env var
4. Click Test
```

**Result:** `RUST_LOG=debug cargo test --test integration_tests`

### Watch Mode Development

```
1. Check your main target
2. Click "Watch: Inactive"
3. Select "check"
4. Edit code → instant feedback!
```

---

## 📦 Installation

### From VS Code Marketplace

1. Open VS Code
2. Go to Extensions (`Cmd+Shift+X`)
3. Search "cargUI"
4. Click Install

### From Source

```bash
git clone https://github.com/xCORViSx/cargUI.git
cd cargUI
npm install
npm run compile
# Press F5 to launch Extension Development Host
```

---

## 🎨 Tree View Structure

```
📂 Cargo
├── 🔧 Mode: Debug                [Click to toggle]
├── ⚡ Watch: Inactive            [Click to configure]
├── 🦀 Rust: stable 1.75.0       [Rustup status]
│
├── 📁 WORKSPACE MEMBERS          [Multi-crate only]
│   ├── All Members               [Click: --workspace]
│   ├── ☑ api ✓ Selected         [Label=context | Box=build]
│   └── ☐ core
│
├── 🗂️ MODULES                   [Code structure]
│   ├── 🟢 auth (pub)            [Public, documented]
│   ├── 🔵 api (pub)             [Public]
│   ├── 🟡 utils                 [Missing docs]
│   └── 🟠 helper                [Undeclared]
│
├── 📦 DEPENDENCIES               [Version tracking]
│   ├── Production
│   │   ├── 🟢 serde 1.0.195    [Latest]
│   │   └── 🟡 tokio 1.35.0     [1.36.0 available]
│   └── Dev
│       └── 🔵 criterion 0.5.1   [Local]
│
├── 📸 SNAPSHOTS (dev)            [Active: dev]
│   ├── ★ dev                    [Bold=active]
│   └── production
│       [+] Create  [↻] Reset
│
├── 📦 TARGETS
│   ├── Binaries
│   │   ├── ☑ main
│   │   └── ☐ cli-tool
│   ├── Examples
│   ├── Tests
│   └── ⚠️ Unknowns (2)         [Need classification]
│       ├── 🔴 stray_file
│       └── 🔴 old_test
│       [Toggle All]
│
├── ⚙️ FEATURES
│   ├── ☑ json
│   ├── ☐ async
│   └── ☐ database
│       [Toggle All]
│
├── 🔧 ARGUMENTS
│   ├── ☑ --verbose
│   └── ☐ --port 8080
│       [+] Add  [↻] Reset
│
├── 🌍 ENVIRONMENT VARIABLES
│   ├── ☑ RUST_BACKTRACE=1
│   └── ☐ RUST_LOG=debug
│       [+] Add  [↻] Reset
│
└── 🖥️ CUSTOM COMMANDS
    ├── Clippy Lint
    ├── Update All
    └── Tree Dependencies
        [+] Add  [↻] Reset

[Build] [Run] [Test] [Check] [Clean] [Fix] [Fmt] [Doc]
```

---

## 🔧 Configuration

Settings auto-initialize in `.vscode/settings.json`:

```json
{
  "cargui.arguments": ["--verbose"],
  "cargui.environmentVariables": ["RUST_BACKTRACE=1"],
  "cargui.snapshots": [
    {
      "name": "dev",
      "mode": "debug",
      "targets": ["main"],
      "features": ["json", "async"]
    }
  ],
  "cargui.customCommands": [
    { "name": "Clippy", "command": "cargo clippy" }
  ]
}
```

**Persistence:**
- ✅ Snapshots persist
- ✅ Active snapshot persists
- ❌ Build mode resets to Debug (use snapshots!)
- ❌ Individual checkboxes don't persist

💡 **Tip:** Use snapshots as your persistence mechanism!

---

## 🐛 Troubleshooting

**Q: Extension doesn't appear**  
A: Open a Rust project with `Cargo.toml`

**Q: Targets not showing**  
A: Check `Cargo.toml` for `[[bin]]`, `[[example]]` sections

**Q: Watch mode fails**  
A: Install cargo-watch: `cargo install cargo-watch`

**Q: Modules not detected**  
A: Ensure `src/lib.rs` or `src/main.rs` exists

**Q: Dependencies not updating**  
A: Refresh the tree view (click refresh icon)

---

## 🤝 Contributing

We welcome contributions! See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

### Development Setup

```bash
git clone https://github.com/xCORViSx/cargUI.git
cd cargUI
npm install
npm run watch    # Auto-compile
# Press F5 to test
```

### Project Structure

```
cargUI/
├── src/
│   ├── extension.ts              # Main entry point
│   ├── cargoTreeProvider.ts      # Tree view provider
│   ├── smartDetection.ts         # Smart detection
│   ├── moduleDetection.ts        # Module analysis
│   ├── cargoDiscovery.ts         # Target discovery
│   ├── cratesIo.ts              # Version checking
│   └── ... (15+ focused modules)
├── cargui-demo/                  # Test workspace
└── package.json
```

---

## 🚀 Project Status

**Version 1.0.0 - Feature Complete!**

All planned features have been implemented:

✅ Smart detection for unregistered targets
✅ Module visualization with health indicators
✅ Dependency version tracking
✅ Rustup integration
✅ Rust edition selector
✅ Hierarchical organization (categories/subcategories)
✅ Mixed organization (categorized + uncategorized items)
✅ Click-to-view in Cargo.toml
✅ Inline action buttons
✅ Full workspace support
✅ Watch mode integration
✅ Snapshot system

This extension is now production-ready and feature-complete for comprehensive Rust development workflows.

---

## 📝 Release Notes

### v1.0.0 - Stable Release (October 2025)

**🎉 Feature Complete - Production Ready!**

**🎨 Project Organization:**
- ✅ Smart Detection for unregistered targets and undeclared features
- ✅ Module visualization with color-coded health indicators
- ✅ Dependency version tracking with crates.io integration
- ✅ File organization with auto-move to conventional directories
- ✅ Intelligent module filtering (no false positives)

**⚙️ Cargo & Rust:**
- ✅ Full workspace support with context switching
- ✅ Rustup integration (toolchain display)
- ✅ Rust edition selector for easy edition management
- ✅ Target color coding for health status
- ✅ Drag & drop target reclassification
- ✅ Auto-created default snapshots

**🔧 Improvements:**
- ✅ Workspace-aware detection across members
- ✅ One-click Cargo.toml updates
- ✅ Enhanced tooltips with rich information
- ✅ Better icon system (context-aware)

### v0.1.0 - Initial Release
- Target discovery and management
- Feature flag toggles
- Snapshots system
- Watch mode integration
- Custom commands

---

## 📄 License

MIT License - See [LICENSE](LICENSE) file

---

## 🔗 Links

- [GitHub Repository](https://github.com/xCORViSx/cargUI)
- [VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=xCORViSx.cargui)
- [Issue Tracker](https://github.com/xCORViSx/cargUI/issues)
- [Contributing Guide](CONTRIBUTING.md)

---

**Made with ❤️ for the Rust community**

*From simple cargo commands to complete Rust development—all in your sidebar.*

**Created by:** Tradell  
**Developed by:** Claude Sonnet 4.5 thru GitHub Copilot