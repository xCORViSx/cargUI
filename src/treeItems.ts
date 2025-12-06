import * as vscode from 'vscode';
import { CargoTarget, Dependency, ModuleInfo, UnregisteredItem, TreeItemContext } from './types';

/**
 * Options for creating a CargoTreeItem.
 * All properties are optional and provide context for specific item types.
 */
export interface CargoTreeItemOptions {
    iconName?: string;
    action?: string;
    target?: CargoTarget;
    feature?: string;
    argument?: string;
    envVar?: string;
    snapshot?: string;
    workspaceMember?: string;
    categoryName?: string;  // For argument subcategories and dependency types
    dependency?: Dependency;  // For dependency items
    dependencyKey?: string;  // Unique key for dependencies (depType:depName) to avoid collisions
    modules?: ModuleInfo[];  // For module member items
    moduleInfo?: ModuleInfo;  // For module items with children
    unknownData?: UnregisteredItem;  // For unknown target items
}

/**
 * Custom TreeItem for representing Cargo package elements in the tree view.
 * Extends VS Code's TreeItem with typed properties for different cargo contexts.
 */
export class CargoTreeItem extends vscode.TreeItem {
    public readonly action?: string;
    public target?: CargoTarget;
    public feature?: string;
    public argument?: string;
    public envVar?: string;
    public snapshot?: string;
    public workspaceMember?: string;
    public categoryName?: string;
    public dependency?: Dependency;
    public dependencyKey?: string; // Unique key: "depType:depName" for dependencies
    public modules?: ModuleInfo[];
    public moduleInfo?: ModuleInfo;
    public unknownData?: UnregisteredItem;
    public isInherited?: boolean;

    constructor(
        public readonly label: string,
        public readonly collapsibleState: vscode.TreeItemCollapsibleState,
        contextValue: string,
        options?: CargoTreeItemOptions
    ) {
        super(label, collapsibleState);
        this.contextValue = contextValue;
        
        // Apply options
        if (options) {
            this.action = options.action;
            this.target = options.target;
            this.feature = options.feature;
            this.argument = options.argument;
            this.envVar = options.envVar;
            this.snapshot = options.snapshot;
            this.workspaceMember = options.workspaceMember;
            this.categoryName = options.categoryName;
            this.dependency = options.dependency;
            this.dependencyKey = options.dependencyKey;
            this.modules = options.modules;
            this.moduleInfo = options.moduleInfo;
            this.unknownData = options.unknownData;
            
            if (options.iconName) {
                // For workspace category, use yellow-colored star
                if (options.iconName === 'star-full' && contextValue === 'dependencyTypeFolder-workspace') {
                    this.iconPath = new vscode.ThemeIcon(options.iconName, new vscode.ThemeColor('charts.yellow'));
                }
                // For inherited member dependencies, use yellow-colored star
                else if (options.iconName === 'star-full' && contextValue === 'dependency' && options.dependency?.inherited) {
                    this.iconPath = new vscode.ThemeIcon(options.iconName, new vscode.ThemeColor('charts.yellow'));
                } else {
                    this.iconPath = new vscode.ThemeIcon(options.iconName);
                }
            }
        }
        
        // Set up commands based on context
        if (this.action && contextValue === TreeItemContext.Command) {
            this.command = {
                command: `cargui.${this.action}`,
                title: label
            };
        }
        if (contextValue === TreeItemContext.Mode) {
            this.command = {
                command: 'cargui.toggleRelease',
                title: 'Toggle Release Mode'
            };
        }
    }
}
