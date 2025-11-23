# Changelog

All notable changes to the cargUI extension will be documented in this file.

## [1.3.3] - 2025-11-23

### Changed

- **Cleaner Tree View Tooltips**: Removed extraneous tooltip text from tree view headers
  - Workspace root package header: No longer shows "Selected Workspace Member" suffix
  - Workspace Members category: No longer shows redundant tooltip on hover
  
- **Improved Validation Messages**: Target validation tooltips now provide more specific, actionable error details
  - Format changed from "entry" to "declaration" for accurate terminology
  - Combined validation issues: Shows both name mismatch AND wrong directory when both exist
  - Messages restructured as proper sentences with shared "INVALID Cargo.toml declaration:" prefix
  - Directory types pluralized (examples/, tests/, benches/, bins/) for accuracy

### Fixed

- **Package Folder Terminology**: Standardized "workspace folder" → "package folder" throughout folder switching feature
  - Command title: "Select Workspace Folder" → "Select Package Folder"
  - Notification messages now use "package folder"
  - Quick pick placeholder updated for consistency

### Documentation

- **README Cleanup**: Removed all footnote references and footnote definitions section
  - Reduced file size from 951 to 837 lines
  - Cleaner reading experience without reference markers
  
- **Agent Documentation**: Added comprehensive guides for project development
  - Created specialized .agent.md files for testing, debugging, refactoring, and release management
  - Updated AGENTS.md with edit history format guide and essential workspace contents
  - Documented one-date-per-header rule for edit history files

### Added

- **Auto-Discovered Target Visual Indicators**: Targets found in standard directories but not declared in Cargo.toml now have distinct visual styling
  - Auto-discovered targets display with **bright black (gray)** icons to distinguish them from declared targets
  - New inline **declare button** (+) appears on auto-discovered targets to add them to Cargo.toml
  - Tooltip indicator "💡 Not declared in Cargo.toml (auto-discovered)" explains the gray icon
  - After clicking declare button, target is added to Cargo.toml and styling returns to normal
  - Applies to examples, tests, and benchmarks in their standard directories (examples/, tests/, benches/)

- **Missing File Detection**: Targets declared in Cargo.toml but with missing files now have error indicators
  - Missing file targets display with **bright yellow** icons and text for maximum visibility
  - Tooltip shows "⚠️ File does not exist (but declared in Cargo.toml)" to clarify the issue
  - Inline **Resolve Missing File** button (🔧) provides two recovery options via quick pick menu:
    - **Locate & Move Existing File**: Opens file picker to find the missing file (must match expected filename)
    - **Create New File**: Generates appropriate template based on target type (bin, lib, example, test, bench)
  - File picker validates filename matches expected name before moving
  - Created files include target-specific templates with proper //! headers and basic code structure
  - Tree automatically refreshes after resolution

- **Workspace Edition Display**: Multi-crate workspaces now show edition information more clearly
  - When viewing workspace root (no member selected): displays "Workspace Edition: XXXX"
  - When viewing specific member: displays "Edition: XXXX [WS: YYYY]" showing both member and workspace editions
  - Tooltip provides detailed edition information
  - Helps distinguish between workspace-level and member-level edition configuration

### Changed

- **Auto-Discovered Targets No Longer Appear in Unknowns**: Files in examples/, tests/, and benches/ directories are legitimate targets via Cargo's implicit discovery rules
  - Removed from unknown detection to prevent duplication (appearing in both proper category and Unknowns folder)
  - Only truly unknown files (outside standard directories and not in Cargo.toml) appear in Unknowns

- **Visual Separators**: Tree view separators now use empty labels instead of Unicode characters
  - Creates cleaner visual spacing between main sections and configuration group
  - Improved readability and less visual clutter

### Technical

- Added `autoDiscovered?: boolean` property to `CargoTarget` interface (types.ts:60)
- cargoDiscovery.ts marks auto-discovered targets with flag (lines 221, 268, 322)
- smartDetection.ts skips examples/, tests/, benches/ directories in unknown detection (lines 145-187)
- cargoTreeProvider.ts applies bright black icon color when `target.autoDiscovered` is true (line 2028)
- New `target-autodiscovered` contextValue enables conditional declare button (cargoTreeProvider.ts:1948)
- `cargui.declareAutoDiscoveredTarget` command adds target to Cargo.toml (commands.ts:1114-1201)
- Icon color uses `terminal.ansiBrightBlack` theme color for consistent gray appearance across themes
- File existence check added to getTargetStatus using fs.existsSync() (cargoTreeProvider.ts:1785-1788)
- Missing files return `terminal.ansiBrightYellow` color with detailed tooltip
- New `target-missing` contextValue for conditional resolve button display (cargoTreeProvider.ts:1953)
- `cargui.resolveMissingTargetFile` command shows quick pick menu with locate/create options (commands.ts:1207-1320)
- Locate option validates selected filename matches expected name before moving
- Create option generates templates: bin (main function), lib (empty), example (main), test (#[test]), bench (criterion setup)
- Modified `getCurrentEdition` in rustEdition.ts to return both member and workspace editions as object
- Edition display logic in cargoTreeProvider.ts checks `selectedWorkspaceMember` state (lines 820-858)
- Updated `selectEdition` and `changeEdition` command to work with new edition object structure
- Tree separators changed from Unicode characters to empty string labels (cargoTreeProvider.ts:947, 1099)
- Added `cargui.selectWorkspaceFolder` command registration in commands.ts for multi-root workspace switching

---

## [1.3.1] - 2025-11-22

### Changed

- **Target Display Color Schemes**: Swapped icon and text coloring logic for better visual hierarchy
  - Target **text color** now shows documentation health (green for 90-100%, blue for 50-90%, default for <50%)
  - Target **icon color** now shows validation status (yellow for wrong location, red for unknown path, purple for custom location)
  - Target **description** now shows documentation health percentage instead of file path
  - Makes health status more prominent while keeping validation warnings visible through icons

- **Custom Location Indicators**: Changed from magenta to purple with improved visual feedback
  - Custom location targets now use purple (`charts.purple`) icon color
  - Tooltip shows 🟪 (purple square) emoji for custom locations
  - Warning triangle (⚠️) only appears for yellow validation issues (name mismatch, wrong directory)
  - Purple and red status messages display without warning triangle for cleaner tooltips

- **Workspace Dependency Coloring**: Orange theme extended to all workspace-related dependencies
  - Workspace dependencies (in WORKSPACE category) display with orange icons
  - Inherited dependencies (workspace stars in Production/Dev/Build categories) also use orange icons
  - Consistent orange coloring across all workspace-related items

### Added

- **Dependency Section Navigation**: New context menu option "View in Cargo.toml" for dependency subcategories
  - WORKSPACE subcategory opens `[workspace.dependencies]` section
  - Production subcategory opens `[dependencies]` section
  - Dev subcategory opens `[dev-dependencies]` section
  - Build subcategory opens `[build-dependencies]` section
  - Automatically navigates to correct Cargo.toml (root for workspace deps, member-specific for others)

- **Auto-Fix Validation Issues**: New resolve button for targets with yellow validation warnings
  - Inline wrench icon (🔧) button appears only on targets with yellow validation status
  - Automatically fixes name mismatch issues by renaming target in Cargo.toml to match filename
  - Automatically fixes wrong directory issues by moving file to standard location for target type
  - Prioritizes directory fixes over name fixes (directory location is more critical)
  - Shows success notification indicating which action was taken
  - Accessible via `cargui.resolveTargetValidation` command

### Fixed

- **Workspace Member Selection**: Clicking workspace members now properly refreshes tree after switching workspace folders
  - `setSelectedWorkspaceMember()` now triggers tree refresh
  - Ensures member targets, modules, and dependencies display correctly after folder switch

### Technical

- Modified `cargoTreeProvider.ts` target rendering (lines 1950-1958) to apply health colors via `decorationProvider` (text) and validation colors via `ThemeIcon` (icon)
- Changed custom location color from `terminal.ansiBrightMagenta` to `charts.purple` (lines 1797, 1883)
- Updated tooltip prefix logic to conditionally show ⚠️ only for `charts.yellow` validation issues
- Target description now calculates and displays health percentage string
- Workspace dependencies receive orange `ThemeColor` during icon creation
- Inherited dependencies (star icons) also receive orange coloring in all categories
- Added `viewDependencySectionInCargoToml` command with section detection logic
- Added context menu entries in package.json for dependency subcategories
- Fixed `setSelectedWorkspaceMember()` to call `refresh()` for immediate tree update
- Added `cargui-target-yellow` resourceUri scheme for conditional resolve button visibility (lines 1967-1969)
- Implemented `resolveTargetValidation` command in commands.ts (lines 1021-1127)
- Command analyzes validation issue type and executes appropriate fix (rename or relocate)
- Inline button configured in package.json with `resourceScheme == cargui-target-yellow` condition
- Added toml and CargoManifest imports to commands.ts for Cargo.toml manipulation

## [1.3.0] - 2025-11-22

### Added

- **Multi-Root Workspace Support**: Full support for VS Code multi-root workspaces with multiple Rust packages
  - Workspace folder selector button on package header (folder icon)
  - Quick pick menu with intelligent sorting (last accessed first, current last)
  - Automatic file explorer integration: collapses previous folder, expands new folder
  - Persistent workspace folder selection across sessions
  - Access history tracking (last 10 workspaces)
  - Context-aware: button only appears when multiple workspace folders exist

### Changed

- **Undeclared Feature Context Menu**: Renamed "View Feature in Cargo.toml" to "View Cargo.toml" for undeclared features
  - Opens Cargo.toml at `[features]` section instead of showing "not found" error
  - Separate command for declared features (shows exact line) vs undeclared (shows section)
  - More intuitive workflow for adding new features

- **Custom Location Target Color**: Changed from blue to bright magenta (`terminal.ansiBrightMagenta`)
  - More visually distinct from health indicators
  - Easier to spot non-standard target locations

### Technical

- Added workspace folder selection UI to package header with inline button
- Context variable `cargui.hasMultipleWorkspaceFolders` controls button visibility
- `workspaceState` stores selected folder index and access history
- `selectWorkspaceFolder()` function updates tree provider context
- Explorer integration via `revealInExplorer`, `list.collapse`, `list.expand` commands
- Smart sorting algorithm: access history first, current folder last
- Fixed `getChildren()` to use `this.workspaceFolder` instead of hardcoded `[0]`
- Added `viewCargoToml` command for undeclared features
- Modified `viewFeatureInCargoToml` to open file at `[features]` section when not found
- Changed custom location color from `charts.blue` to `terminal.ansiBrightMagenta`

## [1.2.0] - 2025-11-22

### Added

- **AI-Powered Documentation Improvement**: New sparkle button ($(sparkle)) on all module items enables one-click documentation generation
  - Automatically detects missing module headers (`//!`) and undocumented code elements
  - Generates contextual documentation using GPT-4o language model
  - Scans for undocumented functions, structs, enums, traits, type aliases, constants, and statics
  - Real-time progress indicator shows task completion status
  - Automatically inserts generated doc comments with proper indentation
  - Refreshes tree view and opens file to display changes

- **Module Header Health Criterion**: Module health calculation now includes module header (`//!`) as required documentation
  - Header counts as 1 item in total documentation count
  - Formula: (hasHeader ? 1 : 0) + documentedElements / (1 + totalElements) * 100
  - Tooltips show header status: "📋 Has module header (//!)" or "Missing header (//!)"
  - More accurate representation of module documentation completeness
  - Affects health percentage and color thresholds (green: 90-100%, blue: 50-90%)

- **Smart Context Prioritization**: AI receives relevancy-weighted codebase context for accurate documentation
  - Parses current file's `use` statements to identify direct dependencies
  - Assigns relevancy scores to all .rs files based on relationship to current module:
    - 1000: Current file being documented
    - 900: Files directly imported via `use` statements
    - 850: Files that import/reference current file
    - 700: Files in same directory
    - 600: Files with similar names (related modules)
    - 500: `mod.rs` files (module definitions)
    - 450: `lib.rs`/`main.rs` (entry points)
    - 100: All other files
  - Sorts files by relevancy score and includes up to 100KB (~25K tokens)
  - Ensures AI sees most relevant context first while staying within token budget
  - Each file labeled with relative path and relevancy score

- **Full Codebase Context**: AI has comprehensive project understanding when generating documentation
  - Recursively scans all `.rs` files in `src/` directory
  - Respects workspace member boundaries
  - Skips `target/`, `node_modules/`, `.git/` directories
  - Up to 100KB of prioritized code included in AI prompts
  - Leaves ~100K tokens available for AI responses

### Changed

- **Module Health Calculation**: Now includes header as required documentation item
  - Previous: Only counted code elements (functions, structs, etc.)
  - New: Counts header + code elements
  - Example: Module with 5 functions (3 documented) + no header = 3/6 items = 50%
  - Example: Same module with header = 4/6 = 66%, all documented = 6/6 = 100%

- **Module Tooltips**: Enhanced with header status and detailed documentation breakdown
  - Shows header presence: "📋 Has module header (//!)" or "Missing header (//!)"
  - Documentation stats format: "X/Y items (Z%)"
  - Element breakdown shows: "- Elements: X/Y"

### Technical

- Added `hasHeader` property to `ModuleInfo` interface
- Updated `analyzeModuleFile()` to detect `//!` comments at file start
- Modified `calculateModuleHealth()` to include header in total/documented counts
- Added `improveModuleDocumentation` command handler in commands.ts
- Integrated VS Code Language Model API (`vscode.lm.selectChatModels`)
- Uses GPT-4o model family for documentation generation
- Context gathering: recursive file scanning with depth limit of 5
- Relevancy scoring: dependency graph analysis + directory proximity
- Use statement parsing with regex: `/^use\s+(?:crate::)?([^:;{]+)/gm`
- Buffer size calculation for 100KB limit enforcement
- Progress reporting with increment calculation
- Prompt engineering: separate prompts for headers vs elements

## [1.1.7] - 2025-11-22

### 🔧 Single-Crate Package Compatibility

**Fixed:**

- **Registration system for single-crate packages** - Unknown targets now register correctly in packages without workspace members
  - Fixed \"Member not found\" errors when `memberName` set but no workspace exists
  - `applyCargoTomlChanges` now treats unfound members as root when `workspaceMembers.length === 0`
  
- **File moving operations** - Moving targets to standard locations (src/bin/, examples/, tests/, benches/) now works in single-crate packages
  - Fixed `moveTargetToStandardLocation` to handle member lookup failures
  
- **Target reassignment** - Converting target types (bin ↔ example ↔ test ↔ bench) now works in single-crate packages
  - Fixed `reassignTargetType` member lookup fallback
  
- **Smart detection file preview** - Hovering over unregistered targets in detection UI now opens correct files
  - Fixed `smartDetectionUI.ts` to lookup member path from `memberName` instead of using it directly as path
  - Previously failed because `memberName` is package name, not a file path

**Technical:**

- Root cause: `smartDetection.ts` sets `memberName = manifest.package?.name` for all packages
- Single-crate: `discoverWorkspaceMembers()` returns empty array → lookup fails
- Solution: Check `workspaceMembers.length === 0` and treat unfound members as root package
- Applied pattern across 5 functions: `applyCargoTomlChanges`, `moveTargetToStandardLocation`, `reassignTargetType`, `registerUnknownTarget` file moving, and both file opening paths in `smartDetectionUI`
- Added debug logging to all affected functions

---

## [1.1.6] - 2025-11-22

### ✨ Module Visibility & Declaration Navigation

**Added:**

- **Toggle module visibility button** - Inline eye icon button on declared modules to toggle between public (`pub mod`) and private (`mod`)
- Shows notification confirming new visibility state after toggle
- Works with both root-level modules (declared in main.rs/lib.rs) and nested submodules (declared in parent mod.rs)
- Correctly handles directory modules (e.g., `cpu/mod.rs`) as root-level, not nested

**Changed:**

- **"View declaration" context menu** - Renamed from "View main target" to clarify it navigates to module's `mod` declaration line
- **Smart declaration file detection** - "View declaration" now correctly opens the actual parent file containing the module declaration:
  - Root modules → opens main.rs or lib.rs
  - Nested submodules → opens parent module's mod.rs file
  - Example: `database/queries.rs` opens `database/mod.rs` and navigates to `mod queries;` line

**Fixed:**

- **Submodule declaration routing** - Fixed `declareModule` command to correctly target parent mod.rs files for nested submodules instead of always using main.rs/lib.rs
- **Directory module detection** - Fixed algorithm to treat `modulename/mod.rs` as root-level (not nested) when determining declaration file

**Removed:**

- **Directory descriptor from modules** - Removed `(dir)` label from module descriptions; now only show child count, privacy indicator, and health percentage

**Technical:**

- Added `cargui.toggleModuleVisibility` command with eye icon
- Inline button appears on all declared modules (`viewItem == module`)
- Toggle logic uses same path analysis as `declareModule` to find correct parent file
- Root-level detection: `pathParts.length === 1 || (pathParts.length === 2 && pathParts[1] === 'mod.rs')`
- Module name normalization removes both `.rs` extension and `/mod` suffix
- Updated `viewInMainTarget` command to use hierarchical path detection instead of always opening main.rs/lib.rs

---

## [1.1.5] - 2025-11-21

### 📝 Documentation Update

**Changed:**

- Added Open VSX Registry links alongside VS Code Marketplace references in README

---

## [1.1.4] - 2025-11-21

### 📝 Documentation Update

**Changed:**

- Updated README.md with user edits

---

## [1.1.3] - 2025-11-21

### 🔧 Undeclared Module Text Color Fix

**Fixed:**

- **Undeclared module text color restored** - Added `cargui-undeclared-module` scheme to decoration provider so text appears red again (not just icon)

**Technical:**

- Updated `decorationProvider.ts:46` to include `cargui-undeclared-module` scheme in color decoration check

---

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
- **Orange workspace indicators** - Package header and workspace category use orange for visual prominence
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

**Package Header:**

- **Top-level package item** - Tree now displays package name and version at the very top (format: `PkgName (vX.Y.Z)`)
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

- **Streamlined toolbar for Cursor** - Title bar now shows only essential buttons (New Package, Build, Run, Check, Fix) when running in Cursor
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
  - Single-crate packages update `[package]` edition section
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
- Properly handles both workspace members and single-crate packages
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
- **Keyboard shortcuts now work with library-only crates** - No more broken shortcuts in library packages!
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

**🎨 Package Organization:**

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
