# Installing cargUI v1.0.0

## From VSIX File

1. Open VS Code
2. Go to Extensions panel (`Cmd+Shift+X` on macOS, `Ctrl+Shift+X` on Windows/Linux)
3. Click the `...` menu at the top of the Extensions panel
4. Select "Install from VSIX..."
5. Navigate to and select `cargUI-1.0.0.vsix`
6. Reload VS Code when prompted

## Verify Installation

1. Open any Rust project with a `Cargo.toml`
2. Look for the "Cargo" tree view in the Explorer sidebar
3. You should see:
   - Mode: Debug
   - Watch: Inactive
   - Edition: (your edition)
   - All your targets, features, etc.

## Quick Test

1. Check any target (e.g., "main")
2. Click the **Build** button at the bottom
3. Terminal should open and run: `cargo build --bin main`

If you see the build running, you're all set! 🎉

## Uninstalling

1. Go to Extensions panel
2. Find "cargUI" in your installed extensions
3. Click the gear icon → Uninstall

## Marketplace Publishing (Optional)

To publish to VS Code Marketplace:

```bash
# Get a publisher token from: https://dev.azure.com/
vsce publish -p YOUR_TOKEN

# Or publish manually by uploading the VSIX at:
# https://marketplace.visualstudio.com/manage
```

## Features

See [README.md](README.md) for complete feature documentation.

---

**Made with ❤️ for the Rust community**
