const loggable: ((name: string) => boolean)[] = [name => true];
export function createDebugLogger(name: string) {
  return (...args: any[]) => {
    if (loggable.some(f => f(name))) {
      console.debug(new Date(), 'DEBUG', name, ...args);
    }
  };
}
