import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, readFile, stat, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Readable } from "node:stream";
import type {
  ObjectHead,
  PutObjectInput,
  PutObjectResult,
  StorageAdapter,
} from "./types";

export interface LocalAdapterOptions {
  root: string;
}

export class LocalStorageAdapter implements StorageAdapter {
  readonly driver = "local";
  private readonly root: string;

  constructor(opts: LocalAdapterOptions) {
    this.root = path.resolve(opts.root);
  }

  private resolveSafe(key: string): string {
    const normalized = path.posix.normalize(key).replace(/^\/+/, "");
    if (normalized.startsWith("..") || normalized.includes("\0")) {
      throw new Error(`Unsafe storage key: ${key}`);
    }
    const resolved = path.resolve(this.root, normalized);
    if (!resolved.startsWith(this.root + path.sep) && resolved !== this.root) {
      throw new Error(`Storage key escapes root: ${key}`);
    }
    return resolved;
  }

  async put(input: PutObjectInput): Promise<PutObjectResult> {
    const target = this.resolveSafe(input.key);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, input.body);
    const checksum =
      input.precomputedChecksum ??
      createHash("sha256").update(input.body).digest("hex");
    return {
      key: input.key,
      size: input.body.length,
      checksum,
      driver: this.driver,
    };
  }

  async get(key: string): Promise<Buffer> {
    const target = this.resolveSafe(key);
    return readFile(target);
  }

  async getStream(key: string): Promise<Readable> {
    const target = this.resolveSafe(key);
    // Touch the file to fail fast if missing
    await stat(target);
    return createReadStream(target);
  }

  async head(key: string): Promise<ObjectHead> {
    const target = this.resolveSafe(key);
    const st = await stat(target);
    return {
      key,
      size: st.size,
      contentType: "application/octet-stream",
      driver: this.driver,
    };
  }

  async delete(key: string): Promise<void> {
    const target = this.resolveSafe(key);
    try {
      await unlink(target);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
    }
  }
}
