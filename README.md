# cargUI - The Complete Rust Development Interface

**A comprehensive extension that transforms your Rust development workflow.** cargUI provides a unified visual interface for Cargo, Rustup, project organization, and code analysis—all accessible from your sidebar.

Works seamlessly in **VS Code** and **Cursor**!

[![VS Code Marketplace](https://img.shields.io/vscode-marketplace/v/xCORViSx.cargui.svg?label=VS%20Code%20Marketplace&logo=visual-studio-code)](https://marketplace.visualstudio.com/items?itemName=xCORViSx.cargui)
[![Installs](https://img.shields.io/vscode-marketplace/i/xCORViSx.cargui.svg)](https://marketplace.visualstudio.com/items?itemName=xCORViSx.cargui)
[![Rating](https://img.shields.io/vscode-marketplace/r/xCORViSx.cargui.svg)](https://marketplace.visualstudio.com/items?itemName=xCORViSx.cargui)
[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

---

## 🎯 What is cargUI?

cargUI is a **visual Rust development companion** covering:

- [^1]**🎨 Project organization** - Smart detection, visualization, and management of various Rust project elements
- [^2]**⚙️ Cargo integration** - Visual interface for all Cargo commands and features  
- [^3]**🦀 Rust toolchain** - Rustup integration and toolchain management
- [^4]**📦 Workspace support** - Intelligent multi-crate workspace handling
- [^5]**🔍 Health indications** - for the stability and quality of modules and dependencies
- [^6]**📸 Configuration** - Snapshots for different development scenarios

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

1. **Install** the extension from [VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=xCORViSx.cargui) or [Open VSX](https://open-vsx.org/extension/xCORViSx/cargUI)
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

- [^7]Unregistered `.rs` files anywhere in `src/`
- [^8]`#[cfg(feature = "...")]` attributes not declared in `[features]`
- [^9]Files that should be binaries, examples, tests, or benchmarks

**Smart filtering:**

- [^10]Skips helper modules (checks for `mod`, `use`, `include!` statements)
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
| [^11]Binary      | `src/bin/`            | ✅ Yes           |
| [^11]Example     | `examples/`           | ✅ Yes           |
| [^11]Test        | `tests/`              | ✅ Yes           |
| [^11]Benchmark   | `benches/`            | ✅ Yes           |

Follows Rust best practices automatically!

</details>

<details>
<summary><b>Module Visualization</b> - See your entire module tree with health indicators</summary>

**Color-coded modules:**

[^12]🟢 **Green** - Well-documented (90-100% of code elements have docs)  
[^12]🔵 **Blue** - Moderately documented (50-90% of elements)  
[^12]⚪ **Default** - Underdocumented (0-50% of elements)  
[^13]🔴 **Red** - Undeclared modules (not in `mod` statements)  

**Module health calculation (v1.0.8+):**

- [^14]Counts individual code elements: functions, structs, enums, traits, types, constants, statics
- [^15]Checks each element for preceding `///` or `//!` doc comments
- [^16]Shows percentage: "75% (6/8 elements)" in tooltip
- Element-based (not file-level) for accurate documentation tracking
- **Privateness has no bearing on health** (v1.1.2) - Color based solely on documentation percentage

**Module information:**

- Visibility: Private modules show **(priv)** indicator (v1.1.2)
- Documentation percentage with element counts
- [^17]Test presence (`#[test]`, `#[cfg(test)]`)
- Directory vs single-file modules
- Hierarchical structure
- [^18]**Module counts** - Shows direct children count at all nesting levels

**Module declaration (v1.1.2):**

- 🔴 **Undeclared modules** display inline "Declare Module" button
- Click to add `mod module_name;` to main.rs or lib.rs
- **MODULES category** shows "Declare All Undeclared Modules" button when undeclared modules exist
- Multi-member workspaces: Declares across all members or selected member only

**Context-aware display:**

- [^19]When a workspace member is selected, shows only that member's modules
- Automatically switches context when you select different workspace members
- Clear separation of concerns in multi-crate projects

**Click any module to open the file instantly!**


</details>

<details>
<summary><b>Dependency Management</b> - Track versions and update status</summary>

**Color-coded dependencies:**

- [^20] 🟢 **Green text** = Latest version (up to date!)
- [^21] ⭐ **Yellow star icon** = Workspace-inherited dependency (v1.0.5)
- 📦 **Package icon** = Standard dependency with version number shown

**Organized by type:**

- **Production** - Runtime dependencies
- **Dev** - Development/testing dependencies
- **Build** - Build script dependencies
- **Workspace** - Shared workspace dependencies

**Workspace-inherited dependencies (v1.0.5):**

- [^23] Dependencies with `{ workspace = true }` display with yellow star icons
- [^24] Show correct version numbers resolved from workspace
- Sorted to the top of their category for easy identification
- [^25] Tooltip shows "(from workspace)" origin
- Click to navigate to workspace root `Cargo.toml`

**Version change resilience (v1.0.5):**

- [^26] **Selective reversion** - Only failed updates revert, successful ones persist
- **Duplicate resolution** - Automatically removes ambiguous dependency constraints
- **Lock file refresh** - Cleans `Cargo.lock` before updates for reliable resolution
- **Clear feedback** - Shows which dependencies succeeded vs failed

[^27] **Real-time crates.io integration** - Shows latest available versions automatically


**Auto-format Cargo.toml (v1.1.0):**

- [^28] Automatically formats `Cargo.toml` after edits (adding dependencies, declaring features/targets)
- [^29] Shows notification with "Undo" button to revert formatting
- [^30] "Disable Auto-Formatting" button with re-enable option
- [^31] Configurable via `cargui.autoFormatCargoToml` setting (default: true)
- Preserves file content while improving readability

</details>


---

### ⚙️ Cargo Command Integration

<details>
<summary><b>Target System</b> - Visual management of all buildable targets</summary>

**Auto-discovers:**

- [^32] `src/lib.rs` - Library target ⭐
- [^33] `src/main.rs` - Main binary ⭐
- [^34] `src/bin/*.rs` - Additional binaries
- [^35] `examples/*.rs` - Example programs
- [^36] `tests/*.rs` - Integration tests
- [^37] `benches/*.rs` - Benchmarks
- [^38] `[lib]` section in Cargo.toml - Custom library configurations

**Primary targets (⭐):**

- [^39] Main binary (`src/main.rs`) and library (`src/lib.rs`) targets are marked with a star icon
- Auto-selected when no targets are checked
- Keyboard shortcuts work with library-only crates!
- Both receive identical special treatment and features

**Batch target registration (v1.1.0):**

- [^40] **Inline button** on Unknowns folder to register all at once
- Interactive quickpick shows inferred type (based on location/icon)
- Progress indicator: "Register target_name [path] (1/5)"
- Cancellable at any point during workflow
- Type-specific icons: note→example, beaker→test, dashboard→bench, file-binary→bin

**Target validation (v1.1.0):**

- [^41] Validates name-to-filename matching for all target types
- [^42] Checks directory correctness (binary in examples/ → yellow warning)
- Intelligent hyphen/underscore handling (Cargo treats as equivalent)
- Specific tooltip messages explain validation failures

**Color-coded health:**


[^43] 🟡 **Yellow** - Target validation issues (name doesn't match filename, or wrong directory for target type)  
[^44] 🔵 **Blue** - Custom location (non-standard path)  
[^45] 🔴 **Red** - Unknown path or unregistered

**Features:**

- Multi-select for batch builds
- Drag & drop to reclassify unknown targets
- One-click run/build/test/doc
- "Toggle All" for quick selection
- Library target support for `cargo build --lib`, `cargo test --lib`, `cargo doc --lib`

</details>


<details>
<summary><b>Feature Flags</b> - Visual feature management</summary>

[^46] Parses `[features]` from Cargo.toml:

```toml
[features]
default = ["json"]
json = ["serde_json"]
async = ["tokio"]
database = ["sqlx"]
```

**Undeclared feature detection (v1.1.0):**

- [^47] Scans code for `#[cfg(feature = "...")]` attributes
- [^48] Shows undeclared features in red with "Declare Feature" context menu
- [^49] **Inline button** on Features category to declare all at once
- [^50] Right-click individual features to declare them with empty array `[]`
- [^51] Features category icon turns red when undeclared features exist

**Usage:**

- Check features to enable
- Combine multiple features
- See feature dependencies
- Toggle all on/off
- Declare undeclared features via context menu or inline button

**Commands use your selections:**

```bash
cargo build --features json,async,database
cargo test --features json
```

</details>

<details>
<summary><b>Build Modes</b> - Debug/Release toggle</summary>

**Click "Mode: Debug"** to switch to Release:

- [^52] Adds `--release` to all commands
- Affects build, run, test, bench, doc

**Note:** Resets to Debug on VS Code restart. Use snapshots to preserve release configurations!


</details>

<details>
<summary><b>Snapshots</b> - Save complete build configurations</summary>

[^53] **A snapshot stores:**

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

[^54] **Requires:** `cargo-watch` (extension offers to install)

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

- [^55] Shows current edition from `Cargo.toml` (e.g., "Edition: 2021")
- Click to change edition with a dropdown menu
- [^56] Automatically fetches available editions from the official Rust Edition Guide
- [^57] Future-proof: New editions appear automatically when documented by the Rust team
- Updates `Cargo.toml` while preserving file formatting

**How it works:**

- [^58] Fetches edition list from `https://github.com/rust-lang/edition-guide`
- Parses the official documentation to find all available editions
- [^59] Falls back to known editions (2015, 2018, 2021, 2024) if offline

**How to Use:**

1. View current edition at the top of the tree
2. Click "Edition: 2021" to open selector
3. Choose a new edition from the dropdown
4. `Cargo.toml` updates automatically ✅

</details>


<details>
<summary><b>Rustup Integration</b> - Manage toolchains visually</summary>

**Status bar shows:**

- [^60] Current toolchain (stable/beta/nightly)
- Version number
- Click for details

**No more memorizing rustup commands!**

- See toolchain info at a glance
- [^61] Check for updates visually
- Switch toolchains from UI

</details>


---

### 📦 Workspace Support

<details>
<summary><b>Multi-Crate Workspaces</b> - Full support for complex projects</summary>

[^62] **Detects workspace structure:**

```toml
[workspace]
members = ["cli", "api", "core", "utils"]
```

**Two selection modes:**

**Label Click** (Context Selection):

- [^63] Click package name → Sets as active context
- Tree updates to show that package's targets/features
- Use when focusing on one crate
- **Click again to deselect** and return to "all" view (v1.0.5)

**Checkbox Click** (Build Selection):

- [^64] Check packages → Include in build
- Multi-select for combined builds
- Use for building multiple crates

**Special "All Members":**

- Click → `cargo build --workspace` (builds everything)
- Check → Same as checking all individually

**Visual indicators:**

- ⭐ Selected member shows star icon
- [^65] 🟠 Orange icons for workspace-related items (members, category header)
- Non-root members show relative directory path as description (v1.0.5)

**Context menus (v1.1.0):**

- Right-click member → "View Cargo.toml", "View main target", "View documentation"
- Right-click project header (when member selected) → Same three options
- Right-click module → "View in main target" (jumps to `mod` declaration), "View documentation"
- Module documentation opens local docs at correct module path
- Member-specific documentation builds and opens correct crate docs

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

[^66] **Check to enable:**

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

[^67] **Commands:**

```bash
RUST_BACKTRACE=1 RUST_LOG=debug cargo run
```

</details>

<details>
<summary><b>Custom Commands</b> - Save frequently-used cargo commands</summary>

[^68] **Default commands:**

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

[^69] **Works with both binary and library targets!** If no target is checked, shortcuts automatically use `src/main.rs` or `src/lib.rs`.

### macOS

- [^70] `Cmd+K Alt+1` - Run
- [^71] `Cmd+K Alt+2` - Build  
- `Cmd+K Alt+3` - Check
- `Cmd+K Alt+4` - Test
- `Cmd+K Alt+5` - Format (rustfmt)
- `Cmd+K Alt+6` - Clean
- `Cmd+K Alt+7` - Fix (cargo fix)
- `Cmd+K Alt+8` - Doc
- `Cmd+K Alt+9` - Update
- [^72] `Cmd+Delete` - Delete selected item

### Windows/Linux

- `Ctrl+K Alt+1-9` - Same as macOS
- `Ctrl+Delete` - Delete selected item

---

## 🎓 Common Workflows

### Single Crate Development

```text
1. Check "main" target
2. Enable "database" and "logging" features
3. Set mode to Debug
4. Click Run
5. Save as "dev" snapshot
```

[^73] **Result:** `cargo run --bin main --features database,logging`

### Multi-Crate Workspace

```text
1. Click "api" label (set context)
2. Check "api" + "shared" checkboxes
3. Enable features
4. Click Build
```

[^74] **Result:** `cargo build --package api --package shared --features ...`

### Testing with Logging

```text
1. Check test: "integration_tests"
2. Add env var: RUST_LOG=debug
3. Check the env var
4. Click Test
```

[^75] **Result:** `RUST_LOG=debug cargo test --test integration_tests`

### Watch Mode Development

```text
1. Check your main target
2. Click "Watch: Inactive"
3. Select "check"
4. Edit code → instant feedback!
```

---

## 📦 Installation

### From VS Code or Cursor Marketplace

1. Open VS Code or Cursor
2. Go to Extensions (`Cmd+Shift+X` or `Ctrl+Shift+X`)
3. Search "cargUI"
4. Click Install

**Note:** cargUI works seamlessly in both VS Code and Cursor, with full feature parity.

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

```text
📂 my-app (v0.1.0)
├── 📦 Edition: 2021
├── 📁 WORKSPACE MEMBERS          [Multi-crate only]
│   ├── ☑ api ✓ Selected
│   └── ☐ core
├── ⚡ Watch: Inactive
├── 🗂️ MODULES
│   ├── 🟢 auth (pub)            [90-100% documented]
│   ├── 🔵 api                   [50-90% documented]
│   ├── helper                   [0-50% documented]
│   └── 🔴 orphan                [Undeclared in Cargo.toml]
├── 📦 DEPENDENCIES
│   ├── Production
│   │   ├── 🟢 serde 1.0.195    [Latest]
│   │   └── 🟡 tokio 1.35.0     [1.36.0 available]
│   └── Dev
│       └── 🔵 criterion 0.5.1   [Local]
├── ────────────────
├── 📸 SNAPSHOTS (dev)
│   ├── ★ dev                    [Active]
│   └── production
├── 🐛 Mode: Debug
├── 📦 Targets
│   ├── Binaries
│   │   ├── ☑ main
│   │   └── ☐ cli-tool
│   ├── Examples
│   ├── Tests
│   └── ⚠️ Unknowns (2)
│       ├── 🔴 stray_file
│       └── 🔴 old_test
├── ⚙️ Features
│   ├── ☑ json
│   ├── ☐ async
│   ├── ☐ database
│   └── 🔴 undeclared_feature    [Undeclared in Cargo.toml]
├── 🔧 Arguments
│   ├── ☑ --verbose
│   └── ☐ --port 8080
├── 🌍 Environment Variables
│   ├── ☑ RUST_BACKTRACE=1
│   └── ☐ RUST_LOG=debug
├── ────────────────
└── 🖥️ CUSTOM COMMANDS
    ├── Clippy Lint
    ├── Update All
    └── Tree Dependencies
```

[^76][^77]---

## 🔧 Configuration

[^78] Settings auto-initialize in `.vscode/settings.json`:

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

```text
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

## 📝 Version

**Current:** v1.1.1  
**See [CHANGELOG.md](CHANGELOG.md) for detailed release notes and technical changes**

---

## 📄 License

MIT License - See [LICENSE](LICENSE) file

---

## 🔗 Links

- [GitHub Repository](https://github.com/xCORViSx/cargUI)
- [VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=xCORViSx.cargui)
- [Open VSX Registry](https://open-vsx.org/extension/xCORViSx/cargUI)
- [Issue Tracker](https://github.com/xCORViSx/cargUI/issues)
- [Contributing Guide](CONTRIBUTING.md)

---

**Made with ❤️ for the Rust community**

*From simple cargo commands to complete Rust development—all in your sidebar.*

**Created by:** Tradell  
**Developed by:** Claude Sonnet 4.5 thru GitHub Copilot

---

## 📚 Footnote Definitions

[^1]: cargoTreeProvider.ts:121-248 - Smart detection triggers on tree refresh to identify unknown targets and undeclared features
[^2]: cargoTreeProvider.ts:250-423 - getProjectNameAndVersion and getMemberNameAndVersion extract package metadata from Cargo.toml
[^3]: decorationProvider.ts:1-91 - DecorationProvider applies color-coded badges (red, yellow, green, blue, orange) to tree items via resourceUri
[^4]: cargoDiscovery.ts:101-270 - discoverCargoTargets parses Cargo.toml [bin], [lib], [[example]], [[test]], [[bench]] sections
[^5]: cargoDiscovery.ts:401-512 - discoverCargoDependencies extracts workspace, production, dev, and build dependencies with version info
[^6]: defaultConfig.ts:1-247 - initializeDefaultConfig creates .vscode/settings.json with cargui defaults on first activation

[^7]: smartDetection.ts:11-280 - detectUnregisteredTargets finds source files in src/bin, examples, tests, benches not declared in Cargo.toml
[^8]: smartDetection.ts:363-430 - detectUndeclaredFeatures finds #[cfg(feature = "name")] in code not present in [features] section
[^9]: commands.ts:825-1047 - showSmartDetectionResults displays interactive panel for unknown targets and undeclared features
[^10]: smartDetection.ts:298-340 - getTargetRegistrationInstructions provides code snippets to add missing targets to Cargo.toml
[^11]: fileOperations.ts:32-48 - classifyTarget determines correct target type (bin/example/test/bench) based on file location

[^12]: moduleDetection.ts:328-335 - detectModules scans src directory for .rs files and checks if declared via mod statements
[^13]: moduleDetection.ts:305-345 - Module color coding: green (90-100% doc coverage), blue (50-90%), white (0-50%)
[^14]: moduleDetection.ts:157-162 - isPublicModule checks for pub keyword in mod declarations
[^15]: moduleDetection.ts:179-188 - calculateDocumentationCoverage counts /// doc comments vs public items
[^16]: moduleDetection.ts:389-392 - Undeclared modules (no mod statement in main target) are colored red
[^17]: moduleDetection.ts:119 - getMainTargetFile identifies entry point (main.rs or lib.rs) for mod statement verification
[^18]: moduleDetection.ts:402-405 - Open module file command allows viewing/editing module source
[^19]: commands.ts:1155-1299 - toggleModuleVisibility adds/removes pub keyword in mod declarations

[^21]: decorationProvider.ts:30-31 - Red (charts.red) indicates errors: undeclared modules, unknown targets, outdated dependencies
[^23]: cargoDiscovery.ts:359-390 - getLatestVersion queries crates.io API for newest available dependency version
[^24]: cargoTreeProvider.ts:1973-1995 - Dependency color coding based on version status (latest/outdated/local/workspace)
[^25]: cargoTreeProvider.ts:2030-2032 - Workspace dependencies display member path and use blue coloring
[^26]: commands.ts:3340-3378 - updateDependency modifies Cargo.toml to newest crates.io version
[^27]: cargoTreeProvider.ts:1968-2005 - Dependencies show version comparison tooltip when updates available
[^28]: commands.ts:140-180 - toggleDependency adds/removes dependencies from build with --features or --no-default-features
[^29]: commands.ts:152-167 - Production deps affect both dev and release builds
[^30]: commands.ts:167-180 - Dev dependencies only included in debug builds (skipped in --release)
[^31]: commands.ts:142 - checkedDependencies Set tracks which dependencies are enabled for current build

[^32]: cargoDiscovery.ts:128-137 - Target type: bin (executable applications)
[^33]: cargoDiscovery.ts:139-155 - Target type: lib (library crates)
[^34]: cargoDiscovery.ts:156-178 - Target type: example (code examples in examples/ directory)
[^35]: cargoDiscovery.ts:179-201 - Target type: test (integration tests in tests/ directory)
[^36]: cargoDiscovery.ts:202-224 - Target type: bench (benchmarks in benches/ directory)
[^37]: cargoDiscovery.ts:225-247 - Target type: custom (proc-macro and other special targets)
[^38]: cargoDiscovery.ts:115-127 - Targets categorized by type with checkbox selection for builds
[^39]: cargoTreeProvider.ts:1868-1869 - Required targets (main lib/bin) prevent unchecking to ensure valid builds
[^40]: commands.ts:1584-1750 - classifyUnknownTarget prompts user to select correct target type for unregistered files
[^41]: cargoTreeProvider.ts:1859-1860 - Invalid targets (wrong location/name) show warning icon with fix suggestion
[^42]: cargoTreeProvider.ts:1802-1860 - Target validation checks file location matches type (bin in src/bin, examples in examples/, etc.)
[^43]: cargoTreeProvider.ts:1802, 1820, 1838, 1860 - Yellow (charts.yellow) indicates validation issues with specific reason tooltips
[^44]: cargoTreeProvider.ts:1865 - Purple (charts.purple) marks required targets that cannot be unchecked
[^45]: cargoTreeProvider.ts:1540-1545 - Undeclared features (used in code but not in Cargo.toml) are colored red with add-to-manifest command

[^46]: cargoDiscovery.ts:272-304 - discoverCargoFeatures extracts [features] section from Cargo.toml
[^47]: smartDetection.ts:390 - Undeclared features detected from #[cfg(feature = "name")] attributes in source code
[^48]: cargoTreeProvider.ts:1540-1545 - viewFeatureUsage command opens file/line where #[cfg(feature)] is used
[^49]: commands.ts:3141-3148 - addFeature inserts new feature definition in [features] section of Cargo.toml
[^50]: commands.ts:3016-3064 - toggleFeature adds --features flag to cargo commands for selected features
[^51]: cargoTreeProvider.ts:989-1007 - Features category icon turns red when undeclared features detected

[^52]: cargoCommands.ts:86-89, 138-141, 228-231 - Release mode adds --release flag to all cargo commands
[^53]: types.ts:101-108 - Snapshot interface stores build configuration (mode, targets, features, args, env vars)
[^54]: commands.ts:2129-2142 - Snapshots automatically save/restore complete build state including workspace member selection
[^55]: rustEdition.ts:38-68 - changeEdition modifies edition field in [package] or [workspace.package] section
[^56]: rustEdition.ts:10-33 - getCurrentEdition reads edition from Cargo.toml (defaults to 2015 if not specified)
[^57]: rustEdition.ts:22-27 - Editions: 2015, 2018, 2021, 2024 (parsed from Cargo.toml)
[^58]: rustEdition.ts:13 - Edition stored in [package] for single crate, [workspace.package] for workspaces
[^59]: rustEdition.ts:31 - Edition picker shows current edition with confirmation prompt

[^60]: rustup.ts:85-128 - getRustVersion executes `rustc --version` to get active toolchain info
[^61]: rustup.ts:131-175 - getRustupToolchains executes `rustup toolchain list` to enumerate installed toolchains
[^62]: cargoDiscovery.ts:10-100 - discoverWorkspaceMembers parses [workspace.members] from root Cargo.toml
[^63]: cargoTreeProvider.ts:576-615 - Workspace member selection filters targets, features, and dependencies to selected member
[^64]: cargoTreeProvider.ts:1334-1387 - Workspace members show checkbox for build inclusion, star icon for currently selected member
[^65]: decorationProvider.ts:17-21, 33-37, 39-43 - Orange (charts.orange) for workspace categories, members, and project header

[^66]: cargoCommands.ts:317-354 - Custom commands execute with current snapshot configuration (mode, targets, features, args, env vars)
[^67]: cargoCommands.ts:241-278 - Arguments and environment variables applied to all cargo commands
[^68]: defaultConfig.ts:129-169 - ArgumentCategory groups related CLI arguments for organization
[^69]: cargoCommands.ts:46-89, 409-430 - Shortcuts work with both binary and library targets; auto-select src/main.rs or src/lib.rs if none checked
[^70]: package.json:1246 - Cmd+Shift+B (Mac) / Ctrl+Shift+B (Win/Linux) triggers cargo build
[^71]: package.json:1251 - Cmd+Shift+R (Mac) / Ctrl+Shift+R (Win/Linux) triggers cargo run
[^72]: package.json:1291 - Cmd+Shift+T (Mac) / Ctrl+Shift+T (Win/Linux) triggers cargo test

[^73]: cargoCommands.ts:46-89 - Build command constructs cargo args from checked targets, features, mode, args, and env vars
[^74]: cargoCommands.ts:59-68 - Target-specific builds use --bin, --lib, --example, --test, --bench flags
[^75]: cargoCommands.ts:241-278 - Watch mode executes cargo-watch with specified action (check/build/test/run)

[^76]: cargoTreeProvider.ts:828, 877-878, 897, 921, 949-950, 991-992, 1017, 1045, 1062 - Category names: WORKSPACE MEMBERS, MODULES, DEPENDENCIES, SNAPSHOTS (with active name), Targets (title case), Features (title case), Arguments (title case), Environment Variables (title case), CUSTOM COMMANDS
[^77]: cargoTreeProvider.ts:1724-1738 - Unknowns folder displays count in label, colored red, contains unregistered target files
[^78]: defaultConfig.ts:1-247 - Configuration settings auto-initialize in .vscode/settings.json with empty arrays for arguments, environmentVariables, snapshots, and customCommands
