import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { createHash } from 'node:crypto';
import type { FsAction, FsOperation, FsBatchResultItem } from '@machinebridge/protocol';

const RESERVED_WINDOWS_NAMES = /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(\..*)?$/i;

export interface ReadFileOptions {
  offset?: number;
  length?: number;
  encoding?: 'utf8' | 'base64';
}

export interface WriteFileOptions {
  append?: boolean;
  encoding?: 'utf8' | 'base64';
}

export interface ListFilesOptions {
  recursive?: boolean;
}

export interface FileEntry {
  name: string;
  path: string;
  isDirectory: boolean;
  size: number;
  mtime: string;
}

export class FilesystemManager {
  private readonly workspaceRoot?: string;

  constructor(workspaceRoot?: string) {
    this.workspaceRoot = workspaceRoot
      ? path.resolve(workspaceRoot)
      : process.env.MACHINEBRIDGE_WORKSPACE_ROOT
        ? path.resolve(process.env.MACHINEBRIDGE_WORKSPACE_ROOT)
        : undefined;
  }

  public resolvePath(userPath: string): string {
    if (!userPath || typeof userPath !== 'string') {
      throw new Error('INVALID_PATH: Path must be a non-empty string');
    }

    if (userPath.includes('\0')) {
      throw new Error('PATH_SECURITY_VIOLATION: Path contains null bytes');
    }

    // Check for Windows reserved device names
    const segments = userPath.split(/[/\\]/);
    for (const segment of segments) {
      if (RESERVED_WINDOWS_NAMES.test(segment.trim())) {
        throw new Error(
          `PATH_SECURITY_VIOLATION: Path uses reserved Windows device name (${segment})`,
        );
      }
    }

    const baseDir = this.workspaceRoot || process.cwd();
    const resolved = path.resolve(baseDir, userPath);

    // Enforce workspace confinement if configured
    if (this.workspaceRoot) {
      const isWindows = process.platform === 'win32';
      const normRoot = isWindows ? this.workspaceRoot.toLowerCase() : this.workspaceRoot;
      const normTarget = isWindows ? resolved.toLowerCase() : resolved;

      if (normTarget !== normRoot && !normTarget.startsWith(normRoot + path.sep)) {
        throw new Error(
          `PATH_TRAVERSAL_DETECTED: Access outside authorized workspace denied (${userPath})`,
        );
      }
    }

    return resolved;
  }

  public async readFile(
    userPath: string,
    options: ReadFileOptions = {},
  ): Promise<{
    path: string;
    content: string;
    size: number;
    bytesRead: number;
    hasMore: boolean;
    encoding: string;
  }> {
    const resolved = this.resolvePath(userPath);
    const stat = await fs.stat(resolved);
    const fileSize = stat.size;
    const encoding = options.encoding || 'utf8';

    const offset = options.offset ?? 0;
    const maxBytes = options.length ?? 1024 * 1024; // 1 MiB default safe max chunk
    const bytesToRead = Math.min(Math.max(0, fileSize - offset), maxBytes);

    const handle = await fs.open(resolved, 'r');
    try {
      const buffer = Buffer.alloc(bytesToRead);
      const { bytesRead } = await handle.read(buffer, 0, bytesToRead, offset);
      const content = encoding === 'base64' ? buffer.toString('base64') : buffer.toString('utf8');
      const hasMore = offset + bytesRead < fileSize;

      return {
        path: userPath,
        content,
        size: fileSize,
        bytesRead,
        hasMore,
        encoding,
      };
    } finally {
      await handle.close();
    }
  }

  public async writeFile(
    userPath: string,
    content: string,
    options: WriteFileOptions = {},
  ): Promise<{
    path: string;
    bytesWritten: number;
    size: number;
    sha256: string;
  }> {
    const resolved = this.resolvePath(userPath);
    await fs.mkdir(path.dirname(resolved), { recursive: true });

    const encoding = options.encoding || 'utf8';
    const buffer = Buffer.from(content, encoding as BufferEncoding);
    const sha256 = createHash('sha256').update(buffer).digest('hex');

    if (options.append) {
      await fs.appendFile(resolved, buffer);
    } else {
      await fs.writeFile(resolved, buffer);
    }

    const stat = await fs.stat(resolved);
    return {
      path: userPath,
      bytesWritten: buffer.byteLength,
      size: stat.size,
      sha256,
    };
  }

  public async deleteFile(
    userPath: string,
    options: { recursive?: boolean } = {},
  ): Promise<{ path: string; deleted: boolean }> {
    const resolved = this.resolvePath(userPath);
    await fs.rm(resolved, { recursive: options.recursive ?? true, force: true });
    return { path: userPath, deleted: true };
  }

  public async makeDirectory(
    userPath: string,
    options: { recursive?: boolean } = {},
  ): Promise<{ path: string; created: boolean }> {
    const resolved = this.resolvePath(userPath);
    await fs.mkdir(resolved, { recursive: options.recursive ?? true });
    return { path: userPath, created: true };
  }

  public async moveFile(
    source: string,
    destination: string,
  ): Promise<{ source: string; destination: string; moved: boolean }> {
    const srcResolved = this.resolvePath(source);
    const destResolved = this.resolvePath(destination);
    await fs.mkdir(path.dirname(destResolved), { recursive: true });
    await fs.rename(srcResolved, destResolved);
    return { source, destination, moved: true };
  }

  public async copyFile(
    source: string,
    destination: string,
  ): Promise<{ source: string; destination: string; copied: boolean }> {
    const srcResolved = this.resolvePath(source);
    const destResolved = this.resolvePath(destination);
    await fs.mkdir(path.dirname(destResolved), { recursive: true });
    await fs.cp(srcResolved, destResolved, { recursive: true });
    return { source, destination, copied: true };
  }

  public async listFiles(
    userPath: string,
    options: ListFilesOptions = {},
  ): Promise<{ path: string; entries: FileEntry[] }> {
    const resolved = this.resolvePath(userPath);
    const entries: FileEntry[] = [];

    async function walk(dir: string, relBase: string): Promise<void> {
      const items = await fs.readdir(dir, { withFileTypes: true });
      for (const item of items) {
        const itemRel = relBase ? `${relBase}/${item.name}` : item.name;
        const itemFull = path.join(dir, item.name);
        try {
          const stat = await fs.stat(itemFull);
          entries.push({
            name: item.name,
            path: itemRel,
            isDirectory: item.isDirectory(),
            size: stat.size,
            mtime: stat.mtime.toISOString(),
          });
          if (options.recursive && item.isDirectory()) {
            await walk(itemFull, itemRel);
          }
        } catch {
          // Skip unreadable files or dead symlinks
        }
      }
    }

    const stat = await fs.stat(resolved);
    if (!stat.isDirectory()) {
      return {
        path: userPath,
        entries: [
          {
            name: path.basename(resolved),
            path: path.basename(resolved),
            isDirectory: false,
            size: stat.size,
            mtime: stat.mtime.toISOString(),
          },
        ],
      };
    }

    await walk(resolved, '');
    return { path: userPath, entries };
  }

  public async executeAction(action: FsAction, params: Record<string, unknown>): Promise<unknown> {
    const filePath = String(params.path || '');
    switch (action) {
      case 'read':
        return this.readFile(filePath, {
          offset: typeof params.offset === 'number' ? params.offset : undefined,
          length: typeof params.length === 'number' ? params.length : undefined,
          encoding: (params.encoding as 'utf8' | 'base64') || undefined,
        });

      case 'write':
        return this.writeFile(filePath, String(params.content || ''), {
          append: Boolean(params.append),
          encoding: (params.encoding as 'utf8' | 'base64') || undefined,
        });

      case 'delete':
        return this.deleteFile(filePath, {
          recursive: params.recursive !== undefined ? Boolean(params.recursive) : true,
        });

      case 'mkdir':
        return this.makeDirectory(filePath, {
          recursive: params.recursive !== undefined ? Boolean(params.recursive) : true,
        });

      case 'move':
        return this.moveFile(filePath, String(params.destination || ''));

      case 'copy':
        return this.copyFile(filePath, String(params.destination || ''));

      case 'list':
        return this.listFiles(filePath, {
          recursive: Boolean(params.recursive),
        });

      case 'stat': {
        const resolved = this.resolvePath(filePath);
        const stat = await fs.stat(resolved);
        return {
          path: filePath,
          isDirectory: stat.isDirectory(),
          isFile: stat.isFile(),
          size: stat.size,
          mtime: stat.mtime.toISOString(),
          birthtime: stat.birthtime.toISOString(),
        };
      }

      default:
        throw new Error(`UNKNOWN_FS_ACTION: ${action}`);
    }
  }

  public async executeBatch(
    operations: FsOperation[],
    stopOnError: boolean = true,
    executeCommandFn?: (
      command: string,
      cwd?: string,
      timeoutMs?: number,
    ) => Promise<{ output: string; exitCode: number }>,
  ): Promise<{
    total: number;
    passed: number;
    failed: number;
    skipped: number;
    results: FsBatchResultItem[];
  }> {
    const results: FsBatchResultItem[] = [];
    let hasFailed = false;

    for (let i = 0; i < operations.length; i++) {
      const op = operations[i];
      if (hasFailed && stopOnError) {
        results.push({
          index: i,
          type: op.type,
          path: op.path,
          command: op.command,
          success: false,
          error: 'Skipped due to previous operation failure',
        });
        continue;
      }

      const startTime = Date.now();
      try {
        let data: unknown;
        switch (op.type) {
          case 'write':
            data = await this.writeFile(String(op.path || ''), String(op.content || ''), {
              append: op.append,
              encoding: op.encoding,
            });
            break;

          case 'read':
            data = await this.readFile(String(op.path || ''), {
              offset: op.offset,
              length: op.length,
              encoding: op.encoding,
            });
            break;

          case 'mkdir':
            data = await this.makeDirectory(String(op.path || ''), {
              recursive: op.recursive ?? true,
            });
            break;

          case 'delete':
            data = await this.deleteFile(String(op.path || ''), {
              recursive: op.recursive ?? true,
            });
            break;

          case 'move':
            data = await this.moveFile(String(op.path || ''), String(op.destination || ''));
            break;

          case 'copy':
            data = await this.copyFile(String(op.path || ''), String(op.destination || ''));
            break;

          case 'list':
            data = await this.listFiles(String(op.path || ''), { recursive: op.recursive });
            break;

          case 'command': {
            if (!executeCommandFn) {
              throw new Error('Command execution is not configured for this filesystem session');
            }
            const cmdResult = await executeCommandFn(
              String(op.command || ''),
              op.cwd,
              op.timeoutMs,
            );
            data = cmdResult;
            if (cmdResult.exitCode !== 0) {
              throw new Error(
                `Command failed with exit code ${cmdResult.exitCode}: ${cmdResult.output}`,
              );
            }
            break;
          }

          default:
            throw new Error(`UNKNOWN_OPERATION_TYPE: ${(op as { type: string }).type}`);
        }

        results.push({
          index: i,
          type: op.type,
          path: op.path,
          command: op.command,
          success: true,
          data,
          durationMs: Date.now() - startTime,
        });
      } catch (error) {
        hasFailed = true;
        const msg = error instanceof Error ? error.message : String(error);
        results.push({
          index: i,
          type: op.type,
          path: op.path,
          command: op.command,
          success: false,
          error: msg,
          durationMs: Date.now() - startTime,
        });
      }
    }

    const passed = results.filter((r) => r.success).length;
    const failed = results.filter(
      (r) => !r.success && r.error !== 'Skipped due to previous operation failure',
    ).length;
    const skipped = results.filter(
      (r) => r.error === 'Skipped due to previous operation failure',
    ).length;

    return {
      total: operations.length,
      passed,
      failed,
      skipped,
      results,
    };
  }
}
