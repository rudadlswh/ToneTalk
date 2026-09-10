"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export function useToast(duration = 2200) {
  const [toast, setToast] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mounted = useRef(false);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      if (timer.current !== null) clearTimeout(timer.current);
    };
  }, []);

  const showToast = useCallback((message: string) => {
    if (!mounted.current) return;
    if (timer.current !== null) clearTimeout(timer.current);
    setToast(message);
    timer.current = setTimeout(() => {
      timer.current = null;
      setToast(null);
    }, duration);
  }, [duration]);

  return { toast, showToast };
}
