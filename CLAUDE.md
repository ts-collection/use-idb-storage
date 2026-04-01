# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
# Build the library
npm run build

# Watch mode (for development)
npm run dev

# Run all tests
npm test

# Run a single test file
npx vitest run tests/idb-storage.test.ts

# Run benchmarks
npx vitest bench

# Run the interactive playground (Vite dev server)
npm run playground

# Lint / format
npm run check    # check only
npm run lint     # lint
npm run format   # auto-format
```

## Architecture

The library is a React hook (`useIDBStorage`) and companion utilities for persisting state in IndexedDB. It follows a strict three-layer architecture:

```
useIDBStorage (hook.tsx)         ← React API: dual-mode destructuring, debounced saves, loading/error state
    └── IDBStorage / IDBStore (idb-storage.ts)  ← Database abstraction: singleton cache, batch ops
            └── database.ts      ← IndexedDB primitives: openDB, getFromDB, setInDB, removeFromDB
```

### Key design decisions

- **Singleton connection cache** (`database.ts`): `openDB` caches open connections by `dbName+storeName`. If a requested store doesn't exist in the current DB version, the version is auto-incremented to trigger an `onupgradeneeded` event.
- **Debounced saves** (`hook.tsx`): Writes to IDB are deferred via `setTimeout(0)` so that rapid state updates coalesce. Pending saves are flushed synchronously on unmount.
- **Dual-mode return** (`hook.tsx`): The hook return value supports both tuple destructuring `[value, set, remove]` and object destructuring `{ data, update, reset, loading, error, lastUpdated, refresh }` via `Symbol.iterator`.
- **Configuration hierarchy** (`utils.ts` → `idb-config.tsx`): Defaults live in a module-level singleton (`globalIDBConfig`). The `<IDBConfig>` component calls `configureIDBStorage` on mount to set app-wide defaults. Per-hook options take final precedence.

### State management in the hook

The hook uses `useReducer` (see `reducer.ts`) with six action types: `UPDATE_VALUE`, `SET_ERROR`, `LOAD_VALUE`, `RESET`, `REFRESH_SUCCESS`, `REFRESH_ERROR`. Refs track whether the component is mounted, the IDB store instance, the pending save timer, and the initial default value.

### Exports (`src/index.ts`)

- `useIDBStorage` — main hook
- `IDBStorage`, `IDBStore` — classes for direct database access
- `IDBConfig` — React component for declarative global config
- `configureIDBStorage`, `getGlobalConfig` — imperative global config
- `idb` — pre-configured `IDBStorage` instance (singleton, ready to use)

### Build

`tsdown` (a tsup-like bundler) builds a single ES module entry from `src/index.ts` with DTS generation and minification. The playground is a separate Vite app under `playground/`.

### Testing

Tests use Vitest with jsdom and `fake-indexeddb` (set up in `tests/setup.ts`). Benchmarks live in `tests/benchmark.bench.ts`.
