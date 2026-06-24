import { ILogger } from "./interfaces";

/**
 * Log level enumeration used by the logger hierarchy.
 * "none" can be used to completely disable logging.
 */
export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'none';

/**
 * Mapping of log levels to numeric severity for comparison.
 */
const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
  none: 4, //used to disable logging
};

/**
 * Base logger implementation that logs to the console.
 * This class lives in the core folder and has no VS Code dependencies.
 * It implements the ILogger interface and provides a singleton instance
 * for console based logging (used by the CLI).
 */
export class BaseLogger implements ILogger {
  /** Singleton instance */
  private static instance: BaseLogger | undefined;

  /** Configured log level – defaults to "info". */
  private static configuredLevel: LogLevel = 'info';

  /** Protected constructor to enforce singleton usage */
  protected constructor() {}

  /** Get the singleton instance of the console logger */
  public static getInstance(): BaseLogger {
    if (!BaseLogger.instance) {
      BaseLogger.instance = new BaseLogger();
    }
    return BaseLogger.instance;
  }

  /**
   * Allows external code (e.g., a CLI entry point) to set the log level.
   * This method is static so it can be called without an instance.
   */
  public static setLogLevel(level: LogLevel): void {
    BaseLogger.configuredLevel = level;
  }

  /**
   * Retrieve the configured log level. Sub‑classes can override this to
   * provide environment‑specific configuration (e.g., VS Code settings).
   */
  protected getConfiguredLogLevel(): LogLevel {
    return BaseLogger.configuredLevel;
  }

  /** Determine whether a message at the given level should be logged. */
  protected shouldLog(level: LogLevel): boolean {
    const configured = this.getConfiguredLogLevel();
    return LOG_LEVELS[level] >= LOG_LEVELS[configured];
  }

  /**
   * Internal method to write log entries with timestamp.
   * Sub‑classes can override this to change the output destination.
   */
  protected log(level: string, message: string): void {
    const timestamp = new Date().toISOString();
    const formattedMessage = `[${timestamp}] [${level.padEnd(5)}] ${message}`;
    console.log(formattedMessage);
  }

  public info(message: string): void {
    if (!this.shouldLog('info')) return;
    this.log('INFO', message);
  }

  public warn(message: string): void {
    if (!this.shouldLog('warn')) return;
    this.log('WARN', message);
  }

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

  public debug(message: string): void {
    if (!this.shouldLog('debug')) return;
    this.log('DEBUG', message);
  }

  // The following UI‑related methods are no‑ops for the console logger.
  public show(): void {}
  public clear(): void {}
  public dispose(): void {}
}
