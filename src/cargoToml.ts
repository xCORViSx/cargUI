import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as toml from '@iarna/toml';
import { CargoTarget, CargoManifest, WorkspaceMember } from './types';
import { discoverWorkspaceMembers } from './cargoDiscovery';

/**
 * Moves a target file to its standard Cargo location (src/bin, examples/, tests/, benches/)
 * and updates the Cargo.toml accordingly.
 */
export async function moveTargetToStandardLocation(
    target: CargoTarget,
    memberName: string | undefined,
    workspaceFolder: vscode.WorkspaceFolder
): Promise<boolean> {
    const workspaceMembers = discoverWorkspaceMembers(workspaceFolder.uri.fsPath);
    const member = memberName 
        ? workspaceMembers.find(m => m.name === memberName)
        : undefined;
    const basePath = member 
        ? path.join(workspaceFolder.uri.fsPath, member.path)
        : workspaceFolder.uri.fsPath;

    if (!target.path) {
        vscode.window.showWarningMessage(`Target ${target.name} has no path specified`);
        return false;
    }

    const currentFilePath = path.join(basePath, target.path);
    
    if (!fs.existsSync(currentFilePath)) {
        vscode.window.showErrorMessage(`Source file not found: ${currentFilePath}`);
        return false;
    }

    // Determine standard location based on target type
    let standardDir: string;
    const filename = path.basename(target.path);
    
    if (target.type === 'bin') {
        standardDir = path.join(basePath, 'src', 'bin');
    } else if (target.type === 'example') {
        standardDir = path.join(basePath, 'examples');
    } else if (target.type === 'test') {
        standardDir = path.join(basePath, 'tests');
    } else if (target.type === 'bench') {
        standardDir = path.join(basePath, 'benches');
    } else {
        vscode.window.showWarningMessage(`Unknown target type: ${target.type}`);
        return false;
    }

    const targetFilePath = path.join(standardDir, filename);

    // Check if already in standard location
    if (currentFilePath === targetFilePath) {
        vscode.window.showInformationMessage(`${filename} is already in standard location`);
        return false;
    }

    // Create target directory if it doesn't exist
    if (!fs.existsSync(standardDir)) {
        fs.mkdirSync(standardDir, { recursive: true });
    }

    // Check if target file already exists
    if (fs.existsSync(targetFilePath)) {
        vscode.window.showErrorMessage(`Target file already exists: ${targetFilePath}`);
        return false;
    }

    try {
        // Move the file
        fs.renameSync(currentFilePath, targetFilePath);
        
        // Update Cargo.toml to reflect new path
        const cargoTomlPath = path.join(basePath, 'Cargo.toml');
        let cargoTomlContent = fs.readFileSync(cargoTomlPath, 'utf-8');
        const manifest = toml.parse(cargoTomlContent) as CargoManifest;

        // Update the path in the appropriate section
        const sectionKey = `[[${target.type}]]`;
        const section = manifest[sectionKey as keyof CargoManifest] as any[];
        if (Array.isArray(section)) {
            const targetEntry = section.find((t: any) => t.name === target.name);
            if (targetEntry) {
                // Update to relative path from workspace
                const relativePath = path.relative(basePath, targetFilePath);
                targetEntry.path = relativePath.replace(/\\/g, '/'); // Normalize to forward slashes
            }
        }

        // Write back
        const newContent = toml.stringify(manifest as any);
        fs.writeFileSync(cargoTomlPath, newContent, 'utf-8');

        return true;
    } catch (error) {
        vscode.window.showErrorMessage(`Failed to move file: ${error}`);
        return false;
    }
}

/**
 * Removes duplicate/ambiguous dependency constraints from Cargo.toml files.
 * Keeps the first occurrence, removes subsequent ones.
 * Also normalizes ambiguous version specifiers like "=1.0" to prevent Cargo errors.
 */
export function removeDuplicateDependencies(cargoTomlPath: string, depNames: Set<string>): void {
    if (!fs.existsSync(cargoTomlPath)) {
        return;
    }

    const content = fs.readFileSync(cargoTomlPath, 'utf-8');
    const lines = content.split('\n');
    let currentSection: string | null = null;
    const seenDeps = new Map<string, number>(); // depName -> first line index
    const linesToRemove = new Set<number>();
    let modified = false;

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const trimmed = line.trim();

        // Track which section we're in
        if (trimmed.startsWith('[')) {
            const sectionMatch = trimmed.match(/\[([^\]]+)\]/);
            if (sectionMatch) {
                currentSection = sectionMatch[1];
            }
            continue;
        }

        // Skip if not in a dependency section
        if (!currentSection || !['dependencies', 'dev-dependencies', 'build-dependencies', 'workspace.dependencies'].includes(currentSection)) {
            continue;
        }

        // Check if this line defines one of our dependencies
        for (const depName of depNames) {
            const normalizedDepName = depName.replace(/_/g, '-');
            const normalizedLineName = trimmed.split(/\s*=/)[0].trim().replace(/_/g, '-');

            if (normalizedLineName === normalizedDepName) {
                if (seenDeps.has(depName)) {
                    // This is a duplicate - mark it for removal
                    linesToRemove.add(i);
                    // Also remove the next line if it's part of a multi-line entry
                    if (i + 1 < lines.length && lines[i + 1].trim().startsWith('}')) {
                        linesToRemove.add(i + 1);
                    }
                } else {
                    // First occurrence - keep it
                    seenDeps.set(depName, i);
                }
                break;
            }
        }
    }

    // If we found duplicates or made modifications, update the file
    if (linesToRemove.size > 0 || modified) {
        const newLines = lines.filter((_, i) => !linesToRemove.has(i));
        fs.writeFileSync(cargoTomlPath, newLines.join('\n'), 'utf-8');
    }
}

/**
 * Updates dependency versions in a Cargo.toml file.
 * Handles both simple string versions and complex dependency objects.
 */
export async function updateDependencyVersions(
    cargoTomlPath: string, 
    versionChoices: Map<string, { version: string; type: string }>
): Promise<void> {
    if (!fs.existsSync(cargoTomlPath)) {
        return;
    }

    const content = fs.readFileSync(cargoTomlPath, 'utf-8');
    const lines = content.split('\n');
    let currentSection: string | null = null;
    let modified = false;

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const trimmed = line.trim();

        // Track which section we're in
        if (trimmed.startsWith('[')) {
            const sectionMatch = trimmed.match(/\[([^\]]+)\]/);
            if (sectionMatch) {
                currentSection = sectionMatch[1];
            }
            continue;
        }

        // Only process dependency sections
        if (!currentSection) continue;
        
        // Check if this line defines a dependency we want to update
        for (const [depName, depInfo] of versionChoices) {
            const depType = depInfo.type;
            const newVersion = depInfo.version;
            
            // Map dependency type to TOML section names
            const sectionMap: { [key: string]: string[] } = {
                'workspace': ['workspace.dependencies'],
                'production': ['dependencies'],
                'dev': ['dev-dependencies'],
                'build': ['build-dependencies']
            };
            
            const validSections = sectionMap[depType] || ['dependencies'];
            
            // Only update if we're in the correct section for this dependency type
            if (!validSections.includes(currentSection)) {
                continue;
            }
            
            // Normalize dependency names: Rust treats hyphens and underscores as equivalent
            const normalizedDepName = depName.replace(/_/g, '-');
            const normalizedLineName = trimmed.split(/\s*=/)[0].trim().replace(/_/g, '-');
            
            if (normalizedLineName === normalizedDepName) {
                // Handle different formats:
                // name = "1.0" or name = "^1.0" or name = "~1.0"
                // name = { version = "1.0", features = [...] }
                
                if (trimmed.includes('{')) {
                    // Object format - replace version field with exact version (= prefix)
                    const versionMatch = line.match(/version\s*=\s*"[^"]+"/);
                    if (versionMatch) {
                        lines[i] = line.replace(/version\s*=\s*"[^"]+"/, `version = "=${newVersion}"`);
                        modified = true;
                    }
                } else {
                    // Simple string format - use exact version (= prefix)
                    const versionMatch = line.match(/"[^"]+"/);
                    if (versionMatch) {
                        lines[i] = line.replace(/"[^"]+"/, `"=${newVersion}"`);
                        modified = true;
                    }
                }
                break;
            }
        }
    }

    if (modified) {
        fs.writeFileSync(cargoTomlPath, lines.join('\n'), 'utf-8');
    }
}

/**
 * Inserts a target section ([[bin]], [[example]], [[test]], or [[bench]]) 
 * into a Cargo.toml file in the appropriate location.
 */
export function insertTargetSection(content: string, section: string, sectionType: string): string {
    // Look for existing sections of the same type
    const sectionRegex = new RegExp(`\\[\\[${sectionType.slice(2, -2)}\\]\\]`, 'g');
    const matches: number[] = [];
    let match;
    
    while ((match = sectionRegex.exec(content)) !== null) {
        matches.push(match.index);
    }
    
    // If there are existing sections of this type, find the main group and insert there
    if (matches.length > 0) {
        // Find the main group - the largest consecutive group of this type
        let longestGroupStart = matches[0];
        let longestGroupEnd = matches[0];
        let longestGroupSize = 1;
        let currentGroupStart = matches[0];
        let currentGroupEnd = matches[0];
        let currentGroupSize = 1;
        
        for (let i = 1; i < matches.length; i++) {
            const prevEnd = findSectionEnd(content, matches[i - 1]);
            const currentStart = matches[i];
            
            // Check if sections are adjacent (only whitespace between them, no other section types)
            const between = content.slice(prevEnd, currentStart);
            const targetTypeName = sectionType.slice(2, -2);
            const otherSectionRegex = new RegExp(`\\[\\[(?!${targetTypeName}\\]\\])\\w+\\]\\]`);
            const hasOtherSection = otherSectionRegex.test(between);
            
            if (!hasOtherSection) {
                currentGroupSize++;
                currentGroupEnd = matches[i];
            } else {
                if (currentGroupSize > longestGroupSize) {
                    longestGroupSize = currentGroupSize;
                    longestGroupStart = currentGroupStart;
                    longestGroupEnd = currentGroupEnd;
                }
                currentGroupStart = matches[i];
                currentGroupEnd = matches[i];
                currentGroupSize = 1;
            }
        }
        
        if (currentGroupSize > longestGroupSize) {
            longestGroupEnd = currentGroupEnd;
        }
        
        // Insert after the end of the main (longest) group
        const insertAfterPos = longestGroupEnd;
        const afterSection = content.slice(insertAfterPos);
        const nextSectionMatch = /\n+\[/g.exec(afterSection);
        
        if (nextSectionMatch) {
            const insertPos = insertAfterPos + nextSectionMatch.index;
            return content.slice(0, insertPos) + '\n\n' + section + content.slice(insertPos);
        } else {
            const trimmedContent = content.trimEnd();
            return trimmedContent + '\n\n' + section + '\n';
        }
    }
    
    // No existing sections of this type - find optimal location based on type hierarchy
    const packageMatch = /\[package\][^\[]*/.exec(content);
    const depsMatch = /\[dependencies\][^\[]*/.exec(content);
    const devDepsMatch = /\[dev-dependencies\][^\[]*/.exec(content);
    const libMatch = /\[lib\][^\[]*/.exec(content);
    
    const binMatch = /\[\[bin\]\]/g.exec(content);
    const exampleMatch = /\[\[example\]\]/g.exec(content);
    const testMatch = /\[\[test\]\]/g.exec(content);
    const benchMatch = /\[\[bench\]\]/g.exec(content);
    
    let insertPos = -1;
    
    // Determine insertion point based on type hierarchy: bin → example → test → bench
    if (sectionType === '[[bin]]') {
        if (exampleMatch || testMatch || benchMatch) {
            const nextType = exampleMatch || testMatch || benchMatch;
            insertPos = nextType!.index;
            return content.slice(0, insertPos) + section + '\n\n' + content.slice(insertPos);
        } else if (libMatch) {
            insertPos = libMatch.index + libMatch[0].length;
        } else if (depsMatch) {
            insertPos = depsMatch.index + depsMatch[0].length;
        } else if (packageMatch) {
            insertPos = packageMatch.index + packageMatch[0].length;
        }
    } else if (sectionType === '[[example]]') {
        if (binMatch) {
            insertPos = findLastSectionEnd(content, '[[bin]]');
        } else if (testMatch || benchMatch) {
            const nextType = testMatch || benchMatch;
            insertPos = nextType!.index;
            return content.slice(0, insertPos) + section + '\n\n' + content.slice(insertPos);
        } else if (libMatch) {
            insertPos = libMatch.index + libMatch[0].length;
        } else if (depsMatch) {
            insertPos = depsMatch.index + depsMatch[0].length;
        } else if (packageMatch) {
            insertPos = packageMatch.index + packageMatch[0].length;
        }
    } else if (sectionType === '[[test]]') {
        if (exampleMatch) {
            insertPos = findLastSectionEnd(content, '[[example]]');
        } else if (binMatch) {
            insertPos = findLastSectionEnd(content, '[[bin]]');
        } else if (benchMatch) {
            insertPos = benchMatch.index;
            return content.slice(0, insertPos) + section + '\n\n' + content.slice(insertPos);
        } else if (devDepsMatch) {
            insertPos = devDepsMatch.index + devDepsMatch[0].length;
        } else if (depsMatch) {
            insertPos = depsMatch.index + depsMatch[0].length;
        } else if (packageMatch) {
            insertPos = packageMatch.index + packageMatch[0].length;
        }
    } else if (sectionType === '[[bench]]') {
        if (testMatch) {
            insertPos = findLastSectionEnd(content, '[[test]]');
        } else if (exampleMatch) {
            insertPos = findLastSectionEnd(content, '[[example]]');
        } else if (binMatch) {
            insertPos = findLastSectionEnd(content, '[[bin]]');
        } else if (devDepsMatch) {
            insertPos = devDepsMatch.index + devDepsMatch[0].length;
        } else if (depsMatch) {
            insertPos = depsMatch.index + depsMatch[0].length;
        } else if (packageMatch) {
            insertPos = packageMatch.index + packageMatch[0].length;
        }
    }
    
    // Insert at the determined position or append at end
    if (insertPos > -1) {
        while (insertPos < content.length && content[insertPos] !== '\n') {
            insertPos++;
        }
        return content.slice(0, insertPos) + '\n\n' + section + content.slice(insertPos);
    } else {
        return content + '\n\n' + section;
    }
}

/**
 * Finds where a section ends given its start position in the content.
 */
export function findSectionEnd(content: string, sectionStartPos: number): number {
    const afterSection = content.slice(sectionStartPos);
    const nextSectionMatch = /\n+\[/g.exec(afterSection);
    
    if (nextSectionMatch) {
        return sectionStartPos + nextSectionMatch.index;
    } else {
        return content.length;
    }
}

/**
 * Finds the end position of the last section of a given type.
 */
export function findLastSectionEnd(content: string, sectionType: string): number {
    const regex = new RegExp(`\\[\\[${sectionType.slice(2, -2)}\\]\\]`, 'g');
    const matches: number[] = [];
    let match;
    
    while ((match = regex.exec(content)) !== null) {
        matches.push(match.index);
    }
    
    if (matches.length === 0) return -1;
    
    const lastMatch = matches[matches.length - 1];
    const afterLastSection = content.slice(lastMatch);
    const nextSectionMatch = /\n\n\[/g.exec(afterLastSection);
    
    if (nextSectionMatch) {
        return lastMatch + nextSectionMatch.index;
    } else {
        const endMatch = /\n\s*$/g.exec(afterLastSection);
        if (endMatch) {
            return lastMatch + endMatch.index;
        }
        return content.length;
    }
}

/**
 * Formats and organizes a Cargo.toml file according to standard conventions.
 * Preserves comments and sorts sections in canonical order.
 */
export async function formatCargoTomlFile(cargoTomlPath: string, _memberName?: string): Promise<boolean> {
    try {
        const content = fs.readFileSync(cargoTomlPath, 'utf-8');
        const manifest: any = toml.parse(content);

        const extractComments = (fileContent: string): Map<string, string[]> => {
            const commentMap = new Map<string, string[]>();
            const lines = fileContent.split('\n');
            let currentSection = '__header__';
            let pendingComments: string[] = [];

            for (let i = 0; i < lines.length; i++) {
                const line = lines[i].trim();

                if (line.startsWith('#')) {
                    pendingComments.push(lines[i]);
                } else if (line.match(/^\[.*\]$/)) {
                    const match = line.match(/^\[(.*)\]$/);
                    if (match) {
                        currentSection = match[1];
                        if (pendingComments.length > 0) {
                            commentMap.set(currentSection, pendingComments);
                            pendingComments = [];
                        }
                    }
                } else if (line.length > 0) {
                    if (pendingComments.length > 0) {
                        const existing = commentMap.get(currentSection) || [];
                        commentMap.set(currentSection, [...existing, ...pendingComments]);
                        pendingComments = [];
                    }
                }
            }

            if (pendingComments.length > 0) {
                commentMap.set('__footer__', pendingComments);
            }

            return commentMap;
        };

        const comments = extractComments(content);

        const serializeValue = (value: any, indent: number = 0): string => {
            const indentStr = '    '.repeat(indent);

            if (typeof value === 'string') {
                return `"${value}"`;
            } else if (typeof value === 'number' || typeof value === 'boolean') {
                return String(value);
            } else if (Array.isArray(value)) {
                if (value.length === 0) {
                    return '[]';
                }
                const inlineStr = `[${value.map(v => typeof v === 'string' ? `"${v}"` : String(v)).join(', ')}]`;
                if (inlineStr.length <= 60) {
                    return inlineStr;
                }
                return '[\n' + value.map(v => `${indentStr}    ${typeof v === 'string' ? `"${v}"` : String(v)},`).join('\n') + `\n${indentStr}]`;
            } else if (typeof value === 'object' && value !== null) {
                const entries = Object.entries(value)
                    .map(([k, v]) => `${k} = ${serializeValue(v, indent)}`)
                    .join(', ');
                return `{ ${entries} }`;
            }
            return String(value);
        };

        const writeSection = (sectionName: string, data: any, keyOrder: string[] = []): string => {
            if (!data || Object.keys(data).length === 0) return '';

            let output = '';

            const sectionComments = comments.get(sectionName);
            if (sectionComments && sectionComments.length > 0) {
                output += sectionComments.join('\n') + '\n';
            }

            output += `[${sectionName}]\n`;
            const allKeys = Object.keys(data);

            for (const key of keyOrder) {
                if (data.hasOwnProperty(key)) {
                    output += `${key} = ${serializeValue(data[key])}\n`;
                }
            }

            const remainingKeys = allKeys.filter(k => !keyOrder.includes(k)).sort();
            for (const key of remainingKeys) {
                output += `${key} = ${serializeValue(data[key])}\n`;
            }

            return output + '\n';
        };

        let formatted = '';

        const headerComments = comments.get('__header__');
        if (headerComments && headerComments.length > 0) {
            formatted += headerComments.join('\n') + '\n\n';
        }

        if (manifest.package) {
            const pkgOrder = ['name', 'version', 'edition', 'rust-version', 'authors', 'description',
                'readme', 'license', 'license-file', 'keywords', 'categories',
                'repository', 'homepage', 'documentation', 'publish', 'default-run'];
            formatted += writeSection('package', manifest.package, pkgOrder);
        }

        if (manifest.badges) {
            formatted += writeSection('badges', manifest.badges);
        }

        if (manifest.lib) {
            formatted += '[lib]\n';
            if (manifest.lib.name) formatted += `name = ${serializeValue(manifest.lib.name)}\n`;
            if (manifest.lib.path) formatted += `path = ${serializeValue(manifest.lib.path)}\n`;
            for (const key of Object.keys(manifest.lib)) {
                if (!['name', 'path'].includes(key)) {
                    formatted += `${key} = ${serializeValue(manifest.lib[key])}\n`;
                }
            }
            formatted += '\n';
        }

        if (manifest.package?.metadata) {
            for (const metaKey of Object.keys(manifest.package.metadata).sort()) {
                formatted += `[package.metadata.${metaKey}]\n`;
                const metaData = manifest.package.metadata[metaKey];
                if (typeof metaData === 'object' && !Array.isArray(metaData)) {
                    for (const key of Object.keys(metaData).sort()) {
                        formatted += `${key} = ${serializeValue(metaData[key])}\n`;
                    }
                } else {
                    formatted += `${metaKey} = ${serializeValue(metaData)}\n`;
                }
                formatted += '\n';
            }
        }

        if (manifest.workspace) {
            const hasMembers = manifest.workspace.members && manifest.workspace.members.length > 0;
            const hasExclude = manifest.workspace.exclude && manifest.workspace.exclude.length > 0;
            const hasDependencies = manifest.workspace.dependencies && Object.keys(manifest.workspace.dependencies).length > 0;
            const hasPackage = manifest.workspace.package && Object.keys(manifest.workspace.package).length > 0;
            const hasLints = manifest.workspace.lints && Object.keys(manifest.workspace.lints).length > 0;

            if (hasMembers || hasExclude || hasDependencies || hasPackage || hasLints || Object.keys(manifest.workspace).length > 0) {
                formatted += '[workspace]\n';

                if (hasMembers) {
                    formatted += 'members = [\n';
                    for (const member of manifest.workspace.members) {
                        formatted += `    "${member}",\n`;
                    }
                    formatted += ']\n';
                }

                if (hasExclude) {
                    formatted += 'exclude = [\n';
                    for (const member of manifest.workspace.exclude) {
                        formatted += `    "${member}",\n`;
                    }
                    formatted += ']\n';
                }

                if (manifest.workspace.resolver) {
                    formatted += `resolver = ${serializeValue(manifest.workspace.resolver)}\n`;
                }

                formatted += '\n';

                if (hasPackage) {
                    formatted += '[workspace.package]\n';
                    const pkgOrder = ['version', 'edition', 'rust-version', 'authors', 'description',
                        'license', 'repository', 'homepage', 'documentation'];
                    for (const key of pkgOrder) {
                        if (manifest.workspace.package.hasOwnProperty(key)) {
                            formatted += `${key} = ${serializeValue(manifest.workspace.package[key])}\n`;
                        }
                    }
                    for (const key of Object.keys(manifest.workspace.package).sort()) {
                        if (!pkgOrder.includes(key)) {
                            formatted += `${key} = ${serializeValue(manifest.workspace.package[key])}\n`;
                        }
                    }
                    formatted += '\n';
                }

                if (hasDependencies) {
                    formatted += '[workspace.dependencies]\n';
                    const deps = Object.keys(manifest.workspace.dependencies).sort();
                    for (const dep of deps) {
                        const value = manifest.workspace.dependencies[dep];
                        formatted += `${dep} = ${serializeValue(value)}\n`;
                    }
                    formatted += '\n';
                }

                if (hasLints) {
                    for (const lintType of Object.keys(manifest.workspace.lints).sort()) {
                        formatted += `[workspace.lints.${lintType}]\n`;
                        const lints = manifest.workspace.lints[lintType];
                        for (const lint of Object.keys(lints).sort()) {
                            formatted += `${lint} = ${serializeValue(lints[lint])}\n`;
                        }
                        formatted += '\n';
                    }
                }
            }
        }

        if (manifest.dependencies && Object.keys(manifest.dependencies).length > 0) {
            formatted += '[dependencies]\n';
            const deps = Object.keys(manifest.dependencies).sort();
            for (const dep of deps) {
                const value = manifest.dependencies[dep];
                formatted += `${dep} = ${serializeValue(value)}\n`;
            }
            formatted += '\n';
        }

        if (manifest.bin && Array.isArray(manifest.bin) && manifest.bin.length > 0) {
            const binComments = comments.get('bin');
            if (binComments && binComments.length > 0) {
                formatted += binComments.join('\n') + '\n';
            }

            for (const bin of manifest.bin) {
                formatted += '[[bin]]\n';
                formatted += `name = "${bin.name}"\n`;
                formatted += `path = "${bin.path}"\n`;
                for (const key of Object.keys(bin)) {
                    if (!['name', 'path'].includes(key)) {
                        formatted += `${key} = ${serializeValue(bin[key])}\n`;
                    }
                }
                formatted += '\n';
            }
        }

        if (manifest.example && Array.isArray(manifest.example) && manifest.example.length > 0) {
            const exampleComments = comments.get('example');
            if (exampleComments && exampleComments.length > 0) {
                formatted += exampleComments.join('\n') + '\n';
            }

            for (const example of manifest.example) {
                formatted += '[[example]]\n';
                formatted += `name = "${example.name}"\n`;
                formatted += `path = "${example.path}"\n`;
                for (const key of Object.keys(example)) {
                    if (!['name', 'path'].includes(key)) {
                        formatted += `${key} = ${serializeValue(example[key])}\n`;
                    }
                }
                formatted += '\n';
            }
        }

        if (manifest.test && Array.isArray(manifest.test) && manifest.test.length > 0) {
            const testComments = comments.get('test');
            if (testComments && testComments.length > 0) {
                formatted += testComments.join('\n') + '\n';
            }

            for (const test of manifest.test) {
                formatted += '[[test]]\n';
                formatted += `name = "${test.name}"\n`;
                formatted += `path = "${test.path}"\n`;
                for (const key of Object.keys(test)) {
                    if (!['name', 'path'].includes(key)) {
                        formatted += `${key} = ${serializeValue(test[key])}\n`;
                    }
                }
                formatted += '\n';
            }
        }

        if (manifest.bench && Array.isArray(manifest.bench) && manifest.bench.length > 0) {
            const benchComments = comments.get('bench');
            if (benchComments && benchComments.length > 0) {
                formatted += benchComments.join('\n') + '\n';
            }

            for (const bench of manifest.bench) {
                formatted += '[[bench]]\n';
                formatted += `name = "${bench.name}"\n`;
                formatted += `path = "${bench.path}"\n`;
                for (const key of Object.keys(bench)) {
                    if (!['name', 'path'].includes(key)) {
                        formatted += `${key} = ${serializeValue(bench[key])}\n`;
                    }
                }
                formatted += '\n';
            }
        }

        if (manifest['dev-dependencies'] && Object.keys(manifest['dev-dependencies']).length > 0) {
            formatted += '[dev-dependencies]\n';
            const deps = Object.keys(manifest['dev-dependencies']).sort();
            for (const dep of deps) {
                const value = manifest['dev-dependencies'][dep];
                formatted += `${dep} = ${serializeValue(value)}\n`;
            }
            formatted += '\n';
        }

        if (manifest['build-dependencies'] && Object.keys(manifest['build-dependencies']).length > 0) {
            formatted += '[build-dependencies]\n';
            const deps = Object.keys(manifest['build-dependencies']).sort();
            for (const dep of deps) {
                const value = manifest['build-dependencies'][dep];
                formatted += `${dep} = ${serializeValue(value)}\n`;
            }
            formatted += '\n';
        }

        for (const key of Object.keys(manifest)) {
            if (key.startsWith('target.')) {
                const targetData = manifest[key];
                formatted += `[${key}]\n`;

                if (targetData.dependencies) {
                    const deps = Object.keys(targetData.dependencies).sort();
                    for (const dep of deps) {
                        formatted += `${dep} = ${serializeValue(targetData.dependencies[dep])}\n`;
                    }
                }
                if (targetData['dev-dependencies']) {
                    const deps = Object.keys(targetData['dev-dependencies']).sort();
                    for (const dep of deps) {
                        formatted += `${dep} = ${serializeValue(targetData['dev-dependencies'][dep])}\n`;
                    }
                }
                if (targetData['build-dependencies']) {
                    const deps = Object.keys(targetData['build-dependencies']).sort();
                    for (const dep of deps) {
                        formatted += `${dep} = ${serializeValue(targetData['build-dependencies'][dep])}\n`;
                    }
                }

                formatted += '\n';
            }
        }

        if (manifest.features && Object.keys(manifest.features).length > 0) {
            formatted += '[features]\n';
            if (manifest.features.default) {
                formatted += `default = ${serializeValue(manifest.features.default)}\n`;
            }
            const features = Object.keys(manifest.features).filter(f => f !== 'default').sort();
            for (const feature of features) {
                const value = manifest.features[feature];
                formatted += `${feature} = ${serializeValue(value)}\n`;
            }
            formatted += '\n';
        }

        if (manifest.lints) {
            formatted += '[lints]\n';
            for (const lintType of Object.keys(manifest.lints).sort()) {
                formatted += `\n[lints.${lintType}]\n`;
                const lints = manifest.lints[lintType];
                for (const lint of Object.keys(lints).sort()) {
                    formatted += `${lint} = ${serializeValue(lints[lint])}\n`;
                }
            }
            formatted += '\n';
        }

        const profiles = ['dev', 'release', 'test', 'bench'];
        for (const profile of profiles) {
            if (manifest.profile && manifest.profile[profile]) {
                formatted += `[profile.${profile}]\n`;
                const profileData = manifest.profile[profile];
                const profileOrder = ['opt-level', 'debug', 'split-debuginfo', 'strip', 'debug-assertions',
                    'overflow-checks', 'lto', 'panic', 'incremental', 'codegen-units', 'rpath'];
                for (const key of profileOrder) {
                    if (profileData.hasOwnProperty(key)) {
                        formatted += `${key} = ${serializeValue(profileData[key])}\n`;
                    }
                }
                for (const key of Object.keys(profileData).sort()) {
                    if (!profileOrder.includes(key)) {
                        formatted += `${key} = ${serializeValue(profileData[key])}\n`;
                    }
                }
                formatted += '\n';
            }
        }

        if (manifest.profile) {
            for (const profileName of Object.keys(manifest.profile)) {
                if (!profiles.includes(profileName)) {
                    formatted += `[profile.${profileName}]\n`;
                    const profileData = manifest.profile[profileName];
                    for (const key of Object.keys(profileData).sort()) {
                        formatted += `${key} = ${serializeValue(profileData[key])}\n`;
                    }
                    formatted += '\n';
                }
            }
        }

        if (manifest.patch) {
            for (const source of Object.keys(manifest.patch).sort()) {
                formatted += `[patch.${source === 'crates-io' ? 'crates-io' : `'${source}'`}]\n`;
                const patches = manifest.patch[source];
                for (const crate of Object.keys(patches).sort()) {
                    formatted += `${crate} = ${serializeValue(patches[crate])}\n`;
                }
                formatted += '\n';
            }
        }

        if (manifest.replace) {
            formatted += '[replace]\n';
            for (const crate of Object.keys(manifest.replace).sort()) {
                formatted += `"${crate}" = ${serializeValue(manifest.replace[crate])}\n`;
            }
            formatted += '\n';
        }

        const footerComments = comments.get('__footer__');
        if (footerComments && footerComments.length > 0) {
            formatted += footerComments.join('\n') + '\n';
        }

        fs.writeFileSync(cargoTomlPath, formatted.trimEnd() + '\n', 'utf-8');
        return true;
    } catch (error) {
        vscode.window.showErrorMessage(`Failed to format Cargo.toml: ${error}`);
        return false;
    }
}

/**
 * Applies changes to Cargo.toml files by adding unregistered targets and undeclared features.
 * Optionally moves files to their standard locations before registration.
 */
export async function applyCargoTomlChanges(
    workspaceFolder: vscode.WorkspaceFolder, 
    items: import('./types').UnregisteredItem[],
    moveFile: (workspaceFolder: vscode.WorkspaceFolder, item: import('./types').UnregisteredItem, memberPath?: string) => Promise<string | null>
) {
    if (items.length === 0) return;

    const byMember = new Map<string, import('./types').UnregisteredItem[]>();

    for (const item of items) {
        const key = item.memberName || '__root__';
        if (!byMember.has(key)) {
            byMember.set(key, []);
        }
        byMember.get(key)!.push(item);
    }

    let successCount = 0;
    let errorCount = 0;
    let movedCount = 0;

    for (const [memberKey, memberItems] of byMember) {
        try {
            let cargoTomlPath: string;
            let memberPath: string | undefined;

            if (memberKey === '__root__') {
                cargoTomlPath = path.join(workspaceFolder.uri.fsPath, 'Cargo.toml');
            } else {
                const members = discoverWorkspaceMembers(workspaceFolder.uri.fsPath);
                const member = members.find(m => m.name === memberKey);
                if (!member) {
                    console.error(`Member ${memberKey} not found`);
                    errorCount += memberItems.length;
                    continue;
                }
                memberPath = member.path;
                cargoTomlPath = path.join(workspaceFolder.uri.fsPath, member.path, 'Cargo.toml');
            }

            const content = fs.readFileSync(cargoTomlPath, 'utf-8');
            let newContent = content;

            const targets = memberItems.filter(i => i.type !== 'feature' && i.type !== 'unknown');
            const features = memberItems.filter(i => i.type === 'feature');

            const processedTargets: import('./types').UnregisteredItem[] = [];
            for (const target of targets) {
                const newPath = await moveFile(workspaceFolder, target, memberPath);
                if (newPath && newPath !== target.path) {
                    movedCount++;
                }
                processedTargets.push({
                    ...target,
                    path: newPath || target.path
                });
            }

            for (const target of processedTargets) {
                if (target.path) {
                    let section = '';
                    let sectionType = '';

                    if (target.type === 'bin') {
                        section = `[[bin]]\nname = "${target.name}"\npath = "${target.path}"\n`;
                        sectionType = '[[bin]]';
                    } else if (target.type === 'example') {
                        section = `[[example]]\nname = "${target.name}"\npath = "${target.path}"\n`;
                        sectionType = '[[example]]';
                    } else if (target.type === 'test') {
                        section = `[[test]]\nname = "${target.name}"\npath = "${target.path}"\n`;
                        sectionType = '[[test]]';
                    } else if (target.type === 'bench') {
                        section = `[[bench]]\nname = "${target.name}"\npath = "${target.path}"\n`;
                        sectionType = '[[bench]]';
                    }

                    if (section && sectionType) {
                        newContent = insertTargetSection(newContent, section, sectionType);
                        successCount++;
                    }
                }
            }

            if (features.length > 0) {
                const hasFeatureSection = newContent.includes('[features]');

                if (hasFeatureSection) {
                    const featureSectionRegex = /\[features\]/;
                    const match = featureSectionRegex.exec(newContent);
                    if (match) {
                        let insertPos = match.index + match[0].length;
                        const nextSectionMatch = /\n\[/g;
                        nextSectionMatch.lastIndex = insertPos;
                        const nextMatch = nextSectionMatch.exec(newContent);
                        const endPos = nextMatch ? nextMatch.index : newContent.length;

                        let featureLines = '';
                        for (const feature of features) {
                            featureLines += `\n${feature.name} = []`;
                            successCount++;
                        }

                        newContent = newContent.slice(0, endPos) + featureLines + newContent.slice(endPos);
                    }
                } else {
                    let featureSection = '\n\n[features]';
                    for (const feature of features) {
                        featureSection += `\n${feature.name} = []`;
                        successCount++;
                    }
                    newContent += featureSection + '\n';
                }
            }

            fs.writeFileSync(cargoTomlPath, newContent, 'utf-8');
        } catch (error) {
            console.error(`Error modifying Cargo.toml for ${memberKey}:`, error);
            errorCount += memberItems.length;
        }
    }

    if (successCount > 0) {
        let message = `Successfully configured ${successCount} item(s) in Cargo.toml`;
        if (movedCount > 0) {
            message += ` and moved ${movedCount} file(s)`;
        }
        vscode.window.showInformationMessage(message);
        const treeProvider = (vscode.window as any).cargoTreeProvider;
        if (treeProvider) {
            treeProvider.refresh();
        }
    }

    if (errorCount > 0) {
        vscode.window.showErrorMessage(`Failed to configure ${errorCount} item(s)`);
    }
}
