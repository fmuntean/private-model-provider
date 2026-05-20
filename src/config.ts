import * as vscode from 'vscode';
import { ExtensionConfig } from './types';

/**
 * Loads and validates the extension configuration.
 * Throws if required values are missing or invalid.
 */
export function loadConfig(): ExtensionConfig {
  // The extension's settings are defined under the "local.model.provider"
  // namespace (see package.json). Using the incorrect namespace caused all
  // configuration values – including the MCP server definitions – to be read
  // as undefined, which prevented the MCP manager from detecting any servers.
  const cfg = vscode.workspace.getConfiguration('local.model.provider');
  const config: ExtensionConfig = {
    defaultModelId: cfg.get<string>('defaultModelId'),
    maxConcurrentSessions: cfg.get<number>('maxConcurrentSessions'),
    verboseLogging: cfg.get<boolean>('verboseLogging'),
  };

  // Basic validation
  if (config.maxConcurrentSessions !== undefined && config.maxConcurrentSessions < 1) {
    throw new Error('maxConcurrentSessions must be >= 1');
  }
  return config;
}
