import * as vscode from 'vscode';

/**
 * Provides file decorations (colors, badges) for dependency and target tree items.
 * Used to indicate version status, target colors, and other visual indicators.
 */
export class DependencyDecorationProvider implements vscode.FileDecorationProvider {
    private _onDidChangeFileDecorations = new vscode.EventEmitter<vscode.Uri | vscode.Uri[]>();
    readonly onDidChangeFileDecorations = this._onDidChangeFileDecorations.event;
    
    private latestDependencies = new Set<string>();
    private targetColors = new Map<string, string>(); // Map target/rustup name to color
    
    provideFileDecoration(uri: vscode.Uri): vscode.FileDecoration | undefined {
        if (uri.scheme === 'cargui-dep' && this.latestDependencies.has(uri.path)) {
            return {
                color: new vscode.ThemeColor('charts.green'),
                tooltip: 'At latest version'
            };
        }
        if (uri.scheme === 'cargui-target' || uri.scheme === 'cargui-rustup' || uri.scheme === 'cargui-module') {
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
    
    setTargetColor(targetName: string, color: string | undefined) {
        if (color) {
            this.targetColors.set(targetName, color);
        } else {
            this.targetColors.delete(targetName);
        }
        this._onDidChangeFileDecorations.fire(vscode.Uri.parse(`cargui-target:${targetName}`));
    }
    
    refresh() {
        this.latestDependencies.clear();
        this._onDidChangeFileDecorations.fire(undefined as any);
    }
}
