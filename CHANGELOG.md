# Changelog

All notable changes to the cargUI extension will be documented in this file.

## [1.1.2] - 2025-11-21

### 🔧 Module Declaration & Context Value Fix

**Fixed:**

- **TreeItem contextValue not being set** - Fixed critical bug where `contextValue` parameter in `CargoTreeItem` constructor was declared as `public readonly` but never explicitly assigned to `this.contextValue`, causing VS Code to not recognize context values for menu contributions
- **Module declaration buttons now appear** - Individual undeclared modules now display inline "Declare Module" button
- **Category-wide declaration button** - Modules category displays "Declare All Undeclared Modules" inline button when undeclared modules exist

**Changed:**

- **Module health ignores privateness** - Module health color (blue/green) now based solely on documentation percentage (0-50% no color, 50-90% blue, 90-100% green)
- **Visibility indicators inverted** - Private modules now show "(priv)" indicator; public modules have no indicator (since public is more common)
- **Multi-member workspace support** - "Declare All" command now processes all workspace members when no specific member selected, matching the module counting logic used for the category icon

**Technical:**

- Changed `CargoTreeItem` constructor parameter from `public readonly contextValue: string` to `contextValue: string` and added explicit `this.contextValue = contextValue` assignment (treeItems.ts:46-50)
- Added `UndeclaredModule = 'undeclaredModule'` to `TreeItemContext` enum (types.ts:30)
- Modified `buildModuleTree` to set `contextValue` conditionally based on `mod.isDeclared` (moduleDetection.ts:364)
- Updated `declareAllUndeclaredModules` command to iterate through all workspace members when applicable (commands.ts:3234-3350)
- Removed `resourceScheme` requirement from modules category inline button when clause (package.json:1175)

---

## [1.1.1] - 2025-11-21

### 🔧 Modules Notification Fix

**Fixed:**

- **Modules notifications now appear at workspace root** - Previously, the notification system wouldn't trigger on initial extension load because `refresh()` was never called automatically during activation
- **Manual refresh on activation** - Added explicit `cargoTreeProvider.refresh()` call immediately after workspace context initialization
- **File watcher pattern enhanced** - Changed Cargo.toml watcher from single-file to workspace-wide pattern ('**/Cargo.toml')
- **Proper initialization sequence** - Smart detection now runs automatically when extension activates, ensuring undeclared module notifications appear on first load

**Technical:**

- Added `cargoTreeProvider.refresh()` in extension.ts after `setWorkspaceContext()` call
- File watchers now supplement initial refresh instead of being the sole trigger
- Smart detection properly debounced with 2-second timeout
- Early return guards prevent execution before workspace context is set

---

## [1.1.0] - 2025-11-21

### ✨ Feature Declaration, Target Validation & Auto-Format

**Added:**

- **Inline button for declaring all undeclared features** - Features category displays third inline button when undeclared features exist
- **Inline button for registering all unknown targets** - Unknowns folder displays inline button for batch registration
- **Batch target registration with quickpick UI** - Register all unknown targets interactively with progress indicator
- **Type-specific icons for undeclared targets** - Unknown targets display appropriate icons based on inferred type
- **Red coloring for Features category** - Icon turns red when undeclared features exist
- **Auto-format Cargo.toml after edits** - Automatically formats after declaring features/targets, managing dependencies
- **Format notifications with undo** - Shows notification after auto-format with "Undo" and "Disable" buttons
- **Context menus for undeclared features** - Right-click to declare individual or batch declare selected features
- **Comprehensive target validation** - All target types validate name-to-filename matching and directory correctness
- **Workspace member context menus** - Right-click members for "View main target", "View documentation", "View Cargo.toml"
- **Module documentation viewer** - "View documentation" builds and opens local docs at correct module path
- **Orange workspace indicators** - Project header and workspace category use orange for visual prominence
- **Itemized snapshot tooltips** - List all targets, features, arguments, env vars, and checked members

**Changed:**

- **Features visibility enhanced** - Features hidden when `selectedWorkspaceMember === 'all' || !selectedWorkspaceMember`
- **Target validation colors to yellow** - Distinguished from workspace-related orange
- **Feature click behavior** - Always opens code usage location, not Cargo.toml
- **Snapshot update logic** - Changed to filter+push to prevent duplicates

**Fixed:**

- **Duplicate command registration** - Removed duplicate `declareSelectedFeatures`
- **Feature detection with no member** - Undeclared features no longer show when 'all' or no member selected
- **Target path resolution** - Fixed in workspace members
- **Global commands with no targets** - Auto-select main target
- **Library target support** - Proper handling in global commands
- **Module documentation viewer** - Opens correct crate docs

---

## [1.0.8] - 2025-11-19

### ✨ Tree View Enhancement & Argument Improvements

**Project Header:**

- **Top-level project item** - Tree now displays project name and version at the very top (format: `ProjName (vX.Y.Z)`)
- **Auto-prefix arguments** - Arguments no longer require `--` prefix; automatically added when building commands
- **Fixed spacing** - Terminal commands now use `--arg` instead of `-- arg` format

**Technical:**

- Argument normalization: strips existing `--` prefix from input to prevent duplicates
- Updated command builder to map arguments: `checkedArgs.map(arg => '--${arg}')`
- Added `ProjectHeader` tree item context type

---

## [1.0.7] - 2025-11-10

### 🔧 Cursor-Specific Improvements

**UI Customization:**

- **Streamlined toolbar for Cursor** - Title bar now shows only essential buttons (New Project, Build, Run, Check, Fix) when running in Cursor
- **Full toolbar in VS Code** - VS Code users continue to see all buttons (Test, Clean, Fmt, Doc, Update, Format Cargo.toml, Keybindings)

---

## [1.0.6] - 2025-11-09

### ✨ Cross-Platform Support & Improvements

**Cross-Platform Support:**

- **Cursor compatibility** - cargUI now works seamlessly in both VS Code and Cursor with full feature parity
- **Version normalization** - Dependencies like `bitflags 2.10` now correctly show as latest when registry reports `2.10.0`

**Command Improvements:**

- **Bench command** - Added `cargo bench` to quick pick and command palette
- **Fix command** - Added `cargo fix` to quick pick for applying compiler suggestions
- **Streamlined quick pick** - Removed redundant commands from quick pick that are already in sidebar panel

**Fixed:**

- **Dependency version comparison** - Fixed green "latest version" indicator to treat `2.10` and `2.10.0` as equivalent

---

## [1.0.5] - 2025-10-21

### ✨ Workspace Improvements & Dependency Management

**Workspace Interaction:**

- **Clickable member deselection** - Workspace members can now be clicked again to deselect them (return to "all" view)
- **Context-aware module display** - When a workspace member is selected, MODULES category shows only that member's modules
- **Workspace member path display** - Non-root workspace members now show their relative directory path as description

**Dependency Visualization:**

- **Workspace-inherited dependency improvements**:
  - Dependencies inherited from workspace (`{ workspace = true }`) now show correct version numbers in member categories
  - Inherited dependencies display with yellow star (⭐) icons and are sorted to the top of their category lists
  - WORKSPACE category name displays with yellow star icon
  - Can still turn green when at latest version (latest takes priority over inherited coloring)
  - Tooltip shows "(from workspace)" for inherited dependencies

**Version Change Resilience:**

- **Selective reversion on failures** - When changing multiple dependency versions, only failed updates are reverted (successful ones persist)
- **Automatic duplicate resolution** - Removes duplicate/ambiguous dependency constraints before version changes
- **Lock file refresh** - Deletes `Cargo.lock` before version updates to ensure clean dependency resolution
- **Better error handling** - Clear feedback showing which dependencies succeeded vs failed

**Development:**

- **Simplified .gitignore** - Switched to whitelist approach (ignore everything, then explicitly include needed files)

**Fixed:**

- **Workspace member targets now open correctly** - Fixed path resolution when opening target files from workspace members
- **Workspace dependency clicking** - Clicking workspace dependencies now correctly opens root `Cargo.toml` at `[workspace.dependencies]` section
- **Module detection accuracy** - Fixed false positive detection of workspace member packages as modules
- **Edition feature now always updates workspace root** - No longer member-sensitive
- **Multi-dependency version updates** - Fixed `cargo update` with multiple precise versions

**Improved:**

- **Workspace member targets now open correctly** - Fixed path resolution when opening target files from workspace members
  - Tree items for workspace member targets now properly store the member name
  - Constructs correct absolute paths: `workspace_root + member_path + target_path`
  - All target types (binaries, libraries, examples, tests, benchmarks) now work in multi-crate workspaces

- **Edition feature now always updates workspace root** - No longer member-sensitive
  - Multi-crate workspaces always update `[workspace.package]` edition section
  - Single-crate projects update `[package]` edition section
  - Handles workspace inheritance properly with helpful UI guidance

- **Multi-dependency version updates** - Fixed `cargo update` with multiple precise versions
  - Now runs separate `cargo update -p <dep> --precise <version>` commands sequentially
  - Prevents "cannot use multiple times" Cargo error
  - Shows all commands in terminal for transparency

**Technical Details:**

- Added `workspaceMember` property to target tree items when created from workspace members
- Updated `viewBinaryTarget` command to properly construct absolute paths for member targets
- Edition feature detects and handles `[workspace.package]` sections correctly
- Multi-dependency updates execute commands sequentially with proper error tracking

---

## [1.0.4] - 2025-10-13

### 🔧 Edition Selection Fix

**Fixed:**

- **Edition change feature now works correctly in multi-crate workspaces** - Previously tried to update the workspace root's Cargo.toml instead of the selected member's Cargo.toml
- Edition display now shows the edition of the currently selected workspace member (not just the root)
- Added `getSelectedWorkspaceMember()` getter method to tree provider

**Technical Details:**

- The edition feature now checks for `selectedWorkspaceMember` and uses that member's path
- Properly handles both workspace members and single-crate projects
- Avoids variable redeclaration issues by reorganizing code flow

---

## [1.0.3] - 2025-10-13

### 📚 Documentation Update

**Updated:**

- README now fully documents library target support
- Added star icon (⭐) indicator documentation for primary targets
- Documented keyboard shortcut support for library-only crates
- Clarified auto-selection behavior for both `src/main.rs` and `src/lib.rs`
- Updated snapshots section to explain both binary and library snapshot creation

**Fixed:**

- Added `.DS_Store` to `.gitignore` to prevent publishing issues

---

## [1.0.1] - 2025-10-13

### ✨ Library Target Support

**Added:**

- **Full library target support** - Auto-detects `src/lib.rs` and `[lib]` sections in Cargo.toml
- **Keyboard shortcuts now work with library-only crates** - No more broken shortcuts in library projects!
- **Star icon (⭐) indicators** - Primary targets (`src/main.rs` and `src/lib.rs`) are marked with stars
- **Auto-selection fallback** - When no targets are checked, commands automatically use `src/lib.rs` if `src/main.rs` doesn't exist
- **Module counts** - MODULES category and all subcategories now show direct children counts
- **Submodule counts** - Module counts display at all nesting levels
- **View Member's Cargo.toml** - New context menu option for workspace members

**Improved:**

- **Optimized command generation** - Removed redundant `--bin` flags for `src/main.rs` (default binary target)
- **Library color coding** - `src/lib.rs` no longer shows blue warning (it's the default library path)
- **Selected member indicator** - Workspace members now show star icon (⭐) for currently selected member

**Fixed:**

- Duplicate library detection in workspace members
- Path resolution bug in "View Member's Cargo.toml" command

---

## [1.0.0] - 2025-10-13

### 🎉 Major Release - Feature Complete!

cargUI v1.0.0 is now production-ready with all planned features implemented.

**Added:**

**🎨 Project Organization:**

- Smart detection system for unregistered targets and undeclared features
- Module visualization with color-coded health indicators (🟢🔵🟡🟠)
- Dependency version tracking with real-time crates.io integration
- Automatic file organization to conventional directories
- Intelligent module filtering (no false positives)

**⚙️ Cargo Integration:**

- Complete visual interface for all Cargo commands
- Multi-crate workspace support with context switching
- Target color coding for health status
- Drag & drop target reclassification
- Auto-created default snapshots

**🦀 Rust Toolchain:**

- Rustup integration with toolchain display
- **Rust edition selector** - Fetches available editions from official Rust Edition Guide
- Automatic edition detection from Cargo.toml
- One-click edition switching with formatting preservation

**🔧 Configuration Management:**

- Hierarchical organization (categories and subcategories)
- Mixed organization (both categorized and uncategorized items)
- Inline action buttons (add, edit, delete)
- Click-to-view features and dependencies in Cargo.toml
- Snapshot system for different development scenarios

**⚡ Developer Experience:**

- Watch mode integration with cargo-watch
- Keyboard shortcuts for all major commands
- Environment variable management
- Custom command builder
- Program arguments with checkboxes

**Changed:**

- Bumped version to 1.0.0 to reflect production-ready status
- Updated README with comprehensive feature documentation
- Removed incomplete roadmap items that won't be implemented

**Technical Details:**

- TypeScript codebase with 19 modules
- Modular architecture with focused responsibilities
- TOML parsing with @iarna/toml
- Real-time API integration with crates.io and GitHub
- Comprehensive error handling and fallbacks

**Package Information:**

- Extension size: 1.76 MB
- 41 files included
- Compatible with VS Code ^1.85.0

---

## [0.2.2] - Previous Development Versions

**Added:**

- Hierarchical categories for arguments and custom commands
- Inline action buttons throughout the UI
- Enhanced tooltips and descriptions

**Fixed:**

- Various bug fixes and stability improvements

---

## [0.1.0] - Initial Release

**Added:**

- Basic target discovery and management
- Feature flag toggles
- Snapshots system
- Watch mode integration
- Custom commands support

---

**Made with ❤️ for the Rust community**
