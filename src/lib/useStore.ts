import { useSyncExternalStore } from 'react';
import { store } from './store';

// UI re-renders are batched to one per animation frame, so painting a stroke
// across many tiles does not re-render the panel for every tile.
function subscribeBatched(cb: () => void) {
  let raf = 0;
  const unsub = store.subscribe(() => {
    if (!raf) {
      raf = requestAnimationFrame(() => {
        raf = 0;
        cb();
      });
    }
  });
  return () => {
    cancelAnimationFrame(raf);
    unsub();
  };
}

const getVersion = () => store.version;

/** Returns the store and re-renders the caller whenever it changes. */
export function useStore() {
  useSyncExternalStore(subscribeBatched, getVersion);
  return store;
}
