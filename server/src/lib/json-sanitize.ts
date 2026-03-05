const PAYLOAD_NON_JSON_SAFE_MESSAGE = 'payload contains non-JSON-safe value';
const REMOVE_VALUE = Symbol('remove_json_value');

type Sanitized = unknown | typeof REMOVE_VALUE;

function makeSanitizeError(): JsonSanitizeError {
  return new JsonSanitizeError(PAYLOAD_NON_JSON_SAFE_MESSAGE);
}

function sanitizeInternal(value: unknown, seen: WeakSet<object>): Sanitized {
  if (value === null) {
    return null;
  }

  if (typeof value === 'string') {
    return value.replace(/\u0000/g, '');
  }

  if (typeof value === 'boolean') {
    return value;
  }

  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw makeSanitizeError();
    }
    return value;
  }

  if (typeof value === 'undefined' || typeof value === 'function' || typeof value === 'symbol') {
    return REMOVE_VALUE;
  }

  if (typeof value === 'bigint') {
    throw makeSanitizeError();
  }

  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) {
      throw makeSanitizeError();
    }
    return value.toISOString();
  }

  if (typeof Buffer !== 'undefined' && Buffer.isBuffer(value)) {
    throw makeSanitizeError();
  }

  if (value instanceof Uint8Array) {
    throw makeSanitizeError();
  }

  if (Array.isArray(value)) {
    if (seen.has(value)) {
      throw makeSanitizeError();
    }
    seen.add(value);

    const output: unknown[] = [];
    for (const item of value) {
      const sanitized = sanitizeInternal(item, seen);
      if (sanitized !== REMOVE_VALUE) {
        output.push(sanitized);
      }
    }

    seen.delete(value);
    return output;
  }

  if (!value || typeof value !== 'object') {
    throw makeSanitizeError();
  }

  const proto = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) {
    throw makeSanitizeError();
  }

  if (seen.has(value)) {
    throw makeSanitizeError();
  }
  seen.add(value);

  const output: Record<string, unknown> = {};
  for (const key of Object.keys(value)) {
    const sanitized = sanitizeInternal((value as Record<string, unknown>)[key], seen);
    if (sanitized !== REMOVE_VALUE) {
      output[key] = sanitized;
    }
  }

  seen.delete(value);
  return output;
}

export class JsonSanitizeError extends Error {
  constructor(message = PAYLOAD_NON_JSON_SAFE_MESSAGE) {
    super(message);
    this.name = 'JsonSanitizeError';
  }
}

export function sanitizeJsonValue(value: unknown): unknown {
  const sanitized = sanitizeInternal(value, new WeakSet<object>());
  if (sanitized === REMOVE_VALUE) {
    throw makeSanitizeError();
  }
  return sanitized;
}

export function sanitizeJsonPayload(payload: unknown): unknown {
  return sanitizeJsonValue(payload);
}
