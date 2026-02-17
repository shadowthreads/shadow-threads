import crypto from 'crypto';

export function canonicalize(value: any): string {
  return JSON.stringify(sortRecursively(value));
}

function sortRecursively(obj: any): any {
  if (Array.isArray(obj)) {
    return obj.map(sortRecursively);
  }
  if (obj && typeof obj === 'object') {
    return Object.keys(obj)
      .sort()
      .reduce((acc: any, key) => {
        acc[key] = sortRecursively(obj[key]);
        return acc;
      }, {});
  }
  return obj;
}

export function computeRevisionHash(payload: any): string {
  const canonical = canonicalize(payload);
  return crypto.createHash('sha256').update(canonical).digest('hex');
}
