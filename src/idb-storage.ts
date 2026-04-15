import { getGlobalConfig } from '.';
import { getFromDB, openDB, removeFromDB, setInDB } from './database';
import type { IDBConfigValues } from './types';

/**
 * IDBStore provides key-value operations for a specific IndexedDB object store.
 * Inspired by idb-keyval but with store-specific operations and better error handling.
 */
export class IDBStore {
  private db: IDBDatabase;
  private storeName: string;

  constructor(db: IDBDatabase, storeName: string) {
    this.db = db;
    this.storeName = storeName;
  }

  /**
   * Get a value by key
   */
  async get<T>(key: string): Promise<T | undefined> {
    try {
      return await getFromDB<T>(this.db, this.storeName, key);
    } catch (error) {
      console.error(`Failed to get value for key "${key}":`, error);
      throw error;
    }
  }

  /**
   * Set a value for a key
   */
  async set<T>(key: string, value: T): Promise<void> {
    try {
      await setInDB(this.db, this.storeName, key, value);
    } catch (error) {
      console.error(`Failed to set value for key "${key}":`, error);
      throw error;
    }
  }

  /**
   * Delete a key-value pair
   */
  async delete(key: string): Promise<void> {
    try {
      await removeFromDB(this.db, this.storeName, key);
    } catch (error) {
      console.error(`Failed to delete key "${key}":`, error);
      throw error;
    }
  }

  /**
   * Get multiple values by keys
   */
  async getMany<T>(keys: string[]): Promise<(T | undefined)[]> {
    try {
      const promises = keys.map((key) => this.get<T>(key));
      return await Promise.all(promises);
    } catch (error) {
      console.error('Failed to get multiple values:', error);
      throw error;
    }
  }

  /**
   * Set multiple key-value pairs
   */
  async setMany<T>(entries: [string, T][]): Promise<void> {
    try {
      const transaction = this.db.transaction([this.storeName], 'readwrite');
      const store = transaction.objectStore(this.storeName);

      const promises = entries.map(([key, value]) => {
        return new Promise<void>((resolve, reject) => {
          const request = store.put(value, key);
          request.onerror = () => reject(request.error);
          request.onsuccess = () => resolve();
        });
      });

      await Promise.all(promises);
    } catch (error) {
      console.error('Failed to set multiple values:', error);
      throw error;
    }
  }

  /**
   * Delete multiple keys
   */
  async deleteMany(keys: string[]): Promise<void> {
    try {
      const transaction = this.db.transaction([this.storeName], 'readwrite');
      const store = transaction.objectStore(this.storeName);

      const promises = keys.map((key) => {
        return new Promise<void>((resolve, reject) => {
          const request = store.delete(key);
          request.onerror = () => reject(request.error);
          request.onsuccess = () => resolve();
        });
      });

      await Promise.all(promises);
    } catch (error) {
      console.error('Failed to delete multiple keys:', error);
      throw error;
    }
  }

  /**
   * Update a value using a transformer function
   */
  async update<T>(
    key: string,
    updater: (value: T | undefined) => T,
  ): Promise<void> {
    try {
      const currentValue = await this.get<T>(key);
      const newValue = updater(currentValue);
      await this.set(key, newValue);
    } catch (error) {
      console.error(`Failed to update value for key "${key}":`, error);
      throw error;
    }
  }

  /**
   * Clear all key-value pairs in the store
   */
  async clear(): Promise<void> {
    try {
      const transaction = this.db.transaction([this.storeName], 'readwrite');
      const store = transaction.objectStore(this.storeName);
      const request = store.clear();

      await new Promise<void>((resolve, reject) => {
        request.onerror = () => reject(request.error);
        request.onsuccess = () => resolve();
      });
    } catch (error) {
      console.error('Failed to clear store:', error);
      throw error;
    }
  }

  /**
   * Get all keys in the store
   */
  async keys(): Promise<string[]> {
    try {
      const transaction = this.db.transaction([this.storeName], 'readonly');
      const store = transaction.objectStore(this.storeName);
      const request = store.getAllKeys();

      return await new Promise<string[]>((resolve, reject) => {
        request.onerror = () => reject(request.error);
        request.onsuccess = () =>
          resolve(Array.from(request.result) as string[]);
      });
    } catch (error) {
      console.error('Failed to get keys:', error);
      throw error;
    }
  }

  /**
   * Get all values in the store
   */
  async values<T>(): Promise<T[]> {
    try {
      const transaction = this.db.transaction([this.storeName], 'readonly');
      const store = transaction.objectStore(this.storeName);
      const request = store.getAll();

      return await new Promise<T[]>((resolve, reject) => {
        request.onerror = () => reject(request.error);
        request.onsuccess = () => resolve(request.result);
      });
    } catch (error) {
      console.error('Failed to get values:', error);
      throw error;
    }
  }

  /**
   * Get all entries in the store
   */
  async entries<T>(): Promise<[string, T][]> {
    try {
      const transaction = this.db.transaction([this.storeName], 'readonly');
      const store = transaction.objectStore(this.storeName);
      const request = store.openCursor();

      const entries: [string, T][] = [];

      return new Promise((resolve, reject) => {
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const cursor = request.result;
          if (cursor) {
            entries.push([cursor.key as string, cursor.value]);
            cursor.continue();
          } else {
            resolve(entries);
          }
        };
      });
    } catch (error) {
      console.error('Failed to get entries:', error);
      throw error;
    }
  }
}

/**
 * IDBStorage provides access to IndexedDB with multiple stores.
 * Main entry point for database operations.
 */
export class IDBStorage {
  private config: IDBConfigValues;
  private db: IDBDatabase | null = null;
  private dbPromise: Promise<IDBDatabase> | null = null;

  constructor(config?: Partial<IDBConfigValues>) {
    const globalConfig = getGlobalConfig();
    const defaultConfig: IDBConfigValues = {
      database: 'sohanemon-idb',
      version: 1,
      store: 'default',
    };

    this.config = { ...defaultConfig, ...globalConfig, ...config };
  }

  /**
   * Get or create the database connection
   */
  private async getDB(): Promise<IDBDatabase> {
    if (this.db) return this.db;
    if (this.dbPromise) return this.dbPromise;

    this.dbPromise = openDB(
      this.config.database,
      this.config.store,
      () => {
        this.db = null;
        this.dbPromise = null;
      },
      this.config.version,
    );

    try {
      this.db = await this.dbPromise;
      this.dbPromise = null;
      return this.db;
    } catch (err) {
      this.dbPromise = null;
      throw err;
    }
  }

  /**
   * Get a store instance by name
   */
  async get(storeName: string): Promise<IDBStore> {
    const db = await this.getDB();
    return new IDBStore(db, storeName);
  }

  /**
   * Get the default store instance
   */
  get store(): Promise<IDBStore> {
    return this.get(this.config.store);
  }

  /**
   * Drop/delete a specific store
   * Note: IndexedDB doesn't support dropping stores after creation
   * This would require a version upgrade with store deletion
   * For now, we'll clear the store instead
   */
  async drop(storeName: string): Promise<void> {
    const store = await this.get(storeName);
    await store.clear();
  }

  /**
   * Close the database connection
   */
  close(): void {
    if (this.db) {
      this.db.close();
      this.db = null;
    }
  }
}
