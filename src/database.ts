// Singleton database connections cache
const dbConnections = new Map<string, Promise<IDBDatabase>>();

const IDB_OPEN_TIMEOUT_MS = 2000;
const IDB_OPEN_RETRIES = 2;
const IDB_RETRY_DELAY_MS = 500;

/**
 * Check if IndexedDB is available
 */
export function isIDBAvailable(): boolean {
  return typeof indexedDB !== 'undefined';
}

/**
 * Opens an IndexedDB database and ensures the specified store exists.
 * Uses singleton pattern to reuse connections for the same database.
 * Retries up to IDB_OPEN_RETRIES times on failure (blocked or timeout).
 * When version is omitted, auto-upgrades if the store doesn't exist.
 */
export function openDB(
  dbName: string,
  storeName: string,
  onVersionChange?: () => void,
  version?: number,
): Promise<IDBDatabase> {
  if (!isIDBAvailable()) {
    throw new Error('IndexedDB is not available in this environment');
  }
  const key = `${dbName}:${storeName}`;

  if (dbConnections.has(key)) {
    return dbConnections.get(key)!;
  }

  const dbPromise = _openDBWithRetry(
    dbName,
    storeName,
    onVersionChange,
    version,
    IDB_OPEN_RETRIES,
  );
  dbConnections.set(key, dbPromise);
  dbPromise.catch(() => dbConnections.delete(key));

  return dbPromise;
}

async function _openDBWithRetry(
  dbName: string,
  storeName: string,
  onVersionChange: (() => void) | undefined,
  version: number | undefined,
  retriesLeft: number,
): Promise<IDBDatabase> {
  try {
    return await _openDB(dbName, storeName, onVersionChange, version);
  } catch (err) {
    if (retriesLeft > 0) {
      await new Promise<void>((resolve) => setTimeout(resolve, IDB_RETRY_DELAY_MS));
      return _openDBWithRetry(dbName, storeName, onVersionChange, version, retriesLeft - 1);
    }
    throw err;
  }
}

/**
 * Single open attempt with timeout. Cache management is handled by openDB.
 */
function _openDB(
  dbName: string,
  storeName: string,
  onVersionChange?: () => void,
  version?: number,
): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`IndexedDB open timed out for "${dbName}"`));
    }, IDB_OPEN_TIMEOUT_MS);

    const settle = (fn: () => void) => {
      clearTimeout(timer);
      fn();
    };

    const attachVersionChange = (db: IDBDatabase) => {
      db.onversionchange = () => {
        db.close();
        for (const [k] of dbConnections) {
          if (k.startsWith(`${dbName}:`)) dbConnections.delete(k);
        }
        onVersionChange?.();
      };
    };

    const request = indexedDB.open(dbName, version);

    request.onerror = () => settle(() => reject(request.error));

    request.onblocked = () => {
      // Another tab holds a connection; log and wait — timeout is the safety net
      console.warn(
        `[use-idb-storage] IndexedDB open blocked for "${dbName}" — another tab may be holding a connection`,
      );
    };

    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(storeName)) {
        db.createObjectStore(storeName);
      }
    };

    request.onsuccess = () => {
      const db = request.result;

      // When no explicit version: if the store still doesn't exist, upgrade
      if (!version && !db.objectStoreNames.contains(storeName)) {
        db.close();
        const request2 = indexedDB.open(dbName, db.version + 1);

        request2.onupgradeneeded = (event) => {
          const db2 = (event.target as IDBOpenDBRequest).result;
          if (!db2.objectStoreNames.contains(storeName)) {
            db2.createObjectStore(storeName);
          }
        };

        request2.onblocked = () => {
          console.warn(
            `[use-idb-storage] IndexedDB upgrade blocked for "${dbName}" — another tab may be holding a connection`,
          );
        };

        request2.onsuccess = () =>
          settle(() => {
            attachVersionChange(request2.result);
            resolve(request2.result);
          });

        request2.onerror = () => settle(() => reject(request2.error));

        return;
      }

      settle(() => {
        attachVersionChange(db);
        resolve(db);
      });
    };
  });
}

/**
 * Gets a value from IndexedDB.
 */
export function getFromDB<T>(
  db: IDBDatabase,
  storeName: string,
  key: string,
): Promise<T | undefined> {
  return new Promise((resolve, reject) => {
    try {
      const transaction = db.transaction([storeName], 'readonly');
      const store = transaction.objectStore(storeName);
      const request = store.get(key);

      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result);
    } catch (error) {
      reject(error);
    }
  });
}

/**
 * Sets a value in IndexedDB.
 */
export function setInDB(
  db: IDBDatabase,
  storeName: string,
  key: string,
  value: any,
): Promise<void> {
  return new Promise((resolve, reject) => {
    try {
      const transaction = db.transaction([storeName], 'readwrite');
      const store = transaction.objectStore(storeName);
      const request = store.put(value, key);

      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve();
    } catch (error) {
      reject(error);
    }
  });
}

/**
 * Removes a value from IndexedDB.
 */
export function removeFromDB(
  db: IDBDatabase,
  storeName: string,
  key: string,
): Promise<void> {
  return new Promise((resolve, reject) => {
    try {
      const transaction = db.transaction([storeName], 'readwrite');
      const store = transaction.objectStore(storeName);
      const request = store.delete(key);

      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve();
    } catch (error) {
      reject(error);
    }
  });
}
