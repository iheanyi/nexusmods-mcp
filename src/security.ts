import { timingSafeEqual } from 'node:crypto';

export function tokenMatches(value: string | null | undefined, token: string) {
  const actual = Buffer.from(value ?? '');
  const expected = Buffer.from(`Bearer ${token}`);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
