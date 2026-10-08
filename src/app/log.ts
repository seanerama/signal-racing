/**
 * Tiny logger (contract 01). Framework-free, so every layer except the engine may import it
 * (the engine never logs). Works on the main thread and in workers.
 *
 * Debug output is enabled by `?debug` in the URL or `localStorage['signal.debug'] = '1'`.
 * Nothing leaves the machine.
 */

type Level = 'debug' | 'info' | 'warn' | 'error';

const PREFIX = '[signal]';

function detectDebug(): boolean {
  try {
    const search = globalThis.location?.search ?? '';
    if (new URLSearchParams(search).has('debug')) return true;
  } catch {
    // no location (e.g. node): fall through
  }
  try {
    return globalThis.localStorage?.getItem('signal.debug') === '1';
  } catch {
    return false; // storage unavailable (workers, privacy mode)
  }
}

let debugEnabled = detectDebug();

function emit(level: Level, args: unknown[]): void {
  if (level === 'debug' && !debugEnabled) return;
  // This module is the one sanctioned console sink.
  console[level](PREFIX, ...args);
}

export const log: {
  debug(...a: unknown[]): void;
  info(...a: unknown[]): void;
  warn(...a: unknown[]): void;
  error(...a: unknown[]): void;
} = {
  debug: (...a) => emit('debug', a),
  info: (...a) => emit('info', a),
  warn: (...a) => emit('warn', a),
  error: (...a) => emit('error', a),
};

/** Overrides debug detection (tests, the worker when the main thread has `?debug`). */
export function setDebug(enabled: boolean): void {
  debugEnabled = enabled;
}

export function isDebug(): boolean {
  return debugEnabled;
}
