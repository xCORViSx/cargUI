import * as vscode from 'vscode';
import { ArgumentCategory, CustomCommand, CustomCommandCategory, Snapshot } from './types';
import { discoverWorkspaceMembers, discoverCargoTargets } from './cargoDiscovery';
import { CargoTreeDataProvider } from './cargoTreeProvider';

/**
 * Initializes default workspace configuration settings for cargUI.
 * Creates default argument categories, environment variables, custom commands,
 * and snapshots if they don't already exist in the workspace configuration.
 */
export async function initializeDefaultConfig(
    workspaceFolder: vscode.WorkspaceFolder,
    cargoTreeProvider: CargoTreeDataProvider
): Promise<void> {
    const config = vscode.workspace.getConfiguration('cargui');

    // Initialize default argument categories
    const argCategoriesInspection = config.inspect<ArgumentCategory[]>('argumentCategories');
    if (!argCategoriesInspection?.workspaceValue && !argCategoriesInspection?.workspaceFolderValue) {
        const defaultArgCategories: ArgumentCategory[] = [
            {
                name: 'Common',
                arguments: ['--color never', '--keep-going', '--all-targets', '--workspace']
            },
            {
                name: 'Compilation Targets',
                arguments: [
                    '--target x86_64-unknown-linux-gnu',
                    '--target x86_64-pc-windows-gnu',
                    '--target x86_64-pc-windows-msvc',
                    '--target aarch64-apple-darwin',
                    '--target x86_64-apple-darwin',
                    '--target wasm32-unknown-unknown',
                    '--target wasm32-wasi',
                    '--target aarch64-unknown-linux-gnu'
                ]
            },
            {
                name: 'Performance',
                arguments: ['--jobs 1', '--jobs 2', '--jobs 4', '--jobs 8', '--timings']
            },
            {
                name: 'Output Control',
                arguments: ['--message-format json', '--message-format short', '--message-format human']
            },
            {
                name: 'Build Options',
                arguments: ['--locked', '--frozen', '--offline', '--all-features', '--no-default-features']
            }
        ];
        await config.update('argumentCategories', defaultArgCategories, vscode.ConfigurationTarget.Workspace);
        cargoTreeProvider.refresh();
    }

    // Initialize default environment variables
    const envVarsInspection = config.inspect<string[]>('environmentVariables');
    if (!envVarsInspection?.workspaceValue && !envVarsInspection?.workspaceFolderValue) {
        const defaultEnvVars = ['RUST_BACKTRACE=1', 'RUST_LOG=info', 'CARGO_INCREMENTAL=1'];
        await config.update('environmentVariables', defaultEnvVars, vscode.ConfigurationTarget.Workspace);
        cargoTreeProvider.refresh();
    }

    // Initialize default custom command categories
    const customCommandCategoriesInspection = config.inspect<CustomCommandCategory[]>('customCommandCategories');
    if (!customCommandCategoriesInspection?.workspaceValue && !customCommandCategoriesInspection?.workspaceFolderValue) {
        const defaultCategories: CustomCommandCategory[] = [
            {
                name: 'Inspection',
                commands: [
                    { name: 'Show Outdated Deps', command: 'cargo outdated' },
                    { name: 'Show Crate Metadata', command: 'cargo metadata --no-deps' },
                    { name: 'List Installed Tools', command: 'cargo install --list' },
                    { name: 'Show All Features', command: 'cargo tree --all-features' }
                ]
            },
            {
                name: 'Analysis',
                commands: [
                    { name: 'Check Compile Times', command: 'cargo build --timings' },
                    { name: 'Show Feature Tree', command: 'cargo tree --format "{p} {f}"' },
                    { name: 'Analyze Binary Size', command: 'cargo bloat --release' },
                    { name: 'Generate Docs', command: 'cargo doc --no-deps --open' }
                ]
            }
        ];
        await config.update('customCommandCategories', defaultCategories, vscode.ConfigurationTarget.Workspace);
        cargoTreeProvider.refresh();
    }

    // Initialize default snapshots
    const snapshotsInspection = config.inspect<Snapshot[]>('snapshots');
    if (!snapshotsInspection?.workspaceValue && !snapshotsInspection?.workspaceFolderValue) {
        const defaultSnapshots: Snapshot[] = [];
        const workspaceMembers = discoverWorkspaceMembers(workspaceFolder.uri.fsPath);

        if (workspaceMembers.length > 0) {
            for (const member of workspaceMembers) {
                const memberTargets = discoverCargoTargets(workspaceFolder.uri.fsPath, member.path);
                const mainTarget = memberTargets.find(t => t.type === 'bin' && t.path === 'src/main.rs');

                if (mainTarget) {
                    defaultSnapshots.push({
                        name: 'main',
                        mode: 'debug',
                        targets: [mainTarget.name],
                        features: [],
                        arguments: [],
                        envVars: [],
                        workspaceMember: member.name,
                        checkedWorkspaceMembers: []
                    });
                } else {
                    defaultSnapshots.push({
                        name: 'lib',
                        mode: 'debug',
                        targets: [],
                        features: [],
                        arguments: [],
                        envVars: [],
                        workspaceMember: member.name,
                        checkedWorkspaceMembers: []
                    });
                }
            }
        } else {
            const targets = discoverCargoTargets(workspaceFolder.uri.fsPath);
            const mainTarget = targets.find(t => t.type === 'bin' && t.path === 'src/main.rs');

            if (mainTarget) {
                defaultSnapshots.push({
                    name: 'main',
                    mode: 'debug',
                    targets: [mainTarget.name],
                    features: [],
                    arguments: [],
                    envVars: []
                });
            } else {
                defaultSnapshots.push({
                    name: 'lib',
                    mode: 'debug',
                    targets: [],
                    features: [],
                    arguments: [],
                    envVars: []
                });
            }
        }

        if (defaultSnapshots.length > 0) {
            await config.update('snapshots', defaultSnapshots, vscode.ConfigurationTarget.Workspace);
            cargoTreeProvider.refresh();
        }
    }
}
