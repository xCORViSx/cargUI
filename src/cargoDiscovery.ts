import * as path from 'path';
import * as fs from 'fs';
import * as toml from '@iarna/toml';
import { CargoTarget, CargoManifest, Dependency, WorkspaceMember } from './types';

/**
 * Discovers workspace members from Cargo.toml workspace configuration.
 * Handles both direct path references and glob patterns (e.g., "crates/*").
 */
export function discoverWorkspaceMembers(workspacePath: string): WorkspaceMember[] {
    const members: WorkspaceMember[] = [];
    const cargoTomlPath = path.join(workspacePath, 'Cargo.toml');

    if (!fs.existsSync(cargoTomlPath)) {
        return members;
    }

    try {
        const cargoTomlContent = fs.readFileSync(cargoTomlPath, 'utf-8');
        const manifest = toml.parse(cargoTomlContent) as CargoManifest;

        // Check if this is a workspace
        if (manifest.workspace?.members && Array.isArray(manifest.workspace.members)) {
            // Add root if it has a package
            if (manifest.package?.name) {
                members.push({
                    name: manifest.package.name,
                    path: '.',
                    isRoot: true
                });
            }

            // Process workspace members
            for (const memberPattern of manifest.workspace.members) {
                // Handle glob patterns like "crates/*"
                if (memberPattern.includes('*')) {
                    const baseDir = memberPattern.split('*')[0].replace(/\/$/, '');
                    const basePath = path.join(workspacePath, baseDir);
                    
                    if (fs.existsSync(basePath)) {
                        const entries = fs.readdirSync(basePath, { withFileTypes: true });
                        for (const entry of entries) {
                            if (entry.isDirectory()) {
                                const memberPath = path.join(baseDir, entry.name);
                                const memberCargoToml = path.join(workspacePath, memberPath, 'Cargo.toml');
                                
                                if (fs.existsSync(memberCargoToml)) {
                                    try {
                                        const memberContent = fs.readFileSync(memberCargoToml, 'utf-8');
                                        const memberManifest = toml.parse(memberContent) as CargoManifest;
                                        
                                        if (memberManifest.package?.name) {
                                            members.push({
                                                name: memberManifest.package.name,
                                                path: memberPath,
                                                isRoot: false
                                            });
                                        }
                                    } catch (error) {
                                        console.error(`Error parsing member Cargo.toml at ${memberPath}:`, error);
                                    }
                                }
                            }
                        }
                    }
                } else {
                    // Direct path reference
                    const memberPath = memberPattern;
                    const memberCargoToml = path.join(workspacePath, memberPath, 'Cargo.toml');
                    
                    if (fs.existsSync(memberCargoToml)) {
                        try {
                            const memberContent = fs.readFileSync(memberCargoToml, 'utf-8');
                            const memberManifest = toml.parse(memberContent) as CargoManifest;
                            
                            if (memberManifest.package?.name) {
                                members.push({
                                    name: memberManifest.package.name,
                                    path: memberPath,
                                    isRoot: false
                                });
                            }
                        } catch (error) {
                            console.error(`Error parsing member Cargo.toml at ${memberPath}:`, error);
                        }
                    }
                }
            }
        }
    } catch (error) {
        console.error('Error parsing Cargo.toml for workspace:', error);
    }

    return members;
}

/**
 * Discovers all cargo targets (binaries, examples, tests, benches) from Cargo.toml and filesystem.
 * Combines explicit targets from manifest with auto-discovered targets from standard directories.
 */
export function discoverCargoTargets(workspacePath: string, memberPath?: string): CargoTarget[] {
    const targets: CargoTarget[] = [];
    const basePath = memberPath ? path.join(workspacePath, memberPath) : workspacePath;
    const cargoTomlPath = path.join(basePath, 'Cargo.toml');

    if (!fs.existsSync(cargoTomlPath)) {
        return targets;
    }

    try {
        const cargoTomlContent = fs.readFileSync(cargoTomlPath, 'utf-8');
        const manifest = toml.parse(cargoTomlContent) as CargoManifest;

        // Add explicitly defined library (or default if [lib] section exists)
        if (manifest.lib) {
            const lib = manifest.lib as any;
            const libName = lib.name || manifest.package?.name;
            const libPath = lib.path || 'src/lib.rs';
            
            if (libName) {
                targets.push({
                    name: libName,
                    type: 'lib',
                    path: libPath
                });
            }
        } else {
            // Add default library from src/lib.rs only if no [lib] section exists
            const libPath = path.join(basePath, 'src', 'lib.rs');
            if (manifest.package?.name && fs.existsSync(libPath)) {
                targets.push({
                    name: manifest.package.name,
                    type: 'lib',
                    path: 'src/lib.rs'
                });
            }
        }

        // Add default binary from src/main.rs if it exists
        const mainPath = path.join(basePath, 'src', 'main.rs');
        if (manifest.package?.name && fs.existsSync(mainPath)) {
            // Check if the default binary is already explicitly defined
            const hasExplicitMain = manifest.bin && Array.isArray(manifest.bin) && 
                manifest.bin.some(b => b.name === manifest.package?.name || b.path === 'src/main.rs');
            
            if (!hasExplicitMain) {
                targets.push({
                    name: manifest.package.name,
                    type: 'bin',
                    path: 'src/main.rs'
                });
            }
        }

        // Add explicitly defined binaries
        if (manifest.bin && Array.isArray(manifest.bin)) {
            for (const bin of manifest.bin) {
                if (bin.name) {
                    // If no path specified, infer standard location
                    let binPath = bin.path;
                    if (!binPath) {
                        // Check for directory-based binary first (src/bin/{name}/main.rs)
                        const dirPath = path.join(basePath, 'src', 'bin', bin.name, 'main.rs');
                        if (fs.existsSync(dirPath)) {
                            binPath = `src/bin/${bin.name}/main.rs`;
                        } else {
                            // Default to single-file binary (src/bin/{name}.rs)
                            binPath = `src/bin/${bin.name}.rs`;
                        }
                    }
                    targets.push({
                        name: bin.name,
                        type: 'bin',
                        path: binPath,
                        requiredFeatures: (bin as any)['required-features']
                    });
                }
            }
        }

        // Discover examples from [[example]] sections
        if (manifest.example && Array.isArray(manifest.example)) {
            for (const example of manifest.example) {
                if (example.name) {
                    // If no path specified, infer standard location
                    let examplePath = example.path;
                    if (!examplePath) {
                        // Check for directory-based example first (examples/{name}/main.rs)
                        const dirPath = path.join(basePath, 'examples', example.name, 'main.rs');
                        if (fs.existsSync(dirPath)) {
                            examplePath = `examples/${example.name}/main.rs`;
                        } else {
                            // Default to single-file example (examples/{name}.rs)
                            examplePath = `examples/${example.name}.rs`;
                        }
                    }
                    targets.push({
                        name: example.name,
                        type: 'example',
                        path: examplePath,
                        requiredFeatures: (example as any)['required-features']
                    });
                }
            }
        }

        // Auto-discover examples from examples/ directory
        const examplesDir = path.join(basePath, 'examples');
        if (fs.existsSync(examplesDir)) {
            const files = fs.readdirSync(examplesDir);
            for (const file of files) {
                if (file.endsWith('.rs')) {
                    const exampleName = file.replace('.rs', '').replace(/_/g, '-');
                    const examplePath = `examples/${file}`;
                    // Only add if not already in manifest in ANY section (by name or path)
                    // This prevents files from examples/ that are registered as other types from appearing twice
                    if (!targets.some(t => t.name === exampleName || t.path === examplePath)) {
                        targets.push({
                            name: exampleName,
                            type: 'example',
                            path: examplePath
                        });
                    }
                }
            }
        }

        // Discover tests from [[test]] sections
        if (manifest.test && Array.isArray(manifest.test)) {
            for (const test of manifest.test) {
                if (test.name) {
                    // If no path specified, infer standard location
                    let testPath = test.path;
                    if (!testPath) {
                        // Check for directory-based test first (tests/{name}/main.rs)
                        const dirPath = path.join(basePath, 'tests', test.name, 'main.rs');
                        if (fs.existsSync(dirPath)) {
                            testPath = `tests/${test.name}/main.rs`;
                        } else {
                            // Default to single-file test (tests/{name}.rs)
                            testPath = `tests/${test.name}.rs`;
                        }
                    }
                    targets.push({
                        name: test.name,
                        type: 'test',
                        path: testPath,
                        requiredFeatures: (test as any)['required-features']
                    });
                }
            }
        }

        // Auto-discover tests from tests/ directory
        const testsDir = path.join(basePath, 'tests');
        if (fs.existsSync(testsDir)) {
            const files = fs.readdirSync(testsDir);
            for (const file of files) {
                if (file.endsWith('.rs')) {
                    const testName = file.replace('.rs', '').replace(/_/g, '-');
                    const testPath = `tests/${file}`;
                    // Only add if not already in manifest in ANY section (by name or path)
                    // This prevents files from tests/ that are registered as other types from appearing twice
                    if (!targets.some(t => t.name === testName || t.path === testPath)) {
                        targets.push({
                            name: testName,
                            type: 'test',
                            path: testPath
                        });
                    }
                }
            }
        }

        // Discover benches from [[bench]] sections
        if (manifest.bench && Array.isArray(manifest.bench)) {
            for (const bench of manifest.bench) {
                if (bench.name) {
                    // If no path specified, infer standard location
                    let benchPath = bench.path;
                    if (!benchPath) {
                        // Check for directory-based bench first (benches/{name}/main.rs)
                        const dirPath = path.join(basePath, 'benches', bench.name, 'main.rs');
                        if (fs.existsSync(dirPath)) {
                            benchPath = `benches/${bench.name}/main.rs`;
                        } else {
                            // Default to single-file bench (benches/{name}.rs)
                            benchPath = `benches/${bench.name}.rs`;
                        }
                    }
                    targets.push({
                        name: bench.name,
                        type: 'bench',
                        path: benchPath,
                        requiredFeatures: (bench as any)['required-features']
                    });
                }
            }
        }

        // Auto-discover benches from benches/ directory
        const benchesDir = path.join(basePath, 'benches');
        if (fs.existsSync(benchesDir)) {
            const files = fs.readdirSync(benchesDir);
            for (const file of files) {
                if (file.endsWith('.rs')) {
                    const benchName = file.replace('.rs', '').replace(/_/g, '-');
                    const benchPath = `benches/${file}`;
                    // Only add if not already in manifest in ANY section (by name or path)
                    // This prevents files from benches/ that are registered as other types from appearing twice
                    if (!targets.some(t => t.name === benchName || t.path === benchPath)) {
                        targets.push({
                            name: benchName,
                            type: 'bench',
                            path: benchPath
                        });
                    }
                }
            }
        }
    } catch (error) {
        console.error('Error parsing Cargo.toml:', error);
    }

    return targets;
}

/**
 * Discovers cargo features from the [features] section of Cargo.toml.
 */
export function discoverCargoFeatures(workspacePath: string, memberPath?: string): string[] {
    const features: string[] = [];
    const basePath = memberPath ? path.join(workspacePath, memberPath) : workspacePath;
    const cargoTomlPath = path.join(basePath, 'Cargo.toml');

    if (!fs.existsSync(cargoTomlPath)) {
        return features;
    }

    try {
        const cargoTomlContent = fs.readFileSync(cargoTomlPath, 'utf-8');
        const manifest = toml.parse(cargoTomlContent) as CargoManifest;

        // Extract features from [features] section
        if (manifest.features) {
            features.push(...Object.keys(manifest.features));
        }
    } catch (error) {
        console.error('Error parsing Cargo.toml for features:', error);
    }

    return features;
}

/**
 * Helper function to parse dependency values from Cargo.toml.
 * Handles both simple string versions and complex dependency objects.
 */
function parseDependencyValue(name: string, value: any, type: 'workspace' | 'production' | 'dev' | 'build'): Dependency {
    const dep: Dependency = { name, type };
    
    // Helper function to normalize version strings by removing requirement operators
    const normalizeVersion = (version: string): string => {
        // Remove leading =, ^, ~, >=, <=, <, > operators commonly used in Cargo version requirements
        return version.replace(/^[=^~<>]+/, '').trim();
    };
    
    if (typeof value === 'string') {
        // Simple version string: "1.0.0" or "=1.0.0"
        dep.version = normalizeVersion(value);
    } else if (typeof value === 'object') {
        // Detailed dependency object
        if (value.version) dep.version = normalizeVersion(value.version);
        if (value.features) dep.features = value.features;
        if (value.path) dep.path = value.path;
        if (value.git) dep.git = value.git;
        if (value.branch) dep.branch = value.branch;
        if (value.tag) dep.tag = value.tag;
        if (value.rev) dep.rev = value.rev;
        if (value.optional) dep.optional = value.optional;
    }
    
    return dep;
}

/**
 * Discovers all cargo dependencies (workspace, production, dev, build) from Cargo.toml files.
 * Parses both workspace-level dependencies and member-specific dependencies.
 */
export function discoverCargoDependencies(workspacePath: string, memberPath?: string): {
    workspace: Dependency[];
    production: Dependency[];
    dev: Dependency[];
    build: Dependency[];
} {
    const result = {
        workspace: [] as Dependency[],
        production: [] as Dependency[],
        dev: [] as Dependency[],
        build: [] as Dependency[]
    };
    
    // Parse workspace dependencies from root Cargo.toml
    const rootCargoTomlPath = path.join(workspacePath, 'Cargo.toml');
    if (fs.existsSync(rootCargoTomlPath)) {
        try {
            const rootContent = fs.readFileSync(rootCargoTomlPath, 'utf-8');
            const rootManifest = toml.parse(rootContent) as CargoManifest;
            
            if (rootManifest.workspace?.dependencies) {
                for (const [name, value] of Object.entries(rootManifest.workspace.dependencies)) {
                    result.workspace.push(parseDependencyValue(name, value, 'workspace'));
                }
            }
            
            // If no memberPath provided (single-crate project), parse root dependencies
            if (!memberPath) {
                // Production dependencies
                if (rootManifest.dependencies) {
                    for (const [name, value] of Object.entries(rootManifest.dependencies)) {
                        result.production.push(parseDependencyValue(name, value, 'production'));
                    }
                }
                
                // Dev dependencies
                if (rootManifest['dev-dependencies']) {
                    for (const [name, value] of Object.entries(rootManifest['dev-dependencies'])) {
                        result.dev.push(parseDependencyValue(name, value, 'dev'));
                    }
                }
                
                // Build dependencies
                if (rootManifest['build-dependencies']) {
                    for (const [name, value] of Object.entries(rootManifest['build-dependencies'])) {
                        result.build.push(parseDependencyValue(name, value, 'build'));
                    }
                }
            }
        } catch (error) {
            console.error('Error parsing root Cargo.toml for workspace dependencies:', error);
        }
    }
    
    // Parse member-specific dependencies if memberPath provided
    if (memberPath) {
        const basePath = path.join(workspacePath, memberPath);
        const cargoTomlPath = path.join(basePath, 'Cargo.toml');
        
        if (fs.existsSync(cargoTomlPath)) {
            try {
                const content = fs.readFileSync(cargoTomlPath, 'utf-8');
                const manifest = toml.parse(content) as CargoManifest;
                
                // Production dependencies
                if (manifest.dependencies) {
                    for (const [name, value] of Object.entries(manifest.dependencies)) {
                        result.production.push(parseDependencyValue(name, value, 'production'));
                    }
                }
                
                // Dev dependencies
                if (manifest['dev-dependencies']) {
                    for (const [name, value] of Object.entries(manifest['dev-dependencies'])) {
                        result.dev.push(parseDependencyValue(name, value, 'dev'));
                    }
                }
                
                // Build dependencies
                if (manifest['build-dependencies']) {
                    for (const [name, value] of Object.entries(manifest['build-dependencies'])) {
                        result.build.push(parseDependencyValue(name, value, 'build'));
                    }
                }
            } catch (error) {
                console.error('Error parsing member Cargo.toml for dependencies:', error);
            }
        }
    }
    
    return result;
}
