import { useState, useEffect, useCallback, useRef } from "react";

export type DensityMode = "comfortable" | "compact";

const DENSITY_STORAGE_PREFIX = "veritasor_density_";
const API_BASE = "/v1/preferences/density";

export interface UseDensityModeOptions {
  /** Called when server persistence fails — use for toast notification */
  onPersistError?: (message: string) => void;
}

/**
 * useDensityMode — manages density preference with optimistic server persistence.
 *
 * 1. Updates localStorage and React state immediately (optimistic).
 * 2. Fires PUT /v1/preferences/density to persist on the server.
 * 3. On success: no additional UI change needed.
 * 4. On failure: reverts to the previous value and calls onPersistError.
 *
 * Also reads from GET /v1/preferences/density on initial load (after
 * reading localStorage as the fast default).
 */
export function useDensityMode(
  workspace: string,
  options: UseDensityModeOptions = {},
) {
  const { onPersistError } = options;
  const storageKey = `${DENSITY_STORAGE_PREFIX}${workspace}`;
  const onPersistErrorRef = useRef(onPersistError);
  onPersistErrorRef.current = onPersistError;

  const [density, setDensityState] = useState<DensityMode>(() => {
    try {
      const raw = localStorage.getItem(storageKey);
      if (raw === "compact" || raw === "comfortable") return raw;
    } catch {
      // ignore parse errors
    }
    return "comfortable";
  });

  // Persist helper: optimistically update localStorage + state,
  // then fire API call and rollback on failure.
  const setDensity = useCallback(
    (mode: DensityMode) => {
      const previous = localStorage.getItem(storageKey) as DensityMode | null;
      const validatedPrevious: DensityMode =
        previous === "compact" || previous === "comfortable"
          ? previous
          : "comfortable";

      // 1. Optimistic update
      setDensityState(mode);
      try {
        localStorage.setItem(storageKey, mode);
      } catch {
        // storage full or unavailable — still try server
      }

      // 2. API persistence (fire-and-forget with rollback)
      fetch(`${API_BASE}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workspace, density: mode }),
      })
        .then(async (res) => {
          if (!res.ok) {
            // 3. Rollback on failure
            setDensityState(validatedPrevious);
            try {
              localStorage.setItem(storageKey, validatedPrevious);
            } catch {
              // ignore
            }
            onPersistErrorRef.current?(
              "Could not save density preference. Changes reverted.",
            );
          }
          // On success, do nothing — optimistic update is already applied
        })
        .catch(() => {
          // Network error — rollback
          setDensityState(validatedPrevious);
          try {
            localStorage.setItem(storageKey, validatedPrevious);
          } catch {
            // ignore
          }
          onPersistErrorRef.current?(
            "Could not save density preference. Changes reverted.",
          );
        });
    },
    [storageKey],
  );

  // On mount / workspace change, sync with localStorage and attempt server read
  useEffect(() => {
    const abortController = new AbortController();

    try {
      const raw = localStorage.getItem(storageKey);
      if (raw === "compact" || raw === "comfortable") {
        setDensityState(raw);
      } else {
        setDensityState("comfortable");
        localStorage.setItem(storageKey, "comfortable");
      }
    } catch {
      setDensityState("comfortable");
    }

    // Attempt to fetch server preference to sync across devices
    fetch(`${API_BASE}?workspace=${encodeURIComponent(workspace)}`, {
      method: "GET",
      headers: { "Content-Type": "application/json" },
      signal: abortController.signal,
    })
      .then(async (res) => {
        if (!res.ok) return;
        const data = await res.json();
        if (
          data?.density === "compact" ||
          data?.density === "comfortable"
        ) {
          setDensityState(data.density);
          try {
            localStorage.setItem(storageKey, data.density);
          } catch {
            // ignore
          }
        }
      })
      .catch((err) => {
        if (err.name === "AbortError") return;
        // Server unavailable — keep localStorage value
      });

    return () => {
      abortController.abort();
    };
  }, [storageKey]);

  return { density, setDensity };
}
