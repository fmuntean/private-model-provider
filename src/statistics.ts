import * as vscode from 'vscode';
import { TokenUsageByType } from './types';

/**
 * Statistics for a single request
 */
export interface RequestStats {
  modelId: string;
  inputTokens: number;
  outputTokens: number;
  responseTimeMs: number;
  timestamp: Date;
  messageType?: keyof TokenUsageByType;
}

/**
 * Session statistics summary
 */
export interface SessionStats {
  totalRequests: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  averageResponseTimeMs: number;
  lastResponseTimeMs: number;
  sessionStartTime: Date;
  tokenUsageByType: TokenUsageByType;
}

/**
 * Manages usage statistics for the extension
 */
export class StatisticsManager implements vscode.Disposable {
  private requests: RequestStats[] = [];
  private sessionStartTime: Date = new Date();
  private onStatsUpdateEmitter = new vscode.EventEmitter<SessionStats>();
  private tokenUsageByType: TokenUsageByType = {
    prompt: 0,
    context: 0,
    user: 0,
    agent: 0,
    tools: 0
  };

  /**
   * Event fired when statistics are updated
   */
  public readonly onStatsUpdate = this.onStatsUpdateEmitter.event;

  /**
   * Record a completed request
   */
  public recordRequest(stats: Omit<RequestStats, 'timestamp'>): void {
    this.requests.push({
      ...stats,
      timestamp: new Date(),
    });

    // Update per-type tracking if messageType is provided
    if (stats.messageType) {
      if (stats.messageType === 'prompt' || stats.messageType === 'context' || stats.messageType === 'user') {
        this.tokenUsageByType[stats.messageType] += stats.inputTokens;
      } else if (stats.messageType === 'agent' || stats.messageType === 'tools') {
        this.tokenUsageByType[stats.messageType] += stats.outputTokens;
      }
    }

    this.onStatsUpdateEmitter.fire(this.getSessionStats());
  }

  /**
   * Get session statistics summary
   */
  public getSessionStats(): SessionStats {
    const totalRequests = this.requests.length;
    const totalInputTokens = this.requests.reduce((sum, r) => sum + r.inputTokens, 0);
    const totalOutputTokens = this.requests.reduce((sum, r) => sum + r.outputTokens, 0);
    const totalResponseTime = this.requests.reduce((sum, r) => sum + r.responseTimeMs, 0);
    const lastRequest = this.requests[this.requests.length - 1];

    return {
      totalRequests,
      totalInputTokens,
      totalOutputTokens,
      averageResponseTimeMs: totalRequests > 0 ? Math.round(totalResponseTime / totalRequests) : 0,
      lastResponseTimeMs: lastRequest?.responseTimeMs ?? 0,
      sessionStartTime: this.sessionStartTime,
      tokenUsageByType: { ...this.tokenUsageByType }
    };
  }

  /**
   * Get statistics per model
   */
  public getModelStats(): Map<string, { requests: number; inputTokens: number; outputTokens: number }> {
    const modelStats = new Map<string, { requests: number; inputTokens: number; outputTokens: number }>();

    for (const request of this.requests) {
      const existing = modelStats.get(request.modelId) ?? { requests: 0, inputTokens: 0, outputTokens: 0 };
      modelStats.set(request.modelId, {
        requests: existing.requests + 1,
        inputTokens: existing.inputTokens + request.inputTokens,
        outputTokens: existing.outputTokens + request.outputTokens,
      });
    }

    return modelStats;
  }

  /**
   * Reset session statistics
   */
  public resetStats(): void {
    this.requests = [];
    this.sessionStartTime = new Date();
    this.tokenUsageByType = {
      prompt: 0,
      context: 0,
      user: 0,
      agent: 0,
      tools: 0
    };
    this.onStatsUpdateEmitter.fire(this.getSessionStats());
  }

  /**
   * Record usage information from the chat completion stream.
   * The `usage` object from the OpenAI compatible API contains token counts.
   * This method converts it into a `recordRequest` call so that the existing
   * statistics aggregation works without requiring callers to compute the
   * request duration themselves.
   */
  public async recordChatUsage(
    usage: { total_tokens: number; prompt_tokens: number; completion_tokens: number },
    modelId: string = 'unknown',
    messageType?: keyof TokenUsageByType
  ): Promise<void> {
    // Approximate response time as unknown here – callers can update later if needed.
    // We treat `prompt_tokens` as input and `completion_tokens` as output.
    this.recordRequest({
      modelId,
      inputTokens: usage.prompt_tokens ?? 0,
      outputTokens: usage.completion_tokens ?? 0,
      responseTimeMs: 0,
      messageType
    });
  }

  /**
   * Format token count for display
   */
  public static formatTokens(count: number): string {
    if (count >= 1000000) {
      return `${(count / 1000000).toFixed(1)}M`;
    }
    if (count >= 1000) {
      return `${(count / 1000).toFixed(1)}K`;
    }
    return count.toString();
  }

  /**
   * Format duration for display
   */
  public static formatDuration(ms: number): string {
    if (ms >= 60000) {
      return `${(ms / 60000).toFixed(1)}m`;
    }
    if (ms >= 1000) {
      return `${(ms / 1000).toFixed(1)}s`;
    }
    return `${ms}ms`;
  }

  public dispose(): void {
    this.onStatsUpdateEmitter.dispose();
  }
}
