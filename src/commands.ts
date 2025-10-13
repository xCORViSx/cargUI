import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';

import { CargoTreeDataProvider } from './cargoTreeProvider';
import { CargoTreeItem } from './treeItems';
import {
	ArgumentCategory,
	CustomCommand,
	CustomCommandCategory,
	Snapshot,
	Dependency,
	CargoTarget,
	UnregisteredItem,
	DetectionResult
} from './types';
import {
	discoverWorkspaceMembers,
	discoverCargoTargets,
	discoverCargoFeatures,
	discoverCargoDependencies
} from './cargoDiscovery';
import {
	moveTargetToStandardLocation,
	updateDependencyVersions
} from './cargoToml';
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
	workspaceFolder: vscode.WorkspaceFolder | undefined;
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
		workspaceFolder,
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

	const showCargoQuickPick = async () => {
		const activeWorkspace = vscode.workspace.workspaceFolders?.[0];
		if (!activeWorkspace) {
			vscode.window.showErrorMessage('No workspace folder found');
			return;
		}

		interface CargoQuickPickItem extends vscode.QuickPickItem {
			action: string;
			isTarget?: boolean;
			target?: CargoTarget;
		}

		const items: CargoQuickPickItem[] = [];
		const modeLabel = state.isReleaseMode ? '$(rocket) Release' : '$(bug) Debug';

		items.push({
			label: `$(gear) Toggle Mode (Current: ${state.isReleaseMode ? 'Release' : 'Debug'})`,
			description: 'Switch between Debug and Release builds',
			action: 'toggleMode'
		});

		items.push({ label: '', kind: vscode.QuickPickItemKind.Separator, action: '' } as CargoQuickPickItem);

		const mainCommands: Array<{ label: string; description: string; action: string }> = [
			{ label: `$(tools) Build ${modeLabel}`, description: 'Compile the current package', action: 'build' },
			{ label: `$(play) Run ${modeLabel}`, description: 'Run the main binary', action: 'run' },
			{ label: `$(beaker) Test`, description: 'Run tests', action: 'test' },
			{ label: `$(check) Check`, description: 'Check without building', action: 'check' },
			{ label: `$(clippy) Clippy`, description: 'Run Clippy linter', action: 'clippy' },
			{ label: `$(paintcan) Format`, description: 'Format code with rustfmt', action: 'fmt' },
			{ label: `$(trash) Clean`, description: 'Remove build artifacts', action: 'clean' },
			{ label: `$(book) Doc`, description: 'Build documentation', action: 'doc' }
		];

		mainCommands.forEach(cmd => items.push({ label: cmd.label, description: cmd.description, action: cmd.action }));

		const targets = discoverCargoTargets(activeWorkspace.uri.fsPath);
		if (targets.length > 0) {
			items.push({ label: '', kind: vscode.QuickPickItemKind.Separator, action: '' } as CargoQuickPickItem);

			const appendTargets = (targetsOfType: CargoTarget[], header: string, icon: string) => {
				if (targetsOfType.length === 0) {
					return;
				}
				items.push({ label: header, kind: vscode.QuickPickItemKind.Separator, action: '' } as CargoQuickPickItem);
				targetsOfType.forEach(target => {
					items.push({
						label: `${icon} ${target.name}`,
						description: target.path,
						action: 'runTarget',
						isTarget: true,
						target
					});
				});
			};

			appendTargets(targets.filter(t => t.type === 'bin'), 'Binaries', '$(file-binary)');
			appendTargets(targets.filter(t => t.type === 'example'), 'Examples', '$(note)');
			appendTargets(targets.filter(t => t.type === 'test'), 'Tests', '$(beaker)');
			appendTargets(targets.filter(t => t.type === 'bench'), 'Benchmarks', '$(dashboard)');
		}

		const selection = await vscode.window.showQuickPick(items, {
			placeHolder: 'Select a Cargo command or target',
			matchOnDescription: true
		});

		if (!selection) {
			return;
		}

		if (selection.action === 'toggleMode') {
			vscode.commands.executeCommand('cargui.toggleRelease');
			return;
		}

		if (selection.isTarget && selection.target) {
			runCargoTarget(selection.target.name, selection.target.type, state.isReleaseMode, cargoTreeProvider);
			return;
		}

		if (selection.action) {
			runCargoCommand(selection.action, state.isReleaseMode);
		}
	};

	const addDependencyWithName = async (
		initialCrateName?: string,
		dependencyType?: 'production' | 'dev' | 'build' | 'workspace'
	) => {
		const activeWorkspace = vscode.workspace.workspaceFolders?.[0];
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
		} catch (error) {
			vscode.window.showErrorMessage(`Failed to add dependency: ${error}`);
		}
	};

	// Quick access command palette entry
	register('cargui.open', () => {
		showCargoQuickPick();
	});

	// Direct cargo commands
	register('cargui.build', () => {
		runCargoCommandOnTargets('build', state.isReleaseMode, cargoTreeProvider);
	});

	register('cargui.run', () => {
		runCargoCommandOnTargets('run', state.isReleaseMode, cargoTreeProvider);
	});

	register('cargui.test', () => {
		runCargoCommandOnTargets('test', state.isReleaseMode, cargoTreeProvider);
	});

	register('cargui.check', () => {
		runCargoCommandOnTargets('check', state.isReleaseMode, cargoTreeProvider);
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
		if (!workspaceFolder) {
			return;
		}
		const features = discoverCargoFeatures(workspaceFolder.uri.fsPath);
		const checkedFeatures = cargoTreeProvider.getCheckedFeatures();
		const shouldCheckAll = checkedFeatures.length < features.length;
		features.forEach(feature => cargoTreeProvider.setFeatureChecked(feature, shouldCheckAll));
	});

	register('cargui.toggleAllTargets', () => {
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
		if (!workspaceFolder) {
			return;
		}
		const members = discoverWorkspaceMembers(workspaceFolder.uri.fsPath);
		const checkedMembers = cargoTreeProvider.getCheckedWorkspaceMembers();
		const shouldCheckAll = checkedMembers.length < members.length;
		members.forEach(member => cargoTreeProvider.setWorkspaceMemberChecked(member.name, shouldCheckAll));
	});

	register('cargui.toggleAllDependencies', () => {
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
		if (!workspaceFolder || !item.categoryName) {
			return;
		}
		const members = discoverWorkspaceMembers(workspaceFolder.uri.fsPath);
		const dependencyMemberPath = state.selectedWorkspaceMember && state.selectedWorkspaceMember !== 'all'
			? members.find(m => m.name === state.selectedWorkspaceMember)?.path
			: undefined;
		const dependencies = discoverCargoDependencies(workspaceFolder.uri.fsPath, dependencyMemberPath);

		let deps: Dependency[] = [];
		switch (item.categoryName) {
			case 'production':
				deps = dependencies.production;
				break;
			case 'dev':
				deps = dependencies.dev;
				break;
			case 'build':
				deps = dependencies.build;
				break;
			case 'workspace':
				deps = dependencies.workspace;
				break;
		}

		const checkedDeps = cargoTreeProvider.getCheckedDependencies();
		const checkedInCategory = deps.filter(dep => checkedDeps.has(dep.name)).length;
		const shouldCheckAll = checkedInCategory < deps.length;
		deps.forEach(dep => cargoTreeProvider.setDependencyChecked(dep.name, shouldCheckAll, dep));
	});

	register('cargui.selectWorkspaceMember', (memberName: string) => {
		if (!workspaceFolder) {
			return;
		}

		if (memberName === 'all') {
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
		if (!target || !target.target || !workspaceFolder) {
			return;
		}

		let cargoTomlUri: vscode.Uri;
		if (target.workspaceMember) {
			const members = discoverWorkspaceMembers(workspaceFolder.uri.fsPath);
			const member = members.find(m => m.name === target.workspaceMember);
			if (member) {
				cargoTomlUri = vscode.Uri.file(path.join(member.path, 'Cargo.toml'));
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
		if (!target || !target.target || !workspaceFolder) {
			return;
		}

		let basePath = workspaceFolder.uri.fsPath;
		if (target.workspaceMember) {
			const members = discoverWorkspaceMembers(workspaceFolder.uri.fsPath);
			const member = members.find(m => m.name === target.workspaceMember);
			if (member) {
				basePath = member.path;
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

	register('cargui.moveTargetToStandardLocation', async (clickedTarget: CargoTreeItem, selectedTargets?: CargoTreeItem[]) => {
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
			prompt: 'Enter argument',
			placeHolder: '--verbose, --target x86_64-unknown-linux-gnu, etc.'
		});

		if (input && input.trim()) {
			if (targetCategoryName === undefined) {
				// Add to top-level uncategorized arguments
				const strays = config.get<string[]>('arguments') || [];
				if (strays.includes(input.trim())) {
					vscode.window.showWarningMessage(`Argument '${input.trim()}' already exists`);
					return;
				}
				strays.push(input.trim());
				await config.update('arguments', strays, vscode.ConfigurationTarget.Workspace);
				cargoTreeProvider.refresh();
				vscode.window.showInformationMessage(`Added uncategorized argument: ${input.trim()}`);
			} else {
				const category = argCategories.find(cat => cat.name === targetCategoryName);
				if (!category) {
					vscode.window.showErrorMessage(`Category '${targetCategoryName}' not found`);
					return;
				}

				if (category.arguments.includes(input.trim())) {
					vscode.window.showWarningMessage(`Argument '${input.trim()}' already exists in ${targetCategoryName}`);
					return;
				}

				category.arguments.push(input.trim());
				await config.update('argumentCategories', argCategories, vscode.ConfigurationTarget.Workspace);
				cargoTreeProvider.refresh();
				vscode.window.showInformationMessage(`Added argument '${input.trim()}' to ${targetCategoryName}`);
			}
		}
	});

	register('cargui.editArgument', async (item: CargoTreeItem) => {
		if (!item?.argument) {
			return;
		}

		const input = await vscode.window.showInputBox({
			prompt: 'Edit argument',
			placeHolder: '--verbose, --debug, --port 8080, etc.',
			value: item.argument
		});

		if (input && input.trim()) {
			const config = vscode.workspace.getConfiguration('cargui');
			let found = false;

			// Check for duplicates in both storages
			const strays = config.get<string[]>('arguments') || [];
			const argCategories = config.get<ArgumentCategory[]>('argumentCategories') || [];
			
			if (input.trim() !== item.argument) {
				// Check duplicates in uncategorized
				if (strays.includes(input.trim())) {
					vscode.window.showWarningMessage(`Argument '${input.trim()}' already exists at top level`);
					return;
				}
				// Check duplicates in categories
				for (const category of argCategories) {
					if (category.arguments.includes(input.trim())) {
						vscode.window.showWarningMessage(`Argument '${input.trim()}' already exists in ${category.name}`);
						return;
					}
				}
			}

			// Try to update in uncategorized first
			const strayIndex = strays.indexOf(item.argument);
			if (strayIndex !== -1) {
				strays[strayIndex] = input.trim();
				await config.update('arguments', strays, vscode.ConfigurationTarget.Workspace);
				found = true;
			} else {
				// Try to update in categories
				for (const category of argCategories) {
					const index = category.arguments.indexOf(item.argument);
					if (index !== -1) {
						category.arguments[index] = input.trim();
						await config.update('argumentCategories', argCategories, vscode.ConfigurationTarget.Workspace);
						found = true;
						break;
					}
				}
			}

			if (found) {
				cargoTreeProvider.renameCheckedArgument(item.argument, input.trim());
				cargoTreeProvider.refresh();
				vscode.window.showInformationMessage(`Updated argument: ${item.argument} → ${input.trim()}`);
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

		const workspace = vscode.workspace.workspaceFolders?.[0];
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
			const workspace = vscode.workspace.workspaceFolders?.[0];
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
			const workspace = vscode.workspace.workspaceFolders?.[0];
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
			return;
		}

		const updatedSnapshots = snapshots.map(p => (p.name === item.snapshot ? updatedSnapshot : p));
		await config.update('snapshots', updatedSnapshots, vscode.ConfigurationTarget.Workspace);

		const activeSnapshot = config.get<string>('activeSnapshot');
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

	register('cargui.toggleWatch', async () => {
		const workspace = vscode.workspace.workspaceFolders?.[0];
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
		const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
		if (!workspaceFolder) {
			vscode.window.showErrorMessage('No workspace folder found');
			return;
		}

		const currentEdition = getCurrentEdition(workspaceFolder.uri.fsPath);
		if (!currentEdition) {
			vscode.window.showErrorMessage('Could not read current edition from Cargo.toml');
			return;
		}

		const newEdition = await selectEdition(workspaceFolder.uri.fsPath, currentEdition);
		if (newEdition && newEdition !== currentEdition) {
			const success = await updateEdition(workspaceFolder.uri.fsPath, newEdition);
			if (success) {
				cargoTreeProvider.refresh();
				vscode.window.showInformationMessage(`Rust edition changed to ${newEdition}`);
			} else {
				vscode.window.showErrorMessage('Failed to update edition in Cargo.toml');
			}
		}
	});

	register('cargui.new', async () => {
		const projectType = await vscode.window.showQuickPick(
			['Binary (application)', 'Library'],
			{ placeHolder: 'Select project type' }
		);

		if (!projectType) {
			return;
		}

		const projectName = await vscode.window.showInputBox({
			prompt: 'Enter project name',
			placeHolder: 'my-project',
			validateInput: text => {
				if (!text) {
					return 'Project name cannot be empty';
				}
				if (!/^[a-zA-Z][a-zA-Z0-9_-]*$/.test(text)) {
					return 'Project name must start with a letter and contain only letters, numbers, hyphens, and underscores';
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
			title: 'Select folder where the project will be created'
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
			`Creating ${isLib ? 'library' : 'binary'} project: ${projectName}`,
			'Open Project'
		).then(selection => {
			if (selection === 'Open Project') {
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
		const workspace = vscode.workspace.workspaceFolders?.[0];
		if (!workspace) {
			vscode.window.showErrorMessage('No workspace folder found');
			return;
		}

		const workspaceMembers = discoverWorkspaceMembers(workspace.uri.fsPath);
		const selectedMember = state.selectedWorkspaceMember;

		if (workspaceMembers.length > 1 && (!selectedMember || selectedMember === 'all')) {
			const choice = await vscode.window.showWarningMessage(
				'Multiple workspace members detected. Please select a specific member to format its Cargo.toml, or choose to format all.',
				'Cancel',
				'Format All Members'
			);

			if (choice === 'Format All Members') {
				let successCount = 0;
				let errorCount = 0;

				for (const member of workspaceMembers) {
					const memberCargoTomlPath = path.join(workspace.uri.fsPath, member.path, 'Cargo.toml');
					if (fs.existsSync(memberCargoTomlPath)) {
						const result = await formatCargoTomlFile(memberCargoTomlPath, member.name);
						if (result) {
							successCount++;
						} else {
							errorCount++;
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
			}
			return;
		}

		let cargoTomlPath: string;
		let memberName: string | undefined;

		if (selectedMember && selectedMember !== 'all') {
			const member = workspaceMembers.find(m => m.name === selectedMember);
			if (!member) {
				vscode.window.showErrorMessage(`Member "${selectedMember}" not found`);
				return;
			}
			cargoTomlPath = path.join(workspace.uri.fsPath, member.path, 'Cargo.toml');
			memberName = member.name;
		} else {
			cargoTomlPath = path.join(workspace.uri.fsPath, 'Cargo.toml');
		}

		if (!fs.existsSync(cargoTomlPath)) {
			vscode.window.showErrorMessage(`Cargo.toml not found at ${cargoTomlPath}`);
			return;
		}

		const result = await formatCargoTomlFile(cargoTomlPath, memberName);
		if (result) {
			vscode.window.showInformationMessage(
				`Formatted Cargo.toml` + (memberName ? ` for ${memberName}` : '')
			);
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
		const workspace = vscode.workspace.workspaceFolders?.[0];
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
		} catch (error) {
			vscode.window.showErrorMessage(`Failed to change version for ${dep.name}: ${error}`);
		}
	});

	register('cargui.removeDependency', async (item: CargoTreeItem) => {
		if (!item?.dependency) {
			return;
		}

		const dep = item.dependency;
		const workspace = vscode.workspace.workspaceFolders?.[0];
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
		} catch (error) {
			vscode.window.showErrorMessage(`Failed to remove dependency: ${error}`);
		}
	});

	register('cargui.viewDependencyInCargoToml', async (item: CargoTreeItem) => {
		if (!item?.dependency) {
			return;
		}

		const dep = item.dependency;
		const workspace = vscode.workspace.workspaceFolders?.[0];
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
		const workspace = vscode.workspace.workspaceFolders?.[0];
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

	register('cargui.removeFeature', async (item: CargoTreeItem) => {
		if (!item?.feature) {
			return;
		}

		const featureName = item.feature;
		const workspace = vscode.workspace.workspaceFolders?.[0];
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

	register('cargui.removeEnvironmentVariable', async (item: CargoTreeItem) => {
		if (!item?.envVar) {
			return;
		}

		const envVar = item.envVar;
		const workspace = vscode.workspace.workspaceFolders?.[0];
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

		const workspace = vscode.workspace.workspaceFolders?.[0];
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

		await updateDependencyVersions(workspaceCargoToml, versionChoices);
		if (memberCargoToml && fs.existsSync(memberCargoToml)) {
			await updateDependencyVersions(memberCargoToml, versionChoices);
		}

		let command = 'cargo update';
		versionChoices.forEach((info, depName) => {
			command += ` -p ${depName} --precise ${info.version}`;
		});

		const terminal = vscode.window.createTerminal({
			name: 'Cargo Version Change',
			cwd: workspace.uri.fsPath
		});
		terminal.show();
		terminal.sendText(command);

		try {
			const result = await vscode.window.withProgress({
				location: vscode.ProgressLocation.Notification,
				title: `Changing version for ${versionChoices.size} dependencies...`,
				cancellable: false
			}, () => {
				return new Promise<{ success: boolean; output: string }>(resolve => {
					const { exec } = require('child_process');
					exec(command, { cwd: workspace.uri.fsPath, maxBuffer: 1024 * 1024 * 10 }, (error: any, stdout: string, stderr: string) => {
						const output = `${stdout}${stderr}`;
						const hasError = Boolean(error) ||
							output.includes('error: ') ||
							output.includes('error[') ||
							output.includes('failed to select') ||
							output.includes('could not compile') ||
							output.includes('could not find');
						resolve({ success: !hasError, output });
					});
				});
			});

			if (!result.success) {
				await updateDependencyVersions(workspaceCargoToml, originalVersions);
				if (memberCargoToml && fs.existsSync(memberCargoToml)) {
					await updateDependencyVersions(memberCargoToml, originalVersions);
				}
				vscode.window.showWarningMessage('Dependencies reverted to original versions due to version change failure');
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
		const workspace = vscode.workspace.workspaceFolders?.[0];
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
		const workspace = vscode.workspace.workspaceFolders?.[0];
		if (!workspace) {
			vscode.window.showErrorMessage('No workspace folder found');
			return;
		}
		await showConfigureUnregisteredUI(workspace);
	});

	register('cargui.rescanUnknownTargets', async () => {
		const workspace = vscode.workspace.workspaceFolders?.[0];
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
		const workspace = vscode.workspace.workspaceFolders?.[0];
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
		const workspace = vscode.workspace.workspaceFolders?.[0];
		if (!workspace || !item?.unknownData) {
			return;
		}
		await cargoTreeProvider.registerUnknownTarget(item.unknownData, 'bin');
	});

	register('cargui.registerAsExample', async (item: CargoTreeItem) => {
		const workspace = vscode.workspace.workspaceFolders?.[0];
		if (!workspace || !item?.unknownData) {
			return;
		}
		await cargoTreeProvider.registerUnknownTarget(item.unknownData, 'example');
	});

	register('cargui.registerAsTest', async (item: CargoTreeItem) => {
		const workspace = vscode.workspace.workspaceFolders?.[0];
		if (!workspace || !item?.unknownData) {
			return;
		}
		await cargoTreeProvider.registerUnknownTarget(item.unknownData, 'test');
	});

	register('cargui.registerAsBenchmark', async (item: CargoTreeItem) => {
		const workspace = vscode.workspace.workspaceFolders?.[0];
		if (!workspace || !item?.unknownData) {
			return;
		}
		await cargoTreeProvider.registerUnknownTarget(item.unknownData, 'bench');
	});

	return disposables;
}
