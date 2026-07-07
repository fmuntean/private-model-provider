import * as vscode from 'vscode';
import { ExtensionConfig, GatewayConfig } from './types';
import { IllmClientConfig } from './core/interfaces';
import { SecretManager } from './secretManager';

/**
 * Loads and validates the extension configuration.
 * Throws if required values are missing or invalid.
 */
export function loadConfig(): ExtensionConfig {
  // The extension's settings are defined under the "private.model.provider"
  // namespace (see package.json). Using the incorrect namespace caused all
  // configuration values – including the MCP server definitions – to be read
  // as undefined, which prevented the MCP manager from detecting any servers.
  const cfg = vscode.workspace.getConfiguration('private.model.provider');
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

/**
 * Get Gemini client config using SecretManager for secure API key retrieval.
 * Must be called after SecretManager is initialized.
 */
export async function getGeminiConfig(secretManager: SecretManager): Promise<IllmClientConfig> {
  const cfg = vscode.workspace.getConfiguration('private.client.gemini');

  // Normalize server URL (remove trailing slash and optional /v1 segment)
  let serverUrlRaw = cfg.get<string>('serverUrl', 'https://generativelanguage.googleapis.com');
  // Remove trailing /v1 if present
  if (/\/v1\/?$/.test(serverUrlRaw)) {
    serverUrlRaw = serverUrlRaw.replace(/\/v1\/?$/, '');
    //this.logger.info('NOTE: Stripped trailing /v1 from serverUrl setting to avoid duplicated path.');
  }
  // Remove any trailing slash
  if (/\/$/.test(serverUrlRaw)) {
    serverUrlRaw = serverUrlRaw.replace(/\/+$/, '');
    //this.logger.info('NOTE: Stripped trailing slash from serverUrl setting.');
  }


  const config: IllmClientConfig = {
    apiKey: await SecretManager.getGeminiApiKey(),
    serverUrl: serverUrlRaw,
    requestTimeout: cfg.get<number>('requestTimeout', 60000),
  };

  return config;
}

/**
 * Get LLM client config using SecretManager for secure API key retrieval.
 * Must be called after SecretManager is initialized.
 */
export async function getClientConfig(secretManager: SecretManager): Promise<IllmClientConfig> {
  const cfg = vscode.workspace.getConfiguration('private.model.provider');

  // Normalize server URL (remove trailing slash and optional /v1 segment)
  let serverUrlRaw = cfg.get<string>('serverUrl', 'http://localhost:8000');
  // Remove trailing /v1 if present
  if (/\/v1\/?$/.test(serverUrlRaw)) {
    serverUrlRaw = serverUrlRaw.replace(/\/v1\/?$/, '');
    //this.logger.info('NOTE: Stripped trailing /v1 from serverUrl setting to avoid duplicated path.');
  }
  // Remove any trailing slash
  if (/\/$/.test(serverUrlRaw)) {
    serverUrlRaw = serverUrlRaw.replace(/\/+$/, '');
    //this.logger.info('NOTE: Stripped trailing slash from serverUrl setting.');
  }

  

  const config: IllmClientConfig = {
    serverUrl: serverUrlRaw,
    requestTimeout: cfg.get<number>('requestTimeout', 60000),
  };
  return config;
}

export function getExtensionConfig(): ExtensionConfig {
  const cfg = vscode.workspace.getConfiguration('private.model.provider');
  const config: ExtensionConfig = {
    defaultModelId: cfg.get<string>('defaultModelId'),
    maxConcurrentSessions: cfg.get<number>('maxConcurrentSessions'),
    verboseLogging: cfg.get<boolean>('verboseLogging'),
  };
  return config;
}

export function getGatewayConfig(): GatewayConfig {
  const cfg = vscode.workspace.getConfiguration('private.model.provider');
  const config: GatewayConfig = {
    defaultMaxTokens: cfg.get<number>('defaultMaxTokens', 32768),
    defaultMaxOutputTokens: cfg.get<number>('defaultMaxOutputTokens', 4096),
    enableToolCalling: cfg.get<boolean>('enableToolCalling', true),
    parallelToolCalling: cfg.get<boolean>('parallelToolCalling', false),
    agentTemperature: cfg.get<number>('agentTemperature', 0.7),
    topP: cfg.get<number>('topP', 1.0),
    frequencyPenalty: cfg.get<number>('frequencyPenalty', 0.0),
    presencePenalty: cfg.get<number>('presencePenalty', 0.0),
    maxRetries: cfg.get<number>('maxRetries', 3),
    retryDelayMs: cfg.get<number>('retryDelayMs', 500),
    modelCacheTtlMs: cfg.get<number>('modelCacheTtlMs', 60000),
    logLevel: cfg.get<'debug' | 'info' | 'warn' | 'error'>('logLevel', 'info'),
  };
  return config;
}