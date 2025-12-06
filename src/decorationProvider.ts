import * as vscode from 'vscode';

/**
 * Provides file decorations (colors, badges) for dependency and target tree items.
 * Used to indicate version status, target colors, and other visual indicators.
 */
export class DependencyDecorationProvider implements vscode.FileDecorationProvider {
    private _onDidChangeFileDecorations = new vscode.EventEmitter<vscode.Uri | vscode.Uri[]>();
    readonly onDidChangeFileDecorations = this._onDidChangeFileDecorations.event;
    
    private latestDependencies = new Set<string>();
    private inheritedDependencies = new Set<string>(); // Dependencies inherited from workspace
    private targetColors = new Map<string, string>(); // Map target/rustup/dep name to color
    
    provideFileDecoration(uri: vscode.Uri): vscode.FileDecoration | undefined {
        if (uri.scheme === 'cargui-workspace-deps') {
            return {
                color: new vscode.ThemeColor('charts.orange'),
                tooltip: 'Workspace Dependencies'
            };
        }
        // Check targetColors for cargui-dep FIRST (path-based deps get blue)
        if (uri.scheme === 'cargui-dep') {
            const color = this.targetColors.get(uri.path);
            if (color) {
                return {
                    color: new vscode.ThemeColor(color),
                    tooltip: 'Path-based dependency'
                };
            }
        }
        if (uri.scheme === 'cargui-dep' && this.inheritedDependencies.has(uri.path)) {
            return {
                color: new vscode.ThemeColor('charts.yellow'),
                tooltip: 'Inherited from workspace'
            };
        }
        if (uri.scheme === 'cargui-dep' && this.latestDependencies.has(uri.path)) {
            return {
                color: new vscode.ThemeColor('charts.green'),
                tooltip: 'At latest version'
            };
        }
        if (uri.scheme === 'cargui-workspace-category') {
            return {
                color: new vscode.ThemeColor('charts.orange')
            };
        }
        if (uri.scheme === 'cargui-workspace-member-header') {
            return {
                color: new vscode.ThemeColor('charts.orange')
            };
        }
        if (uri.scheme === 'cargui-target' || uri.scheme === 'cargui-rustup' || uri.scheme === 'cargui-module' || uri.scheme === 'cargui-undeclared-module' || uri.scheme === 'cargui-feature') {
            const color = this.targetColors.get(uri.path);
            if (color) {
                return {
                    color: new vscode.ThemeColor(color)
                };
            }
        }
        return undefined;
    }
    
    markAsLatest(depName: string) {
        this.latestDependencies.add(depName);
        this._onDidChangeFileDecorations.fire(vscode.Uri.parse(`cargui-dep:${depName}`));
    }
    
    clearLatest(depName: string) {
        this.latestDependencies.delete(depName);
        this._onDidChangeFileDecorations.fire(vscode.Uri.parse(`cargui-dep:${depName}`));
    }

    markAsInherited(depName: string) {
        this.inheritedDependencies.add(depName);
        this._onDidChangeFileDecorations.fire(vscode.Uri.parse(`cargui-dep:${depName}`));
    }
    
    clearInherited(depName: string) {
        this.inheritedDependencies.delete(depName);
        this._onDidChangeFileDecorations.fire(vscode.Uri.parse(`cargui-dep:${depName}`));
    }
    
    setTargetColor(targetName: string, color: string | undefined) {
        if (color) {
            this.targetColors.set(targetName, color);
        } else {
            this.targetColors.delete(targetName);
        }
        // Fire for both target and dep schemes
        this._onDidChangeFileDecorations.fire([
            vscode.Uri.parse(`cargui-target:${targetName}`),
            vscode.Uri.parse(`cargui-dep:${targetName}`)
        ]);
    }
    
    refresh() {
        this.latestDependencies.clear();
        this.inheritedDependencies.clear();
        // Don't clear targetColors - they should persist across tree refreshes
        // Only fire a full refresh if absolutely necessary
        // this._onDidChangeFileDecorations.fire(undefined as any);
    }
}
