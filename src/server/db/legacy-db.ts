type DbFunction = (...args: unknown[]) => Promise<unknown> | unknown;
type DbModule = Record<string, DbFunction>;

let dbPromise: Promise<DbModule> | null = null;

export async function getLegacyDb() {
  if (!dbPromise) {
    dbPromise = import("../../../electron/db.js").then((mod) => {
      const merged = { ...mod.default, ...mod } as Record<string, unknown>;
      delete merged.default;
      return merged as DbModule;
    });
  }
  return dbPromise;
}

export async function callLegacyDb(method: string, ...args: unknown[]) {
  const db = await getLegacyDb();
  const fn = db[method];
  if (typeof fn !== "function") {
    throw new Error(`服务端方法不存在：${method}`);
  }
  return fn(...args);
}
