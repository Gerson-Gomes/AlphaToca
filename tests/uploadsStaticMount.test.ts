import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdir, rm, writeFile } from 'fs/promises';
import path from 'path';

// Firebase env vars must be set before importing src/app — validateAuthConfig
// runs at module load and would otherwise throw. Same pattern as
// tests/contractPdf.test.ts. Static mounts themselves skip the authStack, so
// no further auth mocking is required.
process.env.FIREBASE_PROJECT_ID = process.env.FIREBASE_PROJECT_ID || 'test-project';
process.env.FIREBASE_CLIENT_EMAIL = process.env.FIREBASE_CLIENT_EMAIL || 'test@example.com';
process.env.FIREBASE_PRIVATE_KEY = process.env.FIREBASE_PRIVATE_KEY || 'test-key';

import request from 'supertest';
import app from '../src/app';

// Minimal 1x1 PNG. The bytes themselves do not matter for express.static —
// the Content-Type is decided by the file extension via the `mime` db — but
// using a real PNG keeps the fixture honest in case a future assertion grows
// to inspect the body.
const PNG_PAYLOAD = Buffer.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
    0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
    0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4,
    0x89, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x44, 0x41,
    0x54, 0x78, 0x9c, 0x62, 0x00, 0x01, 0x00, 0x00,
    0x05, 0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4, 0x00,
    0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae,
    0x42, 0x60, 0x82,
]);

const UPLOADS_ROOT = path.resolve(__dirname, '../uploads');
const FIXTURE_DIR_NAME = 'test-fixture';
const FIXTURE_FILE_NAME = 'sample.png';
const FIXTURE_DIR = path.join(UPLOADS_ROOT, FIXTURE_DIR_NAME);
const FIXTURE_FILE = path.join(FIXTURE_DIR, FIXTURE_FILE_NAME);

beforeAll(async () => {
    await mkdir(FIXTURE_DIR, { recursive: true });
    await writeFile(FIXTURE_FILE, PNG_PAYLOAD);
});

afterAll(async () => {
    await rm(FIXTURE_DIR, { recursive: true, force: true });
});

describe('Static uploads dual mount — US-002', () => {
    it('GET /uploads/<dir>/<file>.png returns 200 with image/* content-type', async () => {
        const res = await request(app).get(`/uploads/${FIXTURE_DIR_NAME}/${FIXTURE_FILE_NAME}`);

        expect(res.status).toBe(200);
        expect(res.headers['content-type']).toMatch(/^image\//);
    });

    it('GET /api/uploads/<dir>/<file>.png returns 200 with image/* content-type (compat path)', async () => {
        const res = await request(app).get(`/api/uploads/${FIXTURE_DIR_NAME}/${FIXTURE_FILE_NAME}`);

        expect(res.status).toBe(200);
        expect(res.headers['content-type']).toMatch(/^image\//);
    });

    it('GET /uploads response includes Cross-Origin-Resource-Policy: cross-origin', async () => {
        const res = await request(app).get(`/uploads/${FIXTURE_DIR_NAME}/${FIXTURE_FILE_NAME}`);

        expect(res.status).toBe(200);
        expect(res.headers['cross-origin-resource-policy']).toBe('cross-origin');
    });

    it('GET /api/uploads response includes Cross-Origin-Resource-Policy: cross-origin', async () => {
        const res = await request(app).get(`/api/uploads/${FIXTURE_DIR_NAME}/${FIXTURE_FILE_NAME}`);

        expect(res.status).toBe(200);
        expect(res.headers['cross-origin-resource-policy']).toBe('cross-origin');
    });

    it('GET /uploads response carries a Cache-Control header with max-age', async () => {
        const res = await request(app).get(`/uploads/${FIXTURE_DIR_NAME}/${FIXTURE_FILE_NAME}`);

        expect(res.status).toBe(200);
        expect(res.headers['cache-control']).toBeDefined();
        expect(res.headers['cache-control']).toMatch(/max-age/);
    });

    it('GET /api/uploads response carries a Cache-Control header with max-age', async () => {
        const res = await request(app).get(`/api/uploads/${FIXTURE_DIR_NAME}/${FIXTURE_FILE_NAME}`);

        expect(res.status).toBe(200);
        expect(res.headers['cache-control']).toBeDefined();
        expect(res.headers['cache-control']).toMatch(/max-age/);
    });

    it('refuses path traversal via /uploads/../package.json (does not return 200)', async () => {
        const res = await request(app).get('/uploads/../package.json');

        expect(res.status).not.toBe(200);
    });

    it('refuses path traversal via /api/uploads/../package.json (does not return 200)', async () => {
        const res = await request(app).get('/api/uploads/../package.json');

        expect(res.status).not.toBe(200);
    });

    it('refuses URL-encoded path traversal via /uploads/%2e%2e/package.json (does not return 200)', async () => {
        const res = await request(app).get('/uploads/%2e%2e/package.json');

        expect(res.status).not.toBe(200);
    });
});
