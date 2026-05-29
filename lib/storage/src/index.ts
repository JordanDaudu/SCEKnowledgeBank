import { LocalStorageAdapter } from "./local-adapter";
import { S3StorageAdapter } from "./s3-adapter";
import { GcsStorageAdapter } from "./gcs-adapter";
import type { StorageAdapter } from "./types";

export type { StorageAdapter, PutObjectInput, PutObjectResult, ObjectHead } from "./types";
export { LocalStorageAdapter } from "./local-adapter";
export { S3StorageAdapter } from "./s3-adapter";
export { GcsStorageAdapter } from "./gcs-adapter";

export interface CreateStorageOptions {
  driver: "local" | "s3" | "gcs";
  localRoot: string;
}

export function createStorageAdapter(opts: CreateStorageOptions): StorageAdapter {
  if (opts.driver === "local") {
    return new LocalStorageAdapter({ root: opts.localRoot });
  }
  if (opts.driver === "s3") {
    return new S3StorageAdapter();
  }
  if (opts.driver === "gcs") {
    return new GcsStorageAdapter();
  }
  throw new Error(`Unknown storage driver: ${opts.driver}`);
}
