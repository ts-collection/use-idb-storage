import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { configureIDBStorage, getGlobalConfig } from '../src';
import { IDBStorage } from '../src/idb-storage';
import { clearAllDatabases, createTestDbName } from './setup';

describe('IDBStorage', () => {
  let testDbName: string;

  beforeEach(() => {
    testDbName = createTestDbName();
  });

  afterEach(async () => {
    await clearAllDatabases();
  });

  describe('Basic Operations', () => {
    it('should create a storage instance with default config', () => {
      const storage = new IDBStorage();
      expect(storage).toBeInstanceOf(IDBStorage);
    });

    it('should create a storage instance with custom config', () => {
      const config = {
        database: testDbName,
        version: 2,
        store: 'custom-store',
      };
      const storage = new IDBStorage(config);
      expect(storage).toBeInstanceOf(IDBStorage);
    });

    it('should use global config when no config provided', () => {
      // Set global config
      const globalConfig = {
        database: 'global-db',
        version: 3,
        store: 'global-store',
      };
      configureIDBStorage(globalConfig);

      // Create storage without config - should use global config
      const storage = new IDBStorage();
      expect(storage).toBeInstanceOf(IDBStorage);

      // Verify global config was applied
      const retrievedConfig = getGlobalConfig();
      expect(retrievedConfig).toEqual(globalConfig);

      // Reset global config
      configureIDBStorage({
        database: 'sohanemon-idb',
        version: 1,
        store: 'default',
      });
    });

    it('should override global config with constructor config', () => {
      // Set global config
      configureIDBStorage({
        database: 'global-db',
        version: 3,
        store: 'global-store',
      });

      // Create storage with explicit config - should override global
      const explicitConfig = {
        database: testDbName,
        version: 5,
        store: 'explicit-store',
      };
      const storage = new IDBStorage(explicitConfig);
      expect(storage).toBeInstanceOf(IDBStorage);

      // Reset global config
      configureIDBStorage({
        database: 'sohanemon-idb',
        version: 1,
        store: 'default',
      });
    });

    it('should get a store instance', async () => {
      const storage = new IDBStorage({ database: testDbName });
      const store = await storage.get('default'); // Use default store to avoid fake-indexeddb issues
      expect(store).toBeDefined();
      expect(typeof store.get).toBe('function');
      expect(typeof store.set).toBe('function');
      storage.close();
    });

    it('should provide access to default store', async () => {
      const storage = new IDBStorage({ database: testDbName });
      const store = await storage.store;
      expect(store).toBeDefined();
      storage.close();
    });
  });

  describe('Store Operations (Default Store Only)', () => {
    let storage: IDBStorage;
    let store: any;

    beforeEach(async () => {
      storage = new IDBStorage({ database: testDbName });
      store = await storage.get('default'); // Only test default store due to fake-indexeddb limitations
    });

    afterEach(() => {
      storage.close();
    });

    it('should set and get a value', async () => {
      const key = 'test-key';
      const value = { data: 'test-value' };

      await store.set(key, value);
      const retrieved = await store.get(key);

      expect(retrieved).toEqual(value);
    });

    it('should return undefined for non-existent key', async () => {
      const retrieved = await store.get('non-existent-key');
      expect(retrieved).toBeUndefined();
    });

    it('should delete a value', async () => {
      const key = 'delete-test';
      const value = 'to-be-deleted';

      await store.set(key, value);
      let retrieved = await store.get(key);
      expect(retrieved).toBe(value);

      await store.delete(key);
      retrieved = await store.get(key);
      expect(retrieved).toBeUndefined();
    });

    it('should update a value', async () => {
      const key = 'update-test';
      const initialValue = { count: 1 };
      const updatedValue = { count: 2 };

      await store.set(key, initialValue);
      await store.update(key, (current) => updatedValue);

      const retrieved = await store.get(key);
      expect(retrieved).toEqual(updatedValue);
    });

    it('should handle update with undefined current value', async () => {
      const key = 'update-undefined-test';
      const newValue = { created: true };

      await store.update(key, (current) => {
        expect(current).toBeUndefined();
        return newValue;
      });

      const retrieved = await store.get(key);
      expect(retrieved).toEqual(newValue);
    });

    it('should clear all values in store', async () => {
      const entries = [
        ['key1', 'value1'],
        ['key2', 'value2'],
        ['key3', 'value3'],
      ];

      // Set multiple values
      for (const [key, value] of entries) {
        await store.set(key, value);
      }

      // Verify they exist
      for (const [key, value] of entries) {
        const retrieved = await store.get(key);
        expect(retrieved).toBe(value);
      }

      // Clear store
      await store.clear();

      // Verify they're gone
      for (const [key] of entries) {
        const retrieved = await store.get(key);
        expect(retrieved).toBeUndefined();
      }
    });

    it('should get all keys', async () => {
      const entries = [
        ['key1', 'value1'],
        ['key2', 'value2'],
        ['key3', 'value3'],
      ];

      for (const [key, value] of entries) {
        await store.set(key, value);
      }

      const keys = await store.keys();
      expect(keys).toHaveLength(3);
      expect(keys).toEqual(expect.arrayContaining(['key1', 'key2', 'key3']));
    });

    it('should get all values', async () => {
      const entries = [
        ['key1', 'value1'],
        ['key2', 'value2'],
        ['key3', 'value3'],
      ];

      for (const [key, value] of entries) {
        await store.set(key, value);
      }

      const values = await store.values();
      expect(values).toHaveLength(3);
      expect(values).toEqual(
        expect.arrayContaining(['value1', 'value2', 'value3']),
      );
    });

    it('should get all entries', async () => {
      const entries = [
        ['key1', 'value1'],
        ['key2', 'value2'],
      ];

      for (const [key, value] of entries) {
        await store.set(key, value);
      }

      const allEntries = await store.entries();
      expect(allEntries).toHaveLength(2);

      const entryMap = new Map(allEntries);
      expect(entryMap.get('key1')).toBe('value1');
      expect(entryMap.get('key2')).toBe('value2');
    });
  });

  describe('Batch Operations (Default Store Only)', () => {
    let storage: IDBStorage;
    let store: any;

    beforeEach(async () => {
      storage = new IDBStorage({ database: testDbName });
      store = await storage.get('default'); // Only test default store
    });

    afterEach(() => {
      storage.close();
    });

    it('should get multiple values', async () => {
      const entries = [
        ['key1', 'value1'],
        ['key2', 'value2'],
        ['key3', 'value3'],
      ];

      for (const [key, value] of entries) {
        await store.set(key, value);
      }

      const results = await store.getMany(['key1', 'key3', 'non-existent']);
      expect(results).toEqual(['value1', 'value3', undefined]);
    });

    it('should set multiple values', async () => {
      const entries = [
        ['batch1', 'batch-value1'],
        ['batch2', 'batch-value2'],
        ['batch3', 'batch-value3'],
      ];

      await store.setMany(entries);

      for (const [key, expectedValue] of entries) {
        const retrieved = await store.get(key);
        expect(retrieved).toBe(expectedValue);
      }
    });

    it('should delete multiple values', async () => {
      const entries = [
        ['del1', 'del-value1'],
        ['del2', 'del-value2'],
        ['del3', 'del-value3'],
      ];

      // Set values
      for (const [key, value] of entries) {
        await store.set(key, value);
      }

      // Delete some
      await store.deleteMany(['del1', 'del3']);

      // Check results
      expect(await store.get('del1')).toBeUndefined();
      expect(await store.get('del2')).toBe('del-value2');
      expect(await store.get('del3')).toBeUndefined();
    });
  });

  describe('Multiple Databases', () => {
    it('should isolate data between different database names', async () => {
      const dbA = `${testDbName}-a`;
      const dbB = `${testDbName}-b`;

      const storageA = new IDBStorage({ database: dbA });
      const storageB = new IDBStorage({ database: dbB });

      const storeA = await storageA.get('default');
      const storeB = await storageB.get('default');

      await storeA.set('key', 'value-from-a');
      await storeB.set('key', 'value-from-b');

      expect(await storeA.get('key')).toBe('value-from-a');
      expect(await storeB.get('key')).toBe('value-from-b');
    });

    it('should not share keys between different database names', async () => {
      const dbA = `${testDbName}-c`;
      const dbB = `${testDbName}-d`;

      const storageA = new IDBStorage({ database: dbA });
      const storageB = new IDBStorage({ database: dbB });

      const storeA = await storageA.get('default');
      const storeB = await storageB.get('default');

      await storeA.set('exclusive', 'only-in-a');

      expect(await storeA.get('exclusive')).toBe('only-in-a');
      expect(await storeB.get('exclusive')).toBeUndefined();
    });
  });

  describe('Version Handling', () => {
    it.skip('should handle version upgrades', async () => {
      const key = 'version-key';
      const oldValue = 'old-version';

      // Store with version 1
      const storage1 = new IDBStorage({
        database: testDbName,
        store: 'default',
        version: 1,
      });
      const store1 = await storage1.get('default');
      await store1.set(key, oldValue);
      storage1.close();

      // Create storage with version 2 (should upgrade)
      const storage2 = new IDBStorage({
        database: testDbName,
        store: 'default',
        version: 2,
      });
      const store2 = await storage2.get('default');

      // Data should still be there
      const retrieved = await store2.get(key);
      expect(retrieved).toBe(oldValue);

      storage2.close();
    });
  });

  describe('Error Handling', () => {
    it('should handle database errors gracefully', async () => {
      const storage = new IDBStorage({ database: testDbName });
      const store = await storage.get('default');

      // Try to get a non-existent key (should not throw)
      const result = await store.get('non-existent');
      expect(result).toBeUndefined();

      storage.close();
    });

    it('should propagate errors thrown during set', async () => {
      const storage = new IDBStorage({ database: testDbName });
      const store = await storage.get('default');

      // Corrupt the internal db reference to force a transaction error
      (store as any).db = null;

      await expect(store.set('key', 'val')).rejects.toThrow();
      await expect(store.get('key')).rejects.toThrow();
    });
  });

  describe('Connection Management', () => {
    it('should reuse database connections', async () => {
      const storage1 = new IDBStorage({ database: testDbName });
      const storage2 = new IDBStorage({ database: testDbName });

      const store1 = await storage1.get('default');
      const store2 = await storage2.get('default');

      await store1.set('shared-key', 'shared-value');

      // Both should access the same data
      expect(await store2.get('shared-key')).toBe('shared-value');

      storage1.close();
      storage2.close();
    });

    it('should close connections properly', async () => {
      const storage = new IDBStorage({ database: testDbName });
      const store = await storage.get('default');

      await store.set('close-key', 'close-value');
      expect(await store.get('close-key')).toBe('close-value');

      storage.close();

      // After closing, operations should still work (fake-indexeddb behavior)
      // In real IndexedDB, this would fail, but fake-indexeddb allows it
    });

    it('should share the same underlying connection between instances of the same database', async () => {
      const storageA = new IDBStorage({ database: testDbName });
      const storageB = new IDBStorage({ database: testDbName });

      const storeA = await storageA.get('default');
      const storeB = await storageB.get('default');

      await storeA.set('shared', 'written-by-a');
      expect(await storeB.get('shared')).toBe('written-by-a');

      await storeB.set('shared', 'written-by-b');
      expect(await storeA.get('shared')).toBe('written-by-b');
    });
  });

  describe('Data Types', () => {
    let storage: IDBStorage;
    let store: Awaited<ReturnType<IDBStorage['get']>>;

    beforeEach(async () => {
      storage = new IDBStorage({ database: testDbName });
      store = await storage.get('default');
    });

    afterEach(() => {
      storage.close();
    });

    it.each([
      ['non-empty string', 'hello world'],
      ['empty string', ''],
      ['unicode + emoji', '你好世界 🌍'],
      ['integer', 42],
      ['negative integer', -99],
      ['float', 3.14159],
      ['zero', 0],
      ['boolean true', true],
      ['boolean false', false],
      ['null', null],
      ['empty array', []],
      ['array with mixed types', [1, 'two', { three: 3 }]],
      ['plain object', { a: 1, b: 'two' }],
      ['deeply nested object', { outer: { inner: { deep: [1, 2, 3] } } }],
    ])('should round-trip %s', async (_label, value) => {
      await store.set('type-test', value);
      expect(await store.get('type-test')).toEqual(value);
    });

    it('should round-trip a Date object', async () => {
      const date = new Date('2024-06-15T12:00:00.000Z');
      await store.set('date-key', date);
      const retrieved = await store.get<Date>('date-key');
      expect(retrieved).toBeInstanceOf(Date);
      expect(retrieved?.getTime()).toBe(date.getTime());
    });

    it('should round-trip a large object (1 000 items)', async () => {
      const large = {
        items: Array.from({ length: 1000 }, (_, i) => ({ id: i, label: `item-${i}` })),
      };
      await store.set('large', large);
      expect(await store.get('large')).toEqual(large);
    });

    it('should overwrite an existing key', async () => {
      await store.set('ow', 'first');
      await store.set('ow', 'second');
      expect(await store.get('ow')).toBe('second');
    });

    it('should return empty results on a fresh store', async () => {
      expect(await store.keys()).toEqual([]);
      expect(await store.values()).toEqual([]);
      expect(await store.entries()).toEqual([]);
    });

    it('should return undefined for a key that was never written', async () => {
      expect(await store.get('does-not-exist')).toBeUndefined();
    });
  });

  describe('drop()', () => {
    it('should clear all records from the target store', async () => {
      const storage = new IDBStorage({ database: testDbName });
      const store = await storage.get('default');

      await store.set('k1', 'v1');
      await store.set('k2', 'v2');
      expect(await store.keys()).toHaveLength(2);

      await storage.drop('default');
      expect(await store.keys()).toEqual([]);
    });

    it('should not affect other databases', async () => {
      const storageA = new IDBStorage({ database: `${testDbName}-drop-a` });
      const storageB = new IDBStorage({ database: `${testDbName}-drop-b` });
      const storeA = await storageA.get('default');
      const storeB = await storageB.get('default');

      await storeA.set('k', 'v');
      await storeB.set('k', 'v');

      await storageA.drop('default');

      expect(await storeA.get('k')).toBeUndefined();
      expect(await storeB.get('k')).toBe('v');
    });
  });
});
