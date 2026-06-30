import * as vscode from 'vscode';
import { getLogger } from './vscodeLogger';
import { ILogger } from './core/interfaces';

/**
 * Secret key constants
 */
const API_KEY_SECRET = 'private.model.provider.apiKey';

/**
 * Manages secure storage for sensitive configuration like API keys
 */
export class SecretManager {
  private static instance: SecretManager | null = null;
  private readonly secretStorage: vscode.SecretStorage;
  private readonly logger: ILogger;

  constructor(context?: vscode.ExtensionContext) {
    this.secretStorage = context?.secrets ?? (vscode.workspace as any).secrets;
    this.logger = getLogger();
  }

  /**
   * Singleton instance getter — creates the first instance and caches it
   */
  static getInstance(): SecretManager {
    if (!SecretManager.instance) {
      const context = vscode.workspace.getConfiguration('private.model.provider').get<vscode.ExtensionContext>('context');
      SecretManager.instance = new SecretManager(context);
    }
    return SecretManager.instance;
  }

  /**
   * Get the API key from secure storage
   * Falls back to settings if not found in secrets (for migration)
   */
  async getApiKey(): Promise<string> {
    try {
      const secretKey = await this.secretStorage.get(API_KEY_SECRET);
      if (secretKey) {
        return secretKey;
      }

      // Fallback: Check if there's a key in settings (legacy)
      const config = vscode.workspace.getConfiguration('private.model.provider');
      const settingsKey = config.get<string>('apiKey', '');
      
      if (settingsKey) {
        // Migrate to secure storage
        await this.setApiKey(settingsKey);
        this.logger.info('[SECURITY] Migrated API key from settings to secure storage');
        
        // Clear from settings
        await config.update('apiKey', undefined, vscode.ConfigurationTarget.Global);
        this.logger.info('[SECURITY] Cleared API key from settings');
        
        return settingsKey;
      }

      return '';
    } catch (error) {
      this.logger.error('[ERROR] Failed to retrieve API key:', error);
      return '';
    }
  }

  /**
   * Store the API key in secure storage
   */
  async setApiKey(apiKey: string): Promise<void> {
    try {
      if (apiKey) {
        await this.secretStorage.store(API_KEY_SECRET, apiKey);
        this.logger.info('[SECURITY] API key stored securely');
      } else {
        await this.secretStorage.delete(API_KEY_SECRET);
        this.logger.info('[SECURITY] API key removed from secure storage');
      }
    } catch (error) {
      this.logger.error('[ERROR] Failed to store API key:', error);
      throw error;
    }
  }

  /**
   * Delete the API key from secure storage
   */
  async deleteApiKey(): Promise<void> {
    try {
      await this.secretStorage.delete(API_KEY_SECRET);
      this.logger.info('[SECURITY] API key deleted from secure storage');
    } catch (error) {
      this.logger.error('[ERROR] Failed to delete API key:', error);
      throw error;
    }
  }

  /**
   * Check if an API key is configured
   */
  async hasApiKey(): Promise<boolean> {
    const key = await this.getApiKey();
    return key.length > 0;
  }
}
