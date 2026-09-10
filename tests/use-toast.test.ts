import { afterEach, expect, it, vi } from "vitest";

const lifecycle = vi.hoisted(() => ({ cleanup: undefined as (() => void) | undefined, setToast: vi.fn() }));
vi.mock("react", () => ({
  useState: () => [null, lifecycle.setToast],
  useRef: (current: unknown) => ({ current }),
  useCallback: (fn: unknown) => fn,
  useEffect: (setup: () => () => void) => { lifecycle.cleanup = setup(); },
}));
import { useToast } from "@/hooks/use-toast";

afterEach(() => { lifecycle.cleanup?.(); vi.useRealTimers(); vi.clearAllMocks(); });

it.each([2200, 1800])("replaces old timers and cleans up on unmount (%i ms)", (duration) => {
  vi.useFakeTimers();
  const { showToast } = useToast(duration);
  showToast("first");
  vi.advanceTimersByTime(1000);
  showToast("second");
  vi.advanceTimersByTime(duration - 1000);
  expect(lifecycle.setToast).toHaveBeenLastCalledWith("second");
  vi.advanceTimersByTime(1000);
  expect(lifecycle.setToast).toHaveBeenLastCalledWith(null);
  showToast("third");
  lifecycle.cleanup?.();
  expect(vi.getTimerCount()).toBe(0);
  showToast("late response");
  expect(lifecycle.setToast).toHaveBeenLastCalledWith("third");
});
