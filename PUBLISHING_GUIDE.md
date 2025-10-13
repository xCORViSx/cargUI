# 🚀 GitHub & VS Code Marketplace Publishing Guide

## 📋 Prerequisites Checklist

Before publishing, you need:
- [ ] GitHub account
- [ ] VS Code Marketplace publisher account
- [ ] Azure DevOps Personal Access Token (PAT)

---

## Part 1: Push to GitHub (5 minutes)

### Step 1: Create GitHub Repository

1. Go to https://github.com/new
2. Repository name: `cargui`
3. Description: `Native VS Code UI for cargo commands`
4. **Keep it Public** (for open source)
5. **DO NOT** initialize with README (you already have one)
6. Click "Create repository"

### Step 2: Update package.json with Your GitHub Username

Replace `YOUR_USERNAME` in `package.json` with your actual GitHub username:
```json
"repository": {
  "type": "git",
  "url": "https://github.com/YOUR_USERNAME/cargui.git"
},
"bugs": {
  "url": "https://github.com/YOUR_USERNAME/cargui/issues"
},
"homepage": "https://github.com/YOUR_USERNAME/cargui#readme",
```

Also update CONTRIBUTING.md with your GitHub username.

### Step 3: Push to GitHub

```bash
# Add GitHub as remote (replace YOUR_USERNAME)
git remote add origin https://github.com/YOUR_USERNAME/cargui.git

# Push your code
git push -u origin master
```

✅ Your code is now on GitHub!

---

## Part 2: Publish to VS Code Marketplace (10 minutes)

### Step 1: Create Publisher Account

1. Go to https://marketplace.visualstudio.com/manage
2. Sign in with Microsoft account
3. Click "Create publisher"
4. Choose a unique Publisher ID (e.g., "xCORViSx" or your name)
5. Fill in display name and description

### Step 2: Get Azure DevOps Personal Access Token

1. Go to https://dev.azure.com/
2. Click on your profile (top right) → "Personal access tokens"
3. Click "New Token"
4. Settings:
   - **Name**: "VS Code Extension Publishing"
   - **Organization**: All accessible organizations
   - **Expiration**: 90 days (or custom)
   - **Scopes**: Click "Show all scopes" → Check "Marketplace" → Select "Manage"
5. Click "Create"
6. **IMPORTANT**: Copy the token and save it securely (you won't see it again!)

### Step 3: Install vsce (Publishing Tool)

```bash
npm install -g @vscode/vsce
```

### Step 4: Login with vsce

```bash
vsce login YOUR_PUBLISHER_ID
# Paste your Azure DevOps PAT when prompted
```

### Step 5: Publish!

```bash
# First time publish
vsce publish

# Or publish with version bump
vsce publish patch   # 0.2.0 → 0.2.1
vsce publish minor   # 0.2.0 → 0.3.0
vsce publish major   # 0.2.0 → 1.0.0
```

✅ Your extension is now live on the VS Code Marketplace!

---

## Part 3: Ongoing Development Workflow

### Daily Development (As You're Doing Now)
```bash
# 1. Make changes to TypeScript files
# 2. Test locally
npm run compile
# Press F5 to test in Extension Development Host

# 3. Commit when ready
git add .
git commit -m "feat: add new feature"
git push

# 4. Publish update when ready
vsce publish patch
```

### Quick Reference Commands

```bash
# Update with automatic version bump
vsce publish patch      # Bug fixes
vsce publish minor      # New features
vsce publish major      # Breaking changes

# Or bump version manually first
npm version patch
vsce publish

# Publish pre-release (beta)
vsce publish --pre-release

# Package without publishing (for testing)
vsce package
```

---

## 📊 After Publishing

### Monitor Your Extension

1. **Marketplace Page**: https://marketplace.visualstudio.com/items?itemName=YOUR_PUBLISHER_ID.cargui
2. **GitHub Insights**: Check stars, issues, PRs
3. **Download Stats**: Available in marketplace dashboard

### Enable GitHub Features

Set up in your GitHub repo settings:
- **Issues**: Enable for bug reports
- **Discussions**: Enable for community Q&A
- **Topics**: Add tags like `vscode-extension`, `rust`, `cargo`, `gui`
- **Description**: Add your extension description

---

## 🎯 Marketing Tips

1. **Add Badges to README**:
```markdown
[![VS Code Marketplace](https://img.shields.io/vscode-marketplace/v/YOUR_PUBLISHER_ID.cargui.svg)](https://marketplace.visualstudio.com/items?itemName=YOUR_PUBLISHER_ID.cargui)
[![Installs](https://img.shields.io/vscode-marketplace/i/YOUR_PUBLISHER_ID.cargui.svg)](https://marketplace.visualstudio.com/items?itemName=YOUR_PUBLISHER_ID.cargui)
[![Rating](https://img.shields.io/vscode-marketplace/r/YOUR_PUBLISHER_ID.cargui.svg)](https://marketplace.visualstudio.com/items?itemName=YOUR_PUBLISHER_ID.cargui)
```

2. **Share Your Extension**:
   - Post on r/rust and r/vscode
   - Tweet with #rustlang and #vscode hashtags
   - Share in Rust Discord servers

3. **Add Screenshots/GIFs** to README showing:
   - Tree view with targets
   - Smart detection in action
   - Drag & drop configuration

---

## 🆘 Troubleshooting

### "Missing icon" Warning
Add an icon to your extension (optional):
1. Create a 128x128 PNG icon
2. Save as `icon.png` in root directory
3. Add to package.json: `"icon": "icon.png"`

### "Publisher not found"
Make sure you're using the correct Publisher ID from marketplace.visualstudio.com

### "PAT expired"
Create a new PAT and login again: `vsce login YOUR_PUBLISHER_ID`

---

## ✨ You're All Set!

Your extension will be:
- **On GitHub**: Open source, accepting contributions
- **On VS Code Marketplace**: Automatically updating users
- **Easy to maintain**: Same workflow as local development + one publish command

Questions? Open an issue on GitHub! 🎉
