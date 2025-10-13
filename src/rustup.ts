import * as vscode from 'vscode';
import { RustupToolchainInfo } from './types';

/**
 * Gets the currently active Rust toolchain using rustup.
 * 
 * @returns Promise resolving to the toolchain name (e.g., "stable-x86_64-apple-darwin") or "unknown" if not found
 */
export async function getCurrentToolchain(): Promise<string> {
    return new Promise((resolve) => {
        const { exec } = require('child_process');
        
        exec('rustup show active-toolchain', (error: any, stdout: string, stderr: string) => {
            if (error) {
                console.error('Failed to get current toolchain:', error);
                resolve('unknown');
                return;
            }
            
            // Output format: "stable-x86_64-apple-darwin (default)" or "stable-x86_64-apple-darwin (overridden by ...)"
            const match = stdout.trim().match(/^([^\s(]+)/);
            if (match) {
                resolve(match[1]);
            } else {
                resolve('unknown');
            }
        });
    });
}

/**
 * Checks for available rustup toolchain updates across all installed channels.
 * 
 * @returns Promise resolving to array of RustupToolchainInfo with update status for each channel
 */
export async function checkRustupUpdates(): Promise<RustupToolchainInfo[]> {
    return new Promise((resolve) => {
        const { exec } = require('child_process');
        
        // First, get list of installed toolchains
        exec('rustup toolchain list', (listError: any, listStdout: string) => {
            const installedToolchains = new Map<string, string>(); // channel -> full toolchain name
            
            if (!listError && listStdout) {
                const lines = listStdout.split('\n');
                for (const line of lines) {
                    // Parse lines like "stable-aarch64-apple-darwin (default)" or "nightly-aarch64-apple-darwin"
                    const match = line.match(/(stable|beta|nightly)(-[\w-]+)?/i);
                    if (match) {
                        const channel = match[1].toLowerCase();
                        if (!installedToolchains.has(channel)) {
                            installedToolchains.set(channel, line.trim().replace(/\s*\(default\)/, ''));
                        }
                    }
                }
            }
            
            // Now check for updates
            exec('rustup check', (error: any, stdout: string, stderr: string) => {
                const results: RustupToolchainInfo[] = [];
                const seenChannels = new Set<string>();
                
                if (!error && stdout) {
                    const lines = stdout.split('\n');
                    
                    for (const line of lines) {
                        // Parse lines like "stable-x86_64-apple-darwin - Update available: 1.82.0 -> 1.83.0"
                        // or "nightly-aarch64-apple-darwin - Update available : 1.92.0-nightly (b6f0945e4 2025-10-08) -> 1.92.0-nightly (b925a865e 2025-10-09)"
                        const updateMatch = line.match(/(stable|beta|nightly)[^\s]*\s*-\s*Update available[:\s]+(.+?)\s+->\s+(.+?)$/i);
                        if (updateMatch) {
                            const channel = updateMatch[1].toLowerCase();
                            // Only add the first toolchain found for each channel
                            if (!seenChannels.has(channel)) {
                                results.push({
                                    channel: channel as any,
                                    currentVersion: updateMatch[2].trim(), // Currently installed version
                                    availableVersion: updateMatch[3].trim(), // Available update version
                                    hasUpdate: true
                                });
                                seenChannels.add(channel);
                            }
                            continue;
                        }
                        // Parse lines like "stable-x86_64-apple-darwin - Up to date : 1.82.0"
                        // or "nightly-aarch64-apple-darwin - Up to date : 1.92.0-nightly (b925a865e 2025-10-09)"
                        const upToDateMatch = line.match(/(stable|beta|nightly)[^\s]*\s*-\s*Up to date[:\s]+(.+?)$/i);
                        if (upToDateMatch) {
                            const channel = upToDateMatch[1].toLowerCase();
                            // Only add the first toolchain found for each channel
                            if (!seenChannels.has(channel)) {
                                results.push({
                                    channel: channel as any,
                                    currentVersion: upToDateMatch[2].trim(),
                                    availableVersion: undefined,
                                    hasUpdate: false
                                });
                                seenChannels.add(channel);
                            }
                        }
                    }
                }
                
                // Add any installed toolchains that weren't in rustup check output
                // This handles newly installed toolchains that haven't been checked yet
                for (const [channel, toolchainName] of installedToolchains) {
                    if (!seenChannels.has(channel)) {
                        // Get version from toolchain name if possible (for nightly it includes date)
                        const versionMatch = toolchainName.match(/nightly-\d{4}-\d{2}-\d{2}/);
                        const version = versionMatch ? versionMatch[0].replace('nightly-', '') : 'installed';
                        
                        results.push({
                            channel: channel as any,
                            currentVersion: version,
                            availableVersion: undefined,
                            hasUpdate: false // Assume up to date if just installed
                        });
                        seenChannels.add(channel);
                    }
                }
                
                resolve(results);
            });
        });
    });
}

let rustupCheckTimer: NodeJS.Timeout | undefined;
let lastRustupCheck: Date | undefined;

/**
 * Performs a rustup update check and notifies the user if updates are available.
 * Respects user preferences for which channels to check.
 * 
 * @param context - VS Code extension context for storing last check time
 */
export async function performRustupCheck(context: vscode.ExtensionContext) {
    console.log('Checking for rustup updates...');
    const updates = await checkRustupUpdates();
    
    // Get user's channel preferences
    const config = vscode.workspace.getConfiguration('cargui');
    const enabledChannels = {
        stable: config.get('rustup.checkStable', true),
        beta: config.get('rustup.checkBeta', false),
        nightly: config.get('rustup.checkNightly', false)
    };
    
    // Filter to only enabled channels with updates
    const relevantUpdates = updates.filter(u => 
        u.hasUpdate && enabledChannels[u.channel]
    );
    
    if (relevantUpdates.length > 0) {
        const message = relevantUpdates.length === 1
            ? `Rust ${relevantUpdates[0].channel} ${relevantUpdates[0].availableVersion} is available`
            : `${relevantUpdates.length} Rust toolchain updates available`;
        
        const action = await vscode.window.showInformationMessage(
            message,
            'Update Now',
            'Later',
            'Settings'
        );
        
        if (action === 'Update Now') {
            vscode.commands.executeCommand('cargui.updateRustup');
        } else if (action === 'Settings') {
            vscode.commands.executeCommand('workbench.action.openSettings', 'cargui.rustup');
        }
    }
    
    lastRustupCheck = new Date();
    context.globalState.update('cargui.lastRustupCheck', lastRustupCheck.toISOString());
}

/**
 * Starts the background rustup update checker that runs every 12 hours.
 * Checks immediately if more than 12 hours have passed since last check.
 * 
 * @param context - VS Code extension context for storing and retrieving last check time
 */
export function startRustupUpdateChecker(context: vscode.ExtensionContext) {
    // Check immediately if it's been more than 12 hours since last check
    const lastCheck = context.globalState.get<string>('cargui.lastRustupCheck');
    if (lastCheck) {
        const lastCheckDate = new Date(lastCheck);
        const hoursSinceCheck = (Date.now() - lastCheckDate.getTime()) / (1000 * 60 * 60);
        if (hoursSinceCheck < 12) {
            console.log(`Rustup was checked ${Math.round(hoursSinceCheck)} hours ago, skipping immediate check`);
        } else {
            performRustupCheck(context);
        }
    } else {
        // First time, check immediately
        performRustupCheck(context);
    }
    
    // Schedule checks every 12 hours (43200000 ms)
    rustupCheckTimer = setInterval(() => {
        performRustupCheck(context);
    }, 12 * 60 * 60 * 1000);
}

/**
 * Stops the background rustup update checker and cleans up the timer.
 */
export function stopRustupUpdateChecker() {
    if (rustupCheckTimer) {
        clearInterval(rustupCheckTimer);
        rustupCheckTimer = undefined;
    }
}
