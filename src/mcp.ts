import * as vscode from 'vscode';
import { spawn, ChildProcessWithoutNullStreams } from 'child_process';
import { getLogger } from './logger';

/**
 * Configuration for a single MCP server.
 */
export interface MCPServerConfig {
  /** Human readable name */
  name: string;
  /** Command to start the server (e.g., "ollama", "python") */
  command: string;
  /** Arguments passed to the command */
  args?: string[];
  /** Transport type – currently "stdio", "sse", or "http" */
  transport?: 'stdio' | 'sse' | 'http';
  /** Optional environment variables */
  env?: Record<string, string>;
}

/**
 * Manages the lifecycle of configured MCP servers and provides tool definitions
 * that can be injected into the language model request flow.
 */
export class MCPManager {
  private readonly logger = getLogger();
  private readonly servers: Map<string, ChildProcessWithoutNullStreams> = new Map();
  private readonly configs: MCPServerConfig[] = [];

  constructor() {
    this.loadConfigs();
  }

  /** Load server configs from VS Code settings */
  private loadConfigs() {
    const cfg = vscode.workspace.getConfiguration('local.model.provider');
    const servers = cfg.get<any[]>('mcpServers', []);
    this.configs.length = 0;
    for (const s of servers) {
      if (s && s.name && s.command) {
        this.configs.push({
          name: s.name,
          command: s.command,
          args: s.args ?? [],
          transport: s.transport ?? 'stdio',
          env: s.env ?? {},
        });
      }
    }
  }

  /** Start all configured MCP servers */
  public async startAll(): Promise<void> {
    for (const cfg of this.configs) {
      await this.startServer(cfg);
    }
  }

  /** Stop all running MCP servers */
  public async stopAll(): Promise<void> {
    for (const [name, proc] of this.servers.entries()) {
      this.logger.info(`[MCP] Stopping server ${name}`);
      proc.kill();
    }
    this.servers.clear();
  }

  /** Start a single server based on its config */
  private async startServer(cfg: MCPServerConfig): Promise<void> {
    if (this.servers.has(cfg.name)) {
      this.logger.info(`[MCP] Server ${cfg.name} already running`);
      return;
    }
    this.logger.info(`[MCP] Starting server ${cfg.name}: ${cfg.command} ${cfg.args?.join(' ')}`);
    const proc = spawn(cfg.command, cfg.args ?? [], {
      env: { ...process.env, ...(cfg.env ?? {}) },
      stdio: cfg.transport === 'stdio' ? 'pipe' : 'ignore',
    });
    proc.on('error', (err) => {
      this.logger.error(`[MCP] Failed to start ${cfg.name}: ${err.message}`);
    });
    proc.stdout?.on('data', (data) => {
      this.logger.debug(`[MCP:${cfg.name}] ${data.toString().trim()}`);
    });
    proc.stderr?.on('data', (data) => {
      this.logger.warn(`[MCP:${cfg.name}][stderr] ${data.toString().trim()}`);
    });
    this.servers.set(cfg.name, proc);
  }

  /** Retrieve tool definitions exported by MCP servers.
   *  For now this returns an empty array – concrete implementations can extend
   *  this method to query the server (e.g., via HTTP) and transform the result
   *  into OpenAI‑compatible tool schemas.
   */
  public getToolDefinitions(): any[] {
    // Build tool definitions from the configured MCP servers. Each server
    // configuration is treated as a tool that can be invoked via the model.
    // For now we expose a simple function with no parameters; real
    // implementations can extend this to include proper schemas.
    if (!this.configs || this.configs.length === 0) {
      return [];
    }
    return this.configs.map(cfg => ({
      type: 'function',
      function: {
        name: cfg.name,
        description: `MCP tool for server ${cfg.name}`,
        parameters: { type: 'object', properties: {}, required: [] },
      },
    }));
  }
}
