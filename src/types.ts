/**
 * Core type definitions for the cargUI extension
 */

// Context value constants for tree items
export const enum TreeItemContext {
    // Categories
    WorkspaceCategory = 'workspaceCategory',
    ModulesCategory = 'modulesCategory',
    ModulesCategorySingle = 'modulesCategorySingle',
    ModulesCategoryMulti = 'modulesCategoryMulti',
    DependenciesCategory = 'dependenciesCategory',
    SnapshotsCategory = 'snapshotsCategory',
    TargetsCategory = 'targetsCategory',
    FeaturesCategory = 'featuresCategory',
    ArgumentsCategory = 'argumentsCategory',
    EnvVarsCategory = 'envVarsCategory',
    CustomCommandsCategory = 'customCommandsCategory',
    
    // Folders
    TargetTypeFolder = 'targetTypeFolder',
    DependencyTypeFolderWorkspace = 'dependencyTypeFolder-workspace',
    DependencyTypeFolderProduction = 'dependencyTypeFolder-production',
    DependencyTypeFolderDev = 'dependencyTypeFolder-dev',
    DependencyTypeFolderBuild = 'dependencyTypeFolder-build',
    UnknownsFolder = 'unknownsFolder',
    ArgumentSubcategory = 'argumentSubcategory',
    CustomCommandSubcategory = 'customCommandSubcategory',
    WorkspaceMemberFolder = 'workspaceMemberFolder',
    
    // Items
    WorkspaceMember = 'workspaceMember',
    Module = 'module',
    ModuleMember = 'moduleMember',
    Target = 'target',
    UnknownTarget = 'unknownTarget',
    Feature = 'feature',
    Argument = 'argument',
    EnvVar = 'envVar',
    Snapshot = 'snapshot',
    Dependency = 'dependency',
    CustomCommand = 'customCommand',
    
    // Special
    Mode = 'mode',
    WatchMode = 'watchMode',
    RustEdition = 'rustEdition',
    Command = 'command',
    Separator = 'separator',
    Placeholder = 'placeholder'
}

export interface CargoTarget {
    name: string;
    type: 'lib' | 'bin' | 'example' | 'test' | 'bench';
    path?: string;
    requiredFeatures?: string[];
}

export interface CargoManifest {
    package?: {
        name?: string;
    };
    workspace?: {
        members?: string[];
        dependencies?: { [key: string]: any };
    };
    lib?: { name?: string; path?: string };
    bin?: Array<{ name: string; path?: string }>;
    example?: Array<{ name: string; path?: string }>;
    test?: Array<{ name: string; path?: string }>;
    bench?: Array<{ name: string; path?: string }>;
    features?: { [key: string]: string[] };
    dependencies?: { [key: string]: any };
    ['dev-dependencies']?: { [key: string]: any };
    ['build-dependencies']?: { [key: string]: any };
}

export interface Dependency {
    name: string;
    version?: string;
    features?: string[];
    path?: string;
    git?: string;
    branch?: string;
    tag?: string;
    rev?: string;
    optional?: boolean;
    type?: 'workspace' | 'production' | 'dev' | 'build';
    inherited?: boolean; // True if inherited from workspace
}

export interface WorkspaceMember {
    name: string;
    path: string;
    isRoot: boolean;
}

export interface Snapshot {
    name: string;
    mode: 'debug' | 'release';
    targets: string[];
    features: string[];
    arguments: string[];
    envVars: string[];
    workspaceMember?: string;
    checkedWorkspaceMembers?: string[];
}

export interface CustomCommand {
    name: string;
    command: string;
}

export interface CustomCommandCategory {
    name: string;
    commands: CustomCommand[];
}

export interface ArgumentCategory {
    name: string;
    arguments: string[];
}

export interface UnregisteredItem {
    name: string;
    type: 'bin' | 'example' | 'test' | 'bench' | 'feature' | 'unknown';
    path?: string;
    memberName?: string;
    shouldMove?: boolean;
}

export interface DetectionResult {
    targets: UnregisteredItem[];
    features: UnregisteredItem[];
}

export interface ModuleInfo {
    name: string;
    path: string;
    isDirectory: boolean;
    children: ModuleInfo[];
    isDeclared: boolean;
    isPublic?: boolean;          // Whether module is declared with 'pub mod'
    hasDocComment?: boolean;     // Whether module file has doc comments
    hasTests?: boolean;          // Whether module contains #[test] or #[cfg(test)]
}

export interface RustupToolchainInfo {
    channel: 'stable' | 'beta' | 'nightly';
    currentVersion?: string;
    availableVersion?: string;
    hasUpdate: boolean;
}
