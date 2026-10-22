/** Tiny store of "how many network requests are in flight", so the UI can show a progress bar for any fetch. */
let inflight = 0;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export function trackRequest<T>(p: Promise<T>): Promise<T> {
  inflight++;
  emit();
  const done = () => {
    inflight = Math.max(0, inflight - 1);
    emit();
  };
  p.then(done, done);
  return p;
}
export const subscribeActivity = (l: () => void): (() => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};
export const getInflight = (): number => inflight;
