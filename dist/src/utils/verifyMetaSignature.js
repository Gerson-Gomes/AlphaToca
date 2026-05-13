"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.verifyMetaSignature = verifyMetaSignature;
const crypto_1 = __importDefault(require("crypto"));
/**
 * Verifica a assinatura HMAC-SHA256 enviada pela Meta no header
 * X-Hub-Signature-256 contra o corpo cru da requisição.
 *
 * Meta envia no formato: "sha256=<hex>". A verificação usa
 * timingSafeEqual para evitar timing attacks.
 */
function verifyMetaSignature(rawBody, signatureHeader, appSecret) {
    if (!rawBody || !signatureHeader)
        return false;
    if (!signatureHeader.startsWith('sha256='))
        return false;
    const expected = crypto_1.default
        .createHmac('sha256', appSecret)
        .update(rawBody)
        .digest('hex');
    const received = signatureHeader.slice('sha256='.length);
    if (expected.length !== received.length)
        return false;
    try {
        return crypto_1.default.timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(received, 'hex'));
    }
    catch {
        return false;
    }
}
