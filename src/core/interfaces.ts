// Placeholder interfaces for abstraction layers. These will be fleshed out later.
export interface IConfigProvider {
  get<T>(key: string, defaultValue?: T): T;
}

export interface IFileSystem {
  readFile(path: string, encoding?: BufferEncoding): Promise<string>;
  writeFile(path: string, data: string, encoding?: BufferEncoding): Promise<void>;
  mkdir(path: string, options?: { recursive?: boolean }): Promise<void>;
  exists(path: string): Promise<boolean>;
}

export interface ISecretStore {
  get(key: string): Promise<string | undefined>;
  set(key: string, value: string): Promise<void>;
  delete(key: string): Promise<void>;
}

export interface IStatisticsReporter {
  report(stats: any): void;
}

export interface ICommandRegistry {
  register(name: string, handler: (...args: any[]) => any): void;
}

/**
 * Minimal output channel abstraction used by the VS Code logger.
 * It mirrors the subset of vscode.OutputChannel methods that the
 * logger needs (appendLine, show, clear, dispose). Implementations
 * can wrap the real VS Code OutputChannel or provide a console‑based
 * fallback for CLI usage.
 */
export interface IOutputChannel {
  /** Append a line of text to the channel */
  appendLine(value: string): void;
  /** Show the channel (no‑op for CLI) */
  show(preserveFocus?: boolean): void;
  /** Clear the channel (no‑op for CLI) */
  clear(): void;
  /** Dispose any resources */
  dispose(): void;
}

/**
 * Minimal logger abstraction used by both VS Code and CLI implementations.
 * This interface deliberately avoids any VS Code specific types so that it
 * can be used in the core layer without pulling in the VS Code API.
 */
export interface ILogger {
  /** Log an informational message */
  info(message: string): void;
  /** Log a warning message */
  warn(message: string): void;
  /** Log an error message; optional error object for details */
  error(message: string, error?: unknown): void;
  /** Log a debug message */
  debug(message: string): void;
  /** Show the underlying output (no‑op for CLI) */
  show(): void;
  /** Clear the output (no‑op for CLI) */
  clear(): void;
  /** Dispose any resources */
  dispose(): void;
}
