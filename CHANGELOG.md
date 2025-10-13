# Changelog

All notable changes to the cargUI extension will be documented in this file.

## [1.0.2] - 2025-10-13

### 📚 Documentation Update

**Updated:**
- README now fully documents library target support
- Added star icon (⭐) indicator documentation for primary targets
- Documented keyboard shortcut support for library-only crates
- Clarified auto-selection behavior for both `src/main.rs` and `src/lib.rs`
- Updated snapshots section to explain both binary and library snapshot creation

### Fixed
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

### Added

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

### Changed
- Bumped version to 1.0.0 to reflect production-ready status
- Updated README with comprehensive feature documentation
- Removed incomplete roadmap items that won't be implemented

### Technical Details
- TypeScript codebase with 19 modules
- Modular architecture with focused responsibilities
- TOML parsing with @iarna/toml
- Real-time API integration with crates.io and GitHub
- Comprehensive error handling and fallbacks

### Package Information
- Extension size: 1.76 MB
- 41 files included
- Compatible with VS Code ^1.85.0

---

## [0.2.2] - Previous Development Versions

### Added
- Hierarchical categories for arguments and custom commands
- Inline action buttons throughout the UI
- Enhanced tooltips and descriptions

### Fixed
- Various bug fixes and stability improvements

---

## [0.1.0] - Initial Release

### Added
- Basic target discovery and management
- Feature flag toggles
- Snapshots system
- Watch mode integration
- Custom commands support

---

**Made with ❤️ for the Rust community**
