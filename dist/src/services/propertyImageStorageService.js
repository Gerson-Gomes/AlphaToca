"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.savePropertyImages = savePropertyImages;
exports.cleanupPropertyImages = cleanupPropertyImages;
const crypto_1 = require("crypto");
const promises_1 = require("fs/promises");
const path_1 = __importDefault(require("path"));
const UPLOADS_ROOT = path_1.default.join(__dirname, '../../uploads');
const MIME_TO_EXT = {
    'image/jpeg': 'jpg',
    'image/png': 'png',
};
function propertyDir(propertyId) {
    return path_1.default.join(UPLOADS_ROOT, propertyId);
}
function isEnoent(error) {
    return (typeof error === 'object' &&
        error !== null &&
        error.code === 'ENOENT');
}
async function savePropertyImages(propertyId, files) {
    if (files.length === 0)
        return [];
    const dir = propertyDir(propertyId);
    await (0, promises_1.mkdir)(dir, { recursive: true });
    const saved = [];
    const writtenAbsolutePaths = [];
    try {
        for (let i = 0; i < files.length; i++) {
            const file = files[i];
            const ext = MIME_TO_EXT[file.mimetype];
            if (!ext) {
                throw new Error('INVALID_FILE_TYPE');
            }
            const filename = `${(0, crypto_1.randomUUID)()}.${ext}`;
            const absolutePath = path_1.default.join(dir, filename);
            await (0, promises_1.writeFile)(absolutePath, file.buffer);
            writtenAbsolutePaths.push(absolutePath);
            saved.push({
                url: `/uploads/${propertyId}/${filename}`,
                isCover: i === 0,
            });
        }
        return saved;
    }
    catch (error) {
        await Promise.all(writtenAbsolutePaths.map((p) => (0, promises_1.rm)(p, { force: true }).catch(() => undefined)));
        await (0, promises_1.rmdir)(dir).catch(() => undefined);
        throw error;
    }
}
async function cleanupPropertyImages(propertyId, urls) {
    const dir = propertyDir(propertyId);
    await Promise.all(urls.map(async (url) => {
        const filename = path_1.default.basename(url);
        const absolutePath = path_1.default.join(dir, filename);
        try {
            await (0, promises_1.rm)(absolutePath, { force: false });
        }
        catch (err) {
            if (!isEnoent(err))
                throw err;
        }
    }));
    try {
        await (0, promises_1.rmdir)(dir);
    }
    catch (err) {
        if (isEnoent(err))
            return;
        const code = err.code;
        if (code === 'ENOTEMPTY' || code === 'EEXIST')
            return;
        throw err;
    }
}
