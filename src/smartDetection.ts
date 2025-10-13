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
                }
            }
        }

        if (manifest.example && Array.isArray(manifest.example)) {
            for (const example of manifest.example) {
                if (example.path) {
                    registeredPaths.add(example.path);
                }
            }
        }

        const examplesDir = path.join(basePath, 'examples');
        if (fs.existsSync(examplesDir)) {
            const files = fs.readdirSync(examplesDir);
            for (const file of files) {
                if (file.endsWith('.rs')) {
                    registeredPaths.add(`examples/${file}`);
                }
            }
        }

        if (manifest.test && Array.isArray(manifest.test)) {
            for (const test of manifest.test) {
                if (test.path) {
                    registeredPaths.add(test.path);
                }
            }
        }

        const testsDir = path.join(basePath, 'tests');
        if (fs.existsSync(testsDir)) {
            const files = fs.readdirSync(testsDir);
            for (const file of files) {
                if (file.endsWith('.rs')) {
                    registeredPaths.add(`tests/${file}`);
                }
            }
        }

        if (manifest.bench && Array.isArray(manifest.bench)) {
            for (const bench of manifest.bench) {
                if (bench.path) {
                    registeredPaths.add(bench.path);
                }
            }
        }

        const benchesDir = path.join(basePath, 'benches');
        if (fs.existsSync(benchesDir)) {
            const files = fs.readdirSync(benchesDir);
            for (const file of files) {
                if (file.endsWith('.rs')) {
                    registeredPaths.add(`benches/${file}`);
                }
            }
        }

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

        const declaredFeatures = new Set<string>();
        if (manifest.features) {
            for (const key of Object.keys(manifest.features)) {
                declaredFeatures.add(key);
            }
        }

        const usedFeatures = new Set<string>();
        const featureRegex = /cfg\s*\(\s*feature\s*=\s*["']([^"']+)["']\s*\)/g;

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
                    try {
                        const content = fs.readFileSync(fullPath, 'utf-8');
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

        scanDirectory(path.join(basePath, 'src'));
        scanDirectory(path.join(basePath, 'tests'));
        scanDirectory(path.join(basePath, 'benches'));
        scanDirectory(path.join(basePath, 'examples'));

        for (const feature of usedFeatures) {
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
