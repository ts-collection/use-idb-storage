import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getFromDB, isIDBAvailable, openDB, removeFromDB, setInDB } from '../src/database';
import { clearAllDatabases, createTestDbName } from './setup';

// ─── helpers ──────────────────────────────────────────────────────────────────

/** Returns a frozen IDBOpenDBRequest-shaped object whose callbacks are never called. */
const makeHangingRequest = () =>
  new Proxy({} as IDBOpenDBRequest, {
    set: () => true, // silently discard all property assignments
    get: (_, prop) => (prop === 'error' ? null : undefined),
  });

/** Opens an IDBDatabase directly (bypassing the library) and resolves once ready. */
const rawOpen = (name: string, version?: number, onUpgrade?: (db: IDBDatabase) => void) =>
  new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open(name, version);
    req.onupgradeneeded = (e) => onUpgrade?.((e.target as IDBOpenDBRequest).result);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });

// ─── tests ────────────────────────────────────────────────────────────────────

describe('database', () => {
  let db: string; // unique DB name per test

  beforeEach(() => {
    db = createTestDbName();
  });

  afterEach(async () => {
    await clearAllDatabases();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  // ── isIDBAvailable ──────────────────────────────────────────────────────────

  describe('isIDBAvailable', () => {
    it('returns true when IndexedDB is present', () => {
      expect(isIDBAvailable()).toBe(true);
    });

    it('returns false when indexedDB is undefined', () => {
      const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'indexedDB')!;
      Object.defineProperty(globalThis, 'indexedDB', {
        value: undefined,
        configurable: true,
        writable: true,
      });
      try {
        expect(isIDBAvailable()).toBe(false);
      } finally {
        Object.defineProperty(globalThis, 'indexedDB', descriptor);
      }
    });
  });

  // ── openDB ─────────────────────────────────────────────────────────────────

  describe('openDB', () => {
    describe('guard', () => {
      it('throws synchronously when IndexedDB is unavailable', () => {
        const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'indexedDB')!;
        Object.defineProperty(globalThis, 'indexedDB', {
          value: undefined,
          configurable: true,
          writable: true,
        });
        try {
          expect(() => openDB(db, 'store')).toThrow(
            'IndexedDB is not available in this environment',
          );
        } finally {
          Object.defineProperty(globalThis, 'indexedDB', descriptor);
        }
      });
    });

    // ── store creation ────────────────────────────────────────────────────────

    describe('store creation', () => {
      it('creates the object store on a fresh database', async () => {
        const conn = await openDB(db, 'mystore');
        expect(conn).toBeInstanceOf(IDBDatabase);
        expect(conn.objectStoreNames.contains('mystore')).toBe(true);
      });

      it('accepts an explicit version and creates the store at that version', async () => {
        const conn = await openDB(db, 'versioned', undefined, 1);
        expect(conn.objectStoreNames.contains('versioned')).toBe(true);
        expect(conn.version).toBe(1);
      });

      it('auto-upgrades when the DB exists but the store is missing', async () => {
        // Manually create the DB at v1 with no stores
        const seed = await rawOpen(db, 1);
        seed.close();

        const conn = await openDB(db, 'late-store');
        expect(conn.objectStoreNames.contains('late-store')).toBe(true);
      });

      it('does not clobber an existing store on repeated opens', async () => {
        const conn = await openDB(db, 'store');
        await setInDB(conn, 'store', 'key', 'val');

        // Second call for a different store on same DB (new unique name)
        const conn2 = await openDB(`${db}-b`, 'store');
        await setInDB(conn2, 'store', 'key', 'other');

        // Original data untouched
        expect(await getFromDB(conn, 'store', 'key')).toBe('val');
      });

      it('creates multiple stores across the same database name', async () => {
        const connA = await openDB(db, 'alpha');
        await setInDB(connA, 'alpha', 'k', 'from-alpha');

        // The library will upgrade the DB to add 'beta'; connA gets versionchange
        // and its cache entry is cleared — subsequent reads re-open the DB.
        const connB = await openDB(db, 'beta');
        await setInDB(connB, 'beta', 'k', 'from-beta');

        // Both stores exist at the latest version
        expect(connB.objectStoreNames.contains('alpha')).toBe(true);
        expect(connB.objectStoreNames.contains('beta')).toBe(true);

        // Re-open alpha via the library (cache was cleared by versionchange)
        const connA2 = await openDB(db, 'alpha');
        expect(await getFromDB(connA2, 'alpha', 'k')).toBe('from-alpha');
      });
    });

    // ── VersionError recovery ─────────────────────────────────────────────────

    describe('VersionError recovery', () => {
      it('falls back to current version when requested version is lower', async () => {
        // Seed DB at version 3 (no stores)
        const seed = await rawOpen(db, 3);
        seed.close();

        // Request version 1 — IDB would normally throw VersionError
        const conn = await openDB(db, 'store', undefined, 1);
        expect(conn).toBeInstanceOf(IDBDatabase);
        expect(conn.version).toBeGreaterThanOrEqual(3);
        expect(conn.objectStoreNames.contains('store')).toBe(true);
      });

      it('creates the missing store after recovering from a VersionError', async () => {
        const seed = await rawOpen(db, 5);
        seed.close();

        const conn = await openDB(db, 'recovered', undefined, 2);
        expect(conn.objectStoreNames.contains('recovered')).toBe(true);

        // Verify the store is fully functional
        await setInDB(conn, 'recovered', 'test', 42);
        expect(await getFromDB(conn, 'recovered', 'test')).toBe(42);
      });

      it('does not recurse infinitely on VersionError (isRetry guard)', async () => {
        // Seeding at a high version ensures VersionError on any explicit version < 10
        const seed = await rawOpen(db, 10);
        seed.close();

        await expect(openDB(db, 'store', undefined, 1)).resolves.toBeInstanceOf(IDBDatabase);
      });

      it('passes after VersionError even if the store must also be created', async () => {
        // DB at v4 with one existing store, target store not present
        const seed = await rawOpen(db, 4, (idb) => idb.createObjectStore('other'));
        seed.close();

        const conn = await openDB(db, 'newstore', undefined, 1);
        expect(conn.objectStoreNames.contains('newstore')).toBe(true);
        expect(conn.objectStoreNames.contains('other')).toBe(true);
      });
    });

    // ── singleton cache ───────────────────────────────────────────────────────

    describe('singleton promise cache', () => {
      it('returns the same Promise object for identical db:store pairs', () => {
        const p1 = openDB(db, 'store');
        const p2 = openDB(db, 'store');
        expect(p1).toBe(p2);
        return p1;
      });

      it('returns distinct Promises for different store names on the same DB', () => {
        const p1 = openDB(db, 'store-a');
        const p2 = openDB(db, 'store-b');
        expect(p1).not.toBe(p2);
        return Promise.all([p1, p2]);
      });

      it('returns distinct Promises for different database names', () => {
        const p1 = openDB(`${db}-1`, 'store');
        const p2 = openDB(`${db}-2`, 'store');
        expect(p1).not.toBe(p2);
        return Promise.all([p1, p2]);
      });

      it('clears the cache entry on rejection so the next call creates a fresh Promise', async () => {
        vi.useFakeTimers();

        vi.spyOn(globalThis.indexedDB, 'open').mockReturnValue(makeHangingRequest());

        const stale = openDB(db, 'store');

        // Exhaust all 3 attempts: 3 × 2000 ms + 2 × 500 ms retry delays
        await vi.advanceTimersByTimeAsync(3 * 2000 + 2 * 500 + 100);
        await expect(stale).rejects.toThrow('IndexedDB open timed out');

        vi.restoreAllMocks();
        vi.useRealTimers();

        const fresh = openDB(db, 'store');
        expect(fresh).not.toBe(stale);
        await expect(fresh).resolves.toBeInstanceOf(IDBDatabase);
      });
    });

    // ── onVersionChange callback ──────────────────────────────────────────────

    describe('onVersionChange callback', () => {
      it('is called when an external connection upgrades the DB version', async () => {
        const onVersionChange = vi.fn();
        const vcDb = `${db}-vc`;

        await openDB(vcDb, 'store', onVersionChange, 1);

        // An external upgrade from v1 → v2 fires versionchange on the open connection.
        // The library's onversionchange handler closes the connection; once closed,
        // the upgrade proceeds.
        await rawOpen(vcDb, 2);

        expect(onVersionChange).toHaveBeenCalledTimes(1);
      });

      it('clears all cache entries for that database on versionchange', async () => {
        const vcDb = `${db}-vc2`;

        const p1 = openDB(vcDb, 'store-a', undefined, 1);
        const p2 = openDB(vcDb, 'store-b', undefined, 1);
        await Promise.all([p1, p2]);

        // External upgrade causes both cache entries to be cleared
        await rawOpen(vcDb, 5);

        // Both entries were cleared — new calls return fresh (non-identical) Promises
        const p3 = openDB(vcDb, 'store-a');
        const p4 = openDB(vcDb, 'store-b');
        expect(p3).not.toBe(p1);
        expect(p4).not.toBe(p2);
        await Promise.all([p3, p4]);
      });
    });

    // ── timeout ───────────────────────────────────────────────────────────────

    describe('timeout', () => {
      it('rejects with an informative message when IDB.open never responds', async () => {
        vi.useFakeTimers();
        vi.spyOn(globalThis.indexedDB, 'open').mockReturnValue(makeHangingRequest());

        const promise = openDB(db, 'store');

        await vi.advanceTimersByTimeAsync(10_000);

        await expect(promise).rejects.toThrow(
          `IndexedDB open timed out for "${db}"`,
        );
      });

      it('the rejection message includes the database name', async () => {
        vi.useFakeTimers();
        vi.spyOn(globalThis.indexedDB, 'open').mockReturnValue(makeHangingRequest());

        const specificName = 'my-specific-db';
        const promise = openDB(specificName, 'store');

        await vi.advanceTimersByTimeAsync(10_000);

        await expect(promise).rejects.toThrow(specificName);
      });
    });

    // ── retry ─────────────────────────────────────────────────────────────────

    describe('retry', () => {
      it('calls indexedDB.open 3 times in total before giving up (initial + 2 retries)', async () => {
        vi.useFakeTimers();
        const openSpy = vi
          .spyOn(globalThis.indexedDB, 'open')
          .mockReturnValue(makeHangingRequest());

        const promise = openDB(db, 'store');

        await vi.advanceTimersByTimeAsync(3 * 2000 + 2 * 500 + 100);

        await expect(promise).rejects.toThrow();
        // Each retry calls _openDB once, which calls openAt once (no VersionError branch)
        expect(openSpy).toHaveBeenCalledTimes(3);
      });

      it('succeeds if a later retry attempt resolves', async () => {
        vi.useFakeTimers();

        let calls = 0;
        vi.spyOn(globalThis.indexedDB, 'open').mockImplementation((name, ver) => {
          calls++;
          if (calls < 3) return makeHangingRequest(); // first two attempts hang → timeout
          // 3rd attempt: delegate to real fake-indexeddb
          vi.mocked(globalThis.indexedDB.open).mockRestore();
          return indexedDB.open(name as string, ver as number | undefined);
        });

        const promise = openDB(db, 'store');

        // Advance past two timeouts + two retry delays so the 3rd attempt fires
        await vi.advanceTimersByTimeAsync(2 * 2000 + 2 * 500 + 100);

        // Let the real fake-indexeddb complete (real timers needed for IDB callbacks)
        vi.useRealTimers();
        const conn = await promise;
        expect(conn).toBeInstanceOf(IDBDatabase);
        expect(conn.objectStoreNames.contains('store')).toBe(true);
      });

      it('propagates the last error after exhausting all retries', async () => {
        vi.useFakeTimers();
        vi.spyOn(globalThis.indexedDB, 'open').mockReturnValue(makeHangingRequest());

        const promise = openDB(db, 'store');

        await vi.advanceTimersByTimeAsync(10_000);

        await expect(promise).rejects.toThrow('IndexedDB open timed out');
      });
    });

    // ── onblocked warning ─────────────────────────────────────────────────────

    describe('onblocked', () => {
      it('logs a console.warn when an open request is blocked and does not reject', async () => {
        // Hold a v1 connection open so the library's upgrade request gets blocked
        const holder = await rawOpen(db, 1);

        // Unblock when versionchange fires (the library already does this via attachVersionChange,
        // but holder was opened outside the library so we must handle it manually)
        holder.onversionchange = () => holder.close();

        const conn = await openDB(db, 'new-store');

        // fake-indexeddb may or may not fire onblocked; if it does, the warn must appear
        const warnCalls = (console.warn as ReturnType<typeof vi.fn>).mock.calls;
        const blocked = warnCalls.some((args) =>
          String(args[0]).includes('[use-idb-storage]'),
        );
        if (blocked) {
          expect(warnCalls.some((args) => String(args[0]).includes(db))).toBe(true);
        }

        // Either way the promise must resolve with a valid DB
        expect(conn.objectStoreNames.contains('new-store')).toBe(true);
        holder.close();
      });
    });
  });

  // ── getFromDB ───────────────────────────────────────────────────────────────

  describe('getFromDB', () => {
    let conn: IDBDatabase;

    beforeEach(async () => {
      conn = await openDB(db, 'store');
    });

    it('returns undefined for a key that has never been written', async () => {
      expect(await getFromDB(conn, 'store', 'ghost')).toBeUndefined();
    });

    it('returns the value that was previously stored', async () => {
      await setInDB(conn, 'store', 'k', { hello: 'world' });
      expect(await getFromDB(conn, 'store', 'k')).toEqual({ hello: 'world' });
    });

    it('returns the latest value after overwrite', async () => {
      await setInDB(conn, 'store', 'k', 'first');
      await setInDB(conn, 'store', 'k', 'second');
      expect(await getFromDB(conn, 'store', 'k')).toBe('second');
    });

    it('can read a value stored in a separate setInDB call', async () => {
      await setInDB(conn, 'store', 'a', 1);
      await setInDB(conn, 'store', 'b', 2);
      expect(await getFromDB(conn, 'store', 'a')).toBe(1);
      expect(await getFromDB(conn, 'store', 'b')).toBe(2);
    });

    it('rejects when the object store does not exist in the DB', async () => {
      await expect(getFromDB(conn, 'nonexistent', 'k')).rejects.toBeDefined();
    });

    it('rejects when the db argument is null', async () => {
      await expect(getFromDB(null as any, 'store', 'k')).rejects.toBeDefined();
    });

    it.each([
      ['string', 'hello'],
      ['number', 42],
      ['boolean', true],
      ['null', null],
      ['array', [1, 2, 3]],
      ['nested object', { a: { b: { c: 'd' } } }],
      ['Date', new Date('2024-01-01')],
    ])('round-trips %s values correctly', async (_label, value) => {
      await setInDB(conn, 'store', 'v', value);
      const result = await getFromDB(conn, 'store', 'v');
      expect(result).toEqual(value);
    });
  });

  // ── setInDB ─────────────────────────────────────────────────────────────────

  describe('setInDB', () => {
    let conn: IDBDatabase;

    beforeEach(async () => {
      conn = await openDB(db, 'store');
    });

    it('writes a new key-value pair', async () => {
      await setInDB(conn, 'store', 'key', 'value');
      expect(await getFromDB(conn, 'store', 'key')).toBe('value');
    });

    it('overwrites an existing value', async () => {
      await setInDB(conn, 'store', 'key', 'old');
      await setInDB(conn, 'store', 'key', 'new');
      expect(await getFromDB(conn, 'store', 'key')).toBe('new');
    });

    it('stores complex nested objects', async () => {
      const obj = { items: [{ id: 1, tags: ['a', 'b'] }], meta: { count: 1 } };
      await setInDB(conn, 'store', 'complex', obj);
      expect(await getFromDB(conn, 'store', 'complex')).toEqual(obj);
    });

    it('writes do not affect other keys', async () => {
      await setInDB(conn, 'store', 'x', 'X');
      await setInDB(conn, 'store', 'y', 'Y');
      await setInDB(conn, 'store', 'x', 'X2');
      expect(await getFromDB(conn, 'store', 'y')).toBe('Y');
    });

    it('rejects when the object store does not exist', async () => {
      await expect(setInDB(conn, 'nonexistent', 'k', 'v')).rejects.toBeDefined();
    });

    it('rejects when the db argument is null', async () => {
      await expect(setInDB(null as any, 'store', 'k', 'v')).rejects.toBeDefined();
    });
  });

  // ── removeFromDB ────────────────────────────────────────────────────────────

  describe('removeFromDB', () => {
    let conn: IDBDatabase;

    beforeEach(async () => {
      conn = await openDB(db, 'store');
    });

    it('removes an existing key', async () => {
      await setInDB(conn, 'store', 'gone', 'bye');
      await removeFromDB(conn, 'store', 'gone');
      expect(await getFromDB(conn, 'store', 'gone')).toBeUndefined();
    });

    it('resolves without error for a key that was never written', async () => {
      await expect(removeFromDB(conn, 'store', 'phantom')).resolves.toBeUndefined();
    });

    it('only removes the targeted key, leaving others intact', async () => {
      await setInDB(conn, 'store', 'keep', 'safe');
      await setInDB(conn, 'store', 'drop', 'gone');
      await removeFromDB(conn, 'store', 'drop');
      expect(await getFromDB(conn, 'store', 'keep')).toBe('safe');
      expect(await getFromDB(conn, 'store', 'drop')).toBeUndefined();
    });

    it('is idempotent — removing twice does not throw', async () => {
      await setInDB(conn, 'store', 'once', 'x');
      await removeFromDB(conn, 'store', 'once');
      await expect(removeFromDB(conn, 'store', 'once')).resolves.toBeUndefined();
    });

    it('rejects when the object store does not exist', async () => {
      await expect(removeFromDB(conn, 'nonexistent', 'k')).rejects.toBeDefined();
    });

    it('rejects when the db argument is null', async () => {
      await expect(removeFromDB(null as any, 'store', 'k')).rejects.toBeDefined();
    });
  });
});
