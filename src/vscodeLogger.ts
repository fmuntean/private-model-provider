import * as vscode from 'vscode';
import { ILogger, IOutputChannel, IConfigProvider } from './core/interfaces';
import { BaseLogger, LogLevel } from './core/BaseLogger';

/**
 * Log levels for the centralized logger
 */
// NOTE: LogLevel and LOG_LEVELS are now provided by BaseLogger.

/**
 * Centralized logger for the Private Model Provider extension
 * Outputs to a dedicated VSCode OutputChannel
 *
 * TODO: Replace VS Code specific APIs with injected abstractions for CLI usage.
 */
export class Logger extends BaseLogger implements ILogger,vscode.Disposable, ILogger {
  private outputChannel: IOutputChannel;
  private configProvider: IConfigProvider;
  // Separate static instance for the VS Code logger to avoid conflict with
  // BaseLogger's private static `instance` property.
  private static loggerInstance: Logger | undefined;

  /**
   * Private constructor – callers should use {@link Logger.getInstance}.
   * The constructor receives concrete implementations of the output channel
   * and configuration provider. This enables the logger to be used in a CLI
   * environment without pulling in VS Code APIs.
   */
  private constructor(
    name: string = 'Private Model',
    outputChannel: IOutputChannel,
    configProvider: IConfigProvider
  ) {
    super();
    this.outputChannel = outputChannel;
    this.configProvider = configProvider;
  }

  /**
   * Get the singleton instance of the logger
   */
  /**
   * Retrieve the singleton logger instance.
   *
   * When called without the optional parameters, the logger will be created
   * with VS Code specific implementations (the default behaviour for the
   * extension). Callers that need a CLI logger can provide their own
   * {@link IOutputChannel} and {@link IConfigProvider} implementations.
   */
  public static getInstance(
    name?: string,
    outputChannel?: IOutputChannel,
    configProvider?: IConfigProvider
  ): Logger {
    if (!Logger.loggerInstance) {
      const oc =
        outputChannel ??  vscode.window.createOutputChannel(name ?? 'Private Model');
      const cfg = configProvider ?? vscode.workspace.getConfiguration('private.model.provider');
      Logger.loggerInstance = new Logger(name, oc, cfg);
    }
    return Logger.loggerInstance;
  }

  /**
   * Get the configured log level from VS Code settings
   */
  /**
   * Retrieve the configured log level from VS Code settings.
   * This overrides the BaseLogger implementation which reads the static
   * configured level. VS Code extensions obtain the level from workspace
   * configuration, while the CLI can set it via BaseLogger.setLogLevel.
   */
  protected getConfiguredLogLevel(): LogLevel {
    // Delegates to the injected configuration provider. The provider knows how
    // to retrieve the "logLevel" setting from VS Code configuration or from
    // environment variables when running in a CLI.
    return this.configProvider.get<LogLevel>('logLevel', 'info');
  }

  /**
   * Internal method to write log entries with timestamp
   */
  protected log(level: string, message: string): void {
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
  public getOutputChannel(): IOutputChannel {
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
export function getLogger(): ILogger {
  return Logger.getInstance();
}
