import type {
  ObjectHead,
  PutObjectInput,
  PutObjectResult,
  StorageAdapter,
} from "./types";

/**
 * Stub adapter — selecting STORAGE_DRIVER=s3 fails fast so the user knows it
 * needs implementing rather than silently misbehaving. Implementation deferred.
 */
export class S3StorageAdapter implements StorageAdapter {
  readonly driver = "s3";

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  put(_input: PutObjectInput): Promise<PutObjectResult> {
    return Promise.reject(new Error("S3StorageAdapter is not implemented yet"));
  }
  get(_key: string): Promise<Buffer> {
    return Promise.reject(new Error("S3StorageAdapter is not implemented yet"));
  }
  getStream(_key: string): Promise<never> {
    return Promise.reject(new Error("S3StorageAdapter is not implemented yet"));
  }
  head(_key: string): Promise<ObjectHead> {
    return Promise.reject(new Error("S3StorageAdapter is not implemented yet"));
  }
  delete(_key: string): Promise<void> {
    return Promise.reject(new Error("S3StorageAdapter is not implemented yet"));
  }
}
