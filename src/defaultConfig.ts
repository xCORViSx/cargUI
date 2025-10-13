import * as vscode from 'vscode';
import { ArgumentCategory, CustomCommand, Snapshot } from './types';
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
                arguments: ['--verbose', '--quiet', '--color always', '--color never']
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

    // Initialize default custom commands
    const customCommandsInspection = config.inspect<CustomCommand[]>('customCommands');
    if (!customCommandsInspection?.workspaceValue && !customCommandsInspection?.workspaceFolderValue) {
        const defaultCommands = [
            { name: 'Clippy Lint', command: 'cargo clippy' },
            { name: 'Search Crates', command: 'cargo search serde' },
            { name: 'Add Dependency', command: 'cargo add tokio' },
            { name: 'Tree Dependencies', command: 'cargo tree' },
            { name: 'Update', command: 'cargo update' },
            { name: 'Bench', command: 'cargo bench' }
        ];
        await config.update('customCommands', defaultCommands, vscode.ConfigurationTarget.Workspace);
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
