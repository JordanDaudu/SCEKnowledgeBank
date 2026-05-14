import type { Readable } from "node:stream";

export interface PutObjectInput {
  /** Logical key relative to the storage root. */
  key: string;
  body: Buffer;
  contentType: string;
}

export interface PutObjectResult {
  key: string;
  size: number;
  checksum: string;
  driver: string;
}

export interface ObjectHead {
  key: string;
  size: number;
  contentType: string;
  driver: string;
}

export interface StorageAdapter {
  readonly driver: string;
  put(input: PutObjectInput): Promise<PutObjectResult>;
  get(key: string): Promise<Buffer>;
  getStream(key: string): Promise<Readable>;
  head(key: string): Promise<ObjectHead>;
  delete(key: string): Promise<void>;
}
