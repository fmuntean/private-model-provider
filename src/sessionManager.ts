/// <reference types="node" />
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { randomUUID } from 'crypto';
import {
  ChatSession,
  ChatSessionMetadata,
  ChatSessionMessage,
  ChatMessageType,
  SessionTokenUsage,
  TokenUsageByType,
  SessionManagerEvent
} from './types';
import { getLogger } from './logger';
import { PromptManager } from './prompts';

const SESSIONS_METADATA_FILE = 'sessions.json';
const MASTER_PROMPT_FOLDER = '.llm';

/**
 * Manages chat sessions with persistence to workspace ai-logs folder
 */
export class SessionManager implements vscode.Disposable {
  private sessions: Map<string, ChatSession> = new Map();
  private activeSessionId: string | null = null;
  private sessionsMetadataFile: string = '';
  private masterPromptFolder: string = '';
  private promptManager: PromptManager;
  private readonly _onDidChangeSession = new vscode.EventEmitter<SessionManagerEvent>();
  public readonly onDidChangeSession = this._onDidChangeSession.event;
  private readonly logger = getLogger();

  constructor(private readonly context: vscode.ExtensionContext) {
    this.initializePaths();
    this.promptManager = new PromptManager(this.context);
    this.loadSessions();
  }

  /**
   * Initialize file paths based on workspace
   */
  private initializePaths(): void {
    const workspaceRoot = this.getWorkspaceRoot();
    if (workspaceRoot) {
      const aiLogsDir = path.join(workspaceRoot, 'ai-logs');
      this.logger.info(`[SessionManager] Initializing paths. Workspace root: ${workspaceRoot}`);
      this.logger.info(`[SessionManager] ai-logs directory: ${aiLogsDir}`);
      // Ensure ai-logs directory exists
      fs.mkdirSync(aiLogsDir, { recursive: true });
      this.logger.debug(`[SessionManager] ai-logs directory created successfully`);
      this.sessionsMetadataFile = path.join(aiLogsDir, SESSIONS_METADATA_FILE);
      this.masterPromptFolder = path.join(workspaceRoot, MASTER_PROMPT_FOLDER);
    } else {
      this.logger.info(`[SessionManager] No workspace folder open, using fallback storage path`);
      // Fallback to extension storage path
      const storagePath = this.context.globalStorageUri.fsPath;
      this.sessionsMetadataFile = path.join(storagePath, SESSIONS_METADATA_FILE);
      this.masterPromptFolder = path.join(storagePath, MASTER_PROMPT_FOLDER);
    }

    // Ensure directories exist
    const aiLogsDir = path.dirname(this.sessionsMetadataFile);
    this.logger.debug(`[SessionManager] Ensuring directory exists: ${aiLogsDir}`);
    fs.mkdirSync(aiLogsDir, { recursive: true });
    fs.mkdirSync(this.masterPromptFolder, { recursive: true });
    this.logger.info(`[SessionManager] Paths initialized. sessionsMetadataFile: ${this.sessionsMetadataFile}`);
  }

  /**
   * Get workspace root path
   */
  private getWorkspaceRoot(): string | null {
    const folders = vscode.workspace.workspaceFolders;
    if (folders && folders.length > 0) {
      return folders[0].uri.fsPath;
    }
    return null;
  }

  /**
   * Load sessions from disk
   */
  private loadSessions(): void {
    try {
      if (fs.existsSync(this.sessionsMetadataFile)) {
        const data = fs.readFileSync(this.sessionsMetadataFile, 'utf-8');
        const metadataArray: ChatSessionMetadata[] = JSON.parse(data);
        
        for (const metadata of metadataArray) {
          const session = this.loadSessionMessages(metadata);
          this.sessions.set(session.id, session);
        }

        // Set active session to the most recently updated
        if (metadataArray.length > 0) {
          const sorted = [...metadataArray].sort(
            (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
          );
          this.activeSessionId = sorted[0].id;
        }
      }
    } catch (error) {
      this.logger.error('[SessionManager] Failed to load sessions:', error);
    }
  }

  /**
   * Load messages for a session from its JSONL file
   */
  private loadSessionMessages(metadata: ChatSessionMetadata): ChatSession {
    const session: ChatSession = {
      ...metadata,
      messages: []
    };

    try {
      const workspaceRoot = this.getWorkspaceRoot();
      if (!workspaceRoot) return session;

      // Find the JSONL file for this session across all date folders
      const aiLogsDir = path.join(workspaceRoot, 'ai-logs');
      if (!fs.existsSync(aiLogsDir)) {
        this.logger.warn(`[SessionManager] ai-logs directory not found: ${aiLogsDir}`);
        return session;
      }

      const dateFolders = fs.readdirSync(aiLogsDir).filter(name => {
        // Simple check for YYYY-MM-DD format
        return /^\d{4}-\d{2}-\d{2}$/.test(name);
      });

      this.logger.info(`[SessionManager] Searching for session ${metadata.id} in ${dateFolders.length} date folders`);

      for (const dateFolder of dateFolders) {
        const folderPath = path.join(aiLogsDir, dateFolder);
        const files = fs.readdirSync(folderPath);
        const sessionFile = files.find(f => f.includes(metadata.id) && f.endsWith('.jsonl'));
        if (sessionFile) {
          const filePath = path.join(folderPath, sessionFile);
          this.logger.info(`[SessionManager] Loading session messages from: ${filePath}`);
          const content = fs.readFileSync(filePath, 'utf-8');
          const lines = content.split('\n').filter(line => line.trim());
          for (const line of lines) {
            try {
              const entry = JSON.parse(line);
              if (entry.type === 'message' && entry.message) {
                session.messages.push(entry.message);
              }
            } catch {
              // Skip invalid lines
            }
          }
          this.logger.info(`[SessionManager] Loaded ${session.messages.length} messages for session ${metadata.id}`);
          // Once found, stop searching other folders
          break;
        }
      }
    } catch (error) {
      this.logger.error('[SessionManager] Failed to load session messages:', error);
    }

    return session;
  }

  /**
   * Save sessions metadata to disk
   */
  private saveSessionsMetadata(): void {
    try {
      const metadataArray: ChatSessionMetadata[] = [];
      for (const session of this.sessions.values()) {
        metadataArray.push({
          id: session.id,
          title: session.title,
          createdAt: session.createdAt,
          updatedAt: session.updatedAt,
          modelId: session.modelId,
          messageCount: session.messages.length,
          tokenUsage: session.tokenUsage
        });
      }
      fs.writeFileSync(this.sessionsMetadataFile, JSON.stringify(metadataArray, null, 2));
      this.logger.info(`[SessionManager] Saved metadata for ${metadataArray.length} sessions`);
    } catch (error) {
      this.logger.error('[SessionManager] Failed to save sessions metadata:', error);
    }
  }

  /**
   * Save session messages to a JSONL file in ai-logs/YYYY-MM-DD/HHMM-sessionId.jsonl
   */
  private saveSessionMessages(session: ChatSession): void {
    try {
      // Use the ai-logs directory from initializePaths()
      const aiLogsDir = path.dirname(this.sessionsMetadataFile);
      
      this.logger.info(`[SessionManager] saveSessionMessages() called for session: ${session.id}`);
      this.logger.debug(`[SessionManager] Using ai-logs directory: ${aiLogsDir}`);
      
      // Ensure ai-logs directory exists
      if (!fs.existsSync(aiLogsDir)) {
        this.logger.info(`[SessionManager] Creating ai-logs directory: ${aiLogsDir}`);
        fs.mkdirSync(aiLogsDir, { recursive: true });
      }
      
      const sessionDate = new Date(session.createdAt);
      const dateFolder = sessionDate.toISOString().slice(0, 10); // YYYY-MM-DD
      const dateDir = path.join(aiLogsDir, dateFolder);
      
      this.logger.info(`[SessionManager] Saving session messages to: ${dateDir}`);
      fs.mkdirSync(dateDir, { recursive: true });

      const hhmm = sessionDate.getUTCHours().toString().padStart(2, '0') + 
                   sessionDate.getUTCMinutes().toString().padStart(2, '0');
      
      const fileName = `${hhmm}-${session.id}.jsonl`;
      const filePath = path.join(dateDir, fileName);

      // Write each message as a JSONL line
      if (session.messages.length === 0) {
        this.logger.info(`[SessionManager] No messages to save for session: ${session.id}`);
        return;
      }
      
      const lines = session.messages.map(msg => 
        JSON.stringify({ type: 'message', message: msg })
      );
      fs.writeFileSync(filePath, lines.join('\n') + '\n');
      
      this.logger.info(`[SessionManager] Successfully saved ${session.messages.length} messages to ${filePath}`);
    } catch (error) {
      this.logger.error('[SessionManager] Failed to save session messages:', error);
    }
  }

  /**
   * Create a new chat session
   */
  public createSession(modelId: string = 'default'): ChatSession {
    const sessionId = randomUUID();
    const now = new Date().toISOString();
    console.log(`[SessionManager] Creating new session with ID: ${sessionId}, model: ${modelId}`);
    
    const session: ChatSession = {
      id: sessionId,
      title: 'New Chat',
      createdAt: now,
      updatedAt: now,
      modelId,
      messageCount: 0,
      tokenUsage: this.createEmptyTokenUsage(),
      messages: []
    };

    // Add master prompt as the first message if available
    const masterPrompt = this.promptManager.getMasterPrompt();
    if (masterPrompt) {
      let model = {name:modelId} as vscode.LanguageModelChatInformation;
      let prompt = this.promptManager.replacePlaceholders(masterPrompt,model);
      const promptMessage: ChatSessionMessage = {
        id: randomUUID(),
        type: 'prompt',
        role: 'system',
        content: prompt,
        timestamp: now,
        modelId: modelId // Track which model this prompt is for
      };
      session.messages.push(promptMessage);
      session.messageCount = 1;
      this.logger.info(`[SessionManager] Added master prompt to session ${sessionId}`);
    }

    // Load system prompt using PromptManager.getPrompt (no optimization)
    try {
      const systemPrompt = this.promptManager.getPrompt('system', modelId);
      let model = {name:modelId} as vscode.LanguageModelChatInformation;
      let prompt = this.promptManager.replacePlaceholders(systemPrompt,model);
      const systemMessage: ChatSessionMessage = {
        id: randomUUID(),
        type: 'prompt',
        role: 'system',
        content: prompt,
        timestamp: now,
        modelId: modelId
      };
      session.messages.push(systemMessage);
      session.messageCount += 1;
      this.logger.info(`[SessionManager] Added system prompt to session ${sessionId}`);
    } catch (e) {
      this.logger.warn(`[SessionManager] Failed to load system prompt: ${e instanceof Error ? e.message : String(e)}`);
    }

    this.sessions.set(sessionId, session);
    this.activeSessionId = sessionId;
    this.saveSessionsMetadata();
    this.saveSessionMessages(session);
    this.logger.info(`[SessionManager] Session ${sessionId} created and set as active`);
    
    this._onDidChangeSession.fire({ type: 'created', sessionId });
    return session;
  }

  /**
   * Update the model ID for the currently active session and persist the change.
   * This is used when the user selects a different model from the model picker
   * after a session has already been created.
   */
  public setActiveSessionModel(modelId: string): void {
    if (!this.activeSessionId) {
      this.logger.warn('[SessionManager] No active session to set model for');
      return;
    }
    const session = this.sessions.get(this.activeSessionId);
    if (!session) {
      this.logger.warn('[SessionManager] Active session not found in map');
      return;
    }
    session.modelId = modelId;
    session.updatedAt = new Date().toISOString();
    this.logger.info(`[SessionManager] Updated model for session ${session.id} to ${modelId}`);
    // Persist metadata change
    this.saveSessionsMetadata();
    this._onDidChangeSession.fire({ type: 'updated', sessionId: session.id });
  }

  /**
   * Delete a session
   */
  public deleteSession(sessionId: string): boolean {
    if (!this.sessions.has(sessionId)) return false;

    this.sessions.delete(sessionId);
    
    // If we deleted the active session, switch to another
    if (this.activeSessionId === sessionId) {
      const remaining = Array.from(this.sessions.keys());
      this.activeSessionId = remaining.length > 0 ? remaining[0] : null;
    }

    this.saveSessionsMetadata();
    this._onDidChangeSession.fire({ type: 'deleted', sessionId });
    return true;
  }

  /**
   * Switch to a different session
   */
  public switchSession(sessionId: string): boolean {
    if (!this.sessions.has(sessionId)) return false;
    
    this.activeSessionId = sessionId;
    const session = this.sessions.get(sessionId)!;
    session.updatedAt = new Date().toISOString();
    this.saveSessionsMetadata();
    
    this._onDidChangeSession.fire({ type: 'switched', sessionId });
    return true;
  }

  /**
   * Get the active session
   */
  public getActiveSession(): ChatSession | null {
    if (!this.activeSessionId) return null;
    return this.sessions.get(this.activeSessionId) || null;
  }

  /**
   * Get all sessions metadata (for listing)
   */
  public getAllSessions(): ChatSessionMetadata[] {
    const sessions = Array.from(this.sessions.values());
    return sessions.map(s => ({
      id: s.id,
      title: s.title,
      createdAt: s.createdAt,
      updatedAt: s.updatedAt,
      modelId: s.modelId,
      messageCount: s.messages.length,
      tokenUsage: s.tokenUsage
    })).sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
  }

  /**
   * Add a message to the active session
   */
  public addMessage(
    type: ChatMessageType,
    role: 'system' | 'user' | 'assistant' | 'tool',
    content: string,
    additionalData?: {
      toolCalls?: Array<{ id: string; name: string; arguments: string }>;
      toolCallId?: string;
      modelId?: string; // Track which model generated this message
    }
  ): ChatSessionMessage | null {
    const session = this.getActiveSession();
    if (!session) return null;

    const message: ChatSessionMessage = {
      id: randomUUID(),
      type,
      role,
      content,
      timestamp: new Date().toISOString(),
      ...additionalData
    };

    session.messages.push(message);
    session.messageCount = session.messages.length;
    session.updatedAt = new Date().toISOString();
    
    // Track the last used model (for assistant messages)
    if (additionalData?.modelId) {
      session.lastUsedModel = additionalData.modelId;
    }
    
    this.saveSessionsMetadata();
    this.saveSessionMessages(session);
    this._onDidChangeSession.fire({ type: 'updated', sessionId: session.id });
    
    return message;
  }

  /**
   * Update session title (e.g., generated from first user message)
   */
  public updateSessionTitle(sessionId: string, title: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    session.title = title.substring(0, 50); // Limit title length
    session.updatedAt = new Date().toISOString();
    this.saveSessionsMetadata();
  }

  /**
   * Update token usage for the active session
   */
  public updateTokenUsage(
    messageType: ChatMessageType,
    inputTokens: number,
    outputTokens: number
  ): void {
    const session = this.getActiveSession();
    if (!session) return;

    // Update by-type usage
    const byType = session.tokenUsage.byType;
    switch (messageType) {
      case 'prompt':
        byType.prompt += inputTokens;
        break;
      case 'context':
        byType.context += inputTokens;
        break;
      case 'user':
        byType.user += inputTokens;
        break;
      case 'agent':
        byType.agent += outputTokens;
        break;
      case 'tools':
        byType.tools += outputTokens;
        break;
    }

    // Update totals
    session.tokenUsage.total.inputTokens += inputTokens;
    session.tokenUsage.total.outputTokens += outputTokens;
    session.tokenUsage.total.totalTokens = 
      session.tokenUsage.total.inputTokens + session.tokenUsage.total.outputTokens;

    this.saveSessionsMetadata();
    this.saveSessionMessages(session);
  }

  // Master prompt handling moved to PromptManager

  /**
   * Create empty token usage object
   */
  private createEmptyTokenUsage(): SessionTokenUsage {
    return {
      byType: {
        prompt: 0,
        context: 0,
        user: 0,
        agent: 0,
        tools: 0
      },
      total: {
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0
      }
    };
  }

  /**
   * Dispose resources
   */
  public dispose(): void {
    this._onDidChangeSession.dispose();
  }
}
