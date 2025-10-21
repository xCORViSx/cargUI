import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as toml from '@iarna/toml';

/**
 * Fetches available Rust editions from the official Rust Edition Guide
 * Falls back to known editions if the fetch fails
 */
export async function getAvailableEditions(): Promise<string[]> {
    try {
        // Fetch from the Rust Edition Guide's table of contents
        const response = await fetch('https://raw.githubusercontent.com/rust-lang/edition-guide/master/src/SUMMARY.md');
        if (!response.ok) {
            throw new Error('Failed to fetch edition guide');
        }
        
        const content = await response.text();
        
        // Parse for "## Rust 20XX" patterns
        const editionMatches = content.match(/## Rust (\d{4})/g);
        if (editionMatches && editionMatches.length > 0) {
            const editions = editionMatches
                .map(match => match.replace('## Rust ', ''))
                .sort(); // Ensure chronological order
            
            return editions;
        }
    } catch (error) {
        console.warn('Failed to fetch Rust editions from edition guide:', error);
    }
    
    // Fallback to known editions as of October 2025
    return ['2015', '2018', '2021', '2024'];
}

/**
 * Reads the current Rust edition from Cargo.toml
 * Checks both [package] and [workspace.package] sections
 */
export function getCurrentEdition(workspacePath: string): string | undefined {
    const cargoTomlPath = path.join(workspacePath, 'Cargo.toml');
    
    if (!fs.existsSync(cargoTomlPath)) {
        return undefined;
    }
    
    try {
        const cargoTomlContent = fs.readFileSync(cargoTomlPath, 'utf-8');
        const parsed = toml.parse(cargoTomlContent);
        
        // First check [workspace.package] for multi-crate workspaces
        const workspacePackageEdition = (parsed.workspace as any)?.package?.edition;
        if (workspacePackageEdition) {
            return String(workspacePackageEdition);
        }
        
        // Then check [package] for single-crate projects
        const packageEdition = (parsed.package as any)?.edition;
        if (packageEdition && typeof packageEdition !== 'object') {
            return String(packageEdition);
        }
        
        // Default to 2015 if not specified
        return '2015';
    } catch (error) {
        console.error('Error reading Cargo.toml for edition:', error);
        return undefined;
    }
}

/**
 * Updates the Rust edition in Cargo.toml
 * Handles both [package] and [workspace.package] sections
 */
export async function updateEdition(workspacePath: string, newEdition: string): Promise<boolean> {
    const cargoTomlPath = path.join(workspacePath, 'Cargo.toml');
    
    if (!fs.existsSync(cargoTomlPath)) {
        vscode.window.showErrorMessage('Cargo.toml not found');
        return false;
    }
    
    try {
        let cargoTomlContent = fs.readFileSync(cargoTomlPath, 'utf-8');
        const parsed = toml.parse(cargoTomlContent);
        
        // Check if this has [workspace.package] section (multi-crate workspace)
        const hasWorkspacePackage = (parsed.workspace as any)?.package;
        
        if (hasWorkspacePackage) {
            // Update [workspace.package] section
            // Look for edition under [workspace.package]
            const workspacePackageRegex = /(\[workspace\.package\][^\[]*)edition\s*=\s*["']?\d{4}["']?/;
            
            if (workspacePackageRegex.test(cargoTomlContent)) {
                // Replace existing edition in [workspace.package]
                cargoTomlContent = cargoTomlContent.replace(
                    /(\[workspace\.package\][^\[]*)edition\s*=\s*["']?\d{4}["']?/,
                    `$1edition = "${newEdition}"`
                );
            } else {
                // Add edition to [workspace.package]
                cargoTomlContent = cargoTomlContent.replace(
                    /(\[workspace\.package\][^\[]*)/,
                    `$1edition = "${newEdition}"\n`
                );
            }
        } else if (parsed.package) {
            // Single-crate project - update [package] section
            const editionRegex = /^(\s*edition\s*=\s*)(["']?\d{4}["']?)/m;
            
            if (editionRegex.test(cargoTomlContent)) {
                // Replace existing edition
                cargoTomlContent = cargoTomlContent.replace(editionRegex, `$1"${newEdition}"`);
            } else {
                // Add edition after package section
                const packageSectionRegex = /(\[package\][^\[]*)/;
                cargoTomlContent = cargoTomlContent.replace(
                    packageSectionRegex,
                    `$1edition = "${newEdition}"\n`
                );
            }
        } else {
            vscode.window.showErrorMessage('No [package] or [workspace.package] section found in Cargo.toml');
            return false;
        }
        
        fs.writeFileSync(cargoTomlPath, cargoTomlContent, 'utf-8');
        vscode.window.showInformationMessage(`Updated Rust edition to ${newEdition}`);
        return true;
    } catch (error) {
        vscode.window.showErrorMessage(`Failed to update edition: ${error}`);
        return false;
    }
}

/**
 * Shows a quick pick menu to select a Rust edition
 */
export async function selectEdition(workspacePath: string, currentEdition: string): Promise<string | undefined> {
    const availableEditions = await getAvailableEditions();
    
    const items = availableEditions.map(edition => ({
        label: edition,
        description: edition === currentEdition ? '✓ current' : '',
        edition: edition
    }));
    
    const selected = await vscode.window.showQuickPick(items, {
        placeHolder: `Select Rust edition (current: ${currentEdition})`
    });
    
    return selected?.edition;
}
