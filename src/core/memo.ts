import { AsyncLocalStorage } from "node:async_hooks";

type MemoEntry =
  | { status: "value"; value: unknown }
  | { status: "error"; error: unknown };

interface MemoNode {
  children?: Map<unknown, MemoNode>;
  entry?: MemoEntry;
}

type MemoStore = Map<Function, MemoNode>;
export type LoaderMemoizationScope = <T>(operation: () => T) => T;

const loaderMemoStore = new AsyncLocalStorage<MemoStore>();

function childFor(node: MemoNode, key: unknown): MemoNode {
  const children = node.children ??= new Map();
  let child = children.get(key);
  if (!child) {
    child = {};
    children.set(key, child);
  }
  return child;
}

/**
 * Deduplicates calls made during one Brandy render. Pending promises are stored immediately,
 * so parallel loaders share the same work. Outside a render, the function behaves normally.
 */
export function memoizeLoader<This, Args extends unknown[], Result>(
  fn: (this: This, ...args: Args) => Result,
): (this: This, ...args: Args) => Result {
  function memoized(this: This, ...args: Args): Result {
    const store = loaderMemoStore.getStore();
    if (!store) return fn.apply(this, args);

    let node = store.get(memoized);
    if (!node) {
      node = {};
      store.set(memoized, node);
    }
    for (const argument of args) node = childFor(node, argument);

    if (node.entry) {
      if (node.entry.status === "error") throw node.entry.error;
      return node.entry.value as Result;
    }

    try {
      const value = fn.apply(this, args);
      node.entry = { status: "value", value };
      return value;
    } catch (error) {
      node.entry = { status: "error", error };
      throw error;
    }
  }

  return memoized;
}

/** Creates an explicit scope closure so streamed phases do not depend on implicit context propagation. */
export function createLoaderMemoizationScope(): LoaderMemoizationScope {
  const store = loaderMemoStore.getStore() ?? new Map();
  return (operation) => loaderMemoStore.run(store, operation);
}
