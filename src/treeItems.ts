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
    modules?: ModuleInfo[];  // For module member items
    moduleInfo?: ModuleInfo;  // For module items with children
    unknownData?: UnregisteredItem;  // For unknown target items
}

/**
 * Custom TreeItem for representing Cargo project elements in the tree view.
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
    public modules?: ModuleInfo[];
    public moduleInfo?: ModuleInfo;
    public unknownData?: UnregisteredItem;

    constructor(
        public readonly label: string,
        public readonly collapsibleState: vscode.TreeItemCollapsibleState,
        public readonly contextValue: string,
        options?: CargoTreeItemOptions
    ) {
        super(label, collapsibleState);
        
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
            this.modules = options.modules;
            this.moduleInfo = options.moduleInfo;
            this.unknownData = options.unknownData;
            
            if (options.iconName) {
                this.iconPath = new vscode.ThemeIcon(options.iconName);
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
