export class CancellationRegistry {
  private readonly active = new Set<string>();
  private readonly cancelled = new Set<string>();

  admit(id: string): boolean {
    if (this.active.has(id)) return false;
    this.active.add(id);
    return true;
  }

  cancel(id: string): boolean {
    if (!this.active.has(id)) return false;
    this.cancelled.add(id);
    return true;
  }

  throwIfCancelled(id: string): void {
    if (this.cancelled.has(id)) throw Object.assign(new Error("The request was cancelled"), { code: "cancelled" });
  }

  finish(id: string): void {
    this.active.delete(id);
    this.cancelled.delete(id);
  }
}

export async function createCancellableResource<T>(
  id: string,
  cancellations: CancellationRegistry,
  create: () => Promise<T>,
  dispose: (resource: T) => Promise<void>
): Promise<T> {
  cancellations.throwIfCancelled(id);
  const resource = await create();
  try {
    cancellations.throwIfCancelled(id);
    return resource;
  } catch (error) {
    await dispose(resource);
    throw error;
  }
}
