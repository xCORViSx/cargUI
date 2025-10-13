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
    private applyCargoTomlChangesFunc: (workspaceFolder: vscode.WorkspaceFolder, items: UnregisteredItem[]) => Promise<void>;

    constructor(
        detectUnregisteredTargets: (workspacePath: string, memberPath?: string) => UnregisteredItem[],
        applyCargoTomlChanges: (workspaceFolder: vscode.WorkspaceFolder, items: UnregisteredItem[]) => Promise<void>
    ) {
        this.detectUnregisteredTargetsFunc = detectUnregisteredTargets;
        this.applyCargoTomlChangesFunc = applyCargoTomlChanges;
    }

    setWorkspaceContext(workspaceFolder: vscode.WorkspaceFolder, context: vscode.ExtensionContext): void {
        this.workspaceFolder = workspaceFolder;
        this.context = context;
    }

    // Allow external setting of mode states
    setSelectedWorkspaceMember(member: string | undefined): void {
        this.selectedWorkspaceMember = member;
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
            if (!this.workspaceFolder || !this.context) return;
            
            // Check if user has disabled detection
            const ignoredKey = 'cargui.ignoreUnknownTargets';
            const ignored = this.context.workspaceState.get(ignoredKey, false);
            if (ignored) return;
            
            // Only detect unknown targets now (features are handled separately)
            const workspaceMembers = discoverWorkspaceMembers(this.workspaceFolder.uri.fsPath);
            const targetMemberPath = this.selectedWorkspaceMember && this.selectedWorkspaceMember !== 'all'
                ? workspaceMembers.find(m => m.name === this.selectedWorkspaceMember)?.path
                : undefined;
            const unknownTargets = this.detectUnregisteredTargetsFunc(this.workspaceFolder.uri.fsPath, targetMemberPath);
            
            if (unknownTargets.length > 0) {
                // Simple notification
                const targetText = unknownTargets.length === 1 ? 'unknown target type' : 'unknown target types';
                const message = `Found ${unknownTargets.length} ${targetText}. Check the Unknowns folder in the Targets tree.`;
                
                const choice = await vscode.window.showInformationMessage(
                    message,
                    'Got it',
                    "Don't Show Again"
                );
                
                if (choice === "Don't Show Again") {
                    await this.context.workspaceState.update(ignoredKey, true);
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
        const member = item.memberName 
            ? workspaceMembers.find(m => m.name === item.memberName)
            : undefined;
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
            const member = unknown.memberName 
                ? workspaceMembers.find(m => m.name === unknown.memberName)
                : undefined;
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

        await this.applyCargoTomlChangesFunc(this.workspaceFolder, [itemToRegister]);
        
        // Refresh the tree to remove the unknown item and show the new target
        this.refresh();
    }

    getChildren(element?: CargoTreeItem): Thenable<CargoTreeItem[]> {
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (!workspaceFolder) {
            return Promise.resolve([]);
        }

        if (!element) {
            // Root level - show command categories and targets
            const items: CargoTreeItem[] = [];

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

            // Rust Edition indicator
            const currentEdition = getCurrentEdition(workspaceFolder.uri.fsPath);
            if (currentEdition) {
                const editionItem = new CargoTreeItem(
                    `Edition: ${currentEdition}`,
                    vscode.TreeItemCollapsibleState.None,
                    TreeItemContext.RustEdition,
                    { iconName: 'versions' }
                );
                editionItem.tooltip = `Rust edition: ${currentEdition}\nClick to change edition`;
                editionItem.description = '';
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
                items.push(new CargoTreeItem(workspaceLabel, vscode.TreeItemCollapsibleState.Collapsed, TreeItemContext.WorkspaceCategory, { iconName: 'repo' }));
            }

            // MODULES
            const modulesItem = new CargoTreeItem('MODULES', vscode.TreeItemCollapsibleState.Collapsed, TreeItemContext.ModulesCategory, { iconName: 'package' });
            items.push(modulesItem);

            // Dependencies
            const dependencyMemberPath = this.selectedWorkspaceMember && this.selectedWorkspaceMember !== 'all'
                ? workspaceMembers.find(m => m.name === this.selectedWorkspaceMember)?.path
                : undefined;
            const dependencies = discoverCargoDependencies(workspaceFolder.uri.fsPath, dependencyMemberPath);
            const totalDeps = dependencies.workspace.length + dependencies.production.length + dependencies.dev.length + dependencies.build.length;
            // Always show dependencies section, even if empty
            const dependenciesItem = new CargoTreeItem('DEPENDENCIES', vscode.TreeItemCollapsibleState.Collapsed, TreeItemContext.DependenciesCategory);
            dependenciesItem.description = `${totalDeps}`;
            items.push(dependenciesItem);

            // Separator before config group
            const separator1 = new CargoTreeItem('────────────────', vscode.TreeItemCollapsibleState.None, TreeItemContext.Separator);
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
            if (targets.length > 0) {
                const targetsItem = new CargoTreeItem('Targets', vscode.TreeItemCollapsibleState.Expanded, TreeItemContext.TargetsCategory, { iconName: 'folder' });
                targetsItem.description = `${targets.length}`;
                items.push(targetsItem);
            }

            // Features
            const featureMemberPath = this.selectedWorkspaceMember && this.selectedWorkspaceMember !== 'all'
                ? workspaceMembers.find(m => m.name === this.selectedWorkspaceMember)?.path
                : undefined;
            const features = this.selectedWorkspaceMember === 'all'
                ? []
                : discoverCargoFeatures(workspaceFolder.uri.fsPath, featureMemberPath);
            if (features.length > 0) {
                const featuresItem = new CargoTreeItem('Features', vscode.TreeItemCollapsibleState.Collapsed, TreeItemContext.FeaturesCategory, { iconName: 'symbol-misc' });
                featuresItem.description = `${features.length}`;
                items.push(featuresItem);
            }

            // Arguments
            const args = config.get<string[]>('arguments') || [];
            const argCategories = config.get<ArgumentCategory[]>('argumentCategories') || [];
            const totalArgs = argCategories.reduce((sum, cat) => sum + cat.arguments.length, 0);
            const argumentsItem = new CargoTreeItem('Arguments', vscode.TreeItemCollapsibleState.Collapsed, TreeItemContext.ArgumentsCategory, { iconName: 'symbol-parameter' });
            argumentsItem.description = `${totalArgs}`;
            items.push(argumentsItem);

            // Environment Variables
            const envVars = config.get<string[]>('environmentVariables') || [];
            const envVarsItem = new CargoTreeItem('Environment Variables', vscode.TreeItemCollapsibleState.Collapsed, TreeItemContext.EnvVarsCategory, { iconName: 'symbol-variable' });
            envVarsItem.description = `${envVars.length}`;
            items.push(envVarsItem);

            // Separator before commands/deps group
            const separator2 = new CargoTreeItem('────────────────', vscode.TreeItemCollapsibleState.None, TreeItemContext.Separator);
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
                const memberItem = new CargoTreeItem(
                    member.name,
                    vscode.TreeItemCollapsibleState.None,
                    TreeItemContext.WorkspaceMember,
                    {
                        iconName: member.isRoot ? 'home' : 'package',
                        workspaceMember: member.name
                    }
                );
                memberItem.tooltip = `Path: ${member.path}\n${member.isRoot ? 'Root package' : 'Member package'}`;
                
                // Show selection status in description
                if (this.selectedWorkspaceMember === member.name) {
                    memberItem.description = '✓ Selected';
                } else if (!this.selectedWorkspaceMember && member.isRoot) {
                    memberItem.description = '✓ Default';
                }
                
                // Make workspace members checkable
                const isChecked = this.checkedWorkspaceMembers.has(member.name);
                memberItem.checkboxState = isChecked 
                    ? vscode.TreeItemCheckboxState.Checked 
                    : vscode.TreeItemCheckboxState.Unchecked;
                
                // Clicking the label selects the member (changes context)
                memberItem.command = {
                    command: 'cargui.selectWorkspaceMember',
                    title: 'Select Workspace Member',
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
                    // Multi-member workspace - show modules per member
                    for (const member of members) {
                        const srcPath = path.join(member.path, 'src');
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
                            memberItem.tooltip = `Modules in ${member.name}`;
                            items.push(memberItem);
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
                let tooltipText = `Mode: ${snapshot.mode}\nTargets: ${snapshot.targets.length}\nFeatures: ${snapshot.features.length}\nArguments: ${snapshot.arguments.length}\nEnv Vars: ${snapshot.envVars.length}`;
                
                if (snapshot.workspaceMember) {
                    tooltipText += `\nWorkspace Member: ${snapshot.workspaceMember}`;
                }
                
                if (snapshot.checkedWorkspaceMembers && snapshot.checkedWorkspaceMembers.length > 0) {
                    tooltipText += `\nChecked Members: ${snapshot.checkedWorkspaceMembers.join(', ')}`;
                }
                
                item.tooltip = tooltipText;
                
                return item;
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
            // Arguments category children - show uncategorized arguments THEN subcategories
            const config = vscode.workspace.getConfiguration('cargui');
            const argCategories = config.get<ArgumentCategory[]>('argumentCategories') || [];
            const strays = config.get<string[]>('arguments') || [];
            
            const items: CargoTreeItem[] = [];
            
            // Add uncategorized arguments FIRST
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
            
            // Add subcategories AFTER
            items.push(...argCategories.map(category => {
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
                item.description = `${category.arguments.length}`;
                
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
            
            return Promise.resolve(features.map(feature => {
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
                
                // Clicking the label opens Cargo.toml
                item.command = {
                    command: 'cargui.viewFeatureInCargoToml',
                    title: 'View Feature in Cargo.toml',
                    arguments: [item]
                };
                
                return item;
            }));
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
                    iconName: 'package',
                    categoryName: 'workspace'
                });
                workspaceItem.description = `${dependencies.workspace.length}`;
                items.push(workspaceItem);
            }
            
            // Production subfolder (only if member selected and has production deps)
            if (dependencies.production.length > 0) {
                const productionItem = new CargoTreeItem('Production', vscode.TreeItemCollapsibleState.Collapsed, TreeItemContext.DependencyTypeFolderProduction, {
                    iconName: 'package',
                    categoryName: 'production'
                });
                productionItem.description = `${dependencies.production.length}`;
                items.push(productionItem);
            }
            
            // Dev subfolder (only if member selected and has dev deps)
            if (dependencies.dev.length > 0) {
                const devItem = new CargoTreeItem('Dev', vscode.TreeItemCollapsibleState.Collapsed, TreeItemContext.DependencyTypeFolderDev, {
                    iconName: 'beaker',
                    categoryName: 'dev'
                });
                devItem.description = `${dependencies.dev.length}`;
                items.push(devItem);
            }
            
            // Build subfolder (only if member selected and has build deps)
            if (dependencies.build.length > 0) {
                const buildItem = new CargoTreeItem('Build', vscode.TreeItemCollapsibleState.Collapsed, TreeItemContext.DependencyTypeFolderBuild, {
                    iconName: 'tools',
                    categoryName: 'build'
                });
                buildItem.description = `${dependencies.build.length}`;
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
            const binCount = allTargets.filter(t => t.type === 'bin').length;
            const exampleCount = allTargets.filter(t => t.type === 'example').length;
            const testCount = allTargets.filter(t => t.type === 'test').length;
            const benchCount = allTargets.filter(t => t.type === 'bench').length;
            
            // Add target type subfolders (only if they have items)
            if (binCount > 0) {
                const binItem = new CargoTreeItem('Binaries', vscode.TreeItemCollapsibleState.Collapsed, TreeItemContext.TargetTypeFolder, {
                    iconName: 'file-binary',
                    categoryName: 'bin'
                });
                binItem.description = `${binCount}`;
                items.push(binItem);
            }
            if (exampleCount > 0) {
                const exampleItem = new CargoTreeItem('Examples', vscode.TreeItemCollapsibleState.Collapsed, TreeItemContext.TargetTypeFolder, {
                    iconName: 'note',
                    categoryName: 'example'
                });
                exampleItem.description = `${exampleCount}`;
                items.push(exampleItem);
            }
            if (testCount > 0) {
                const testItem = new CargoTreeItem('Tests', vscode.TreeItemCollapsibleState.Collapsed, TreeItemContext.TargetTypeFolder, {
                    iconName: 'beaker',
                    categoryName: 'test'
                });
                testItem.description = `${testCount}`;
                items.push(testItem);
            }
            if (benchCount > 0) {
                const benchItem = new CargoTreeItem('Benchmarks', vscode.TreeItemCollapsibleState.Collapsed, TreeItemContext.TargetTypeFolder, {
                    iconName: 'dashboard',
                    categoryName: 'bench'
                });
                benchItem.description = `${benchCount}`;
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
            const targetType = element.categoryName as 'bin' | 'example' | 'test' | 'bench';
            const workspaceMembers = discoverWorkspaceMembers(workspaceFolder.uri.fsPath);
            const targetMemberPath = this.selectedWorkspaceMember && this.selectedWorkspaceMember !== 'all'
                ? workspaceMembers.find(m => m.name === this.selectedWorkspaceMember)?.path
                : undefined;
            const allTargets = discoverCargoTargets(workspaceFolder.uri.fsPath, targetMemberPath);
            const targets = allTargets.filter(t => t.type === targetType);
            
            // Helper function to determine target status for color coding
            const getTargetStatus = (target: CargoTarget): {
                color: string | undefined;
            } => {
                if (!target.path) {
                    return { color: 'charts.red' }; // Unknown - no path
                }

                // Determine standard location based on target type
                let standardLocations: string[] = [];
                const filename = path.basename(target.path);
                const normalizedPath = target.path.replace(/\\/g, '/');
                const pathDir = path.dirname(normalizedPath);
                
                // Check if the target name matches the file stem (without extension)
                const fileStem = filename.replace(/\.rs$/, '');
                const nameMatchesFile = target.name === fileStem || target.name === 'main';
                
                if (target.type === 'bin') {
                    if (target.path === 'src/main.rs') {
                        standardLocations = ['src/main.rs'];
                    } else {
                        standardLocations = [`src/bin/${filename}`];
                    }
                    
                    // Check if bin is in wrong location (e.g., in examples/, tests/, benches/)
                    if (pathDir.startsWith('examples') || pathDir.startsWith('tests') || pathDir.startsWith('benches')) {
                        return { color: 'charts.orange' }; // Incorrect - wrong type for location
                    }
                } else if (target.type === 'example') {
                    // Examples can be in examples/ directory (single file or directory with main.rs)
                    // Check if it's anywhere in the examples/ folder - that's standard
                    if (pathDir.startsWith('examples')) {
                        return { color: undefined }; // Standard location - no color
                    }
                    
                    // Check if example is in wrong location
                    if (pathDir.startsWith('src/bin') || pathDir.startsWith('tests') || pathDir.startsWith('benches')) {
                        return { color: 'charts.orange' }; // Incorrect - wrong type for location
                    }
                } else if (target.type === 'test') {
                    // Tests can be in tests/ directory (single file or directory with main.rs)
                    if (pathDir.startsWith('tests')) {
                        return { color: undefined }; // Standard location - no color
                    }
                    
                    // Check if test is in wrong location
                    if (pathDir.startsWith('src/bin') || pathDir.startsWith('examples') || pathDir.startsWith('benches')) {
                        return { color: 'charts.orange' }; // Incorrect - wrong type for location
                    }
                } else if (target.type === 'bench') {
                    // Benches can be in benches/ directory (single file or directory with main.rs)
                    if (pathDir.startsWith('benches')) {
                        return { color: undefined }; // Standard location - no color
                    }
                    
                    // Check if bench is in wrong location
                    if (pathDir.startsWith('src/bin') || pathDir.startsWith('examples') || pathDir.startsWith('tests')) {
                        return { color: 'charts.orange' }; // Incorrect - wrong type for location
                    }
                }

            // Check if target is in a standard location (for bins)
            const isStandard = standardLocations.some(loc => normalizedPath === loc.replace(/\\/g, '/'));
            
            if (isStandard) {
                // Target is correctly declared and in standard location
                // But check if name matches file
                if (!nameMatchesFile && target.path !== 'src/main.rs') {
                    return { color: 'charts.orange' }; // Incorrect - name mismatch in standard location
                }
                return { color: undefined }; // No color (default)
            } else {
                // Target is declared but in custom location (lighter yellow for custom, regardless of name)
                return { color: 'charts.blue' };
            }
        };            return Promise.resolve(targets.map(target => {
                const isMainTarget = target.type === 'bin' && target.path === 'src/main.rs';
                const targetStatus = getTargetStatus(target);
                
                let icon = 'file';
                if (target.type === 'bin') {
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
                    TreeItemContext.Target,
                    {
                        iconName: icon,
                        target: target
                    }
                );
                item.description = isMainTarget ? 'src/main.rs' : target.path;
                
                // Create tooltip with color coding explanation
                let tooltipText = target.path || target.name;
                if (targetStatus.color === 'charts.blue') {
                    tooltipText += '\n⚠️ Custom location (not in standard directory)';
                } else if (targetStatus.color === 'charts.orange') {
                    tooltipText += '\n⚠️ Incorrect declaration (wrong name or location for type)';
                } else if (targetStatus.color === 'charts.red') {
                    tooltipText += '\n❌ Unknown path';
                }
                item.tooltip = tooltipText;
                item.target = target;
                
                // Set resourceUri for file decoration (enables text coloring like dependencies)
                item.resourceUri = vscode.Uri.parse(`cargui-target:${target.name}`);
                
                // Apply color via decoration provider
                if (targetStatus.color && this.decorationProvider) {
                    this.decorationProvider.setTargetColor(target.name, targetStatus.color);
                }
                
                // Also apply icon color for consistency
                if (targetStatus.color) {
                    item.iconPath = new vscode.ThemeIcon(icon, new vscode.ThemeColor(targetStatus.color));
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
                        
                        if (latestVersion === dep.version) {
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
                
                const item = new CargoTreeItem(
                    label,
                    vscode.TreeItemCollapsibleState.None,
                    TreeItemContext.Dependency,
                    { dependency: dep }
                );
                item.description = description;
                item.tooltip = tooltip;
                
                // Set click command to view dependency in Cargo.toml
                item.command = {
                    command: 'cargui.viewDependencyInCargoToml',
                    title: 'View in Cargo.toml',
                    arguments: [item]
                };
                
                // Set resourceUri for file decoration (enables text coloring)
                item.resourceUri = vscode.Uri.parse(`cargui-dep:${dep.name}`);
                
                // Mark as latest in decoration provider if applicable
                if (isLatest && this.decorationProvider) {
                    this.decorationProvider.markAsLatest(dep.name);
                }
                
                // Make dependencies checkable
                const isChecked = this.checkedDependencies.has(dep.name);
                item.checkboxState = isChecked 
                    ? vscode.TreeItemCheckboxState.Checked 
                    : vscode.TreeItemCheckboxState.Unchecked;
                
                return item;
            })).then(promises => Promise.all(promises));
        } else if (element.contextValue === TreeItemContext.UnknownsFolder) {
            // Show unregistered targets
            const workspaceMembers = discoverWorkspaceMembers(workspaceFolder.uri.fsPath);
            const targetMemberPath = this.selectedWorkspaceMember && this.selectedWorkspaceMember !== 'all'
                ? workspaceMembers.find(m => m.name === this.selectedWorkspaceMember)?.path
                : undefined;
            const unknownTargets = this.detectUnregisteredTargetsFunc(workspaceFolder.uri.fsPath, targetMemberPath);
            
            return Promise.resolve(unknownTargets.map(unknown => {
                const item = new CargoTreeItem(
                    unknown.name,
                    vscode.TreeItemCollapsibleState.None,
                    TreeItemContext.UnknownTarget,
                    {
                        iconName: 'question',
                        unknownData: unknown
                    }
                );
                item.description = unknown.path;
                item.tooltip = `Drag to a target type folder to register\nPath: ${unknown.path}`;
                
                // Set resourceUri for file decoration (enables text coloring)
                item.resourceUri = vscode.Uri.parse(`cargui-target:unknown-${unknown.name}`);
                
                // Apply red color via decoration provider
                if (this.decorationProvider) {
                    this.decorationProvider.setTargetColor(`unknown-${unknown.name}`, 'charts.red');
                }
                
                // Also apply icon color
                item.iconPath = new vscode.ThemeIcon('question', new vscode.ThemeColor('charts.red'));
                
                // The unknown target data is already stored in the item from constructor
                
                // Create a temporary target object for view commands
                item.target = {
                    name: unknown.name,
                    type: 'bin', // Placeholder type for view commands
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

        return Promise.resolve([]);
    }
}
