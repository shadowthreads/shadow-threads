export function toPrettyJson(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

export function printJson(value: unknown): void {
  console.log(toPrettyJson(value));
}
