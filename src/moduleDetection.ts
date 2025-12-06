import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { ModuleInfo, TreeItemContext } from './types';
import { CargoTreeItem } from './treeItems';
import { DependencyDecorationProvider } from './decorationProvider';

/**
 * Detects all Rust modules in a source directory by parsing mod declarations
 * and finding undeclared module files.
 * 
 * @param srcPath - Path to the src directory to scan
 * @returns Array of ModuleInfo objects representing the module hierarchy
 */
export function detectModules(srcPath: string): ModuleInfo[] {
    if (!fs.existsSync(srcPath)) {
        return [];
    }
    
    const modules: ModuleInfo[] = [];
    const declaredModules = new Set<string>();
    
    // Check BOTH main.rs and lib.rs for mod declarations
    // A crate can have both a library (lib.rs) and a binary (main.rs)
    const mainPath = path.join(srcPath, 'main.rs');
    const libPath = path.join(srcPath, 'lib.rs');
    const rootFiles: string[] = [];
    
    if (fs.existsSync(libPath)) {
        rootFiles.push(libPath);
    }
    if (fs.existsSync(mainPath)) {
        rootFiles.push(mainPath);
    }
    
    for (const rootFile of rootFiles) {
        // Parse root file for mod declarations
        const content = fs.readFileSync(rootFile, 'utf8');
        const modRegex = /^\s*(pub\s+)?mod\s+(\w+)\s*;/gm;
        let match;
        
        while ((match = modRegex.exec(content)) !== null) {
            const isPub = !!match[1];
            const modName = match[2];
            // Only add if not already declared (avoid duplicates if both files declare same module)
            if (!declaredModules.has(modName)) {
                declaredModules.add(modName);
                const modInfo = findModuleFile(srcPath, modName, true, isPub);
                if (modInfo) {
                    modules.push(modInfo);
                }
            }
        }
    }
    
    // Now scan for undeclared modules (files that exist but aren't declared)
    const undeclaredModules = findUndeclaredModules(srcPath, declaredModules);
    modules.push(...undeclaredModules);
    
    return modules;
}

/**
 * Finds a module file by name, checking both single-file and directory structures.
 * 
 * @param basePath - Base directory to search in
 * @param moduleName - Name of the module to find
 * @param isDeclared - Whether the module is declared with a mod statement
 * @param isPublic - Whether the module is declared with pub visibility
 * @returns ModuleInfo object if found, null otherwise
 */
export function findModuleFile(basePath: string, moduleName: string, isDeclared: boolean = true, isPublic: boolean = false): ModuleInfo | null {
    // Check for module_name.rs file
    const filePath = path.join(basePath, `${moduleName}.rs`);
    if (fs.existsSync(filePath)) {
        // It's a single file module, check if it has submodules
        const children = parseModuleFile(filePath, path.join(basePath, moduleName), isDeclared);
        const analysis = analyzeModuleFile(filePath);
        return {
            name: moduleName,
            path: filePath,
            isDirectory: false,
            children,
            isDeclared,
            isPublic,
            ...analysis
        };
    }
    
    // Check for module_name/mod.rs directory structure
    const dirPath = path.join(basePath, moduleName);
    const modFilePath = path.join(dirPath, 'mod.rs');
    if (fs.existsSync(modFilePath)) {
        // It's a directory module, parse mod.rs for submodules
        const children = parseModuleFile(modFilePath, dirPath, isDeclared);
        const analysis = analyzeModuleFile(modFilePath);
        return {
            name: moduleName,
            path: modFilePath,
            isDirectory: true,
            children,
            isDeclared,
            isPublic,
            ...analysis
        };
    }
    
    return null;
}

/**
 * Analyzes a module file to extract code elements and documentation metrics.
 * This counts distinct code items (structs, functions, enums, traits, etc.)
 * and determines how many of them have doc comments to calculate module health.
 * 
 * @param filePath - Path to the module file
 * @param content - File content (optional, will read if not provided)
 * @returns Object with module metadata including documentation percentage
 */
function analyzeModuleFile(filePath: string, content?: string): {
    hasDocComment: boolean;
    hasTests: boolean;
    hasHeader: boolean;
    hasIncorrectHeader: boolean;
    totalElements: number;
    documentedElements: number;
} {
    const fileContent = content || (fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf8') : '');
    
    // Check for doc comments (//! or ///)
    const hasDocComment = /^\/\/[/!]/.test(fileContent);
    
    // Check for module-level header doc comments (//!) at the start of the file
    // Also detect incorrect headers (/// at file start instead of //!)
    const lines = fileContent.split('\n');
    let hasHeader = false;
    let hasIncorrectHeader = false;
    for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed.startsWith('//!')) {
            hasHeader = true;
            break;
        }
        // Detect incorrect header: /// at file start (should be //!)
        if (trimmed.startsWith('///')) {
            hasIncorrectHeader = true;
            break;
        }
        // Stop checking if we hit actual code (not comments or whitespace)
        if (trimmed && !trimmed.startsWith('//') && !trimmed.startsWith('#[')) {
            break;
        }
    }
    
    // Check for tests
    const hasTests = /#\[test\]|#\[cfg\(test\)\]/.test(fileContent);
    
    // Parse code elements and count documentation
    const { totalElements, documentedElements } = parseCodeElements(fileContent);
    
    return { hasDocComment, hasTests, hasHeader, hasIncorrectHeader, totalElements, documentedElements };
}

/**
 * Parses Rust code to identify and count code elements (structs, functions, enums, traits, impls).
 * For each element, checks if it has a preceding doc comment (/// or //!).
 * We count actual distinct items, not lines of documentation.
 * 
 * Note: impl blocks are not counted as elements since they don't need separate documentation—
 * the documentation belongs on the type or methods inside the impl block.
 * 
 * @param content - Rust source code content
 * @returns Object with total element count and count of documented elements
 */
function parseCodeElements(content: string): { totalElements: number; documentedElements: number } {
    // Remove comments to avoid counting doc comment markers as code
    let sanitized = content;
    
    // Remove block comments /* */
    sanitized = sanitized.replace(/\/\*[\s\S]*?\*\//g, '');
    
    // Split into lines for line-by-line analysis
    const lines = sanitized.split('\n');
    
    let totalElements = 0;
    let documentedElements = 0;
    
    // Patterns for code elements: pub/private struct, enum, trait, function, etc.
    // We look for these keywords at statement level (not in comments or strings)
    // Note: impl blocks are intentionally excluded since they don't need separate doc comments
    const elementPatterns = [
        /^\s*(pub(\s+\([^)]*\))?\s+)?(async\s+)?fn\s+\w+/,        // Functions (pub fn, async fn, etc.)
        /^\s*(pub(\s+\([^)]*\))?\s+)?(struct|enum|union|trait)\s+\w+/, // Type definitions
        /^\s*(pub(\s+\([^)]*\))?\s+)?type\s+\w+/,                 // Type aliases
        /^\s*(pub(\s+\([^)]*\))?\s+)?const\s+\w+/,                // Constants
        /^\s*(pub(\s+\([^)]*\))?\s+)?static\s+\w+/,               // Statics
    ];
    
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        
        // Check if any element pattern matches this line
        let isElement = false;
        for (const pattern of elementPatterns) {
            if (pattern.test(line)) {
                isElement = true;
                break;
            }
        }
        
        if (isElement) {
            totalElements++;
            
            // Check if this element has a doc comment on the preceding line(s)
            // Look back up to 3 lines for doc comments (/// or //!)
            let hasDoc = false;
            for (let j = i - 1; j >= Math.max(0, i - 3); j--) {
                const prevLine = lines[j].trim();
                if (prevLine.startsWith('///') || prevLine.startsWith('//!')) {
                    hasDoc = true;
                    break;
                }
                // Stop if we hit a non-comment, non-attribute line
                if (prevLine && !prevLine.startsWith('//') && !prevLine.startsWith('#[')) {
                    break;
                }
            }
            
            if (hasDoc) {
                documentedElements++;
            }
        }
    }
    
    return { totalElements, documentedElements };
}

/**
 * Parses a module file to find all submodule declarations and undeclared modules.
 * 
 * @param filePath - Path to the module file to parse
 * @param basePath - Base directory for resolving submodule paths
 * @param parentDeclared - Whether the parent module is properly declared
 * @returns Array of submodule ModuleInfo objects
 */
export function parseModuleFile(filePath: string, basePath: string, parentDeclared: boolean = true): ModuleInfo[] {
    if (!fs.existsSync(filePath)) {
        return [];
    }
    
    const content = fs.readFileSync(filePath, 'utf8');
    const modRegex = /^\s*(pub\s+)?mod\s+(\w+)\s*;/gm;
    const submodules: ModuleInfo[] = [];
    const declaredSubmodules = new Set<string>();
    let match;
    
    // First, collect declared submodules
    while ((match = modRegex.exec(content)) !== null) {
        const isPub = !!match[1];
        const modName = match[2];
        declaredSubmodules.add(modName);
        const modInfo = findModuleFile(basePath, modName, parentDeclared, isPub);
        if (modInfo) {
            submodules.push(modInfo);
        }
    }
    
    // Only check for undeclared submodules if the parent is declared
    if (parentDeclared) {
        const undeclared = findUndeclaredModules(basePath, declaredSubmodules);
        submodules.push(...undeclared);
    }
    
    return submodules;
}

/**
 * Finds all module files that exist but are not declared with mod statements.
 * 
 * @param basePath - Directory to scan for undeclared modules
 * @param declaredModules - Set of module names that are already declared
 * @returns Array of undeclared ModuleInfo objects
 */
export function findUndeclaredModules(basePath: string, declaredModules: Set<string>): ModuleInfo[] {
    const undeclared: ModuleInfo[] = [];
    
    if (!fs.existsSync(basePath)) {
        return [];
    }
    
    try {
        const entries = fs.readdirSync(basePath, { withFileTypes: true });
        
        for (const entry of entries) {
            const name = entry.name;
            
            // Skip main.rs, lib.rs, and mod.rs as they're not modules themselves
            if (name === 'main.rs' || name === 'lib.rs' || name === 'mod.rs') {
                continue;
            }
            
            // Check for .rs files
            if (entry.isFile() && name.endsWith('.rs')) {
                const moduleName = name.slice(0, -3); // Remove .rs extension
                if (!declaredModules.has(moduleName)) {
                    undeclared.push({
                        name: moduleName,
                        path: path.join(basePath, name),
                        isDirectory: false,
                        children: [],
                        isDeclared: false
                    });
                }
            }
            
            // Check for directories with mod.rs
            if (entry.isDirectory()) {
                const modFilePath = path.join(basePath, name, 'mod.rs');
                if (fs.existsSync(modFilePath) && !declaredModules.has(name)) {
                    // It's an undeclared directory module
                    undeclared.push({
                        name: name,
                        path: modFilePath,
                        isDirectory: true,
                        children: [], // Don't recurse into undeclared modules
                        isDeclared: false
                    });
                }
            }
        }
    } catch (error) {
        console.error('Error scanning for undeclared modules:', error);
    }
    
    return undeclared;
}

/**
 * Calculates the health status of a module based on documentation percentage.
 * Health is determined by:
 * 1. Whether the module has a header (//! doc comment) - counts as 1 item
 * 2. Code elements (structs, functions, enums, etc.) with doc comments (///)
 * 
 * The health scale:
 * - 0-50%: No color (underdocumented)
 * - 50-90%: Blue (moderately documented)
 * - 90-100%: Green (well documented)
 * 
 * For modules with no header and no code elements, no color is assigned.
 * 
 * @param moduleInfo - Module to analyze
 * @returns Object with health percentage and appropriate color, or undefined if no items or underdoc
 */
function calculateModuleHealth(moduleInfo: ModuleInfo): { percentage: number; color: string } | undefined {
    // Calculate total items: 1 for header + code elements
    const headerItem = 1;
    const totalItems = headerItem + (moduleInfo.totalElements || 0);
    
    // Skip if module has nothing to document
    if (totalItems === 0) {
        return undefined;
    }
    
    // Calculate documented items: header (if present) + documented elements
    const hasHeader = moduleInfo.hasHeader ? 1 : 0;
    const documentedCount = hasHeader + (moduleInfo.documentedElements || 0);
    const percentage = (documentedCount / totalItems) * 100;
    
    let color: string | undefined;
    if (percentage < 50) {
        // No color: 0-50% (underdocumented)
        color = undefined;
    } else if (percentage < 90) {
        // Blue: 50-90% (moderately documented)
        color = 'charts.blue';
    } else {
        // Green: 90-100% (well documented)
        color = 'charts.green';
    }
    
    return color !== undefined ? { percentage, color } : undefined;
}

/**
 * Builds a tree of CargoTreeItem objects from ModuleInfo array for display in VS Code tree view.
 * Propagates "undeclared" status to all descendants so if parent is undeclared,
 * all children show red icons to "lead all the way down to the offender".
 * 
 * @param modules - Array of ModuleInfo objects to convert
 * @param workspaceMember - Optional workspace member path
 * @param decorationProvider - Optional decoration provider for styling undeclared modules
 * @param parentUndeclared - Whether parent module is undeclared (propagates to children)
 * @returns Array of CargoTreeItem objects ready for tree view
 */
export function buildModuleTree(modules: ModuleInfo[], workspaceMember?: string, decorationProvider?: DependencyDecorationProvider, parentUndeclared: boolean = false): CargoTreeItem[] {
    return modules.map(mod => {
        const hasChildren = mod.children.length > 0;
        
        // Determine icon based on type
        let iconName = 'file-code';
        if (mod.isDirectory) {
            iconName = 'folder';
        }
        
        const contextValue = mod.isDeclared ? TreeItemContext.Module : TreeItemContext.UndeclaredModule;
        const item = new CargoTreeItem(
            mod.name,
            hasChildren ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None,
            contextValue,
            {
                iconName: iconName,
                moduleInfo: mod,
                workspaceMember: workspaceMember
            }
        );
        
        // Build comprehensive tooltip
        let tooltipParts: string[] = [mod.path];
        
        // Determine if this module should be marked as undeclared for display purposes
        // This includes both truly undeclared modules and those descended from undeclared parents
        const isEffectivelyUndeclared = !mod.isDeclared || parentUndeclared;
        
        if (!mod.isDeclared) {
            tooltipParts.push('⚠️ Not declared with \'mod\' statement');
        }
        if (parentUndeclared && mod.isDeclared) {
            tooltipParts.push('⚠️ Parent module is undeclared');
        }
        if (!mod.isPublic) {
            tooltipParts.push('🔒 Private module');
        }
        if (mod.hasHeader) {
            tooltipParts.push('📋 Has module header (//!)');
        } else if (mod.hasIncorrectHeader) {
            tooltipParts.push('⚠️ Has /// header (should be //!)');
        }
        if (mod.hasTests) {
            tooltipParts.push('✅ Contains tests');
        }
        
        // Add health information
        const headerItem = 1;
        const totalItems = headerItem + (mod.totalElements || 0);
        if (totalItems > 0) {
            const hasHeader = mod.hasHeader ? 1 : 0;
            const documentedCount = hasHeader + (mod.documentedElements || 0);
            const healthPercent = ((documentedCount / totalItems) * 100).toFixed(0);
            tooltipParts.push(`📊 Documentation: ${documentedCount}/${totalItems} items (${healthPercent}%)`);
            if (!mod.hasHeader) {
                if (mod.hasIncorrectHeader) {
                    tooltipParts.push('   - Has /// header (must be //!)');
                } else {
                    tooltipParts.push('   - Missing header (//!)');
                }
            }
            if (mod.totalElements && mod.totalElements > 0) {
                tooltipParts.push(`   - Elements: ${mod.documentedElements || 0}/${mod.totalElements}`);
            }
        }
        
        item.tooltip = tooltipParts.join('\n');
        
        // Build description
        let descParts: string[] = [];
        
        // Add submodule count if there are children
        if (hasChildren) {
            // Count direct children
            const childCount = mod.children.length;
            descParts.push(`${childCount}`);
        }
        
        if (!mod.isPublic) {
            descParts.push('(priv)');
        }
        
        // Add health indicator if we have element data
        if (mod.totalElements && mod.totalElements > 0) {
            const documentedCount = mod.documentedElements || 0;
            const healthPercent = Math.round((documentedCount / mod.totalElements) * 100);
            descParts.push(`${healthPercent}%`);
        }
        
        item.description = descParts.join(' ');
        
        // Determine color based on new health system
        let color: string | undefined;
        const moduleKey = `module-${mod.name}-${mod.path}`;
        
        if (isEffectivelyUndeclared) {
            // Red: Undeclared modules or children of undeclared modules
            // This creates a visual "trail" down to the root cause
            color = 'charts.red';
            // we set a special resourceUri for undeclared modules so inline buttons appear
            item.resourceUri = vscode.Uri.parse(`cargui-undeclared-module:${moduleKey}`);
        } else {
            // Use new health-based color system for declared modules
            const health = calculateModuleHealth(mod);
            if (health) {
                color = health.color;
                item.resourceUri = vscode.Uri.parse(`cargui-module:${moduleKey}`);
            }
        }
        
        // Apply coloring
        if (color) {
            if (decorationProvider) {
                decorationProvider.setTargetColor(moduleKey, color);
            }
            // Also apply icon color for consistency
            item.iconPath = new vscode.ThemeIcon(iconName, new vscode.ThemeColor(color));
        }
        
        // Add command to open the module file
        item.command = {
            command: 'vscode.open',
            title: 'Open Module',
            arguments: [vscode.Uri.file(mod.path)]
        };
        
        return item;
    });
}
