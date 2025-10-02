# Cargui - Project Structure

## Overview
Rust-based GUI application for running Cargo commands with a custom Slint UI and Bronzier font.

## Directory Structure

```
Cargui/
├── assets/
│   └── Bronzier Rusty.otf     # Custom font file
├── src/
│   └── main.rs                 # Main application logic (706 lines)
├── ui/
│   └── app.slint               # Slint UI definition (384 lines)
├── build.rs                    # Build script to compile .slint file
├── Cargo.toml                  # Package manifest
└── README.md                   # Project documentation
```

## Key Files

### `/build.rs`
Simple build script that compiles the external Slint UI file.

```rust
fn main() {
    slint_build::compile("ui/app.slint").unwrap();
}
```

### `/Cargo.toml`
Dependencies:
- **Runtime**: `slint`, `anyhow`, `shell-words`, `rfd`
- **Build**: `slint-build`

### `/src/main.rs`
- Uses `slint::include_modules!()` to include compiled UI
- No inline `slint!` macro - keeps code clean
- Handles Cargo command execution, output streaming, and UI state

### `/ui/app.slint`
- Imports standard widgets and custom Bronzier font
- Exports `CommandEntry` struct for Rust integration
- Defines `CommandButton`, `ReleaseSwitch`, and `AppWindow` components
- Custom font applied to "cargUI" title with `font-family: "Bronzier"`

## Font Integration

The Bronzier font is loaded using Slint's import mechanism:

```slint
import "../assets/Bronzier Rusty.otf";
```

And applied to UI elements:

```slint
Text {
    text: "cargUI";
    font-family: "Bronzier";  // Note: Use "Bronzier" not "Bronzier Rusty"
}
```

The font is automatically:
1. Embedded via `include_bytes!` during build
2. Registered via `register_font_from_memory()` at runtime
3. Available by its family name "Bronzier"

## Build & Run

```bash
# Development build
cargo build
cargo run

# Release build
cargo build --release
cargo run --release
```

## Window Specifications
- Size: 400×500px (fixed)
- Custom orange/brown color scheme
- Custom Bronzier font on title
- Responsive button states with animations
