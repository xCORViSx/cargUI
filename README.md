# cargUI - The Complete Rust Development Interface

**A comprehensive extension that transforms your Rust development workflow.** cargUI provides a unified visual interface for Cargo, Rustup, package organization, and code analysis—all accessible from your sidebar.

Works seamlessly in **VS Code** and **Cursor**!

[![VS Code Marketplace](https://img.shields.io/vscode-marketplace/v/xCORViSx.cargui.svg?label=VS%20Code%20Marketplace&logo=visual-studio-code)](https://marketplace.visualstudio.com/items?itemName=xCORViSx.cargui)
[![Installs](https://img.shields.io/vscode-marketplace/i/xCORViSx.cargui.svg)](https://marketplace.visualstudio.com/items?itemName=xCORViSx.cargui)
[![Rating](https://img.shields.io/vscode-marketplace/r/xCORViSx.cargui.svg)](https://marketplace.visualstudio.com/items?itemName=xCORViSx.cargui)
[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

---

## 🎯 What is cargUI?

cargUI is a **visual Rust development companion** covering:

- [^1]**🎨 Package organization** - Smart detection, visualization, and management of various Rust package elements
- [^2]**⚙️ Cargo integration** - Visual interface for all Cargo commands and features  
- [^3]**🦀 Rust toolchain** - Rustup integration and toolchain management
- [^4]**📦 Workspace support** - Intelligent multi-crate workspace handling
- [^5]**🔍 Health indications** - for the stability and quality of modules and dependencies
- [^6]**📸 Configuration** - Snapshots for different development scenarios

### Why cargUI?

**Stop typing terminal commands.** Start working visually:

✅ **Click** to build, run, test with precise configurations  
✅ **See** package structure, modules, targets, and dependencies  
✅ **Detect** unregistered files and missing declarations automatically  
✅ **Switch** between development scenarios with snapshots  
✅ **Track** dependency versions and module health in real-time  
✅ **Manage** Rust toolchains without memorizing rustup commands  
✅ **Switch** between multiple package folders with one click  
✅ **Generate** AI-powered documentation for undocumented code

---

## 🚀 Quick Start

1. **Install** the extension from [VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=xCORViSx.cargui) or [Open VSX](https://open-vsx.org/extension/xCORViSx/cargUI)
2. **Open** any Rust package with `Cargo.toml`
3. **Find** the Cargo tree view in your Explorer sidebar
4. **Check** a target → Click **Build/Run/Test**

**Example:** Check "main" + "serde" feature → Click Run

```bash
→ cargo run --bin main --features serde
```

---

## ✨ Feature Overview

### 🏗️ Package Organization & Intelligence

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


**Module health calculation (v1.0.8+):**

- [^14]Counts individual code elements: functions, structs, enums, traits, types, constants, statics
- [^15]Checks each element for preceding `///` or `//!` doc comments
- **Module header (`//!`) counts as 1 item** (v1.2.0) - Now required for 100% health
- [^16]Shows percentage: "75% (6/8 elements)" in tooltip
- Element-based (not file-level) for accurate documentation tracking
- **Privateness has no bearing on health** (v1.1.2) - Color based solely on documentation percentage

**AI-Powered Documentation Improvement (v1.2.0):**

- ✨ **Sparkle button** on every module and target enables one-click documentation generation
- Automatically detects missing file headers (`//!`) and undocumented code elements
- Uses GitHub Copilot for AI-powered documentation generation (free tier supported)
- Smart context prioritization: GPT-4o analyzes most relevant files first (dependencies, same directory, related modules)
- Real-time progress indicator shows generation status
- Automatically inserts doc comments with proper indentation and refreshes tree view

**Module information:**

- Visibility: Private modules show **(priv)** indicator (v1.1.2)
- Documentation percentage with element counts
- Header status: Shows "📋 Has module header (//!)" or "Missing header (//!)" in tooltip (v1.2.0)
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
- Clear separation of concerns in multi-crate packages

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
- **Resolve button** (🔧) - Click wrench icon on yellow targets to auto-fix issues:
  - Moves file to correct directory for target type
  - Renames target in Cargo.toml to match filename
  - Fixes both issues simultaneously when present

**Color-coded display (v1.3.2):**

**Target text colors** show documentation health:


**Target icon colors** show validation status:

⚫ **Gray** - Auto-discovered (found in standard directory but not declared in Cargo.toml)  
🟡 **Bright Yellow** - Missing file (declared in Cargo.toml but file doesn't exist)

**Auto-discovered targets:**

- Targets in `examples/`, `tests/`, `benches/` without Cargo.toml entries display with gray icons
- Tooltip shows "💡 Not declared in Cargo.toml (auto-discovered)"
- Click **+** button to explicitly declare in Cargo.toml
- After declaration, icon returns to normal color and button disappears

**Missing file targets:**

- Targets declared in Cargo.toml but with non-existent files display with bright yellow icons and text
- Tooltip shows "⚠️ File does not exist (but declared in Cargo.toml)"
- Click **🔧 Resolve Missing File** button for two recovery options:
  - **Locate & Move Existing File**: Find the misplaced file (must match expected filename)
  - **Create New File**: Generate template with proper structure for target type
- After resolution, icon and text return to normal color

**Features:**

- Multi-select for batch builds
- Drag & drop to reclassify unknown targets
- One-click run/build/test/doc
- "Toggle All" for quick selection
- Library target support for `cargo build --lib`, `cargo test --lib`, `cargo doc --lib`

</details>

<details>
<summary><b>Multi-Root Workspace Support</b> - Manage multiple Rust packages simultaneously</summary>

**VS Code Multi-Root Workspaces:**

When you have multiple package folders open (File → Add Folder to Workspace), cargUI provides:

- **Folder selector button** on package header (folder icon)
- **Smart quick pick menu** showing workspaces sorted by last access
- **Automatic file explorer sync**: collapses previous folder, expands selected folder
- **Persistent selection**: remembers your choice across sessions
- **Access history**: intelligently sorts by usage (most recent first, current last)

**Usage:**

1. Add multiple Rust packages to your VS Code workspace
2. Click the folder icon on the package header
3. Select which package to view/build
4. Tree view updates to show selected package's targets, modules, dependencies
5. All commands execute in the context of the selected workspace

Perfect for monorepos, multi-package development, or comparing different Rust codebases!

</details>


<details>
<summary><b>Feature Flags</b> - Visual feature management</summary>


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


- Build mode (debug/release)
- Checked targets
- Checked features
- Arguments and environment variables
- Workspace context

**Auto-created snapshots:**

- Binary packages (with `src/main.rs`) → "main" snapshot
- Library packages (with `src/lib.rs`) → "lib" snapshot
- Mixed packages (both) → Both snapshots created
- Workspace packages → One per member

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
- **Workspace edition display**: Multi-crate workspaces show edition context
  - When viewing workspace root: "Workspace Edition: 2021"
  - When viewing specific member: "Edition: 2024 [WS: 2021]" (member edition + workspace edition)
  - Tooltip provides detailed edition information for both levels
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
<summary><b>Multi-Crate Workspaces</b> - Full support for complex packages</summary>


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
- Right-click package header (when member selected) → Same three options
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


```bash
RUST_BACKTRACE=1 RUST_LOG=debug cargo run
```

</details>

<details>
<summary><b>Custom Commands</b> - Save frequently-used cargo commands</summary>


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


### Multi-Crate Workspace

```text
1. Click "api" label (set context)
2. Check "api" + "shared" checkboxes
3. Enable features
4. Click Build
```


### Testing with Logging

```text
1. Check test: "integration_tests"
2. Add env var: RUST_LOG=debug
3. Check the env var
4. Click Test
```


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


## 🔧 Configuration


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
A: Open a Rust package with `Cargo.toml`

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

### Package Structure

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

**Current:** v1.3.2  
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

