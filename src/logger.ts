import * as vscode from 'vscode';

/**
 * Log levels for the centralized logger
 */
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

/**
 * Centralized logger for the Local Model Provider extension
 * Outputs to a dedicated VSCode OutputChannel
 */
export class Logger implements vscode.Disposable {
  private outputChannel: vscode.OutputChannel;
  private static instance: Logger | undefined;

  private constructor(name: string = 'Local Model') {
    this.outputChannel = vscode.window.createOutputChannel(name);
  }

  /**
   * Get the singleton instance of the logger
   */
  public static getInstance(name?: string): Logger {
    if (!Logger.instance) {
      Logger.instance = new Logger(name);
    }
    return Logger.instance;
  }

  /**
   * Get the configured log level from VS Code settings
   */
  private getConfiguredLogLevel(): LogLevel {
    const config = vscode.workspace.getConfiguration('local.model.provider');
    return config.get<LogLevel>('logLevel', 'info');
  }

  /**
   * Check if a message at the given level should be logged
   */
  private shouldLog(level: LogLevel): boolean {
    const configuredLevel = this.getConfiguredLogLevel();
    return LOG_LEVELS[level] >= LOG_LEVELS[configuredLevel];
  }

  /**
   * Log an info message
   */
  public info(message: string): void {
    if (!this.shouldLog('info')) return;
    this.log('INFO', message);
  }

  /**
   * Log a warning message
   */
  public warn(message: string): void {
    if (!this.shouldLog('warn')) return;
    this.log('WARN', message);
  }

  /**
   * Log an error message
   */
  public error(message: string, error?: unknown): void {
    if (!this.shouldLog('error')) return;
    this.log('ERROR', message);
    if (error) {
      if (error instanceof Error) {
        this.log('ERROR', `  Stack: ${error.stack || error.message}`);
      } else {
        this.log('ERROR', `  Details: ${String(error)}`);
      }
    }
  }

  /**
   * Log a debug message (only when log level includes debug)
   */
  public debug(message: string): void {
    if (!this.shouldLog('debug')) return;
    this.log('DEBUG', message);
  }

  /**
   * Internal method to write log entries with timestamp
   */
  private log(level: string, message: string): void {
    const timestamp = new Date().toISOString();
    const formattedMessage = `[${timestamp}] [${level.padEnd(5)}] ${message}`;
    this.outputChannel.appendLine(formattedMessage);
  }

  /**
   * Show the output channel
   */
  public show(): void {
    this.outputChannel.show();
  }

  /**
   * Clear the output channel
   */
  public clear(): void {
    this.outputChannel.clear();
  }

  /**
   * Get the output channel for external use
   */
  public getOutputChannel(): vscode.OutputChannel {
    return this.outputChannel;
  }

  /**
   * Dispose the output channel
   */
  public dispose(): void {
    this.outputChannel.dispose();
  }
}

/**
 * Convenience function to get the logger instance
 */
export function getLogger(): Logger {
  return Logger.getInstance();
}
