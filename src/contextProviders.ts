import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { exec } from 'child_process';

/**
 * Interface for a generic context provider.
 * Implementations should return a string that can be appended to the chat
 * request as additional context.
 */
export interface ContextProvider {
  /**
   * Retrieve context data.
   * @returns A promise that resolves to a string containing the context.
   */
  getContext(): Promise<string>;
}

/**
 * FileContextProvider – reads the contents of a specific file and returns it.
 * The file path can be configured via the constructor.
 */
export class FileContextProvider implements ContextProvider {
  constructor(private readonly filePath: string) {}

  async getContext(): Promise<string> {
    try {
      const absolutePath = path.isAbsolute(this.filePath)
        ? this.filePath
        : path.join(vscode.workspace.rootPath ?? '', this.filePath);
      const content = await fs.promises.readFile(absolutePath, 'utf8');
      return `File: ${absolutePath}\n\n${content}`;
    } catch (e) {
      // Return a helpful message rather than throwing – the provider is optional.
      return `Failed to read file ${this.filePath}: ${(e as Error).message}`;
    }
  }
}

/**
 * CodeContextProvider – returns the surrounding code (a few lines before and
 * after) of the current cursor position in the active editor.
 */
export class CodeContextProvider implements ContextProvider {
  /** Number of lines of context before and after the cursor. */
  private readonly radius: number;

  constructor(radius: number = 5) {
    this.radius = radius;
  }

  async getContext(): Promise<string> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      return 'No active editor – cannot provide code context.';
    }
    const doc = editor.document;
    const line = editor.selection.active.line;
    const start = Math.max(0, line - this.radius);
    const end = Math.min(doc.lineCount - 1, line + this.radius);
    const range = new vscode.Range(start, 0, end, doc.lineAt(end).text.length);
    const snippet = doc.getText(range);
    return `Code context (lines ${start + 1}-${end + 1}) from ${path.basename(
      doc.fileName
    )}:\n\n${snippet}`;
  }
}

/**
 * DiffContextProvider – obtains the git diff for the workspace (or a specific
 * file) and returns it as context.
 */
export class DiffContextProvider implements ContextProvider {
  constructor(private readonly cwd: string = vscode.workspace.rootPath ?? '') {}

  async getContext(): Promise<string> {
    return new Promise<string>((resolve) => {
      exec('git diff', { cwd: this.cwd }, (error, stdout, stderr) => {
        if (error) {
          resolve(`Failed to get git diff: ${stderr || error.message}`);
        } else if (!stdout) {
          resolve('No git diff – working tree clean.');
        } else {
          resolve(`Git diff context:\n\n${stdout}`);
        }
      });
    });
  }
}

/**
 * Helper to combine multiple providers into a single context string.
 */
export async function combineContext(providers: ContextProvider[]): Promise<string> {
  const parts = await Promise.all(providers.map((p) => p.getContext()));
  return parts.filter(Boolean).join('\n\n---\n\n');
}
