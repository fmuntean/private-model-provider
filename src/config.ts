import * as vscode from 'vscode';
import { ExtensionConfig } from './types';

/**
 * Loads and validates the extension configuration.
 * Throws if required values are missing or invalid.
 */
export function loadConfig(): ExtensionConfig {
  const cfg = vscode.workspace.getConfiguration('localModelProvider');
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
