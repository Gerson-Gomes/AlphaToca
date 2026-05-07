import { describe, it, expect, vi, beforeEach } from 'vitest';
import { randomUUID } from 'crypto';
import { PropertyType } from '@prisma/client';

// Firebase env vars must be present before importing app — validateAuthConfig
// runs at load time, and importing src/app transitively pulls in firebase init.
process.env.FIREBASE_PROJECT_ID = process.env.FIREBASE_PROJECT_ID || 'test-project';
process.env.FIREBASE_CLIENT_EMAIL = process.env.FIREBASE_CLIENT_EMAIL || 'test@example.com';
process.env.FIREBASE_PRIVATE_KEY = process.env.FIREBASE_PRIVATE_KEY || 'test-key';

/**
 * LL-020 — Search filter accepts new PropertyType values.
 *
 * GET /api/properties/search is public. LL-019 extended the PropertyType enum
 * with KITNET, PENTHOUSE, LAND, COMMERCIAL. This test proves:
 *   1. The Zod schema (now z.nativeEnum(PropertyType)) accepts each new value.
 *   2. Each new type filter returns ONLY the matching seeded property via
 *      the `where.type` clause in propertyService.searchProperties.
 *   3. HOUSE (a pre-existing value) still works — no regression.
 *   4. Unknown/malformed types still yield 400.
 *
 * Mocks `prisma.property.count` + `prisma.property.findMany` so the real
 * controller + service logic executes end-to-end. The mocks consult
 * `args.where.type` and return the matching in-memory row — same semantics as
 * a live DB seeded with one property per type.
 */

const LANDLORD_ID = '22222222-2222-2222-2222-222222222222';

const { mockCount, mockFindMany } = vi.hoisted(() => ({
  mockCount: vi.fn(),
  mockFindMany: vi.fn(),
}));

vi.mock('../src/config/db', () => ({
  default: {
    property: {
      count: mockCount,
      findMany: mockFindMany,
    },
  },
}));

vi.mock('../src/middlewares/authMiddleware', () => ({
  validateAuthConfig: () => {},
  checkJwt: (_req: any, res: any) =>
    res.status(401).json({
      status: 401,
      code: 'UNAUTHORIZED',
      messages: [{ message: 'Missing or invalid Authorization header.' }],
    }),
  authSyncMiddleware: (_req: any, _res: any, next: any) => next(),
  requireRole: () => (_req: any, _res: any, next: any) => next(),
}));

vi.mock('../src/config/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}));

import request from 'supertest';
import app from '../src/app';

type SeededRow = {
  id: string;
  landlordId: string;
  title: string;
  description: string;
  price: number;
  address: string;
  type: PropertyType;
  status: string;
  moderationStatus: string;
  bedrooms: number;
  bathrooms: number;
  images: unknown[];
  contracts: unknown[];
};

function seed(type: PropertyType): SeededRow {
  return {
    id: randomUUID(),
    landlordId: LANDLORD_ID,
    title: `Seeded ${type}`,
    description: 'Search-filter fixture for LL-020',
    price: 2500,
    address: 'Rua Teste, 10',
    type,
    status: 'AVAILABLE',
    moderationStatus: 'APPROVED',
    bedrooms: 2,
    bathrooms: 1,
    images: [],
    contracts: [],
  };
}

// One property per type value the test cares about — the 4 new LL-019 values
// plus HOUSE (regression guard against an accidental allowlist change).
const STORE: Record<PropertyType, SeededRow> = {
  APARTMENT: seed(PropertyType.APARTMENT),
  HOUSE: seed(PropertyType.HOUSE),
  STUDIO: seed(PropertyType.STUDIO),
  CONDO_HOUSE: seed(PropertyType.CONDO_HOUSE),
  KITNET: seed(PropertyType.KITNET),
  PENTHOUSE: seed(PropertyType.PENTHOUSE),
  LAND: seed(PropertyType.LAND),
  COMMERCIAL: seed(PropertyType.COMMERCIAL),
};

beforeEach(() => {
  vi.clearAllMocks();

  (mockCount as ReturnType<typeof vi.fn>).mockImplementation(async (args: any) => {
    const type = args?.where?.type as PropertyType | undefined;
    if (type && STORE[type]) return 1;
    if (type) return 0;
    return Object.values(STORE).length;
  });

  (mockFindMany as ReturnType<typeof vi.fn>).mockImplementation(async (args: any) => {
    const type = args?.where?.type as PropertyType | undefined;
    if (type) {
      const row = STORE[type];
      return row ? [row] : [];
    }
    return Object.values(STORE);
  });
});

describe('LL-020 — GET /api/properties/search?type=<extended>', () => {
  it.each([
    PropertyType.KITNET,
    PropertyType.PENTHOUSE,
    PropertyType.LAND,
    PropertyType.COMMERCIAL,
  ])('returns only the property matching type=%s', async (type) => {
    const res = await request(app).get(`/api/properties/search?type=${type}`);

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].type).toBe(type);
    expect(res.body.data[0].id).toBe(STORE[type].id);
    expect(res.body.meta.total).toBe(1);

    // Service forwarded the type clause into Prisma's `where`.
    expect(mockFindMany).toHaveBeenCalledTimes(1);
    expect(mockFindMany.mock.calls[0][0].where).toEqual(
      expect.objectContaining({ type }),
    );
    expect(mockCount.mock.calls[0][0].where).toEqual(
      expect.objectContaining({ type }),
    );
  });

  it('type=HOUSE still works — pre-existing enum value, no regression', async () => {
    const res = await request(app).get(`/api/properties/search?type=${PropertyType.HOUSE}`);

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].type).toBe(PropertyType.HOUSE);
    expect(res.body.data[0].id).toBe(STORE.HOUSE.id);
  });

  it('rejects unknown type values at the Zod layer (400 VALIDATION_ERROR)', async () => {
    const res = await request(app).get('/api/properties/search?type=TREE_HOUSE');

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_ERROR');
    // Zod short-circuited before the DB mock was touched.
    expect(mockCount).not.toHaveBeenCalled();
    expect(mockFindMany).not.toHaveBeenCalled();
  });

  it('accepts all 8 PropertyType values via the Zod search schema', async () => {
    const { propertySearchSchema } = await import('../src/utils/searchValidation');

    for (const type of Object.values(PropertyType)) {
      const parsed = propertySearchSchema.parse({ type });
      expect(parsed.type).toBe(type);
    }
  });
});
