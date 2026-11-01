import { randomUUID } from 'node:crypto';

export type HealthRecord = Record<string, string | number | boolean | null>;
export type HealthLogger = (record: HealthRecord) => void;
export const requestId = (value?: string) => value && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value) ? value.toLowerCase() : randomUUID();
export const milliseconds = (started: number) => Math.round((performance.now() - started) * 100) / 100;
export function backendTimings(header: string | null) {
  const values: Record<string, number> = {};
  for (const name of ['db_pool', 'db_query', 'backend']) {
    const match = header?.match(new RegExp(`(?:^|,)\\s*${name};dur=([0-9.]+)`));
    if (match && Number.isFinite(Number(match[1]))) values[name + '_ms'] = Number(match[1]);
  }
  return values;
}
