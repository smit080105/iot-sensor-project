import { useEffect, useRef } from "react";

/**
 * Declarative setInterval hook that preserves callback state
 */
export function useInterval(callback, delayMs) {
  const savedCallback = useRef(callback);

  useEffect(() => {
    savedCallback.current = callback;
  }, [callback]);

  useEffect(() => {
    if (delayMs === null || delayMs === undefined) return;
    
    // Initial call
    savedCallback.current();

    const id = setInterval(() => savedCallback.current(), delayMs);
    return () => clearInterval(id);
  }, [delayMs]);
}
