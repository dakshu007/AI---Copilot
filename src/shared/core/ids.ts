let counter = 0;

/** Short, collision-resistant id that works in both Node and the browser. */
export function createId(prefix = 'id'): string {
  counter = (counter + 1) % 1_000_000;
  const random =
    typeof globalThis.crypto?.randomUUID === 'function'
      ? globalThis.crypto.randomUUID().slice(0, 8)
      : Math.random().toString(36).slice(2, 10);
  return `${prefix}_${Date.now().toString(36)}${counter.toString(36)}${random}`;
}
