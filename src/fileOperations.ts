import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { UnregisteredItem } from './types';

/**
 * Moves a file to the appropriate directory based on its target type.
 * 
 * @param workspaceFolder - The workspace folder
 * @param item - The unregistered item to move
 * @param memberPath - Optional member path for workspace projects
 * @returns The new relative path, or null if the move failed or wasn't needed
 */
export async function moveFileToTargetDirectory(
    workspaceFolder: vscode.WorkspaceFolder,
    item: UnregisteredItem,
    memberPath?: string
): Promise<string | null> {
    if (!item.path || item.type === 'feature' || item.type === 'unknown') {
        return null;
    }

    if (item.shouldMove === false) {
        return item.path;
    }

    const basePath = memberPath || workspaceFolder.uri.fsPath;
    const srcPath = path.join(basePath, 'src');
    const currentFilePath = path.join(basePath, item.path);

    let targetDir: string;
    let targetDirName: string;
    switch (item.type) {
        case 'bin':
            targetDir = path.join(srcPath, 'bin');
            targetDirName = 'bin';
            break;
        case 'example':
            targetDir = path.join(basePath, 'examples');
            targetDirName = 'examples';
            break;
        case 'test':
            targetDir = path.join(basePath, 'tests');
            targetDirName = 'tests';
            break;
        case 'bench':
            targetDir = path.join(basePath, 'benches');
            targetDirName = 'benches';
            break;
        default:
            return null;
    }

    const filename = path.basename(currentFilePath);
    const targetFilePath = path.join(targetDir, filename);

    if (path.dirname(currentFilePath) === targetDir) {
        return item.path;
    }

    if (!fs.existsSync(targetDir)) {
        fs.mkdirSync(targetDir, { recursive: true });
    }

    if (fs.existsSync(targetFilePath)) {
        const overwrite = await vscode.window.showWarningMessage(
            `File ${filename} already exists in ${targetDirName}/. Overwrite?`,
            'Overwrite',
            'Cancel'
        );
        if (overwrite !== 'Overwrite') {
            return item.path;
        }
    }

    try {
        fs.renameSync(currentFilePath, targetFilePath);

        const newRelativePath = path.relative(basePath, targetFilePath).replace(/\\/g, '/');
        return newRelativePath;
    } catch (error) {
        vscode.window.showErrorMessage(`Failed to move file: ${error}`);
        return item.path;
    }
}
