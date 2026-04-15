'use client';

import * as React from 'react';
import { getGlobalConfig } from '.';
import { isIDBAvailable } from './database';
import { IDBStorage, type IDBStore } from './idb-storage';
import { idbReducer } from './reducer';
import type { IDBStorageOptions, UseIDBStorageReturn } from './types';

/**
 * Hook to persist state in IndexedDB with a clean object-based API.
 * Optimized for performance - synchronous updates like useState with background IDB persistence.
 *
 * @param options - Configuration object containing key, defaultValue, and optional database/store names
 * @returns An object that supports both tuple and object destructuring:
 *   - Tuple: const [value, setValue, removeValue] = useIDBStorage()
 *   - Object: const { data, update, reset, loading, persisted, error, lastUpdated, refresh } = useIDBStorage()
 *
 * @example
 * ```tsx
 * // Configure defaults for the app (optional)
 * import { IDBConfig } from 'use-idb-storage';
 *
 * function App() {
 *   return (
 *     <IDBConfig database="myApp" version={2} store="data">
 *       <MyComponent />
 *     </IDBConfig>
 *   );
 * }
 *
 * // In MyComponent:
 * const [userData, setUserData, removeUserData] = useIDBStorage({
 *   key: 'currentUser',
 *   defaultValue: { name: '', email: '' },
 * });
 *
 * // Object destructuring
 * const {
 *   data: userData,
 *   update: updateUserData,
 *   reset: resetUserData,
 *   loading,
 *   persisted,
 *   error,
 *   lastUpdated,
 *   refresh
 * } = useIDBStorage({
 *   key: 'currentUser',
 *   defaultValue: { name: '', email: '' },
 * });
 *
 * // Use features
 * if (error) console.error('Storage error:', error);
 * await refresh();
 * updateUserData({ name: 'Sohan', email: 'sohan@example.com' });
 * updateUserData(prev => ({ ...prev, lastLogin: new Date() }));
 * ```
 *
 * @note The version parameter is used for IndexedDB database versioning.
 * When you increment the version, it triggers database upgrades. You cannot
 * "downgrade" to a lower version once a database exists with a higher version.
 */
export function useIDBStorage<T>(
  options: IDBStorageOptions<T>,
): UseIDBStorageReturn<T> {
  const { key, defaultValue, ...opts } = options;
  const globalConfig = getGlobalConfig();

  const conf = React.useMemo(
    () => ({ ...globalConfig, ...opts }),
    [globalConfig, opts],
  );

  const [state, dispatch] = React.useReducer(idbReducer, {
    value: defaultValue,
    error: null,
    lastUpdated: null,
  });

  const isInitializedRef = React.useRef(false);
  const storageRef = React.useRef<IDBStorage | null>(null);
  const storeRef = React.useRef<IDBStore | null>(null);

  const saveTimeoutRef = React.useRef<NodeJS.Timeout | null>(null);
  const pendingValueRef = React.useRef<T | null>(null);
  const hasLoadedRef = React.useRef(false);
  const initialValueRef = React.useRef<T | null>(null);

  React.useEffect(() => {
    if (typeof window === 'undefined') return;

    let isMounted = true;

    const loadInitialValue = async () => {
      try {
        if (!isIDBAvailable()) {
          console.warn('IndexedDB is not available, using default values only');
          initialValueRef.current = defaultValue;
          isInitializedRef.current = true;
          hasLoadedRef.current = true;
          return;
        }

        const storage = new IDBStorage(conf);
        const storeInstance = await storage.get(conf.store);

        if (!isMounted) return;

        storageRef.current = storage;
        storeRef.current = storeInstance;

        const value = await storeInstance.get<T>(key);
        if (isMounted) {
          dispatch({
            type: 'LOAD_VALUE',
            value: value !== undefined ? value : defaultValue,
          });
          initialValueRef.current = value !== undefined ? value : defaultValue;
        }

        isInitializedRef.current = true;
        hasLoadedRef.current = true;
      } catch (err) {
        console.info('⚡[useIDBStorage] error:', err);
        dispatch({
          type: 'SET_ERROR',
          error: err instanceof Error ? err : new Error(String(err)),
        });
        initialValueRef.current = defaultValue;
        isInitializedRef.current = true;
        hasLoadedRef.current = true;
      }
    };

    loadInitialValue();

    return () => {
      isMounted = false;
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
        // Flush pending save immediately
        if (pendingValueRef.current !== null && storeRef.current) {
          storeRef.current
            .set(key, pendingValueRef.current)
            .catch(console.error);
        }
      }
      storageRef.current = null;
      storeRef.current = null;
    };
  }, [conf.database, conf.version, conf.store, key]);

  const saveToIDB = React.useCallback(
    (value: T) => {
      // Don't save if not initialized or no store available
      if (
        !isInitializedRef.current ||
        !storeRef.current ||
        !hasLoadedRef.current
      ) {
        return;
      }

      // Store the pending value
      pendingValueRef.current = value;

      // Clear existing timeout
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }

      saveTimeoutRef.current = setTimeout(() => {
        const valueToSave = pendingValueRef.current;
        pendingValueRef.current = null;

        if (valueToSave !== null && storeRef.current) {
          storeRef.current
            .set(key, valueToSave)
            .then(() => {
              initialValueRef.current = valueToSave;
            })
            .catch((err) => {
              console.error('Failed to save value to IndexedDB:', err);
              dispatch({
                type: 'SET_ERROR',
                error: err instanceof Error ? err : new Error(String(err)),
              });
            });
        }
      }, 0); // Use 0 for next tick, or 50-100 for more aggressive batching
    },
    [key],
  );

  const updateStoredValue = React.useCallback(
    (valueOrFn: T | ((prevState: T) => T)) => {
      const newValue =
        typeof valueOrFn === 'function'
          ? (valueOrFn as (prevState: T) => T)(state.value)
          : valueOrFn;

      dispatch({ type: 'UPDATE_VALUE', value: newValue });
      saveToIDB(newValue);
    },
    [state.value, saveToIDB],
  );

  const removeStoredValue = React.useCallback(() => {
    dispatch({ type: 'RESET', defaultValue });
    initialValueRef.current = defaultValue;
    saveToIDB(defaultValue);
  }, [defaultValue, saveToIDB]);

  const refresh = React.useCallback(async () => {
    if (!isIDBAvailable() || !storeRef.current) return;

    try {
      const value = await storeRef.current.get<T>(key);
      dispatch({
        type: 'REFRESH_SUCCESS',
        value: value !== undefined ? value : defaultValue,
      });
      initialValueRef.current = value !== undefined ? value : defaultValue;
    } catch (err) {
      dispatch({
        type: 'REFRESH_ERROR',
        error: err instanceof Error ? err : new Error(String(err)),
      });
    }
  }, [key, defaultValue]);

  const reset = React.useCallback(() => {
    removeStoredValue();
  }, [removeStoredValue]);

  const update = React.useCallback(
    (valueOrFn: T | ((prevState: T) => T)) => {
      updateStoredValue(valueOrFn);
    },
    [updateStoredValue],
  );

  return Object.assign(
    {
      0: state.value,
      1: updateStoredValue,
      2: removeStoredValue,
      data: state.value,
      update,
      reset,
      loading: !hasLoadedRef.current,
      persisted: hasLoadedRef.current,
      error: state.error,
      lastUpdated: state.lastUpdated,
      refresh,
      length: 3 as const,
    },
    {
      [Symbol.iterator]: function* () {
        yield state.value;
        yield updateStoredValue;
        yield removeStoredValue;
      },
    },
  );
}
