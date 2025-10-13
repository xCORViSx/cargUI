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
    
    // Check for main.rs or lib.rs to find mod declarations
    const mainPath = path.join(srcPath, 'main.rs');
    const libPath = path.join(srcPath, 'lib.rs');
    const rootFile = fs.existsSync(mainPath) ? mainPath : (fs.existsSync(libPath) ? libPath : null);
    
    if (rootFile) {
        // Parse root file for mod declarations
        const content = fs.readFileSync(rootFile, 'utf8');
        const modRegex = /^\s*(pub\s+)?mod\s+(\w+)\s*;/gm;
        let match;
        
        while ((match = modRegex.exec(content)) !== null) {
            const isPub = !!match[1];
            const modName = match[2];
            declaredModules.add(modName);
            const modInfo = findModuleFile(srcPath, modName, true, isPub);
            if (modInfo) {
                modules.push(modInfo);
            }
        }
        
        // Now scan for undeclared modules (files that exist but aren't declared)
        const undeclaredModules = findUndeclaredModules(srcPath, declaredModules);
        modules.push(...undeclaredModules);
    }
    
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
 * Analyzes a module file to extract metadata like documentation and tests.
 * 
 * @param filePath - Path to the module file
 * @param content - File content (optional, will read if not provided)
 * @returns Object with module metadata
 */
function analyzeModuleFile(filePath: string, content?: string): {
    hasDocComment: boolean;
    hasTests: boolean;
} {
    const fileContent = content || (fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf8') : '');
    
    // Check for doc comments (//! or ///)
    const hasDocComment = /^\/\/[/!]/.test(fileContent);
    
    // Check for tests
    const hasTests = /#\[test\]|#\[cfg\(test\)\]/.test(fileContent);
    
    return { hasDocComment, hasTests };
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
 * Builds a tree of CargoTreeItem objects from ModuleInfo array for display in VS Code tree view.
 * 
 * @param modules - Array of ModuleInfo objects to convert
 * @param workspaceMember - Optional workspace member path
 * @param decorationProvider - Optional decoration provider for styling undeclared modules
 * @returns Array of CargoTreeItem objects ready for tree view
 */
export function buildModuleTree(modules: ModuleInfo[], workspaceMember?: string, decorationProvider?: DependencyDecorationProvider): CargoTreeItem[] {
    return modules.map(mod => {
        const hasChildren = mod.children.length > 0;
        
        // Determine icon based on visibility and type
        let iconName = 'file-code';
        if (mod.isPublic) {
            iconName = 'symbol-namespace'; // Public modules get special icon
        } else if (mod.isDirectory) {
            iconName = 'folder';
        }
        
        const item = new CargoTreeItem(
            mod.name,
            hasChildren ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None,
            TreeItemContext.Module,
            {
                iconName: iconName,
                moduleInfo: mod,
                workspaceMember: workspaceMember
            }
        );
        
        // Build comprehensive tooltip
        let tooltipParts: string[] = [mod.path];
        
        if (!mod.isDeclared) {
            tooltipParts.push('⚠️ Not declared with \'mod\' statement');
        }
        if (mod.isPublic) {
            tooltipParts.push('🌐 Public module (pub mod)');
        }
        if (mod.hasDocComment) {
            tooltipParts.push('📝 Has documentation');
        }
        if (mod.hasTests) {
            tooltipParts.push('✅ Contains tests');
        }
        
        item.tooltip = tooltipParts.join('\n');
        
        // Build description
        let descParts: string[] = [];
        if (mod.isDirectory) {
            descParts.push('(dir)');
        }
        if (mod.isPublic) {
            descParts.push('pub');
        }
        item.description = descParts.join(' ');
        
        // Determine color based on module health/status
        let color: string | undefined;
        const moduleKey = `module-${mod.name}-${mod.path}`;
        
        if (!mod.isDeclared) {
            // Orange: Undeclared modules (warning)
            color = 'charts.orange';
        } else if (mod.isPublic && mod.hasDocComment) {
            // Green: Well-maintained public API modules
            color = 'charts.green';
        } else if (mod.isPublic) {
            // Blue: Public modules (part of API)
            color = 'charts.blue';
        } else if (!mod.hasDocComment && mod.isDeclared) {
            // Yellow: Private modules missing documentation
            color = 'charts.yellow';
        }
        // No color = private internal module with docs (default styling)
        
        // Apply coloring
        if (color) {
            item.resourceUri = vscode.Uri.parse(`cargui-module:${moduleKey}`);
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
