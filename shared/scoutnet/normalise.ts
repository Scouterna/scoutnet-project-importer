export const asRecord = <T>(value: unknown): Record<string, T> =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, T>)
    : {};
