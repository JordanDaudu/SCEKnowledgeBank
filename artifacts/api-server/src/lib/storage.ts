import { createStorageAdapter, type StorageAdapter } from "@workspace/storage";
import { env } from "./env";

let adapter: StorageAdapter | null = null;

export function getStorage(): StorageAdapter {
  if (!adapter) {
    adapter = createStorageAdapter({
      driver: env.storageDriver,
      localRoot: env.storageLocalRoot,
    });
  }
  return adapter;
}
