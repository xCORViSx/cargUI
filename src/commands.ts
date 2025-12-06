// I coordinate cargUI command registration so the extension can expose cargo workflows in VS Code.
import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as toml from '@iarna/toml';

import { CargoTreeDataProvider } from './cargoTreeProvider';
import { CargoTreeItem } from './treeItems';
import {
	ArgumentCategory,
	CustomCommand,
	CustomCommandCategory,
	Snapshot,
	Dependency,
	CargoTarget,
	CargoManifest,
	UnregisteredItem,
	DetectionResult,
	ModuleInfo
} from './types';
import {
	discoverWorkspaceMembers,
	discoverCargoTargets,
	discoverCargoFeatures,
	discoverCargoDependencies
} from './cargoDiscovery';
import {
	moveTargetToStandardLocation,
	updateDependencyVersions,
	removeDuplicateDependencies
} from './cargoToml';
import { detectUndeclaredFeatures } from './smartDetection';
import { detectModules } from './moduleDetection';
import {
	fetchCrateMetadata,
	fetchCrateVersions,
	searchCrates
} from './cratesIo';
import { getCurrentEdition, selectEdition, updateEdition } from './rustEdition';
import {
	buildWithFeature,
	runCargoCommand,
	runCargoCommandOnTargets,
	runCargoTarget,
	buildSingleTarget
} from './cargoCommands';
import {
	getCurrentToolchain,
	checkRustupUpdates
} from './rustup';

export interface CommandDependencies {
	context: vscode.ExtensionContext;
	cargoTreeProvider: CargoTreeDataProvider;
	getWorkspaceFolder(): vscode.WorkspaceFolder | undefined;
	getIsReleaseMode(): boolean;
	setIsReleaseMode(value: boolean): void;
	getIsWatchMode(): boolean;
	setIsWatchMode(value: boolean): void;
	getWatchTerminal(): vscode.Terminal | undefined;
	setWatchTerminal(terminal: vscode.Terminal | undefined): void;
	getWatchAction(): string;
	setWatchAction(action: string): void;
	getSelectedWorkspaceMember(): string | undefined;
	setSelectedWorkspaceMember(member: string | undefined): void;
	selectWorkspaceFolder(index: number): Promise<void>;
	updateToolchainStatusBar(): Promise<void>;
	runSmartDetection(workspaceFolder: vscode.WorkspaceFolder): Promise<DetectionResult>;
	showConfigureUnregisteredUI(workspaceFolder: vscode.WorkspaceFolder): Promise<void>;
	formatCargoTomlFile(cargoTomlPath: string, memberName?: string): Promise<boolean>;
}

interface CommandStateFacade {
	isReleaseMode: boolean;
	isWatchMode: boolean;
	watchTerminal: vscode.Terminal | undefined;
	watchAction: string;
	selectedWorkspaceMember: string | undefined;
}

function createStateFacade(deps: CommandDependencies): CommandStateFacade {
	return new Proxy({} as CommandStateFacade, {
		get(_target, prop: keyof CommandStateFacade) {
			switch (prop) {
				case 'isReleaseMode':
					return deps.getIsReleaseMode();
				case 'isWatchMode':
					return deps.getIsWatchMode();
				case 'watchTerminal':
					return deps.getWatchTerminal();
				case 'watchAction':
					return deps.getWatchAction();
				case 'selectedWorkspaceMember':
					return deps.getSelectedWorkspaceMember();
				default:
					return undefined;
			}
		},
		set(_target, prop: keyof CommandStateFacade, value: any) {
			switch (prop) {
				case 'isReleaseMode':
					deps.setIsReleaseMode(value as boolean);
					return true;
				case 'isWatchMode':
					deps.setIsWatchMode(value as boolean);
					return true;
				case 'watchTerminal':
					deps.setWatchTerminal(value as vscode.Terminal | undefined);
					return true;
				case 'watchAction':
					deps.setWatchAction(value as string);
					return true;
				case 'selectedWorkspaceMember':
					deps.setSelectedWorkspaceMember(value as string | undefined);
					return true;
				default:
					return false;
			}
		}
	});
}

export function registerCommands(deps: CommandDependencies): vscode.Disposable[] {
	const {
		context,
		cargoTreeProvider,
		updateToolchainStatusBar,
		runSmartDetection,
		showConfigureUnregisteredUI,
		formatCargoTomlFile
	} = deps;

	const state = createStateFacade(deps);

	const disposables: vscode.Disposable[] = [];

	const register = (commandId: string, callback: (...args: any[]) => any) => {
		const disposable = vscode.commands.registerCommand(commandId, callback);
		disposables.push(disposable);
		return disposable;
	};

	// Helper function to auto-format Cargo.toml after edits with undo option
	const autoFormatCargoToml = async (cargoTomlPath: string, memberName?: string, actionDescription: string = 'Cargo.toml modified') => {
		const config = vscode.workspace.getConfiguration('cargui');
		const autoFormat = config.get<boolean>('autoFormatCargoToml', true);
		
		if (!autoFormat) {
			return;
		}

		// Read content before formatting for undo
		const beforeContent = fs.readFileSync(cargoTomlPath, 'utf-8');
		
		// Format the file
		const success = await formatCargoTomlFile(cargoTomlPath, memberName);
		
		if (success) {
			// Show notification with Undo and Disable buttons
			const action = await vscode.window.showInformationMessage(
				`${actionDescription} - Cargo.toml formatted`,
			'Undo',
			'Disable Auto-Formatting'
		);
		
		if (action === 'Undo') {
			// Restore original content
			fs.writeFileSync(cargoTomlPath, beforeContent, 'utf-8');
			vscode.window.showInformationMessage('Cargo.toml formatting undone');
		} else if (action === 'Disable Auto-Formatting') {
			await config.update('autoFormatCargoToml', false, vscode.ConfigurationTarget.Global);
			const reEnableChoice = await vscode.window.showInformationMessage(
				'Auto-formatting disabled.',
				'Re-enable'
			);
			if (reEnableChoice === 'Re-enable') {
				await config.update('autoFormatCargoToml', true, vscode.ConfigurationTarget.Global);
				const disableChoice = await vscode.window.showInformationMessage(
					'Auto-formatting re-enabled.',
					'Disable'
				);
				if (disableChoice === 'Disable') {
					await config.update('autoFormatCargoToml', false, vscode.ConfigurationTarget.Global);
					vscode.window.showInformationMessage('Auto-formatting disabled.');
				}
			}
		}
	}
};	const addDependencyWithName = async (
		initialCrateName?: string,
		dependencyType?: 'production' | 'dev' | 'build' | 'workspace',
		workspaceFolder?: vscode.WorkspaceFolder
	) => {
		const activeWorkspace = workspaceFolder || deps.getWorkspaceFolder();
		if (!activeWorkspace) {
			return;
		}

		let crateName = initialCrateName;
		if (!crateName) {
			const quickPick = vscode.window.createQuickPick();
			quickPick.placeholder = 'Type to search for a crate (e.g., tokio, serde, fundsp)';
			quickPick.matchOnDescription = false;
			quickPick.matchOnDetail = false;

			let searchTimeout: NodeJS.Timeout | undefined;
			let lastQuery = '';

			quickPick.onDidChangeValue(async value => {
				if (!value || value.length < 1) {
					quickPick.items = [];
					if (searchTimeout) {
						clearTimeout(searchTimeout);
						searchTimeout = undefined;
					}
					return;
				}

				if (searchTimeout) {
					clearTimeout(searchTimeout);
				}

				searchTimeout = setTimeout(async () => {
					if (value === lastQuery) {
						return;
					}
					lastQuery = value;
					quickPick.busy = true;
					try {
						const results = await searchCrates(value);
						if (results.length === 0) {
							quickPick.items = [{
								label: value,
								description: '(no results found - press Enter to use anyway)',
								alwaysShow: true
							}];
						} else {
							quickPick.items = results.map(crate => ({
								label: crate.name,
								description: crate.description ? `${crate.description.split(/[.!?]\s/)[0]}.` : '',
								alwaysShow: true
							}));
						}
					} catch (error) {
						console.error('Search error:', error);
						quickPick.items = [{
							label: value,
							description: '(search failed - press Enter to use anyway)',
							alwaysShow: true
						}];
					} finally {
						quickPick.busy = false;
					}
				}, 200);
			});

			const selected = await new Promise<string | undefined>(resolve => {
				quickPick.onDidAccept(() => {
					const picked = quickPick.selectedItems[0];
					if (picked) {
						resolve(picked.label);
					} else if (quickPick.value && /^[a-zA-Z0-9_-]+$/.test(quickPick.value)) {
						resolve(quickPick.value);
					}
					quickPick.hide();
				});

				quickPick.onDidHide(() => {
					resolve(undefined);
					quickPick.dispose();
				});

				quickPick.show();
			});

			if (!selected) {
				return;
			}

			crateName = selected;
		}

		let versions: string[] = [];
		try {
			versions = await vscode.window.withProgress({
				location: vscode.ProgressLocation.Notification,
				title: `Fetching versions for ${crateName}...`,
				cancellable: false
			}, () => fetchCrateVersions(crateName!));
		} catch (error) {
			vscode.window.showErrorMessage(`Failed to fetch versions for "${crateName}": ${error}`);
			return;
		}

		if (versions.length === 0) {
			const suggestions = await vscode.window.withProgress({
				location: vscode.ProgressLocation.Notification,
				title: `Searching for similar crates...`,
				cancellable: false
			}, () => searchCrates(crateName!));

			if (suggestions.length > 0) {
				const choice = await vscode.window.showQuickPick(
					suggestions.map(c => ({
						label: c.name,
						description: c.description ? `${c.description.split(/[.!?]\s/)[0]}.` : ''
					})),
					{
						placeHolder: `Crate "${crateName}" not found. Did you mean one of these?`,
						title: 'Crate Not Found - Select a suggestion or press Escape to cancel'
					}
				);

				if (choice) {
					await addDependencyWithName(choice.label, dependencyType);
				}
			} else {
				vscode.window.showErrorMessage(`No crate found with name "${crateName}".`);
			}
			return;
		}

		const versionItems = versions.map((version, index) => ({
			label: version,
			description: index === 0 ? 'latest' : undefined,
			picked: index === 0
		}));

		const selectedVersionItem = await vscode.window.showQuickPick(versionItems, {
			placeHolder: `Select version for ${crateName}`,
			title: `Add ${crateName} (${versions.length} versions available)`
		});

		if (!selectedVersionItem) {
			return;
		}

		const selectedVersion = selectedVersionItem.label;
		let availableFeatures: string[] = [];
		try {
			const metadata = await vscode.window.withProgress({
				location: vscode.ProgressLocation.Notification,
				title: `Fetching features for ${crateName}...`,
				cancellable: false
			}, () => fetchCrateMetadata(crateName!, selectedVersion));

			availableFeatures = metadata.features;
		} catch (error) {
			console.log(`Could not fetch features for ${crateName}: ${error}`);
		}

		let selectedFeatures: string[] = [];
		if (availableFeatures.length > 0) {
			const featureItems = availableFeatures.map(feature => ({
				label: feature,
				picked: feature === 'default'
			}));

			const pickedFeatures = await vscode.window.showQuickPick(featureItems, {
				placeHolder: `Select features for ${crateName} (optional)`,
				title: `${crateName} Features (${availableFeatures.length} available)`,
				canPickMany: true
			});

			if (pickedFeatures === undefined) {
				return;
			}

			selectedFeatures = pickedFeatures.map(item => item.label);
		}

		if (!dependencyType) {
			const workspaceMembers = discoverWorkspaceMembers(activeWorkspace.uri.fsPath);
			const isWorkspace = workspaceMembers.length > 0;

			const typeOptions: Array<{ label: string; value: 'production' | 'dev' | 'build' | 'workspace'; description: string }> = [
				{ label: 'Production', value: 'production', description: 'Regular dependency [dependencies]' },
				{ label: 'Dev', value: 'dev', description: 'Development dependency [dev-dependencies]' },
				{ label: 'Build', value: 'build', description: 'Build dependency [build-dependencies]' }
			];

			if (isWorkspace) {
				typeOptions.unshift({ label: 'Workspace', value: 'workspace', description: 'Workspace dependency [workspace.dependencies]' });
			}

			const selectedType = await vscode.window.showQuickPick(typeOptions, {
				placeHolder: `Select dependency type for ${crateName}`,
				title: 'Dependency Type'
			});

			if (!selectedType) {
				return;
			}

			dependencyType = selectedType.value;
		}

		const sectionMap: Record<'production' | 'dev' | 'build' | 'workspace', string> = {
			production: 'dependencies',
			dev: 'dev-dependencies',
			build: 'build-dependencies',
			workspace: 'workspace.dependencies'
		};

		const workspaceMembers = discoverWorkspaceMembers(activeWorkspace.uri.fsPath);
		const isWorkspace = workspaceMembers.length > 0;

		let targetCargoToml: string;
		let dependencySection: string;

		const selectedMember = state.selectedWorkspaceMember;
		if (selectedMember && selectedMember !== 'all' && dependencyType !== 'workspace') {
			const member = workspaceMembers.find(m => m.name === selectedMember);
			if (!member) {
				vscode.window.showErrorMessage('Selected workspace member not found');
				return;
			}
			targetCargoToml = path.join(activeWorkspace.uri.fsPath, member.path, 'Cargo.toml');
			dependencySection = sectionMap[dependencyType];
		} else if (dependencyType === 'workspace' && isWorkspace) {
			targetCargoToml = path.join(activeWorkspace.uri.fsPath, 'Cargo.toml');
			dependencySection = sectionMap.workspace;
		} else {
			targetCargoToml = path.join(activeWorkspace.uri.fsPath, 'Cargo.toml');
			dependencySection = sectionMap[dependencyType!];
		}

		if (!fs.existsSync(targetCargoToml)) {
			vscode.window.showErrorMessage(`Cargo.toml not found at ${targetCargoToml}`);
			return;
		}

		try {
			const content = fs.readFileSync(targetCargoToml, 'utf-8');
			const lines = content.split('\n');

			let sectionIndex = -1;
			let insertIndex = -1;

			for (let i = 0; i < lines.length; i++) {
				const trimmed = lines[i].trim();
				if (trimmed === `[${dependencySection}]`) {
					sectionIndex = i;
					let lastDepLine = i;
					for (let j = i + 1; j < lines.length; j++) {
						const nextTrimmed = lines[j].trim();
						if (nextTrimmed.startsWith('[')) {
							break;
						} else if (nextTrimmed && !nextTrimmed.startsWith('#')) {
							lastDepLine = j;
						}
					}
					insertIndex = lastDepLine;
					break;
				}
			}

			if (sectionIndex === -1) {
				let insertSectionAt = lines.length;
				for (let i = 0; i < lines.length; i++) {
					const trimmed = lines[i].trim();
					if (trimmed.startsWith('[workspace.package]') || trimmed.startsWith('[profile.') || trimmed.startsWith('[package]')) {
						insertSectionAt = i;
						break;
					}
				}

				lines.splice(insertSectionAt, 0, '', `[${dependencySection}]`);
				sectionIndex = insertSectionAt + 1;
				insertIndex = sectionIndex;
			}

		for (let i = sectionIndex + 1; i < lines.length; i++) {
			const trimmed = lines[i].trim();
			if (trimmed.startsWith('[')) {
				break;
			}
			// Normalize dependency names: Rust treats hyphens and underscores as equivalent
			const normalizedCrateName = crateName.replace(/_/g, '-');
			const normalizedLineName = trimmed.split(/\s*=/)[0].trim().replace(/_/g, '-');
			if (normalizedLineName === normalizedCrateName) {
				vscode.window.showWarningMessage(`Dependency "${crateName}" already exists in ${dependencySection}`);
				return;
			}
		}			let depLine = `${crateName} = "${selectedVersion}"`;
			if (selectedFeatures.length > 0) {
				depLine = `${crateName} = { version = "${selectedVersion}", features = [${selectedFeatures.map(f => `"${f}"`).join(', ')}] }`;
			}

			lines.splice(insertIndex + 1, 0, depLine);
			fs.writeFileSync(targetCargoToml, lines.join('\n'), 'utf-8');

			const featureMsg = selectedFeatures.length > 0 ? ` with features [${selectedFeatures.join(', ')}]` : '';
			vscode.window.showInformationMessage(`Added ${crateName} ${selectedVersion}${featureMsg} to ${dependencySection}`);
			cargoTreeProvider.refresh();
			await autoFormatCargoToml(targetCargoToml, undefined, `Added dependency ${crateName} ${selectedVersion}`);
		} catch (error) {
			vscode.window.showErrorMessage(`Failed to add dependency: ${error}`);
		}
	};

	// Direct cargo commands
	register('cargui.build', () => {
		runCargoCommandOnTargets('build', state.isReleaseMode, cargoTreeProvider, cargoTreeProvider.getSelectedWorkspaceMember());
	});

	register('cargui.run', () => {
		runCargoCommandOnTargets('run', state.isReleaseMode, cargoTreeProvider, cargoTreeProvider.getSelectedWorkspaceMember());
	});

	register('cargui.test', () => {
		runCargoCommandOnTargets('test', state.isReleaseMode, cargoTreeProvider, cargoTreeProvider.getSelectedWorkspaceMember());
	});

	// I add a bench command so you can run the full benchmark suite without diving into the tree.
	register('cargui.bench', () => {
		// I call the simple cargo bench runner so it executes every benchmark target by default.
		runCargoCommand('bench', state.isReleaseMode);
	});

	register('cargui.check', () => {
		runCargoCommandOnTargets('check', state.isReleaseMode, cargoTreeProvider, cargoTreeProvider.getSelectedWorkspaceMember());
	});

	register('cargui.clean', () => {
		runCargoCommand('clean', false);
	});

	register('cargui.fix', () => {
		runCargoCommand('fix', state.isReleaseMode);
	});

	register('cargui.fmt', () => {
		runCargoCommand('fmt', false);
	});

	register('cargui.doc', () => {
		runCargoCommand('doc', state.isReleaseMode);
	});

	register('cargui.showRustupInfo', async () => {
		const config = vscode.workspace.getConfiguration('cargui');

		const channels: Array<{ name: string; key: string; displayName: string }> = [
			{ name: 'stable', key: 'rustup.checkStable', displayName: 'stable' },
			{ name: 'beta', key: 'rustup.checkBeta', displayName: 'beta' },
			{ name: 'nightly', key: 'rustup.checkNightly', displayName: 'nightly' }
		];

		interface RustupQuickPickItem extends vscode.QuickPickItem {
			channelName: string;
			channelKey: string;
			hasUpdate: boolean;
			isInstalled: boolean;
			buttons?: vscode.QuickInputButton[];
		}

		const quickPick = vscode.window.createQuickPick<RustupQuickPickItem>();
		quickPick.title = 'Rust Toolchain Management';
		quickPick.placeholder = 'Loading toolchain information...';
		quickPick.busy = true;
		quickPick.canSelectMany = false;

		quickPick.items = channels.map(channel => ({
			label: channel.displayName,
			description: 'Loading...',
			channelName: channel.name,
			channelKey: channel.key,
			hasUpdate: false,
			isInstalled: false,
			buttons: []
		}));

		quickPick.show();

		const [currentToolchain, toolchainInfos] = await Promise.all([
			getCurrentToolchain(),
			checkRustupUpdates()
		]);

		const activeChannel = currentToolchain.split('-')[0];

		const items: RustupQuickPickItem[] = channels.map(channel => {
			const isMonitored = config.get<boolean>(channel.key, channel.name === 'stable');
			const toolchainInfo = toolchainInfos.find(info => info.channel === channel.name);
			const isActive = activeChannel === channel.name;
			const isInstalled = toolchainInfo !== undefined;

			let label = '';
			if (isActive) {
				label = '$(circle-filled) ';
			}
			label += channel.displayName;

			let description = '';
			if (toolchainInfo) {
				description = `${toolchainInfo.currentVersion}`;
			} else {
				description = 'Not installed';
			}

			if (isMonitored) {
				description += ' $(check) auto-update';
			}

			const button: vscode.QuickInputButton = {
				iconPath: new vscode.ThemeIcon(
					isInstalled ? (toolchainInfo?.hasUpdate ? 'cloud-download' : 'sync') : 'cloud-download'
				),
				tooltip: isInstalled
					? toolchainInfo?.hasUpdate
						? `Update to ${toolchainInfo.availableVersion}`
						: 'Reinstall'
					: 'Install'
			};

			return {
				label,
				description,
				detail: undefined,
				channelName: channel.name,
				channelKey: channel.key,
				hasUpdate: toolchainInfo?.hasUpdate || false,
				isInstalled,
				buttons: [button]
			};
		});

		quickPick.items = items;
		quickPick.placeholder = 'Select toolchain to activate or toggle auto-update monitoring';
		quickPick.busy = false;

		quickPick.onDidTriggerItemButton(async event => {
			const item = event.item as RustupQuickPickItem;
			const action = item.isInstalled ? 'update' : 'install';

			vscode.window.withProgress({
				location: vscode.ProgressLocation.Notification,
				title: `${action === 'install' ? 'Installing' : 'Updating'} ${item.channelName} toolchain...`,
				cancellable: false
			}, async () => {
				const terminal = vscode.window.createTerminal(`Rustup ${action}`);
				terminal.show();
				if (action === 'install') {
					terminal.sendText(`rustup toolchain install ${item.channelName}`);
				} else {
					terminal.sendText(`rustup update ${item.channelName}`);
				}
				await new Promise<void>(resolve => setTimeout(resolve, 500));
				vscode.window.showInformationMessage(
					`Running rustup ${action} for ${item.channelName}. Check the terminal for progress.`
				);
			});
		});

		quickPick.onDidAccept(async () => {
			const selected = quickPick.selectedItems[0];
			if (!selected) {
				return;
			}

			const action = await vscode.window.showQuickPick([
				{
					label: '$(play) Set as Active Toolchain',
					description: `Switch to ${selected.channelName}`,
					action: 'activate'
				},
				{
					label: '$(check) Toggle Auto-Update Monitoring',
					description: config.get<boolean>(selected.channelKey, selected.channelName === 'stable')
						? 'Currently enabled - click to disable'
						: 'Currently disabled - click to enable',
					action: 'toggle'
				}
			], {
				title: `${selected.channelName} Toolchain Actions`,
				placeHolder: 'Choose an action'
			});

			if (!action) {
				return;
			}

			if (action.action === 'activate') {
				const terminal = vscode.window.createTerminal('Rustup Default');
				terminal.show();
				terminal.sendText(`rustup default ${selected.channelName}`);
				quickPick.hide();
				setTimeout(() => {
					updateToolchainStatusBar();
				}, 1000);
				vscode.window.showInformationMessage(`Setting ${selected.channelName} as active toolchain...`);
			} else {
				const currentValue = config.get<boolean>(selected.channelKey, selected.channelName === 'stable');
				await config.update(selected.channelKey, !currentValue, vscode.ConfigurationTarget.Global);
				vscode.window.showInformationMessage(
					`Auto-update monitoring for ${selected.channelName} ${!currentValue ? 'enabled' : 'disabled'}`
				);
				quickPick.hide();
				vscode.commands.executeCommand('cargui.showRustupInfo');
			}
		});

		quickPick.onDidHide(() => quickPick.dispose());
		quickPick.show();
	});

	register('cargui.updateRustup', async () => {
		const config = vscode.workspace.getConfiguration('cargui');
		const enabledChannels = {
			stable: config.get('rustup.checkStable', true),
			beta: config.get('rustup.checkBeta', false),
			nightly: config.get('rustup.checkNightly', false)
		};

		const channelsToUpdate = Object.keys(enabledChannels).filter(
			key => enabledChannels[key as keyof typeof enabledChannels]
		);

		if (channelsToUpdate.length === 0) {
			vscode.window.showWarningMessage(
				'No Rust toolchain channels are enabled. Enable at least one channel in RUSTUP settings.'
			);
			return;
		}

		const terminal = vscode.window.createTerminal('Rustup Update');
		terminal.show();
		for (const channel of channelsToUpdate) {
			terminal.sendText(`rustup update ${channel}`);
		}
		vscode.window.showInformationMessage(`Updating ${channelsToUpdate.join(', ')} toolchain(s)...`);
	});

	register('cargui.toggleRelease', () => {
		state.isReleaseMode = !state.isReleaseMode;
		const mode = state.isReleaseMode ? 'Release' : 'Debug';
		vscode.window.showInformationMessage(`Cargo build mode: ${mode}`);
		cargoTreeProvider.refresh();
	});

	register('cargui.runTarget', (target: CargoTreeItem) => {
		if (target && target.target) {
			runCargoTarget(target.target.name, target.target.type, state.isReleaseMode, cargoTreeProvider, target.target.requiredFeatures);
		}
	});

	register('cargui.toggleTargetCheck', (targetName: string) => {
		cargoTreeProvider.toggleCheck(targetName);
	});

	register('cargui.toggleFeatureCheck', (featureName: string) => {
		cargoTreeProvider.toggleFeature(featureName);
	});

	register('cargui.toggleAllFeatures', () => {
		const workspaceFolder = deps.getWorkspaceFolder();
		if (!workspaceFolder) {
			return;
		}
		const members = discoverWorkspaceMembers(workspaceFolder.uri.fsPath);
		const memberPath = state.selectedWorkspaceMember && state.selectedWorkspaceMember !== 'all'
			? members.find(m => m.name === state.selectedWorkspaceMember)?.path
			: undefined;
		const features = discoverCargoFeatures(workspaceFolder.uri.fsPath, memberPath);
		const checkedFeatures = cargoTreeProvider.getCheckedFeatures();
		const shouldCheckAll = checkedFeatures.length < features.length;
		features.forEach(feature => cargoTreeProvider.setFeatureChecked(feature, shouldCheckAll));
	});

	register('cargui.toggleAllTargets', () => {
		const workspaceFolder = deps.getWorkspaceFolder();
		if (!workspaceFolder) {
			return;
		}
		const members = discoverWorkspaceMembers(workspaceFolder.uri.fsPath);
		const memberPath = state.selectedWorkspaceMember && state.selectedWorkspaceMember !== 'all'
			? members.find(m => m.name === state.selectedWorkspaceMember)?.path
			: undefined;
		const targets = state.selectedWorkspaceMember === 'all'
			? []
			: discoverCargoTargets(workspaceFolder.uri.fsPath, memberPath);
		const checkedTargets = cargoTreeProvider.getCheckedTargets();
		const shouldCheckAll = checkedTargets.length < targets.length;
		targets.forEach(target => cargoTreeProvider.setChecked(target.name, shouldCheckAll));
	});

	register('cargui.toggleAllWorkspaceMembers', () => {
		const workspaceFolder = deps.getWorkspaceFolder();
		if (!workspaceFolder) {
			return;
		}
		const members = discoverWorkspaceMembers(workspaceFolder.uri.fsPath);
		const checkedMembers = cargoTreeProvider.getCheckedWorkspaceMembers();
		const shouldCheckAll = checkedMembers.length < members.length;
		members.forEach(member => cargoTreeProvider.setWorkspaceMemberChecked(member.name, shouldCheckAll));
	});

	register('cargui.toggleAllDependencies', () => {
		const workspaceFolder = deps.getWorkspaceFolder();
		if (!workspaceFolder) {
			return;
		}
		const members = discoverWorkspaceMembers(workspaceFolder.uri.fsPath);
		const dependencyMemberPath = state.selectedWorkspaceMember && state.selectedWorkspaceMember !== 'all'
			? members.find(m => m.name === state.selectedWorkspaceMember)?.path
			: undefined;
		const dependencies = discoverCargoDependencies(workspaceFolder.uri.fsPath, dependencyMemberPath);
		const allDeps = [
			...dependencies.workspace,
			...dependencies.production,
			...dependencies.dev,
			...dependencies.build
		];
		const checkedDeps = cargoTreeProvider.getCheckedDependencies();
		const shouldCheckAll = checkedDeps.size < allDeps.length;
		allDeps.forEach(dep => cargoTreeProvider.setDependencyChecked(dep.name, shouldCheckAll, dep));
	});

	register('cargui.toggleDependencyType', (item: CargoTreeItem) => {
		const workspaceFolder = deps.getWorkspaceFolder();
		if (!workspaceFolder || !item.categoryName) {
			return;
		}
		const members = discoverWorkspaceMembers(workspaceFolder.uri.fsPath);
		const dependencyMemberPath = state.selectedWorkspaceMember && state.selectedWorkspaceMember !== 'all'
			? members.find(m => m.name === state.selectedWorkspaceMember)?.path
			: undefined;
		const dependencies = discoverCargoDependencies(workspaceFolder.uri.fsPath, dependencyMemberPath);

		let categoryDeps: Dependency[] = [];
		switch (item.categoryName) {
			case 'production':
				categoryDeps = dependencies.production;
				break;
			case 'dev':
				categoryDeps = dependencies.dev;
				break;
			case 'build':
				categoryDeps = dependencies.build;
				break;
			case 'workspace':
				categoryDeps = dependencies.workspace;
				break;
		}

		const checkedDeps = cargoTreeProvider.getCheckedDependencies();
		const checkedInCategory = categoryDeps.filter(dep => checkedDeps.has(dep.name)).length;
		const shouldCheckAll = checkedInCategory < categoryDeps.length;
		categoryDeps.forEach(dep => cargoTreeProvider.setDependencyChecked(dep.name, shouldCheckAll, dep));
	});

	register('cargui.selectWorkspaceMember', (memberName: string) => {
		const workspaceFolder = deps.getWorkspaceFolder();
		if (!workspaceFolder) {
			return;
		}

		// Toggle: if already selected, deselect (go to 'all')
		if (state.selectedWorkspaceMember === memberName) {
			state.selectedWorkspaceMember = 'all';
			vscode.window.showInformationMessage('Deselected workspace member - showing all members');
		} else if (memberName === 'all') {
			state.selectedWorkspaceMember = 'all';
			vscode.window.showInformationMessage('Selected: All workspace members (--workspace)');
		} else {
			const members = discoverWorkspaceMembers(workspaceFolder.uri.fsPath);
			const member = members.find(m => m.name === memberName);
			if (member) {
				state.selectedWorkspaceMember = memberName;
				vscode.window.showInformationMessage(`Selected workspace member: ${memberName}`);
			}
		}

		cargoTreeProvider.refresh();
	});

	register('cargui.selectWorkspaceFolder', async () => {
		if (!vscode.workspace.workspaceFolders || vscode.workspace.workspaceFolders.length <= 1) {
			return;
		}

		// Get access history
		const accessHistory = context.workspaceState.get<number[]>('cargui.workspaceFolderAccessHistory', []);
		const currentIndex = context.workspaceState.get<number>('cargui.selectedWorkspaceFolder', 0);

		// Sort folders by access history
		const sortedFolders = vscode.workspace.workspaceFolders
			.map((folder, index) => ({ folder, index }))
			.sort((a, b) => {
				// Current folder always last
				if (a.index === currentIndex) return 1;
				if (b.index === currentIndex) return -1;
				
				// Otherwise sort by access history
				const aHistory = accessHistory.indexOf(a.index);
				const bHistory = accessHistory.indexOf(b.index);
				if (aHistory === -1 && bHistory === -1) return 0;
				if (aHistory === -1) return 1;
				if (bHistory === -1) return -1;
				return aHistory - bHistory;
			});

		const items = sortedFolders.map(({ folder, index }) => ({
			label: folder.name,
			description: index === currentIndex ? '$(check) current' : '',
			index: index
		}));

		const selected = await vscode.window.showQuickPick(items, {
			placeHolder: 'Select package folder to view'
		});

		if (selected) {
			await deps.selectWorkspaceFolder(selected.index);
		}
	});

	register('cargui.toggleWorkspaceMember', (memberName: string) => {
		const workspaceFolder = deps.getWorkspaceFolder();
		if (!workspaceFolder) {
			return;
		}

		// If clicking the same member that's already selected, deselect it
		if (state.selectedWorkspaceMember === memberName) {
			state.selectedWorkspaceMember = undefined;
			vscode.window.showInformationMessage(`Deselected workspace member: ${memberName}`);
		} else {
			// Otherwise select the new member
			const members = discoverWorkspaceMembers(workspaceFolder.uri.fsPath);
			const member = members.find(m => m.name === memberName);
			if (member) {
				state.selectedWorkspaceMember = memberName;
				vscode.window.showInformationMessage(`Selected workspace member: ${memberName}`);
			}
		}
	});

	register('cargui.buildTarget', (target: CargoTreeItem) => {
		if (target && target.target) {
			buildSingleTarget(target.target.name, target.target.type, state.isReleaseMode, state.selectedWorkspaceMember, cargoTreeProvider, target.target.requiredFeatures);
		}
	});

	register('cargui.buildWithFeature', (item: CargoTreeItem) => {
		if (item && item.feature) {
			buildWithFeature(item.feature, state.isReleaseMode, cargoTreeProvider, state.selectedWorkspaceMember);
		}
	});

	register('cargui.viewInCargoToml', async (target: CargoTreeItem) => {
		const workspaceFolder = deps.getWorkspaceFolder();
		if (!target || !target.target || !workspaceFolder) {
			return;
		}

		let cargoTomlUri: vscode.Uri;
		if (target.workspaceMember) {
			const members = discoverWorkspaceMembers(workspaceFolder.uri.fsPath);
			const member = members.find(m => m.name === target.workspaceMember);
			if (member) {
				cargoTomlUri = vscode.Uri.file(path.join(workspaceFolder.uri.fsPath, member.path, 'Cargo.toml'));
			} else {
				cargoTomlUri = vscode.Uri.joinPath(workspaceFolder.uri, 'Cargo.toml');
			}
		} else {
			cargoTomlUri = vscode.Uri.joinPath(workspaceFolder.uri, 'Cargo.toml');
		}

		const doc = await vscode.workspace.openTextDocument(cargoTomlUri);
		const editor = await vscode.window.showTextDocument(doc);
		const text = doc.getText();
		const searchPattern = new RegExp(`\\[\\[${target.target.type}\\]\\][^\\[]*name\\s*=\\s*["']${target.target.name}["']`, 's');
		const match = searchPattern.exec(text);

		if (match) {
			const pos = doc.positionAt(match.index);
			editor.selection = new vscode.Selection(pos, pos);
			editor.revealRange(new vscode.Range(pos, pos), vscode.TextEditorRevealType.InCenter);
		}
	});

	register('cargui.viewBinaryTarget', async (target: CargoTreeItem) => {
		const workspaceFolder = deps.getWorkspaceFolder();
		if (!target || !target.target || !workspaceFolder) {
			return;
		}

		let basePath = workspaceFolder.uri.fsPath;
		if (target.workspaceMember) {
			const members = discoverWorkspaceMembers(workspaceFolder.uri.fsPath);
			const member = members.find(m => m.name === target.workspaceMember);
			if (member) {
				// Construct absolute path: workspace root + member relative path
				basePath = path.join(workspaceFolder.uri.fsPath, member.path);
			}
		}

		let filePath: string;
		if (target.target.path) {
			filePath = path.join(basePath, target.target.path);
		} else if (target.target.type === 'bin') {
			filePath = path.join(basePath, 'src/main.rs');
		} else if (target.target.type === 'example') {
			filePath = path.join(basePath, `examples/${target.target.name}.rs`);
		} else if (target.target.type === 'test') {
			filePath = path.join(basePath, `tests/${target.target.name}.rs`);
		} else if (target.target.type === 'bench') {
			filePath = path.join(basePath, `benches/${target.target.name}.rs`);
		} else {
			vscode.window.showErrorMessage('Unknown target type');
			return;
		}

		const fullPath = vscode.Uri.file(filePath);
		try {
			const doc = await vscode.workspace.openTextDocument(fullPath);
			await vscode.window.showTextDocument(doc);
		} catch (error) {
			vscode.window.showErrorMessage(`Failed to open ${filePath}: ${error}`);
		}
	});

	register('cargui.viewMemberCargoToml', async (item: CargoTreeItem) => {
		const workspaceFolder = deps.getWorkspaceFolder();
		if (!item || !item.workspaceMember || !workspaceFolder) {
			return;
		}

		const members = discoverWorkspaceMembers(workspaceFolder.uri.fsPath);
		const member = members.find(m => m.name === item.workspaceMember);
		
		if (!member) {
			vscode.window.showErrorMessage(`Workspace member "${item.workspaceMember}" not found`);
			return;
		}

		const cargoTomlPath = path.join(workspaceFolder.uri.fsPath, member.path, 'Cargo.toml');
		const cargoTomlUri = vscode.Uri.file(cargoTomlPath);

		try {
			const doc = await vscode.workspace.openTextDocument(cargoTomlUri);
			await vscode.window.showTextDocument(doc);
		} catch (error) {
			vscode.window.showErrorMessage(`Failed to open Cargo.toml: ${error}`);
		}
	});

	register('cargui.resolveTargetValidation', async (item: CargoTreeItem) => {
		const workspaceFolder = deps.getWorkspaceFolder();
		if (!workspaceFolder || !item?.target) {
			return;
		}

		const target = item.target;
		
		// Determine what validation issues exist
		if (!target.path) {
			vscode.window.showErrorMessage('Target has no path specified');
			return;
		}

		// Parse path to determine directory and filename
		const normalizedPath = target.path.replace(/\\/g, '/');
		const pathParts = normalizedPath.split('/');
		const filename = pathParts[pathParts.length - 1];
		const fileStem = filename.replace(/\.rs$/, '').replace(/-/g, '_');
		const pathDir = pathParts.slice(0, -1).join('/');
		const normalizedName = target.name.replace(/-/g, '_');
		const normalizedFileStem = fileStem.replace(/-/g, '_');
		
		const nameMatchesFile = normalizedName === normalizedFileStem || target.name === 'main' || target.name === 'lib';
		
		// Check what the issue is: wrong directory or name mismatch (or both)
		let isWrongDirectory = false;
		let hasNameMismatch = !nameMatchesFile && target.path !== 'src/main.rs' && target.path !== 'src/lib.rs';
		
		// Determine if directory is wrong
		if (target.type === 'bin' && target.path !== 'src/main.rs') {
			isWrongDirectory = pathDir !== 'src/bin';
		} else if (target.type === 'example') {
			isWrongDirectory = !pathDir.startsWith('examples');
		} else if (target.type === 'test') {
			isWrongDirectory = !pathDir.startsWith('tests');
		} else if (target.type === 'bench') {
			isWrongDirectory = !pathDir.startsWith('benches');
		}
		
		// Fix both issues if present
		let actions: string[] = [];
		
		if (isWrongDirectory) {
			// Move to standard location
			const success = await moveTargetToStandardLocation(target, item.workspaceMember, workspaceFolder);
			if (success) {
				actions.push('moved to standard location');
			}
		}
		
		if (hasNameMismatch) {
			// Fix name in Cargo.toml to match filename
			const members = discoverWorkspaceMembers(workspaceFolder.uri.fsPath);
			const member = item.workspaceMember 
				? members.find(m => m.name === item.workspaceMember)
				: undefined;
			
			const basePath = member 
				? path.join(workspaceFolder.uri.fsPath, member.path)
				: workspaceFolder.uri.fsPath;
			
			const cargoTomlPath = path.join(basePath, 'Cargo.toml');
			
			if (!fs.existsSync(cargoTomlPath)) {
				vscode.window.showErrorMessage('Cargo.toml not found');
				return;
			}
			
			try {
				const content = fs.readFileSync(cargoTomlPath, 'utf-8');
				const manifest = toml.parse(content) as CargoManifest;
				
				// Find and update the target name
				const sectionKey = target.type === 'lib' ? 'lib' : target.type as 'bin' | 'example' | 'test' | 'bench';
				
				if (target.type === 'lib' && manifest.lib) {
					manifest.lib.name = fileStem;
				} else {
					const section = manifest[sectionKey as keyof CargoManifest] as any[];
					if (Array.isArray(section)) {
						const targetEntry = section.find(t => t.name === target.name);
						if (targetEntry) {
							targetEntry.name = fileStem;
						}
					}
				}
				
				// Write back
				const newContent = toml.stringify(manifest as any);
				fs.writeFileSync(cargoTomlPath, newContent, 'utf-8');
				
				actions.push(`renamed to "${fileStem}"`);
			} catch (error) {
				vscode.window.showErrorMessage(`Failed to update Cargo.toml: ${error}`);
				return;
			}
		}
		
		if (actions.length > 0) {
			const message = actions.length === 1 
				? `Fixed: ${actions[0]}`
				: `Fixed: ${actions.join(' and ')}`;
			vscode.window.showInformationMessage(message);
			cargoTreeProvider.refresh();
		}
	});

	register('cargui.declareAutoDiscoveredTarget', async (item: CargoTreeItem) => {
		const workspaceFolder = deps.getWorkspaceFolder();
		if (!workspaceFolder || !item?.target) {
			return;
		}

		const target = item.target;
		
		if (!target.path) {
			vscode.window.showErrorMessage('Target has no path specified');
			return;
		}

		// Get workspace member if applicable
		const members = discoverWorkspaceMembers(workspaceFolder.uri.fsPath);
		const member = item.workspaceMember 
			? members.find(m => m.name === item.workspaceMember)
			: undefined;
		
		const basePath = member 
			? path.join(workspaceFolder.uri.fsPath, member.path)
			: workspaceFolder.uri.fsPath;
		
		const cargoTomlPath = path.join(basePath, 'Cargo.toml');
		
		if (!fs.existsSync(cargoTomlPath)) {
			vscode.window.showErrorMessage('Cargo.toml not found');
			return;
		}

		try {
			const content = fs.readFileSync(cargoTomlPath, 'utf-8');
			const manifest = toml.parse(content) as CargoManifest;
			
			// Prepare the target entry to add
			const targetEntry: any = {
				name: target.name,
				path: target.path
			};

			// Add to appropriate section
			if (target.type === 'example') {
				if (!manifest.example) {
					manifest.example = [];
				}
				if (!Array.isArray(manifest.example)) {
					manifest.example = [manifest.example];
				}
				manifest.example.push(targetEntry);
			} else if (target.type === 'test') {
				if (!manifest.test) {
					manifest.test = [];
				}
				if (!Array.isArray(manifest.test)) {
					manifest.test = [manifest.test];
				}
				manifest.test.push(targetEntry);
			} else if (target.type === 'bench') {
				if (!manifest.bench) {
					manifest.bench = [];
				}
				if (!Array.isArray(manifest.bench)) {
					manifest.bench = [manifest.bench];
				}
				manifest.bench.push(targetEntry);
			} else if (target.type === 'bin') {
				if (!manifest.bin) {
					manifest.bin = [];
				}
				if (!Array.isArray(manifest.bin)) {
					manifest.bin = [manifest.bin];
				}
				manifest.bin.push(targetEntry);
			}
			
			// Write back to Cargo.toml
			const newContent = toml.stringify(manifest as any);
			fs.writeFileSync(cargoTomlPath, newContent, 'utf-8');
			
			vscode.window.showInformationMessage(`Declared ${target.type} "${target.name}" in Cargo.toml`);
			cargoTreeProvider.refresh();
		} catch (error) {
			vscode.window.showErrorMessage(`Failed to update Cargo.toml: ${error}`);
		}
	});

	register('cargui.resolveMissingTargetFile', async (item: CargoTreeItem) => {
		const workspaceFolder = deps.getWorkspaceFolder();
		if (!workspaceFolder || !item?.target) {
			return;
		}

		const target = item.target;
		
		// Show quick pick menu with both options
		const choice = await vscode.window.showQuickPick(
			[
				{ label: '$(search) Locate & Move Existing File', value: 'locate' },
				{ label: '$(new-file) Create New File', value: 'create' }
			],
			{ placeHolder: `Resolve missing file for ${target.type} "${target.name}"` }
		);

		if (!choice) {
			return;
		}

		// Get workspace member path (used by both options)
		const members = discoverWorkspaceMembers(workspaceFolder.uri.fsPath);
		const member = item.workspaceMember 
			? members.find(m => m.name === item.workspaceMember)
			: undefined;
		
		const basePath = member 
			? path.join(workspaceFolder.uri.fsPath, member.path)
			: workspaceFolder.uri.fsPath;
		
		const targetPath = path.join(basePath, target.path || '');

		if (choice.value === 'locate') {
			// Locate and move existing file
			const expectedFileName = path.basename(targetPath);
			const fileUris = await vscode.window.showOpenDialog({
				canSelectMany: false,
				canSelectFiles: true,
				canSelectFolders: false,
				filters: { 'Rust files': ['rs'] },
				openLabel: 'Select target file',
				title: `Locate "${expectedFileName}" for ${target.type} "${target.name}"`
			});

			if (!fileUris || fileUris.length === 0) {
				return;
			}

			const sourceFile = fileUris[0].fsPath;
			const selectedFileName = path.basename(sourceFile);
			
			// Verify the selected file has the expected name
			if (selectedFileName !== expectedFileName) {
				vscode.window.showErrorMessage(
					`Selected file "${selectedFileName}" does not match expected filename "${expectedFileName}"`
				);
				return;
			}
			
			// Move the file to the target location
			try {
				// Ensure target directory exists
				const targetDir = path.dirname(targetPath);
				if (!fs.existsSync(targetDir)) {
					fs.mkdirSync(targetDir, { recursive: true });
				}
				
				// Move file
				fs.renameSync(sourceFile, targetPath);
				
				vscode.window.showInformationMessage(`Moved ${expectedFileName} to ${target.path}`);
				cargoTreeProvider.refresh();
			} catch (error) {
				vscode.window.showErrorMessage(`Failed to move file: ${error}`);
			}
		} else {
			// Create new file
			try {
				// Ensure directory exists
				const targetDir = path.dirname(targetPath);
				if (!fs.existsSync(targetDir)) {
					fs.mkdirSync(targetDir, { recursive: true });
				}
				
				// Create file with basic template based on target type
				let template = '';
				if (target.type === 'bin') {
					template = `//! ${target.name} - Binary target\n\nfn main() {\n    println!(\"Hello from ${target.name}!\");\n}\n`;
				} else if (target.type === 'lib') {
					template = `//! ${target.name} - Library crate\n\n`;
				} else if (target.type === 'example') {
					template = `//! ${target.name} - Example\n\nfn main() {\n    println!(\"Example: ${target.name}\");\n}\n`;
				} else if (target.type === 'test') {
					template = `//! ${target.name} - Integration test\n\n#[test]\nfn test_${target.name.replace(/-/g, '_')}() {\n    // Add test here\n}\n`;
				} else if (target.type === 'bench') {
					template = `//! ${target.name} - Benchmark\n\nuse criterion::{black_box, criterion_group, criterion_main, Criterion};\n\nfn benchmark(c: &mut Criterion) {\n    c.bench_function(\"${target.name}\", |b| b.iter(|| {\n        // Add benchmark here\n    }));\n}\n\ncriterion_group!(benches, benchmark);\ncriterion_main!(benches);\n`;
				}
				
				fs.writeFileSync(targetPath, template, 'utf-8');
				
				// Open the newly created file
				const doc = await vscode.workspace.openTextDocument(targetPath);
				await vscode.window.showTextDocument(doc);
				
				vscode.window.showInformationMessage(`Created ${target.type} file at ${target.path}`);
				cargoTreeProvider.refresh();
			} catch (error) {
				vscode.window.showErrorMessage(`Failed to create file: ${error}`);
			}
		}
	});

	register('cargui.moveTargetToStandardLocation', async (clickedTarget: CargoTreeItem, selectedTargets?: CargoTreeItem[]) => {
		const workspaceFolder = deps.getWorkspaceFolder();
		if (!workspaceFolder) {
			return;
		}

		const targets = selectedTargets && selectedTargets.length > 0 ? selectedTargets : [clickedTarget];
		let movedCount = 0;
		for (const target of targets) {
			if (!target?.target) {
				continue;
			}

			const success = await moveTargetToStandardLocation(target.target, target.workspaceMember, workspaceFolder);
			if (success) {
				movedCount++;
			}
		}

		if (movedCount > 0) {
			vscode.window.showInformationMessage(`Moved ${movedCount} target(s) to standard location`);
			cargoTreeProvider.refresh();
		}
	});

	register('cargui.addArgument', async (item?: CargoTreeItem) => {
		const config = vscode.workspace.getConfiguration('cargui');
		const argCategories = config.get<ArgumentCategory[]>('argumentCategories') || [];

		// If item is provided (clicked from subcategory), use that category
		let targetCategoryName: string | undefined;
		if (item?.categoryName) {
			targetCategoryName = item.categoryName;
		} else {
			// Otherwise, show picker including "Uncategorized" option
			const categoryNames = argCategories.map(cat => cat.name);
			const selectedCategory = await vscode.window.showQuickPick(
				['Uncategorized (top level)', ...categoryNames, '+ New Category'],
				{ placeHolder: 'Select category for the argument' }
			);

			if (!selectedCategory) {
				return;
			}

			if (selectedCategory === 'Uncategorized (top level)') {
				targetCategoryName = undefined; // Signal for top-level
			} else {
				targetCategoryName = selectedCategory;
				if (selectedCategory === '+ New Category') {
					const newCategoryName = await vscode.window.showInputBox({
						prompt: 'Enter new category name',
						placeHolder: 'e.g., Custom, Advanced, etc.'
					});

					if (!newCategoryName || !newCategoryName.trim()) {
						return;
					}

					targetCategoryName = newCategoryName.trim();
					argCategories.push({ name: targetCategoryName, arguments: [] });
				}
			}
		}

		const input = await vscode.window.showInputBox({
			prompt: 'Enter argument (without -- prefix)',
			placeHolder: 'verbose, target x86_64-unknown-linux-gnu, etc.'
		});

		if (input && input.trim()) {
			// Normalize: remove leading -- and any spaces
			const normalized = input.trim().replace(/^--\s*/, '');
			
			if (targetCategoryName === undefined) {
				// Add to top-level uncategorized arguments
				const strays = config.get<string[]>('arguments') || [];
				if (strays.includes(normalized)) {
					vscode.window.showWarningMessage(`Argument '${normalized}' already exists`);
					return;
				}
				strays.push(normalized);
				await config.update('arguments', strays, vscode.ConfigurationTarget.Workspace);
				cargoTreeProvider.refresh();
				vscode.window.showInformationMessage(`Added uncategorized argument: ${normalized}`);
			} else {
				const category = argCategories.find(cat => cat.name === targetCategoryName);
				if (!category) {
					vscode.window.showErrorMessage(`Category '${targetCategoryName}' not found`);
					return;
				}

				if (category.arguments.includes(normalized)) {
					vscode.window.showWarningMessage(`Argument '${normalized}' already exists in ${targetCategoryName}`);
					return;
				}

				category.arguments.push(normalized);
				await config.update('argumentCategories', argCategories, vscode.ConfigurationTarget.Workspace);
				cargoTreeProvider.refresh();
				vscode.window.showInformationMessage(`Added argument '${normalized}' to ${targetCategoryName}`);
			}
		}
	});

	register('cargui.editArgument', async (item: CargoTreeItem) => {
		if (!item?.argument) {
			return;
		}

		const input = await vscode.window.showInputBox({
			prompt: 'Edit argument (without -- prefix)',
			placeHolder: 'verbose, debug, port 8080, etc.',
			value: item.argument
		});

		if (input && input.trim()) {
			// Normalize: remove leading -- and any spaces
			const normalized = input.trim().replace(/^--\s*/, '');
			
			const config = vscode.workspace.getConfiguration('cargui');
			let found = false;

			// Check for duplicates in both storages
			const strays = config.get<string[]>('arguments') || [];
			const argCategories = config.get<ArgumentCategory[]>('argumentCategories') || [];
			
			if (normalized !== item.argument) {
				// Check duplicates in uncategorized
				if (strays.includes(normalized)) {
					vscode.window.showWarningMessage(`Argument '${normalized}' already exists at top level`);
					return;
				}
				// Check duplicates in categories
				for (const category of argCategories) {
					if (category.arguments.includes(normalized)) {
						vscode.window.showWarningMessage(`Argument '${normalized}' already exists in ${category.name}`);
						return;
					}
				}
			}

			// Try to update in uncategorized first
			const strayIndex = strays.indexOf(item.argument);
			if (strayIndex !== -1) {
				strays[strayIndex] = normalized;
				await config.update('arguments', strays, vscode.ConfigurationTarget.Workspace);
				found = true;
			} else {
				// Try to update in categories
				for (const category of argCategories) {
					const index = category.arguments.indexOf(item.argument);
					if (index !== -1) {
						category.arguments[index] = normalized;
						await config.update('argumentCategories', argCategories, vscode.ConfigurationTarget.Workspace);
						found = true;
						break;
					}
				}
			}

			if (found) {
				cargoTreeProvider.renameCheckedArgument(item.argument, normalized);
				cargoTreeProvider.refresh();
				vscode.window.showInformationMessage(`Updated argument: ${item.argument} → ${normalized}`);
			} else {
				vscode.window.showWarningMessage(`Argument "${item.argument}" not found`);
			}
		}
	});

	register('cargui.removeArgument', async (item: CargoTreeItem) => {
		if (!item?.argument) {
			return;
		}

		const confirm = await vscode.window.showWarningMessage(
			`Remove argument "${item.argument}"?`,
			{ modal: true },
			'Remove'
		);

		if (confirm !== 'Remove') {
			return;
		}

		const config = vscode.workspace.getConfiguration('cargui');
		let removed = false;

		// First try to remove from uncategorized (flat array)
		const strays = config.get<string[]>('arguments') || [];
		const strayIndex = strays.indexOf(item.argument);
		if (strayIndex !== -1) {
			strays.splice(strayIndex, 1);
			await config.update('arguments', strays, vscode.ConfigurationTarget.Workspace);
			removed = true;
		} else {
			// Try to remove from categories
			const argCategories = config.get<ArgumentCategory[]>('argumentCategories') || [];
			for (const category of argCategories) {
				const index = category.arguments.indexOf(item.argument);
				if (index !== -1) {
					category.arguments.splice(index, 1);
					await config.update('argumentCategories', argCategories, vscode.ConfigurationTarget.Workspace);
					removed = true;
					break;
				}
			}
		}

		if (!removed) {
			vscode.window.showWarningMessage(`Argument "${item.argument}" not found`);
			return;
		}

		try {
			cargoTreeProvider.removeCheckedArgument(item.argument);
			cargoTreeProvider.refresh();
			vscode.window.showInformationMessage(`Removed argument: ${item.argument}`);
		} catch (error) {
			vscode.window.showErrorMessage(`Failed to remove argument: ${error}`);
		}
	});

	register('cargui.addArgumentSubcategory', async () => {
		const config = vscode.workspace.getConfiguration('cargui');
		const argCategories = config.get<ArgumentCategory[]>('argumentCategories') || [];

		const categoryName = await vscode.window.showInputBox({
			prompt: 'Enter new argument category name',
			placeHolder: 'e.g., Network, Performance, Custom, etc.'
		});

		if (!categoryName || !categoryName.trim()) {
			return;
		}

		const trimmedName = categoryName.trim();

		// Check if category already exists
		if (argCategories.find(cat => cat.name === trimmedName)) {
			vscode.window.showWarningMessage(`Category "${trimmedName}" already exists`);
			return;
		}

		try {
			argCategories.push({ name: trimmedName, arguments: [] });
			await config.update('argumentCategories', argCategories, vscode.ConfigurationTarget.Workspace);
			cargoTreeProvider.refresh();
			vscode.window.showInformationMessage(`Added argument category: ${trimmedName}`);
		} catch (error) {
			vscode.window.showErrorMessage(`Failed to add argument category: ${error}`);
		}
	});

	register('cargui.removeArgumentSubcategory', async (item: CargoTreeItem) => {
		if (!item?.categoryName) {
			return;
		}

		const categoryName = item.categoryName;
		const config = vscode.workspace.getConfiguration('cargui');
		const argCategories = config.get<ArgumentCategory[]>('argumentCategories') || [];

		const category = argCategories.find(cat => cat.name === categoryName);
		if (!category) {
			vscode.window.showWarningMessage(`Category "${categoryName}" not found`);
			return;
		}

		const argCount = category.arguments.length;
		const confirm = await vscode.window.showWarningMessage(
			`Remove argument category "${categoryName}"?${argCount > 0 ? ` This will delete ${argCount} argument(s).` : ''}`,
			{ modal: true },
			'Remove'
		);

		if (confirm !== 'Remove') {
			return;
		}

		try {
			// Remove any checked arguments from this category
			for (const arg of category.arguments) {
				cargoTreeProvider.removeCheckedArgument(arg);
			}

			// Remove the category
			const newCategories = argCategories.filter(cat => cat.name !== categoryName);
			await config.update('argumentCategories', newCategories, vscode.ConfigurationTarget.Workspace);
			cargoTreeProvider.refresh();
			vscode.window.showInformationMessage(`Removed argument category: ${categoryName}`);
		} catch (error) {
			vscode.window.showErrorMessage(`Failed to remove argument category: ${error}`);
		}
	});

	register('cargui.deleteSelected', async () => {
		const treeView = cargoTreeProvider.treeView;
		if (!treeView?.selection?.length) {
			return;
		}

		const item = treeView.selection[0];
		if (item.argument) {
			await vscode.commands.executeCommand('cargui.removeArgument', item);
		} else if (item.envVar) {
			await vscode.commands.executeCommand('cargui.removeEnvVar', item);
		} else if (item.snapshot) {
			await vscode.commands.executeCommand('cargui.deleteSnapshot', item);
		}
	});

	register('cargui.toggleArgumentCheck', (argument: string) => {
		cargoTreeProvider.toggleArgument(argument);
	});

	register('cargui.resetArguments', async () => {
		const confirm = await vscode.window.showWarningMessage(
			'Reset arguments to default library? This will merge defaults into your categories or create new ones.',
			{ modal: true },
			'Reset'
		);

		if (confirm === 'Reset') {
			const config = vscode.workspace.getConfiguration('cargui');
			const existingCategories = config.get<ArgumentCategory[]>('argumentCategories') || [];
			const strays = config.get<string[]>('arguments') || [];
			
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

			// Merge defaults into existing categories or create new ones
			for (const defaultCat of defaultArgCategories) {
				const existingCat = existingCategories.find(c => c.name === defaultCat.name);
				if (existingCat) {
					// Replace arguments in existing category
					for (const arg of defaultCat.arguments) {
						if (!existingCat.arguments.includes(arg)) {
							existingCat.arguments.push(arg);
						}
					}
					// Remove from strays if present
					for (let i = strays.length - 1; i >= 0; i--) {
						if (defaultCat.arguments.includes(strays[i])) {
							strays.splice(i, 1);
						}
					}
				} else {
					// Create new category
					existingCategories.push(defaultCat);
					// Remove from strays if present
					for (let i = strays.length - 1; i >= 0; i--) {
						if (defaultCat.arguments.includes(strays[i])) {
							strays.splice(i, 1);
						}
					}
				}
			}

			await config.update('argumentCategories', existingCategories, vscode.ConfigurationTarget.Workspace);
			await config.update('arguments', strays, vscode.ConfigurationTarget.Workspace);
			cargoTreeProvider.refresh();
			vscode.window.showInformationMessage('Cargo arguments reset to default library');
		}
	});

	register('cargui.addEnvVar', async () => {
		const input = await vscode.window.showInputBox({
			prompt: 'Enter environment variable (KEY=VALUE format)',
			placeHolder: 'RUST_BACKTRACE=1, RUST_LOG=debug, MY_VAR=value, etc.'
		});

		if (input && input.trim()) {
			if (!input.includes('=')) {
				vscode.window.showErrorMessage('Environment variable must be in KEY=VALUE format');
				return;
			}

			const config = vscode.workspace.getConfiguration('cargui');
			const currentEnvVars = config.get<string[]>('environmentVariables') || [];

			if (currentEnvVars.includes(input.trim())) {
				vscode.window.showWarningMessage(`Environment variable '${input.trim()}' already exists`);
				return;
			}

			const updatedEnvVars = [...currentEnvVars, input.trim()];
			await config.update('environmentVariables', updatedEnvVars, vscode.ConfigurationTarget.Workspace);
			cargoTreeProvider.refresh();
			vscode.window.showInformationMessage(`Added environment variable: ${input.trim()}`);
		}
	});

	register('cargui.editEnvVar', async (item: CargoTreeItem) => {
		if (!item?.envVar) {
			return;
		}

		const input = await vscode.window.showInputBox({
			prompt: 'Edit environment variable (KEY=VALUE format)',
			placeHolder: 'RUST_BACKTRACE=1, RUST_LOG=debug, MY_VAR=value, etc.',
			value: item.envVar
		});

		if (input && input.trim()) {
			if (!input.includes('=')) {
				vscode.window.showErrorMessage('Environment variable must be in KEY=VALUE format');
				return;
			}

			const config = vscode.workspace.getConfiguration('cargui');
			const currentEnvVars = config.get<string[]>('environmentVariables') || [];

			if (input.trim() !== item.envVar && currentEnvVars.includes(input.trim())) {
				vscode.window.showWarningMessage(`Environment variable '${input.trim()}' already exists`);
				return;
			}

			const updatedEnvVars = currentEnvVars.map(envVar => (envVar === item.envVar ? input.trim() : envVar));
			await config.update('environmentVariables', updatedEnvVars, vscode.ConfigurationTarget.Workspace);
			cargoTreeProvider.renameCheckedEnvVar(item.envVar, input.trim());
			cargoTreeProvider.refresh();
			vscode.window.showInformationMessage(`Updated environment variable: ${item.envVar} → ${input.trim()}`);
		}
	});

	register('cargui.removeEnvVar', async (item: CargoTreeItem) => {
		let targetItem = item;
		if (!targetItem) {
			const treeView = cargoTreeProvider.treeView;
			if (treeView?.selection?.length) {
				targetItem = treeView.selection[0];
			}
		}

		if (!targetItem?.envVar) {
			return;
		}

		const confirm = await vscode.window.showWarningMessage(
			`Remove environment variable '${targetItem.envVar}'?`,
			{ modal: true },
			'Remove'
		);

		if (confirm === 'Remove') {
			const config = vscode.workspace.getConfiguration('cargui');
			const currentEnvVars = config.get<string[]>('environmentVariables') || [];
			const updatedEnvVars = currentEnvVars.filter(envVar => envVar !== targetItem.envVar);
			await config.update('environmentVariables', updatedEnvVars, vscode.ConfigurationTarget.Workspace);
			cargoTreeProvider.removeCheckedEnvVar(targetItem.envVar);
			cargoTreeProvider.refresh();
			vscode.window.showInformationMessage(`Removed environment variable: ${targetItem.envVar}`);
		}
	});

	register('cargui.toggleEnvVarCheck', (envVar: string) => {
		cargoTreeProvider.toggleEnvVar(envVar);
	});

	register('cargui.resetEnvVars', async () => {
		const confirm = await vscode.window.showWarningMessage(
			'Reset environment variables to default presets? This will replace your current environment variables list.',
			{ modal: true },
			'Reset'
		);

		if (confirm === 'Reset') {
			const config = vscode.workspace.getConfiguration('cargui');
			const defaultEnvVars = ['RUST_BACKTRACE=1', 'RUST_LOG=info', 'CARGO_INCREMENTAL=1'];
			await config.update('environmentVariables', defaultEnvVars, vscode.ConfigurationTarget.Workspace);
			cargoTreeProvider.refresh();
			vscode.window.showInformationMessage('Environment variables reset to defaults');
		}
	});

	register('cargui.addCustomCommand', async (item?: CargoTreeItem) => {
		const config = vscode.workspace.getConfiguration('cargui');
		const cmdCategories = config.get<CustomCommandCategory[]>('customCommandCategories') || [];

		// If item is provided (clicked from subcategory), use that category
		let targetCategoryName: string | undefined;
		if (item?.categoryName) {
			targetCategoryName = item.categoryName;
		} else {
			// Otherwise, show picker with uncategorized option
			const categoryNames = cmdCategories.map(cat => cat.name);
			const selectedCategory = await vscode.window.showQuickPick(
				['Uncategorized (top level)', ...categoryNames, '+ New Category'],
				{ placeHolder: 'Select category for the command (or leave uncategorized)' }
			);

			if (!selectedCategory) {
				return;
			}

			if (selectedCategory === 'Uncategorized (top level)') {
				targetCategoryName = undefined; // Signal uncategorized
			} else if (selectedCategory === '+ New Category') {
				const newCategoryName = await vscode.window.showInputBox({
					prompt: 'Enter new category name',
					placeHolder: 'e.g., Build, Test, Analysis, etc.'
				});

				if (!newCategoryName || !newCategoryName.trim()) {
					return;
				}

				targetCategoryName = newCategoryName.trim();
				cmdCategories.push({ name: targetCategoryName, commands: [] });
			} else {
				targetCategoryName = selectedCategory;
			}
		}

		const name = await vscode.window.showInputBox({
			prompt: 'Enter custom command name',
			placeHolder: 'e.g., Release Linux, Full Test Suite, etc.'
		});

		if (!name || !name.trim()) {
			return;
		}

		const command = await vscode.window.showInputBox({
			prompt: 'Enter cargo command (with "cargo" prefix)',
			placeHolder: 'e.g., cargo build --release --target x86_64-unknown-linux-gnu',
			value: 'cargo '
		});

		if (command && command.trim()) {
			if (targetCategoryName === undefined) {
				// Add to uncategorized (flat array)
				const strays = config.get<CustomCommand[]>('customCommands') || [];
				
				if (strays.some(cmd => cmd.name === name.trim())) {
					vscode.window.showWarningMessage(`Custom command '${name.trim()}' already exists at top level`);
					return;
				}
				
				strays.push({ name: name.trim(), command: command.trim() });
				await config.update('customCommands', strays, vscode.ConfigurationTarget.Workspace);
				cargoTreeProvider.refresh();
				vscode.window.showInformationMessage(`Added custom command '${name.trim()}' at top level`);
			} else {
				// Add to category
				const category = cmdCategories.find(cat => cat.name === targetCategoryName);
				if (!category) {
					vscode.window.showErrorMessage(`Category '${targetCategoryName}' not found`);
					return;
				}

				if (category.commands.some(cmd => cmd.name === name.trim())) {
					vscode.window.showWarningMessage(`Custom command '${name.trim()}' already exists in ${targetCategoryName}`);
					return;
				}

				category.commands.push({ name: name.trim(), command: command.trim() });
				await config.update('customCommandCategories', cmdCategories, vscode.ConfigurationTarget.Workspace);
				cargoTreeProvider.refresh();
				vscode.window.showInformationMessage(`Added custom command '${name.trim()}' to ${targetCategoryName}`);
			}
		}
	});

	register('cargui.editCustomCommand', async (item: CargoTreeItem) => {
		if (!item?.categoryName) {
			return;
		}

		const config = vscode.workspace.getConfiguration('cargui');
		let cmd: CustomCommand | undefined;
		let isStray = false;

		// First check uncategorized (flat array)
		const strays = config.get<CustomCommand[]>('customCommands') || [];
		cmd = strays.find(c => c.name === item.categoryName);
		
		if (cmd) {
			isStray = true;
		} else {
			// Check in categories
			const cmdCategories = config.get<CustomCommandCategory[]>('customCommandCategories') || [];
			for (const category of cmdCategories) {
				cmd = category.commands.find(c => c.name === item.categoryName);
				if (cmd) {
					break;
				}
			}
		}

		if (!cmd) {
			return;
		}

		const name = await vscode.window.showInputBox({
			prompt: 'Edit command name',
			placeHolder: 'e.g., Release Linux, Full Test Suite, etc.',
			value: cmd.name
		});

		if (!name || !name.trim()) {
			return;
		}

		const command = await vscode.window.showInputBox({
			prompt: 'Edit cargo command',
			placeHolder: 'e.g., cargo build --release --target x86_64-unknown-linux-gnu',
			value: cmd.command
		});

		if (command && command.trim()) {
			// Check for duplicates in both storages
			if (name.trim() !== cmd.name) {
				// Check in uncategorized
				if (strays.some(c => c.name === name.trim())) {
					vscode.window.showWarningMessage(`Custom command '${name.trim()}' already exists at top level`);
					return;
				}
				// Check in categories
				const cmdCategories = config.get<CustomCommandCategory[]>('customCommandCategories') || [];
				for (const category of cmdCategories) {
					if (category.commands.some(c => c.name === name.trim())) {
						vscode.window.showWarningMessage(`Custom command '${name.trim()}' already exists in ${category.name}`);
						return;
					}
				}
			}

			if (isStray) {
				// Update in uncategorized
				const updatedStrays = strays.map(c =>
					c.name === cmd!.name ? { name: name.trim(), command: command.trim() } : c
				);
				await config.update('customCommands', updatedStrays, vscode.ConfigurationTarget.Workspace);
			} else {
				// Update in categories
				const cmdCategories = config.get<CustomCommandCategory[]>('customCommandCategories') || [];
				for (const category of cmdCategories) {
					const index = category.commands.findIndex(c => c.name === cmd!.name);
					if (index !== -1) {
						category.commands[index] = { name: name.trim(), command: command.trim() };
						await config.update('customCommandCategories', cmdCategories, vscode.ConfigurationTarget.Workspace);
						break;
					}
				}
			}

			cargoTreeProvider.refresh();
			vscode.window.showInformationMessage(`Updated custom command: ${cmd.name} → ${name.trim()}`);
		}
	});

	register('cargui.removeCustomCommand', async (item: CargoTreeItem) => {
		if (!item?.categoryName) {
			return;
		}

		const config = vscode.workspace.getConfiguration('cargui');
		let removed = false;
		let commandName = item.categoryName;

		// First try to remove from uncategorized (flat array)
		const strays = config.get<CustomCommand[]>('customCommands') || [];
		const strayCmd = strays.find(c => c.name === commandName);
		
		if (strayCmd) {
			const confirm = await vscode.window.showWarningMessage(
				`Remove custom command '${strayCmd.name}'?`,
				{ modal: true },
				'Remove'
			);

			if (confirm === 'Remove') {
				const updatedStrays = strays.filter(c => c.name !== strayCmd.name);
				await config.update('customCommands', updatedStrays, vscode.ConfigurationTarget.Workspace);
				removed = true;
			}
		} else {
			// Try to remove from categories
			const cmdCategories = config.get<CustomCommandCategory[]>('customCommandCategories') || [];
			
			for (const category of cmdCategories) {
				const cmd = category.commands.find(c => c.name === commandName);
				if (cmd) {
					const confirm = await vscode.window.showWarningMessage(
						`Remove custom command '${cmd.name}'?`,
						{ modal: true },
						'Remove'
					);

					if (confirm === 'Remove') {
						category.commands = category.commands.filter(c => c.name !== cmd.name);
						await config.update('customCommandCategories', cmdCategories, vscode.ConfigurationTarget.Workspace);
						removed = true;
					}
					break;
				}
			}
		}

		if (removed) {
			cargoTreeProvider.refresh();
			vscode.window.showInformationMessage(`Removed custom command: ${commandName}`);
		}
	});

	register('cargui.resetCustomCommands', async () => {
		const confirm = await vscode.window.showWarningMessage(
			'Reset custom commands to default presets? This will merge defaults into your categories.',
			{ modal: true },
			'Reset'
		);

		if (confirm === 'Reset') {
			const config = vscode.workspace.getConfiguration('cargui');
			const existingCategories = config.get<CustomCommandCategory[]>('customCommandCategories') || [];
			const strays = config.get<CustomCommand[]>('customCommands') || [];
			
			const defaultCommands: CustomCommand[] = [
				{ name: 'Show Outdated Deps', command: 'cargo outdated' },
				{ name: 'Show Crate Metadata', command: 'cargo metadata --no-deps' },
				{ name: 'List Installed Tools', command: 'cargo install --list' },
				{ name: 'Show All Features', command: 'cargo tree --all-features' },
				{ name: 'Check Compile Times', command: 'cargo build --timings' },
				{ name: 'Show Feature Tree', command: 'cargo tree --format "{p} {f}"' },
				{ name: 'Analyze Binary Size', command: 'cargo bloat --release' },
				{ name: 'Generate Docs', command: 'cargo doc --no-deps --open' }
			];

			// Try to place defaults in existing categories
			for (const defaultCmd of defaultCommands) {
				let placed = false;
				
				// Check if it already exists in any category
				for (const cat of existingCategories) {
					const existing = cat.commands.find(c => c.name === defaultCmd.name);
					if (existing) {
						// Update command in category
						existing.command = defaultCmd.command;
						placed = true;
						break;
					}
				}

				// Remove from strays if it was there
				const strayIndex = strays.findIndex(c => c.name === defaultCmd.name);
				if (strayIndex !== -1) {
					if (!placed) {
						// Update in strays
						strays[strayIndex].command = defaultCmd.command;
					} else {
						// Remove from strays since it's now in a category
						strays.splice(strayIndex, 1);
					}
					placed = true;
				}

				// If not placed anywhere, add to strays
				if (!placed) {
					strays.push(defaultCmd);
				}
			}

			await config.update('customCommandCategories', existingCategories, vscode.ConfigurationTarget.Workspace);
			await config.update('customCommands', strays, vscode.ConfigurationTarget.Workspace);
			cargoTreeProvider.refresh();
			vscode.window.showInformationMessage('Custom commands reset to defaults');
		}
	});

	register('cargui.addCustomCommandSubcategory', async () => {
		const config = vscode.workspace.getConfiguration('cargui');
		const cmdCategories = config.get<CustomCommandCategory[]>('customCommandCategories') || [];

		const categoryName = await vscode.window.showInputBox({
			prompt: 'Enter new command category name',
			placeHolder: 'e.g., Build, Test, Deploy, Analysis, etc.'
		});

		if (!categoryName || !categoryName.trim()) {
			return;
		}

		const trimmedName = categoryName.trim();

		// Check if category already exists
		if (cmdCategories.find(cat => cat.name === trimmedName)) {
			vscode.window.showWarningMessage(`Category "${trimmedName}" already exists`);
			return;
		}

		try {
			cmdCategories.push({ name: trimmedName, commands: [] });
			await config.update('customCommandCategories', cmdCategories, vscode.ConfigurationTarget.Workspace);
			cargoTreeProvider.refresh();
			vscode.window.showInformationMessage(`Added command category: ${trimmedName}`);
		} catch (error) {
			vscode.window.showErrorMessage(`Failed to add command category: ${error}`);
		}
	});

	register('cargui.removeCustomCommandSubcategory', async (item: CargoTreeItem) => {
		if (!item?.categoryName) {
			return;
		}

		const categoryName = item.categoryName;
		const config = vscode.workspace.getConfiguration('cargui');
		const cmdCategories = config.get<CustomCommandCategory[]>('customCommandCategories') || [];

		const category = cmdCategories.find(cat => cat.name === categoryName);
		if (!category) {
			vscode.window.showWarningMessage(`Category "${categoryName}" not found`);
			return;
		}

		const cmdCount = category.commands.length;
		const confirm = await vscode.window.showWarningMessage(
			`Remove command category "${categoryName}"?${cmdCount > 0 ? ` This will delete ${cmdCount} command(s).` : ''}`,
			{ modal: true },
			'Remove'
		);

		if (confirm !== 'Remove') {
			return;
		}

		try {
			// Remove the category
			const newCategories = cmdCategories.filter(cat => cat.name !== categoryName);
			await config.update('customCommandCategories', newCategories, vscode.ConfigurationTarget.Workspace);
			cargoTreeProvider.refresh();
			vscode.window.showInformationMessage(`Removed command category: ${categoryName}`);
		} catch (error) {
			vscode.window.showErrorMessage(`Failed to remove command category: ${error}`);
		}
	});

	register('cargui.runCustomCommand', async (cmd: CustomCommand) => {
		if (!cmd?.command) {
			return;
		}

		const workspace = deps.getWorkspaceFolder();
		if (!workspace) {
			vscode.window.showErrorMessage('No workspace folder found');
			return;
		}

		const terminal = vscode.window.createTerminal({
			name: `Cargo: ${cmd.name}`,
			cwd: workspace.uri.fsPath
		});
		terminal.show();
		terminal.sendText(cmd.command);
	});

	register('cargui.createSnapshot', async () => {
		const input = await vscode.window.showInputBox({
			prompt: 'Enter snapshot name',
			placeHolder: 'e.g., Development, Production, Testing, etc.'
		});

		if (input && input.trim()) {
			const config = vscode.workspace.getConfiguration('cargui');
			const snapshots = config.get<Snapshot[]>('snapshots') || [];

			if (snapshots.some(p => p.name === input.trim())) {
				vscode.window.showWarningMessage(`Snapshot '${input.trim()}' already exists`);
				return;
			}

			const newSnapshot: Snapshot = {
				name: input.trim(),
				mode: state.isReleaseMode ? 'release' : 'debug',
				targets: cargoTreeProvider.getCheckedTargets(),
				features: cargoTreeProvider.getCheckedFeatures(),
				arguments: cargoTreeProvider.getCheckedArguments(),
				envVars: cargoTreeProvider.getCheckedEnvVars(),
				workspaceMember: state.selectedWorkspaceMember,
				checkedWorkspaceMembers: cargoTreeProvider.getCheckedWorkspaceMembers()
			};

			const updatedSnapshots = [...snapshots, newSnapshot];
			await config.update('snapshots', updatedSnapshots, vscode.ConfigurationTarget.Workspace);
			cargoTreeProvider.refresh();
			vscode.window.showInformationMessage(`Created snapshot: ${input.trim()}`);
		}
	});

	register('cargui.applySnapshot', async (item: CargoTreeItem) => {
		if (!item?.snapshot) {
			return;
		}

		const config = vscode.workspace.getConfiguration('cargui');
		const snapshots = config.get<Snapshot[]>('snapshots') || [];
		const snapshot = snapshots.find(p => p.name === item.snapshot);
		const activeSnapshot = config.get<string>('activeSnapshot') || '';

		if (!snapshot) {
			return;
		}

		if (activeSnapshot === snapshot.name) {
			await config.update('activeSnapshot', '', vscode.ConfigurationTarget.Workspace);
			cargoTreeProvider.refresh();
			vscode.window.showInformationMessage(`Deactivated snapshot: ${snapshot.name}`);
			return;
		}

		state.isReleaseMode = snapshot.mode === 'release';

		if (snapshot.workspaceMember) {
			const workspace = deps.getWorkspaceFolder();
			if (workspace) {
				const workspaceMembers = discoverWorkspaceMembers(workspace.uri.fsPath);
				if (
					snapshot.workspaceMember === 'all' ||
					workspaceMembers.some(m => m.name === snapshot.workspaceMember)
				) {
					state.selectedWorkspaceMember = snapshot.workspaceMember;
				} else {
					console.warn(`Snapshot workspace member '${snapshot.workspaceMember}' not found in current workspace`);
					state.selectedWorkspaceMember = undefined;
				}
			} else {
				state.selectedWorkspaceMember = snapshot.workspaceMember;
			}
		} else {
			state.selectedWorkspaceMember = snapshot.workspaceMember;
		}

		cargoTreeProvider.getCheckedTargets().forEach(t => cargoTreeProvider.setChecked(t, false));
		snapshot.targets.forEach(t => cargoTreeProvider.setChecked(t, true));

		cargoTreeProvider.getCheckedFeatures().forEach(f => cargoTreeProvider.setFeatureChecked(f, false));
		snapshot.features.forEach(f => cargoTreeProvider.setFeatureChecked(f, true));

		cargoTreeProvider.getCheckedArguments().forEach(a => cargoTreeProvider.setArgumentChecked(a, false));
		snapshot.arguments.forEach(a => cargoTreeProvider.setArgumentChecked(a, true));

		cargoTreeProvider.getCheckedEnvVars().forEach(e => cargoTreeProvider.setEnvVarChecked(e, false));
		snapshot.envVars.forEach(e => cargoTreeProvider.setEnvVarChecked(e, true));

		cargoTreeProvider.getCheckedWorkspaceMembers().forEach(m => cargoTreeProvider.setWorkspaceMemberChecked(m, false));
		if (snapshot.checkedWorkspaceMembers) {
			const workspace = deps.getWorkspaceFolder();
			if (workspace) {
				const workspaceMembers = discoverWorkspaceMembers(workspace.uri.fsPath);
				snapshot.checkedWorkspaceMembers.forEach(m => {
					if (workspaceMembers.some(wm => wm.name === m)) {
						cargoTreeProvider.setWorkspaceMemberChecked(m, true);
					} else {
						console.warn(`Snapshot workspace member '${m}' not found in current workspace`);
					}
				});
			}
		}

		await config.update('activeSnapshot', snapshot.name, vscode.ConfigurationTarget.Workspace);
		cargoTreeProvider.refresh();
		vscode.window.showInformationMessage(`Applied snapshot: ${snapshot.name}`);
	});

	register('cargui.editSnapshot', async (item: CargoTreeItem) => {
		if (!item?.snapshot) {
			return;
		}

		const config = vscode.workspace.getConfiguration('cargui');
		const snapshots = config.get<Snapshot[]>('snapshots') || [];
		const snapshot = snapshots.find(p => p.name === item.snapshot);

		if (!snapshot) {
			return;
		}

		const newName = await vscode.window.showInputBox({
			prompt: 'Enter new snapshot name (or press Enter to keep current)',
			value: snapshot.name
		});

		if (!newName) {
			return;
		}

		if (snapshots.some(p => p.name === newName.trim() && p.name !== snapshot.name)) {
			vscode.window.showWarningMessage(`Snapshot '${newName.trim()}' already exists`);
			return;
		}

		const updateChoice = await vscode.window.showQuickPick(
			[
				{ label: 'Rename and keep saved checks', value: 'keep' },
				{ label: 'Rename and update with current checks', value: 'current' }
			],
			{ placeHolder: 'How should this snapshot be updated?' }
		);

		if (!updateChoice) {
			return;
		}

		let updatedSnapshot: Snapshot;
		if (updateChoice.value === 'current') {
			updatedSnapshot = {
				name: newName.trim(),
				mode: state.isReleaseMode ? 'release' : 'debug',
				targets: cargoTreeProvider.getCheckedTargets(),
				features: cargoTreeProvider.getCheckedFeatures(),
				arguments: cargoTreeProvider.getCheckedArguments(),
				envVars: cargoTreeProvider.getCheckedEnvVars(),
				workspaceMember: state.selectedWorkspaceMember,
				checkedWorkspaceMembers: cargoTreeProvider.getCheckedWorkspaceMembers()
			};
		} else {
			updatedSnapshot = { ...snapshot, name: newName.trim() };
		}

	if (JSON.stringify(snapshot) === JSON.stringify(updatedSnapshot)) {
		vscode.window.showInformationMessage('No changes to snapshot');
		return;
	}

	// Remove old snapshot and add updated one to prevent duplicates
	const updatedSnapshots = snapshots.filter(p => p.name !== item.snapshot);
	updatedSnapshots.push(updatedSnapshot);
	await config.update('snapshots', updatedSnapshots, vscode.ConfigurationTarget.Workspace);		const activeSnapshot = config.get<string>('activeSnapshot');
		if (activeSnapshot === item.snapshot && newName.trim() !== item.snapshot) {
			await config.update('activeSnapshot', newName.trim(), vscode.ConfigurationTarget.Workspace);
		}

		cargoTreeProvider.refresh();
		vscode.window.showInformationMessage(
			updateChoice.value === 'current'
				? `Updated snapshot: ${item.snapshot} → ${newName.trim()} (with current settings)`
				: `Renamed snapshot: ${item.snapshot} → ${newName.trim()}`
		);
	});

	register('cargui.deleteSnapshot', async (item: CargoTreeItem) => {
		let targetItem = item;
		if (!targetItem) {
			const treeView = cargoTreeProvider.treeView;
			if (treeView?.selection?.length) {
				targetItem = treeView.selection[0];
			}
		}

		if (!targetItem?.snapshot) {
			return;
		}

		const confirm = await vscode.window.showWarningMessage(
			`Delete snapshot '${targetItem.snapshot}'?`,
			{ modal: true },
			'Delete'
		);

		if (confirm === 'Delete') {
			const config = vscode.workspace.getConfiguration('cargui');
			const snapshots = config.get<Snapshot[]>('snapshots') || [];
			const updatedSnapshots = snapshots.filter(p => p.name !== targetItem.snapshot);
			await config.update('snapshots', updatedSnapshots, vscode.ConfigurationTarget.Workspace);

			const activeSnapshot = config.get<string>('activeSnapshot');
			if (activeSnapshot === targetItem.snapshot) {
				await config.update('activeSnapshot', '', vscode.ConfigurationTarget.Workspace);
			}

			cargoTreeProvider.refresh();
			vscode.window.showInformationMessage(`Deleted snapshot: ${targetItem.snapshot}`);
		}
	});

	register('cargui.resetSmartDetectionNotifications', async () => {
		await context.workspaceState.update('cargui.ignoreUnknownTargets', undefined);
		await context.workspaceState.update('cargui.ignoreUndeclaredFeatures', undefined);
		await context.workspaceState.update('cargui.ignoreUndeclaredModules', undefined);
		vscode.window.showInformationMessage('Smart detection notifications reset - they will show again on next detection');
		cargoTreeProvider.refresh();
	});

	register('cargui.toggleWatch', async () => {
		const workspace = deps.getWorkspaceFolder();
		if (!workspace) {
			vscode.window.showErrorMessage('No workspace folder found');
			return;
		}

		if (state.isWatchMode && state.watchTerminal) {
			state.watchTerminal.dispose();
			state.watchTerminal = undefined;
			state.isWatchMode = false;
			cargoTreeProvider.refresh();
			vscode.window.showInformationMessage('Watch mode stopped');
			return;
		}

		const { execSync } = require('child_process');
		try {
			execSync('cargo watch --version', { stdio: 'ignore' });
		} catch (error) {
			const choice = await vscode.window.showWarningMessage(
				'Watch Mode requires cargo-watch to automatically recompile your code when files change. Would you like to install it now?',
				{ modal: true },
				'Install'
			);

			if (choice === 'Install') {
				const installTerminal = vscode.window.createTerminal({
					name: 'Install cargo-watch',
					cwd: workspace.uri.fsPath
				});
				installTerminal.show();
				installTerminal.sendText('cargo install cargo-watch');
				vscode.window.showInformationMessage(
					'Installing cargo-watch... This may take a few minutes. Try again when installation completes.'
				);
			}
			return;
		}

		const actions = [
			{ label: 'check', description: 'Fast compilation check (default)', value: 'check' },
			{ label: 'test', description: 'Run tests on change', value: 'test' },
			{ label: 'run', description: 'Run binary on change', value: 'run' },
			{ label: 'build', description: 'Full build on change', value: 'build' },
			{ label: 'clippy', description: 'Run clippy lints on change', value: 'clippy' }
		];

		const selected = await vscode.window.showQuickPick(actions, {
			placeHolder: 'Select watch action'
		});

		if (!selected) {
			return;
		}

		state.watchAction = selected.value;
		const terminal = vscode.window.createTerminal({
			name: `Cargo Watch: ${state.watchAction}`,
			cwd: workspace.uri.fsPath
		});
		state.watchTerminal = terminal;

		let command = `cargo watch -x ${state.watchAction}`;
		if (state.isReleaseMode && ['run', 'build', 'test'].includes(state.watchAction)) {
			command = `cargo watch -x "${state.watchAction} --release"`;
		}

		const checkedFeatures = cargoTreeProvider.getCheckedFeatures();
		if (checkedFeatures.length > 0) {
			command = `cargo watch -x "${state.watchAction} --features ${checkedFeatures.join(',')}"`;
		}

		const checkedEnvVars = cargoTreeProvider.getCheckedEnvVars();
		if (checkedEnvVars.length > 0) {
			command = `${checkedEnvVars.join(' ')} ${command}`;
		}

		terminal.show();
		terminal.sendText(command);
		state.isWatchMode = true;
		cargoTreeProvider.refresh();
		vscode.window.showInformationMessage(`Watch mode started: ${state.watchAction}`);
	});

	register('cargui.changeEdition', async () => {
		const workspaceFolder = deps.getWorkspaceFolder();
		if (!workspaceFolder) {
			vscode.window.showErrorMessage('No workspace folder found');
			return;
		}

		// Get workspace edition from root
		const workspaceEditionInfo = getCurrentEdition(workspaceFolder.uri.fsPath);
		if (!workspaceEditionInfo) {
			vscode.window.showErrorMessage('Could not read current edition from Cargo.toml');
			return;
		}

		// Get member edition if a member is selected
		let memberEditionInfo;
		let memberPath: string | undefined;
		if (state.selectedWorkspaceMember && state.selectedWorkspaceMember !== 'all') {
			const members = discoverWorkspaceMembers(workspaceFolder.uri.fsPath);
			const member = members.find(m => m.name === state.selectedWorkspaceMember);
			if (member) {
				memberPath = path.join(workspaceFolder.uri.fsPath, member.path);
				memberEditionInfo = getCurrentEdition(memberPath);
			}
		}

		// If workspace has both workspace and member editions, ask which to update
		let updateWorkspace = true;
		if (workspaceEditionInfo.workspaceEdition && memberEditionInfo) {
			// Show member's explicit edition if it has one, otherwise show that it inherits
			const memberEditionDisplay = memberEditionInfo.hasExplicitEdition 
				? memberEditionInfo.edition 
				: `${memberEditionInfo.edition} (inherited from workspace)`;
			const workspaceEditionDisplay = workspaceEditionInfo.workspaceEdition;
			
			const choice = await vscode.window.showQuickPick(
				[
					{ label: 'Update member edition', description: `currently ${memberEditionDisplay}`, value: 'member' },
					{ label: 'Update workspace edition', description: `currently ${workspaceEditionDisplay}`, value: 'workspace' }
				],
				{ placeHolder: 'Which edition do you want to update?' }
			);

			if (!choice) {
				return;
			}

			updateWorkspace = choice.value === 'workspace';
		}

		const currentEdition = updateWorkspace && workspaceEditionInfo.workspaceEdition 
			? workspaceEditionInfo.workspaceEdition 
			: (memberEditionInfo?.edition || workspaceEditionInfo.edition);

		const newEdition = await selectEdition(workspaceFolder.uri.fsPath, currentEdition);
		if (newEdition && newEdition !== currentEdition) {
			// Use member path if updating member, otherwise use workspace root path
			const targetPath = updateWorkspace ? workspaceFolder.uri.fsPath : (memberPath || workspaceFolder.uri.fsPath);
			const success = await updateEdition(targetPath, newEdition, updateWorkspace);
			if (success) {
				cargoTreeProvider.refresh();
				const target = updateWorkspace ? 'workspace' : 'member';
				vscode.window.showInformationMessage(`Rust ${target} edition changed to ${newEdition}`);
			} else {
				vscode.window.showErrorMessage('Failed to update edition in Cargo.toml');
			}
		}
	});

	register('cargui.new', async () => {
		const projectType = await vscode.window.showQuickPick(
			['Binary (application)', 'Library'],
			{ placeHolder: 'Select package type' }
		);

		if (!projectType) {
			return;
		}

		const projectName = await vscode.window.showInputBox({
			prompt: 'Enter package name',
			placeHolder: 'my-package',
			validateInput: text => {
				if (!text) {
					return 'Package name cannot be empty';
				}
				if (!/^[a-zA-Z][a-zA-Z0-9_-]*$/.test(text)) {
					return 'Package name must start with a letter and contain only letters, numbers, hyphens, and underscores';
				}
				return null;
			}
		});

		if (!projectName) {
			return;
		}

		const targetFolder = await vscode.window.showOpenDialog({
			canSelectFiles: false,
			canSelectFolders: true,
			canSelectMany: false,
			openLabel: 'Select parent folder',
			title: 'Select folder where the package will be created'
		});

		if (!targetFolder?.length) {
			return;
		}

		const isLib = projectType === 'Library';
		const libFlag = isLib ? '--lib' : '--bin';
		const projectPath = path.join(targetFolder[0].fsPath, projectName);

		const terminal = vscode.window.createTerminal('Cargo New');
		terminal.show();
		terminal.sendText(`cd "${targetFolder[0].fsPath}" && cargo new ${libFlag} ${projectName}`);

		vscode.window.showInformationMessage(
			`Creating ${isLib ? 'library' : 'binary'} package: ${projectName}`,
			'Open Package'
		).then(selection => {
			if (selection === 'Open Package') {
				vscode.commands.executeCommand('vscode.openFolder', vscode.Uri.file(projectPath));
			}
		});
	});

	register('cargui.newGlobal', () => {
		vscode.commands.executeCommand('cargui.new');
	});

	register('cargui.update', () => {
		runCargoCommand('update', false);
	});

	register('cargui.formatCargoToml', async () => {
		const workspace = deps.getWorkspaceFolder();
		if (!workspace) {
			vscode.window.showErrorMessage('No workspace folder found');
			return;
		}

		const workspaceMembers = discoverWorkspaceMembers(workspace.uri.fsPath);

		// If this is a workspace (has members), show quick pick regardless of selection
		if (workspaceMembers.length > 1) {
			// Build quick pick items for root and all members
			const items: vscode.QuickPickItem[] = [];
			
			// Add root workspace Cargo.toml
			const rootCargoToml = path.join(workspace.uri.fsPath, 'Cargo.toml');
			if (fs.existsSync(rootCargoToml)) {
				items.push({
					label: '$(home) Root Workspace',
					description: 'Cargo.toml',
					picked: false
				});
			}
			
			// Add each member's Cargo.toml
			for (const member of workspaceMembers) {
				const memberCargoTomlPath = path.join(workspace.uri.fsPath, member.path, 'Cargo.toml');
				if (fs.existsSync(memberCargoTomlPath)) {
					items.push({
						label: `$(package) ${member.name}`,
						description: `${member.path}/Cargo.toml`,
						picked: false
					});
				}
			}

			// Show multi-select quick pick
			const selected = await vscode.window.showQuickPick(items, {
				canPickMany: true,
				placeHolder: 'Select Cargo.toml files to format',
				title: 'Format Cargo.toml Files'
			});

			if (!selected || selected.length === 0) {
				return;
			}

			let successCount = 0;
			let errorCount = 0;

			for (const item of selected) {
				if (item.label.includes('Root Workspace')) {
					const result = await formatCargoTomlFile(rootCargoToml);
					if (result) {
						successCount++;
					} else {
						errorCount++;
					}
				} else {
					// Extract member name from label (remove icon prefix)
					const memberName = item.label.replace('$(package) ', '');
					const member = workspaceMembers.find(m => m.name === memberName);
					if (member) {
						const memberCargoTomlPath = path.join(workspace.uri.fsPath, member.path, 'Cargo.toml');
						const result = await formatCargoTomlFile(memberCargoTomlPath, member.name);
						if (result) {
							successCount++;
						} else {
							errorCount++;
						}
					}
				}
			}

			if (successCount > 0) {
				vscode.window.showInformationMessage(
					`Formatted ${successCount} Cargo.toml file(s)` +
					(errorCount > 0 ? ` (${errorCount} failed)` : '')
				);
			}
			cargoTreeProvider.refresh();
			return;
		}

		// Single package (not a workspace) - format directly
		const cargoTomlPath = path.join(workspace.uri.fsPath, 'Cargo.toml');

		if (!fs.existsSync(cargoTomlPath)) {
			vscode.window.showErrorMessage(`Cargo.toml not found at ${cargoTomlPath}`);
			return;
		}

		const result = await formatCargoTomlFile(cargoTomlPath);
		if (result) {
			vscode.window.showInformationMessage('Formatted Cargo.toml');
			cargoTreeProvider.refresh();
		}
	});

	register('cargui.viewOnCratesIo', async (item: CargoTreeItem) => {
		if (item?.dependency) {
			const url = `https://crates.io/crates/${item.dependency.name}`;
			vscode.env.openExternal(vscode.Uri.parse(url));
		}
	});

	register('cargui.viewDependencyDocs', async (item: CargoTreeItem) => {
		if (item?.dependency) {
			const url = `https://docs.rs/${item.dependency.name}`;
			vscode.env.openExternal(vscode.Uri.parse(url));
		}
	});

	register('cargui.copyDependencyLine', async (item: CargoTreeItem) => {
		if (!item?.dependency) {
			return;
		}

		const dep = item.dependency;
		let line = `${dep.name} = `;

		if (dep.version) {
			line += `"${dep.version}"`;
		} else if (dep.path) {
			line += `{ path = "${dep.path}" }`;
		} else if (dep.git) {
			line += `{ git = "${dep.git}"`;
			if (dep.branch) line += `, branch = "${dep.branch}"`;
			if (dep.tag) line += `, tag = "${dep.tag}"`;
			if (dep.rev) line += `, rev = "${dep.rev}"`;
			line += ' }';
		} else {
			line += '"*"';
		}

		await vscode.env.clipboard.writeText(line);
		vscode.window.showInformationMessage(`Copied: ${line}`);
	});

	register('cargui.changeDependencyVersion', async (item: CargoTreeItem) => {
		if (!item?.dependency) {
			return;
		}

		const dep = item.dependency;
		const workspace = deps.getWorkspaceFolder();
		if (!workspace) {
			return;
		}

		try {
			const versions = await vscode.window.withProgress({
				location: vscode.ProgressLocation.Notification,
				title: `Fetching versions for ${dep.name}...`,
				cancellable: false
			}, () => fetchCrateVersions(dep.name));

			if (versions.length === 0) {
				vscode.window.showWarningMessage(`No versions found for ${dep.name}`);
				return;
			}

			const currentVersion = dep.version;

			const matchesCurrentVersion = (version: string, current: string | undefined): boolean => {
				if (!current) return false;
				if (version === current) return true;
				const normalize = (v: string) => {
					const parts = v.split('.');
					while (parts.length < 3) parts.push('0');
					return parts.join('.');
				};
				return normalize(version) === normalize(current);
			};

			const versionItems: vscode.QuickPickItem[] = versions.map((version, index) => {
				const isLatest = index === 0;
				const isCurrent = matchesCurrentVersion(version, currentVersion);
				let label = version;
				let description = '';
				if (isCurrent) {
					label = `$(check) ${version}`;
					description = 'current';
				}
				if (isLatest) {
					description = description ? 'current, latest' : 'latest';
				}
				return {
					label,
					description,
					detail: undefined,
					picked: isCurrent
				};
			});

			const choice = await vscode.window.showQuickPick(versionItems, {
				placeHolder: `Select version for ${dep.name}${currentVersion ? ` (current: ${currentVersion})` : ''}`,
				title: `Change Version: ${dep.name} (${versions.length} versions available)`,
				canPickMany: false
			});

			if (!choice) {
				return;
			}

			const selectedVersion = choice.label.replace('$(check) ', '');
			const depType = dep.type || 'production';
			const versionChoices = new Map<string, { version: string; type: string }>();
			versionChoices.set(dep.name, { version: selectedVersion, type: depType });

			let cargoTomlPath: string;
			if (state.selectedWorkspaceMember && state.selectedWorkspaceMember !== 'all') {
				const workspaceMembers = discoverWorkspaceMembers(workspace.uri.fsPath);
				const member = workspaceMembers.find(m => m.name === state.selectedWorkspaceMember);
				if (!member) {
					vscode.window.showErrorMessage('Selected workspace member not found');
					return;
				}
				cargoTomlPath = path.join(workspace.uri.fsPath, member.path, 'Cargo.toml');
			} else {
				cargoTomlPath = path.join(workspace.uri.fsPath, 'Cargo.toml');
			}

			await updateDependencyVersions(cargoTomlPath, versionChoices);
			vscode.window.showInformationMessage(`Updated ${dep.name} to version ${selectedVersion}`);
			cargoTreeProvider.refresh();
			await autoFormatCargoToml(cargoTomlPath, undefined, `Updated ${dep.name} to ${selectedVersion}`);
		} catch (error) {
			vscode.window.showErrorMessage(`Failed to change version for ${dep.name}: ${error}`);
		}
	});

	register('cargui.removeDependency', async (item: CargoTreeItem) => {
		if (!item?.dependency) {
			return;
		}

		const dep = item.dependency;
		const workspace = deps.getWorkspaceFolder();
		if (!workspace) {
			return;
		}

		const confirm = await vscode.window.showWarningMessage(
			`Remove dependency "${dep.name}"?`,
			{ modal: true },
			'Yes',
			'No'
		);

		if (confirm !== 'Yes') {
			return;
		}

		const members = discoverWorkspaceMembers(workspace.uri.fsPath);
		let cargoTomlPath: string;
		if (state.selectedWorkspaceMember && state.selectedWorkspaceMember !== 'all') {
			const member = members.find(m => m.name === state.selectedWorkspaceMember);
			if (!member) {
				vscode.window.showErrorMessage('Selected workspace member not found');
				return;
			}
			cargoTomlPath = path.join(workspace.uri.fsPath, member.path, 'Cargo.toml');
		} else {
			cargoTomlPath = path.join(workspace.uri.fsPath, 'Cargo.toml');
		}

		if (!fs.existsSync(cargoTomlPath)) {
			vscode.window.showErrorMessage(`Cargo.toml not found at ${cargoTomlPath}`);
			return;
		}

		try {
			const content = fs.readFileSync(cargoTomlPath, 'utf-8');
			const lines = content.split('\n');

			let inDependencies = false;
			let inDevDependencies = false;
			let inBuildDependencies = false;
			let inWorkspaceDependencies = false;
			let removed = false;
			const newLines: string[] = [];

			for (let i = 0; i < lines.length; i++) {
				const line = lines[i];
				const trimmed = line.trim();

				if (trimmed === '[dependencies]') {
					inDependencies = true;
					inDevDependencies = false;
					inBuildDependencies = false;
					inWorkspaceDependencies = false;
					newLines.push(line);
					continue;
				}

				if (trimmed === '[dev-dependencies]') {
					inDependencies = false;
					inDevDependencies = true;
					inBuildDependencies = false;
					inWorkspaceDependencies = false;
					newLines.push(line);
					continue;
				}

				if (trimmed === '[build-dependencies]') {
					inDependencies = false;
					inDevDependencies = false;
					inBuildDependencies = true;
					inWorkspaceDependencies = false;
					newLines.push(line);
					continue;
				}

				if (trimmed === '[workspace.dependencies]') {
					inDependencies = false;
					inDevDependencies = false;
					inBuildDependencies = false;
					inWorkspaceDependencies = true;
					newLines.push(line);
					continue;
				}

				if (trimmed.startsWith('[')) {
					inDependencies = false;
					inDevDependencies = false;
					inBuildDependencies = false;
					inWorkspaceDependencies = false;
					newLines.push(line);
					continue;
				}

			// Normalize dependency names: Rust treats hyphens and underscores as equivalent
			const normalizedDepName = dep.name.replace(/_/g, '-');
			const normalizedLineName = trimmed.split(/\s*=/)[0].trim().replace(/_/g, '-');
			const isDependencyLine =
				(inDependencies || inDevDependencies || inBuildDependencies || inWorkspaceDependencies) &&
				normalizedLineName === normalizedDepName;				if (isDependencyLine) {
					removed = true;
					while (i + 1 < lines.length) {
						const nextLine = lines[i + 1];
						const nextTrimmed = nextLine.trim();
						if (nextTrimmed === '}' || (nextLine.startsWith('  ') && !nextTrimmed.startsWith('#'))) {
							i++;
						} else {
							break;
						}
					}
					continue;
				}

				newLines.push(line);
			}

			if (!removed) {
				vscode.window.showWarningMessage(`Dependency "${dep.name}" not found in Cargo.toml`);
				return;
			}

			fs.writeFileSync(cargoTomlPath, newLines.join('\n'), 'utf-8');
			vscode.window.showInformationMessage(`Removed dependency: ${dep.name}`);
			cargoTreeProvider.refresh();
			await autoFormatCargoToml(cargoTomlPath, undefined, `Removed dependency ${dep.name}`);
		} catch (error) {
			vscode.window.showErrorMessage(`Failed to remove dependency: ${error}`);
		}
	});

	register('cargui.viewDependencyInCargoToml', async (item: CargoTreeItem) => {
		if (!item?.dependency) {
			return;
		}

		const dep = item.dependency;
		const workspace = deps.getWorkspaceFolder();
		if (!workspace) {
			return;
		}

		const members = discoverWorkspaceMembers(workspace.uri.fsPath);
		let cargoTomlPath: string;
		
		// Workspace dependencies are always in the root, regardless of selected member
		if (dep.type === 'workspace') {
			cargoTomlPath = path.join(workspace.uri.fsPath, 'Cargo.toml');
		} else if (state.selectedWorkspaceMember && state.selectedWorkspaceMember !== 'all') {
			const member = members.find(m => m.name === state.selectedWorkspaceMember);
			if (!member) {
				vscode.window.showErrorMessage('Selected workspace member not found');
				return;
			}
			cargoTomlPath = path.join(workspace.uri.fsPath, member.path, 'Cargo.toml');
		} else {
			cargoTomlPath = path.join(workspace.uri.fsPath, 'Cargo.toml');
		}

		if (!fs.existsSync(cargoTomlPath)) {
			vscode.window.showErrorMessage(`Cargo.toml not found at ${cargoTomlPath}`);
			return;
		}

		try {
			const content = fs.readFileSync(cargoTomlPath, 'utf-8');
			const lines = content.split('\n');
			let lineNumber = -1;

			let inDependencies = false;
			let inDevDependencies = false;
			let inBuildDependencies = false;
			let inWorkspaceDependencies = false;

			for (let i = 0; i < lines.length; i++) {
				const trimmed = lines[i].trim();

				if (trimmed === '[dependencies]') {
					inDependencies = true;
					inDevDependencies = false;
					inBuildDependencies = false;
					inWorkspaceDependencies = false;
					continue;
				}

				if (trimmed === '[dev-dependencies]') {
					inDependencies = false;
					inDevDependencies = true;
					inBuildDependencies = false;
					inWorkspaceDependencies = false;
					continue;
				}

				if (trimmed === '[build-dependencies]') {
					inDependencies = false;
					inDevDependencies = false;
					inBuildDependencies = true;
					inWorkspaceDependencies = false;
					continue;
				}

				if (trimmed === '[workspace.dependencies]') {
					inDependencies = false;
					inDevDependencies = false;
					inBuildDependencies = false;
					inWorkspaceDependencies = true;
					continue;
				}

				if (trimmed.startsWith('[')) {
					inDependencies = false;
					inDevDependencies = false;
					inBuildDependencies = false;
					inWorkspaceDependencies = false;
					continue;
				}

			// Normalize dependency names: Rust treats hyphens and underscores as equivalent
			const normalizedDepName = dep.name.replace(/_/g, '-');
			const normalizedLineName = trimmed.split(/\s*=/)[0].trim().replace(/_/g, '-');
			const matchesDependency =
				(inDependencies || inDevDependencies || inBuildDependencies || inWorkspaceDependencies) &&
				normalizedLineName === normalizedDepName;				if (matchesDependency) {
					lineNumber = i;
					break;
				}
			}

			if (lineNumber === -1) {
				vscode.window.showWarningMessage(`Dependency "${dep.name}" not found in Cargo.toml`);
				return;
			}

			const document = await vscode.workspace.openTextDocument(cargoTomlPath);
			const editor = await vscode.window.showTextDocument(document);
			const position = new vscode.Position(lineNumber, 0);
			editor.selection = new vscode.Selection(position, position);
			editor.revealRange(new vscode.Range(position, position), vscode.TextEditorRevealType.InCenter);
		} catch (error) {
			vscode.window.showErrorMessage(`Failed to open Cargo.toml: ${error}`);
		}
	});

	register('cargui.viewFeatureInCargoToml', async (item: CargoTreeItem) => {
		if (!item?.feature) {
			return;
		}

		const featureName = item.feature;
		const workspace = deps.getWorkspaceFolder();
		if (!workspace) {
			return;
		}

		const members = discoverWorkspaceMembers(workspace.uri.fsPath);
		let cargoTomlPath: string;
		if (state.selectedWorkspaceMember && state.selectedWorkspaceMember !== 'all') {
			const member = members.find(m => m.name === state.selectedWorkspaceMember);
			if (!member) {
				vscode.window.showErrorMessage('Selected workspace member not found');
				return;
			}
			cargoTomlPath = path.join(workspace.uri.fsPath, member.path, 'Cargo.toml');
		} else {
			cargoTomlPath = path.join(workspace.uri.fsPath, 'Cargo.toml');
		}

		if (!fs.existsSync(cargoTomlPath)) {
			vscode.window.showErrorMessage(`Cargo.toml not found at ${cargoTomlPath}`);
			return;
		}

		try {
			const content = fs.readFileSync(cargoTomlPath, 'utf-8');
			const lines = content.split('\n');
			let lineNumber = -1;
			let inFeatures = false;

			for (let i = 0; i < lines.length; i++) {
				const trimmed = lines[i].trim();

				if (trimmed === '[features]') {
					inFeatures = true;
					continue;
				}

				if (trimmed.startsWith('[')) {
					inFeatures = false;
					continue;
				}

				if (inFeatures && trimmed.startsWith(`${featureName} =`)) {
					lineNumber = i;
					break;
				}
			}

			if (lineNumber === -1) {
				vscode.window.showWarningMessage(`Feature "${featureName}" not found in Cargo.toml`);
				return;
			}

			const document = await vscode.workspace.openTextDocument(cargoTomlPath);
			const editor = await vscode.window.showTextDocument(document);
			const position = new vscode.Position(lineNumber, 0);
			editor.selection = new vscode.Selection(position, position);
			editor.revealRange(new vscode.Range(position, position), vscode.TextEditorRevealType.InCenter);
		} catch (error) {
			vscode.window.showErrorMessage(`Failed to open Cargo.toml: ${error}`);
		}
	});

	register('cargui.viewFeatureUsage', async (featureName: string, memberPath?: string) => {
		if (!featureName) {
			return;
		}

		const workspace = deps.getWorkspaceFolder();
		if (!workspace) {
			return;
		}

		// we scan all .rs files for the feature usage
		const basePath = memberPath ? path.join(workspace.uri.fsPath, memberPath) : workspace.uri.fsPath;
		
		function findFeatureUsage(dirPath: string): { file: string; line: number } | null {
			if (!fs.existsSync(dirPath)) {
				return null;
			}

			const items = fs.readdirSync(dirPath, { withFileTypes: true });
			for (const item of items) {
				const fullPath = path.join(dirPath, item.name);

				if (item.isDirectory()) {
					if (item.name !== 'target' && item.name !== 'node_modules') {
						const result = findFeatureUsage(fullPath);
						if (result) return result;
					}
				} else if (item.name.endsWith('.rs')) {
					try {
						const content = fs.readFileSync(fullPath, 'utf-8');
						const lines = content.split('\n');
						// we search for feature = "featureName" in the content
						for (let i = 0; i < lines.length; i++) {
							const line = lines[i];
							// match feature = "..." or feature = '...' with any spacing
							if (line.includes('feature') && (line.includes(`"${featureName}"`) || line.includes(`'${featureName}'`))) {
								return { file: fullPath, line: i };
							}
						}
					} catch (err) {
						// Ignore read errors
					}
				}
			}
			return null;
		}

		const usage = findFeatureUsage(basePath);
		if (!usage) {
			vscode.window.showWarningMessage(`Feature "${featureName}" not used in code`);
			return;
		}

		try {
			const document = await vscode.workspace.openTextDocument(usage.file);
			const editor = await vscode.window.showTextDocument(document);
			const position = new vscode.Position(usage.line, 0);
			editor.selection = new vscode.Selection(position, position);
			editor.revealRange(new vscode.Range(position, position), vscode.TextEditorRevealType.InCenter);
		} catch (error) {
			vscode.window.showErrorMessage(`Failed to open file: ${error}`);
		}
	});

	register('cargui.removeFeature', async (item: CargoTreeItem) => {
		if (!item?.feature) {
			return;
		}

		const featureName = item.feature;
		const workspace = deps.getWorkspaceFolder();
		if (!workspace) {
			return;
		}

		const confirm = await vscode.window.showWarningMessage(
			`Remove feature "${featureName}"?`,
			{ modal: true },
			'Remove'
		);

		if (confirm !== 'Remove') {
			return;
		}

		const members = discoverWorkspaceMembers(workspace.uri.fsPath);
		let cargoTomlPath: string;
		if (state.selectedWorkspaceMember && state.selectedWorkspaceMember !== 'all') {
			const member = members.find(m => m.name === state.selectedWorkspaceMember);
			if (!member) {
				vscode.window.showErrorMessage('Selected workspace member not found');
				return;
			}
			cargoTomlPath = path.join(workspace.uri.fsPath, member.path, 'Cargo.toml');
		} else {
			cargoTomlPath = path.join(workspace.uri.fsPath, 'Cargo.toml');
		}

		if (!fs.existsSync(cargoTomlPath)) {
			vscode.window.showErrorMessage(`Cargo.toml not found at ${cargoTomlPath}`);
			return;
		}

		try {
			const content = fs.readFileSync(cargoTomlPath, 'utf-8');
			const lines = content.split('\n');
			let inFeatures = false;
			let removed = false;
			const newLines: string[] = [];

			for (let i = 0; i < lines.length; i++) {
				const line = lines[i];
				const trimmed = line.trim();

				if (trimmed === '[features]') {
					inFeatures = true;
					newLines.push(line);
					continue;
				}

				if (trimmed.startsWith('[')) {
					inFeatures = false;
					newLines.push(line);
					continue;
				}

				if (inFeatures && trimmed.startsWith(`${featureName} =`)) {
					removed = true;
					continue; // Skip this line
				}

				newLines.push(line);
			}

			if (!removed) {
				vscode.window.showWarningMessage(`Feature "${featureName}" not found in Cargo.toml`);
				return;
			}

			fs.writeFileSync(cargoTomlPath, newLines.join('\n'), 'utf-8');
			vscode.window.showInformationMessage(`Removed feature: ${featureName}`);
			cargoTreeProvider.refresh();
		} catch (error) {
			vscode.window.showErrorMessage(`Failed to remove feature: ${error}`);
		}
	});

	register('cargui.declareFeature', async (item: CargoTreeItem, memberPath?: string) => {
		const featureName = item?.feature;
		if (!featureName) {
			return;
		}

		const workspace = deps.getWorkspaceFolder();
		if (!workspace) {
			return;
		}

		// we determine which Cargo.toml to edit
		const members = discoverWorkspaceMembers(workspace.uri.fsPath);
		let cargoTomlPath: string;
		if (memberPath) {
			cargoTomlPath = path.join(workspace.uri.fsPath, memberPath, 'Cargo.toml');
		} else if (state.selectedWorkspaceMember && state.selectedWorkspaceMember !== 'all') {
			const member = members.find(m => m.name === state.selectedWorkspaceMember);
			if (!member) {
				vscode.window.showErrorMessage('Selected workspace member not found');
				return;
			}
			cargoTomlPath = path.join(workspace.uri.fsPath, member.path, 'Cargo.toml');
		} else {
			cargoTomlPath = path.join(workspace.uri.fsPath, 'Cargo.toml');
		}

		if (!fs.existsSync(cargoTomlPath)) {
			vscode.window.showErrorMessage(`Cargo.toml not found at ${cargoTomlPath}`);
			return;
		}

		try {
			const content = fs.readFileSync(cargoTomlPath, 'utf-8');
			const lines = content.split('\n');
			let featuresLineIndex = -1;
			let inFeatures = false;
			let lastFeatureLine = -1;

			// we find the [features] section and check if feature already exists
			for (let i = 0; i < lines.length; i++) {
				const trimmed = lines[i].trim();

				if (trimmed === '[features]') {
					featuresLineIndex = i;
					inFeatures = true;
					continue;
				}

				if (trimmed.startsWith('[')) {
					inFeatures = false;
					continue;
				}

				if (inFeatures) {
					if (trimmed.startsWith(`${featureName} =`)) {
						vscode.window.showInformationMessage(`Feature "${featureName}" already declared in Cargo.toml`);
						return;
					}
					if (trimmed.length > 0) {
						lastFeatureLine = i;
					}
				}
			}

			// we add the feature with an empty array as default
			const newFeatureLine = `${featureName} = []`;

			if (featuresLineIndex === -1) {
				// we need to add [features] section
				lines.push('', '[features]', newFeatureLine);
			} else {
				// we insert after the last feature line or right after [features]
				const insertIndex = lastFeatureLine >= 0 ? lastFeatureLine + 1 : featuresLineIndex + 1;
				lines.splice(insertIndex, 0, newFeatureLine);
			}

			fs.writeFileSync(cargoTomlPath, lines.join('\n'), 'utf-8');
			vscode.window.showInformationMessage(`Declared feature: ${featureName}`);
			cargoTreeProvider.refresh();
			await autoFormatCargoToml(cargoTomlPath, undefined, `Declared feature "${featureName}"`);
		} catch (error) {
			vscode.window.showErrorMessage(`Failed to declare feature: ${error}`);
		}
	});

	register('cargui.declareSelectedFeatures', async (memberPath?: string) => {
		const workspace = deps.getWorkspaceFolder();
		if (!workspace) {
			return;
		}

		// we get all undeclared features (not just checked ones)
		const featureMemberPath = memberPath || (state.selectedWorkspaceMember && state.selectedWorkspaceMember !== 'all'
			? discoverWorkspaceMembers(workspace.uri.fsPath).find(m => m.name === state.selectedWorkspaceMember)?.path
			: undefined);
		
		const undeclaredFeatures = detectUndeclaredFeatures(workspace.uri.fsPath, featureMemberPath);

		if (undeclaredFeatures.length === 0) {
			vscode.window.showWarningMessage('No undeclared features found');
			return;
		}

		// we determine which Cargo.toml to edit
		const members = discoverWorkspaceMembers(workspace.uri.fsPath);
		let cargoTomlPath: string;
		if (featureMemberPath) {
			cargoTomlPath = path.join(workspace.uri.fsPath, featureMemberPath, 'Cargo.toml');
		} else if (state.selectedWorkspaceMember && state.selectedWorkspaceMember !== 'all') {
			const member = members.find(m => m.name === state.selectedWorkspaceMember);
			if (!member) {
				vscode.window.showErrorMessage('Selected workspace member not found');
				return;
			}
			cargoTomlPath = path.join(workspace.uri.fsPath, member.path, 'Cargo.toml');
		} else {
			cargoTomlPath = path.join(workspace.uri.fsPath, 'Cargo.toml');
		}

		if (!fs.existsSync(cargoTomlPath)) {
			vscode.window.showErrorMessage(`Cargo.toml not found at ${cargoTomlPath}`);
			return;
		}

		try {
			const content = fs.readFileSync(cargoTomlPath, 'utf-8');
			const lines = content.split('\n');
			let featuresLineIndex = -1;
			let inFeatures = false;
			let lastFeatureLine = -1;
			const existingFeatures = new Set<string>();

			// we find the [features] section and collect existing features
			for (let i = 0; i < lines.length; i++) {
				const trimmed = lines[i].trim();

				if (trimmed === '[features]') {
					featuresLineIndex = i;
					inFeatures = true;
					continue;
				}

				if (trimmed.startsWith('[')) {
					inFeatures = false;
					continue;
				}

				if (inFeatures && trimmed.length > 0) {
					const featureName = trimmed.split('=')[0].trim();
					existingFeatures.add(featureName);
					lastFeatureLine = i;
				}
			}

			// we filter out features that already exist
			const featuresToAdd = undeclaredFeatures.filter((f: UnregisteredItem) => !existingFeatures.has(f.name));

			if (featuresToAdd.length === 0) {
				vscode.window.showInformationMessage('All undeclared features are already declared');
				return;
			}

			// we add the features
			const newFeatureLines = featuresToAdd.map((f: UnregisteredItem) => `${f.name} = []`);

			if (featuresLineIndex === -1) {
				// we need to add [features] section
				lines.push('', '[features]', ...newFeatureLines);
			} else {
				// we insert after the last feature line or right after [features]
				const insertIndex = lastFeatureLine >= 0 ? lastFeatureLine + 1 : featuresLineIndex + 1;
				lines.splice(insertIndex, 0, ...newFeatureLines);
			}

		fs.writeFileSync(cargoTomlPath, lines.join('\n'), 'utf-8');
		vscode.window.showInformationMessage(`Declared ${featuresToAdd.length} feature(s): ${featuresToAdd.map((f: UnregisteredItem) => f.name).join(', ')}`);
		cargoTreeProvider.refresh();
		await autoFormatCargoToml(cargoTomlPath, undefined, `Declared ${featuresToAdd.length} feature(s)`);
	} catch (error) {
		vscode.window.showErrorMessage(`Failed to declare features: ${error}`);
	}
});

register('cargui.declareAllUndeclaredFeatures', async (itemOrPath?: CargoTreeItem | string) => {
	// When called from inline button, we get the tree item; when called from context menu, we might get memberPath
	// Extract memberPath if needed
	let memberPath: string | undefined;
	if (typeof itemOrPath === 'string') {
		memberPath = itemOrPath;
	}
	// If it's a tree item, memberPath should come from state
	return vscode.commands.executeCommand('cargui.declareSelectedFeatures', memberPath);
});

register('cargui.declareModule', async (item: CargoTreeItem) => {
	const moduleInfo = item?.moduleInfo;
	if (!moduleInfo || !moduleInfo.name) {
		return;
	}

	const workspace = deps.getWorkspaceFolder();
	if (!workspace) {
		return;
	}

	// we determine which main target file to edit (main.rs or lib.rs)
	const members = discoverWorkspaceMembers(workspace.uri.fsPath);
	let targetPath: string;
	let memberPath = '';

	if (item.workspaceMember) {
		const member = members.find(m => m.name === item.workspaceMember);
		if (!member) {
			vscode.window.showErrorMessage('Workspace member not found');
			return;
		}
		memberPath = member.path;
	} else if (state.selectedWorkspaceMember && state.selectedWorkspaceMember !== 'all') {
		const member = members.find(m => m.name === state.selectedWorkspaceMember);
		if (member) {
			memberPath = member.path;
		}
	}

	const basePath = memberPath 
		? path.join(workspace.uri.fsPath, memberPath)
		: workspace.uri.fsPath;

	const mainRsPath = path.join(basePath, 'src/main.rs');
	const libRsPath = path.join(basePath, 'src/lib.rs');

	if (fs.existsSync(libRsPath)) {
		targetPath = libRsPath;
	} else if (fs.existsSync(mainRsPath)) {
		targetPath = mainRsPath;
	} else {
		vscode.window.showErrorMessage(`No main.rs or lib.rs found in ${memberPath || 'workspace root'}`);
		return;
	}

	try {
		const content = fs.readFileSync(targetPath, 'utf-8');
		const lines = content.split('\n');
		
		// we check if module is already declared
		const moduleName = moduleInfo.name.replace(/\.rs$/, '');
		const modulePattern = new RegExp(`^\\s*(pub\\s+)?mod\\s+${moduleName}\\b`);
		
		for (const line of lines) {
			if (modulePattern.test(line)) {
				vscode.window.showInformationMessage(`Module "${moduleName}" is already declared`);
				return;
			}
		}

		// we add the module declaration at the top after any initial comments/attributes
		let insertIndex = 0;
		for (let i = 0; i < lines.length; i++) {
			const trimmed = lines[i].trim();
			if (trimmed.startsWith('//') || trimmed.startsWith('#[') || trimmed.startsWith('#![') || trimmed === '') {
				insertIndex = i + 1;
			} else {
				break;
			}
		}

		lines.splice(insertIndex, 0, `mod ${moduleName};`);
		fs.writeFileSync(targetPath, lines.join('\n'), 'utf-8');
		vscode.window.showInformationMessage(`Declared module: ${moduleName}`);
		cargoTreeProvider.refresh();
	} catch (error) {
		vscode.window.showErrorMessage(`Failed to declare module: ${error}`);
	}
});

register('cargui.declareAllUndeclaredModules', async () => {
	const workspace = deps.getWorkspaceFolder();
	if (!workspace) {
		return;
	}

	// we get all undeclared modules - if multi-member workspace and no specific member selected, process all
	const members = discoverWorkspaceMembers(workspace.uri.fsPath);
	const allUndeclaredModules: Array<{ module: ModuleInfo, memberPath: string, memberName: string }> = [];

	if (members.length > 1 && (!state.selectedWorkspaceMember || state.selectedWorkspaceMember === 'all')) {
		// Multi-member workspace, process all members
		for (const member of members) {
			const srcPath = path.join(workspace.uri.fsPath, member.path, 'src');
			const modules = detectModules(srcPath);
			const undeclared = modules.filter(m => !m.isDeclared);
			undeclared.forEach(m => {
				allUndeclaredModules.push({
					module: m,
					memberPath: member.path,
					memberName: member.name
				});
			});
		}
	} else {
		// Single member or specific member selected
		let memberPath = '';
		if (state.selectedWorkspaceMember && state.selectedWorkspaceMember !== 'all') {
			const member = members.find(m => m.name === state.selectedWorkspaceMember);
			if (member) {
				memberPath = member.path;
			}
		}

		const basePath = memberPath 
			? path.join(workspace.uri.fsPath, memberPath)
			: workspace.uri.fsPath;

		const srcPath = path.join(basePath, 'src');
		const modules = detectModules(srcPath);
		const undeclared = modules.filter(m => !m.isDeclared);
		undeclared.forEach(m => {
			allUndeclaredModules.push({
				module: m,
				memberPath: memberPath,
				memberName: state.selectedWorkspaceMember || ''
			});
		});
	}

	if (allUndeclaredModules.length === 0) {
		vscode.window.showInformationMessage('No undeclared modules found');
		return;
	}

	// we group by member and declare in each member's root file
	const byMember = new Map<string, ModuleInfo[]>();
	for (const item of allUndeclaredModules) {
		if (!byMember.has(item.memberPath)) {
			byMember.set(item.memberPath, []);
		}
		byMember.get(item.memberPath)!.push(item.module);
	}

	let totalDeclared = 0;
	for (const [memberPath, modules] of byMember) {
		const basePath = memberPath 
			? path.join(workspace.uri.fsPath, memberPath)
			: workspace.uri.fsPath;

		// we determine which main target file to edit (main.rs or lib.rs)
		const mainRsPath = path.join(basePath, 'src/main.rs');
		const libRsPath = path.join(basePath, 'src/lib.rs');
		let targetPath: string;

		if (fs.existsSync(libRsPath)) {
			targetPath = libRsPath;
		} else if (fs.existsSync(mainRsPath)) {
			targetPath = mainRsPath;
		} else {
			continue; // Skip this member if no root file
		}

		try {
			const content = fs.readFileSync(targetPath, 'utf-8');
			const lines = content.split('\n');
			
			// we find where to insert declarations (after initial comments/attributes)
			let insertIndex = 0;
			for (let i = 0; i < lines.length; i++) {
				const trimmed = lines[i].trim();
				if (trimmed.startsWith('//') || trimmed.startsWith('#[') || trimmed.startsWith('#![') || trimmed === '') {
					insertIndex = i + 1;
				} else {
					break;
				}
			}

			// we add all undeclared modules
			const moduleDeclarations = modules.map(m => {
				const moduleName = m.name.replace(/\.rs$/, '');
				return `mod ${moduleName};`;
			});

			lines.splice(insertIndex, 0, ...moduleDeclarations);
			fs.writeFileSync(targetPath, lines.join('\n'), 'utf-8');
			totalDeclared += modules.length;
		} catch (error) {
			vscode.window.showErrorMessage(`Failed to declare modules in ${memberPath}: ${error}`);
		}
	}

	if (totalDeclared > 0) {
		vscode.window.showInformationMessage(`Declared ${totalDeclared} module(s)`);
		cargoTreeProvider.refresh();
	}
});

register('cargui.removeEnvironmentVariable', async (item: CargoTreeItem) => {
		if (!item?.envVar) {
			return;
		}

		const envVar = item.envVar;
		const workspace = deps.getWorkspaceFolder();
		if (!workspace) {
			return;
		}

		const confirm = await vscode.window.showWarningMessage(
			`Remove environment variable "${envVar}"?`,
			{ modal: true },
			'Remove'
		);

		if (confirm !== 'Remove') {
			return;
		}

		const config = vscode.workspace.getConfiguration('cargui');
		const envVars = config.get<string[]>('environmentVariables') || [];
		const newEnvVars = envVars.filter(ev => ev !== envVar);

		if (newEnvVars.length === envVars.length) {
			vscode.window.showWarningMessage(`Environment variable "${envVar}" not found`);
			return;
		}

		try {
			await config.update('environmentVariables', newEnvVars, vscode.ConfigurationTarget.Workspace);
			vscode.window.showInformationMessage(`Removed environment variable: ${envVar}`);
			cargoTreeProvider.refresh();
		} catch (error) {
			vscode.window.showErrorMessage(`Failed to remove environment variable: ${error}`);
		}
	});

	register('cargui.updateSelectedDependencies', async () => {
		const checkedDeps = cargoTreeProvider.getCheckedDependencies();
		if (checkedDeps.size === 0) {
			vscode.window.showInformationMessage('No dependencies selected');
			return;
		}

		const workspace = deps.getWorkspaceFolder();
		if (!workspace) {
			return;
		}

		const versionChoices = new Map<string, { version: string; type: string }>();
		const originalVersions = new Map<string, { version: string; type: string }>();

		for (const [depName, dependency] of checkedDeps) {
			try {
				const versions = await fetchCrateVersions(depName);
				if (versions.length === 0) {
					vscode.window.showWarningMessage(`No versions found for ${depName}`);
					continue;
				}

				const currentVersion = dependency.version;
				const depType = dependency.type || 'production';
				if (currentVersion) {
					originalVersions.set(depName, { version: currentVersion, type: depType });
				}

				const matchesCurrentVersion = (version: string, current: string | undefined) => {
					if (!current) return false;
					if (version === current) return true;
					const normalize = (v: string) => {
						const parts = v.split('.');
						while (parts.length < 3) parts.push('0');
						return parts.join('.');
					};
					return normalize(version) === normalize(current);
				};

				const items: vscode.QuickPickItem[] = versions.map((version, index) => {
					const isLatest = index === 0;
					const isCurrent = matchesCurrentVersion(version, currentVersion);
					let label = version;
					let description = '';
					if (isCurrent) {
						label = `$(check) ${version}`;
						description = 'current';
					}
					if (isLatest) {
						description = description ? 'current, latest' : 'latest';
					}
					return {
						label,
						description,
						detail: undefined,
						picked: isCurrent
					};
				});

				const choice = await vscode.window.showQuickPick(items, {
					placeHolder: `Select version for ${depName}${currentVersion ? ` (current: ${currentVersion})` : ''}`,
					title: `Change Version: ${depName} (${versions.length} versions available)`,
					canPickMany: false
				});

				if (choice) {
					const selectedVersion = choice.label.replace('$(check) ', '');
					versionChoices.set(depName, { version: selectedVersion, type: depType });
				}
			} catch (error) {
				vscode.window.showWarningMessage(`Failed to fetch versions for ${depName}: ${error}`);
			}
		}

		if (versionChoices.size === 0) {
			vscode.window.showInformationMessage('No version changes to apply');
			return;
		}

		const workspaceCargoToml = path.join(workspace.uri.fsPath, 'Cargo.toml');
		let memberCargoToml: string | undefined;
		if (state.selectedWorkspaceMember && state.selectedWorkspaceMember !== 'all') {
			const members = discoverWorkspaceMembers(workspace.uri.fsPath);
			const member = members.find(m => m.name === state.selectedWorkspaceMember);
			if (member) {
				memberCargoToml = path.join(workspace.uri.fsPath, member.path, 'Cargo.toml');
			}
		}

		// Remove duplicate/ambiguous dependency constraints before updating
		const depNames = new Set(versionChoices.keys());
		removeDuplicateDependencies(workspaceCargoToml, depNames);
		if (memberCargoToml && fs.existsSync(memberCargoToml)) {
			removeDuplicateDependencies(memberCargoToml, depNames);
		}

		await updateDependencyVersions(workspaceCargoToml, versionChoices);
		if (memberCargoToml && fs.existsSync(memberCargoToml)) {
			await updateDependencyVersions(memberCargoToml, versionChoices);
		}

		// Remove Cargo.lock to clear any stale dependency resolution
		const lockFilePath = path.join(workspace.uri.fsPath, 'Cargo.lock');
		if (fs.existsSync(lockFilePath)) {
			try {
				fs.unlinkSync(lockFilePath);
			} catch (error) {
				console.warn(`Could not remove Cargo.lock: ${error}`);
			}
		}

		// Cargo doesn't support multiple --precise flags in one command
		// Run separate commands for each dependency
		const commands: string[] = [];
		const commandToDepName = new Map<string, string>();
		versionChoices.forEach((info, depName) => {
			const cmd = `cargo update -p ${depName} --precise ${info.version}`;
			commands.push(cmd);
			commandToDepName.set(cmd, depName);
		});

		const terminal = vscode.window.createTerminal({
			name: 'Cargo Version Change',
			cwd: workspace.uri.fsPath
		});
		terminal.show();
		commands.forEach(cmd => terminal.sendText(cmd));

		try {
			const result = await vscode.window.withProgress({
				location: vscode.ProgressLocation.Notification,
				title: `Changing version for ${versionChoices.size} dependencies...`,
				cancellable: false
			}, async () => {
				const { exec } = require('child_process');
				const failedDeps = new Set<string>();
				let combinedOutput = '';

				// Execute each command sequentially and track failures
				for (const command of commands) {
					await new Promise<void>((resolve) => {
						exec(command, { cwd: workspace.uri.fsPath, maxBuffer: 1024 * 1024 * 10 }, (error: any, stdout: string, stderr: string) => {
							const output = `${stdout}${stderr}`;
							combinedOutput += output + '\n';
							const hasError = Boolean(error) ||
								output.includes('error: ') ||
								output.includes('error[') ||
								output.includes('failed to select') ||
								output.includes('could not compile') ||
								output.includes('could not find');
							if (hasError) {
								const depName = commandToDepName.get(command);
								if (depName) {
									failedDeps.add(depName);
								}
							}
							resolve();
						});
					});
				}

				return { failedDeps, output: combinedOutput };
			});

			// Only revert versions for failed dependencies
			if (result.failedDeps.size > 0) {
				const failedVersionChoices = new Map(versionChoices);
				result.failedDeps.forEach(depName => {
					failedVersionChoices.delete(depName);
				});

				// Revert only the failed ones
				const revertMap = new Map<string, { version: string; type: string }>();
				result.failedDeps.forEach(depName => {
					const original = originalVersions.get(depName);
					if (original) {
						revertMap.set(depName, original);
					}
				});

				if (revertMap.size > 0) {
					await updateDependencyVersions(workspaceCargoToml, revertMap);
					if (memberCargoToml && fs.existsSync(memberCargoToml)) {
						await updateDependencyVersions(memberCargoToml, revertMap);
					}
				}

				const failedNames = Array.from(result.failedDeps).join(', ');
				const successCount = versionChoices.size - result.failedDeps.size;
				vscode.window.showWarningMessage(
					`${successCount} dependencies updated successfully, but ${result.failedDeps.size} failed: ${failedNames}`
				);
			} else {
				cargoTreeProvider.refresh();
				vscode.window.showInformationMessage(`Successfully changed version for ${versionChoices.size} dependencies`);
			}
		} catch (error) {
			vscode.window.showErrorMessage(`Version change failed: ${error}`);
			await updateDependencyVersions(workspaceCargoToml, originalVersions);
			if (memberCargoToml && fs.existsSync(memberCargoToml)) {
				await updateDependencyVersions(memberCargoToml, originalVersions);
			}
		}
	});

	register('cargui.addWorkspaceDepsToMember', async (item: CargoTreeItem) => {
		const workspace = deps.getWorkspaceFolder();
		if (!workspace) {
			return;
		}

		if (!state.selectedWorkspaceMember || state.selectedWorkspaceMember === 'all') {
			vscode.window.showWarningMessage('Please select a workspace member first');
			return;
		}

		if (!item || item.categoryName !== 'workspace') {
			return;
		}

		const checkedDeps = cargoTreeProvider.getCheckedDependencies();
		if (checkedDeps.size === 0) {
			vscode.window.showInformationMessage('No dependencies selected');
			return;
		}

		const members = discoverWorkspaceMembers(workspace.uri.fsPath);
		const member = members.find(m => m.name === state.selectedWorkspaceMember);
		if (!member) {
			vscode.window.showErrorMessage('Selected workspace member not found');
			return;
		}

		const cargoTomlPath = path.join(workspace.uri.fsPath, member.path, 'Cargo.toml');
		if (!fs.existsSync(cargoTomlPath)) {
			vscode.window.showErrorMessage(`Cargo.toml not found at ${cargoTomlPath}`);
			return;
		}

		try {
			const content = fs.readFileSync(cargoTomlPath, 'utf-8');
			const lines = content.split('\n');

			let dependenciesLineIndex = -1;
			let insertAfterIndex = -1;

			for (let i = 0; i < lines.length; i++) {
				const trimmed = lines[i].trim();
				if (trimmed === '[dependencies]') {
					dependenciesLineIndex = i;
					for (let j = i + 1; j < lines.length; j++) {
						const nextTrimmed = lines[j].trim();
						if (nextTrimmed.startsWith('[')) {
							insertAfterIndex = j - 1;
							break;
						}
						if (nextTrimmed && !nextTrimmed.startsWith('#')) {
							insertAfterIndex = j;
						}
					}
					if (insertAfterIndex === -1) {
						insertAfterIndex = lines.length - 1;
					}
					break;
				}
			}

			if (dependenciesLineIndex === -1) {
				for (let i = 0; i < lines.length; i++) {
					if (lines[i].trim().startsWith('[package]')) {
						for (let j = i + 1; j < lines.length; j++) {
							if (lines[j].trim().startsWith('[')) {
								insertAfterIndex = j - 1;
								break;
							}
						}
						if (insertAfterIndex === -1) {
							insertAfterIndex = i + 5;
						}
						lines.splice(insertAfterIndex + 1, 0, '', '[dependencies]');
						dependenciesLineIndex = insertAfterIndex + 1;
						insertAfterIndex = dependenciesLineIndex;
						break;
					}
				}
			}

		const newLines = [...lines];
		let addedCount = 0;
		for (const [depName] of checkedDeps) {
			let alreadyExists = false;
			// Normalize dependency names: Rust treats hyphens and underscores as equivalent
			const normalizedDepName = depName.replace(/_/g, '-');
			for (let i = dependenciesLineIndex + 1; i <= insertAfterIndex; i++) {
				const trimmed = lines[i]?.trim();
				if (trimmed) {
					const normalizedLineName = trimmed.split(/\s*=/)[0].trim().replace(/_/g, '-');
					if (normalizedLineName === normalizedDepName) {
						alreadyExists = true;
						break;
					}
				}
			}

			if (!alreadyExists) {
				newLines.splice(insertAfterIndex + 1 + addedCount, 0, `${depName} = { workspace = true }`);
				addedCount++;
			}
		}			if (addedCount === 0) {
				vscode.window.showInformationMessage('All selected dependencies already exist in member');
				return;
			}

			fs.writeFileSync(cargoTomlPath, newLines.join('\n'), 'utf-8');
			vscode.window.showInformationMessage(`Added ${addedCount} workspace ${addedCount === 1 ? 'dependency' : 'dependencies'} to ${member.name}`);
			cargoTreeProvider.refresh();
		} catch (error) {
			vscode.window.showErrorMessage(`Failed to add dependencies: ${error}`);
		}
	});

	register('cargui.addDependency', async () => {
		await addDependencyWithName();
	});

	register('cargui.addProductionDependency', async () => {
		await addDependencyWithName(undefined, 'production');
	});

	register('cargui.addDevDependency', async () => {
		await addDependencyWithName(undefined, 'dev');
	});

	register('cargui.addBuildDependency', async () => {
		await addDependencyWithName(undefined, 'build');
	});

	register('cargui.addWorkspaceDependency', async () => {
		await addDependencyWithName(undefined, 'workspace');
	});

	register('cargui.showKeybindings', () => {
		vscode.commands.executeCommand('workbench.action.openGlobalKeybindings', 'cargui');
	});

	register('cargui.configureUnregistered', async () => {
		const workspace = deps.getWorkspaceFolder();
		if (!workspace) {
			vscode.window.showErrorMessage('No workspace folder found');
			return;
		}
		await showConfigureUnregisteredUI(workspace);
	});

	register('cargui.rescanUnknownTargets', async () => {
		const workspace = deps.getWorkspaceFolder();
		if (!workspace) {
			vscode.window.showErrorMessage('No workspace folder found');
			return;
		}
		const detection = await runSmartDetection(workspace);
		if (detection.targets.length === 0) {
			vscode.window.showInformationMessage('No unregistered targets found!');
			return;
		}
		await showConfigureUnregisteredUI(workspace);
	});

	register('cargui.rescanUndeclaredFeatures', async () => {
		const workspace = deps.getWorkspaceFolder();
		if (!workspace) {
			vscode.window.showErrorMessage('No workspace folder found');
			return;
		}
		const detection = await runSmartDetection(workspace);
		if (detection.features.length === 0) {
			vscode.window.showInformationMessage('No undeclared features found!');
			return;
		}
		await showConfigureUnregisteredUI(workspace);
	});

	register('cargui.registerAsBinary', async (item: CargoTreeItem) => {
		const workspace = deps.getWorkspaceFolder();
		if (!workspace || !item?.unknownData) {
			return;
		}
		await cargoTreeProvider.registerUnknownTarget(item.unknownData, 'bin');
	});

	register('cargui.registerAsExample', async (item: CargoTreeItem) => {
		const workspace = deps.getWorkspaceFolder();
		if (!workspace || !item?.unknownData) {
			return;
		}
		await cargoTreeProvider.registerUnknownTarget(item.unknownData, 'example');
	});

	register('cargui.registerAsTest', async (item: CargoTreeItem) => {
		const workspace = deps.getWorkspaceFolder();
		if (!workspace || !item?.unknownData) {
			return;
		}
		await cargoTreeProvider.registerUnknownTarget(item.unknownData, 'test');
	});

	register('cargui.registerAsBenchmark', async (item: CargoTreeItem) => {
		const workspace = deps.getWorkspaceFolder();
		if (!workspace || !item?.unknownData) {
			return;
		}
		await cargoTreeProvider.registerUnknownTarget(item.unknownData, 'bench');
	});

	register('cargui.registerAllUnknownTargets', async () => {
		const workspace = deps.getWorkspaceFolder();
		if (!workspace) {
			return;
		}

		const members = discoverWorkspaceMembers(workspace.uri.fsPath);
		const targetMemberPath = state.selectedWorkspaceMember && state.selectedWorkspaceMember !== 'all'
			? members.find(m => m.name === state.selectedWorkspaceMember)?.path
			: undefined;
		
		const unknownTargets = cargoTreeProvider.getUnknownTargets(targetMemberPath);
		
		if (unknownTargets.length === 0) {
			vscode.window.showInformationMessage('No unknown targets to register');
			return;
		}

		// we register each unknown target, prompting user for type
		let successCount = 0;
		for (const target of unknownTargets) {
			try {
				// we prepare quickpick options with inferred type at top
				const typeOptions: vscode.QuickPickItem[] = [
					{ label: 'Binary', description: target.type === 'bin' ? '(inferred)' : '', detail: 'Executable target' },
					{ label: 'Example', description: target.type === 'example' ? '(inferred)' : '', detail: 'Example target' },
					{ label: 'Test', description: target.type === 'test' ? '(inferred)' : '', detail: 'Test target' },
					{ label: 'Benchmark', description: target.type === 'bench' ? '(inferred)' : '', detail: 'Benchmark target' }
				];

				// we sort so inferred type appears first
				typeOptions.sort((a, b) => {
					if (a.description && !b.description) return -1;
					if (!a.description && b.description) return 1;
					return 0;
				});

				const selected = await vscode.window.showQuickPick(typeOptions, {
					placeHolder: `Register "${target.name}" as...`,
					title: `Register ${target.name} [${target.path}] (${successCount + 1}/${unknownTargets.length})`
				});

				if (!selected) {
					// we stop if user cancels
					break;
				}

				const typeMap: Record<string, 'bin' | 'example' | 'test' | 'bench'> = {
					'Binary': 'bin',
					'Example': 'example',
					'Test': 'test',
					'Benchmark': 'bench'
				};

				await cargoTreeProvider.registerUnknownTarget(target, typeMap[selected.label]);
				successCount++;
			} catch (error) {
				console.error(`Failed to register ${target.name}:`, error);
			}
		}

		if (successCount > 0) {
			vscode.window.showInformationMessage(`Registered ${successCount} target(s)`);
		}
	});

	// We open the root workspace Cargo.toml file in the editor when the package header is clicked
	register('cargui.openProjectCargoToml', async (memberName: string | null | undefined) => {
		console.log('[cargUI] openProjectCargoToml called with memberName:', memberName);
		const workspace = deps.getWorkspaceFolder();
		if (!workspace) {
			vscode.window.showErrorMessage('No workspace folder found');
			return;
		}

		let cargoTomlPath: string;
		let resolvedMemberName = memberName;

		// if no member name passed, check if one is selected in the tree provider
		// this handles context menu invocation from the package header
		if (!resolvedMemberName) {
			resolvedMemberName = cargoTreeProvider.getSelectedWorkspaceMember();
			console.log('[cargUI] Resolved memberName from tree provider:', resolvedMemberName);
		}

		// we check if a member name was resolved (from argument or tree provider)
		if (resolvedMemberName && resolvedMemberName !== 'all') {
			// we open the selected member's Cargo.toml
			const members = discoverWorkspaceMembers(workspace.uri.fsPath);
			const member = members.find(m => m.name === resolvedMemberName);
			
			if (member) {
				cargoTomlPath = path.join(workspace.uri.fsPath, member.path, 'Cargo.toml');
				console.log('[cargUI] Opening member Cargo.toml at:', cargoTomlPath);
			} else {
				vscode.window.showErrorMessage(`Workspace member "${resolvedMemberName}" not found`);
				return;
			}
		} else {
			// we open the root workspace Cargo.toml
			cargoTomlPath = path.join(workspace.uri.fsPath, 'Cargo.toml');
			console.log('[cargUI] Opening root Cargo.toml at:', cargoTomlPath);
		}

		if (!fs.existsSync(cargoTomlPath)) {
			vscode.window.showErrorMessage('Cargo.toml not found');
			return;
		}

		try {
			const document = await vscode.workspace.openTextDocument(cargoTomlPath);
			await vscode.window.showTextDocument(document);
		} catch (error) {
			vscode.window.showErrorMessage(`Failed to open Cargo.toml: ${error}`);
		}
	});

	// We open the main.rs or lib.rs file when "View in main target" is clicked
	register('cargui.viewInMainTarget', async (item: CargoTreeItem) => {
		const workspaceFolder = deps.getWorkspaceFolder();
		if (!workspaceFolder) {
			return;
		}

		// we only handle modules and members - for package header without member, bail
		if (!item?.moduleInfo && !item?.workspaceMember) {
			return;
		}

		let filePath: string;
		let moduleInfo = item?.moduleInfo;

		// Determine the target based on context
		let memberPath = '';
		if (item?.workspaceMember) {
			const members = discoverWorkspaceMembers(workspaceFolder.uri.fsPath);
			const member = members.find(m => m.name === item.workspaceMember);
			if (!member) {
				vscode.window.showErrorMessage(`Workspace member "${item.workspaceMember}" not found`);
				return;
			}
			memberPath = member.path;
		}

		const basePath = memberPath 
			? path.join(workspaceFolder.uri.fsPath, memberPath)
			: workspaceFolder.uri.fsPath;

		const mainRsPath = path.join(basePath, 'src/main.rs');
		const libRsPath = path.join(basePath, 'src/lib.rs');

		if (fs.existsSync(mainRsPath)) {
			filePath = mainRsPath;
		} else if (fs.existsSync(libRsPath)) {
			filePath = libRsPath;
		} else {
			vscode.window.showErrorMessage(`No main.rs or lib.rs found in ${memberPath || 'workspace root'}`);
			return;
		}

		try {
			const doc = await vscode.workspace.openTextDocument(filePath);
			const editor = await vscode.window.showTextDocument(doc);

			// we go to module's exposure line if this is a module item
			if (moduleInfo && moduleInfo.name) {
				const content = doc.getText();
				const lines = content.split('\n');
				
				// we search for the module declaration like "pub mod name" or "mod name"
				const moduleName = moduleInfo.name.replace(/\.rs$/, ''); // remove .rs extension if present
				const modulePattern = new RegExp(`^\\s*(pub\\s+)?mod\\s+${moduleName}\\b`);
				
				for (let i = 0; i < lines.length; i++) {
					if (modulePattern.test(lines[i])) {
						// we go to the module declaration line
						const line = i;
						const character = 0;
						editor.selection = new vscode.Selection(
							new vscode.Position(line, character),
							new vscode.Position(line, character)
						);
						editor.revealRange(
							new vscode.Range(
								new vscode.Position(line, character),
								new vscode.Position(line, character)
							),
							vscode.TextEditorRevealType.InCenter
						);
						return;
					}
				}
			}
		} catch (error) {
			vscode.window.showErrorMessage(`Failed to open file: ${error}`);
		}
	});

	// We open the documentation for the crate when "View documentation" is clicked
	register('cargui.viewDocumentation', async (item: CargoTreeItem) => {
		const workspaceFolder = deps.getWorkspaceFolder();
		if (!workspaceFolder) {
			return;
		}

		// if this is a module, we open the module's documentation
		if (item?.moduleInfo) {
			const moduleName = item.moduleInfo.name;
			
			// we need to find which member/package this module belongs to
			// by checking which member has this module in their src directory
			let packageName = '';
			const members = discoverWorkspaceMembers(workspaceFolder.uri.fsPath);
			
			for (const member of members) {
				const memberPath = path.join(workspaceFolder.uri.fsPath, member.path);
				const cargoToml = path.join(memberPath, 'Cargo.toml');
				
				if (fs.existsSync(cargoToml)) {
					const content = fs.readFileSync(cargoToml, 'utf-8');
					const matches = content.match(/\[package\]([\s\S]*?)name\s*=\s*"([^"]+)"/);
					if (matches && matches[2]) {
						// check if this member's src directory contains the module
						const modulePath = path.join(memberPath, 'src', item.moduleInfo.name);
						const modulePathRs = path.join(memberPath, 'src', item.moduleInfo.name + '.rs');
						
						if (fs.existsSync(modulePath) || fs.existsSync(modulePathRs)) {
							packageName = matches[2];
							break;
						}
					}
				}
			}

			if (!packageName) {
				vscode.window.showWarningMessage('Could not determine which package contains this module');
				return;
			}

			// we convert the package name to crate name (hyphens to underscores)
			const crateName = packageName.replace(/-/g, '_');
			
			// we convert the module path to documentation path (src/modules/blue_module.rs -> blue_module)
			const modulePath = moduleName.replace(/\.rs$/, '').replace(/\//g, '/');
			
			// we build local documentation first
			const terminal = vscode.window.createTerminal({
				name: `Cargo Doc - ${packageName}`,
				cwd: workspaceFolder.uri.fsPath
			});
			terminal.show();
			terminal.sendText(`cargo doc -p ${packageName} --no-deps`);

			// we then open the specific module's documentation
			setTimeout(() => {
				const docPath = path.join(
					workspaceFolder.uri.fsPath,
					'target',
					'doc',
					crateName,
					modulePath,
					'index.html'
				);
				
				if (fs.existsSync(docPath)) {
					vscode.env.openExternal(vscode.Uri.file(docPath));
				} else {
					vscode.window.showWarningMessage(`Documentation not found at ${docPath}`);
				}
			}, 3000); // we wait 3 seconds for cargo doc to complete
			return;
		}

		// for package header, we need a workspace member to be selected
		// we get the selected member from the tree provider state, not from item properties
		// (tree items don't reliably preserve custom properties through context menu invocation)
		const selectedMember = cargoTreeProvider.getSelectedWorkspaceMember();
		
		if (!selectedMember || selectedMember === 'all') {
			// we only allow docs command when a specific member is selected
			return;
		}

		// we use the explicitly selected member from the tree provider
		const members = discoverWorkspaceMembers(workspaceFolder.uri.fsPath);
		const selectedMemberInfo = members.find(m => m.name === selectedMember);
		
		if (!selectedMemberInfo) {
			vscode.window.showErrorMessage(`Workspace member "${selectedMember}" not found`);
			return;
		}

		let packageName = '';
		const memberCargoToml = path.join(workspaceFolder.uri.fsPath, selectedMemberInfo.path, 'Cargo.toml');
		if (fs.existsSync(memberCargoToml)) {
			const content = fs.readFileSync(memberCargoToml, 'utf-8');
			const matches = content.match(/\[package\]([\s\S]*?)name\s*=\s*"([^"]+)"/);
			if (matches && matches[2]) {
				packageName = matches[2];
			}
		}

		if (!packageName) {
			vscode.window.showWarningMessage('Could not determine package name for member');
			return;
		}

		// we convert the package name to crate name (hyphens to underscores)
		const crateName = packageName.replace(/-/g, '_');

		// we build local documentation first
		const terminal = vscode.window.createTerminal({
			name: `Cargo Doc - ${packageName}`,
			cwd: workspaceFolder.uri.fsPath
		});
		terminal.show();
		terminal.sendText(`cargo doc -p ${packageName} --no-deps`);

		// we then open the documentation at the correct path (not relying on --open which might open a binary)
		setTimeout(() => {
			const docPath = path.join(
				workspaceFolder.uri.fsPath,
				'target',
				'doc',
				crateName,
				'index.html'
			);
			
			if (fs.existsSync(docPath)) {
				vscode.env.openExternal(vscode.Uri.file(docPath));
			} else {
				vscode.window.showWarningMessage(`Documentation not found at ${docPath}`);
			}
		}, 3000);
	});

	// We open the main.rs or lib.rs file of a workspace member
	register('cargui.viewMemberMainTarget', async (item: CargoTreeItem) => {
		const workspaceFolder = deps.getWorkspaceFolder();
		if (!workspaceFolder || !item?.workspaceMember) {
			return;
		}

		const members = discoverWorkspaceMembers(workspaceFolder.uri.fsPath);
		const member = members.find(m => m.name === item.workspaceMember);
		if (!member) {
			vscode.window.showErrorMessage(`Workspace member "${item.workspaceMember}" not found`);
			return;
		}

		const basePath = path.join(workspaceFolder.uri.fsPath, member.path);
		const mainRsPath = path.join(basePath, 'src/main.rs');
		const libRsPath = path.join(basePath, 'src/lib.rs');

		let filePath: string;
		if (fs.existsSync(mainRsPath)) {
			filePath = mainRsPath;
		} else if (fs.existsSync(libRsPath)) {
			filePath = libRsPath;
		} else {
			vscode.window.showErrorMessage(`No main.rs or lib.rs found in ${member.name}`);
			return;
		}

		try {
			const doc = await vscode.workspace.openTextDocument(filePath);
			await vscode.window.showTextDocument(doc);
		} catch (error) {
			vscode.window.showErrorMessage(`Failed to open file: ${error}`);
		}
	});

	// We open the documentation for a workspace member's crate
	register('cargui.viewMemberDocs', async (item: CargoTreeItem) => {
		const workspaceFolder = deps.getWorkspaceFolder();
		if (!workspaceFolder || !item?.workspaceMember) {
			return;
		}

		// we build local documentation for the workspace member and then open it
		const memberName = item.workspaceMember;
		
		// we build the documentation (no-deps to skip dependencies, making it faster)
		const buildCmd = `cargo doc -p ${memberName} --no-deps`;
		
		// we create a terminal to run the command
		const terminal = vscode.window.createTerminal({
			name: `Cargo Doc - ${memberName}`,
			cwd: workspaceFolder.uri.fsPath
		});
		terminal.show();
		terminal.sendText(buildCmd);

		// we open the documentation in browser after build completes
		// cargo doc generates docs at target/doc/<crate_name>/index.html
		// crate names convert hyphens to underscores, so we need to check both forms
		setTimeout(() => {
			const docDir = path.join(workspaceFolder.uri.fsPath, 'target', 'doc');
			
			// we convert package name (with hyphens) to crate name (with underscores)
			const crateName = memberName.replace(/-/g, '_');
			const docPath = path.join(docDir, crateName, 'index.html');
			
			if (fs.existsSync(docPath)) {
				vscode.env.openExternal(vscode.Uri.file(docPath));
			}
		}, 2500); // we wait 2.5 seconds for cargo doc to complete
	});

	// Helper function to gather codebase context for AI documentation generation
	// This scans .rs files and prioritizes them by relevance to the target file
	const gatherCodebaseContext = async (targetFilePath: string, workspaceRoot: string): Promise<string> => {
		const srcDir = path.join(workspaceRoot, 'src');
		if (!fs.existsSync(srcDir)) {
			return '';
		}

		// Parse use statements from target file to identify direct dependencies
		const targetContent = fs.readFileSync(targetFilePath, 'utf-8');
		const useRegex = /^use\s+(?:crate::)?([^:;{]+)/gm;
		const directDeps = new Set<string>();
		let match;
		while ((match = useRegex.exec(targetContent)) !== null) {
			directDeps.add(match[1].trim());
		}

		// Recursively find all .rs files
		const rsFiles: { path: string; score: number }[] = [];
		const scanDir = (dir: string, depth: number = 0) => {
			if (depth > 5) return;
			const entries = fs.readdirSync(dir, { withFileTypes: true });
			for (const entry of entries) {
				const fullPath = path.join(dir, entry.name);
				if (entry.isDirectory()) {
					if (!['target', 'node_modules', '.git'].includes(entry.name)) {
						scanDir(fullPath, depth + 1);
					}
				} else if (entry.name.endsWith('.rs')) {
					// Calculate relevancy score
					let score = 100; // base score
					const relativePath = path.relative(workspaceRoot, fullPath);
					
					if (fullPath === targetFilePath) {
						score = 1000; // Current file being documented
					} else if (directDeps.has(path.basename(fullPath, '.rs'))) {
						score = 900; // Directly imported
					} else if (path.dirname(fullPath) === path.dirname(targetFilePath)) {
						score = 700; // Same directory
					} else if (entry.name === 'mod.rs') {
						score = 500; // Module definitions
					} else if (entry.name === 'lib.rs' || entry.name === 'main.rs') {
						score = 450; // Entry points
					}
					
					rsFiles.push({ path: fullPath, score });
				}
			}
		};
		scanDir(srcDir);

		// Sort by score (highest first) and build context string
		rsFiles.sort((a, b) => b.score - a.score);
		
		let context = '';
		let totalSize = 0;
		const maxSize = 100 * 1024; // 100KB limit
		
		for (const file of rsFiles) {
			const content = fs.readFileSync(file.path, 'utf-8');
			const relativePath = path.relative(workspaceRoot, file.path);
			const entry = `\n// === ${relativePath} (relevancy: ${file.score}) ===\n${content}\n`;
			
			if (totalSize + entry.length > maxSize) break;
			context += entry;
			totalSize += entry.length;
		}
		
		return context;
	};

	// Helper function to find undocumented elements in a Rust file
	const findUndocumentedElements = (content: string): { type: string; name: string; line: number }[] => {
		const elements: { type: string; name: string; line: number }[] = [];
		const lines = content.split('\n');
		
		// Patterns for documentable elements
		const patterns = [
			{ regex: /^pub\s+fn\s+(\w+)/, type: 'function' },
			{ regex: /^pub\s+async\s+fn\s+(\w+)/, type: 'async function' },
			{ regex: /^fn\s+(\w+)/, type: 'function' },
			{ regex: /^async\s+fn\s+(\w+)/, type: 'async function' },
			{ regex: /^pub\s+struct\s+(\w+)/, type: 'struct' },
			{ regex: /^struct\s+(\w+)/, type: 'struct' },
			{ regex: /^pub\s+enum\s+(\w+)/, type: 'enum' },
			{ regex: /^enum\s+(\w+)/, type: 'enum' },
			{ regex: /^pub\s+trait\s+(\w+)/, type: 'trait' },
			{ regex: /^trait\s+(\w+)/, type: 'trait' },
			{ regex: /^pub\s+type\s+(\w+)/, type: 'type alias' },
			{ regex: /^type\s+(\w+)/, type: 'type alias' },
			{ regex: /^pub\s+const\s+(\w+)/, type: 'constant' },
			{ regex: /^const\s+(\w+)/, type: 'constant' },
			{ regex: /^pub\s+static\s+(\w+)/, type: 'static' },
			{ regex: /^static\s+(\w+)/, type: 'static' },
		];

		for (let i = 0; i < lines.length; i++) {
			const line = lines[i].trim();
			
			for (const pattern of patterns) {
				const match = line.match(pattern.regex);
				if (match) {
					// Check if previous non-empty line is a doc comment
					let hasDoc = false;
					for (let j = i - 1; j >= 0; j--) {
						const prevLine = lines[j].trim();
						if (prevLine === '') continue;
						if (prevLine.startsWith('///') || prevLine.startsWith('//!')) {
							hasDoc = true;
						}
						break;
					}
					
					if (!hasDoc) {
						elements.push({ type: pattern.type, name: match[1], line: i + 1 });
					}
					break;
				}
			}
		}
		
		return elements;
	};

	// Check if file has module header (//!)
	const hasModuleHeader = (content: string): boolean => {
		const lines = content.split('\n');
		for (const line of lines) {
			const trimmed = line.trim();
			if (trimmed === '') continue;
			if (trimmed.startsWith('//!')) return true;
			if (!trimmed.startsWith('//')) return false;
		}
		return false;
	};

	// Improve Module Documentation command - uses AI to generate missing docs
	register('cargui.improveModuleDocumentation', async (item: CargoTreeItem) => {
		const moduleInfo = item.moduleInfo;
		if (!moduleInfo) {
			vscode.window.showErrorMessage('No module information available');
			return;
		}

		const workspaceFolder = deps.getWorkspaceFolder();
		if (!workspaceFolder) {
			vscode.window.showErrorMessage('No workspace folder found');
			return;
		}

		const filePath = moduleInfo.path;
		if (!fs.existsSync(filePath)) {
			vscode.window.showErrorMessage(`File not found: ${filePath}`);
			return;
		}

		await vscode.window.withProgress({
			location: vscode.ProgressLocation.Notification,
			title: 'Improving documentation...',
			cancellable: true
		}, async (progress, token) => {
			try {
				// Select GPT-4o model
				const models = await vscode.lm.selectChatModels({ family: 'gpt-4o' });
				if (models.length === 0) {
					vscode.window.showErrorMessage('No GPT-4o model available. Please ensure GitHub Copilot is installed and signed in.');
					return;
				}
				const model = models[0];

				progress.report({ message: 'Analyzing file...', increment: 10 });

				const content = fs.readFileSync(filePath, 'utf-8');
				const needsHeader = !hasModuleHeader(content);
				const undocumented = findUndocumentedElements(content);

				if (!needsHeader && undocumented.length === 0) {
					vscode.window.showInformationMessage('Module is already fully documented!');
					return;
				}

				progress.report({ message: 'Gathering context...', increment: 10 });

				const context = await gatherCodebaseContext(filePath, workspaceFolder.uri.fsPath);

				progress.report({ message: 'Generating documentation...', increment: 20 });

				// Build prompt for AI
				let prompt = `You are a Rust documentation expert. Generate high-quality documentation comments for the following Rust code.

CODEBASE CONTEXT:
${context}

FILE TO DOCUMENT: ${path.relative(workspaceFolder.uri.fsPath, filePath)}
${content}

DOCUMENTATION NEEDED:
`;
				if (needsHeader) {
					prompt += `- Module header (//!) at the top of the file explaining the module's purpose\n`;
				}
				if (undocumented.length > 0) {
					prompt += `- Documentation (///) for these undocumented elements:\n`;
					for (const elem of undocumented) {
						prompt += `  - ${elem.type} \`${elem.name}\` at line ${elem.line}\n`;
					}
				}

				prompt += `
RULES:
1. Generate ONLY the doc comments, no code changes
2. Use /// for items, //! for module header
3. Be concise but informative
4. Explain what each item does, its parameters, return values, and any important notes
5. Match the style and terminology used in the codebase
6. For the module header, explain the module's role in the overall architecture

OUTPUT FORMAT:
For each element, output:
---
ELEMENT: [type] [name]
LINE: [line number]
DOC:
[doc comment lines, each starting with /// or //!]
---

Start with the module header (if needed), then document elements in order of appearance.`;

				const messages = [vscode.LanguageModelChatMessage.User(prompt)];
				const response = await model.sendRequest(messages, {}, token);

				progress.report({ message: 'Applying documentation...', increment: 30 });

				// Collect the response
				let responseText = '';
				for await (const chunk of response.text) {
					if (token.isCancellationRequested) return;
					responseText += chunk;
				}

				// Parse the response and apply changes
				const lines = content.split('\n');
				const insertions: { line: number; text: string }[] = [];

				// Parse module header if present
				if (needsHeader) {
					const headerMatch = responseText.match(/ELEMENT:\s*module\s*header[\s\S]*?DOC:\n([\s\S]*?)(?=---|$)/i);
					if (headerMatch) {
						const headerLines = headerMatch[1].trim().split('\n')
							.filter(l => l.trim().startsWith('//!'))
							.join('\n');
						if (headerLines) {
							insertions.push({ line: 0, text: headerLines + '\n\n' });
						}
					}
				}

				// Parse element documentation
				const elementRegex = /ELEMENT:\s*(\w+(?:\s+\w+)?)\s+(\w+)\nLINE:\s*(\d+)\nDOC:\n([\s\S]*?)(?=---|$)/gi;
				let elemMatch;
				while ((elemMatch = elementRegex.exec(responseText)) !== null) {
					const lineNum = parseInt(elemMatch[3], 10);
					const docLines = elemMatch[4].trim().split('\n')
						.filter(l => l.trim().startsWith('///'))
						.join('\n');
					if (docLines && lineNum > 0 && lineNum <= lines.length) {
						// Get indentation from the target line
						const targetLine = lines[lineNum - 1];
						const indent = targetLine.match(/^(\s*)/)?.[1] || '';
						const indentedDoc = docLines.split('\n').map(l => indent + l.trim()).join('\n');
						insertions.push({ line: lineNum - 1, text: indentedDoc + '\n' });
					}
				}

				// Apply insertions in reverse order (so line numbers stay valid)
				insertions.sort((a, b) => b.line - a.line);
				
				let newContent = content;
				for (const ins of insertions) {
					const contentLines = newContent.split('\n');
					contentLines.splice(ins.line, 0, ins.text.trimEnd());
					newContent = contentLines.join('\n');
				}

				// Write the file
				fs.writeFileSync(filePath, newContent, 'utf-8');

				progress.report({ message: 'Done!', increment: 30 });

				// Refresh tree view and open file
				cargoTreeProvider.refresh();
				const doc = await vscode.workspace.openTextDocument(filePath);
				await vscode.window.showTextDocument(doc);

				vscode.window.showInformationMessage(`Documentation improved! Added ${insertions.length} doc comments.`);

			} catch (error) {
				if (error instanceof Error && error.message.includes('cancelled')) {
					return;
				}
				console.error('Documentation generation error:', error);
				vscode.window.showErrorMessage(`Failed to generate documentation: ${error instanceof Error ? error.message : 'Unknown error'}`);
			}
		});
	});

	// Improve Target Documentation command - same as module but for targets
	register('cargui.improveTargetDocumentation', async (item: CargoTreeItem) => {
		const target = item.target;
		if (!target) {
			vscode.window.showErrorMessage('No target information available');
			return;
		}

		const workspaceFolder = deps.getWorkspaceFolder();
		if (!workspaceFolder) {
			vscode.window.showErrorMessage('No workspace folder found');
			return;
		}

		// Construct the full file path from the relative target path
		// If the target belongs to a workspace member, include that in the path
		let basePath = workspaceFolder.uri.fsPath;
		if (item.workspaceMember) {
			const members = discoverWorkspaceMembers(workspaceFolder.uri.fsPath);
			const member = members.find(m => m.name === item.workspaceMember);
			if (member) {
				basePath = path.join(workspaceFolder.uri.fsPath, member.path);
			}
		}
		const filePath = path.join(basePath, target.path || '');
		
		if (!target.path || !fs.existsSync(filePath)) {
			vscode.window.showErrorMessage(`File not found: ${filePath}`);
			return;
		}

		await vscode.window.withProgress({
			location: vscode.ProgressLocation.Notification,
			title: 'Improving documentation...',
			cancellable: true
		}, async (progress, token) => {
			try {
				// Select GPT-4o model
				const models = await vscode.lm.selectChatModels({ family: 'gpt-4o' });
				if (models.length === 0) {
					vscode.window.showErrorMessage('No GPT-4o model available. Please ensure GitHub Copilot is installed and signed in.');
					return;
				}
				const model = models[0];

				progress.report({ message: 'Analyzing file...', increment: 10 });

				const content = fs.readFileSync(filePath, 'utf-8');
				const needsHeader = !hasModuleHeader(content);
				const undocumented = findUndocumentedElements(content);

				if (!needsHeader && undocumented.length === 0) {
					vscode.window.showInformationMessage('Target is already fully documented!');
					return;
				}

				progress.report({ message: 'Gathering context...', increment: 10 });

				const context = await gatherCodebaseContext(filePath, workspaceFolder.uri.fsPath);

				progress.report({ message: 'Generating documentation...', increment: 20 });

				// Build prompt for AI
				let prompt = `You are a Rust documentation expert. Generate high-quality documentation comments for the following Rust code.

CODEBASE CONTEXT:
${context}

FILE TO DOCUMENT: ${path.relative(workspaceFolder.uri.fsPath, filePath)}
${content}

DOCUMENTATION NEEDED:
`;
				if (needsHeader) {
					prompt += `- Module/file header (//!) at the top explaining the ${target.type}'s purpose\n`;
				}
				if (undocumented.length > 0) {
					prompt += `- Documentation (///) for these undocumented elements:\n`;
					for (const elem of undocumented) {
						prompt += `  - ${elem.type} \`${elem.name}\` at line ${elem.line}\n`;
					}
				}

				prompt += `
RULES:
1. Generate ONLY the doc comments, no code changes
2. Use /// for items, //! for module/file header
3. Be concise but informative
4. Explain what each item does, its parameters, return values, and any important notes
5. Match the style and terminology used in the codebase
6. For the header, explain this ${target.type}'s role and purpose

OUTPUT FORMAT:
For each element, output:
---
ELEMENT: [type] [name]
LINE: [line number]
DOC:
[doc comment lines, each starting with /// or //!]
---

Start with the header (if needed), then document elements in order of appearance.`;

				const messages = [vscode.LanguageModelChatMessage.User(prompt)];
				const response = await model.sendRequest(messages, {}, token);

				progress.report({ message: 'Applying documentation...', increment: 30 });

				// Collect the response
				let responseText = '';
				for await (const chunk of response.text) {
					if (token.isCancellationRequested) return;
					responseText += chunk;
				}

				// Parse the response and apply changes
				const lines = content.split('\n');
				const insertions: { line: number; text: string }[] = [];

				// Parse module header if present
				if (needsHeader) {
					const headerMatch = responseText.match(/ELEMENT:\s*(?:module\s*)?header[\s\S]*?DOC:\n([\s\S]*?)(?=---|$)/i);
					if (headerMatch) {
						const headerLines = headerMatch[1].trim().split('\n')
							.filter(l => l.trim().startsWith('//!'))
							.join('\n');
						if (headerLines) {
							insertions.push({ line: 0, text: headerLines + '\n\n' });
						}
					}
				}

				// Parse element documentation
				const elementRegex = /ELEMENT:\s*(\w+(?:\s+\w+)?)\s+(\w+)\nLINE:\s*(\d+)\nDOC:\n([\s\S]*?)(?=---|$)/gi;
				let elemMatch;
				while ((elemMatch = elementRegex.exec(responseText)) !== null) {
					const lineNum = parseInt(elemMatch[3], 10);
					const docLines = elemMatch[4].trim().split('\n')
						.filter(l => l.trim().startsWith('///'))
						.join('\n');
					if (docLines && lineNum > 0 && lineNum <= lines.length) {
						// Get indentation from the target line
						const targetLine = lines[lineNum - 1];
						const indent = targetLine.match(/^(\s*)/)?.[1] || '';
						const indentedDoc = docLines.split('\n').map(l => indent + l.trim()).join('\n');
						insertions.push({ line: lineNum - 1, text: indentedDoc + '\n' });
					}
				}

				// Apply insertions in reverse order (so line numbers stay valid)
				insertions.sort((a, b) => b.line - a.line);
				
				let newContent = content;
				for (const ins of insertions) {
					const contentLines = newContent.split('\n');
					contentLines.splice(ins.line, 0, ins.text.trimEnd());
					newContent = contentLines.join('\n');
				}

				// Write the file
				fs.writeFileSync(filePath, newContent, 'utf-8');

				progress.report({ message: 'Done!', increment: 30 });

				// Refresh tree view and open file
				cargoTreeProvider.refresh();
				const doc = await vscode.workspace.openTextDocument(filePath);
				await vscode.window.showTextDocument(doc);

				vscode.window.showInformationMessage(`Documentation improved! Added ${insertions.length} doc comments.`);

			} catch (error) {
				if (error instanceof Error && error.message.includes('cancelled')) {
					return;
				}
				console.error('Documentation generation error:', error);
				vscode.window.showErrorMessage(`Failed to generate documentation: ${error instanceof Error ? error.message : 'Unknown error'}`);
			}
		});
	});

	return disposables;
}
