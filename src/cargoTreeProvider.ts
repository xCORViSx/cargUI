import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as toml from '@iarna/toml';
import {
    TreeItemContext,
    CargoTarget,
    CargoManifest,
    Dependency,
    Snapshot,
    CustomCommand,
    CustomCommandCategory,
    ArgumentCategory,
    UnregisteredItem,
    ModuleInfo
} from './types';
import { CargoTreeItem } from './treeItems';
import { DependencyDecorationProvider } from './decorationProvider';
import {
    discoverWorkspaceMembers,
    discoverCargoTargets,
    discoverCargoFeatures,
    discoverCargoDependencies
} from './cargoDiscovery';
import { detectModules, buildModuleTree } from './moduleDetection';
import { fetchCrateVersions } from './cratesIo';
import { CargoTreeState } from './cargoCommands';
import { getCurrentEdition } from './rustEdition';
import { detectUndeclaredFeatures } from './smartDetection';
import { showConfigureUnregisteredUI } from './smartDetectionUI';
import { analyzeTargetFile, calculateTargetHealthColor } from './targetHealth';

/**
 * Main tree data provider for the Cargo sidebar view.
 * Handles tree structure, checkboxes, drag-and-drop, and all tree item management.
 * Implements VS Code's TreeDataProvider and TreeDragAndDropController interfaces.
 */
export class CargoTreeDataProvider implements 
    vscode.TreeDataProvider<CargoTreeItem>, 
    vscode.TreeDragAndDropController<CargoTreeItem>,
    CargoTreeState 
{
    private _onDidChangeTreeData: vscode.EventEmitter<CargoTreeItem | undefined | null | void> = new vscode.EventEmitter<CargoTreeItem | undefined | null | void>();
    readonly onDidChangeTreeData: vscode.Event<CargoTreeItem | undefined | null | void> = this._onDidChangeTreeData.event;
    private checkedTargets: Set<string> = new Set();
    private checkedFeatures: Set<string> = new Set();
    private checkedArguments: Set<string> = new Set();
    private checkedEnvVars: Set<string> = new Set();
    private checkedWorkspaceMembers: Set<string> = new Set();
    private checkedDependencies: Map<string, Dependency> = new Map();
    private workspaceFolder?: vscode.WorkspaceFolder;
    private context?: vscode.ExtensionContext;
    public decorationProvider?: DependencyDecorationProvider;
    public treeView?: vscode.TreeView<CargoTreeItem>;

    // Drag and drop support
    dropMimeTypes = ['application/vnd.code.tree.cargoTreeView'];
    dragMimeTypes = ['application/vnd.code.tree.cargoTreeView'];

    // These need to be accessed from extension.ts
    private selectedWorkspaceMember?: string;
    private isReleaseMode: boolean = false;
    private isWatchMode: boolean = false;
    private watchAction: string = 'check';
    private detectUnregisteredTargetsFunc: (workspacePath: string, memberPath?: string) => UnregisteredItem[];
    private applyCargoTomlChangesFunc: (workspaceFolder: vscode.WorkspaceFolder, items: UnregisteredItem[], moveFile: (workspaceFolder: vscode.WorkspaceFolder, item: UnregisteredItem, memberPath?: string) => Promise<string | null>) => Promise<void>;

    constructor(
        detectUnregisteredTargets: (workspacePath: string, memberPath?: string) => UnregisteredItem[],
        applyCargoTomlChanges: (workspaceFolder: vscode.WorkspaceFolder, items: UnregisteredItem[], moveFile: (workspaceFolder: vscode.WorkspaceFolder, item: UnregisteredItem, memberPath?: string) => Promise<string | null>) => Promise<void>
    ) {
        this.detectUnregisteredTargetsFunc = detectUnregisteredTargets;
        this.applyCargoTomlChangesFunc = applyCargoTomlChanges;
    }

    setWorkspaceContext(workspaceFolder: vscode.WorkspaceFolder, context: vscode.ExtensionContext): void {
        this.workspaceFolder = workspaceFolder;
        this.context = context;
    }

    getWorkspaceFolder(): vscode.WorkspaceFolder | undefined {
        // Return the stored workspace folder if available, otherwise fallback to first workspace folder
        return this.workspaceFolder || vscode.workspace.workspaceFolders?.[0];
    }

    // Allow external setting of mode states
    setSelectedWorkspaceMember(member: string | undefined): void {
        console.log('[cargUI] setSelectedWorkspaceMember called with:', member);
        this.selectedWorkspaceMember = member;
        console.log('[cargUI] selectedWorkspaceMember is now:', this.selectedWorkspaceMember);
        this.refresh();
    }

    getSelectedWorkspaceMember(): string | undefined {
        return this.selectedWorkspaceMember;
    }

    setReleaseMode(isRelease: boolean): void {
        this.isReleaseMode = isRelease;
    }

    setWatchMode(isWatch: boolean, action: string = 'check'): void {
        this.isWatchMode = isWatch;
        this.watchAction = action;
    }

    refresh(): void {
        // Clear decoration provider before refresh
        if (this.decorationProvider) {
            this.decorationProvider.refresh();
        }
        this._onDidChangeTreeData.fire();
        // Run smart detection after refresh (debounced)
        this.triggerSmartDetection();
    }

    private detectionTimeout?: NodeJS.Timeout;
    
    private triggerSmartDetection(): void {
        // Debounce detection to avoid running it too frequently
        if (this.detectionTimeout) {
            clearTimeout(this.detectionTimeout);
        }
        
        this.detectionTimeout = setTimeout(async () => {
            if (!this.workspaceFolder || !this.context) {
                return;
            }
            
            // we detect both unknown targets and undeclared features
            const workspaceMembers = discoverWorkspaceMembers(this.workspaceFolder.uri.fsPath);
            const targetMemberPath = this.selectedWorkspaceMember && this.selectedWorkspaceMember !== 'all'
                ? workspaceMembers.find(m => m.name === this.selectedWorkspaceMember)?.path
                : undefined;
            const unknownTargets = this.detectUnregisteredTargetsFunc(this.workspaceFolder.uri.fsPath, targetMemberPath);
            const undeclaredFeatures = detectUndeclaredFeatures(this.workspaceFolder.uri.fsPath, targetMemberPath);
            
            // Detect undeclared modules
            let undeclaredModules: ModuleInfo[] = [];
            const members = discoverWorkspaceMembers(this.workspaceFolder.uri.fsPath);
            if (members.length > 1) {
                for (const member of members) {
                    const srcPath = path.join(this.workspaceFolder.uri.fsPath, member.path, 'src');
                    const modules = detectModules(srcPath);
                    const undeclared = modules.filter(m => !m.isDeclared);
                    undeclaredModules.push(...undeclared);
                }
            } else {
                const srcPath = path.join(this.workspaceFolder.uri.fsPath, 'src');
                const modules = detectModules(srcPath);
                undeclaredModules = modules.filter(m => !m.isDeclared);
            }
            
            // Show notifications based on what exists (each with its own ignore key)
            const hasTargets = unknownTargets.length > 0;
            const hasFeatures = undeclaredFeatures.length > 0;
            const hasModules = undeclaredModules.length > 0;
            
            if (hasTargets || hasFeatures || hasModules) {
                const context = this.context;
                let delay = 0;
                
                // Show targets notification
                if (hasTargets) {
                    const targetsIgnoredKey = 'cargui.ignoreUnknownTargets';
                    const targetsIgnored = context.workspaceState.get(targetsIgnoredKey, false);
                    
                    if (!targetsIgnored) {
                        const targetText = unknownTargets.length === 1 ? 'unknown target type' : 'unknown target types';
                        const targetMessage = `Found ${unknownTargets.length} ${targetText}. Check the Unknowns folder in the Targets tree.`;
                        
                        vscode.window.showInformationMessage(
                            targetMessage,
                            'Got it',
                            "Don't Show Again"
                        ).then(choice => {
                            if (choice === "Don't Show Again" && context) {
                                context.workspaceState.update(targetsIgnoredKey, true);
                            }
                        });
                        delay += 100;
                    }
                }
                
                // Show features notification
                if (hasFeatures) {
                    const featuresIgnoredKey = 'cargui.ignoreUndeclaredFeatures';
                    const featuresIgnored = context.workspaceState.get(featuresIgnoredKey, false);
                    
                    if (!featuresIgnored) {
                        setTimeout(() => {
                            const featureText = undeclaredFeatures.length === 1 ? 'undeclared feature' : 'undeclared features';
                            const featureMessage = `Found ${undeclaredFeatures.length} ${featureText}. Check the Features section in the tree.`;
                            
                            vscode.window.showInformationMessage(
                                featureMessage,
                                'Got it',
                                "Don't Show Again"
                            ).then(choice => {
                                if (choice === "Don't Show Again" && context) {
                                    context.workspaceState.update(featuresIgnoredKey, true);
                                }
                            });
                        }, delay);
                        delay += 100;
                    }
                }
                
                // Show modules notification
                if (hasModules) {
                    const modulesIgnoredKey = 'cargui.ignoreUndeclaredModules';
                    const modulesIgnored = context.workspaceState.get(modulesIgnoredKey, false);
                    
                    if (!modulesIgnored) {
                        setTimeout(() => {
                            const moduleText = undeclaredModules.length === 1 ? 'undeclared module' : 'undeclared modules';
                            const moduleMessage = `Found ${undeclaredModules.length} ${moduleText}. Check the MODULES section in the tree.`;
                            
                            vscode.window.showInformationMessage(
                                moduleMessage,
                                'Got it',
                                "Don't Show Again"
                            ).then(choice => {
                                if (choice === "Don't Show Again" && context) {
                                    context.workspaceState.update(modulesIgnoredKey, true);
                                }
                            });
                        }, delay);
                    } else {
                        console.log('[cargUI] Modules notification suppressed (ignore flag set)');
                    }
                }
            }
        }, 2000); // 2 second debounce
    }

    toggleCheck(targetName: string): void {
        if (this.checkedTargets.has(targetName)) {
            this.checkedTargets.delete(targetName);
        } else {
            this.checkedTargets.add(targetName);
        }
        this._onDidChangeTreeData.fire();
    }

    setChecked(targetName: string, checked: boolean): void {
        if (checked) {
            this.checkedTargets.add(targetName);
        } else {
            this.checkedTargets.delete(targetName);
        }
        this._onDidChangeTreeData.fire();
    }

    toggleFeature(featureName: string): void {
        if (this.checkedFeatures.has(featureName)) {
            this.checkedFeatures.delete(featureName);
        } else {
            this.checkedFeatures.add(featureName);
        }
        this._onDidChangeTreeData.fire();
    }

    setFeatureChecked(featureName: string, checked: boolean): void {
        if (checked) {
            this.checkedFeatures.add(featureName);
        } else {
            this.checkedFeatures.delete(featureName);
        }
        this._onDidChangeTreeData.fire();
    }

    getCheckedTargets(): string[] {
        return Array.from(this.checkedTargets);
    }

    getCheckedFeatures(): string[] {
        return Array.from(this.checkedFeatures);
    }

    isFeatureChecked(featureName: string): boolean {
        return this.checkedFeatures.has(featureName);
    }

    toggleArgument(argument: string): void {
        if (this.checkedArguments.has(argument)) {
            this.checkedArguments.delete(argument);
        } else {
            this.checkedArguments.add(argument);
        }
        this._onDidChangeTreeData.fire();
    }

    setArgumentChecked(argument: string, checked: boolean): void {
        if (checked) {
            this.checkedArguments.add(argument);
        } else {
            this.checkedArguments.delete(argument);
        }
        this._onDidChangeTreeData.fire();
    }

    getCheckedArguments(): string[] {
        return Array.from(this.checkedArguments);
    }

    // Helper to update checked argument when it's renamed
    renameCheckedArgument(oldArg: string, newArg: string): void {
        if (this.checkedArguments.has(oldArg)) {
            this.checkedArguments.delete(oldArg);
            this.checkedArguments.add(newArg);
        }
    }

    // Helper to remove checked argument
    removeCheckedArgument(argument: string): void {
        this.checkedArguments.delete(argument);
    }

    toggleEnvVar(envVar: string): void {
        if (this.checkedEnvVars.has(envVar)) {
            this.checkedEnvVars.delete(envVar);
        } else {
            this.checkedEnvVars.add(envVar);
        }
        this._onDidChangeTreeData.fire();
    }

    setEnvVarChecked(envVar: string, checked: boolean): void {
        if (checked) {
            this.checkedEnvVars.add(envVar);
        } else {
            this.checkedEnvVars.delete(envVar);
        }
        this._onDidChangeTreeData.fire();
    }

    getCheckedEnvVars(): string[] {
        return Array.from(this.checkedEnvVars);
    }

    // Helper to update checked env var when it's renamed
    renameCheckedEnvVar(oldEnvVar: string, newEnvVar: string): void {
        if (this.checkedEnvVars.has(oldEnvVar)) {
            this.checkedEnvVars.delete(oldEnvVar);
            this.checkedEnvVars.add(newEnvVar);
        }
    }

    setDependencyChecked(depName: string, checked: boolean, dependency?: Dependency): void {
        if (checked && dependency) {
            this.checkedDependencies.set(depName, dependency);
        } else {
            this.checkedDependencies.delete(depName);
        }
        this._onDidChangeTreeData.fire();
    }

    getCheckedDependencies(): Map<string, Dependency> {
        return this.checkedDependencies;
    }

    // Helper to remove checked env var
    removeCheckedEnvVar(envVar: string): void {
        this.checkedEnvVars.delete(envVar);
    }

    // we provide public access to unknown targets for batch operations
    getUnknownTargets(memberPath?: string): UnregisteredItem[] {
        if (!this.workspaceFolder) {
            return [];
        }
        return this.detectUnregisteredTargetsFunc(this.workspaceFolder.uri.fsPath, memberPath);
    }

    toggleWorkspaceMember(memberName: string): void {
        if (this.checkedWorkspaceMembers.has(memberName)) {
            this.checkedWorkspaceMembers.delete(memberName);
        } else {
            this.checkedWorkspaceMembers.add(memberName);
        }
        this._onDidChangeTreeData.fire();
    }

    setWorkspaceMemberChecked(memberName: string, checked: boolean): void {
        if (checked) {
            this.checkedWorkspaceMembers.add(memberName);
        } else {
            this.checkedWorkspaceMembers.delete(memberName);
        }
        this._onDidChangeTreeData.fire();
    }

    getCheckedWorkspaceMembers(): string[] {
        return Array.from(this.checkedWorkspaceMembers);
    }

    private async reassignTargetType(item: any, newType: 'bin' | 'example' | 'test' | 'bench'): Promise<void> {
        if (!this.workspaceFolder || !item.name) {
            console.error('Missing workspace or item name:', { workspaceFolder: this.workspaceFolder, item });
            return;
        }

        const workspaceMembers = discoverWorkspaceMembers(this.workspaceFolder.uri.fsPath);
        let member = item.memberName 
            ? workspaceMembers.find(m => m.name === item.memberName)
            : undefined;
        
        // For single-crate packages, memberName might be set but member won't be found
        if (item.memberName && !member && workspaceMembers.length === 0) {
            console.log(`[reassignTargetType] Member ${item.memberName} not found, treating as single-crate package (root)`);
            member = undefined;
        }
        
        const basePath = member 
            ? path.join(this.workspaceFolder.uri.fsPath, member.path)
            : this.workspaceFolder.uri.fsPath;
        
        const cargoTomlPath = path.join(basePath, 'Cargo.toml');
        
        if (!fs.existsSync(cargoTomlPath)) {
            vscode.window.showErrorMessage(`Cargo.toml not found at ${cargoTomlPath}`);
            return;
        }

        try {
            let cargoTomlContent = fs.readFileSync(cargoTomlPath, 'utf-8');
            const manifest = toml.parse(cargoTomlContent) as CargoManifest;

            console.log('Reassigning target:', { name: item.name, oldType: item.type, newType, path: item.path });

            // Remove from old section if it exists
            const oldType = item.type;
            if (oldType && manifest[oldType as keyof CargoManifest]) {
                const oldSection = manifest[oldType as keyof CargoManifest] as any[];
                if (Array.isArray(oldSection)) {
                    const index = oldSection.findIndex((t: any) => t.name === item.name);
                    if (index !== -1) {
                        console.log('Removing from old section:', oldType, 'at index', index);
                        oldSection.splice(index, 1);
                        
                        // Remove from TOML content using regex
                        const escapedName = item.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                        const sectionRegex = new RegExp(
                            `\\[\\[${oldType}\\]\\]\\s*\\nname\\s*=\\s*["']${escapedName}["']\\s*\\n(path\\s*=\\s*[^\\n]+\\n)?`,
                            'g'
                        );
                        cargoTomlContent = cargoTomlContent.replace(sectionRegex, '');
                    }
                }
            }

            // Add to new section - append to TOML content
            const targetEntry = `\n[[${newType}]]\nname = "${item.name}"\npath = "${item.path}"\n`;
            
            // Find the last occurrence of [[newType]] section or add at end
            const newTypeSectionRegex = new RegExp(`\\[\\[${newType}\\]\\]`, 'g');
            const matches = [...cargoTomlContent.matchAll(newTypeSectionRegex)];
            
            if (matches.length > 0) {
                // Find the end of the last [[newType]] section
                const lastMatch = matches[matches.length - 1];
                const afterLastSection = cargoTomlContent.substring(lastMatch.index!);
                const nextSectionMatch = afterLastSection.match(/\n\[\[?\w+\]?\]/);
                
                if (nextSectionMatch) {
                    const insertPos = lastMatch.index! + nextSectionMatch.index!;
                    cargoTomlContent = cargoTomlContent.substring(0, insertPos) + 
                                      targetEntry + 
                                      cargoTomlContent.substring(insertPos);
                } else {
                    // No next section, append at end
                    cargoTomlContent += targetEntry;
                }
            } else {
                // No existing section, append at end
                cargoTomlContent += targetEntry;
            }
            
            // Also update the manifest for consistency
            if (!manifest[newType as keyof CargoManifest]) {
                (manifest as any)[newType] = [];
            }
            const newSection = manifest[newType as keyof CargoManifest] as any[];
            if (Array.isArray(newSection)) {
                const exists = newSection.some((t: any) => t.name === item.name);
                if (!exists) {
                    newSection.push({
                        name: item.name,
                        path: item.path
                    });
                }
            }

            // Write back to Cargo.toml
            fs.writeFileSync(cargoTomlPath, cargoTomlContent, 'utf-8');
            console.log('Successfully wrote Cargo.toml');

        } catch (error) {
            console.error('Error reassigning target:', error);
            vscode.window.showErrorMessage(`Failed to reassign target: ${error}`);
        }
    }

    getTreeItem(element: CargoTreeItem): vscode.TreeItem {
        return element;
    }

    // Drag and Drop handlers
    async handleDrag(source: readonly CargoTreeItem[], dataTransfer: vscode.DataTransfer): Promise<void> {
        // Allow dragging any target items (bin, example, test, bench, unknown)
        const targetItems = source.filter(item => 
            item.contextValue === TreeItemContext.Target || 
            item.contextValue === TreeItemContext.UnknownTarget
        );
        
        if (targetItems.length > 0) {
            // Extract target data for each item
            const dragData = targetItems.map(item => {
                if (item.contextValue === TreeItemContext.UnknownTarget) {
                    return item.unknownData;
                } else if (item.target) {
                    // For regular targets, create data structure
                    return {
                        name: item.target.name,
                        path: item.target.path,
                        type: item.target.type, // bin, example, test, bench
                        memberName: item.workspaceMember
                    };
                }
                return null;
            }).filter(item => item !== null);
            
            if (dragData.length > 0) {
                dataTransfer.set(
                    'application/vnd.code.tree.cargoTreeView',
                    new vscode.DataTransferItem(dragData)
                );
            }
        }
    }

    async handleDrop(target: CargoTreeItem | undefined, dataTransfer: vscode.DataTransfer): Promise<void> {
        if (!target || target.contextValue !== TreeItemContext.TargetTypeFolder) {
            return; // Only allow dropping on target type folders
        }

        const transferItem = dataTransfer.get('application/vnd.code.tree.cargoTreeView');
        if (!transferItem) {
            return;
        }

        const droppedItems: any[] = transferItem.value;
        const newTargetType = target.categoryName as 'bin' | 'example' | 'test' | 'bench';

        if (!this.workspaceFolder || !droppedItems || droppedItems.length === 0) {
            return;
        }

        // Process each dropped item - just reassign type in Cargo.toml, don't move files
        for (const item of droppedItems) {
            await this.reassignTargetType(item, newTargetType);
        }

        // Refresh the tree
        this.refresh();
        vscode.window.showInformationMessage(`Reassigned ${droppedItems.length} target(s) to type: ${newTargetType}`);
    }

    public async registerUnknownTarget(unknown: UnregisteredItem, targetType: 'bin' | 'example' | 'test' | 'bench'): Promise<void> {
        if (!this.workspaceFolder || !unknown.path) {
            return;
        }

        // Ask if user wants to move the file
        const filename = path.basename(unknown.path);
        const targetDirName = targetType === 'bin' ? 'src/bin' : 
                             targetType === 'example' ? 'examples' :
                             targetType === 'test' ? 'tests' : 'benches';

        const moveChoice = await vscode.window.showQuickPick([
            { 
                label: '$(file-symlink-directory) Move', 
                description: `Move to ${targetDirName}/`, 
                value: 'move' 
            },
            { 
                label: '$(pinned) Keep in current location', 
                description: 'Register without moving', 
                value: 'keep' 
            }
        ], {
            title: `Move ${filename} to ${targetDirName}/ directory?`,
            placeHolder: 'Standard Cargo convention is to organize targets by type'
        });

        if (!moveChoice) {
            return; // User cancelled
        }

        const shouldMove = moveChoice.value === 'move';
        let finalPath = unknown.path;

        // Move the file if requested
        if (shouldMove) {
            const workspaceMembers = discoverWorkspaceMembers(this.workspaceFolder.uri.fsPath);
            let member = unknown.memberName 
                ? workspaceMembers.find(m => m.name === unknown.memberName)
                : undefined;
            
            // For single-crate packages, memberName might be set but member won't be found
            if (unknown.memberName && !member && workspaceMembers.length === 0) {
                console.log(`[registerUnknownTarget move] Member ${unknown.memberName} not found, treating as single-crate package (root)`);
                member = undefined;
            }
            
            const basePath = member 
                ? path.join(this.workspaceFolder.uri.fsPath, member.path)
                : this.workspaceFolder.uri.fsPath;
            const srcPath = path.join(basePath, 'src');
            const currentFilePath = path.join(basePath, unknown.path);
            
            // Check if source file exists
            if (!fs.existsSync(currentFilePath)) {
                vscode.window.showErrorMessage(`Source file not found: ${currentFilePath}`);
                return;
            }
            
            let targetDir: string;
            if (targetType === 'bin') {
                targetDir = path.join(srcPath, 'bin');
            } else if (targetType === 'example') {
                targetDir = path.join(basePath, 'examples');
            } else if (targetType === 'test') {
                targetDir = path.join(basePath, 'tests');
            } else {
                targetDir = path.join(basePath, 'benches');
            }

            const targetFilePath = path.join(targetDir, filename);
            
            // Check if already in target directory
            if (path.dirname(currentFilePath) === targetDir) {
                vscode.window.showInformationMessage(`${filename} is already in ${targetDirName}/`);
                // Just register it without moving
            } else {
                // Create directory if it doesn't exist
                if (!fs.existsSync(targetDir)) {
                    fs.mkdirSync(targetDir, { recursive: true });
                }

                // Check if target file already exists
                if (fs.existsSync(targetFilePath)) {
                    const overwrite = await vscode.window.showWarningMessage(
                        `File ${filename} already exists in ${targetDirName}/. Overwrite?`,
                        'Overwrite',
                        'Cancel'
                    );
                    if (overwrite !== 'Overwrite') {
                        return;
                    }
                }

                try {
                    fs.renameSync(currentFilePath, targetFilePath);
                    finalPath = path.relative(basePath, targetFilePath).replace(/\\/g, '/');
                    vscode.window.showInformationMessage(`Moved ${filename} to ${targetDirName}/`);
                } catch (error) {
                    vscode.window.showErrorMessage(`Failed to move file: ${error}`);
                    return;
                }
            }
        }

        // Add to Cargo.toml
        const itemToRegister: UnregisteredItem = {
            ...unknown,
            type: targetType,
            path: finalPath
        };

        console.log('[registerUnknownTarget] itemToRegister:', JSON.stringify(itemToRegister, null, 2));

        // We pass a no-op moveFile callback since we've already handled moving the file above
        const noOpMoveFile = async () => finalPath;
        await this.applyCargoTomlChangesFunc(this.workspaceFolder, [itemToRegister], noOpMoveFile);
        
        // Refresh the tree to remove the unknown item and show the new target
        this.refresh();
    }

    private getPackageNameAndVersion(workspacePath: string): { name: string; version: string } | null {
        // We read the package name and version from the root Cargo.toml (ignoring workspace members).
        const cargoTomlPath = path.join(workspacePath, 'Cargo.toml');
        try {
            const content = fs.readFileSync(cargoTomlPath, 'utf-8');
            const parsed = toml.parse(content) as CargoManifest;
            if (parsed.package?.name && parsed.package?.version) {
                return {
                    name: parsed.package.name,
                    version: parsed.package.version
                };
            }
        } catch (e) {
            // Silently fail if can't read Cargo.toml
        }
        return null;
    }

    private getMemberNameAndVersion(workspacePath: string, memberName: string): { name: string; version: string } | null {
        // We read the member's name and version from their Cargo.toml
        const workspaceMembers = discoverWorkspaceMembers(workspacePath);
        const member = workspaceMembers.find(m => m.name === memberName);
        
        if (!member) {
            return null;
        }

        const cargoTomlPath = path.join(workspacePath, member.path, 'Cargo.toml');
        try {
            const content = fs.readFileSync(cargoTomlPath, 'utf-8');
            const parsed = toml.parse(content) as CargoManifest;
            if (parsed.package?.name && parsed.package?.version) {
                return {
                    name: parsed.package.name,
                    version: parsed.package.version
                };
            }
        } catch (e) {
            // Silently fail if can't read Cargo.toml
        }
        return null;
    }

    getChildren(element?: CargoTreeItem): Thenable<CargoTreeItem[]> {
        const workspaceFolder = this.workspaceFolder;
        if (!workspaceFolder) {
            return Promise.resolve([]);
        }

        if (!element) {
            // Root level - show command categories and targets
            const items: CargoTreeItem[] = [];

            // Package header with name and version
            // We show either the root package info or workspace member info
            let projectInfo = this.getPackageNameAndVersion(workspaceFolder.uri.fsPath);
            console.log('[cargUI] Building header - selectedWorkspaceMember:', this.selectedWorkspaceMember);
            console.log('[cargUI] projectInfo:', projectInfo);
            
            // For workspace-only packages (no root package), use workspace name from folder
            let isWorkspaceOnly = false;
            if (!projectInfo) {
                const workspaceName = path.basename(workspaceFolder.uri.fsPath);
                projectInfo = { name: workspaceName, version: '0.0.0' };
                isWorkspaceOnly = true;
            }
            
            // We show the selected workspace member name in the package header if one is selected in multi-crate packages
            let headerLabel = isWorkspaceOnly ? projectInfo.name : `${projectInfo.name} (v${projectInfo.version})`;
            let headerDescription = '';
            // Default tooltip for workspace root (overridden if member selected)
            let tooltipText = `Workspace: ${projectInfo.name}`;
            
            console.log('[cargUI] About to check selectedWorkspaceMember:', this.selectedWorkspaceMember, 'against "all"');
            if (this.selectedWorkspaceMember && this.selectedWorkspaceMember !== 'all') {
                console.log('[cargUI] Getting member info for:', this.selectedWorkspaceMember);
                const memberInfo = this.getMemberNameAndVersion(workspaceFolder.uri.fsPath, this.selectedWorkspaceMember);
                console.log('[cargUI] Member info result:', memberInfo);
                if (memberInfo && memberInfo.version && typeof memberInfo.version === 'string') {
                    headerLabel = `${memberInfo.name} (v${memberInfo.version})`;
                    tooltipText = `Member: ${memberInfo.name}\nPackage: ${projectInfo.name}\nVersion: ${memberInfo.version}`;
                    headerDescription = `📦 ${this.selectedWorkspaceMember}`;
                    console.log('[cargUI] Updated header label to:', headerLabel);
                } else if (memberInfo) {
                    // If no version or version is invalid, just show the member name
                    headerLabel = memberInfo.name;
                    tooltipText = `Member: ${memberInfo.name}\nPackage: ${projectInfo.name}`;
                    headerDescription = `📦 ${this.selectedWorkspaceMember}`;
                }
            } else {
                console.log('[cargUI] NOT entering member info block - selectedWorkspaceMember:', this.selectedWorkspaceMember);
            }

            const projectItem = new CargoTreeItem(
                headerLabel,
                vscode.TreeItemCollapsibleState.None,
                TreeItemContext.ProjectHeader,
                { iconName: 'package' }
            );
            projectItem.description = '';
            projectItem.tooltip = tooltipText;
            
            // we set a VS Code context variable to track if a member is selected
            const hasMemberSelected = this.selectedWorkspaceMember && this.selectedWorkspaceMember !== 'all';
            vscode.commands.executeCommand('setContext', 'cargui.hasMemberSelected', hasMemberSelected);
            
            // we make the package header orange
            projectItem.iconPath = new vscode.ThemeIcon('package', new vscode.ThemeColor('charts.orange'));
            
            // we set the workspace member on the item so the command handler knows which member is selected
            if (hasMemberSelected) {
                projectItem.workspaceMember = this.selectedWorkspaceMember;
                // we mark this with a resourceUri so context menus can detect member selection
                projectItem.resourceUri = vscode.Uri.parse('cargui-workspace-member-header:selected');
            }
            // We add yellow color when showing workspace-only name (no root package) or when a member is selected
            if (isWorkspaceOnly || hasMemberSelected) {
                // (color is already set by resourceUri if member is selected, apply for workspace-only without member)
                if (!hasMemberSelected) {
                    projectItem.resourceUri = vscode.Uri.parse('cargui-workspace-member-header:workspace-only');
                }
            }
            // we only set a click command if there's a root Cargo.toml to open
            // pass just the member name if one is selected to avoid circular references
            projectItem.command = {
                title: 'Open Cargo.toml',
                command: 'cargui.openProjectCargoToml',
                arguments: [hasMemberSelected ? this.selectedWorkspaceMember : null]
            };
            items.push(projectItem);

            // Rust Edition indicator
            // Read edition from appropriate Cargo.toml based on selected member
            let memberEditionInfo;
            let workspaceEditionInfo = getCurrentEdition(workspaceFolder.uri.fsPath);
            
            if (this.selectedWorkspaceMember && this.selectedWorkspaceMember !== 'all') {
                // Get the member's edition
                const members = discoverWorkspaceMembers(workspaceFolder.uri.fsPath);
                const member = members.find(m => m.name === this.selectedWorkspaceMember);
                if (member) {
                    const memberPath = path.join(workspaceFolder.uri.fsPath, member.path);
                    memberEditionInfo = getCurrentEdition(memberPath);
                }
            }
            
            const editionInfo = memberEditionInfo || workspaceEditionInfo;
            if (editionInfo) {
                let displayLabel: string;
                let displayDescription: string = '';
                let tooltipText: string;
                
                // Use workspace edition from root if available
                const wsEdition = workspaceEditionInfo?.workspaceEdition;
                
                if (wsEdition) {
                    // Check if a workspace member is selected
                    if (this.selectedWorkspaceMember && this.selectedWorkspaceMember !== 'all') {
                        // Member is selected - show member edition in label, workspace in description
                        displayLabel = `Edition: ${editionInfo.edition}`;
                        displayDescription = `WS: ${wsEdition}`;
                        tooltipText = `Member edition: ${editionInfo.edition}\nWorkspace edition: ${wsEdition}\nClick to change edition`;
                    } else {
                        // No member selected (showing workspace root)
                        displayLabel = `Workspace Edition: ${wsEdition}`;
                        tooltipText = `Workspace edition: ${wsEdition}\nClick to change edition`;
                    }
                } else {
                    // Single-crate package
                    displayLabel = `Edition: ${editionInfo.edition}`;
                    tooltipText = `Rust edition: ${editionInfo.edition}\nClick to change edition`;
                }
                
                const editionItem = new CargoTreeItem(
                    displayLabel,
                    vscode.TreeItemCollapsibleState.None,
                    TreeItemContext.RustEdition,
                    { iconName: 'versions' }
                );
                
                editionItem.tooltip = tooltipText;
                editionItem.description = displayDescription;
                editionItem.command = {
                    command: 'cargui.changeEdition',
                    title: 'Change Rust Edition'
                };
                items.push(editionItem);
            }

            // Workspace Members (only show if multi-crate workspace)
            const workspaceMembers = discoverWorkspaceMembers(workspaceFolder.uri.fsPath);
            const isWorkspace = workspaceMembers.length > 0;
            
            // Set context for conditional UI elements
            vscode.commands.executeCommand('setContext', 'cargui.isWorkspace', isWorkspace);

            if (workspaceMembers.length > 1) {
                const workspaceLabel = this.selectedWorkspaceMember === 'all' 
                    ? 'WORKSPACE MEMBERS (All)' 
                    : this.selectedWorkspaceMember 
                        ? `WORKSPACE MEMBERS (${this.selectedWorkspaceMember})`
                        : 'WORKSPACE MEMBERS';
                const workspaceCategoryItem = new CargoTreeItem(workspaceLabel, vscode.TreeItemCollapsibleState.Collapsed, TreeItemContext.WorkspaceCategory, { iconName: 'repo' });
                workspaceCategoryItem.resourceUri = vscode.Uri.parse('cargui-workspace-category:workspace');
                // we make the workspace category icon orange
                workspaceCategoryItem.iconPath = new vscode.ThemeIcon('repo', new vscode.ThemeColor('charts.orange'));
                items.push(workspaceCategoryItem);
            }

            // Watch Mode indicator
            const watchLabel = this.isWatchMode ? `Watch: ${this.watchAction} (Active)` : 'Watch: Inactive';
            const watchItem = new CargoTreeItem(
                watchLabel,
                vscode.TreeItemCollapsibleState.None,
                TreeItemContext.WatchMode,
                { iconName: this.isWatchMode ? 'eye' : 'eye-closed' }
            );
            watchItem.description = this.isWatchMode ? '⚡' : '';
            watchItem.tooltip = this.isWatchMode 
                ? `Click to stop watching (${this.watchAction})`
                : 'Click to start watch mode';
            watchItem.command = {
                command: 'cargui.toggleWatch',
                title: 'Toggle Watch Mode'
            };
            items.push(watchItem);

            // MODULES
            // Count total modules and undeclared modules
            let totalModules = 0;
            let totalUndeclared = 0;
            const members = discoverWorkspaceMembers(workspaceFolder.uri.fsPath);
            if (members.length > 1) {
                // Multi-member workspace - count modules per member
                for (const member of members) {
                    const srcPath = path.join(workspaceFolder.uri.fsPath, member.path, 'src');
                    const modules = detectModules(srcPath);
                    totalModules += modules.length;
                    totalUndeclared += modules.filter(m => !m.isDeclared).length;
                }
            } else {
                // Single crate - count modules directly
                const srcPath = path.join(workspaceFolder.uri.fsPath, 'src');
                const modules = detectModules(srcPath);
                totalModules = modules.length;
                totalUndeclared = modules.filter(m => !m.isDeclared).length;
            }
            
            // we color icon red when undeclared modules exist
            const modulesItem = totalUndeclared > 0
                ? new CargoTreeItem('MODULES', vscode.TreeItemCollapsibleState.Collapsed, TreeItemContext.ModulesCategory)
                : new CargoTreeItem('MODULES', vscode.TreeItemCollapsibleState.Collapsed, TreeItemContext.ModulesCategory, { iconName: 'package' });
                
            modulesItem.description = `${totalModules}`;
            
            if (totalUndeclared > 0) {
                modulesItem.resourceUri = vscode.Uri.parse(`cargui-modules-category:has-undeclared`);
                modulesItem.iconPath = new vscode.ThemeIcon('package', new vscode.ThemeColor('charts.red'));
            }
            
            items.push(modulesItem);

            // Dependencies
            const dependencyMemberPath = this.selectedWorkspaceMember && this.selectedWorkspaceMember !== 'all'
                ? workspaceMembers.find(m => m.name === this.selectedWorkspaceMember)?.path
                : undefined;
            const dependencies = discoverCargoDependencies(workspaceFolder.uri.fsPath, dependencyMemberPath);
            const totalDeps = dependencies.workspace.length + dependencies.production.length + dependencies.dev.length + dependencies.build.length;
            // Always show dependencies section, even if empty
            const dependenciesItem = new CargoTreeItem('DEPENDENCIES', vscode.TreeItemCollapsibleState.Collapsed, TreeItemContext.DependenciesCategory);
            const checkedDepCount = this.checkedDependencies.size;
            dependenciesItem.description = `${totalDeps}${checkedDepCount > 0 ? ` ✓${checkedDepCount}` : ''}`;
            items.push(dependenciesItem);

            // Separator before config group
            const separator1 = new CargoTreeItem('', vscode.TreeItemCollapsibleState.None, TreeItemContext.Separator);
            separator1.description = '';
            separator1.tooltip = '';
            items.push(separator1);

            // SNAPSHOTS
            const config = vscode.workspace.getConfiguration('cargui');
            const snapshots = config.get<Snapshot[]>('snapshots') || [];
            const activeSnapshot = config.get<string>('activeSnapshot') || '';
            
            // Filter snapshots by current workspace context
            const contextFilteredSnapshots = snapshots.filter(snapshot => {
                if (!this.selectedWorkspaceMember) {
                    return !snapshot.workspaceMember;
                }
                return snapshot.workspaceMember === this.selectedWorkspaceMember;
            });
            
            const snapshotLabel = activeSnapshot ? `SNAPSHOTS (${activeSnapshot})` : 'SNAPSHOTS';
            const snapshotsItem = new CargoTreeItem(snapshotLabel, vscode.TreeItemCollapsibleState.Collapsed, TreeItemContext.SnapshotsCategory);
            if (!activeSnapshot && contextFilteredSnapshots.length > 0) {
                snapshotsItem.description = `${contextFilteredSnapshots.length}`;
            }
            items.push(snapshotsItem);

            // Mode indicator (moved under snapshots since it's snapshottable)
            items.push(new CargoTreeItem(
                this.isReleaseMode ? 'Mode: Release' : 'Mode: Debug',
                vscode.TreeItemCollapsibleState.None,
                TreeItemContext.Mode,
                { iconName: this.isReleaseMode ? 'rocket' : 'bug' }
            ));

            // Targets
            const targetMemberPath = this.selectedWorkspaceMember && this.selectedWorkspaceMember !== 'all' 
                ? workspaceMembers.find(m => m.name === this.selectedWorkspaceMember)?.path 
                : undefined;
            const targets = this.selectedWorkspaceMember === 'all' 
                ? [] 
                : discoverCargoTargets(workspaceFolder.uri.fsPath, targetMemberPath);
            const unknownTargets = this.selectedWorkspaceMember === 'all'
                ? []
                : this.detectUnregisteredTargetsFunc(workspaceFolder.uri.fsPath, targetMemberPath);
            if (targets.length > 0 || unknownTargets.length > 0) {
                // we color icon red when unknown targets exist
                const targetsItem = unknownTargets.length > 0
                    ? new CargoTreeItem('Targets', vscode.TreeItemCollapsibleState.Expanded, TreeItemContext.TargetsCategory)
                    : new CargoTreeItem('Targets', vscode.TreeItemCollapsibleState.Expanded, TreeItemContext.TargetsCategory, { iconName: 'folder' });
                    
                const checkedCount = targets.filter(t => this.checkedTargets.has(t.name)).length;
                targetsItem.description = `${targets.length}${checkedCount > 0 ? ` ✓${checkedCount}` : ''}`;
                if (checkedCount > 0) {
                    const checkedByType: { [key: string]: string[] } = {};
                    targets.forEach(t => {
                        if (this.checkedTargets.has(t.name)) {
                            if (!checkedByType[t.type]) checkedByType[t.type] = [];
                            checkedByType[t.type].push(t.name);
                        }
                    });
                    const tooltipLines = Object.entries(checkedByType).map(([type, names]) => `${type}: ${names.join(', ')}`);
                    targetsItem.tooltip = `Selected targets:\n${tooltipLines.join('\n')}`;
                }
                
                if (unknownTargets.length > 0) {
                    targetsItem.resourceUri = vscode.Uri.parse(`cargui-targets-category:has-unknowns`);
                    targetsItem.iconPath = new vscode.ThemeIcon('folder', new vscode.ThemeColor('charts.red'));
                    console.log('[cargUI] Targets category has', unknownTargets.length, 'unknown targets, resourceUri set');
                }
                
                items.push(targetsItem);
            }

            // Features
            const featureMemberPath = this.selectedWorkspaceMember && this.selectedWorkspaceMember !== 'all'
                ? workspaceMembers.find(m => m.name === this.selectedWorkspaceMember)?.path
                : undefined;
            // Don't show features when no member selected or 'all' selected - features are member-specific
            const features = (this.selectedWorkspaceMember === 'all' || !this.selectedWorkspaceMember)
                ? []
                : discoverCargoFeatures(workspaceFolder.uri.fsPath, featureMemberPath);
            const undeclaredFeatures = (this.selectedWorkspaceMember === 'all' || !this.selectedWorkspaceMember)
                ? []
                : detectUndeclaredFeatures(workspaceFolder.uri.fsPath, featureMemberPath);
            const totalFeatures = features.length + undeclaredFeatures.length;
            
            if (totalFeatures > 0) {
                // we color icon red when undeclared features exist
                const featuresItem = undeclaredFeatures.length > 0
                    ? new CargoTreeItem('Features', vscode.TreeItemCollapsibleState.Collapsed, TreeItemContext.FeaturesCategory)
                    : new CargoTreeItem('Features', vscode.TreeItemCollapsibleState.Collapsed, TreeItemContext.FeaturesCategory, { iconName: 'symbol-misc' });
                    
                const checkedCount = features.filter(f => this.checkedFeatures.has(f)).length + undeclaredFeatures.filter(f => this.checkedFeatures.has(f.name)).length;
                featuresItem.description = `${totalFeatures}${checkedCount > 0 ? ` ✓${checkedCount}` : ''}`;
                if (checkedCount > 0) {
                    const checkedFeatures = features.filter(f => this.checkedFeatures.has(f));
                    const checkedUndeclared = undeclaredFeatures.filter(f => this.checkedFeatures.has(f.name));
                    const allChecked = [...checkedFeatures, ...checkedUndeclared.map(f => f.name)];
                    featuresItem.tooltip = `Selected features:\n${allChecked.join('\n')}`;
                }
                
                // we store undeclared count to conditionally show "Declare Selected" in context menu
                if (undeclaredFeatures.length > 0) {
                    featuresItem.resourceUri = vscode.Uri.parse(`cargui-features-category:has-undeclared`);
                    featuresItem.iconPath = new vscode.ThemeIcon('symbol-misc', new vscode.ThemeColor('charts.red'));
                    console.log('[cargUI] Features category has', undeclaredFeatures.length, 'undeclared features, resourceUri set');
                }
                
                items.push(featuresItem);
            }

            // Arguments
            const args = config.get<string[]>('arguments') || [];
            const argCategories = config.get<ArgumentCategory[]>('argumentCategories') || [];
            const totalArgs = argCategories.reduce((sum, cat) => sum + cat.arguments.length, 0);
            const argumentsItem = new CargoTreeItem('Arguments', vscode.TreeItemCollapsibleState.Collapsed, TreeItemContext.ArgumentsCategory, { iconName: 'symbol-parameter' });
            const checkedArgCount = Array.from(this.checkedArguments).length;
            argumentsItem.description = `${totalArgs}${checkedArgCount > 0 ? ` ✓${checkedArgCount}` : ''}`;
            if (checkedArgCount > 0) {
                const checkedArgsByCategory: { [key: string]: string[] } = { 'uncategorized': [] };
                Array.from(this.checkedArguments).forEach(arg => {
                    let found = false;
                    for (const cat of argCategories) {
                        if (cat.arguments.includes(arg)) {
                            if (!checkedArgsByCategory[cat.name]) checkedArgsByCategory[cat.name] = [];
                            checkedArgsByCategory[cat.name].push(arg);
                            found = true;
                            break;
                        }
                    }
                    if (!found) {
                        checkedArgsByCategory['uncategorized'].push(arg);
                    }
                });
                const tooltipLines = Object.entries(checkedArgsByCategory)
                    .filter(([_, args]) => args.length > 0)
                    .map(([cat, args]) => `${cat}: ${args.join(', ')}`);
                argumentsItem.tooltip = `Selected arguments:\n${tooltipLines.join('\n')}`;
            }
            items.push(argumentsItem);

            // Environment Variables
            const envVars = config.get<string[]>('environmentVariables') || [];
            const envVarsItem = new CargoTreeItem('Environment Variables', vscode.TreeItemCollapsibleState.Collapsed, TreeItemContext.EnvVarsCategory, { iconName: 'symbol-variable' });
            const checkedEnvCount = Array.from(this.checkedEnvVars).length;
            envVarsItem.description = `${envVars.length}${checkedEnvCount > 0 ? ` ✓${checkedEnvCount}` : ''}`;
            if (checkedEnvCount > 0) {
                const checkedEnv = Array.from(this.checkedEnvVars);
                envVarsItem.tooltip = `Selected environment variables:\n${checkedEnv.join('\n')}`;
            }
            items.push(envVarsItem);

            // Separator before commands/deps group
            const separator2 = new CargoTreeItem('', vscode.TreeItemCollapsibleState.None, TreeItemContext.Separator);
            separator2.description = '';
            separator2.tooltip = '';
            items.push(separator2);

            // Custom Commands
            const customCommands = config.get<CustomCommand[]>('customCommands') || [];
            const customCommandsItem = new CargoTreeItem('CUSTOM COMMANDS', vscode.TreeItemCollapsibleState.Collapsed, TreeItemContext.CustomCommandsCategory, { iconName: 'terminal' });
            customCommandsItem.description = `${customCommands.length}`;
            items.push(customCommandsItem);

            return Promise.resolve(items);
        } else if (element.contextValue === TreeItemContext.WorkspaceCategory) {
            // Workspace category children - show all members
            const workspaceMembers = discoverWorkspaceMembers(workspaceFolder.uri.fsPath);
            const items: CargoTreeItem[] = [];
            
            // Add individual members (removed "All Members" item - use Check All button instead)
            for (const member of workspaceMembers) {
                const isSelected = this.selectedWorkspaceMember === member.name;
                const isDefault = !this.selectedWorkspaceMember && member.isRoot;
                
                // Use star-full icon for selected member, otherwise use default icons
                let iconName = 'package';
                if (isSelected || isDefault) {
                    iconName = 'star-full';
                } else if (member.isRoot) {
                    iconName = 'home';
                }
                
                const memberItem = new CargoTreeItem(
                    member.name,
                    vscode.TreeItemCollapsibleState.None,
                    TreeItemContext.WorkspaceMember,
                    {
                        iconName: iconName,
                        workspaceMember: member.name
                    }
                );
                memberItem.tooltip = `Path: ${member.path}\n${member.isRoot ? 'Root package' : 'Member package'}`;
                // Show relative path for non-root members
                if (!member.isRoot && member.path && member.path !== '.') {
                    memberItem.description = member.path;
                }
                
                // we set resourceUri on all members to enable context menu
                // selected members get a different uri for styling
                if (isSelected) {
                    memberItem.resourceUri = vscode.Uri.parse('cargui-workspace-deps:selected-member');
                    memberItem.iconPath = new vscode.ThemeIcon(iconName, new vscode.ThemeColor('charts.orange'));
                } else {
                    // unselected members also get the resourceUri so context menu works
                    memberItem.resourceUri = vscode.Uri.parse('cargui-workspace-deps:member');
                }
                
                // Make workspace members checkable
                const isChecked = this.checkedWorkspaceMembers.has(member.name);
                memberItem.checkboxState = isChecked 
                    ? vscode.TreeItemCheckboxState.Checked 
                    : vscode.TreeItemCheckboxState.Unchecked;
                
                // Clicking the label toggles the member selection (select/deselect)
                memberItem.command = {
                    command: 'cargui.toggleWorkspaceMember',
                    title: 'Toggle Workspace Member',
                    arguments: [member.name]
                };
                items.push(memberItem);
            }
            
            return Promise.resolve(items);
        } else if (element.contextValue === TreeItemContext.ModulesCategory) {
            // MODULES category children - scan for modules
            const items: CargoTreeItem[] = [];
            
            if (workspaceFolder) {
                // Check if it's a workspace with members
                const members = discoverWorkspaceMembers(workspaceFolder.uri.fsPath);
                
                if (members.length > 1) {
                    // Multi-member workspace
                    
                    // If a specific member is selected, show only that member's modules
                    if (this.selectedWorkspaceMember && this.selectedWorkspaceMember !== 'all') {
                        const selectedMember = members.find(m => m.name === this.selectedWorkspaceMember);
                        if (selectedMember) {
                            const srcPath = path.join(workspaceFolder.uri.fsPath, selectedMember.path, 'src');
                            const modules = detectModules(srcPath);
                            if (modules.length > 0) {
                                items.push(...buildModuleTree(modules, this.selectedWorkspaceMember, this.decorationProvider));
                            }
                        }
                    } else {
                        // Show modules per member (grouped by member)
                        for (const member of members) {
                            const srcPath = path.join(workspaceFolder.uri.fsPath, member.path, 'src');
                            const modules = detectModules(srcPath);
                            
                            if (modules.length > 0) {
                                // Create a member item
                                const memberItem = new CargoTreeItem(
                                    member.name,
                                    vscode.TreeItemCollapsibleState.Collapsed,
                                    TreeItemContext.ModuleMember,
                                    {
                                        iconName: 'package',
                                        workspaceMember: member.name,
                                        modules: modules
                                    }
                                );
                                memberItem.description = `${modules.length}`;
                                memberItem.tooltip = `Modules in ${member.name}`;
                                items.push(memberItem);
                            }
                        }
                    }
                } else {
                    // Single crate - show modules directly
                    const srcPath = path.join(workspaceFolder.uri.fsPath, 'src');
                    const modules = detectModules(srcPath);
                    
                    if (modules.length > 0) {
                        items.push(...buildModuleTree(modules, undefined, this.decorationProvider));
                    }
                }
            }
            
            if (items.length === 0) {
                const placeholderItem = new CargoTreeItem('No modules detected', vscode.TreeItemCollapsibleState.None, TreeItemContext.Placeholder, { iconName: 'info' });
                placeholderItem.description = '';
                items.push(placeholderItem);
            }
            
            return Promise.resolve(items);
        } else if (element.contextValue === TreeItemContext.ModuleMember) {
            // Module member children - show modules for this workspace member
            const modules = element.modules!;
            const workspaceMember = element.workspaceMember;
            return Promise.resolve(buildModuleTree(modules, workspaceMember, this.decorationProvider));
        } else if (element.contextValue === TreeItemContext.Module) {
            // Module children - show submodules
            const moduleInfo = element.moduleInfo!;
            const workspaceMember = element.workspaceMember;
            return Promise.resolve(buildModuleTree(moduleInfo.children, workspaceMember, this.decorationProvider));
        } else if (element.contextValue === TreeItemContext.SnapshotsCategory) {
            // SNAPSHOTS category children
            const config = vscode.workspace.getConfiguration('cargui');
            const snapshots = config.get<Snapshot[]>('snapshots') || [];
            const activeSnapshot = config.get<string>('activeSnapshot') || '';
            
            // Filter snapshots to match current workspace member context
            const filteredSnapshots = snapshots.filter(snapshot => {
                // If no workspace member is selected, show snapshots without workspace context
                if (!this.selectedWorkspaceMember) {
                    return !snapshot.workspaceMember;
                }
                // Show snapshots that match the current workspace member
                return snapshot.workspaceMember === this.selectedWorkspaceMember;
            });
            
            return Promise.resolve(filteredSnapshots.map(snapshot => {
                const item = new CargoTreeItem(
                    snapshot.name,
                    vscode.TreeItemCollapsibleState.None,
                    TreeItemContext.Snapshot,
                    {
                        iconName: 'symbol-namespace',
                        snapshot: snapshot.name
                    }
                );
                
                // Show active indicator
                if (snapshot.name === activeSnapshot) {
                    item.description = '✓ Active';
                }
                
            // Build tooltip with workspace information
            let tooltipText = '';
            
            if (snapshot.workspaceMember) {
                tooltipText = `Workspace Member: ${snapshot.workspaceMember}\nMode: ${snapshot.mode}`;
            } else {
                tooltipText = `Mode: ${snapshot.mode}`;
            }
            
            // Itemize targets
            if (snapshot.targets.length > 0) {
                tooltipText += `\n\nTargets (${snapshot.targets.length}):\n` + snapshot.targets.map(t => `  • ${t}`).join('\n');
            } else {
                tooltipText += `\n\nTargets: 0`;
            }
            
            // Itemize features
            if (snapshot.features.length > 0) {
                tooltipText += `\n\nFeatures (${snapshot.features.length}):\n` + snapshot.features.map(f => `  • ${f}`).join('\n');
            } else {
                tooltipText += `\n\nFeatures: 0`;
            }
            
            // Itemize arguments
            if (snapshot.arguments.length > 0) {
                tooltipText += `\n\nArguments (${snapshot.arguments.length}):\n` + snapshot.arguments.map(a => `  • ${a}`).join('\n');
            } else {
                tooltipText += `\n\nArguments: 0`;
            }
            
            // Itemize environment variables
            if (snapshot.envVars.length > 0) {
                tooltipText += `\n\nEnv Vars (${snapshot.envVars.length}):\n` + snapshot.envVars.map(e => `  • ${e}`).join('\n');
            } else {
                tooltipText += `\n\nEnv Vars: 0`;
            }
            
            if (snapshot.checkedWorkspaceMembers && snapshot.checkedWorkspaceMembers.length > 0) {
                tooltipText += `\n\nChecked Members (${snapshot.checkedWorkspaceMembers.length}):\n` + snapshot.checkedWorkspaceMembers.map(m => `  • ${m}`).join('\n');
            }
            
            item.tooltip = tooltipText;                return item;
            }));
        } else if (element.contextValue === TreeItemContext.EnvVarsCategory) {
            // Environment Variables category children
            const config = vscode.workspace.getConfiguration('cargui');
            const envVars = config.get<string[]>('environmentVariables') || [];
            
            return Promise.resolve(envVars.map(envVar => {
                // Extract KEY from KEY=VALUE for display label
                const displayLabel = envVar.split('=')[0];
                
                const item = new CargoTreeItem(
                    displayLabel,
                    vscode.TreeItemCollapsibleState.None,
                    TreeItemContext.EnvVar,
                    {
                        iconName: 'symbol-variable',
                        envVar: envVar
                    }
                );
                item.tooltip = `Environment Variable: ${envVar}`;
                item.description = ''; // Ensure description is set for proper rendering
                
                // Make env vars checkable
                const isChecked = this.checkedEnvVars.has(envVar);
                item.checkboxState = isChecked 
                    ? vscode.TreeItemCheckboxState.Checked 
                    : vscode.TreeItemCheckboxState.Unchecked;
                
                // Clicking the label toggles the checkbox
                item.command = {
                    command: 'cargui.toggleEnvVarCheck',
                    title: 'Toggle Environment Variable',
                    arguments: [envVar]
                };
                
                return item;
            }));
        } else if (element.contextValue === TreeItemContext.CustomCommandsCategory) {
            // Custom Commands category children - show uncategorized commands THEN subcategories
            const config = vscode.workspace.getConfiguration('cargui');
            const cmdCategories = config.get<CustomCommandCategory[]>('customCommandCategories') || [];
            const strays = config.get<CustomCommand[]>('customCommands') || [];
            
            const items: CargoTreeItem[] = [];
            
            // Add uncategorized commands FIRST
            items.push(...strays.map(cmd => {
                const item = new CargoTreeItem(
                    cmd.name,
                    vscode.TreeItemCollapsibleState.None,
                    TreeItemContext.CustomCommand,
                    {
                        iconName: 'terminal',
                        categoryName: cmd.name
                    }
                );
                item.tooltip = `Command: ${cmd.command}`;
                item.description = '';
                
                item.command = {
                    command: 'cargui.runCustomCommand',
                    title: 'Run Custom Command',
                    arguments: [cmd]
                };
                
                return item;
            }));
            
            // Add subcategories AFTER
            items.push(...cmdCategories.map(category => {
                const item = new CargoTreeItem(
                    category.name,
                    vscode.TreeItemCollapsibleState.Collapsed,
                    TreeItemContext.CustomCommandSubcategory,
                    {
                        iconName: 'folder',
                        categoryName: category.name
                    }
                );
                item.tooltip = `${category.name} (${category.commands.length} commands)`;
                item.description = `${category.commands.length}`;
                
                return item;
            }));
            
            return Promise.resolve(items);
        } else if (element.contextValue === TreeItemContext.CustomCommandSubcategory) {
            // Show commands within a subcategory
            const config = vscode.workspace.getConfiguration('cargui');
            const cmdCategories = config.get<CustomCommandCategory[]>('customCommandCategories') || [];
            const categoryName = element.categoryName;
            const category = cmdCategories.find(cat => cat.name === categoryName);
            
            if (!category) {
                return Promise.resolve([]);
            }
            
            return Promise.resolve(category.commands.map(cmd => {
                const item = new CargoTreeItem(
                    cmd.name,
                    vscode.TreeItemCollapsibleState.None,
                    TreeItemContext.CustomCommand,
                    {
                        iconName: 'terminal',
                        categoryName: cmd.name
                    }
                );
                item.tooltip = `Command: ${cmd.command}`;
                item.description = ''; // Ensure description is set for proper rendering
                
                // Clicking runs the command
                item.command = {
                    command: 'cargui.runCustomCommand',
                    title: 'Run Custom Command',
                    arguments: [cmd]
                };
                
                return item;
            }));
        } else if (element.contextValue === TreeItemContext.ArgumentsCategory) {
            // Arguments category children - show uncategorized arguments first, then subcategories
            const config = vscode.workspace.getConfiguration('cargui');
            const argCategories = config.get<ArgumentCategory[]>('argumentCategories') || [];
            const strays = config.get<string[]>('arguments') || [];
            
            const items: CargoTreeItem[] = [];
            
            // Add uncategorized arguments first
            items.push(...strays.map(arg => {
                const displayLabel = arg.startsWith('--') ? arg.substring(2) : arg;
                
                const item = new CargoTreeItem(
                    displayLabel,
                    vscode.TreeItemCollapsibleState.None,
                    TreeItemContext.Argument,
                    {
                        iconName: 'symbol-constant',
                        argument: arg
                    }
                );
                item.tooltip = `Argument: ${arg}`;
                item.description = '';
                
                const isChecked = this.checkedArguments.has(arg);
                item.checkboxState = isChecked 
                    ? vscode.TreeItemCheckboxState.Checked 
                    : vscode.TreeItemCheckboxState.Unchecked;
                
                item.command = {
                    command: 'cargui.toggleArgumentCheck',
                    title: 'Toggle Argument',
                    arguments: [arg]
                };
                
                return item;
            }));
            
            // Add subcategories
            items.push(...argCategories.map(category => {
                const checkedCount = category.arguments.filter(arg => this.checkedArguments.has(arg)).length;
                const item = new CargoTreeItem(
                    category.name,
                    vscode.TreeItemCollapsibleState.Collapsed,
                    TreeItemContext.ArgumentSubcategory,
                    {
                        iconName: 'folder',
                        categoryName: category.name
                    }
                );
                item.tooltip = `${category.name} (${category.arguments.length} arguments)`;
                item.description = `${category.arguments.length}${checkedCount > 0 ? ` ✓${checkedCount}` : ''}`;
                
                return item;
            }));
            
            return Promise.resolve(items);
        } else if (element.contextValue === TreeItemContext.ArgumentSubcategory) {
            // Show arguments within a subcategory
            const config = vscode.workspace.getConfiguration('cargui');
            const argCategories = config.get<ArgumentCategory[]>('argumentCategories') || [];
            const categoryName = element.categoryName;
            const category = argCategories.find(cat => cat.name === categoryName);
            
            if (!category) {
                return Promise.resolve([]);
            }
            
            return Promise.resolve(category.arguments.map(arg => {
                // Display label without '--' prefix for cleaner UI
                const displayLabel = arg.startsWith('--') ? arg.substring(2) : arg;
                
                const item = new CargoTreeItem(
                    displayLabel,
                    vscode.TreeItemCollapsibleState.None,
                    TreeItemContext.Argument,
                    {
                        iconName: 'symbol-constant',
                        argument: arg
                    }
                );
                item.tooltip = `Argument: ${arg}`;
                item.description = ''; // Ensure description is set for proper rendering
                
                // Make arguments checkable
                const isChecked = this.checkedArguments.has(arg);
                item.checkboxState = isChecked 
                    ? vscode.TreeItemCheckboxState.Checked 
                    : vscode.TreeItemCheckboxState.Unchecked;
                
                // Clicking the label toggles the checkbox
                item.command = {
                    command: 'cargui.toggleArgumentCheck',
                    title: 'Toggle Argument',
                    arguments: [arg]
                };
                
                return item;
            }));
        } else if (element.contextValue === TreeItemContext.FeaturesCategory) {
            // Features category children
            const workspaceMembers = discoverWorkspaceMembers(workspaceFolder.uri.fsPath);
            const featureMemberPath = this.selectedWorkspaceMember && this.selectedWorkspaceMember !== 'all'
                ? workspaceMembers.find(m => m.name === this.selectedWorkspaceMember)?.path
                : undefined;
            const features = discoverCargoFeatures(workspaceFolder.uri.fsPath, featureMemberPath);
            const undeclaredFeatures = detectUndeclaredFeatures(workspaceFolder.uri.fsPath, featureMemberPath);
            
            const allFeatureItems = [
                ...features.map(feature => {
                    const item = new CargoTreeItem(
                        feature,
                        vscode.TreeItemCollapsibleState.None,
                        TreeItemContext.Feature,
                        {
                            iconName: 'symbol-key',
                            feature: feature
                        }
                    );
                    item.tooltip = `Feature: ${feature}`;
                    
                    // Make features checkable
                    const isChecked = this.checkedFeatures.has(feature);
                    item.checkboxState = isChecked 
                        ? vscode.TreeItemCheckboxState.Checked 
                        : vscode.TreeItemCheckboxState.Unchecked;
                    
                    // we find where the feature is used in code and open that file/line
                    item.command = {
                        command: 'cargui.viewFeatureUsage',
                        title: 'View Feature Usage',
                        arguments: [feature, featureMemberPath]
                    };
                    
                    return item;
                }),
                ...undeclaredFeatures.map(feature => {
                    const item = new CargoTreeItem(
                        feature.name,
                        vscode.TreeItemCollapsibleState.None,
                        TreeItemContext.UndeclaredFeature,
                        {
                            iconName: 'symbol-key',
                            feature: feature.name
                        }
                    );
                    item.tooltip = `Undeclared feature: ${feature.name}\nAdd to [features] section in Cargo.toml`;
                    
                    // we apply red coloring to undeclared features (both icon and text)
                    item.iconPath = new vscode.ThemeIcon('symbol-key', new vscode.ThemeColor('charts.red'));
                    item.resourceUri = vscode.Uri.parse(`cargui-feature:undeclared-${feature.name}`);
                    if (this.decorationProvider) {
                        this.decorationProvider.setTargetColor(`undeclared-${feature.name}`, 'charts.red');
                    }
                    
                    // Make features checkable
                    const isChecked = this.checkedFeatures.has(feature.name);
                    item.checkboxState = isChecked 
                        ? vscode.TreeItemCheckboxState.Checked 
                        : vscode.TreeItemCheckboxState.Unchecked;
                    
                    // we find where the feature is used in code and open that file/line
                    item.command = {
                        command: 'cargui.viewFeatureUsage',
                        title: 'View Feature Usage',
                        arguments: [feature.name, featureMemberPath]
                    };
                    
                    return item;
                })
            ];
            
            return Promise.resolve(allFeatureItems);
        } else if (element.contextValue === TreeItemContext.DependenciesCategory) {
            // Dependencies category children - show subfolders (WORKSPACE/Production/Dev/Build)
            const items: CargoTreeItem[] = [];
            
            const workspaceMembers = discoverWorkspaceMembers(workspaceFolder.uri.fsPath);
            const dependencyMemberPath = this.selectedWorkspaceMember && this.selectedWorkspaceMember !== 'all'
                ? workspaceMembers.find(m => m.name === this.selectedWorkspaceMember)?.path
                : undefined;
            const dependencies = discoverCargoDependencies(workspaceFolder.uri.fsPath, dependencyMemberPath);
            
            // WORKSPACE subfolder (always present if workspace deps exist)
            if (dependencies.workspace.length > 0) {
                const workspaceItem = new CargoTreeItem('WORKSPACE', vscode.TreeItemCollapsibleState.Collapsed, TreeItemContext.DependencyTypeFolderWorkspace, {
                    iconName: 'star-full',
                    categoryName: 'workspace'
                });
                // Color the star icon orange
                workspaceItem.iconPath = new vscode.ThemeIcon('star-full', new vscode.ThemeColor('charts.orange'));
                const checkedCount = dependencies.workspace.filter(d => this.checkedDependencies.has(`workspace:${d.name}`)).length;
                workspaceItem.description = `${dependencies.workspace.length}${checkedCount > 0 ? ` ✓${checkedCount}` : ''}`;
                if (checkedCount > 0) {
                    const checkedDeps = dependencies.workspace.filter(d => this.checkedDependencies.has(`workspace:${d.name}`)).map(d => d.name);
                    workspaceItem.tooltip = `Selected workspace dependencies:\n${checkedDeps.join('\n')}`;
                }
                // Color workspace category orange
                workspaceItem.resourceUri = vscode.Uri.parse(`cargui-workspace-deps:workspace-category`);
                items.push(workspaceItem);
            }
            
            // Production subfolder (only if member selected and has production deps)
            if (dependencies.production.length > 0) {
                const productionItem = new CargoTreeItem('Production', vscode.TreeItemCollapsibleState.Collapsed, TreeItemContext.DependencyTypeFolderProduction, {
                    iconName: 'package',
                    categoryName: 'production'
                });
                const checkedCount = dependencies.production.filter(d => this.checkedDependencies.has(`production:${d.name}`)).length;
                productionItem.description = `${dependencies.production.length}${checkedCount > 0 ? ` ✓${checkedCount}` : ''}`;
                if (checkedCount > 0) {
                    const checkedDeps = dependencies.production.filter(d => this.checkedDependencies.has(`production:${d.name}`)).map(d => d.name);
                    productionItem.tooltip = `Selected production dependencies:\n${checkedDeps.join('\n')}`;
                }
                items.push(productionItem);
            }
            
            // Dev subfolder (only if member selected and has dev deps)
            if (dependencies.dev.length > 0) {
                const devItem = new CargoTreeItem('Dev', vscode.TreeItemCollapsibleState.Collapsed, TreeItemContext.DependencyTypeFolderDev, {
                    iconName: 'beaker',
                    categoryName: 'dev'
                });
                const checkedCount = dependencies.dev.filter(d => this.checkedDependencies.has(`dev:${d.name}`)).length;
                devItem.description = `${dependencies.dev.length}${checkedCount > 0 ? ` ✓${checkedCount}` : ''}`;
                if (checkedCount > 0) {
                    const checkedDeps = dependencies.dev.filter(d => this.checkedDependencies.has(`dev:${d.name}`)).map(d => d.name);
                    devItem.tooltip = `Selected dev dependencies:\n${checkedDeps.join('\n')}`;
                }
                items.push(devItem);
            }
            
            // Build subfolder (only if member selected and has build deps)
            if (dependencies.build.length > 0) {
                const buildItem = new CargoTreeItem('Build', vscode.TreeItemCollapsibleState.Collapsed, TreeItemContext.DependencyTypeFolderBuild, {
                    iconName: 'tools',
                    categoryName: 'build'
                });
                const checkedCount = dependencies.build.filter(d => this.checkedDependencies.has(`build:${d.name}`)).length;
                buildItem.description = `${dependencies.build.length}${checkedCount > 0 ? ` ✓${checkedCount}` : ''}`;
                if (checkedCount > 0) {
                    const checkedDeps = dependencies.build.filter(d => this.checkedDependencies.has(`build:${d.name}`)).map(d => d.name);
                    buildItem.tooltip = `Selected build dependencies:\n${checkedDeps.join('\n')}`;
                }
                items.push(buildItem);
            }
            
            return Promise.resolve(items);
        } else if (element.contextValue === TreeItemContext.TargetsCategory) {
            // Targets category children - show subfolders by type
            const items: CargoTreeItem[] = [];
            
            // Get all targets to count by type
            const workspaceMembers = discoverWorkspaceMembers(workspaceFolder.uri.fsPath);
            const targetMemberPath = this.selectedWorkspaceMember && this.selectedWorkspaceMember !== 'all'
                ? workspaceMembers.find(m => m.name === this.selectedWorkspaceMember)?.path
                : undefined;
            const allTargets = discoverCargoTargets(workspaceFolder.uri.fsPath, targetMemberPath);
            
            // Count targets by type
            const libCount = allTargets.filter(t => t.type === 'lib').length;
            const binCount = allTargets.filter(t => t.type === 'bin').length;
            const exampleCount = allTargets.filter(t => t.type === 'example').length;
            const testCount = allTargets.filter(t => t.type === 'test').length;
            const benchCount = allTargets.filter(t => t.type === 'bench').length;
            
            // Add target type subfolders (only if they have items)
            if (libCount > 0) {
                const libItem = new CargoTreeItem('Libraries', vscode.TreeItemCollapsibleState.Collapsed, TreeItemContext.TargetTypeFolder, {
                    iconName: 'library',
                    categoryName: 'lib'
                });
                const checkedLibs = allTargets.filter(t => t.type === 'lib' && this.checkedTargets.has(t.name));
                libItem.description = `${libCount}${checkedLibs.length > 0 ? ` ✓${checkedLibs.length}` : ''}`;
                if (checkedLibs.length > 0) {
                    libItem.tooltip = `Selected libraries:\n${checkedLibs.map(t => t.name).join('\n')}`;
                }
                items.push(libItem);
            }
            if (binCount > 0) {
                const binItem = new CargoTreeItem('Binaries', vscode.TreeItemCollapsibleState.Collapsed, TreeItemContext.TargetTypeFolder, {
                    iconName: 'file-binary',
                    categoryName: 'bin'
                });
                const checkedBins = allTargets.filter(t => t.type === 'bin' && this.checkedTargets.has(t.name));
                binItem.description = `${binCount}${checkedBins.length > 0 ? ` ✓${checkedBins.length}` : ''}`;
                if (checkedBins.length > 0) {
                    binItem.tooltip = `Selected binaries:\n${checkedBins.map(t => t.name).join('\n')}`;
                }
                items.push(binItem);
            }
            if (exampleCount > 0) {
                const exampleItem = new CargoTreeItem('Examples', vscode.TreeItemCollapsibleState.Collapsed, TreeItemContext.TargetTypeFolder, {
                    iconName: 'note',
                    categoryName: 'example'
                });
                const checkedExamples = allTargets.filter(t => t.type === 'example' && this.checkedTargets.has(t.name));
                exampleItem.description = `${exampleCount}${checkedExamples.length > 0 ? ` ✓${checkedExamples.length}` : ''}`;
                if (checkedExamples.length > 0) {
                    exampleItem.tooltip = `Selected examples:\n${checkedExamples.map(t => t.name).join('\n')}`;
                }
                items.push(exampleItem);
            }
            if (testCount > 0) {
                const testItem = new CargoTreeItem('Tests', vscode.TreeItemCollapsibleState.Collapsed, TreeItemContext.TargetTypeFolder, {
                    iconName: 'beaker',
                    categoryName: 'test'
                });
                const checkedTests = allTargets.filter(t => t.type === 'test' && this.checkedTargets.has(t.name));
                testItem.description = `${testCount}${checkedTests.length > 0 ? ` ✓${checkedTests.length}` : ''}`;
                if (checkedTests.length > 0) {
                    testItem.tooltip = `Selected tests:\n${checkedTests.map(t => t.name).join('\n')}`;
                }
                items.push(testItem);
            }
            if (benchCount > 0) {
                const benchItem = new CargoTreeItem('Benchmarks', vscode.TreeItemCollapsibleState.Collapsed, TreeItemContext.TargetTypeFolder, {
                    iconName: 'dashboard',
                    categoryName: 'bench'
                });
                const checkedBenches = allTargets.filter(t => t.type === 'bench' && this.checkedTargets.has(t.name));
                benchItem.description = `${benchCount}${checkedBenches.length > 0 ? ` ✓${checkedBenches.length}` : ''}`;
                if (checkedBenches.length > 0) {
                    benchItem.tooltip = `Selected benchmarks:\n${checkedBenches.map(t => t.name).join('\n')}`;
                }
                items.push(benchItem);
            }
            
            // Add Unknowns folder if there are unregistered targets
            const unknownTargets = this.detectUnregisteredTargetsFunc(workspaceFolder.uri.fsPath, targetMemberPath);
            
            if (unknownTargets.length > 0) {
                const unknownsItem = new CargoTreeItem(
                    `Unknowns (${unknownTargets.length})`, 
                    vscode.TreeItemCollapsibleState.Expanded,  // Auto-expand
                    TreeItemContext.UnknownsFolder, 
                    { iconName: 'warning' }
                );
                unknownsItem.tooltip = `${unknownTargets.length} unregistered .rs file(s) found`;
                
                // Apply red coloring to match the unknown target items
                unknownsItem.resourceUri = vscode.Uri.parse('cargui-target:unknowns-folder');
                if (this.decorationProvider) {
                    this.decorationProvider.setTargetColor('unknowns-folder', 'charts.red');
                }
                
                items.push(unknownsItem);
            }
            
            return Promise.resolve(items);
        } else if (element.contextValue === TreeItemContext.TargetTypeFolder) {
            // Show targets of a specific type
            const targetType = element.categoryName as 'lib' | 'bin' | 'example' | 'test' | 'bench';
            const workspaceMembers = discoverWorkspaceMembers(workspaceFolder.uri.fsPath);
            const targetMemberPath = this.selectedWorkspaceMember && this.selectedWorkspaceMember !== 'all'
                ? workspaceMembers.find(m => m.name === this.selectedWorkspaceMember)?.path
                : undefined;
            const allTargets = discoverCargoTargets(workspaceFolder.uri.fsPath, targetMemberPath);
            const targets = allTargets.filter(t => t.type === targetType);
            
            // Helper function to determine target status for color coding
            const getTargetStatus = (target: CargoTarget): {
                color: string | undefined;
                reason?: string;
            } => {
                if (!target.path) {
                    return { color: 'charts.red', reason: 'Unknown path' }; // Unknown - no path
                }

                // Check if file exists
                const memberPath = targetMemberPath ? path.join(workspaceFolder.uri.fsPath, targetMemberPath) : workspaceFolder.uri.fsPath;
                const fullPath = path.join(memberPath, target.path);
                if (!fs.existsSync(fullPath)) {
                    return { color: 'terminal.ansiBrightYellow', reason: '⚠️ File does not exist (but declared in Cargo.toml)' };
                }

                // Determine standard location based on target type
                let standardLocations: string[] = [];
                const filename = path.basename(target.path);
                const normalizedPath = target.path.replace(/\\/g, '/');
                const pathDir = path.dirname(normalizedPath);
                
                // Check if the target name matches the file stem (without extension)
                // Cargo treats hyphens and underscores as equivalent in target names
                const fileStem = filename.replace(/\.rs$/, '');
                const normalizedName = target.name.replace(/-/g, '_');
                const normalizedFileStem = fileStem.replace(/-/g, '_');
                const nameMatchesFile = normalizedName === normalizedFileStem || target.name === 'main' || target.name === 'lib';
                
                if (target.type === 'lib') {
                    // Libraries are always at src/lib.rs (standard location)
                    if (normalizedPath === 'src/lib.rs') {
                        return { color: undefined }; // Standard location - no color
                    } else {
                        return { color: 'charts.purple', reason: '🟪 Custom location (not in standard directory)' }; // Custom location
                    }
                } else if (target.type === 'bin') {
                    if (target.path === 'src/main.rs') {
                        standardLocations = ['src/main.rs'];
                    } else {
                        standardLocations = [`src/bin/${filename}`];
                    }
                    
                    // Check if bin is in wrong location (e.g., in examples/, tests/, benches/)
                    if (pathDir.startsWith('examples')) {
                        const wrongDir = 'declared as bin but file located in std directory of examples';
                        const nameMismatch = `Target name "${target.name}" doesn't match filename "${fileStem}"`;
                        const reason = !nameMatchesFile ? `INVALID Cargo.toml declaration: ${nameMismatch} AND ${wrongDir}` : `INVALID Cargo.toml declaration: Declared as bin but file located in std directory of examples`;
                        return { color: 'charts.yellow', reason };
                    } else if (pathDir.startsWith('tests')) {
                        const wrongDir = 'declared as bin but file located in std directory of tests';
                        const nameMismatch = `Target name "${target.name}" doesn't match filename "${fileStem}"`;
                        const reason = !nameMatchesFile ? `INVALID Cargo.toml declaration: ${nameMismatch} AND ${wrongDir}` : `INVALID Cargo.toml declaration: Declared as bin but file located in std directory of tests`;
                        return { color: 'charts.yellow', reason };
                    } else if (pathDir.startsWith('benches')) {
                        const wrongDir = 'declared as bin but file located in std directory of benches';
                        const nameMismatch = `Target name "${target.name}" doesn't match filename "${fileStem}"`;
                        const reason = !nameMatchesFile ? `INVALID Cargo.toml declaration: ${nameMismatch} AND ${wrongDir}` : `INVALID Cargo.toml declaration: Declared as bin but file located in std directory of benches`;
                        return { color: 'charts.yellow', reason };
                    }
                } else if (target.type === 'example') {
                    // Examples can be in examples/ directory (single file or directory with main.rs)
                    // Check if it's anywhere in the examples/ folder - that's standard
                    if (pathDir.startsWith('examples')) {
                        // Check if name matches file
                        if (!nameMatchesFile) {
                            return { color: 'charts.yellow', reason: `INVALID Cargo.toml declaration: Target name "${target.name}" doesn't match filename "${fileStem}"` };
                        }
                        return { color: undefined }; // Standard location - no color
                    }
                    
                    // Check if example is in wrong location
                    if (pathDir.startsWith('src/bin')) {
                        const wrongDir = 'declared as example but file located in std directory of bins';
                        const nameMismatch = `Target name "${target.name}" doesn't match filename "${fileStem}"`;
                        const reason = !nameMatchesFile ? `INVALID Cargo.toml declaration: ${nameMismatch} AND ${wrongDir}` : `INVALID Cargo.toml declaration: Declared as example but file located in std directory of bins`;
                        return { color: 'charts.yellow', reason };
                    } else if (pathDir.startsWith('tests')) {
                        const wrongDir = 'declared as example but file located in std directory of tests';
                        const nameMismatch = `Target name "${target.name}" doesn't match filename "${fileStem}"`;
                        const reason = !nameMatchesFile ? `INVALID Cargo.toml declaration: ${nameMismatch} AND ${wrongDir}` : `INVALID Cargo.toml declaration: Declared as example but file located in std directory of tests`;
                        return { color: 'charts.yellow', reason };
                    } else if (pathDir.startsWith('benches')) {
                        const wrongDir = 'declared as example but file located in std directory of benches';
                        const nameMismatch = `Target name "${target.name}" doesn't match filename "${fileStem}"`;
                        const reason = !nameMatchesFile ? `INVALID Cargo.toml declaration: ${nameMismatch} AND ${wrongDir}` : `INVALID Cargo.toml declaration: Declared as example but file located in std directory of benches`;
                        return { color: 'charts.yellow', reason };
                    }
                } else if (target.type === 'test') {
                    // Tests can be in tests/ directory (single file or directory with main.rs)
                    if (pathDir.startsWith('tests')) {
                        // Check if name matches file
                        if (!nameMatchesFile) {
                            return { color: 'charts.yellow', reason: `INVALID Cargo.toml declaration: Target name "${target.name}" doesn't match filename "${fileStem}"` };
                        }
                        return { color: undefined }; // Standard location - no color
                    }
                    
                    // Check if test is in wrong location
                    if (pathDir.startsWith('src/bin')) {
                        const wrongDir = 'declared as test but file located in std directory of bins';
                        const nameMismatch = `Target name "${target.name}" doesn't match filename "${fileStem}"`;
                        const reason = !nameMatchesFile ? `INVALID Cargo.toml declaration: ${nameMismatch} AND ${wrongDir}` : `INVALID Cargo.toml declaration: Declared as test but file located in std directory of bins`;
                        return { color: 'charts.yellow', reason };
                    } else if (pathDir.startsWith('examples')) {
                        const wrongDir = 'declared as test but file located in std directory of examples';
                        const nameMismatch = `Target name "${target.name}" doesn't match filename "${fileStem}"`;
                        const reason = !nameMatchesFile ? `INVALID Cargo.toml declaration: ${nameMismatch} AND ${wrongDir}` : `INVALID Cargo.toml declaration: Declared as test but file located in std directory of examples`;
                        return { color: 'charts.yellow', reason };
                    } else if (pathDir.startsWith('benches')) {
                        const wrongDir = 'declared as test but file located in std directory of benches';
                        const nameMismatch = `Target name "${target.name}" doesn't match filename "${fileStem}"`;
                        const reason = !nameMatchesFile ? `INVALID Cargo.toml declaration: ${nameMismatch} AND ${wrongDir}` : `INVALID Cargo.toml declaration: Declared as test but file located in std directory of benches`;
                        return { color: 'charts.yellow', reason };
                    }
                } else if (target.type === 'bench') {
                    // Benches can be in benches/ directory (single file or directory with main.rs)
                    if (pathDir.startsWith('benches')) {
                        // Check if name matches file
                        if (!nameMatchesFile) {
                            return { color: 'charts.yellow', reason: `INVALID Cargo.toml declaration: Target name "${target.name}" doesn't match filename "${fileStem}"` };
                        }
                        return { color: undefined }; // Standard location - no color
                    }
                    
                    // Check if bench is in wrong location
                    if (pathDir.startsWith('src/bin')) {
                        const wrongDir = 'declared as bench but file located in std directory of bins';
                        const nameMismatch = `Target name "${target.name}" doesn't match filename "${fileStem}"`;
                        const reason = !nameMatchesFile ? `INVALID Cargo.toml declaration: ${nameMismatch} AND ${wrongDir}` : `INVALID Cargo.toml declaration: Declared as bench but file located in std directory of bins`;
                        return { color: 'charts.yellow', reason };
                    } else if (pathDir.startsWith('examples')) {
                        const wrongDir = 'declared as bench but file located in std directory of examples';
                        const nameMismatch = `Target name "${target.name}" doesn't match filename "${fileStem}"`;
                        const reason = !nameMatchesFile ? `INVALID Cargo.toml declaration: ${nameMismatch} AND ${wrongDir}` : `INVALID Cargo.toml declaration: Declared as bench but file located in std directory of examples`;
                        return { color: 'charts.yellow', reason };
                    } else if (pathDir.startsWith('tests')) {
                        const wrongDir = 'declared as bench but file located in std directory of tests';
                        const nameMismatch = `Target name "${target.name}" doesn't match filename "${fileStem}"`;
                        const reason = !nameMatchesFile ? `INVALID Cargo.toml declaration: ${nameMismatch} AND ${wrongDir}` : `INVALID Cargo.toml declaration: Declared as bench but file located in std directory of tests`;
                        return { color: 'charts.yellow', reason };
                    }
                }

            // Check if target is in a standard location (for bins)
            const isStandard = standardLocations.some(loc => normalizedPath === loc.replace(/\\/g, '/'));
            
            if (isStandard) {
                // Target is correctly declared and in standard location
                // But check if name matches file
                if (!nameMatchesFile && target.path !== 'src/main.rs' && target.path !== 'src/lib.rs') {
                    return { color: 'charts.yellow', reason: `INVALID Cargo.toml declaration: Target name "${target.name}" doesn't match filename "${fileStem}"` };
                }
                return { color: undefined }; // No color (default)
            } else {
                // Target is declared but in custom location (purple for custom, regardless of name)
                return { color: 'charts.purple', reason: '🟪 Custom location (not in standard directory)' };
            }
        };            return Promise.resolve(targets.map(target => {
                const isMainTarget = target.type === 'bin' && target.path === 'src/main.rs';
                const isMainLibrary = target.type === 'lib' && target.path === 'src/lib.rs';
                const targetStatus = getTargetStatus(target);
                
                let icon = 'file';
                if (target.type === 'lib') {
                    icon = isMainLibrary ? 'star-full' : 'library';
                } else if (target.type === 'bin') {
                    icon = isMainTarget ? 'star-full' : 'file-binary';
                } else if (target.type === 'example') {
                    icon = 'note';
                } else if (target.type === 'test') {
                    icon = 'beaker';
                } else if (target.type === 'bench') {
                    icon = 'dashboard';
                }
                
                const item = new CargoTreeItem(
                    target.name,
                    vscode.TreeItemCollapsibleState.None,
                    target.autoDiscovered 
                        ? 'target-autodiscovered'
                        : (targetStatus.color === 'terminal.ansiBrightYellow' ? 'target-missing'
                        : (targetStatus.color === 'charts.yellow' ? 'target-yellow' : TreeItemContext.Target)),
                    {
                        iconName: icon,
                        target: target
                    }
                );
                
                // We analyze target file for documentation health
                const memberPath = this.selectedWorkspaceMember && this.selectedWorkspaceMember !== 'all'
                    ? discoverWorkspaceMembers(workspaceFolder.uri.fsPath).find(m => m.name === this.selectedWorkspaceMember)?.path
                    : undefined;
                const basePath = memberPath ? path.join(workspaceFolder.uri.fsPath, memberPath) : workspaceFolder.uri.fsPath;
                const targetFilePath = path.join(basePath, target.path || '');
                const { hasHeader, hasIncorrectHeader, totalElements, documentedElements } = analyzeTargetFile(targetFilePath);
                const healthColor = calculateTargetHealthColor(hasHeader, totalElements, documentedElements);
                
                // Calculate health percentage for description
                let healthPercent = '';
                if (totalElements > 0) {
                    const headerItem = 1;
                    const totalItems = headerItem + totalElements;
                    const hasHeaderCount = hasHeader ? 1 : 0;
                    const documentedCount = hasHeaderCount + documentedElements;
                    healthPercent = ((documentedCount / totalItems) * 100).toFixed(0) + '%';
                }
                
                // Set description to health percentage (or path for main targets)
                item.description = healthPercent || ((isMainTarget || isMainLibrary) ? target.path : target.path);
                
                // Create tooltip with validation warning and health info
                let tooltipText = target.path || target.name;
                if (target.autoDiscovered) {
                    tooltipText += '\n💡 Not declared in Cargo.toml (auto-discovered)';
                }
                if (targetStatus.reason) {
                    // Use warning triangle only for yellow validation issues (name mismatch, wrong location)
                    // Purple custom location and red unknown path get their own emoji prefix
                    const prefix = targetStatus.color === 'charts.yellow' ? '⚠️ ' : '';
                    tooltipText += '\n' + prefix + targetStatus.reason;
                }
                // We add health info to tooltip
                if (totalElements > 0) {
                    const headerItem = 1;
                    const totalItems = headerItem + totalElements;
                    const hasHeaderCount = hasHeader ? 1 : 0;
                    const documentedCount = hasHeaderCount + documentedElements;
                    const healthPercent = ((documentedCount / totalItems) * 100).toFixed(0);
                    tooltipText += `\n📊 Documentation: ${documentedCount}/${totalItems} items (${healthPercent}%)`;
                    if (!hasHeader) {
                        if (hasIncorrectHeader) {
                            tooltipText += '\n- Has /// header (must be //!)';
                        } else {
                            tooltipText += '\n- Missing header (//!)';
                        }
                    } else {
                        tooltipText += '\n- 📋 Has file header (//!)';
                    }
                    tooltipText += `\n- Elements: ${documentedElements}/${totalElements}`;
                }
                item.tooltip = tooltipText;
                item.target = target;
                
                // Store workspace member name if this target belongs to a member
                if (this.selectedWorkspaceMember && this.selectedWorkspaceMember !== 'all') {
                    item.workspaceMember = this.selectedWorkspaceMember;
                }
                
                // Use unique key that includes target type to avoid conflicts (lib and bin can have same name)
                const targetKey = `${target.type}:${target.name}`;
                
                // Set resourceUri for file decoration (enables text coloring for health status)
                // Use different scheme for yellow validation to enable conditional resolve button
                // Auto-discovered targets use normal scheme (only icon is affected, not text)
                const scheme = targetStatus.color === 'charts.yellow' ? 'cargui-target-yellow' : 'cargui-target';
                item.resourceUri = vscode.Uri.parse(`${scheme}:${targetKey}`);
                
                // Debug log for yellow targets
                if (targetStatus.color === 'charts.yellow') {
                    console.log(`[cargUI] Yellow target: ${target.name}, scheme: ${scheme}, resourceUri: ${item.resourceUri.toString()}`);
                }
                
                // Apply health color via decoration provider (for text color)
                if (this.decorationProvider) {
                    this.decorationProvider.setTargetColor(targetKey, healthColor);
                }
                
                // We apply icon color based ONLY on validation status - health colors only affect text
                // Auto-discovered targets (not declared in Cargo.toml) get bright black/gray icon
                // Missing file targets get bright yellow icon AND text
                if (target.autoDiscovered) {
                    item.iconPath = new vscode.ThemeIcon(icon, new vscode.ThemeColor('terminal.ansiBrightBlack'));
                } else if (targetStatus.color === 'terminal.ansiBrightYellow') {
                    // Missing file: bright yellow icon
                    item.iconPath = new vscode.ThemeIcon('warning', new vscode.ThemeColor('terminal.ansiBrightYellow'));
                    // Also set text color to bright yellow via decoration provider
                    if (this.decorationProvider) {
                        this.decorationProvider.setTargetColor(targetKey, 'terminal.ansiBrightYellow');
                    }
                } else if (targetStatus.color) {
                    // Use warning triangle icon for yellow validation issues
                    const iconToUse = targetStatus.color === 'charts.yellow' ? 'warning' : icon;
                    item.iconPath = new vscode.ThemeIcon(iconToUse, new vscode.ThemeColor(targetStatus.color));
                }
                
                // Make targets checkable
                const isChecked = this.checkedTargets.has(target.name);
                item.checkboxState = isChecked 
                    ? vscode.TreeItemCheckboxState.Checked 
                    : vscode.TreeItemCheckboxState.Unchecked;
                
                // Click opens the target file
                item.command = {
                    command: 'cargui.viewBinaryTarget',
                    title: 'View Target File',
                    arguments: [item]
                };
                
                return item;
            }));
        } else if (
            element.contextValue === TreeItemContext.DependencyTypeFolderWorkspace ||
            element.contextValue === TreeItemContext.DependencyTypeFolderProduction ||
            element.contextValue === TreeItemContext.DependencyTypeFolderDev ||
            element.contextValue === TreeItemContext.DependencyTypeFolderBuild
        ) {
            // Show dependencies of a specific type
            const depType = element.categoryName as 'workspace' | 'production' | 'dev' | 'build';
            const workspaceMembers = discoverWorkspaceMembers(workspaceFolder.uri.fsPath);
            const dependencyMemberPath = this.selectedWorkspaceMember && this.selectedWorkspaceMember !== 'all'
                ? workspaceMembers.find(m => m.name === this.selectedWorkspaceMember)?.path
                : undefined;
            const allDependencies = discoverCargoDependencies(workspaceFolder.uri.fsPath, dependencyMemberPath);
            
            let dependencies: Dependency[] = [];
            if (depType === 'workspace') {
                dependencies = allDependencies.workspace;
            } else if (depType === 'production') {
                dependencies = allDependencies.production;
            } else if (depType === 'dev') {
                dependencies = allDependencies.dev;
            } else if (depType === 'build') {
                dependencies = allDependencies.build;
            }
            
            return Promise.resolve(dependencies.map(async dep => {
                // Format the dependency display
                let label = dep.name;
                let description = '';
                let tooltip = `${dep.name}`;
                let isLatest = false;
                
                if (dep.version) {
                    // Check if this version is the latest (async)
                    try {
                        const versions = await fetchCrateVersions(dep.name);
                        const latestVersion = versions.length > 0 ? versions[0] : null;
                        
                        // Normalize versions for comparison: treat "2.10" and "2.10.0" as equivalent
                        const normalizeVersion = (ver: string) => {
                            const parts = ver.split('.');
                            while (parts.length < 3) {
                                parts.push('0');
                            }
                            return parts.join('.');
                        };
                        
                        const normalizedCurrent = normalizeVersion(dep.version);
                        const normalizedLatest = latestVersion ? normalizeVersion(latestVersion) : null;
                        
                        if (normalizedLatest && normalizedCurrent === normalizedLatest) {
                            isLatest = true;
                            description = dep.version;
                            tooltip += ` = "${dep.version}"`;
                        } else {
                            description = dep.version;
                            tooltip += ` = "${dep.version}"`;
                            if (latestVersion) {
                                tooltip += ` (latest: ${latestVersion})`;
                            }
                        }
                    } catch (error) {
                        // If fetching fails, just show version without decoration
                        description = dep.version;
                        tooltip += ` = "${dep.version}"`;
                    }
                }
                
                if (dep.path) {
                    description = dep.path;
                    tooltip += ` (path: ${dep.path})`;
                } else if (dep.git) {
                    description = 'git';
                    tooltip += ` (git: ${dep.git}`;
                    if (dep.branch) tooltip += `, branch: ${dep.branch}`;
                    if (dep.tag) tooltip += `, tag: ${dep.tag}`;
                    if (dep.rev) tooltip += `, rev: ${dep.rev}`;
                    tooltip += ')';
                }
                
                if (dep.features && dep.features.length > 0) {
                    tooltip += `\nFeatures: ${dep.features.join(', ')}`;
                }
                
                if (dep.optional) {
                    tooltip += ' (optional)';
                }
                
                // Determine icon - use star for inherited deps, package otherwise
                let iconName = 'package';
                let iconColor: vscode.ThemeColor | undefined = undefined;
                
                // Workspace dependencies get orange coloring
                // Path-based dependencies get blue coloring (local crates)
                if (dep.path) {
                    iconColor = new vscode.ThemeColor('charts.blue');
                }
                // Workspace dependencies get orange coloring
                else if (depType === 'workspace') {
                    iconColor = new vscode.ThemeColor('charts.orange');
                }
                
                if (dep.inherited && depType !== 'workspace') {
                    iconName = 'star-full';
                    tooltip += ' (from workspace)';
                    // Inherited deps (workspace stars) also get orange
                    iconColor = new vscode.ThemeColor('charts.orange');
                }
                
                // Create unique dependency key including type to avoid collisions
                // (same dep name can appear in multiple categories: prod, dev, build, workspace)
                const depKey = `${depType}:${dep.name}`;
                
                const item = new CargoTreeItem(
                    label,
                    vscode.TreeItemCollapsibleState.None,
                    TreeItemContext.Dependency,
                    { dependency: dep, dependencyKey: depKey, iconName: iconName }
                );
                
                // Apply orange icon color to workspace dependencies and inherited deps
                if (iconColor) {
                    item.iconPath = new vscode.ThemeIcon(iconName, iconColor);
                }
                
                item.description = description;
                item.tooltip = tooltip;
                item.isInherited = dep.inherited && depType !== 'workspace';
                
                // Set click command to view dependency in Cargo.toml
                item.command = {
                    command: 'cargui.viewDependencyInCargoToml',
                    title: 'View in Cargo.toml',
                    arguments: [item]
                };
                
                // Set resourceUri for file decoration (enables text coloring)
                item.resourceUri = vscode.Uri.parse(`cargui-dep:${depKey}`);
                
                // Path-based dependencies get blue text (no version to check)
                if (dep.path && this.decorationProvider) {
                    this.decorationProvider.setTargetColor(depKey, 'charts.blue');
                }
                // Mark as latest in decoration provider if applicable (versioned deps only)
                else if (isLatest && this.decorationProvider) {
                    this.decorationProvider.markAsLatest(depKey);
                }
                
                // Make dependencies checkable using the unique key
                const isChecked = this.checkedDependencies.has(depKey);
                item.checkboxState = isChecked 
                    ? vscode.TreeItemCheckboxState.Checked 
                    : vscode.TreeItemCheckboxState.Unchecked;
                
                return item;
            })).then(promises => Promise.all(promises).then(items => {
                // Sort: inherited deps (with stars) go to top
                return items.sort((a, b) => {
                    const aIsInherited = a.isInherited ? 1 : 0;
                    const bIsInherited = b.isInherited ? 1 : 0;
                    return bIsInherited - aIsInherited; // Inherited (1) comes before normal (0)
                });
            }));
        } else if (element.contextValue === TreeItemContext.UnknownsFolder) {
            // we check if this is the undeclared features folder or unknowns folder based on resourceUri
            if (element.resourceUri?.scheme === 'cargui-target' && element.resourceUri.authority === 'undeclared-features-folder') {
                // Show undeclared features
                const workspaceMembers = discoverWorkspaceMembers(workspaceFolder.uri.fsPath);
                const targetMemberPath = this.selectedWorkspaceMember && this.selectedWorkspaceMember !== 'all'
                    ? workspaceMembers.find(m => m.name === this.selectedWorkspaceMember)?.path
                    : undefined;
                const undeclaredFeatures = detectUndeclaredFeatures(workspaceFolder.uri.fsPath, targetMemberPath);
                
                return Promise.resolve(undeclaredFeatures.map(feature => {
                    const item = new CargoTreeItem(
                        feature.name,
                        vscode.TreeItemCollapsibleState.None,
                        TreeItemContext.UnknownTarget,
                        {
                            iconName: 'symbol-key',
                            unknownData: feature
                        }
                    );
                    item.tooltip = `Undeclared feature: ${feature.name}\nAdd to [features] section in Cargo.toml`;
                    
                    // Set resourceUri for file decoration
                    item.resourceUri = vscode.Uri.parse(`cargui-target:undeclared-feature-${feature.name}`);
                    
                    // Apply orange color
                    if (this.decorationProvider) {
                        this.decorationProvider.setTargetColor(`undeclared-feature-${feature.name}`, 'charts.orange');
                    }
                    
                    item.iconPath = new vscode.ThemeIcon('symbol-key', new vscode.ThemeColor('charts.orange'));
                    
                    return item;
                }));
            } else {
                // Show unregistered targets
                const workspaceMembers = discoverWorkspaceMembers(workspaceFolder.uri.fsPath);
                const targetMemberPath = this.selectedWorkspaceMember && this.selectedWorkspaceMember !== 'all'
                    ? workspaceMembers.find(m => m.name === this.selectedWorkspaceMember)?.path
                    : undefined;
                const unknownTargets = this.detectUnregisteredTargetsFunc(workspaceFolder.uri.fsPath, targetMemberPath);
                
                return Promise.resolve(unknownTargets.map(unknown => {
                    // Use type-specific icon based on directory location
                    let iconName = 'question';
                    if (unknown.type === 'example') {
                        iconName = 'note';
                    } else if (unknown.type === 'test') {
                        iconName = 'beaker';
                    } else if (unknown.type === 'bench') {
                        iconName = 'dashboard';
                    } else if (unknown.type === 'bin') {
                        iconName = 'file-binary';
                    }
                    
                    const item = new CargoTreeItem(
                        unknown.name,
                        vscode.TreeItemCollapsibleState.None,
                        TreeItemContext.UnknownTarget,
                        {
                            iconName: iconName,
                            unknownData: unknown
                        }
                    );
                    item.description = unknown.path;
                    item.tooltip = `Drag to a target type folder to register\nPath: ${unknown.path}`;
                    
                    // Set workspace member for proper path resolution
                    item.workspaceMember = unknown.memberName;
                    
                    // Set resourceUri for file decoration (enables text coloring)
                    item.resourceUri = vscode.Uri.parse(`cargui-target:unknown-${unknown.name}`);
                    
                    // Apply red color via decoration provider
                    if (this.decorationProvider) {
                        this.decorationProvider.setTargetColor(`unknown-${unknown.name}`, 'charts.red');
                    }
                    
                    // Also apply icon color
                    item.iconPath = new vscode.ThemeIcon(iconName, new vscode.ThemeColor('charts.red'));
                    
                    // The unknown target data is already stored in the item from constructor
                    
                    // Create a temporary target object for view commands
                    item.target = {
                        name: unknown.name,
                        type: unknown.type === 'unknown' ? 'bin' : unknown.type as any,
                        path: unknown.path || ''
                    };
                    
                    // Add click command to open the file
                    item.command = {
                        command: 'cargui.viewBinaryTarget',
                        title: 'View Target File',
                        arguments: [item]
                    };
                    
                    return item;
                }));
            }
        }

        return Promise.resolve([]);
    }
}
