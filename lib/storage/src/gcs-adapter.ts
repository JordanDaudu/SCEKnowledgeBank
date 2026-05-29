import type {
  ObjectHead,
  PutObjectInput,
  PutObjectResult,
  StorageAdapter,
} from "./types";

/**
 * Stub adapter — selecting STORAGE_DRIVER=gcs fails fast so the user knows it
 * needs implementing rather than silently misbehaving.
 *
 * The original Replit Object Storage adapter (GCS under the hood, authed via a
 * localhost sidecar) was lost when lib/storage was dropped from the repo; until
 * it is reconstructed against a real Replit environment, the gcs driver throws
 * with a clear message. Local development uses STORAGE_DRIVER=local and is
 * unaffected. See .agents/memory/replit-gcs-adapter.md for the intended design.
 */
export class GcsStorageAdapter implements StorageAdapter {
  readonly driver = "gcs";

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  put(_input: PutObjectInput): Promise<PutObjectResult> {
    return Promise.reject(new Error("GcsStorageAdapter is not implemented yet"));
  }
  get(_key: string): Promise<Buffer> {
    return Promise.reject(new Error("GcsStorageAdapter is not implemented yet"));
  }
  getStream(_key: string): Promise<never> {
    return Promise.reject(new Error("GcsStorageAdapter is not implemented yet"));
  }
  head(_key: string): Promise<ObjectHead> {
    return Promise.reject(new Error("GcsStorageAdapter is not implemented yet"));
  }
  delete(_key: string): Promise<void> {
    return Promise.reject(new Error("GcsStorageAdapter is not implemented yet"));
  }
}
