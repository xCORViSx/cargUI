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
 */
export function getCurrentEdition(workspacePath: string): string | undefined {
    const cargoTomlPath = path.join(workspacePath, 'Cargo.toml');
    
    if (!fs.existsSync(cargoTomlPath)) {
        return undefined;
    }
    
    try {
        const cargoTomlContent = fs.readFileSync(cargoTomlPath, 'utf-8');
        const parsed = toml.parse(cargoTomlContent);
        
        // Check package.edition
        const edition = (parsed.package as any)?.edition;
        if (edition) {
            return String(edition);
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
        
        // Update edition in parsed object
        if (!parsed.package) {
            vscode.window.showErrorMessage('No [package] section found in Cargo.toml');
            return false;
        }
        
        (parsed.package as any).edition = newEdition;
        
        // Write back to file - preserve formatting by doing string replacement
        const editionRegex = /^(\s*edition\s*=\s*)(["']?\d{4}["']?)/m;
        
        if (editionRegex.test(cargoTomlContent)) {
            // Replace existing edition
            cargoTomlContent = cargoTomlContent.replace(editionRegex, `$1"${newEdition}"`);
        } else {
            // Add edition after package name or version
            const packageSectionRegex = /(\[package\][^\[]*)/;
            cargoTomlContent = cargoTomlContent.replace(
                packageSectionRegex,
                `$1edition = "${newEdition}"\n`
            );
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
