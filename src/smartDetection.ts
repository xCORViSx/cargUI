import * as path from 'path';
import * as fs from 'fs';
import * as toml from '@iarna/toml';
import { CargoManifest, ModuleInfo, UnregisteredItem } from './types';
import { detectModules } from './moduleDetection';

/**
 * Detects unregistered .rs files that are not declared in Cargo.toml
 * but exist in the project structure.
 */
export function detectUnregisteredTargets(workspacePath: string, memberPath?: string): UnregisteredItem[] {
    const unregistered: UnregisteredItem[] = [];
    const basePath = memberPath ? path.join(workspacePath, memberPath) : workspacePath;
    const cargoTomlPath = path.join(basePath, 'Cargo.toml');

    if (!fs.existsSync(cargoTomlPath)) {
        return unregistered;
    }

    try {
        const cargoTomlContent = fs.readFileSync(cargoTomlPath, 'utf-8');
        const manifest = toml.parse(cargoTomlContent) as CargoManifest;

        const registeredPaths = new Set<string>();

        const mainPath = 'src/main.rs';
        registeredPaths.add(mainPath);

        const libPath = 'src/lib.rs';
        registeredPaths.add(libPath);

        if (manifest.bin && Array.isArray(manifest.bin)) {
            for (const bin of manifest.bin) {
                if (bin.path) {
                    registeredPaths.add(bin.path);
                } else if (bin.name) {
                    // When no path is specified, Cargo looks for src/bin/{name}.rs or src/bin/{name}/main.rs
                    // Normalize both hyphen and underscore variants since Rust treats them as equivalent
                    const nameWithHyphen = bin.name.replace(/_/g, '-');
                    const nameWithUnderscore = bin.name.replace(/-/g, '_');
                    registeredPaths.add(`src/bin/${nameWithHyphen}.rs`);
                    registeredPaths.add(`src/bin/${nameWithUnderscore}.rs`);
                    registeredPaths.add(`src/bin/${nameWithHyphen}/main.rs`);
                    registeredPaths.add(`src/bin/${nameWithUnderscore}/main.rs`);
                }
            }
        }

        if (manifest.example && Array.isArray(manifest.example)) {
            for (const example of manifest.example) {
                if (example.path) {
                    registeredPaths.add(example.path);
                } else if (example.name) {
                    // When no path is specified, Cargo looks for:
                    // 1. examples/{name}.rs OR
                    // 2. examples/{name}/main.rs
                    // Normalize both hyphen and underscore variants since Rust treats them as equivalent
                    const nameWithHyphen = example.name.replace(/_/g, '-');
                    const nameWithUnderscore = example.name.replace(/-/g, '_');
                    registeredPaths.add(`examples/${nameWithHyphen}.rs`);
                    registeredPaths.add(`examples/${nameWithUnderscore}.rs`);
                    registeredPaths.add(`examples/${nameWithHyphen}/main.rs`);
                    registeredPaths.add(`examples/${nameWithUnderscore}/main.rs`);
                }
            }
        }

        // Note: We intentionally don't auto-register all files in examples/
        // Only explicitly declared examples in [[example]] sections are registered

        if (manifest.test && Array.isArray(manifest.test)) {
            for (const test of manifest.test) {
                if (test.path) {
                    registeredPaths.add(test.path);
                } else if (test.name) {
                    // When no path is specified, Cargo looks for tests/{name}.rs or tests/{name}/main.rs
                    // Normalize both hyphen and underscore variants since Rust treats them as equivalent
                    const nameWithHyphen = test.name.replace(/_/g, '-');
                    const nameWithUnderscore = test.name.replace(/-/g, '_');
                    registeredPaths.add(`tests/${nameWithHyphen}.rs`);
                    registeredPaths.add(`tests/${nameWithUnderscore}.rs`);
                    registeredPaths.add(`tests/${nameWithHyphen}/main.rs`);
                    registeredPaths.add(`tests/${nameWithUnderscore}/main.rs`);
                }
            }
        }

        // Note: We intentionally don't auto-register all files in tests/
        // Only explicitly declared tests in [[test]] sections are registered

        if (manifest.bench && Array.isArray(manifest.bench)) {
            for (const bench of manifest.bench) {
                if (bench.path) {
                    registeredPaths.add(bench.path);
                } else if (bench.name) {
                    // When no path is specified, Cargo looks for benches/{name}.rs or benches/{name}/main.rs
                    // Normalize both hyphen and underscore variants since Rust treats them as equivalent
                    const nameWithHyphen = bench.name.replace(/_/g, '-');
                    const nameWithUnderscore = bench.name.replace(/-/g, '_');
                    registeredPaths.add(`benches/${nameWithHyphen}.rs`);
                    registeredPaths.add(`benches/${nameWithUnderscore}.rs`);
                    registeredPaths.add(`benches/${nameWithHyphen}/main.rs`);
                    registeredPaths.add(`benches/${nameWithUnderscore}/main.rs`);
                }
            }
        }

        // Note: We intentionally don't auto-register all files in benches/
        // Only explicitly declared benchmarks in [[bench]] sections are registered

        function scanSrcDirectory(dirPath: string, relativePath: string = 'src') {
            if (!fs.existsSync(dirPath)) return;

            const items = fs.readdirSync(dirPath, { withFileTypes: true });
            for (const item of items) {
                const fullPath = path.join(dirPath, item.name);
                const relPath = `${relativePath}/${item.name}`;

                if (item.isDirectory()) {
                    if (!['target', 'node_modules', '.git'].includes(item.name)) {
                        scanSrcDirectory(fullPath, relPath);
                    }
                } else if (item.name.endsWith('.rs')) {
                    if (!registeredPaths.has(relPath)) {
                        const fileName = item.name.replace('.rs', '').replace(/_/g, '-');
                        unregistered.push({
                            name: fileName,
                            type: 'unknown',
                            path: relPath,
                            memberName: manifest.package?.name
                        });
                    }
                }
            }
        }

        const srcDir = path.join(basePath, 'src');
        scanSrcDirectory(srcDir);

        // Scan examples/ directory for undeclared examples
        const examplesDir = path.join(basePath, 'examples');
        if (fs.existsSync(examplesDir)) {
            const items = fs.readdirSync(examplesDir, { withFileTypes: true });
            for (const item of items) {
                if (item.isFile() && item.name.endsWith('.rs')) {
                    const relPath = `examples/${item.name}`;
                    if (!registeredPaths.has(relPath)) {
                        const fileName = item.name.replace('.rs', '').replace(/_/g, '-');
                        unregistered.push({
                            name: fileName,
                            type: 'example',
                            path: relPath,
                            memberName: manifest.package?.name
                        });
                    }
                } else if (item.isDirectory()) {
                    const mainPath = path.join(examplesDir, item.name, 'main.rs');
                    const relPath = `examples/${item.name}/main.rs`;
                    if (fs.existsSync(mainPath) && !registeredPaths.has(relPath)) {
                        unregistered.push({
                            name: item.name,
                            type: 'example',
                            path: relPath,
                            memberName: manifest.package?.name
                        });
                    }
                }
            }
        }

        // Scan tests/ directory for undeclared tests
        const testsDir = path.join(basePath, 'tests');
        if (fs.existsSync(testsDir)) {
            const items = fs.readdirSync(testsDir, { withFileTypes: true });
            for (const item of items) {
                if (item.isFile() && item.name.endsWith('.rs')) {
                    const relPath = `tests/${item.name}`;
                    if (!registeredPaths.has(relPath)) {
                        const fileName = item.name.replace('.rs', '').replace(/_/g, '-');
                        unregistered.push({
                            name: fileName,
                            type: 'test',
                            path: relPath,
                            memberName: manifest.package?.name
                        });
                    }
                } else if (item.isDirectory()) {
                    const mainPath = path.join(testsDir, item.name, 'main.rs');
                    const relPath = `tests/${item.name}/main.rs`;
                    if (fs.existsSync(mainPath) && !registeredPaths.has(relPath)) {
                        unregistered.push({
                            name: item.name,
                            type: 'test',
                            path: relPath,
                            memberName: manifest.package?.name
                        });
                    }
                }
            }
        }

        // Scan benches/ directory for undeclared benchmarks
        const benchesDir = path.join(basePath, 'benches');
        if (fs.existsSync(benchesDir)) {
            const items = fs.readdirSync(benchesDir, { withFileTypes: true });
            for (const item of items) {
                if (item.isFile() && item.name.endsWith('.rs')) {
                    const relPath = `benches/${item.name}`;
                    if (!registeredPaths.has(relPath)) {
                        const fileName = item.name.replace('.rs', '').replace(/_/g, '-');
                        unregistered.push({
                            name: fileName,
                            type: 'bench',
                            path: relPath,
                            memberName: manifest.package?.name
                        });
                    }
                } else if (item.isDirectory()) {
                    const mainPath = path.join(benchesDir, item.name, 'main.rs');
                    const relPath = `benches/${item.name}/main.rs`;
                    if (fs.existsSync(mainPath) && !registeredPaths.has(relPath)) {
                        unregistered.push({
                            name: item.name,
                            type: 'bench',
                            path: relPath,
                            memberName: manifest.package?.name
                        });
                    }
                }
            }
        }

        const referencedFiles = findReferencedModules(basePath);
        const moduleFiles = getAllModuleFiles(basePath);

        const filteredUnregistered = unregistered.filter(item => {
            if (!item.path) return true;

            if (moduleFiles.has(item.path)) {
                return false;
            }

            const modulePath = item.path
                .replace(/^src\//, '')
                .replace(/\.rs$/, '')
                .replace(/\//g, '::');

            const fileName = path.basename(item.path, '.rs');

            if (fileName === 'mod') {
                return false;
            }

            return !referencedFiles.has(modulePath) && !referencedFiles.has(fileName);
        });

        return filteredUnregistered;
    } catch (error) {
        console.error('Error detecting unregistered targets:', error);
    }

    return unregistered;
}

/**
 * Gets all files that are part of the module system (not targets).
 */
export function getAllModuleFiles(basePath: string): Set<string> {
    const moduleFiles = new Set<string>();
    const srcPath = path.join(basePath, 'src');

    if (!fs.existsSync(srcPath)) {
        return moduleFiles;
    }

    const modules = detectModules(srcPath);

    function collectModulePaths(mods: ModuleInfo[], _basePath: string = 'src') {
        for (const mod of mods) {
            const relativePath = mod.path.replace(srcPath, 'src').replace(/\\/g, '/');
            moduleFiles.add(relativePath);

            if (mod.children.length > 0) {
                collectModulePaths(mod.children, _basePath);
            }
        }
    }

    collectModulePaths(modules);

    return moduleFiles;
}

/**
 * Finds all module references in the codebase by scanning for
 * mod declarations, use statements, and include! macros.
 */
export function findReferencedModules(basePath: string): Set<string> {
    const referenced = new Set<string>();

    const modPattern = /^\s*mod\s+(\w+)\s*;/gm;
    const usePattern = /use\s+(?:crate::)?([a-zA-Z_][\w:]*)(?:::\{[^}]*\})?/g;
    const includePattern = /include!\s*\(\s*["']([^"']+)["']\s*\)/g;

    function scanFile(filePath: string) {
        if (!fs.existsSync(filePath) || !filePath.endsWith('.rs')) return;

        try {
            const content = fs.readFileSync(filePath, 'utf-8');

            let match;
            while ((match = modPattern.exec(content)) !== null) {
                referenced.add(match[1]);
            }

            while ((match = usePattern.exec(content)) !== null) {
                const parts = match[1].split('::');
                for (let i = 0; i < parts.length; i++) {
                    referenced.add(parts.slice(0, i + 1).join('::'));
                    if (i > 0) {
                        referenced.add(parts[i]);
                    }
                }
            }

            while ((match = includePattern.exec(content)) !== null) {
                const includePath = match[1].replace(/\.rs$/, '');
                referenced.add(includePath);
            }
        } catch (err) {
            // Ignore read errors
        }
    }

    function scanDirectory(dirPath: string) {
        if (!fs.existsSync(dirPath)) return;

        const items = fs.readdirSync(dirPath, { withFileTypes: true });
        for (const item of items) {
            const fullPath = path.join(dirPath, item.name);

            if (item.isDirectory()) {
                if (item.name !== 'target') {
                    scanDirectory(fullPath);
                }
            } else if (item.name.endsWith('.rs')) {
                scanFile(fullPath);
            }
        }
    }

    scanDirectory(path.join(basePath, 'src'));
    scanDirectory(path.join(basePath, 'tests'));
    scanDirectory(path.join(basePath, 'benches'));
    scanDirectory(path.join(basePath, 'examples'));

    return referenced;
}

/**
 * Detects feature flags used in code but not declared in Cargo.toml.
 */
export function detectUndeclaredFeatures(workspacePath: string, memberPath?: string): UnregisteredItem[] {
    const undeclared: UnregisteredItem[] = [];
    const basePath = memberPath ? path.join(workspacePath, memberPath) : workspacePath;
    const cargoTomlPath = path.join(basePath, 'Cargo.toml');

    if (!fs.existsSync(cargoTomlPath)) {
        return undeclared;
    }

    try {
        const cargoTomlContent = fs.readFileSync(cargoTomlPath, 'utf-8');
        const manifest = toml.parse(cargoTomlContent) as CargoManifest;

        // Normalize feature names to handle hyphen/underscore equivalence
        // Store both variants for each declared feature
        const declaredFeatures = new Set<string>();
        if (manifest.features) {
            for (const key of Object.keys(manifest.features)) {
                declaredFeatures.add(key);
                // Add normalized variant (hyphens to underscores and vice versa)
                declaredFeatures.add(key.replace(/-/g, '_'));
                declaredFeatures.add(key.replace(/_/g, '-'));
            }
        }

        const usedFeatures = new Set<string>();
        // we match feature flags in various forms by looking for the pattern feature = "..."
        // this catches cfg(feature = "..."), all(feature = "..."), any(feature = "..."), etc.
        const featureRegex = /feature\s*=\s*["']([^"']+)["']/g;

        function scanDirectory(dirPath: string) {
            if (!fs.existsSync(dirPath)) return;

            const items = fs.readdirSync(dirPath, { withFileTypes: true });
            for (const item of items) {
                const fullPath = path.join(dirPath, item.name);

                if (item.isDirectory()) {
                    // Skip target, node_modules, and any workspace member subdirectories (like crates/)
                    if (item.name !== 'target' && item.name !== 'node_modules' && item.name !== 'crates') {
                        scanDirectory(fullPath);
                    }
                } else if (item.name.endsWith('.rs')) {
                    try {
                        const content = fs.readFileSync(fullPath, 'utf-8');
                        // we reset the regex state before each file since /g maintains state between exec() calls
                        featureRegex.lastIndex = 0;
                        let match;
                        while ((match = featureRegex.exec(content)) !== null) {
                            usedFeatures.add(match[1]);
                        }
                    } catch (err) {
                        // Ignore read errors
                    }
                }
            }
        }

        // Only scan this member's code directories, not other workspace members
        scanDirectory(path.join(basePath, 'src'));
        scanDirectory(path.join(basePath, 'tests'));
        scanDirectory(path.join(basePath, 'benches'));
        scanDirectory(path.join(basePath, 'examples'));

        for (const feature of usedFeatures) {
            // Check if feature is declared (accounting for hyphen/underscore equivalence)
            if (!declaredFeatures.has(feature)) {
                undeclared.push({
                    name: feature,
                    type: 'feature',
                    memberName: manifest.package?.name
                });
            }
        }
    } catch (error) {
        console.error('Error detecting undeclared features:', error);
    }

    return undeclared;
}
