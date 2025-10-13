import * as https from 'https';

/**
 * Fetches all available versions for a crate from crates.io.
 * Filters out yanked versions.
 */
export async function fetchCrateVersions(crateName: string): Promise<string[]> {
    return new Promise((resolve, reject) => {
        const url = `https://crates.io/api/v1/crates/${crateName}`;
        
        https.get(url, {
            headers: {
                'User-Agent': 'cargui-vscode-extension'
            }
        }, (res) => {
            let data = '';
            
            res.on('data', (chunk) => {
                data += chunk;
            });
            
            res.on('end', () => {
                try {
                    const json = JSON.parse(data);
                    if (json.versions && Array.isArray(json.versions)) {
                        // Extract version numbers and filter out yanked versions
                        const versions = json.versions
                            .filter((v: any) => !v.yanked)
                            .map((v: any) => v.num);
                        resolve(versions);
                    } else {
                        resolve([]);
                    }
                } catch (error) {
                    reject(error);
                }
            });
        }).on('error', (error) => {
            reject(error);
        });
    });
}

/**
 * Calculates Levenshtein distance between two strings for fuzzy matching.
 * Used for finding similar crate names when suggesting typo corrections.
 */
export function levenshteinDistance(a: string, b: string): number {
    const matrix: number[][] = [];

    for (let i = 0; i <= b.length; i++) {
        matrix[i] = [i];
    }

    for (let j = 0; j <= a.length; j++) {
        matrix[0][j] = j;
    }

    for (let i = 1; i <= b.length; i++) {
        for (let j = 1; j <= a.length; j++) {
            if (b.charAt(i - 1) === a.charAt(j - 1)) {
                matrix[i][j] = matrix[i - 1][j - 1];
            } else {
                matrix[i][j] = Math.min(
                    matrix[i - 1][j - 1] + 1,
                    matrix[i][j - 1] + 1,
                    matrix[i - 1][j] + 1
                );
            }
        }
    }

    return matrix[b.length][a.length];
}

/**
 * Searches for crates on crates.io matching a query.
 * Returns results sorted by relevance (exact match, prefix match, contains match)
 * and download popularity.
 */
export async function searchCrates(query: string): Promise<Array<{ name: string; description: string }>> {
    return new Promise(async (resolve, reject) => {
        // Fetch by downloads to get popular crates, we'll ensure exact match is first
        const url = `https://crates.io/api/v1/crates?q=${encodeURIComponent(query)}&per_page=100&sort=downloads`;
        
        // Also check if there's an exact match crate
        let exactMatchCrate: { name: string; downloads: number; description: string } | null = null;
        try {
            const exactUrl = `https://crates.io/api/v1/crates/${encodeURIComponent(query)}`;
            await new Promise<void>((resolveExact, rejectExact) => {
                https.get(exactUrl, {
                    headers: {
                        'User-Agent': 'cargui-vscode-extension'
                    }
                }, (exactRes) => {
                    let exactData = '';
                    exactRes.on('data', (chunk) => {
                        exactData += chunk;
                    });
                    exactRes.on('end', () => {
                        try {
                            const exactJson = JSON.parse(exactData);
                            if (exactJson.crate && exactJson.crate.max_stable_version) {
                                exactMatchCrate = {
                                    name: exactJson.crate.name,
                                    downloads: exactJson.crate.downloads || 0,
                                    description: exactJson.crate.description || ''
                                };
                            }
                        } catch (e) {
                            // Exact match doesn't exist or error, continue without it
                        }
                        resolveExact();
                    });
                }).on('error', () => {
                    resolveExact(); // Continue even if exact match fails
                });
            });
        } catch (e) {
            // Continue without exact match
        }
        
        https.get(url, {
            headers: {
                'User-Agent': 'cargui-vscode-extension'
            }
        }, (res) => {
            let data = '';
            
            res.on('data', (chunk) => {
                data += chunk;
            });
            
            res.on('end', () => {
                try {
                    const json = JSON.parse(data);
                    let crates: Array<{ name: string; downloads: number; description: string }> = [];
                    
                    if (json.crates && Array.isArray(json.crates)) {
                        crates = json.crates
                            // Filter out yanked crates (max_stable_version is null for fully yanked crates)
                            .filter((c: any) => c.max_stable_version != null && c.max_stable_version !== '')
                            .map((c: any) => ({
                                name: c.name,
                                downloads: c.downloads || 0,
                                description: c.description || ''
                            }));
                    }
                    
                    const lowerQuery = query.toLowerCase();
                    
                    // Score crates by relevance
                    const filtered: Array<{ name: string; downloads: number; relevance: number; description: string }> = [];
                    
                    for (const crate of crates) {
                        const lowerName = crate.name.toLowerCase();
                        let relevance = 999; // Default: no relevance bonus
                        
                        if (lowerName === lowerQuery) {
                            // Exact match - position 1
                            relevance = 0;
                        } else if (lowerName.startsWith(lowerQuery)) {
                            // Starts with - high relevance (positions 2-11)
                            relevance = 1;
                        } else if (lowerName.includes(lowerQuery)) {
                            // Contains - medium relevance (positions 2-11)
                            relevance = 2;
                        }
                        // Everything else gets relevance 999 and sorts by downloads only
                        
                        filtered.push({ 
                            name: crate.name, 
                            downloads: crate.downloads,
                            relevance: relevance,
                            description: crate.description
                        });
                    }
                    
                    // Sort: exact match first, then top 10 by relevance+downloads, then rest by downloads only
                    filtered.sort((a, b) => {
                        // Exact match (relevance 0) always first
                        if (a.relevance === 0) return -1;
                        if (b.relevance === 0) return 1;
                        
                        // Both have relevance bonus (1 or 2) - sort by relevance then downloads
                        if (a.relevance < 999 && b.relevance < 999) {
                            if (a.relevance !== b.relevance) {
                                return a.relevance - b.relevance;
                            }
                            return b.downloads - a.downloads;
                        }
                        
                        // One has relevance bonus, one doesn't - relevance wins
                        if (a.relevance < 999) return -1;
                        if (b.relevance < 999) return 1;
                        
                        // Neither has relevance bonus - pure download sort
                        return b.downloads - a.downloads;
                    });
                    
                    // Ensure we always have at least 30 results
                    const minResults = 30;
                    if (filtered.length < minResults) {
                        // If we don't have enough results, add more from original list by popularity
                        const allCrates = json.crates.map((c: any) => ({
                            name: c.name,
                            downloads: c.downloads || 0,
                            relevance: 999, // Very low relevance for fallback items
                            description: c.description || ''
                        }));
                        
                        // Add crates not already included, sorted by downloads
                        const includedNames = new Set(filtered.map(c => c.name));
                        const additional = allCrates
                            .filter((c: any) => !includedNames.has(c.name))
                            .sort((a: any, b: any) => b.downloads - a.downloads);
                        
                        filtered.push(...additional.slice(0, minResults - filtered.length));
                    }
                    
                    // If we have an exact match from direct API call, prepend it
                    const results = filtered.slice(0, minResults);
                    if (exactMatchCrate) {
                        // Remove it if it already exists in results
                        const existingIndex = results.findIndex(c => c.name === exactMatchCrate!.name);
                        if (existingIndex >= 0) {
                            results.splice(existingIndex, 1);
                        }
                        // Add exact match at the beginning (with relevance 0)
                        results.unshift({
                            ...exactMatchCrate,
                            relevance: 0
                        });
                    }
                    
                    // Return results with name and description
                    resolve(results.map(c => ({ name: c.name, description: c.description })));
                } catch (error) {
                    reject(error);
                }
            });
        }).on('error', (error) => {
            reject(error);
        });
    });
}

/**
 * Fetches metadata for a specific crate version from crates.io.
 * Returns available features for the crate.
 */
export async function fetchCrateMetadata(crateName: string, version: string): Promise<{ features: string[] }> {
    return new Promise((resolve, reject) => {
        const url = `https://crates.io/api/v1/crates/${crateName}/${version}`;
        
        https.get(url, {
            headers: {
                'User-Agent': 'cargui-vscode-extension'
            }
        }, (res) => {
            let data = '';
            
            res.on('data', (chunk) => {
                data += chunk;
            });
            
            res.on('end', () => {
                try {
                    const json = JSON.parse(data);
                    const features: string[] = [];
                    
                    if (json.version && json.version.features) {
                        // Extract feature names from the features object
                        features.push(...Object.keys(json.version.features));
                    }
                    
                    resolve({ features });
                } catch (error) {
                    reject(error);
                }
            });
        }).on('error', (error) => {
            reject(error);
        });
    });
}
