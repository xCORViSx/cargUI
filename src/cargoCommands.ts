import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { discoverWorkspaceMembers, discoverCargoTargets } from './cargoDiscovery';

/**
 * Interface for accessing tree provider's checked items state.
 * This allows the cargo command functions to remain independent of the full tree provider implementation.
 */
export interface CargoTreeState {
    getCheckedTargets(): string[];
    getCheckedFeatures(): string[];
    getCheckedArguments(): string[];
    getCheckedEnvVars(): string[];
    getCheckedWorkspaceMembers(): string[];
    setWorkspaceMemberChecked(member: string, checked: boolean): void;
    refresh(): void;
}

/**
 * Builds cargo targets with a specific feature enabled.
 * 
 * @param featureName - Name of the feature to enable
 * @param release - Whether to build in release mode
 * @param treeProvider - Tree provider for accessing checked targets
 * @param selectedWorkspaceMember - Currently selected workspace member (undefined = root, 'all' = all members)
 */
export function buildWithFeature(
    featureName: string, 
    release: boolean, 
    treeProvider: CargoTreeState,
    selectedWorkspaceMember?: string
) {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (!workspaceFolder) {
        vscode.window.showErrorMessage('No workspace folder found');
        return;
    }

    // Get member path if specific member is selected
    const memberPath = selectedWorkspaceMember && selectedWorkspaceMember !== 'all'
        ? discoverWorkspaceMembers(workspaceFolder.uri.fsPath).find(m => m.name === selectedWorkspaceMember)?.path
        : undefined;

    const checkedTargets = treeProvider.getCheckedTargets();
    const allTargets = discoverCargoTargets(workspaceFolder.uri.fsPath, memberPath);
    
    // If no targets are checked, build all with this feature
    let targetsToRun: string[] = [];
    if (checkedTargets.length === 0) {
        const mainTarget = allTargets.find(t => t.type === 'bin');
        if (mainTarget) {
            targetsToRun = [mainTarget.name];
        }
    } else {
        targetsToRun = checkedTargets;
    }

    // Build command for each target with this feature
    for (const targetName of targetsToRun) {
        const target = allTargets.find(t => t.name === targetName);
        if (!target) continue;

        let command = 'cargo build';
        
        // Add --package flag if specific workspace member is selected
        if (selectedWorkspaceMember && selectedWorkspaceMember !== 'all') {
            command += ` --package ${selectedWorkspaceMember}`;
        } else if (selectedWorkspaceMember === 'all') {
            command += ' --workspace';
        }
        
        // Add target-specific flags
        if (target.type === 'bin') {
            // Skip --bin for src/main.rs (default binary)
            if (target.path !== 'src/main.rs') {
                command += ` --bin ${targetName}`;
            }
        } else if (target.type === 'example') {
            command += ` --example ${targetName}`;
        } else if (target.type === 'test') {
            command += ` --test ${targetName}`;
        } else if (target.type === 'bench') {
            command += ` --bench ${targetName}`;
        }

        if (release) {
            command += ' --release';
        }

        // Add this specific feature
        command += ` --features ${featureName}`;

        // Create and show terminal
        const terminal = vscode.window.createTerminal({
            name: `Cargo build: ${targetName} (${featureName})`,
            cwd: workspaceFolder.uri.fsPath
        });
        terminal.show();
        terminal.sendText(command);
    }
}

/**
 * Runs a specific cargo target (binary, example, test, or benchmark).
 * 
 * @param targetName - Name of the target to run
 * @param targetType - Type of target (bin, example, test, bench)
 * @param release - Whether to run in release mode
 * @param cargoTreeProvider - Tree provider for accessing checked arguments and env vars
 * @param requiredFeatures - Optional array of required features for this target (one-off, not persisted in UI)
 */
export function runCargoTarget(
    targetName: string, 
    targetType: 'lib' | 'bin' | 'example' | 'test' | 'bench', 
    release: boolean, 
    cargoTreeProvider: CargoTreeState,
    requiredFeatures?: string[]
) {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (!workspaceFolder) {
        vscode.window.showErrorMessage('No workspace folder found');
        return;
    }

    // Discover targets to check if this is src/main.rs
    const allTargets = discoverCargoTargets(workspaceFolder.uri.fsPath);
    const currentTarget = allTargets.find(t => t.name === targetName && t.type === targetType);

    let command = '';
    switch (targetType) {
        case 'bin':
            // Skip --bin for src/main.rs (default binary)
            if (currentTarget?.path === 'src/main.rs') {
                command = 'cargo run';
            } else {
                command = `cargo run --bin ${targetName}`;
            }
            break;
        case 'example':
            command = `cargo run --example ${targetName}`;
            break;
        case 'test':
            command = `cargo test --test ${targetName}`;
            break;
        case 'bench':
            command = `cargo bench --bench ${targetName}`;
            break;
    }

    if (release && (targetType === 'bin' || targetType === 'example')) {
        command += ' --release';
    }

    // Merge checked features with required features (no duplicates)
    const checkedFeatures = cargoTreeProvider.getCheckedFeatures();
    const allFeatures = [...new Set([...checkedFeatures, ...(requiredFeatures || [])])];
    if (allFeatures.length > 0) {
        command += ` --features ${allFeatures.join(',')}`;
    }

    // Add checked arguments (prefix each with -- and no space between -- and arg)
    const checkedArgs = cargoTreeProvider.getCheckedArguments();
    if (checkedArgs.length > 0) {
        const formattedArgs = checkedArgs.map(arg => `--${arg}`).join(' ');
        command += ` -- ${formattedArgs}`;
    }

    // Prepend checked environment variables to command
    const checkedEnvVars = cargoTreeProvider.getCheckedEnvVars();
    if (checkedEnvVars.length > 0) {
        command = `${checkedEnvVars.join(' ')} ${command}`;
    }

    // Create and show terminal
    const terminal = vscode.window.createTerminal({
        name: `Cargo ${targetType}: ${targetName}`,
        cwd: workspaceFolder.uri.fsPath
    });
    terminal.show();
    terminal.sendText(command);
}

/**
 * Builds a specific cargo target (binary, example, test, or benchmark).
 * 
 * @param targetName - Name of the target to build
 * @param targetType - Type of target (bin, example, test, bench)
 * @param release - Whether to build in release mode
 * @param selectedWorkspaceMember - Currently selected workspace member
 * @param cargoTreeProvider - Tree provider for accessing checked features
 * @param requiredFeatures - Optional array of required features for this target (one-off, not persisted in UI)
 */
export function buildSingleTarget(
    targetName: string, 
    targetType: 'lib' | 'bin' | 'example' | 'test' | 'bench', 
    release: boolean,
    selectedWorkspaceMember?: string,
    cargoTreeProvider?: CargoTreeState,
    requiredFeatures?: string[]
) {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (!workspaceFolder) {
        vscode.window.showErrorMessage('No workspace folder found');
        return;
    }

    let command = 'cargo build';
    
    // Add --package flag if specific workspace member is selected
    if (selectedWorkspaceMember && selectedWorkspaceMember !== 'all') {
        command += ` --package ${selectedWorkspaceMember}`;
    } else if (selectedWorkspaceMember === 'all') {
        command += ' --workspace';
    }
    
    // Discover targets to check if this is src/main.rs
    const allTargets = discoverCargoTargets(workspaceFolder.uri.fsPath, selectedWorkspaceMember);
    const currentTarget = allTargets.find(t => t.name === targetName && t.type === targetType);
    
    // Add target-specific flags
    if (targetType === 'bin') {
        // Skip --bin for src/main.rs (default binary)
        if (currentTarget?.path !== 'src/main.rs') {
            command += ` --bin ${targetName}`;
        }
    } else if (targetType === 'example') {
        command += ` --example ${targetName}`;
    } else if (targetType === 'test') {
        command += ` --test ${targetName}`;
    } else if (targetType === 'bench') {
        command += ` --bench ${targetName}`;
    }

    if (release) {
        command += ' --release';
    }

    // Merge checked features with required features (no duplicates)
    if (cargoTreeProvider) {
        const checkedFeatures = cargoTreeProvider.getCheckedFeatures();
        const allFeatures = [...new Set([...checkedFeatures, ...(requiredFeatures || [])])];
        if (allFeatures.length > 0) {
            command += ` --features ${allFeatures.join(',')}`;
        }
    }

    // Create and show terminal
    const terminal = vscode.window.createTerminal({
        name: `Cargo build: ${targetName}`,
        cwd: workspaceFolder.uri.fsPath
    });
    terminal.show();
    terminal.sendText(command);
}

/**
 * Runs a cargo command on checked targets or workspace members.
 * Handles workspace-level, member-level, and target-level execution with features, args, and env vars.
 * 
 * @param action - Cargo action to run (build, run, test, bench, check, etc.)
 * @param release - Whether to run in release mode
 * @param treeProvider - Tree provider for accessing checked items
 * @param selectedWorkspaceMember - Currently selected workspace member
 */
export async function runCargoCommandOnTargets(
    action: string, 
    release: boolean, 
    treeProvider: CargoTreeState,
    selectedWorkspaceMember?: string
) {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (!workspaceFolder) {
        vscode.window.showErrorMessage('No workspace folder found');
        return;
    }

    // Get checked workspace members
    const checkedMembers = treeProvider.getCheckedWorkspaceMembers();
    
    // Handle workspace "All" selection
    if (selectedWorkspaceMember === 'all') {
        let command = `cargo ${action} --workspace`;
        
        if (release && ['build', 'run', 'test', 'bench'].includes(action)) {
            command += ' --release';
        }

        // Add features
        const checkedFeatures = treeProvider.getCheckedFeatures();
        if (checkedFeatures.length > 0) {
            command += ` --features ${checkedFeatures.join(',')}`;
        }

        // Add arguments for run/test/bench
        if (['run', 'test', 'bench'].includes(action)) {
            const checkedArgs = treeProvider.getCheckedArguments();
            if (checkedArgs.length > 0) {
                command += ` -- ${checkedArgs.join(' ')}`;
            }
        }

        // Prepend environment variables
        const checkedEnvVars = treeProvider.getCheckedEnvVars();
        if (checkedEnvVars.length > 0) {
            command = `${checkedEnvVars.join(' ')} ${command}`;
        }

        const terminal = vscode.window.createTerminal({
            name: `Cargo ${action}: All`,
            cwd: workspaceFolder.uri.fsPath
        });
        terminal.show();
        terminal.sendText(command);
        return;
    }

    // Handle checked workspace members (multiple --package flags)
    if (checkedMembers.length > 0) {
        // Check if selected member is NOT in checked members (potential confusion)
        if (selectedWorkspaceMember && 
            selectedWorkspaceMember !== 'all' && 
            !checkedMembers.includes(selectedWorkspaceMember)) {
            
            // Check if user wants to be warned about this
            const config = vscode.workspace.getConfiguration('cargui');
            const dontWarn = config.get<boolean>('dontWarnCheckedOverSelected', false);
            
            if (!dontWarn) {
                const choice = await vscode.window.showWarningMessage(
                    `You have "${selectedWorkspaceMember}" selected but only checked members will be built. Include selected member?`,
                    { modal: false },
                    'No',
                    'Yes',
                    "Don't Ask Again"
                );
                
                if (choice === 'Yes') {
                    // Add selected member to checked members and update UI
                    treeProvider.setWorkspaceMemberChecked(selectedWorkspaceMember, true);
                    // Refresh to show the new check
                    treeProvider.refresh();
                    // Wait a bit for UI to update
                    await new Promise(resolve => setTimeout(resolve, 100));
                    // Re-fetch checked members after update
                    checkedMembers.push(selectedWorkspaceMember);
                } else if (choice === "Don't Ask Again") {
                    await config.update('dontWarnCheckedOverSelected', true, vscode.ConfigurationTarget.Global);
                } else if (choice === undefined) {
                    // User dismissed the dialog - cancel the action
                    return;
                }
                // If "No", continue with just the checked members
            }
        }
        
        let command = `cargo ${action}`;
        
        // Add --package flag for each checked member
        for (const member of checkedMembers) {
            command += ` --package ${member}`;
        }
        
        if (release && ['build', 'run', 'test', 'bench'].includes(action)) {
            command += ' --release';
        }

        // Add features
        const checkedFeatures = treeProvider.getCheckedFeatures();
        if (checkedFeatures.length > 0) {
            command += ` --features ${checkedFeatures.join(',')}`;
        }

        // Add arguments for run/test/bench
        if (['run', 'test', 'bench'].includes(action)) {
            const checkedArgs = treeProvider.getCheckedArguments();
            if (checkedArgs.length > 0) {
                command += ` -- ${checkedArgs.join(' ')}`;
            }
        }

        // Prepend environment variables
        const checkedEnvVars = treeProvider.getCheckedEnvVars();
        if (checkedEnvVars.length > 0) {
            command = `${checkedEnvVars.join(' ')} ${command}`;
        }

        const terminal = vscode.window.createTerminal({
            name: `Cargo ${action}: ${checkedMembers.join(', ')}`,
            cwd: workspaceFolder.uri.fsPath
        });
        terminal.show();
        terminal.sendText(command);
        return;
    }

    // Get member path if specific member is selected
    const memberPath = selectedWorkspaceMember
        ? discoverWorkspaceMembers(workspaceFolder.uri.fsPath).find(m => m.name === selectedWorkspaceMember)?.path
        : undefined;

    const checkedTargets = treeProvider.getCheckedTargets();
    const checkedFeatures = treeProvider.getCheckedFeatures();
    const allTargets = discoverCargoTargets(workspaceFolder.uri.fsPath, memberPath);
    
    // If no targets are checked, use main target (first binary or library)
    let targetsToRun: string[] = [];
    if (checkedTargets.length === 0) {
        // Try to find a binary first (src/main.rs or any binary)
        let mainTarget = allTargets.find(t => t.type === 'bin' && t.path === 'src/main.rs');
        if (!mainTarget) {
            mainTarget = allTargets.find(t => t.type === 'bin');
        }
        // If no binary, fall back to library
        if (!mainTarget) {
            mainTarget = allTargets.find(t => t.type === 'lib');
        }
        if (mainTarget) {
            targetsToRun = [mainTarget.name];
        } else {
            // No targets found at all
            vscode.window.showErrorMessage('No targets found to run');
            return;
        }
    } else {
        targetsToRun = checkedTargets;
    }

    // Run command for each target
    for (const targetName of targetsToRun) {
        const target = allTargets.find(t => t.name === targetName);
        if (!target) continue;

        let command = `cargo ${action}`;
        
        // Add --package flag if specific workspace member is selected
        if (selectedWorkspaceMember) {
            command += ` --package ${selectedWorkspaceMember}`;
        }
        
        // Add target-specific flags
        if (target.type === 'bin') {
            // Skip --bin for src/main.rs ONLY if no --package flag is present
            // When --package is used, cargo needs explicit --bin even for main.rs
            if (target.path !== 'src/main.rs' || selectedWorkspaceMember) {
                command += ` --bin ${targetName}`;
            }
        } else if (target.type === 'lib') {
            // Add --lib flag for library targets
            command += ` --lib`;
        } else if (target.type === 'example') {
            command += ` --example ${targetName}`;
        } else if (target.type === 'test') {
            command += ` --test ${targetName}`;
        } else if (target.type === 'bench') {
            command += ` --bench ${targetName}`;
        }

        if (release && ['build', 'run', 'test', 'bench'].includes(action)) {
            command += ' --release';
        }

        // Add features flag if any features are checked
        if (checkedFeatures.length > 0) {
            command += ` --features ${checkedFeatures.join(',')}`;
        }

        // Add checked arguments (only for run, test, bench)
        if (['run', 'test', 'bench'].includes(action)) {
            const checkedArgs = treeProvider.getCheckedArguments();
            if (checkedArgs.length > 0) {
                command += ` -- ${checkedArgs.join(' ')}`;
            }
        }

        // Prepend checked environment variables to command
        const checkedEnvVars = treeProvider.getCheckedEnvVars();
        if (checkedEnvVars.length > 0) {
            command = `${checkedEnvVars.join(' ')} ${command}`;
        }

        // Create and show terminal
        const terminal = vscode.window.createTerminal({
            name: `Cargo ${action}: ${targetName}`,
            cwd: workspaceFolder.uri.fsPath
        });
        terminal.show();
        terminal.sendText(command);
    }
}

/**
 * Runs a simple cargo command with optional arguments.
 * This is the basic version that doesn't use the tree provider state.
 * 
 * @param action - Cargo action to run (build, run, test, bench, check, clean, etc.)
 * @param release - Whether to run in release mode
 * @param args - Optional additional arguments to pass to cargo
 */
export function runCargoCommand(action: string, release: boolean = false, args?: string) {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (!workspaceFolder) {
        vscode.window.showErrorMessage('No workspace folder found');
        return;
    }

    // Check if Cargo.toml exists
    const cargoTomlPath = path.join(workspaceFolder.uri.fsPath, 'Cargo.toml');
    if (!fs.existsSync(cargoTomlPath)) {
        vscode.window.showErrorMessage('Cargo.toml not found in workspace');
        return;
    }

    let command = `cargo ${action}`;
    if (release && ['build', 'run', 'test', 'bench'].includes(action)) {
        command += ' --release';
    }
    if (args && args.trim()) {
        command += ` ${args.trim()}`;
    }

    // Create and show terminal
    const terminal = vscode.window.createTerminal({
        name: `Cargo ${action}`,
        cwd: workspaceFolder.uri.fsPath
    });
    terminal.show();
    terminal.sendText(command);
}
