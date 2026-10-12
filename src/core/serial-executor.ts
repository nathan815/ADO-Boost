export class SerialExecutor {
  private readonly operations = new Map<string, Promise<unknown>>();

  run<T>(key: string, work: () => Promise<T>): Promise<T> {
    const previous = this.operations.get(key) ?? Promise.resolve();
    const current = previous.catch(() => undefined).then(work);
    this.operations.set(key, current);
    return current.finally(() => {
      if (this.operations.get(key) === current) this.operations.delete(key);
    });
  }
}
