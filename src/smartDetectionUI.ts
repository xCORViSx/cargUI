import * as vscode from 'vscode';
import { DetectionResult, UnregisteredItem } from './types';
import { detectUnregisteredTargets, detectUndeclaredFeatures } from './smartDetection';
import { discoverWorkspaceMembers } from './cargoDiscovery';

/**
 * Runs smart detection across all workspace members.
 */
export async function runSmartDetection(workspaceFolder: vscode.WorkspaceFolder): Promise<DetectionResult> {
    const result: DetectionResult = {
        targets: [],
        features: []
    };

    const members = discoverWorkspaceMembers(workspaceFolder.uri.fsPath);

    if (members.length > 0) {
        for (const member of members) {
            if (!member.isRoot) {
                result.targets.push(...detectUnregisteredTargets(workspaceFolder.uri.fsPath, member.path));
                result.features.push(...detectUndeclaredFeatures(workspaceFolder.uri.fsPath, member.path));
            }
        }
    } else {
        result.targets.push(...detectUnregisteredTargets(workspaceFolder.uri.fsPath));
        result.features.push(...detectUndeclaredFeatures(workspaceFolder.uri.fsPath));
    }

    return result;
}

/**
 * Shows a UI dialog for configuring unregistered targets and undeclared features.
 */
export async function showConfigureUnregisteredUI(
    workspaceFolder: vscode.WorkspaceFolder,
    applyChanges: (workspaceFolder: vscode.WorkspaceFolder, items: UnregisteredItem[]) => Promise<void>
) {
    const detection = await runSmartDetection(workspaceFolder);
    const totalItems = detection.targets.length + detection.features.length;

    if (totalItems === 0) {
        vscode.window.showInformationMessage('No unregistered targets or undeclared features found!');
        return;
    }

    const unknownTargets = detection.targets.filter(t => t.type === 'unknown');
    if (unknownTargets.length > 0) {
        const resolvedTargets = await resolveUnknownTargetTypes(unknownTargets, workspaceFolder);
        if (!resolvedTargets) {
            return;
        }

        detection.targets = [
            ...detection.targets.filter(t => t.type !== 'unknown'),
            ...resolvedTargets
        ];
    }

    interface ConfigureQuickPickItem extends vscode.QuickPickItem {
        item: UnregisteredItem;
        picked: boolean;
    }

    const items: ConfigureQuickPickItem[] = [];

    if (detection.targets.length > 0) {
        for (const target of detection.targets) {
            const icon = target.type === 'bin' ? '$(file-binary)'
                : target.type === 'example' ? '$(note)'
                : target.type === 'test' ? '$(beaker)'
                : target.type === 'bench' ? '$(dashboard)'
                : '$(file-code)';
            const memberInfo = target.memberName ? ` (${target.memberName})` : '';
            items.push({
                label: `${icon} ${target.name}`,
                description: `${target.type}${memberInfo}: ${target.path}`,
                detail: `Add [[${target.type}]] section to Cargo.toml`,
                item: target,
                picked: true
            });
        }
    }

    if (detection.features.length > 0) {
        for (const feature of detection.features) {
            const memberInfo = feature.memberName ? ` (${feature.memberName})` : '';
            items.push({
                label: `$(symbol-key) ${feature.name}`,
                description: `feature${memberInfo}`,
                detail: `Add to [features] section in Cargo.toml`,
                item: feature,
                picked: true
            });
        }
    }

    const quickPick = vscode.window.createQuickPick<ConfigureQuickPickItem>();
    quickPick.title = 'Configure Unregistered Items';
    quickPick.placeholder = `Found ${detection.targets.length} unregistered target(s) and ${detection.features.length} undeclared feature(s). Select items to add to Cargo.toml.`;
    quickPick.canSelectMany = true;
    quickPick.items = items;
    quickPick.selectedItems = items;
    quickPick.buttons = [
        { iconPath: new vscode.ThemeIcon('check'), tooltip: 'Apply Changes' },
        { iconPath: new vscode.ThemeIcon('close'), tooltip: 'Cancel' }
    ];

    // Open file when item is focused (single-click behavior)
    quickPick.onDidChangeActive(async (activeItems) => {
        if (activeItems.length > 0) {
            const item = activeItems[0].item;
            // Only open file for targets with paths (not features)
            if (item.path && item.type !== 'feature') {
                let basePath = workspaceFolder.uri;
                if (item.memberName) {
                    // Look up actual member path from memberName
                    const members = discoverWorkspaceMembers(workspaceFolder.uri.fsPath);
                    const member = members.find(m => m.name === item.memberName);
                    if (member) {
                        basePath = vscode.Uri.joinPath(workspaceFolder.uri, member.path);
                    }
                    // For single-crate packages, member won't be found, so basePath stays as root
                }
                const fileUri = vscode.Uri.joinPath(basePath, item.path);
                try {
                    await vscode.window.showTextDocument(fileUri, { preview: true, preserveFocus: true });
                } catch (error) {
                    // Silently fail if file doesn't exist yet
                }
            }
        }
    });

    quickPick.onDidAccept(async () => {
        const selected = quickPick.selectedItems;
        if (selected.length === 0) {
            quickPick.hide();
            vscode.window.showInformationMessage('No items selected');
            return;
        }

        quickPick.hide();
        await applyChanges(workspaceFolder, selected.map(s => s.item));
    });

    quickPick.onDidTriggerButton(button => {
        if (button.tooltip === 'Cancel') {
            quickPick.hide();
        }
    });

    quickPick.show();
}

/**
 * Resolves unknown target types by prompting the user for the correct type.
 */
export async function resolveUnknownTargetTypes(
    unknownTargets: UnregisteredItem[],
    workspaceFolder?: vscode.WorkspaceFolder
): Promise<UnregisteredItem[] | null> {
    const resolved: UnregisteredItem[] = [];

    for (const target of unknownTargets) {
        // Open the file in preview mode before asking for classification
        if (target.path && workspaceFolder) {
            let basePath = workspaceFolder.uri;
            if (target.memberName) {
                // Look up actual member path from memberName
                const members = discoverWorkspaceMembers(workspaceFolder.uri.fsPath);
                const member = members.find(m => m.name === target.memberName);
                if (member) {
                    basePath = vscode.Uri.joinPath(workspaceFolder.uri, member.path);
                }
                // For single-crate packages, member won't be found, so basePath stays as root
            }
            const fileUri = vscode.Uri.joinPath(basePath, target.path);
            try {
                await vscode.window.showTextDocument(fileUri, { preview: true, preserveFocus: false });
            } catch (error) {
                // Continue if file can't be opened
            }
        }

        const choice = await vscode.window.showQuickPick([
            { label: '$(file-binary) Binary', description: 'Move to src/bin/ - declare under [[bin]] in Cargo.toml', value: 'bin', shouldMove: true },
            { label: '$(file-binary) Binary (keep here)', description: 'Stay in current location - declare under [[bin]] in Cargo.toml', value: 'bin-keep', shouldMove: false },
            { label: '$(note) Example', description: 'Move to examples/ - declare under [[example]] in Cargo.toml', value: 'example', shouldMove: true },
            { label: '$(note) Example (keep here)', description: 'Stay in current location - declare under [[example]] in Cargo.toml', value: 'example-keep', shouldMove: false },
            { label: '$(beaker) Test', description: 'Move to tests/ - declare under [[test]] in Cargo.toml', value: 'test', shouldMove: true },
            { label: '$(beaker) Test (keep here)', description: 'Stay in current location - declare under [[test]] in Cargo.toml', value: 'test-keep', shouldMove: false },
            { label: '$(dashboard) Benchmark', description: 'Move to benches/ - declare under [[bench]] in Cargo.toml', value: 'bench', shouldMove: true },
            { label: '$(dashboard) Benchmark (keep here)', description: 'Stay in current location - declare under [[bench]] in Cargo.toml', value: 'bench-keep', shouldMove: false },
            { label: '', kind: vscode.QuickPickItemKind.Separator },
            { label: '$(close) Skip', description: 'Keep as is (intentionally not a target)', value: 'skip', shouldMove: false }
        ], {
            title: `What type of target is '${target.name}' (${target.path})?`,
            placeHolder: 'Select the target type and location...'
        });

        if (!choice) {
            return null;
        }

        if (choice.value === 'skip') {
            continue;
        }

        const baseType = (choice.value || '').replace('-keep', '') as 'bin' | 'example' | 'test' | 'bench';

        resolved.push({
            ...target,
            type: baseType,
            shouldMove: choice.shouldMove
        });
    }

    return resolved;
}
