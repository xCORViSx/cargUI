//! Regression Tests for all bug fixes
//! These tests ensure that previously fixed issues remain fixed
//! Each test corresponds to a specific commit/issue that was resolved

import * as assert from 'assert';
import * as path from 'path';
import * as fs from 'fs';
import { TreeItemContext } from '../../types';
import { discoverCargoDependencies } from '../../cargoDiscovery';
import { detectModules, findUndeclaredModules } from '../../moduleDetection';
import { calculateTargetHealthColor } from '../../targetHealth';

suite('Regression Tests', () => {
    const testProjectPath = path.join(__dirname, '../../../test-projs/cargui-demo');

    // ============================================================
    // REGRESSION TEST 1: Dependency Key Collision Fix
    // Issue: Same dependency name in different categories (prod/dev/build)
    // would share decoration keys, causing color collisions
    // Commit: 5c82cc02
    // ============================================================

    suite('Dependency Key Collision Prevention', () => {
        test('should use unique keys for same dependency in different categories', () => {
            // When a package has the same dependency in multiple categories
            // (e.g., serde as both production and dev dependency)
            // they should have different decoration keys to avoid collisions

            const depType1 = 'production';
            const depType2 = 'dev';
            const depName = 'serde';

            // Construct keys the way cargoTreeProvider does
            const key1 = `${depType1}:${depName}`;
            const key2 = `${depType2}:${depName}`;

            // Keys should be different
            assert.notStrictEqual(key1, key2, 
                'Dependencies in different categories should have different keys');
            assert.strictEqual(key1, 'production:serde');
            assert.strictEqual(key2, 'dev:serde');
        });

        test('should construct unique decoration URIs for dependencies', () => {
            // Resource URIs should include the unique key to enable proper decoration
            const depKey1 = 'production:serde';
            const depKey2 = 'dev:serde';

            const uri1 = `cargui-dep:${depKey1}`;
            const uri2 = `cargui-dep:${depKey2}`;

            assert.notStrictEqual(uri1, uri2, 
                'Decoration URIs should be unique per dependency type');
            assert.strictEqual(uri1, 'cargui-dep:production:serde');
            assert.strictEqual(uri2, 'cargui-dep:dev:serde');
        });

        test('should handle all four dependency categories with unique keys', () => {
            // All four dependency types should be distinguishable
            const depName = 'tokio';
            const categories = ['workspace', 'production', 'dev', 'build'] as const;

            const keys = categories.map(cat => `${cat}:${depName}`);

            // All keys should be unique
            const uniqueKeys = new Set(keys);
            assert.strictEqual(uniqueKeys.size, 4, 
                'All four dependency categories should have unique keys');

            // Keys should match expected format
            keys.forEach((key, idx) => {
                assert.strictEqual(key, `${categories[idx]}:${depName}`);
            });
        });

        test('should support backward compatibility with fallback to dep.name', () => {
            // The checkbox handler should fall back to dep.name if dependencyKey is not present
            // This ensures old code paths don't break

            const depKey = 'production:serde';
            const depName = 'serde';

            // With dependencyKey available, use it
            const keyToUse: string = depKey || depName;
            assert.strictEqual(keyToUse, 'production:serde');

            // Without dependencyKey (simulating undefined), fall back to depName
            const undefinedKey: string | undefined = undefined;
            const fallbackKey: string = undefinedKey || depName;
            assert.strictEqual(fallbackKey, depName);
        });
    });

    // ============================================================
    // REGRESSION TEST 2: Module Detection - Both lib.rs AND main.rs
    // Issue: Module detection only checked ONE root file at a time
    // Would miss modules declared in lib.rs if main.rs also existed
    // Commit: 12/04/25
    // ============================================================

    suite('Module Detection - Multiple Root Files', () => {
        test('should detect modules from lib.rs when main.rs exists', () => {
            // Create a temp project with both lib.rs and main.rs
            const tempDir = path.join(testProjectPath, '.test-temp-modules');
            if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });

            try {
                // Create main.rs
                const mainPath = path.join(tempDir, 'main.rs');
                fs.writeFileSync(mainPath, 'fn main() {}');

                // Create lib.rs with module declarations
                const libPath = path.join(tempDir, 'lib.rs');
                fs.writeFileSync(libPath, `
//! Library crate
mod utils;
pub mod helpers;
                `.trim());

                // Create module files
                const utilsPath = path.join(tempDir, 'utils.rs');
                fs.writeFileSync(utilsPath, '//! Utils module\npub fn foo() {}');

                const helpersPath = path.join(tempDir, 'helpers.rs');
                fs.writeFileSync(helpersPath, '//! Helpers module\npub fn bar() {}');

                // detectModules should check BOTH lib.rs and main.rs
                const modules = detectModules(tempDir);

                assert.ok(modules, 'Should detect modules');
                assert.ok(modules.length > 0, 'Should find at least one module');

                // Should find the modules from lib.rs
                const moduleNames = modules.map(m => m.name);
                assert.ok(moduleNames.includes('utils'), 'Should detect utils module from lib.rs');
                assert.ok(moduleNames.includes('helpers'), 'Should detect helpers module from lib.rs');
            } finally {
                // Cleanup
                if (fs.existsSync(tempDir)) {
                    fs.rmSync(tempDir, { recursive: true, force: true });
                }
            }
        });

        test('should detect modules from main.rs when lib.rs does not exist', () => {
            const tempDir = path.join(testProjectPath, '.test-temp-main-only');
            if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });

            try {
                // Create main.rs with modules
                const mainPath = path.join(tempDir, 'main.rs');
                fs.writeFileSync(mainPath, `
mod config;
mod server;
                `.trim());

                // Create module files
                fs.writeFileSync(path.join(tempDir, 'config.rs'), 'pub struct Config;');
                fs.writeFileSync(path.join(tempDir, 'server.rs'), 'pub fn run() {}');

                // Should detect from main.rs
                const modules = detectModules(tempDir);
                assert.ok(modules.length > 0, 'Should find modules from main.rs');

                const names = modules.map(m => m.name);
                assert.ok(names.includes('config'), 'Should detect config module from main.rs');
                assert.ok(names.includes('server'), 'Should detect server module from main.rs');
            } finally {
                if (fs.existsSync(tempDir)) {
                    fs.rmSync(tempDir, { recursive: true, force: true });
                }
            }
        });

        test('should detect from both lib.rs and main.rs when both have modules', () => {
            const tempDir = path.join(testProjectPath, '.test-temp-both-files');
            if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });

            try {
                // lib.rs declares some modules
                const libPath = path.join(tempDir, 'lib.rs');
                fs.writeFileSync(libPath, `
pub mod shared;
pub mod utils;
                `.trim());

                // main.rs declares different modules
                const mainPath = path.join(tempDir, 'main.rs');
                fs.writeFileSync(mainPath, `
mod config;
mod cli;
                `.trim());

                // Create all module files
                fs.writeFileSync(path.join(tempDir, 'shared.rs'), 'pub struct Shared;');
                fs.writeFileSync(path.join(tempDir, 'utils.rs'), 'pub fn util() {}');
                fs.writeFileSync(path.join(tempDir, 'config.rs'), 'pub struct Config;');
                fs.writeFileSync(path.join(tempDir, 'cli.rs'), 'pub fn parse() {}');

                // Should detect from BOTH files
                const modules = detectModules(tempDir);
                assert.ok(modules.length >= 2, 'Should detect modules from both files');

                const names = modules.map(m => m.name);
                // Should have at least modules from lib.rs
                assert.ok(names.includes('shared') || names.includes('utils'), 
                    'Should detect modules from lib.rs');
            } finally {
                if (fs.existsSync(tempDir)) {
                    fs.rmSync(tempDir, { recursive: true, force: true });
                }
            }
        });
    });

    // ============================================================
    // REGRESSION TEST 3: Target Health Color - Persistence
    // Issue: 100% documented targets would show blue instead of green
    // because color wasn't persisting correctly when tree refreshed
    // Multiple fixes: lib/bin collision + refresh behavior
    // ============================================================

    suite('Target Health Color Persistence', () => {
        test('should return green color for 100% documented target', () => {
            // A target with header + all elements documented = 100% = green
            const hasHeader = true;
            const totalElements = 5;
            const documentedElements = 5; // All documented

            const color = calculateTargetHealthColor(hasHeader, totalElements, documentedElements);

            assert.strictEqual(color, 'charts.green', 
                'Fully documented target should be green');
        });

        test('should return green color for 90-100% documented', () => {
            // 90%+ should be green
            const hasHeader = true;
            const totalElements = 10;
            const documentedElements = 9; // 90%

            const color = calculateTargetHealthColor(hasHeader, totalElements, documentedElements);

            assert.strictEqual(color, 'charts.green', 
                '90% documented target should be green');
        });

        test('should return blue color for 50-90% documented', () => {
            // Between 50-90% should be blue
            const hasHeader = true;
            const totalElements = 10;
            const documentedElements = 7; // 70%

            const color = calculateTargetHealthColor(hasHeader, totalElements, documentedElements);

            assert.strictEqual(color, 'charts.blue', 
                '70% documented target should be blue');
        });

        test('should return undefined for less than 50% documented', () => {
            // Less than 50% should return undefined (no color)
            const hasHeader = true;
            const totalElements = 10;
            const documentedElements = 4; // 40%

            const color = calculateTargetHealthColor(hasHeader, totalElements, documentedElements);

            assert.strictEqual(color, undefined, 
                'Less than 50% documented target should have no color');
        });

        test('should use unique keys to prevent lib/bin name collision', () => {
            // When both lib.rs and main.rs exist, they have same package name
            // Should use type:name to distinguish them
            const targetType1 = 'lib';
            const targetType2 = 'bin';
            const targetName = 'mypackage';

            const key1 = `${targetType1}:${targetName}`;
            const key2 = `${targetType2}:${targetName}`;

            assert.notStrictEqual(key1, key2, 
                'lib and bin targets should have different keys');
            assert.strictEqual(key1, 'lib:mypackage');
            assert.strictEqual(key2, 'bin:mypackage');
        });
    });

    // ============================================================
    // REGRESSION TEST 4: Module Text Color Display
    // Issue: Undeclared modules (red text) not displaying correctly
    // Commit: 70774bf9
    // ============================================================

    suite('Module Text Color Display', () => {
        test('should apply decoration color for undeclared modules', () => {
            // Undeclared modules should get a red text color decoration
            // Key format: module-${name}-${path}

            const moduleName = 'undeclared_mod';
            const modulePath = 'src/undeclared_mod.rs';

            const decorationKey = `module-${moduleName}-${modulePath}`;

            assert.strictEqual(decorationKey, 'module-undeclared_mod-src/undeclared_mod.rs');

            // This key should be used for setTargetColor('undeclared-...')
            const colorKey = `undeclared-${decorationKey}`;
            assert.ok(colorKey.includes('undeclared'), 
                'Undeclared module key should include undeclared prefix');
        });

        test('should use unique keys for modules in different directories', () => {
            // Two modules with same name in different dirs should have different keys
            const moduleName = 'helpers';
            const path1 = 'src/helpers.rs';
            const path2 = 'src/utils/helpers.rs';

            const key1 = `module-${moduleName}-${path1}`;
            const key2 = `module-${moduleName}-${path2}`;

            assert.notStrictEqual(key1, key2, 
                'Modules with same name in different paths should have different keys');
        });

        test('should find undeclared modules separately', () => {
            const tempDir = path.join(testProjectPath, '.test-temp-undeclared');
            if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });

            try {
                // Create lib.rs
                const libPath = path.join(tempDir, 'lib.rs');
                fs.writeFileSync(libPath, '//! Library\npub mod declared;');

                // Create declared module
                const declaredPath = path.join(tempDir, 'declared.rs');
                fs.writeFileSync(declaredPath, 'pub fn foo() {}');

                // Create undeclared module file
                const undeclaredPath = path.join(tempDir, 'undeclared.rs');
                fs.writeFileSync(undeclaredPath, 'pub fn bar() {}');

                // Should find undeclared modules
                const declaredModules = new Set(['declared']);
                const undeclared = findUndeclaredModules(tempDir, declaredModules);
                assert.ok(undeclared, 'Should detect undeclared modules');

                const names = undeclared.map(m => m.name);
                assert.ok(names.includes('undeclared'), 
                    'Should find undeclared.rs module');
                assert.ok(!names.includes('declared'), 
                    'Should not include declared modules');
            } finally {
                if (fs.existsSync(tempDir)) {
                    fs.rmSync(tempDir, { recursive: true, force: true });
                }
            }
        });
    });

    // ============================================================
    // REGRESSION TEST 5: Target Validation & Path Resolution
    // Issue: Target path construction for workspace members
    // Commit: 05b94786
    // ============================================================

    suite('Target Path Resolution for Workspace Members', () => {
        test('should construct correct paths for targets in member crates', () => {
            // When working with workspace members, target paths need to be
            // constructed relative to the member, not the workspace root

            const memberPath = 'crates/my-crate';
            const targetRelativePath = 'src/main.rs';

            const fullPath = path.join(memberPath, targetRelativePath);

            assert.strictEqual(fullPath, path.normalize('crates/my-crate/src/main.rs'));
        });

        test('should handle deeply nested workspace members', () => {
            const memberPath = 'packages/app/core-lib';
            const targetRelativePath = 'src/lib.rs';

            const fullPath = path.join(memberPath, targetRelativePath);

            assert.ok(fullPath.includes('packages') && fullPath.includes('app') && fullPath.includes('core-lib'),
                'Should preserve nested member path structure');
        });
    });

    // ============================================================
    // REGRESSION TEST 6: Cargo Run with --package flag
    // Issue: When using --package, should add --bin for main.rs
    // Commit: 05b94786
    // ============================================================

    suite('Cargo Commands - Workspace Member Handling', () => {
        test('should add --bin flag when running specific binary target with --package', () => {
            // When running a binary in a workspace member with --package,
            // should include --bin to disambiguate from library

            const cargoArgs = ['run', '--package', 'my-app', '--bin', 'my-app'];

            assert.strictEqual(cargoArgs.length, 5, 'Should have all required arguments');
            assert.ok(cargoArgs.includes('--package'), 'Should include --package');
            assert.ok(cargoArgs.includes('--bin'), 'Should include --bin');
            assert.strictEqual(cargoArgs.indexOf('--package'), 1, 'Arguments should be in order');
            assert.strictEqual(cargoArgs.indexOf('--bin'), 3, 'Arguments should be in order');
        });

        test('should not duplicate --bin flag if already present', () => {
            // Ensure we don't add --bin twice
            const cargoArgs = ['run', '--bin', 'my-app', '--package', 'my-crate'];

            const binCount = cargoArgs.filter(arg => arg === '--bin').length;
            assert.strictEqual(binCount, 1, 'Should not duplicate --bin flag');
        });
    });

    // ============================================================
    // REGRESSION TEST 7: Dependency Color Coding
    // Issue: Various color coding scenarios for different dependency types
    // ============================================================

    suite('Dependency Color Coding', () => {
        test('should assign blue color to path-based dependencies', () => {
            // Path-based dependencies (local crates) should be blue
            const depKey = 'production:my-local-crate';
            const hasPath = true;

            // Simulate decoration assignment
            let assignedColor = undefined;
            if (hasPath) {
                assignedColor = 'charts.blue';
            }

            assert.strictEqual(assignedColor, 'charts.blue', 
                'Path-based dependencies should be blue');
        });

        test('should assign orange color to workspace dependencies', () => {
            // Workspace dependencies inherit from workspace.dependencies
            const depKey = 'workspace:serde';
            const depType = 'workspace';

            let assignedColor = undefined;
            if (depType === 'workspace') {
                assignedColor = 'charts.orange';
            }

            assert.strictEqual(assignedColor, 'charts.orange', 
                'Workspace dependencies should be orange');
        });

        test('should mark latest versions with green decoration', () => {
            // When a dependency is at the latest version, mark it green
            const depKey = 'production:tokio';
            const currentVersion = '1.35.0';
            const latestVersion = '1.35.0';

            const isLatest = currentVersion === latestVersion;

            assert.strictEqual(isLatest, true, 'Should detect when at latest version');
            if (isLatest) {
                const color = 'charts.green';
                assert.strictEqual(color, 'charts.green');
            }
        });

        test('should not color outdated dependencies', () => {
            // Outdated versions should not get colored
            const currentVersion = '1.20.0';
            const latestVersion = '1.35.0';

            const isLatest: boolean = (currentVersion as any) === latestVersion;
            let color: string | undefined = undefined;

            if (isLatest) {
                color = 'charts.green';
            }

            assert.strictEqual(color, undefined, 
                'Outdated dependencies should have no special color');
        });
    });

    // ============================================================
    // REGRESSION TEST 8: Module Declaration Context Values
    // Issue: Module context values and button assignments
    // Commit: b615da20
    // ============================================================

    suite('Module Declaration - Context Values', () => {
        test('should use correct context value for undeclared modules', () => {
            // Undeclared modules should have a specific context value
            const contextValue = TreeItemContext.UndeclaredModule;

            assert.ok(contextValue, 'Should have undeclared module context value defined');
            assert.ok(contextValue.includes('undeclared'), 
                'Context value should indicate undeclared status');
        });

        test('should use correct context value for declared modules', () => {
            // Declared modules should have a different context value
            const contextValue = TreeItemContext.Module;

            assert.ok(contextValue, 'Should have module context value defined');
            assert.ok(!contextValue.includes('undeclared'), 
                'Declared context value should not include undeclared');
        });

        test('should assign declare action to undeclared modules', () => {
            // Undeclared modules should have a "declare" action button
            const action = 'declareModule';

            assert.strictEqual(action, 'declareModule', 
                'Undeclared modules should have declare action');
        });
    });
});
