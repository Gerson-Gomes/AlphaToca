import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { randomUUID } from 'crypto';
import fs from 'fs/promises';
import path from 'path';

process.env.FIREBASE_PROJECT_ID = process.env.FIREBASE_PROJECT_ID || 'test-project';
process.env.FIREBASE_CLIENT_EMAIL = process.env.FIREBASE_CLIENT_EMAIL || 'test@example.com';
process.env.FIREBASE_PRIVATE_KEY = process.env.FIREBASE_PRIVATE_KEY || 'test-key';
process.env.AUTH0_AUDIENCE = process.env.AUTH0_AUDIENCE || 'test-audience';
process.env.AUTH0_ISSUER_BASE_URL = process.env.AUTH0_ISSUER_BASE_URL || 'https://test-tenant.auth0.com';

const { mockCreateProperty, createdPropertyIds } = vi.hoisted(() => ({
  mockCreateProperty: vi.fn(),
  createdPropertyIds: new Set<string>(),
}));

vi.mock('../src/services/propertyService', async (importOriginal) => {
  const actual = (await importOriginal()) as any;
  return {
    ...actual,
    propertyService: {
      ...actual.propertyService,
      createProperty: mockCreateProperty,
    },
  };
});

import request from 'supertest';
import app from '../src/app';

const LANDLORD_ID = '11111111-1111-1111-1111-111111111111';

// Multer's fileFilter inspects the MIME type from each multipart part's
// Content-Type header, not the binary payload. A 4-byte SOI+EOI buffer is
// enough to exercise the JPEG path as long as contentType is 'image/jpeg'.
const TINY_JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xd9]);

const baseFields = {
  landlordId: LANDLORD_ID,
  title: 'Test Property',
  description: 'A test property listing with enough description text.',
  price: '4500.00',
  address: 'Rua das Flores, 123, Sao Paulo - SP',
};

beforeEach(() => {
  vi.clearAllMocks();
  mockCreateProperty.mockImplementation(async (data: any, files?: any[]) => {
    const propertyId = randomUUID();
    createdPropertyIds.add(propertyId);
    const images = (files ?? []).map((_, i) => ({
      id: randomUUID(),
      propertyId,
      url: `/uploads/${propertyId}/${randomUUID()}.jpg`,
      isCover: i === 0,
      caption: null,
      createdAt: new Date().toISOString(),
    }));
    return {
      id: propertyId,
      landlordId: data.landlordId,
      title: data.title,
      description: data.description,
      address: data.address,
      images,
    };
  });
});

afterEach(async () => {
  // Belt-and-suspenders: service is mocked so no real disk writes happen, but
  // remove any stray uploads/<propertyId>/ directories to keep the repo tidy
  // per US-010 acceptance criteria.
  const UPLOADS_ROOT = path.join(__dirname, '..', 'uploads');
  for (const id of createdPropertyIds) {
    await fs.rm(path.join(UPLOADS_ROOT, id), { recursive: true, force: true }).catch(() => {});
  }
  createdPropertyIds.clear();
});

describe('POST /api/properties — photo upload', () => {
  it('returns 201 with 3 images when 3 valid JPEGs are attached; first is cover', async () => {
    const res = await request(app)
      .post('/api/properties')
      .field('landlordId', baseFields.landlordId)
      .field('title', baseFields.title)
      .field('description', baseFields.description)
      .field('price', baseFields.price)
      .field('address', baseFields.address)
      .attach('photos', TINY_JPEG, { filename: 'a.jpg', contentType: 'image/jpeg' })
      .attach('photos', TINY_JPEG, { filename: 'b.jpg', contentType: 'image/jpeg' })
      .attach('photos', TINY_JPEG, { filename: 'c.jpg', contentType: 'image/jpeg' });

    expect(res.status).toBe(201);
    expect(Array.isArray(res.body.images)).toBe(true);
    expect(res.body.images).toHaveLength(3);
    expect(res.body.images[0].isCover).toBe(true);
    expect(res.body.images[1].isCover).toBe(false);
    expect(res.body.images[2].isCover).toBe(false);
    expect(mockCreateProperty).toHaveBeenCalledTimes(1);
  });

  it('returns 201 with images: [] when no photos are attached (JSON body regression guard)', async () => {
    const res = await request(app)
      .post('/api/properties')
      .send({
        landlordId: baseFields.landlordId,
        title: baseFields.title,
        description: baseFields.description,
        price: 4500,
        address: baseFields.address,
      });

    expect(res.status).toBe(201);
    expect(Array.isArray(res.body.images)).toBe(true);
    expect(res.body.images).toHaveLength(0);
    expect(mockCreateProperty).toHaveBeenCalledTimes(1);
  });

  it('returns 400 INVALID_FILE_TYPE when a non-image file is attached', async () => {
    const res = await request(app)
      .post('/api/properties')
      .field('landlordId', baseFields.landlordId)
      .field('title', baseFields.title)
      .field('description', baseFields.description)
      .field('price', baseFields.price)
      .field('address', baseFields.address)
      .attach('photos', Buffer.from('hello world'), {
        filename: 'notes.txt',
        contentType: 'text/plain',
      });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('INVALID_FILE_TYPE');
    expect(mockCreateProperty).not.toHaveBeenCalled();
  });

  it('returns 400 FILE_TOO_LARGE when a single image > 10MB is attached', async () => {
    const oversized = Buffer.alloc(10 * 1024 * 1024 + 1, 0xff);
    const res = await request(app)
      .post('/api/properties')
      .field('landlordId', baseFields.landlordId)
      .field('title', baseFields.title)
      .field('description', baseFields.description)
      .field('price', baseFields.price)
      .field('address', baseFields.address)
      .attach('photos', oversized, { filename: 'huge.jpg', contentType: 'image/jpeg' });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('FILE_TOO_LARGE');
    expect(mockCreateProperty).not.toHaveBeenCalled();
  });

  it('returns 400 TOO_MANY_FILES when 21 images are attached', async () => {
    let pending = request(app)
      .post('/api/properties')
      .field('landlordId', baseFields.landlordId)
      .field('title', baseFields.title)
      .field('description', baseFields.description)
      .field('price', baseFields.price)
      .field('address', baseFields.address);

    for (let i = 0; i < 21; i++) {
      pending = pending.attach('photos', TINY_JPEG, {
        filename: `p${i}.jpg`,
        contentType: 'image/jpeg',
      });
    }

    const res = await pending;

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('TOO_MANY_FILES');
    expect(mockCreateProperty).not.toHaveBeenCalled();
  });
});
