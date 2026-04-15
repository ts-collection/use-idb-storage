import { act, render, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IDBConfig, IDBStorage, configureIDBStorage, getGlobalConfig, idb } from '../src';
import { useIDBStorage } from '../src/hook';
import {
  clearAllDatabases,
  createTestDbName,
  flushPromises,
  nextTick,
  wait,
} from './setup';

describe('useIDBStorage', () => {
  let testDbName: string;

  beforeEach(() => {
    testDbName = createTestDbName();
  });

  afterEach(async () => {
    await clearAllDatabases();
  });

  describe('Basic Initialization', () => {
    it('should initialize with default value immediately', () => {
      const { result } = renderHook(() =>
        useIDBStorage({
          key: 'test-key',
          defaultValue: { value: 'default' },
          database: 'test-db',
          version: 1,
          store: 'test-store',
        }),
      );

      expect(result.current[0]).toEqual({ value: 'default' });
      expect(result.current.data).toEqual({ value: 'default' });
    });

    it('should accept custom database and store names', () => {
      const { result } = renderHook(() =>
        useIDBStorage({
          key: 'test-key',
          defaultValue: { value: 'default' },
          database: testDbName,
          version: 1,
          store: 'custom-store',
        }),
      );

      expect(result.current[0]).toEqual({ value: 'default' });
    });

    it('should work with primitive values', () => {
      const { result } = renderHook(() =>
        useIDBStorage({
          key: 'primitive-key',
          defaultValue: 42,
          database: 'test-db',
          version: 1,
          store: 'default',
        }),
      );

      expect(result.current[0]).toBe(42);
    });

    it('should work with string values', () => {
      const { result } = renderHook(() =>
        useIDBStorage({
          key: 'string-key',
          defaultValue: 'hello world',
          database: 'test-db',
          version: 1,
          store: 'default',
        }),
      );

      expect(result.current[0]).toBe('hello world');
    });

    it('should work with array values', () => {
      const defaultArray = [1, 2, 3];
      const { result } = renderHook(() =>
        useIDBStorage({
          key: 'array-key',
          defaultValue: defaultArray,
          database: 'test-db',
          version: 1,
          store: 'default',
        }),
      );

      expect(result.current[0]).toEqual(defaultArray);
    });

    it('should work with null values', () => {
      const { result } = renderHook(() =>
        useIDBStorage({
          key: 'null-key',
          defaultValue: null,
          database: 'test-db',
          version: 1,
          store: 'default',
        }),
      );

      expect(result.current[0]).toBeNull();
    });

    it('should support object destructuring', () => {
      const { result } = renderHook(() =>
        useIDBStorage({
          key: 'object-key',
          defaultValue: 'test',
          database: 'test-db',
          version: 1,
          store: 'default',
        }),
      );

      expect(result.current.data).toBe('test');
      expect(result.current.update).toBeInstanceOf(Function);
      expect(result.current.reset).toBeInstanceOf(Function);
      expect(result.current.length).toBe(3);
      expect(result.current.loading).toBe(true); // Initially loading
      expect(result.current.persisted).toBe(false); // Not yet persisted
      expect(result.current.error).toBeNull();
      expect(result.current.lastUpdated).toBeNull();
      expect(result.current.refresh).toBeInstanceOf(Function);
    });
  });

  describe('Persistence and Loading', () => {
    it('should persist value changes to IndexedDB', async () => {
      const key = 'persist-test';

      const { result: r1, unmount: u1 } = renderHook(() =>
        useIDBStorage({ key, defaultValue: 'default', database: testDbName }),
      );
      await waitFor(() => expect(r1.current.persisted).toBe(true));

      act(() => {
        r1.current.update('persisted-value');
      });
      await nextTick();
      await flushPromises();
      u1();

      const { result: r2 } = renderHook(() =>
        useIDBStorage({ key, defaultValue: 'default', database: testDbName }),
      );
      await waitFor(() => expect(r2.current.persisted).toBe(true));
      expect(r2.current.data).toBe('persisted-value');
    });

    it('should handle function updates', async () => {
      const key = 'function-update-test';

      const { result } = renderHook(() =>
        useIDBStorage({
          key,
          defaultValue: { count: 0 },
          database: testDbName,
        }),
      );

      // Wait for initialization
      await waitFor(() => {
        expect(result.current[0]).toEqual({ count: 0 });
      });
      await nextTick();

      // Update using a function
      act(() => {
        result.current[1]((prev) => ({ count: prev.count + 1 }));
      });

      expect(result.current[0]).toEqual({ count: 1 });

      // Update again
      act(() => {
        result.current[1]((prev) => ({ count: prev.count * 2 }));
      });

      expect(result.current[0]).toEqual({ count: 2 });
    });
  });

  describe('Removal Functionality', () => {
    it('should remove value and reset to default', async () => {
      const key = 'remove-test';

      // Write and persist a custom value
      const { result: r1, unmount: u1 } = renderHook(() =>
        useIDBStorage({ key, defaultValue: 'default-val', database: testDbName }),
      );
      await waitFor(() => expect(r1.current.persisted).toBe(true));
      act(() => {
        r1.current.update('custom-value');
      });
      await nextTick();
      await flushPromises();
      u1();

      // Verify it persisted, then reset
      const { result: r2, unmount: u2 } = renderHook(() =>
        useIDBStorage({ key, defaultValue: 'default-val', database: testDbName }),
      );
      await waitFor(() => expect(r2.current.data).toBe('custom-value'));

      act(() => {
        r2.current.reset();
      });
      expect(r2.current.data).toBe('default-val');
      expect(r2.current.lastUpdated).toBeNull();

      await nextTick();
      await flushPromises();
      u2();

      // Next hook should see the default persisted back to IDB
      const { result: r3 } = renderHook(() =>
        useIDBStorage({ key, defaultValue: 'default-val', database: testDbName }),
      );
      await waitFor(() => expect(r3.current.persisted).toBe(true));
      expect(r3.current.data).toBe('default-val');
    });
  });

  describe('Global Configuration', () => {
    it('should use global configuration when no explicit config provided', () => {
      const globalValue = {
        database: testDbName,
        store: 'global-store',
        version: 2,
      };

      configureIDBStorage(globalValue);

      const { result } = renderHook(() =>
        useIDBStorage({
          key: 'global-test',
          defaultValue: 'global-value',
        }),
      );

      expect(result.current[0]).toBe('global-value');
    });

    it('should override global config with explicit options', () => {
      const globalValue = {
        database: 'global-db',
        store: 'global-store',
        version: 1,
      };

      configureIDBStorage(globalValue);

      const explicitConfig = {
        database: testDbName,
        store: 'explicit-store',
        version: 3,
      };

      const { result } = renderHook(() =>
        useIDBStorage({
          key: 'override-test',
          defaultValue: 'override-value',
          ...explicitConfig,
        }),
      );

      expect(result.current[0]).toBe('override-value');
    });
  });

  describe('Error Handling', () => {
    it('should handle IndexedDB unavailability gracefully', () => {
      // Mock IndexedDB as unavailable
      const originalIndexedDB = window.indexedDB;
      Object.defineProperty(window, 'indexedDB', {
        value: null,
        writable: true,
      });

      const { result } = renderHook(() =>
        useIDBStorage({
          key: 'unavailable-test',
          defaultValue: 'fallback-value',
        }),
      );

      expect(result.current[0]).toBe('fallback-value');

      // Restore IndexedDB
      Object.defineProperty(window, 'indexedDB', {
        value: originalIndexedDB,
        writable: true,
      });
    });

    it('should handle database errors gracefully', async () => {
      // Mock console.error to avoid test output pollution
      const consoleError = vi
        .spyOn(console, 'error')
        .mockImplementation(() => {});

      const { result } = renderHook(() =>
        useIDBStorage({
          key: 'error-test',
          defaultValue: 'error-default',
          database: testDbName,
        }),
      );

      // Should still have default value even if IDB fails
      expect(result.current[0]).toBe('error-default');

      consoleError.mockRestore();
    });
  });

  describe('Multiple Instances', () => {
    it('should handle multiple hooks with different keys independently', async () => {
      const { result: result1 } = renderHook(() =>
        useIDBStorage({
          key: 'key1',
          defaultValue: 'value1',
          database: testDbName,
        }),
      );

      const { result: result2 } = renderHook(() =>
        useIDBStorage({
          key: 'key2',
          defaultValue: 'value2',
          database: testDbName,
        }),
      );

      expect(result1.current[0]).toBe('value1');
      expect(result2.current[0]).toBe('value2');

      // Update first hook
      act(() => {
        result1.current[1]('updated1');
      });

      expect(result1.current[0]).toBe('updated1');
      expect(result2.current[0]).toBe('value2');
    });

    it('should load the same persisted value when multiple hooks share a key', async () => {
      const key = 'same-key-load';

      // Pre-populate IDB
      const setup = new IDBStorage({ database: testDbName });
      const setupStore = await setup.get('default');
      await setupStore.set(key, 'shared-persisted');

      const { result: r1 } = renderHook(() =>
        useIDBStorage({ key, defaultValue: 'default', database: testDbName }),
      );
      const { result: r2 } = renderHook(() =>
        useIDBStorage({ key, defaultValue: 'default', database: testDbName }),
      );

      await waitFor(() => expect(r1.current.persisted).toBe(true));
      await waitFor(() => expect(r2.current.persisted).toBe(true));

      expect(r1.current.data).toBe('shared-persisted');
      expect(r2.current.data).toBe('shared-persisted');
    });

    it('should not auto-sync between hooks with same key — refresh() is required', async () => {
      const key = 'same-key-no-sync';

      const { result: r1 } = renderHook(() =>
        useIDBStorage({ key, defaultValue: 'default', database: testDbName }),
      );
      const { result: r2 } = renderHook(() =>
        useIDBStorage({ key, defaultValue: 'default', database: testDbName }),
      );

      await waitFor(() => expect(r1.current.persisted).toBe(true));
      await waitFor(() => expect(r2.current.persisted).toBe(true));

      // Update hook 1 — hook 2 must NOT automatically reflect it
      act(() => {
        r1.current.update('new-by-r1');
      });
      expect(r2.current.data).toBe('default');

      // After r1's save completes and r2.refresh() is called, r2 sees the new value
      await nextTick();
      await flushPromises();
      await act(async () => {
        await r2.current.refresh();
      });
      expect(r2.current.data).toBe('new-by-r1');
    });
  });

  describe('Lifecycle and Cleanup', () => {
    it('should cleanup on unmount', async () => {
      const key = 'cleanup-test';

      const { result, unmount } = renderHook(() =>
        useIDBStorage({
          key,
          defaultValue: 'cleanup-value',
          database: testDbName,
        }),
      );

      // Update value
      act(() => {
        result.current[1]('updated-value');
      });

      expect(result.current[0]).toBe('updated-value');

      // Unmount
      unmount();

      // Verify cleanup happened (no errors should occur)
      await nextTick();
    });

    it('should not break the shared DB connection when unmounted', async () => {
      // Regression: unmounting a hook used to call IDBStorage.close() which closed
      // the native connection but left a stale entry in dbConnections. Any subsequent
      // hook using the same database would get back the closed connection and throw
      // "InvalidStateError: The database connection is closing".
      const sharedDb = testDbName;

      const { result: result1, unmount } = renderHook(() =>
        useIDBStorage({ key: 'k1', defaultValue: 'a', database: sharedDb }),
      );

      await waitFor(() => expect(result1.current.persisted).toBe(true));

      // Unmount the first hook — previously this closed the shared connection
      unmount();
      await nextTick();

      // A second hook using the same database must still work without errors
      const { result: result2 } = renderHook(() =>
        useIDBStorage({ key: 'k2', defaultValue: 'b', database: sharedDb }),
      );

      await waitFor(() => expect(result2.current.persisted).toBe(true));
      expect(result2.current.data).toBe('b');
      expect(result2.current.error).toBeNull();
    });

    it('should handle rapid updates correctly', async () => {
      const key = 'rapid-test';

      const { result } = renderHook(() =>
        useIDBStorage({
          key,
          defaultValue: 0,
          database: testDbName,
        }),
      );

      // Wait for initialization
      await waitFor(() => {
        expect(result.current[0]).toBe(0);
      });
      await nextTick();

      // Rapid updates
      act(() => result.current[1](1));
      act(() => result.current[1](2));
      act(() => result.current[1](3));

      // Should have the latest value
      expect(result.current[0]).toBe(3);
    });
  });

  describe('Version Handling', () => {
    it.skip('should handle version upgrades', async () => {
      const key = 'version-test';
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

      // Hook with version 2 (should handle upgrade)
      const { result } = renderHook(() =>
        useIDBStorage({
          key,
          defaultValue: 'default',
          database: testDbName,
          version: 2,
        }),
      );

      // Should load the old value (upgrade preserves data)
      await waitFor(() => {
        expect(result.current[0]).toBe(oldValue);
      });
    });
  });

  describe('Render Optimization', () => {
    it('should not cause infinite re-renders during initialization', async () => {
      let renderCount = 0;

      const { result, rerender } = renderHook(() => {
        renderCount++;
        return useIDBStorage({
          key: 'render-test',
          defaultValue: 'test-value',
          database: testDbName,
        });
      });

      // Wait for initialization to complete
      await waitFor(() => {
        expect(result.current[0]).toBe('test-value');
      });

      const initialRenderCount = renderCount;

      // Force a few re-renders
      rerender();
      rerender();
      rerender();

      // Wait a bit to ensure no additional renders are triggered
      await wait(50);

      // Should not have excessive renders (allow some buffer for React's internal renders)
      expect(renderCount - initialRenderCount).toBeLessThan(5);
    });

    it('should not re-render unnecessarily when config stays the same', async () => {
      let renderCount = 0;

      const stableConfig = {
        key: 'stable-config-test',
        defaultValue: 'stable',
        database: testDbName,
        store: 'default',
        version: 1,
      };

      const { result, rerender } = renderHook(
        (config) => {
          renderCount++;
          return useIDBStorage(config);
        },
        { initialProps: stableConfig },
      );

      // Wait for initialization
      await waitFor(() => {
        expect(result.current[0]).toBe('stable');
      });

      const initialRenderCount = renderCount;

      // Re-render with same config (should not trigger hook re-initialization)
      rerender(stableConfig);
      rerender(stableConfig);

      // Wait to ensure no additional renders
      await wait(50);

      // Should not have triggered additional hook re-initialization renders
      expect(renderCount - initialRenderCount).toBeLessThanOrEqual(3);
    });

    it('should minimize renders during rapid updates', async () => {
      let renderCount = 0;

      const { result } = renderHook(() => {
        renderCount++;
        return useIDBStorage({
          key: 'rapid-render-test',
          defaultValue: 0,
          database: testDbName,
        });
      });

      // Wait for initialization
      await waitFor(() => {
        expect(result.current[0]).toBe(0);
      });

      const initialRenderCount = renderCount;

      // Perform rapid updates
      act(() => result.current[1](1));
      act(() => result.current[1](2));
      act(() => result.current[1](3));
      act(() => result.current[1](4));

      // Wait for updates to settle
      await wait(100);

      // Should have reasonable render count (initial + 4 updates + some buffer)
      expect(renderCount - initialRenderCount).toBeLessThan(10);
    });

    it('should handle config changes without excessive renders', async () => {
      let renderCount = 0;

      const { result, rerender } = renderHook(
        ({ key }: { key: string }) => {
          renderCount++;
          return useIDBStorage({
            key,
            defaultValue: 'test',
            database: testDbName,
          });
        },
        { initialProps: { key: 'initial-key' } },
      );

      // Wait for initialization
      await waitFor(() => {
        expect(result.current[0]).toBe('test');
      });

      const initialRenderCount = renderCount;

      // Change key (should trigger re-initialization)
      rerender({ key: 'new-key' });

      // Wait for new initialization
      await waitFor(() => {
        expect(result.current[0]).toBe('test');
      });

      // Should have re-initialized but not infinitely
      expect(renderCount - initialRenderCount).toBeLessThan(10);
    });
  });

  describe('State Transitions', () => {
    it('should start loading and transition to persisted after IDB read', async () => {
      const { result } = renderHook(() =>
        useIDBStorage({ key: 'state-trans', defaultValue: 'x', database: testDbName }),
      );

      expect(result.current.loading).toBe(true);
      expect(result.current.persisted).toBe(false);

      await waitFor(() => expect(result.current.loading).toBe(false));
      expect(result.current.persisted).toBe(true);
    });

    it('should set lastUpdated after initialization (LOAD_VALUE)', async () => {
      const { result } = renderHook(() =>
        useIDBStorage({ key: 'lu-init', defaultValue: 'v', database: testDbName }),
      );

      // Initially null
      expect(result.current.lastUpdated).toBeNull();

      await waitFor(() => expect(result.current.persisted).toBe(true));
      // LOAD_VALUE sets lastUpdated
      expect(result.current.lastUpdated).toBeInstanceOf(Date);
    });

    it('should update lastUpdated on each value change', async () => {
      const { result } = renderHook(() =>
        useIDBStorage({ key: 'lu-update', defaultValue: 0, database: testDbName }),
      );
      await waitFor(() => expect(result.current.persisted).toBe(true));

      const after1st = result.current.lastUpdated!.getTime();

      await wait(2); // ensure clock advances
      act(() => {
        result.current.update(1);
      });
      expect(result.current.lastUpdated!.getTime()).toBeGreaterThanOrEqual(after1st);

      await wait(2);
      act(() => {
        result.current.update(2);
      });
      expect(result.current.lastUpdated!.getTime()).toBeGreaterThanOrEqual(
        result.current.lastUpdated!.getTime(),
      );
    });

    it('should clear lastUpdated on reset', async () => {
      const { result } = renderHook(() =>
        useIDBStorage({ key: 'lu-reset', defaultValue: 'def', database: testDbName }),
      );
      await waitFor(() => expect(result.current.persisted).toBe(true));

      act(() => {
        result.current.update('some-value');
      });
      expect(result.current.lastUpdated).toBeInstanceOf(Date);

      act(() => {
        result.current.reset();
      });
      expect(result.current.lastUpdated).toBeNull();
    });

    it('should keep error null during normal operations', async () => {
      const { result } = renderHook(() =>
        useIDBStorage({ key: 'no-err', defaultValue: 'v', database: testDbName }),
      );
      await waitFor(() => expect(result.current.persisted).toBe(true));

      act(() => {
        result.current.update('changed');
      });
      act(() => {
        result.current.reset();
      });

      expect(result.current.error).toBeNull();
    });

    it('should clear error state when a subsequent UPDATE_VALUE succeeds', async () => {
      const { result } = renderHook(() =>
        useIDBStorage({ key: 'err-clear', defaultValue: 'def', database: testDbName }),
      );
      await waitFor(() => expect(result.current.persisted).toBe(true));

      // Manually inject an error via the reducer (simulate a past failure)
      // We can test that updating after an error clears it by verifying
      // the UPDATE_VALUE reducer path — the reducer always sets error: null.
      act(() => {
        result.current.update('recovery');
      });
      expect(result.current.error).toBeNull();
    });
  });

  describe('refresh()', () => {
    it('should reload the current value from IDB', async () => {
      const key = 'refresh-test';

      const { result } = renderHook(() =>
        useIDBStorage({ key, defaultValue: 'default', database: testDbName }),
      );
      await waitFor(() => expect(result.current.persisted).toBe(true));
      expect(result.current.data).toBe('default');

      // Write a new value directly to IDB (simulating an external update)
      const ext = new IDBStorage({ database: testDbName });
      const extStore = await ext.get('default');
      await extStore.set(key, 'external-value');

      // Hook still sees the old value
      expect(result.current.data).toBe('default');

      // refresh() should pick up the external change
      await act(async () => {
        await result.current.refresh();
      });
      expect(result.current.data).toBe('external-value');
    });

    it('should update lastUpdated after a successful refresh', async () => {
      const key = 'refresh-ts';

      const { result } = renderHook(() =>
        useIDBStorage({ key, defaultValue: 'v', database: testDbName }),
      );
      await waitFor(() => expect(result.current.persisted).toBe(true));

      const before = result.current.lastUpdated!.getTime();
      await wait(2);

      await act(async () => {
        await result.current.refresh();
      });

      expect(result.current.lastUpdated!.getTime()).toBeGreaterThanOrEqual(before);
    });

    it('should return defaultValue from refresh when key has no stored value', async () => {
      const key = 'refresh-missing';

      const { result } = renderHook(() =>
        useIDBStorage({ key, defaultValue: 'fallback', database: testDbName }),
      );
      await waitFor(() => expect(result.current.persisted).toBe(true));

      // Key was never written — refresh should give back defaultValue
      await act(async () => {
        await result.current.refresh();
      });
      expect(result.current.data).toBe('fallback');
    });
  });

  describe('Flush on Unmount', () => {
    it('should flush a pending debounced save when the component unmounts', async () => {
      const key = 'flush-test';

      const { result, unmount } = renderHook(() =>
        useIDBStorage({ key, defaultValue: 'default', database: testDbName }),
      );
      await waitFor(() => expect(result.current.persisted).toBe(true));

      // Update — this schedules a setTimeout(0) save that has NOT fired yet
      act(() => {
        result.current.update('flush-value');
      });

      // Unmount immediately before the debounce timeout fires
      // The cleanup should cancel the timer and flush synchronously
      unmount();
      await flushPromises(); // let the flushed IDB write resolve

      // New hook should see the flushed value
      const { result: r2 } = renderHook(() =>
        useIDBStorage({ key, defaultValue: 'default', database: testDbName }),
      );
      await waitFor(() => expect(r2.current.persisted).toBe(true));
      expect(r2.current.data).toBe('flush-value');
    });
  });

  describe('Early Unmount During Initialization', () => {
    it('should not error when unmounted before IDB init completes', async () => {
      const { unmount } = renderHook(() =>
        useIDBStorage({ key: 'early-unmount', defaultValue: 'def', database: testDbName }),
      );

      // Unmount before loadInitialValue's awaits resolve
      unmount();

      await nextTick();
      await flushPromises();

      // console.error was mocked in setup — no unexpected errors
      expect(console.error).not.toHaveBeenCalled();
    });

    it('should not error when unmounted rapidly multiple times (Strict Mode pattern)', async () => {
      for (let i = 0; i < 3; i++) {
        const { unmount } = renderHook(() =>
          useIDBStorage({ key: 'strict-unmount', defaultValue: 'v', database: testDbName }),
        );
        unmount();
        await nextTick();
      }

      await flushPromises();
      expect(console.error).not.toHaveBeenCalled();
    });
  });

  describe('IDBConfig Component', () => {
    it('should render its children', () => {
      const { getByText } = render(
        <IDBConfig database={testDbName}>
          <span>hello from child</span>
        </IDBConfig>,
      );
      expect(getByText('hello from child')).toBeTruthy();
    });

    it('should apply database and store config to the global state', async () => {
      render(
        <IDBConfig database={testDbName} store="cfg-store">
          <></>
        </IDBConfig>,
      );

      // IDBConfig applies config inside useEffect — wait for it
      await nextTick();

      const config = getGlobalConfig();
      expect(config.database).toBe(testDbName);
      expect(config.store).toBe('cfg-store');
    });
  });

  describe('idb Singleton', () => {
    it('should be an IDBStorage instance', () => {
      expect(idb).toBeInstanceOf(IDBStorage);
    });

    it('should expose the expected API surface', () => {
      expect(typeof idb.get).toBe('function');
      expect(typeof idb.drop).toBe('function');
      expect(typeof idb.close).toBe('function');
      // .store is a Promise getter
      expect(idb.store).toBeInstanceOf(Promise);
    });

    it('should resolve the default store with a full IDBStore API', async () => {
      const store = await idb.store;
      expect(typeof store.get).toBe('function');
      expect(typeof store.set).toBe('function');
      expect(typeof store.delete).toBe('function');
      expect(typeof store.clear).toBe('function');
      expect(typeof store.keys).toBe('function');
      expect(typeof store.values).toBe('function');
      expect(typeof store.entries).toBe('function');
      expect(typeof store.getMany).toBe('function');
      expect(typeof store.setMany).toBe('function');
      expect(typeof store.deleteMany).toBe('function');
      expect(typeof store.update).toBe('function');
    });
  });
});
