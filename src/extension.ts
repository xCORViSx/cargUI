import * as vscode from 'vscode';

import {
    ArgumentCategory,
    CustomCommand,
    Snapshot,
    UnregisteredItem
} from './types';
import { DependencyDecorationProvider } from './decorationProvider';
import { CargoTreeDataProvider } from './cargoTreeProvider';
import {
    discoverWorkspaceMembers,
    discoverCargoTargets
} from './cargoDiscovery';
import {
    getCurrentToolchain,
    startRustupUpdateChecker,
    stopRustupUpdateChecker
} from './rustup';
import { registerCommands } from './commands';
import { detectUnregisteredTargets } from './smartDetection';
import { runSmartDetection, showConfigureUnregisteredUI } from './smartDetectionUI';
import { moveFileToTargetDirectory } from './fileOperations';
import { formatCargoTomlFile, applyCargoTomlChanges } from './cargoToml';
import { initializeDefaultConfig } from './defaultConfig';

let isReleaseMode = false;
let isWatchMode = false;
let watchTerminal: vscode.Terminal | undefined;
let watchAction: string = 'check';
let selectedWorkspaceMember: string | undefined;

export async function activate(context: vscode.ExtensionContext) {
    console.log('cargUI extension is now active');

    const decorationProvider = new DependencyDecorationProvider();
    context.subscriptions.push(
        vscode.window.registerFileDecorationProvider(decorationProvider)
    );

    // Create wrapper for applyCargoTomlChanges that includes moveFileToTargetDirectory
    const applyChangesWithMove = (workspaceFolder: vscode.WorkspaceFolder, items: UnregisteredItem[]) => 
        applyCargoTomlChanges(workspaceFolder, items, moveFileToTargetDirectory);

    const cargoTreeProvider = new CargoTreeDataProvider(detectUnregisteredTargets, applyChangesWithMove);
    cargoTreeProvider.decorationProvider = decorationProvider;
    (vscode.window as any).cargoTreeProvider = cargoTreeProvider;

    try {
        const treeView = vscode.window.createTreeView('cargoTargets', {
            treeDataProvider: cargoTreeProvider,
            canSelectMany: true,
            manageCheckboxStateManually: true,
            dragAndDropController: cargoTreeProvider
        });
        cargoTreeProvider.treeView = treeView;
        context.subscriptions.push(treeView);

        treeView.onDidChangeCheckboxState(event => {
            for (const [item, state] of event.items) {
                if (item.target) {
                    cargoTreeProvider.setChecked(item.target.name, state === vscode.TreeItemCheckboxState.Checked);
                } else if (item.feature) {
                    cargoTreeProvider.setFeatureChecked(item.feature, state === vscode.TreeItemCheckboxState.Checked);
                } else if (item.argument) {
                    cargoTreeProvider.setArgumentChecked(item.argument, state === vscode.TreeItemCheckboxState.Checked);
                } else if (item.envVar) {
                    cargoTreeProvider.setEnvVarChecked(item.envVar, state === vscode.TreeItemCheckboxState.Checked);
                } else if (item.workspaceMember) {
                    cargoTreeProvider.setWorkspaceMemberChecked(item.workspaceMember, state === vscode.TreeItemCheckboxState.Checked);
                } else if (item.dependency) {
                    cargoTreeProvider.setDependencyChecked(
                        item.dependency.name,
                        state === vscode.TreeItemCheckboxState.Checked,
                        item.dependency
                    );
                }
            }
        });

        vscode.window.showInformationMessage('cargUI: Tree view registered!');
    } catch (error) {
        console.error('Failed to create tree view:', error);
        vscode.window.showErrorMessage(`Failed to create cargUI tree view: ${error}`);
    }

    const rustToolchainStatusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    rustToolchainStatusBar.command = 'cargui.showRustupInfo';
    rustToolchainStatusBar.tooltip = 'Click to view Rust toolchain details';
    context.subscriptions.push(rustToolchainStatusBar);

    const updateToolchainStatusBar = async () => {
        const toolchain = await getCurrentToolchain();
        if (toolchain !== 'unknown') {
            rustToolchainStatusBar.text = `$(tools) ${toolchain}`;
            rustToolchainStatusBar.show();
        } else {
            rustToolchainStatusBar.hide();
        }
    };

    updateToolchainStatusBar();

    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];

    if (workspaceFolder) {
        // Initialize default configuration
        await initializeDefaultConfig(workspaceFolder, cargoTreeProvider);

        // Check if this is the first activation with the new separate notification keys
        // by looking for a migration marker
        const migrationMarker = 'cargui.notificationKeysMigrated';
        const alreadyMigrated = context.workspaceState.get(migrationMarker, false);
        
        if (!alreadyMigrated) {
            // First time with new keys - clear ALL old notification state to ensure clean slate
            await context.workspaceState.update('cargui.ignoreUnknownTargets', undefined);
            await context.workspaceState.update('cargui.ignoreUndeclaredModules', undefined);
            await context.workspaceState.update('cargui.ignoreUndeclaredFeatures', undefined);
            // Mark as migrated so we don't do this again
            await context.workspaceState.update(migrationMarker, true);
        }

        cargoTreeProvider.setWorkspaceContext(workspaceFolder, context);

        // Trigger initial refresh to populate tree and run smart detection
        cargoTreeProvider.refresh();

        // Watch all Cargo.toml files (root and workspace members)
        const cargoTomlWatcher = vscode.workspace.createFileSystemWatcher(
            new vscode.RelativePattern(workspaceFolder, '**/Cargo.toml')
        );
        cargoTomlWatcher.onDidChange(() => cargoTreeProvider.refresh());
        cargoTomlWatcher.onDidCreate(() => cargoTreeProvider.refresh());
        cargoTomlWatcher.onDidDelete(() => cargoTreeProvider.refresh());
        context.subscriptions.push(cargoTomlWatcher);

        const targetsWatcher = vscode.workspace.createFileSystemWatcher(
            new vscode.RelativePattern(workspaceFolder, '{src/bin/*.rs,examples/*.rs,tests/*.rs,benches/*.rs}')
        );
        targetsWatcher.onDidChange(() => cargoTreeProvider.refresh());
        targetsWatcher.onDidCreate(() => cargoTreeProvider.refresh());
        targetsWatcher.onDidDelete(() => cargoTreeProvider.refresh());
        context.subscriptions.push(targetsWatcher);

        // Watch all Rust source files in src/ for module documentation changes
        const srcFilesWatcher = vscode.workspace.createFileSystemWatcher(
            new vscode.RelativePattern(workspaceFolder, '**/src/**/*.rs')
        );
        srcFilesWatcher.onDidChange(() => cargoTreeProvider.refresh());
        srcFilesWatcher.onDidCreate(() => cargoTreeProvider.refresh());
        srcFilesWatcher.onDidDelete(() => cargoTreeProvider.refresh());
        context.subscriptions.push(srcFilesWatcher);
    } else {
        console.log('No workspace folder found');
        vscode.window.showWarningMessage('No workspace folder - cargUI view will not be available');
    }

    const textDocumentSaveDisposable = vscode.workspace.onDidSaveTextDocument((document) => {
        // If a Rust file was saved, refresh the tree to update module documentation stats
        if (document.fileName.endsWith('.rs')) {
            cargoTreeProvider.refresh();
        }
        // If a Cargo.toml was saved, refresh immediately to update targets/features
        if (document.fileName.endsWith('Cargo.toml')) {
            cargoTreeProvider.refresh();
        }
    });
    context.subscriptions.push(textDocumentSaveDisposable);

    const terminalCloseDisposable = vscode.window.onDidCloseTerminal(terminal => {
        if (terminal === watchTerminal) {
            isWatchMode = false;
            watchTerminal = undefined;
            cargoTreeProvider.setWatchMode(false, watchAction);
            cargoTreeProvider.refresh();
            vscode.window.showInformationMessage('Watch mode stopped (terminal closed)');
        }
    });
    context.subscriptions.push(terminalCloseDisposable);

    startRustupUpdateChecker(context);

    const getIsReleaseMode = () => isReleaseMode;
    const setIsReleaseMode = (value: boolean) => {
        isReleaseMode = value;
        cargoTreeProvider.setReleaseMode(value);
        cargoTreeProvider.refresh();
    };

    const getIsWatchMode = () => isWatchMode;
    const setIsWatchMode = (value: boolean) => {
        isWatchMode = value;
        cargoTreeProvider.setWatchMode(value, watchAction);
        cargoTreeProvider.refresh();
    };

    const getWatchTerminal = () => watchTerminal;
    const setWatchTerminal = (terminal: vscode.Terminal | undefined) => {
        watchTerminal = terminal;
    };

    const getWatchAction = () => watchAction;
    const setWatchAction = (action: string) => {
        watchAction = action;
        cargoTreeProvider.setWatchMode(isWatchMode, watchAction);
        cargoTreeProvider.refresh();
    };

    const getSelectedWorkspaceMember = () => selectedWorkspaceMember;
    const setSelectedWorkspaceMember = (member: string | undefined) => {
        selectedWorkspaceMember = member;
        cargoTreeProvider.setSelectedWorkspaceMember(member);
        cargoTreeProvider.refresh();
    };

    const commandDisposables = registerCommands({
        context,
        cargoTreeProvider,
        workspaceFolder,
        getIsReleaseMode,
        setIsReleaseMode,
        getIsWatchMode,
        setIsWatchMode,
        getWatchTerminal,
        setWatchTerminal,
        getWatchAction,
        setWatchAction,
        getSelectedWorkspaceMember,
        setSelectedWorkspaceMember,
        updateToolchainStatusBar,
        runSmartDetection,
        showConfigureUnregisteredUI: (workspaceFolder: vscode.WorkspaceFolder) => 
            showConfigureUnregisteredUI(workspaceFolder, applyChangesWithMove),
        formatCargoTomlFile
    });

    for (const disposable of commandDisposables) {
        context.subscriptions.push(disposable);
    }
}

export function deactivate() {
    if (watchTerminal) {
        watchTerminal.dispose();
        watchTerminal = undefined;
        isWatchMode = false;
    }

    stopRustupUpdateChecker();
}

