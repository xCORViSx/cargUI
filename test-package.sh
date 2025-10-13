#!/bin/bash

# cargUI v1.0.0 Installation Test Script
# This script verifies the VSIX package is installable

set -e

echo "🔍 Testing cargUI v1.0.0 Package"
echo "================================"
echo ""

# Check if VSIX exists
if [ ! -f "cargUI-1.0.0.vsix" ]; then
    echo "❌ ERROR: cargUI-1.0.0.vsix not found!"
    exit 1
fi

echo "✅ Package found: cargUI-1.0.0.vsix"

# Check package size
SIZE=$(ls -lh cargUI-1.0.0.vsix | awk '{print $5}')
echo "📦 Package size: $SIZE"

# Verify it's a valid zip file (VSIX is a zip)
if unzip -t cargUI-1.0.0.vsix > /dev/null 2>&1; then
    echo "✅ Package structure valid (zip format)"
else
    echo "❌ ERROR: Invalid package structure!"
    exit 1
fi

# Check for required files in package
echo ""
echo "📂 Checking package contents..."

REQUIRED_FILES=(
    "extension/package.json"
    "extension/README.md"
    "extension/out/extension.js"
    "extension/out/cargoTreeProvider.js"
    "extension/out/rustEdition.js"
)

for file in "${REQUIRED_FILES[@]}"; do
    if unzip -l cargUI-1.0.0.vsix | grep -q "$file"; then
        echo "  ✅ $file"
    else
        echo "  ❌ Missing: $file"
        exit 1
    fi
done

echo ""
echo "🎉 Package validation complete!"
echo ""
echo "📋 To install:"
echo "  1. Open VS Code"
echo "  2. Go to Extensions (Cmd+Shift+X)"
echo "  3. Click ... menu → Install from VSIX"
echo "  4. Select cargUI-1.0.0.vsix"
echo ""
echo "🚀 Ready for release!"
