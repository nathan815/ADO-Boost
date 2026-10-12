import { describe, expect, it } from "vitest";
import { CancellationRegistry, createCancellableResource } from "../src/lifecycle.js";

describe("native inference lifecycle", () => {
  it("disposes a session created after its request was cancelled", async () => {
    const cancellations = new CancellationRegistry();
    cancellations.admit("request-1");
    let resolveCreation!: (value: { id: string }) => void;
    const creation = new Promise<{ id: string }>((resolve) => {
      resolveCreation = resolve;
    });
    let disposed = false;
    const pending = createCancellableResource("request-1", cancellations, () => creation, async () => {
      disposed = true;
    });
    cancellations.cancel("request-1");
    resolveCreation({ id: "session-1" });
    await expect(pending).rejects.toMatchObject({ code: "cancelled" });
    expect(disposed).toBe(true);
  });
});
