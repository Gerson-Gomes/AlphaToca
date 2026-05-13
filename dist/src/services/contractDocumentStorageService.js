"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.saveSignedContractPdf = saveSignedContractPdf;
exports.cleanupContractDocument = cleanupContractDocument;
exports.removeContractDocumentAbsolute = removeContractDocumentAbsolute;
const crypto_1 = require("crypto");
const promises_1 = require("fs/promises");
const path_1 = __importDefault(require("path"));
// Contract documents live under `uploads/contracts/<contractId>/` so they
// never collide with `uploads/<propertyId>/` from property images — the
// contract id is a different UUID namespace and mixing them would make
// disk scans ambiguous. The local-filesystem strategy mirrors
// propertyImageStorageService (US-006/US-007), keeping a single storage
// convention across the codebase.
const UPLOADS_ROOT = path_1.default.join(__dirname, '../../uploads');
const CONTRACT_ROOT = path_1.default.join(UPLOADS_ROOT, 'contracts');
function contractDir(contractId) {
    return path_1.default.join(CONTRACT_ROOT, contractId);
}
function isEnoent(error) {
    return (typeof error === 'object' &&
        error !== null &&
        error.code === 'ENOENT');
}
// Saves a single signed PDF to disk. Returns the relative URL (matching
// the `/uploads/contracts/<contractId>/<file>.pdf` shape expected by the
// download endpoint US-015) AND the absolute path so the caller can
// compensate (delete the file) if the downstream DB write rolls back.
async function saveSignedContractPdf(contractId, buffer) {
    const dir = contractDir(contractId);
    await (0, promises_1.mkdir)(dir, { recursive: true });
    const filename = `${(0, crypto_1.randomUUID)()}.pdf`;
    const absolutePath = path_1.default.join(dir, filename);
    try {
        await (0, promises_1.writeFile)(absolutePath, buffer);
        return {
            url: `/uploads/contracts/${contractId}/${filename}`,
            absolutePath,
        };
    }
    catch (error) {
        await (0, promises_1.rm)(absolutePath, { force: true }).catch(() => undefined);
        await (0, promises_1.rmdir)(dir).catch(() => undefined);
        throw error;
    }
}
// Removes a previously-saved signed PDF by its storage URL. Tolerates
// ENOENT (the file is already gone) and non-empty directory removal so
// it's safe to call even when state has drifted. Non-throwing on ENOTEMPTY
// matches the cleanup semantics of propertyImageStorageService.
async function cleanupContractDocument(contractId, url) {
    const filename = path_1.default.basename(url);
    const dir = contractDir(contractId);
    const absolutePath = path_1.default.join(dir, filename);
    try {
        await (0, promises_1.rm)(absolutePath, { force: false });
    }
    catch (err) {
        if (!isEnoent(err))
            throw err;
    }
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
// Directly remove an absolute path — used for rollback after a
// transactional DB write failure. Does NOT attempt rmdir cleanup because
// the parent directory may be in mid-write by a concurrent caller; leave
// empty-dir cleanup to the next cleanupContractDocument pass.
async function removeContractDocumentAbsolute(absolutePath) {
    try {
        await (0, promises_1.rm)(absolutePath, { force: true });
    }
    catch (err) {
        if (!isEnoent(err))
            throw err;
    }
}
