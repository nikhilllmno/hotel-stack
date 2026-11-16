function newlineReplacer(_key: string, value: unknown) {
  if (typeof value === 'string') {
    return value.replace(/[\r\n]+/g, ' ');
  }
  return value;
}

export function cleanStringFields<T>(obj: T): T {
  return JSON.parse(JSON.stringify(obj, newlineReplacer));
}
