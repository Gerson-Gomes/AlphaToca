import { describe, it, expect, vi, beforeEach } from 'vitest';

const {
  mockCreateVisit,
  mockListVisits,
  mockGetVisitById,
  mockUpdateVisit,
  mockCancelVisit,
  mockListAvailableSlots,
  MockVisitError,
} = vi.hoisted(() => {
  class MockVisitError extends Error {
    public readonly code: string;
    public readonly httpStatus: number;
    public readonly details?: Record<string, unknown>;
    constructor(code: string, httpStatus: number, details?: Record<string, unknown>) {
      super(code);
      this.name = 'VisitError';
      this.code = code;
      this.httpStatus = httpStatus;
      this.details = details;
    }
  }
  return {
    mockCreateVisit: vi.fn(),
    mockListVisits: vi.fn(),
    mockGetVisitById: vi.fn(),
    mockUpdateVisit: vi.fn(),
    mockCancelVisit: vi.fn(),
    mockListAvailableSlots: vi.fn(),
    MockVisitError,
  };
});

vi.mock('../src/services/visitService', () => ({
  createVisit: mockCreateVisit,
  listVisits: mockListVisits,
  getVisitById: mockGetVisitById,
  updateVisit: mockUpdateVisit,
  cancelVisit: mockCancelVisit,
  listAvailableSlots: mockListAvailableSlots,
  VisitError: MockVisitError,
}));

import { visitController } from '../src/controllers/visitController';
import type { Request, Response, NextFunction } from 'express';

function mockRes(): Response {
  return {
    status: vi.fn().mockReturnThis(),
    send: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
  } as unknown as Response;
}

const mockNext: NextFunction = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
});

describe('visitController.create', () => {
  it('returns 201 and the created visit on success', async () => {
    const fakeVisit = { id: 'v-1', propertyId: 'p-1' };
    mockCreateVisit.mockResolvedValueOnce(fakeVisit);
    const req = {
      body: {
        propertyId: '11111111-1111-1111-1111-111111111111',
        tenantId: '22222222-2222-2222-2222-222222222222',
        scheduledAt: '2026-05-10T14:00:00Z',
        durationMinutes: 45,
      },
    } as unknown as Request;
    const res = mockRes();

    await visitController.create(req, res, mockNext);

    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalledWith(fakeVisit);
  });

  it('returns 400 on Zod validation failure', async () => {
    const req = { body: { propertyId: 'not-uuid' } } as unknown as Request;
    const res = mockRes();

    await visitController.create(req, res, mockNext);

    expect(mockNext).toHaveBeenCalled();
    expect(mockCreateVisit).not.toHaveBeenCalled();
  });

  it('returns 404 when service throws VisitError PROPERTY_NOT_FOUND', async () => {
    mockCreateVisit.mockRejectedValueOnce(
      new MockVisitError('PROPERTY_NOT_FOUND', 404, { propertyId: 'x' }),
    );
    const req = {
      body: {
        propertyId: '11111111-1111-1111-1111-111111111111',
        tenantId: '22222222-2222-2222-2222-222222222222',
        scheduledAt: '2026-05-10T14:00:00Z',
      },
    } as unknown as Request;
    const res = mockRes();

    await visitController.create(req, res, mockNext);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'PROPERTY_NOT_FOUND' }),
    );
  });

  it('returns 409 when service throws VisitError CONFLICT', async () => {
    mockCreateVisit.mockRejectedValueOnce(
      new MockVisitError('CONFLICT', 409, { conflictWith: 'v-existing' }),
    );
    const req = {
      body: {
        propertyId: '11111111-1111-1111-1111-111111111111',
        tenantId: '22222222-2222-2222-2222-222222222222',
        scheduledAt: '2026-05-10T14:00:00Z',
      },
    } as unknown as Request;
    const res = mockRes();

    await visitController.create(req, res, mockNext);

    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'CONFLICT' }),
    );
  });

  // US-012 / Open Question #6: until the `ai-agent` JWT scope is defined,
  // every human caller must be treated as lacking it. POST /api/visits
  // therefore downgrades source=AI to MANUAL server-side, regardless of
  // what the client sent. When the scope lands, this guard flips to a
  // real claim check in visitController.create.
  it('forwards source=MANUAL to the service when the body omits source', async () => {
    mockCreateVisit.mockResolvedValueOnce({ id: 'v-1', source: 'MANUAL' });
    const req = {
      body: {
        propertyId: '11111111-1111-1111-1111-111111111111',
        tenantId: '22222222-2222-2222-2222-222222222222',
        scheduledAt: '2026-05-10T14:00:00Z',
      },
    } as unknown as Request;
    const res = mockRes();

    await visitController.create(req, res, mockNext);

    expect(mockCreateVisit).toHaveBeenCalledTimes(1);
    expect(mockCreateVisit).toHaveBeenCalledWith(
      expect.objectContaining({ source: 'MANUAL' }),
    );
  });

  it('forwards source=MANUAL to the service when the body sends source=MANUAL', async () => {
    mockCreateVisit.mockResolvedValueOnce({ id: 'v-1', source: 'MANUAL' });
    const req = {
      body: {
        propertyId: '11111111-1111-1111-1111-111111111111',
        tenantId: '22222222-2222-2222-2222-222222222222',
        scheduledAt: '2026-05-10T14:00:00Z',
        source: 'MANUAL',
      },
    } as unknown as Request;
    const res = mockRes();

    await visitController.create(req, res, mockNext);

    expect(mockCreateVisit).toHaveBeenCalledWith(
      expect.objectContaining({ source: 'MANUAL' }),
    );
  });

  it('downgrades source=AI to MANUAL when the caller lacks the ai-agent scope (always, today)', async () => {
    mockCreateVisit.mockResolvedValueOnce({ id: 'v-1', source: 'MANUAL' });
    const req = {
      body: {
        propertyId: '11111111-1111-1111-1111-111111111111',
        tenantId: '22222222-2222-2222-2222-222222222222',
        scheduledAt: '2026-05-10T14:00:00Z',
        source: 'AI',
      },
      localUser: { id: 'user-1', role: 'TENANT' },
    } as unknown as Request;
    const res = mockRes();

    await visitController.create(req, res, mockNext);

    expect(mockCreateVisit).toHaveBeenCalledTimes(1);
    expect(mockCreateVisit).toHaveBeenCalledWith(
      expect.objectContaining({ source: 'MANUAL' }),
    );
    // Sanity: the AI value MUST NOT have reached the service.
    expect(mockCreateVisit).not.toHaveBeenCalledWith(
      expect.objectContaining({ source: 'AI' }),
    );
  });
});

describe('visitController.list', () => {
  it('returns 200 with list filtered by propertyId', async () => {
    mockListVisits.mockResolvedValueOnce([{ id: 'v-1' }]);
    const req = { query: { propertyId: '11111111-1111-1111-1111-111111111111' } } as unknown as Request;
    const res = mockRes();

    await visitController.list(req, res, mockNext);

    expect(mockListVisits).toHaveBeenCalledWith(
      expect.objectContaining({ propertyId: '11111111-1111-1111-1111-111111111111' }),
    );
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith([{ id: 'v-1' }]);
  });
});

describe('visitController.getById', () => {
  it('returns 200 when found', async () => {
    mockGetVisitById.mockResolvedValueOnce({ id: 'v-1' });
    const req = { params: { id: 'v-1' } } as unknown as Request;
    const res = mockRes();

    await visitController.getById(req, res, mockNext);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ id: 'v-1' });
  });

  it('returns 404 when not found', async () => {
    mockGetVisitById.mockResolvedValueOnce(null);
    const req = { params: { id: 'nope' } } as unknown as Request;
    const res = mockRes();

    await visitController.getById(req, res, mockNext);

    expect(res.status).toHaveBeenCalledWith(404);
  });
});

describe('visitController.update', () => {
  it('returns 200 with updated visit', async () => {
    mockUpdateVisit.mockResolvedValueOnce({ id: 'v-1', notes: 'x' });
    const req = {
      params: { id: 'v-1' },
      body: { notes: 'x' },
    } as unknown as Request;
    const res = mockRes();

    await visitController.update(req, res, mockNext);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ id: 'v-1', notes: 'x' });
  });

  it('returns 404 when visit does not exist', async () => {
    mockUpdateVisit.mockResolvedValueOnce(null);
    const req = {
      params: { id: 'nope' },
      body: { notes: 'x' },
    } as unknown as Request;
    const res = mockRes();

    await visitController.update(req, res, mockNext);

    expect(res.status).toHaveBeenCalledWith(404);
  });

  it('returns 409 when update causes CONFLICT', async () => {
    mockUpdateVisit.mockRejectedValueOnce(
      new MockVisitError('CONFLICT', 409, { conflictWith: 'v-2' }),
    );
    const req = {
      params: { id: 'v-1' },
      body: { scheduledAt: '2026-05-10T14:00:00Z' },
    } as unknown as Request;
    const res = mockRes();

    await visitController.update(req, res, mockNext);

    expect(res.status).toHaveBeenCalledWith(409);
  });
});

describe('visitController.cancel', () => {
  it('returns 204 on success', async () => {
    mockCancelVisit.mockResolvedValueOnce(true);
    const req = { params: { id: 'v-1' } } as unknown as Request;
    const res = mockRes();

    await visitController.cancel(req, res, mockNext);

    expect(res.status).toHaveBeenCalledWith(204);
  });

  it('returns 404 when visit does not exist', async () => {
    mockCancelVisit.mockResolvedValueOnce(false);
    const req = { params: { id: 'nope' } } as unknown as Request;
    const res = mockRes();

    await visitController.cancel(req, res, mockNext);

    expect(res.status).toHaveBeenCalledWith(404);
  });
});

describe('visitController.availability', () => {
  it('returns 200 with slots', async () => {
    mockListAvailableSlots.mockResolvedValueOnce([
      { startsAt: new Date('2026-05-10T14:00:00Z'), endsAt: new Date('2026-05-10T14:45:00Z') },
    ]);
    const req = {
      query: {
        propertyId: '11111111-1111-1111-1111-111111111111',
        from: '2026-05-10T13:00:00Z',
        to: '2026-05-10T16:00:00Z',
      },
    } as unknown as Request;
    const res = mockRes();

    await visitController.availability(req, res, mockNext);

    expect(res.status).toHaveBeenCalledWith(200);
    const jsonArg = (res.json as any).mock.calls[0][0];
    expect(Array.isArray(jsonArg)).toBe(true);
    expect(jsonArg.length).toBe(1);
  });

  it('returns 400 on missing query params (Zod fail)', async () => {
    const req = { query: {} } as unknown as Request;
    const res = mockRes();

    await visitController.availability(req, res, mockNext);

    expect(mockNext).toHaveBeenCalled();
    expect(mockListAvailableSlots).not.toHaveBeenCalled();
  });

  it('returns 404 when property not found', async () => {
    mockListAvailableSlots.mockRejectedValueOnce(
      new MockVisitError('PROPERTY_NOT_FOUND', 404, { propertyId: 'x' }),
    );
    const req = {
      query: {
        propertyId: '11111111-1111-1111-1111-111111111111',
        from: '2026-05-10T13:00:00Z',
        to: '2026-05-10T16:00:00Z',
      },
    } as unknown as Request;
    const res = mockRes();

    await visitController.availability(req, res, mockNext);

    expect(res.status).toHaveBeenCalledWith(404);
  });
});
