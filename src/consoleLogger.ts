import { ILogger } from './core/interfaces';
import { BaseLogger } from './core/BaseLogger';

/**
 * CLI logger that re‑uses the BaseLogger implementation.
 * The BaseLogger already logs to the console, so no additional
 * behaviour is required here. This class exists primarily for
 * semantic clarity – it signals that this logger is intended for
 * the command‑line interface.
 */
export class CLIConsoleLogger extends BaseLogger implements ILogger {}

/**
 * Returns a logger instance suitable for the CLI.
 */
export function getConsoleLogger(): ILogger {
  // BaseLogger is a singleton, so we can safely return its instance.
  return CLIConsoleLogger.getInstance();
}
