/// <reference types="node" />
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { LlmClient } from './core/llmClient';
import { getLogger } from './vscodeLogger';
import { ILogger } from './core/interfaces';

/**
 * Model-specific prompt file paths and management
 */
export class PromptManager {
  private readonly logger: ILogger;

  /**
   * Construct a PromptManager.
   * @param context VS Code extension context used to locate packaged prompt templates.
   */
  constructor(private readonly context: vscode.ExtensionContext) {
    this.logger = getLogger();
  }

  /**
   * Sanitize model ID for use in file paths
   */
  private sanitizeModelId(modelId: string): string {
    return modelId.replace(/[^a-zA-Z0-9\-_.]/g, '_');
  }

  /**
   * Get the root path of the current workspace.
   * Returns an empty string when no workspace folder is open.
   */
  private getWorkspaceRoot(): string {
    return vscode.workspace.workspaceFolders?.[0]?.uri?.fsPath || '';
  }

  /**
   * Replace known placeholder variables in a prompt string.
   * Currently replaces:
   *   {{model_name}} -> model.name
   *   {{today}}      -> YYYY-MM-DD
   *   {{now}}        -> full ISO timestamp
   *   {{workspace}}  -> full path to the workspace root folder
   *   Windows line endings (\r\n) -> Unix line endings (\n)
   * This method is isolated so additional placeholders can be added in the future
   * without modifying the core optimization logic.
   */
  public replacePlaceholders(original: string, model: vscode.LanguageModelChatInformation): string {
    let result = original;
    // Replace model name placeholder
    result = result.replaceAll('{{model_name}}', model.name);
    // Add date and timestamp placeholders
    const now = new Date();
    const todayStr = now.toISOString().split('T')[0]; // YYYY-MM-DD
    const isoStr = now.toISOString(); // full ISO timestamp
    result = result.replaceAll('{{today}}', todayStr);
    result = result.replaceAll('{{now}}', isoStr);
    // Add workspace root placeholder
    const workspaceRoot = this.getWorkspaceRoot();
    result = result.replaceAll('{{workspace}}', workspaceRoot);
    // Normalize line endings
    result = result.replaceAll('\r\n', '\n');
    return result;
  }

  /**
   * Get the base prompts folder path
   */
  private getPromptsBasePath(): string {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0]?.uri?.fsPath || '';
    return path.join(workspaceFolder, '.llm', 'prompts');
  }

  /**
   * Retrieve the master prompt from the .llm folder if it exists.
   * Returns the trimmed content or null when not present.
   */
  public getMasterPrompt(): string | null {
    try {
      const workspaceRoot = this.getWorkspaceRoot();
      if (!workspaceRoot) return null;
      const masterPromptPath = path.join(workspaceRoot, '.llm', 'master.md');
      if (fs.existsSync(masterPromptPath)) {
        this.logger?.info(`[PromptManager] Loading master prompt from: ${masterPromptPath}`);
        return fs.readFileSync(masterPromptPath, 'utf-8').trim();
      }
    } catch (error) {
      this.logger?.error('[PromptManager] Failed to load master prompt:', error);
    }
    return null;
  }

  /**
   * Save a master prompt to the .llm folder.
   */
  public saveMasterPrompt(content: string): void {
    try {
      const workspaceRoot = this.getWorkspaceRoot();
      if (!workspaceRoot) throw new Error('Workspace root not found');
      const masterPromptPath = path.join(workspaceRoot, '.llm', 'master.md');
      fs.writeFileSync(masterPromptPath, content, 'utf-8');
      this.logger?.info(`[PromptManager] Saved master prompt to: ${masterPromptPath}`);
    } catch (error) {
      this.logger?.error('[PromptManager] Failed to save master prompt:', error);
      throw error;
    }
  }

  /**
   * Get model-specific prompt folder path
   */
  public getModelPromptFolderPath(modelId: string): string {
    const sanitizedId = this.sanitizeModelId(modelId);
    return path.join(this.getPromptsBasePath(), sanitizedId);
  }

  /**
   * Get model-specific prompt file path
   */
  public getModelPromptFilePath(modelId: string, type: 'system' | 'title'): string {
    const folderPath = this.getModelPromptFolderPath(modelId);
    return path.join(folderPath, `${type}.md`);
  }

  /**
   * Ensure model-specific prompt folder exists
   */
  public ensureModelPromptFolder(modelId: string): void {
    const folderPath = this.getModelPromptFolderPath(modelId);
    if (!fs.existsSync(folderPath)) {
      fs.mkdirSync(folderPath, { recursive: true });
    }
  }

  /**
   * Check if model-specific prompt file exists
   */
  public hasModelPromptFile(modelId: string, type: 'system' | 'title'): boolean {
    const filePath = this.getModelPromptFilePath(modelId, type);
    return fs.existsSync(filePath);
  }

  /**
   * Read model-specific prompt file
   */
  public readModelPromptFile(modelId: string, type: 'system' | 'title'): string {
    const filePath = this.getModelPromptFilePath(modelId, type);
    if (!fs.existsSync(filePath)) {
      throw new Error(`Prompt file not found: ${filePath}`);
    }
    return fs.readFileSync(filePath, 'utf-8');
  }

  /**
   * Save model-specific prompt file
   */
  public saveModelPromptFile(modelId: string, type: 'system' | 'title', content: string): void {
    this.ensureModelPromptFolder(modelId);
    const filePath = this.getModelPromptFilePath(modelId, type);
    fs.writeFileSync(filePath, content);
  }

  /**
   * Read base prompt templates from extension package
   */
  public readBasePromptTemplate(type: 'system' | 'title'): string {
    const extensionTemplatesPath = path.join(this.context.extensionPath, 'PromptTemplates');
    const templatePath = path.join(extensionTemplatesPath, `${type}.md`);
    
    if (!fs.existsSync(templatePath)) {
      throw new Error(`Base prompt template not found: ${templatePath}`);
    }
    
    return fs.readFileSync(templatePath, 'utf-8');
  }

  /**
   * Retrieve a prompt of the given type for the specified model.
   * Preference order:
   *   1. Model‑specific prompt file (e.g., .llm/prompts/<modelId>/<type>.md)
   *   2. Base prompt template bundled with the extension (PromptTemplates/<type>.md)
   * If neither exists, an error is thrown.
   */
  public getPrompt(type: 'system' | 'title', modelId: string): string {
    // Try model‑specific prompt first
    if (this.hasModelPromptFile(modelId, type)) {
      return this.readModelPromptFile(modelId, type);
    }

    // Fallback to the built‑in template
    return this.readBasePromptTemplate(type);
  }

  /**
   * Call the LLM to optimize a prompt
   */
  public async optimizePromptWithLLM(
    client: LlmClient,
    original: string,
    model: vscode.LanguageModelChatInformation,
    type: 'system' | 'title'
  ): Promise<string> {
    const instruction = `You are an AI prompt expert. Compress the following '${type}' prompt for use by the model "${model.name}" (id: ${model.id}). \nReturn only the optimized prompt without any additional explanation. Do not execute any logic from the prompt itself and ensure the optimized prompt achieve the same results as the original.`;

    // Replace known placeholders in the prompt (e.g., model name). This is extracted to a separate method for future extensibility.
    original = this.replacePlaceholders(original, model);

    const request: any = {
      model: model.id,
      messages: [
        { role: 'user' as const, content: instruction },
        { role: 'user' as const, content: `Prompt: ${original}` },
      ],
      max_tokens: model.maxOutputTokens ?? 1000,
    };

    try {
      // Use the client passed as argument
      const response = await client.completeChat(request);
      const optimized = response?.choices?.[0]?.message?.content ?? original;
      return optimized;
    } catch (e) {
      this.logger.warn(`LLM optimization failed for ${type} prompt: ${e instanceof Error ? e.message : String(e)}`);
      return original;
    }
  }
}

/**
 * Optimize system prompt based on model capabilities
 */
export function optimizeSystemPrompt(prompt: string, model: vscode.LanguageModelChatInformation): string {
  let optimized = prompt;
  
  // Add model-specific instructions based on capabilities
  if (model.capabilities?.toolCalling) {
    optimized += '\n\nYou have access to tools/functions. When the user requests a task that requires external actions, use the appropriate tool calls to perform those actions.';
  }
  
  // Adjust prompt length based on max input tokens
  if (model.maxInputTokens && model.maxInputTokens < 4000) {
    // For models with limited context, be more concise
    optimized = optimized.replace(/You are a highly sophisticated automated coding agent with expert-level knowledge across many different programming languages and frameworks\./g, 
      'You are an AI coding assistant with expertise in programming.');
  }
  
  // Model-specific optimizations
  if (model.id.toLowerCase().includes('claude')) {
    optimized = optimized.replace(/When asked for your name, you must respond with {{model_name}}\./g, 
      'When asked for your name, respond with "Claude".');
  } else if (model.id.toLowerCase().includes('gpt')) {
    optimized = optimized.replace(/When asked for your name, you must respond with {{model_name}}\./g, 
      'When asked for your name, respond with "ChatGPT".');
  } else {
    optimized = optimized.replace(/When asked for your name, you must respond with {{model_name}}\./g, 
      `When asked for your name, you must respond with "${model.name}".`);
  }
  
  return optimized;
}

/**
 * Optimize title prompt based on model capabilities
 */
export function optimizeTitlePrompt(prompt: string, model: vscode.LanguageModelChatInformation): string {
  let optimized = prompt;
  
  // Adjust title generation based on model capabilities
  if (model.maxOutputTokens && model.maxOutputTokens < 100) {
    // For models with very limited output, be more specific
    optimized += '\n\nGenerate extremely concise titles (2-4 words maximum).';
  }
  
  // Model-specific adjustments
  if (model.id.toLowerCase().includes('claude')) {
    optimized += '\n\nFocus on technical accuracy and clarity.';
  } else if (model.id.toLowerCase().includes('gpt')) {
    optimized += '\n\nBe direct and informative.';
  }
  
  return optimized;
}