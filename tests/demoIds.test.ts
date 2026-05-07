import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import * as demoIds from '../prisma/demoIds';

const uuidSchema = z.string().uuid();

const expectedConstantNames = [
  'DEMO_LANDLORD_1_ID',
  'DEMO_TENANT_1_ID',
  'DEMO_ADMIN_ID',
  'DEMO_PROPERTY_SP_1_ID',
  'DEMO_PROPERTY_RJ_1_ID',
  'DEMO_PROPERTY_RJ_2_ID',
  'DEMO_PROPERTY_RJ_3_ID',
  'DEMO_PROPERTY_RJ_4_ID',
  'DEMO_IMAGE_RJ_1_ID',
  'DEMO_IMAGE_RJ_2_ID',
  'DEMO_IMAGE_RJ_3_ID',
  'DEMO_IMAGE_RJ_4_ID',
  'DEMO_IMAGE_RJ2_1_ID',
  'DEMO_IMAGE_RJ2_2_ID',
  'DEMO_IMAGE_RJ2_3_ID',
  'DEMO_IMAGE_RJ2_4_ID',
  'DEMO_IMAGE_RJ3_1_ID',
  'DEMO_IMAGE_RJ3_2_ID',
] as const;

describe('prisma/demoIds.ts', () => {
  it('exports every expected demo id constant', () => {
    for (const name of expectedConstantNames) {
      expect(demoIds).toHaveProperty(name);
      expect(typeof (demoIds as Record<string, unknown>)[name]).toBe('string');
    }
  });

  it.each(expectedConstantNames)('%s passes z.string().uuid()', (name) => {
    const value = (demoIds as Record<string, string>)[name];
    const result = uuidSchema.safeParse(value);
    expect(result.success).toBe(true);
  });

  it.each(expectedConstantNames)('%s matches strict UUID v4 regex', (name) => {
    const value = (demoIds as Record<string, string>)[name];
    const uuidV4Regex =
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    expect(value).toMatch(uuidV4Regex);
  });

  it('every id is unique', () => {
    const values = expectedConstantNames.map(
      (n) => (demoIds as Record<string, string>)[n],
    );
    const unique = new Set(values);
    expect(unique.size).toBe(values.length);
  });
});
