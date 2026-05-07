import { describe, it, expect, vi, beforeEach } from 'vitest';

// Firebase env vars must be present before importing app — validateAuthConfig
// runs at load time and importing src/app transitively pulls in firebase init.
process.env.FIREBASE_PROJECT_ID = process.env.FIREBASE_PROJECT_ID || 'test-project';
process.env.FIREBASE_CLIENT_EMAIL = process.env.FIREBASE_CLIENT_EMAIL || 'test@example.com';
process.env.FIREBASE_PRIVATE_KEY = process.env.FIREBASE_PRIVATE_KEY || 'test-key';

const LANDLORD_ID = '22222222-2222-2222-2222-222222222222';
const TENANT_ID = '33333333-3333-3333-3333-333333333333';
const ADMIN_ID = '44444444-4444-4444-4444-444444444444';

const { mockMonthlySeries } = vi.hoisted(() => ({
  mockMonthlySeries: vi.fn(),
}));

// Preserve the real `requireRole` (via importOriginal) so 403 is exercised
// end-to-end — 401 from the checkJwt stub, 403 from the real requireRole
// operating on req.localUser.role.
vi.mock('../src/middlewares/authMiddleware', async (importOriginal) => {
  const actual = (await importOriginal()) as any;
  return {
    ...actual,
    validateAuthConfig: () => {},
    checkJwt: (req: any, res: any, next: any) => {
      const header = req.headers.authorization;
      if (
        header === 'Bearer the-landlord' ||
        header === 'Bearer the-tenant' ||
        header === 'Bearer the-admin'
      ) {
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
      const uid = req.auth?.payload?.uid;
      let localUser: any = {
        id: LANDLORD_ID,
        firebaseUid: uid,
        name: 'João Locador',
        email: 'joao@demo.com',
        phoneNumber: '+5511999999000',
        role: 'LANDLORD',
        fcmToken: null,
        createdAt: new Date('2026-01-01T00:00:00Z'),
      };
      if (uid === 'Bearer the-tenant') {
        localUser = { ...localUser, id: TENANT_ID, name: 'Maria Silva', role: 'TENANT' };
      } else if (uid === 'Bearer the-admin') {
        localUser = { ...localUser, id: ADMIN_ID, name: 'Ana Admin', role: 'ADMIN' };
      }
      req.localUser = localUser;
      next();
    },
  };
});

vi.mock('../src/services/analyticsService', () => ({
  analyticsService: { monthlySeries: mockMonthlySeries },
}));

vi.mock('../src/config/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}));

import request from 'supertest';
import app from '../src/app';

beforeEach(() => {
  vi.clearAllMocks();
});

function defaultSeries() {
  return {
    months: ['2025-12', '2026-01', '2026-02', '2026-03', '2026-04', '2026-05'],
    rentals: [1, 0, 2, 1, 0, 3],
    newTenants: [1, 0, 2, 1, 0, 2],
    monthlyRevenue: [3200, 0, 6400, 3200, 0, 9600],
  };
}

describe('GET /api/properties/analytics/monthly — LL-005', () => {
  it('200 default range: last 6 months ending current month (UTC) when no query params', async () => {
    mockMonthlySeries.mockResolvedValue(defaultSeries());

    const res = await request(app)
      .get('/api/properties/analytics/monthly')
      .set('Authorization', 'Bearer the-landlord');

    expect(res.status).toBe(200);
    expect(res.body).toEqual(defaultSeries());

    expect(mockMonthlySeries).toHaveBeenCalledTimes(1);
    const [landlordArg, fromArg, toArg] = mockMonthlySeries.mock.calls[0];
    expect(landlordArg).toBe(LANDLORD_ID);
    expect(fromArg).toBeInstanceOf(Date);
    expect(toArg).toBeInstanceOf(Date);

    // Default window: `to` is the first day of the current month (UTC) and
    // `from` is 5 months earlier — together they span 6 inclusive months.
    const now = new Date();
    const expectedTo = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const expectedFrom = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 5, 1),
    );
    expect(toArg.toISOString()).toBe(expectedTo.toISOString());
    expect(fromArg.toISOString()).toBe(expectedFrom.toISOString());
  });

  it('200 custom range: forwards parsed from/to (UTC) to the service', async () => {
    const payload = {
      months: ['2026-03', '2026-04', '2026-05'],
      rentals: [2, 1, 4],
      newTenants: [1, 1, 3],
      monthlyRevenue: [6400, 3200, 12800],
    };
    mockMonthlySeries.mockResolvedValue(payload);

    const res = await request(app)
      .get('/api/properties/analytics/monthly?from=2026-03-01&to=2026-05-01')
      .set('Authorization', 'Bearer the-landlord');

    expect(res.status).toBe(200);
    expect(res.body).toEqual(payload);

    const [landlordArg, fromArg, toArg] = mockMonthlySeries.mock.calls[0];
    expect(landlordArg).toBe(LANDLORD_ID);
    expect(fromArg.toISOString()).toBe('2026-03-01T00:00:00.000Z');
    expect(toArg.toISOString()).toBe('2026-05-01T00:00:00.000Z');
  });

  it('400: oversized span (> 24 months) is rejected before hitting the service', async () => {
    const res = await request(app)
      .get('/api/properties/analytics/monthly?from=2024-01-01&to=2026-05-01')
      .set('Authorization', 'Bearer the-landlord');

    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('code', 'VALIDATION_ERROR');
    expect(mockMonthlySeries).not.toHaveBeenCalled();
  });

  it('400: from > to is rejected before hitting the service', async () => {
    const res = await request(app)
      .get('/api/properties/analytics/monthly?from=2026-05-01&to=2026-03-01')
      .set('Authorization', 'Bearer the-landlord');

    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('code', 'VALIDATION_ERROR');
    expect(mockMonthlySeries).not.toHaveBeenCalled();
  });

  it('400: malformed date (not the first of the month) is rejected', async () => {
    const res = await request(app)
      .get('/api/properties/analytics/monthly?from=2026-03-15&to=2026-05-01')
      .set('Authorization', 'Bearer the-landlord');

    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('code', 'VALIDATION_ERROR');
    expect(mockMonthlySeries).not.toHaveBeenCalled();
  });

  it('200: at-boundary 24-month span is accepted (inclusive)', async () => {
    mockMonthlySeries.mockResolvedValue({
      months: [],
      rentals: [],
      newTenants: [],
      monthlyRevenue: [],
    });

    const res = await request(app)
      .get('/api/properties/analytics/monthly?from=2024-06-01&to=2026-05-01')
      .set('Authorization', 'Bearer the-landlord');

    expect(res.status).toBe(200);
    expect(mockMonthlySeries).toHaveBeenCalledTimes(1);
  });

  it('401: missing Authorization header is rejected before any analytics call', async () => {
    const res = await request(app).get('/api/properties/analytics/monthly');

    expect(res.status).toBe(401);
    expect(res.body).toHaveProperty('code', 'UNAUTHORIZED');
    expect(mockMonthlySeries).not.toHaveBeenCalled();
  });

  it('403: authenticated tenant is rejected by requireRole(LANDLORD)', async () => {
    const res = await request(app)
      .get('/api/properties/analytics/monthly')
      .set('Authorization', 'Bearer the-tenant');

    expect(res.status).toBe(403);
    expect(res.body).toHaveProperty('code', 'FORBIDDEN');
    expect(mockMonthlySeries).not.toHaveBeenCalled();
  });

  it('403: authenticated admin is also rejected — endpoint is LANDLORD-only', async () => {
    const res = await request(app)
      .get('/api/properties/analytics/monthly')
      .set('Authorization', 'Bearer the-admin');

    expect(res.status).toBe(403);
    expect(res.body).toHaveProperty('code', 'FORBIDDEN');
    expect(mockMonthlySeries).not.toHaveBeenCalled();
  });
});
