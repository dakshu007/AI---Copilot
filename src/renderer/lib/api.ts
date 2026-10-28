import type { CopilotApi, IpcResult } from '../../preload/api';

export function api(): CopilotApi {
  if (!window.copilot) throw new Error('The secure bridge is not available.');
  return window.copilot;
}

/** Turn an IPC result into a value or a thrown Error with a user-facing message. */
export async function unwrap<T>(promise: Promise<IpcResult<T>>): Promise<T> {
  const result = await promise;
  if (!result.ok) throw new Error(result.error);
  return result.value;
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
