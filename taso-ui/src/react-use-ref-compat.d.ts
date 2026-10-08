import type { MutableRefObject } from 'react';

declare module 'react' {
  /**
   * React 19 type definitions require an explicit initial value for useRef.
   * Taso still has a small number of timer refs that intentionally start
   * undefined. Keep that intent explicit at the type layer until those refs
   * are migrated to useRef<T | undefined>(undefined).
   */
  function useRef<T = undefined>(): MutableRefObject<T | undefined>;
}
