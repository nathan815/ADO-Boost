import { z } from "zod";

export type ResponseWarning = (message: string, details?: unknown) => void;

export function createResponseValidation(warn: ResponseWarning) {
  function optional<T>(schema: z.ZodType<T>, field: string) {
    return schema.nullish().catch((context) => {
      warn(`ADO Boost ignored invalid optional Azure DevOps field ${field}: ${z.prettifyError(new z.ZodError(context.error.issues))}`);
      return undefined;
    });
  }

  return { optional };
}
