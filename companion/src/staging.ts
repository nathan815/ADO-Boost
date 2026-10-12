import { mkdir, rm } from "node:fs/promises";

export async function withStagingDirectory<T>(path: string, operation: () => Promise<T>): Promise<T> {
  try {
    await mkdir(path, { recursive: true });
    return await operation();
  } finally {
    await rm(path, { recursive: true, force: true });
  }
}
