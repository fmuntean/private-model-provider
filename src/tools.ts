/**
 * Helper utilities for invoking GitHub Copilot internal tools from this extension.
 *
 * The Copilot extension registers a set of commands prefixed with
 * `copilot.runTool.<toolName>`.  By executing those commands through the VS Code
 * command API we can reuse the same functionality that the Copilot chat UI
 * provides (read files, apply patches, run terminals, etc.).
 */

import * as vscode from 'vscode';

/**
 * Generic runner for a Copilot tool command.
 *
 * @param toolName The name of the Copilot tool (e.g. "readFile", "applyPatch").
 * @param args     Arguments object that matches the tool's JSON schema.
 * @returns        A promise that resolves with the tool's result.
 */
export async function runCopilotTool<T>(toolName: string, args: any): Promise<T> {
    // Try to activate the Copilot extension if it exists. In some environments the
    // extension may be present but not yet activated, causing `getExtension` to
    // return undefined. We fall back to executing the command directly – VS Code
    // will queue the command until the extension activates.
    const extensionId = 'GitHub.copilot';
    const copilotExt = vscode.extensions.getExtension(extensionId);
    if (copilotExt) {
        try {
            await copilotExt.activate();
        } catch (e) {
            // Activation failed – log but continue to attempt the command.
            console.warn(`[LMP] Failed to activate ${extensionId}: ${e}`);
        }
    } else {
        // Extension not found – still attempt the command; VS Code may have the
        // command registered via another source (e.g., built‑in).
        console.warn(`[LMP] Copilot extension ${extensionId} not found; attempting command directly.`);
    }

    const commandId = `copilot.runTool.${toolName}`;
    // The command returns whatever the underlying tool resolves to.
    return vscode.commands.executeCommand<T>(commandId, args);
}

/**
 * Execute a shell command locally and capture its output.
 * This is a simple fallback used when the Copilot runInTerminal tool is unavailable.
 * It runs the command synchronously (via exec) and returns an object containing
 * `stdout`, `stderr` and the exit `code`.
 */
export async function runInTerminalLocal(command: string, options?: { cwd?: string; timeout?: number }): Promise<{ stdout: string; stderr: string; code: number }> {
    const { exec } = await import('child_process');
    // On Windows we want to run the command in PowerShell to support its syntax.
    //const isWin = process.platform === 'win32';
    const execCommand = `pwsh -NoProfile -Command "${command.replace(/"/g, '\"')}"`;
    return new Promise((resolve, reject) => {
        exec(execCommand, { cwd: options?.cwd, timeout: options?.timeout }, (error, stdout, stderr) => {
            if (error) {
                // error.code may be undefined; default to 1
                resolve({ stdout, stderr, code: (error as any).code ?? 1 });
            } else {
                resolve({ stdout, stderr, code: 0 });
            }
        });
    });
}

/** Read a portion of a file. */
export async function readFile(
    filePath: string,
    startLine: number = 1,
    endLine: number = Number.MAX_SAFE_INTEGER
): Promise<string> {
    const result = await runCopilotTool<any>('readFile', {
        filePath,
        startLine,
        endLine,
    });
    // The tool returns an object with a `content` field containing the text.
    return result?.content ?? '';
}

/** Apply a patch to a file using the Copilot applyPatch tool. */
export async function applyPatch(
    explanation: string,
    patch: string
): Promise<any> {
    return runCopilotTool<any>('applyPatch', { explanation, input: patch });
}

/** Run a command in the integrated terminal. */
export async function runInTerminal(
    command: string,
    explanation: string,
    goal: string,
    mode: 'sync' | 'async' = 'sync',
    timeout?: number
): Promise<any> {
    return runCopilotTool<any>('runInTerminal', {
        command,
        explanation,
        goal,
        mode,
        timeout,
    });
}

/** Retrieve output from a terminal started with runInTerminal (async mode). */
export async function getTerminalOutput(id: string): Promise<any> {
    return runCopilotTool<any>('getTerminalOutput', { id });
}

/** Perform a semantic search across the workspace. */
export async function semanticSearch(query: string): Promise<any> {
    return runCopilotTool<any>('semanticSearch', { query });
}

/** Ask the user a series of questions via the Copilot UI. */
export async function askQuestions(questions: any[]): Promise<any> {
    return runCopilotTool<any>('vscodeAskQuestions', { questions });
}

/**
 * Return the array of tool definitions compatible with the OpenAI function‑calling API.
 * This mirrors the previous implementation that lived in `llmClient.ts`.
 */
export function getToolDefinitions(): any[] {
    // Base tool definitions used by the extension
    const baseTools = [
        {
            type: 'function',
            function: {
                name: 'readFile',
                description: 'Read a portion of a file from the workspace.',
                parameters: {
                    type: 'object',
                    properties: {
                        filePath: { type: 'string', description: 'Absolute path to the file.' },
                        startLine: { type: 'integer', description: '1‑based start line.', default: 1 },
                        endLine: { type: 'integer', description: '1‑based end line.', default: 1000 }
                    },
                    required: ['filePath']
                }
            }
        },
        {
            type: 'function',
            function: {
                name: 'semanticSearch',
                description: 'Perform a semantic search across the workspace.',
                parameters: {
                    type: 'object',
                    properties: { query: { type: 'string', description: 'Search query string.' } },
                    required: ['query']
                }
            }
        },
        {
            type: 'function',
            function: {
                name: 'askQuestions',
                description: 'Ask the user a series of questions via the Copilot UI.',
                parameters: {
                    type: 'object',
                    properties: {
                        questions: {
                            type: 'array',
                            description: 'List of question objects.',
                            items: {
                                type: 'object',
                                properties: {
                                    header: { type: 'string' },
                                    question: { type: 'string' },
                                    message: { type: 'string' },
                                    allowFreeformInput: { type: 'boolean' },
                                    multiSelect: { type: 'boolean' },
                                    options: {
                                        type: 'array',
                                        items: {
                                            type: 'object',
                                            properties: {
                                                label: { type: 'string' },
                                                description: { type: 'string' },
                                                recommended: { type: 'boolean' }
                                            },
                                            required: ['label']
                                        }
                                    }
                                },
                                required: ['header', 'question']
                            }
                        }
                    },
                    required: ['questions']
                }
            }
        },
        {
            type: 'function',
            function: {
                name: 'applyPatch',
                description: 'Apply a diff/patch to a file in the workspace.',
                parameters: {
                    type: 'object',
                    properties: {
                        explanation: { type: 'string', description: 'Why the patch is being applied.' },
                        patch: { type: 'string', description: 'The V4A‑style patch string.' }
                    },
                    required: ['explanation', 'patch']
                }
            }
        },
        {
            type: 'function',
            function: {
                name: 'runInTerminal',
                description: 'Execute a shell command in the integrated terminal.',
                parameters: {
                    type: 'object',
                    properties: {
                        command: { type: 'string', description: 'Command line to run.' },
                        explanation: { type: 'string', description: 'Human readable explanation shown to the user.' },
                        goal: { type: 'string', description: 'Short goal description (e.g. "Install dependencies").' },
                        mode: { type: 'string', enum: ['sync', 'async'], description: 'Execution mode.' },
                        timeout: { type: 'integer', description: 'Optional timeout in ms (sync only).' }
                    },
                    required: ['command', 'explanation', 'goal']
                }
            }
        }
    ];

    // Attempt to include MCP‑provided tools if the manager is available.
    try {
        // Dynamically require to avoid circular dependency issues.
        const { MCPManager } = require('./mcp');
        const mcp = new MCPManager();
        const mcpTools = mcp.getToolDefinitions();
        if (Array.isArray(mcpTools) && mcpTools.length > 0) {
            return baseTools.concat(mcpTools);
        }
    } catch (e) {
        // If MCP manager cannot be loaded, just log and continue with base tools.
        console.warn('[tools] MCP manager not available or failed to load:', e);
    }

    return baseTools;
}

/** List code usages for a symbol. */
export async function listCodeUsages(params: {
    filePath?: string;
    uri?: string;
    lineContent: string;
    symbol: string;
}): Promise<any> {
    return runCopilotTool<any>('vscodeListCodeUsages', params);
}

/** Rename a symbol across the workspace. */
export async function renameSymbol(params: {
    filePath?: string;
    uri?: string;
    lineContent: string;
    symbol: string;
    newName: string;
}): Promise<any> {
    return runCopilotTool<any>('vscodeRenameSymbol', params);
}

/** Convenience wrapper to log messages using the webview logger. */
export function log(level: string, message: string) {
    // This function mirrors the logger used in the webview but routes through
    // the extension host.  It simply forwards to the console – extensions can
    // replace this with a proper output channel if desired.
    const prefix = '[LMP]';
    const formatted = `${prefix} ${message}`;
    switch (level) {
        case 'error':
            console.error(formatted);
            break;
        case 'warn':
            console.warn(formatted);
            break;
        case 'debug':
            console.debug(formatted);
            break;
        default:
            console.log(formatted);
    }
}

// Export a default object for easier import elsewhere.
export default {
    runCopilotTool,
    readFile,
    applyPatch,
    runInTerminal,
    getTerminalOutput,
    semanticSearch,
    askQuestions,
    listCodeUsages,
    renameSymbol,
    log,
};
