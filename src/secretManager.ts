import * as vscode from 'vscode';
import { getLogger } from './vscodeLogger';
import { ILogger } from './core/interfaces';

/**
 * Secret key constants
 */
const LLM_API_KEY_SECRET = 'private.model.provider.apiKey';
const GEMINI_API_KEY_SECRET = 'private.client.gemini.apiKey';

/**
 * Manages secure storage for sensitive configuration like API keys
 */
export class SecretManager {
  

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

  private static instance: SecretManager | null = null;
  private readonly secretStorage: vscode.SecretStorage;
  private readonly logger: ILogger;

  constructor(context?: vscode.ExtensionContext) {
    this.secretStorage = context?.secrets ?? (vscode.workspace as any).secrets;
    this.logger = getLogger();
  }

  /**
   * Initialize the singleton with extension context.
   * Must be called once during extension activation before getInstance().
   */
  static initialize(context: vscode.ExtensionContext): SecretManager {
    if (!SecretManager.instance) {
      SecretManager.instance = new SecretManager(context);
    }
    return SecretManager.instance;
  }



  private executewithApiKey(keyID: string, fn: (apiKey: string) => void) {
    return this.getApiKey(keyID).then(apiKey => {
      if (!apiKey) {
        throw new Error('API key is not configured. Please set it in the extension settings.');
      } 
      return fn(apiKey);
    });
  }

  public ExecuteWithClientApiKey(fn: (apiKey: string) => void) {
    return this.executewithApiKey(LLM_API_KEY_SECRET, fn);
  }

  public ExecuteWithGeminiApiKey(fn: (apiKey: string) => void) {
    return this.executewithApiKey(GEMINI_API_KEY_SECRET, fn);
  }

  /**
   * Get the API key from secure storage
   * Falls back to settings if not found in secrets (for migration)
   */
  public async getApiKey(keyID: string): Promise<string> {
    try {
      const secretKey = await this.secretStorage.get(keyID);
      if (secretKey) {
        return secretKey;
      }

      // Fallback: Check if there's a key in settings (legacy)
      const config = vscode.workspace.getConfiguration('private.model.provider');
      const settingsKey = config.get<string>('apiKey', '');
      
      if (settingsKey) {
        // Migrate to secure storage
        await this.setApiKey(keyID, settingsKey);
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
  async setApiKey(keyID: string, apiKey: string): Promise<void> {
    try {
      if (apiKey) {
        await this.secretStorage.store(keyID, apiKey);
        this.logger.info('[SECURITY] API key stored securely');
      } else {
        await this.secretStorage.delete(keyID);
        this.logger.info('[SECURITY] API key removed from secure storage');
      }
    } catch (error) {
      this.logger.error('[ERROR] Failed to store API key:', error);
      throw error;
    }
  }


  async setClientApiKey(apiKey: string) {
    return this.setApiKey(LLM_API_KEY_SECRET, apiKey);
  }

  async setGeminiApiKey(apiKey: string) {
    return this.setApiKey(GEMINI_API_KEY_SECRET, apiKey);
  }

  /**
   * Delete the API key from secure storage
   */
  async deleteApiKey(keyID: string): Promise<void> {
    try {
      await this.secretStorage.delete(keyID);
      this.logger.info('[SECURITY] API key deleted from secure storage');
    } catch (error) {
      this.logger.error('[ERROR] Failed to delete API key:', error);
      throw error;
    }
  }

  /**
   * Check if an API key is configured
   */
  async hasApiKey(keyID: string): Promise<boolean> {
    const key = await this.getApiKey(keyID);
    return key.length > 0;
  }


  static async getClientApiKey(): Promise<string> {
    if (!SecretManager.instance) {
      throw new Error('SecretManager is not initialized. Call SecretManager.initialize(context) first.');
    }
    return SecretManager.instance.getApiKey(LLM_API_KEY_SECRET);
  }

  static async getGeminiApiKey():Promise<string> {
    if (!SecretManager.instance) {
      throw new Error('SecretManager is not initialized. Call SecretManager.initialize(context) first.');
    }
    return SecretManager.instance.getApiKey(GEMINI_API_KEY_SECRET);
  }
}
