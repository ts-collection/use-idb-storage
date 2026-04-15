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
 * Handles VersionError by falling back to the current DB version.
 * Handles missing stores by upgrading to the next version.
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

    // Inner helper — opens at `ver` (undefined = current) and ensures the store exists.
    // On VersionError (requested < current) retries without version once.
    const openAt = (ver: number | undefined, isRetry = false) => {
      const req = indexedDB.open(dbName, ver);

      req.onblocked = () => {
        console.warn(
          `[use-idb-storage] IndexedDB open blocked for "${dbName}" — another tab may be holding a connection`,
        );
      };

      req.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;
        if (!db.objectStoreNames.contains(storeName)) {
          db.createObjectStore(storeName);
        }
      };

      req.onerror = () => {
        const error = req.error;
        // If the DB exists at a higher version, reopen at current version (once)
        if (error?.name === 'VersionError' && !isRetry) {
          openAt(undefined, true);
          return;
        }
        settle(() => reject(error));
      };

      req.onsuccess = () => {
        const db = req.result;

        // Store missing — upgrade to the next version to create it
        if (!db.objectStoreNames.contains(storeName)) {
          db.close();
          openAt(db.version + 1);
          return;
        }

        settle(() => {
          attachVersionChange(db);
          resolve(db);
        });
      };
    };

    openAt(version);
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
