import type { z, ZodRawShape } from "zod";

/** Throw this from a tool for an error the agent should read and act on (no stack trace is ever sent). */
export class ToolError extends Error {}

export interface ToolContext<C> {
  /** Whatever `authenticate` returned for this request (the key owner, etc.). */
  context: C;
  scopes: string[];
  /** Public origin of this deployment, for links in tool output. */
  origin: string;
  req: Request;
}

export interface ToolDef<C, S extends ZodRawShape = ZodRawShape> {
  name: string;
  title: string;
  description: string;
  /** Scope the key needs, or null for tools anyone connected can use. */
  scope: string | null;
  input: S;
  readOnly?: boolean;
  /** Deletes or overwrites something that can't be recovered. Agents should confirm first. */
  destructive?: boolean;
  /** Calling it twice with the same input changes nothing more. Defaults to readOnly. */
  idempotent?: boolean;
  /** Returns plain data; it's sent to the agent as pretty-printed JSON. */
  run(args: z.objectOutputType<S, z.ZodTypeAny>, ctx: ToolContext<C>): Promise<unknown>;
}

/** Typed helper: `defineTool<MyCtx>()({ name, scope, input: { id: z.string() }, run: async ({ id }, { context }) => … })`. */
export function defineTool<C>() {
  return <S extends ZodRawShape>(def: ToolDef<C, S>): ToolDef<C, S> => def;
}
