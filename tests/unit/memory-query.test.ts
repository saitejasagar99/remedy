/**
 * The Memory Inspector's query parser.
 *
 * This exists because of a real defect: passing a `URLSearchParams` straight
 * into a Zod object schema reads every key as `undefined`, so `?q=`, `?stage=`
 * and `?limit=` were all silently ignored and every request returned the same
 * unfiltered page. Each case below would have caught it.
 */
import { describe, expect, it } from 'vitest';

import { MAX_PAGE, parseListQuery } from '@/app/lib/memory-query';

const url = (query: string) => `http://localhost:3000/api/memories${query}`;

describe('parseListQuery', () => {
  it('applies defaults when nothing is asked for', () => {
    const parsed = parseListQuery(url(''));

    expect(parsed.limit).toBe(50);
    expect(parsed.offset).toBe(0);
    expect(parsed.q).toBeUndefined();
    expect(parsed.stage).toBeUndefined();
    expect(parsed.scoreAgainst).toBeUndefined();
  });

  it('reads the parameters instead of defaulting past them', () => {
    const parsed = parseListQuery(url('?q=Case%20%23102&limit=10&offset=20&stage=lesson'));

    expect(parsed.q).toBe('Case #102');
    expect(parsed.limit).toBe(10);
    expect(parsed.offset).toBe(20);
    expect(parsed.stage).toBe('lesson');
  });

  it('accepts every documented filter', () => {
    const parsed = parseListQuery(
      url('?type=world&scoreAgainst=CF_abc123&q=contractor'),
    );

    expect(parsed.type).toBe('world');
    expect(parsed.scoreAgainst).toBe('CF_abc123');
    expect(parsed.q).toBe('contractor');
  });

  it('trims whitespace and rejects an over-long search string', () => {
    expect(parseListQuery(url('?q=%20%20ac-2%20%20')).q).toBe('ac-2');
    expect(() => parseListQuery(url(`?q=${'x'.repeat(301)}`))).toThrow();
  });

  it('rejects a page size outside the allowed range', () => {
    expect(() => parseListQuery(url('?limit=0'))).toThrow();
    expect(() => parseListQuery(url(`?limit=${MAX_PAGE + 1}`))).toThrow();
    expect(() => parseListQuery(url('?limit=abc'))).toThrow();
    expect(parseListQuery(url(`?limit=${MAX_PAGE}`)).limit).toBe(MAX_PAGE);
  });

  it('rejects an unsupported fact type rather than silently dropping it', () => {
    expect(() => parseListQuery(url('?type=secret'))).toThrow();
  });

  it('parses a path with a query as well as an absolute URL', () => {
    expect(parseListQuery('/api/memories?limit=3').limit).toBe(3);
  });
});
