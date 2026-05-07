import { describe, it, expect, vi, beforeEach } from 'vitest';
import { randomUUID } from 'crypto';

// Firebase env vars must be present before importing app — validateAuthConfig
// runs at load time, and importing src/app transitively pulls in firebase init.
process.env.FIREBASE_PROJECT_ID = process.env.FIREBASE_PROJECT_ID || 'test-project';
process.env.FIREBASE_CLIENT_EMAIL = process.env.FIREBASE_CLIENT_EMAIL || 'test@example.com';
process.env.FIREBASE_PRIVATE_KEY = process.env.FIREBASE_PRIVATE_KEY || 'test-key';

/**
 * LL-022 — Amenity support in create/update/search.
 *
 * Locks in that hasWifi + hasPool flow end-to-end through:
 *   - POST /api/properties (application/json) — both flags persisted.
 *   - PUT  /api/properties/:id (application/json) — both flags updated.
 *   - PUT  /api/properties/:id (multipart/form-data) — `'true'`/`'false'` strings
 *     coerced to booleans via propertyValidation's multipartBoolean preprocessor.
 *   - GET  /api/properties/search — `?hasWifi=true&hasPool=true` filters apply
 *     (AND semantics); omitted flags don't add a filter and the full result set
 *     comes back.
 *
 * Search is exercised end-to-end (mocks `prisma.property.count`/`findMany`
 * directly) so the real Zod schema + controller + service stack runs. The
 * create/update paths mock the service layer to isolate the controller
 * parsing behavior from disk writes / Prisma specifics.
 */

const LANDLORD_ID = '22222222-2222-2222-2222-222222222222';
const OTHER_LANDLORD_ID = '33333333-3333-3333-3333-333333333333';

const {
  mockCreateProperty,
  mockGetPropertyById,
  mockUpdateProperty,
  mockSearchCount,
  mockSearchFindMany,
} = vi.hoisted(() => ({
  mockCreateProperty: vi.fn(),
  mockGetPropertyById: vi.fn(),
  mockUpdateProperty: vi.fn(),
  mockSearchCount: vi.fn(),
  mockSearchFindMany: vi.fn(),
}));

vi.mock('../src/middlewares/authMiddleware', () => ({
  validateAuthConfig: () => {},
  checkJwt: (req: any, res: any, next: any) => {
    const header = req.headers.authorization;
    if (header === 'Bearer landlord-owner' || header === 'Bearer landlord-intruder') {
      req.auth = { payload: { uid: header } };
      return next();
    }
    return res.status(401).json({
      status: 401,
      code: 'UNAUTHORIZED',
      messages: [{ message: 'Missing or invalid Authorization header.' }],
    });
  },
  authSyncMiddleware: (req: any, _res: any, next: any) => {
    const isOwner = req.auth?.payload?.uid === 'Bearer landlord-owner';
    req.localUser = {
      id: isOwner ? LANDLORD_ID : OTHER_LANDLORD_ID,
      firebaseUid: req.auth?.payload?.uid ?? 'unknown',
      name: isOwner ? 'Owner Landlord' : 'Intruder Landlord',
      email: isOwner ? 'owner@demo.com' : 'intruder@demo.com',
      phoneNumber: '+5511999999000',
      role: 'LANDLORD',
      fcmToken: null,
      createdAt: new Date('2026-01-01T00:00:00Z'),
    };
    next();
  },
  requireRole: () => (_req: any, _res: any, next: any) => next(),
}));

// Search hits the real propertyService (end-to-end) so we mock the DB layer
// directly. create + update are mocked at the service boundary to assert the
// controller forwards the parsed amenity flags verbatim.
vi.mock('../src/services/propertyService', async (importOriginal) => {
  const actual = (await importOriginal()) as any;
  return {
    ...actual,
    propertyService: {
      ...actual.propertyService,
      createProperty: mockCreateProperty,
      getPropertyById: mockGetPropertyById,
      updateProperty: mockUpdateProperty,
    },
  };
});

vi.mock('../src/config/db', () => ({
  default: {
    property: {
      count: mockSearchCount,
      findMany: mockSearchFindMany,
    },
  },
}));

vi.mock('../src/config/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}));

import request from 'supertest';
import app from '../src/app';

const TINY_JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xd9]);

type SeededRow = {
  id: string;
  landlordId: string;
  title: string;
  price: number;
  address: string;
  status: string;
  moderationStatus: string;
  hasWifi: boolean;
  hasPool: boolean;
  images: unknown[];
  contracts: unknown[];
};

function seedRow(id: string, hasWifi: boolean, hasPool: boolean): SeededRow {
  return {
    id,
    landlordId: LANDLORD_ID,
    title: `Seeded ${hasWifi ? 'wifi' : 'noWifi'}-${hasPool ? 'pool' : 'noPool'}`,
    price: 2500,
    address: 'Rua Teste, 10',
    status: 'AVAILABLE',
    moderationStatus: 'APPROVED',
    hasWifi,
    hasPool,
    images: [],
    contracts: [],
  };
}

const STORE = {
  wifiPool: seedRow(randomUUID(), true, true),
  wifiOnly: seedRow(randomUUID(), true, false),
  poolOnly: seedRow(randomUUID(), false, true),
  neither: seedRow(randomUUID(), false, false),
};
const ALL_ROWS = Object.values(STORE);

beforeEach(() => {
  vi.clearAllMocks();

  (mockSearchCount as ReturnType<typeof vi.fn>).mockImplementation(async (args: any) => {
    return filterRows(args?.where).length;
  });
  (mockSearchFindMany as ReturnType<typeof vi.fn>).mockImplementation(async (args: any) => {
    return filterRows(args?.where);
  });
});

function filterRows(where: any): SeededRow[] {
  return ALL_ROWS.filter((row) => {
    if (where?.hasWifi !== undefined && row.hasWifi !== where.hasWifi) return false;
    if (where?.hasPool !== undefined && row.hasPool !== where.hasPool) return false;
    return true;
  });
}

describe('LL-022 — POST /api/properties (application/json) persists hasWifi + hasPool', () => {
  it('forwards both flags from body to createProperty and echoes them in the 201 payload', async () => {
    const createdId = randomUUID();
    (mockCreateProperty as ReturnType<typeof vi.fn>).mockImplementation(async (data: any) => ({
      id: createdId,
      ...data,
      images: [],
    }));

    const res = await request(app)
      .post('/api/properties')
      .set('Content-Type', 'application/json')
      .send({
        landlordId: LANDLORD_ID,
        title: 'Loft com piscina e wifi',
        description: 'Imóvel com amenities completas para LL-022.',
        price: 3200,
        address: 'Av. Paulista, 1000, São Paulo - SP',
        hasWifi: true,
        hasPool: true,
      });

    expect(res.status).toBe(201);
    expect(res.body.hasWifi).toBe(true);
    expect(res.body.hasPool).toBe(true);
    expect(mockCreateProperty).toHaveBeenCalledTimes(1);
    const [dataArg] = mockCreateProperty.mock.calls[0];
    expect(dataArg.hasWifi).toBe(true);
    expect(dataArg.hasPool).toBe(true);
  });

  it('omitting both flags in POST body leaves them absent from data payload (DB default = false)', async () => {
    const createdId = randomUUID();
    (mockCreateProperty as ReturnType<typeof vi.fn>).mockImplementation(async (data: any) => ({
      id: createdId,
      ...data,
      hasWifi: false,
      hasPool: false,
      images: [],
    }));

    const res = await request(app)
      .post('/api/properties')
      .set('Content-Type', 'application/json')
      .send({
        landlordId: LANDLORD_ID,
        title: 'Sem amenities',
        description: 'Body sem flags — DB default false.',
        price: 1800,
        address: 'Rua Simples, 55',
      });

    expect(res.status).toBe(201);
    const [dataArg] = mockCreateProperty.mock.calls[0];
    expect(dataArg).not.toHaveProperty('hasWifi');
    expect(dataArg).not.toHaveProperty('hasPool');
  });
});

describe('LL-022 — PUT /api/properties/:id (application/json) updates hasWifi + hasPool', () => {
  it('owner PATCH-style update via JSON forwards hasWifi/hasPool to updateProperty', async () => {
    const propertyId = randomUUID();
    mockGetPropertyById.mockResolvedValue({
      id: propertyId,
      landlordId: LANDLORD_ID,
      images: [],
    });
    mockUpdateProperty.mockImplementation(async (_id: string, data: any) => ({
      id: propertyId,
      landlordId: LANDLORD_ID,
      ...data,
      images: [],
    }));

    const res = await request(app)
      .put(`/api/properties/${propertyId}`)
      .set('Authorization', 'Bearer landlord-owner')
      .set('Content-Type', 'application/json')
      .send({ hasWifi: true, hasPool: false });

    expect(res.status).toBe(200);
    expect(res.body.hasWifi).toBe(true);
    expect(res.body.hasPool).toBe(false);
    expect(mockUpdateProperty).toHaveBeenCalledTimes(1);
    const [, dataArg] = mockUpdateProperty.mock.calls[0];
    expect(dataArg.hasWifi).toBe(true);
    expect(dataArg.hasPool).toBe(false);
  });
});

describe('LL-022 — PUT /api/properties/:id (multipart/form-data) coerces `true`/`false` strings', () => {
  it('multipart text fields `hasWifi=true` + `hasPool=false` arrive as booleans at service', async () => {
    const propertyId = randomUUID();
    mockGetPropertyById.mockResolvedValue({
      id: propertyId,
      landlordId: LANDLORD_ID,
      images: [],
    });
    mockUpdateProperty.mockImplementation(async (_id: string, data: any, files?: any[]) => ({
      id: propertyId,
      landlordId: LANDLORD_ID,
      ...data,
      images: (files ?? []).map((_, i) => ({
        id: randomUUID(),
        propertyId,
        url: `/uploads/${propertyId}/file-${i}.jpg`,
        isCover: i === 0,
        caption: null,
        createdAt: new Date().toISOString(),
      })),
    }));

    const res = await request(app)
      .put(`/api/properties/${propertyId}`)
      .set('Authorization', 'Bearer landlord-owner')
      .field('title', 'Com novo Wi-Fi')
      .field('hasWifi', 'true')
      .field('hasPool', 'false')
      .attach('photos', TINY_JPEG, { filename: 'new.jpg', contentType: 'image/jpeg' });

    expect(res.status).toBe(200);
    expect(res.body.hasWifi).toBe(true);
    expect(res.body.hasPool).toBe(false);
    expect(mockUpdateProperty).toHaveBeenCalledTimes(1);
    const [, dataArg, filesArg] = mockUpdateProperty.mock.calls[0];
    expect(dataArg.hasWifi).toBe(true);
    expect(dataArg.hasPool).toBe(false);
    expect(Array.isArray(filesArg)).toBe(true);
    expect(filesArg).toHaveLength(1);
  });

  it('rejects multipart `hasWifi=yep` with 400 VALIDATION_ERROR (no silent coercion)', async () => {
    const propertyId = randomUUID();
    mockGetPropertyById.mockResolvedValue({
      id: propertyId,
      landlordId: LANDLORD_ID,
      images: [],
    });

    const res = await request(app)
      .put(`/api/properties/${propertyId}`)
      .set('Authorization', 'Bearer landlord-owner')
      .field('hasWifi', 'yep');

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_ERROR');
    expect(mockUpdateProperty).not.toHaveBeenCalled();
  });
});

describe('LL-022 — GET /api/properties/search filters by hasWifi / hasPool', () => {
  it('hasWifi=true alone returns rows with hasWifi=true (wifiPool + wifiOnly)', async () => {
    const res = await request(app).get('/api/properties/search?hasWifi=true');

    expect(res.status).toBe(200);
    const ids = res.body.data.map((p: any) => p.id);
    expect(ids).toHaveLength(2);
    expect(ids).toContain(STORE.wifiPool.id);
    expect(ids).toContain(STORE.wifiOnly.id);
    expect(mockSearchFindMany.mock.calls[0][0].where).toMatchObject({ hasWifi: true });
  });

  it('hasPool=true alone returns rows with hasPool=true (wifiPool + poolOnly)', async () => {
    const res = await request(app).get('/api/properties/search?hasPool=true');

    expect(res.status).toBe(200);
    const ids = res.body.data.map((p: any) => p.id);
    expect(ids).toHaveLength(2);
    expect(ids).toContain(STORE.wifiPool.id);
    expect(ids).toContain(STORE.poolOnly.id);
    expect(mockSearchFindMany.mock.calls[0][0].where).toMatchObject({ hasPool: true });
  });

  it('hasWifi=true AND hasPool=true returns only the row with BOTH flags', async () => {
    const res = await request(app).get('/api/properties/search?hasWifi=true&hasPool=true');

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].id).toBe(STORE.wifiPool.id);
    expect(mockSearchFindMany.mock.calls[0][0].where).toMatchObject({
      hasWifi: true,
      hasPool: true,
    });
  });

  it('hasWifi=false returns rows where hasWifi is explicitly false (poolOnly + neither)', async () => {
    const res = await request(app).get('/api/properties/search?hasWifi=false');

    expect(res.status).toBe(200);
    const ids = res.body.data.map((p: any) => p.id);
    expect(ids).toHaveLength(2);
    expect(ids).toContain(STORE.poolOnly.id);
    expect(ids).toContain(STORE.neither.id);
    expect(mockSearchFindMany.mock.calls[0][0].where).toMatchObject({ hasWifi: false });
  });

  it('no amenity flags in query returns ALL rows and does NOT add amenity filters to where', async () => {
    const res = await request(app).get('/api/properties/search');

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(ALL_ROWS.length);
    const where = mockSearchFindMany.mock.calls[0][0].where;
    expect(where).not.toHaveProperty('hasWifi');
    expect(where).not.toHaveProperty('hasPool');
  });

  it('Zod search schema accepts hasWifi/hasPool as optional booleans (string coercion)', async () => {
    const { propertySearchSchema } = await import('../src/utils/searchValidation');

    expect(propertySearchSchema.parse({ hasWifi: 'true' }).hasWifi).toBe(true);
    expect(propertySearchSchema.parse({ hasWifi: 'false' }).hasWifi).toBe(false);
    expect(propertySearchSchema.parse({ hasPool: 'true' }).hasPool).toBe(true);
    // Absent string yields undefined (no filter) rather than false.
    expect(propertySearchSchema.parse({}).hasWifi).toBeUndefined();
    expect(propertySearchSchema.parse({}).hasPool).toBeUndefined();
  });
});
