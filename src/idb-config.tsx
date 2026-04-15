'use client';

import * as React from 'react';
import { configureIDBStorage } from '.';
import type { IDBConfigValues } from './types';

/**
 * React component to configure global defaults for IDBStorage.
 * Wrap your app or components to set database, version, and store defaults.
 *
 * @param children - Child components to render
 * @param conf - Configuration values to set globally
 */
export const IDBConfig = ({
  children,
  database,
  version,
  store,
}: { children: React.ReactNode } & Partial<IDBConfigValues>) => {
  React.useEffect(() => {
    configureIDBStorage({ database, version, store });
  }, [database, version, store]);

  return children;
};
