"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.WhatsAppWebhookSchema = exports.WhatsAppEntrySchema = exports.WhatsAppChangeSchema = exports.WhatsAppChangeValueSchema = exports.WhatsAppStatusSchema = exports.WhatsAppTextMessageSchema = exports.WhatsAppMessageSchema = exports.WhatsAppContactSchema = void 0;
const zod_1 = require("zod");
exports.WhatsAppContactSchema = zod_1.z.object({
    wa_id: zod_1.z.string().min(1),
    profile: zod_1.z.object({
        name: zod_1.z.string().optional(),
    }).optional(),
});
// Aceita qualquer tipo de mensagem que a Meta envie. O campo `text` continua
// sendo o único que o bot processa hoje; para os demais tipos (image, audio,
// sticker, location, unsupported…) o worker envia uma resposta padrão pedindo
// texto. O schema passa a ser tolerante porque a Meta adiciona tipos novos
// periodicamente — e um Zod rejeitando significa silêncio do bot.
exports.WhatsAppMessageSchema = zod_1.z
    .object({
    from: zod_1.z.string().min(1),
    id: zod_1.z.string().min(1),
    timestamp: zod_1.z.string().min(1),
    type: zod_1.z.string().min(1),
    text: zod_1.z
        .object({
        body: zod_1.z.string(),
    })
        .optional(),
})
    .passthrough();
// Alias retrocompatível — arquivos que ainda importam o nome antigo continuam funcionando.
exports.WhatsAppTextMessageSchema = exports.WhatsAppMessageSchema;
exports.WhatsAppStatusSchema = zod_1.z.object({
    id: zod_1.z.string().min(1),
    status: zod_1.z.enum(['failed', 'sent', 'delivered', 'read']),
    timestamp: zod_1.z.string().optional(),
    recipient_id: zod_1.z.string().optional(),
});
exports.WhatsAppChangeValueSchema = zod_1.z.object({
    messaging_product: zod_1.z.string().optional(),
    metadata: zod_1.z.object({
        display_phone_number: zod_1.z.string().optional(),
        phone_number_id: zod_1.z.string().optional(),
    }).optional(),
    contacts: zod_1.z.array(exports.WhatsAppContactSchema).optional(),
    messages: zod_1.z.array(exports.WhatsAppMessageSchema).optional(),
    statuses: zod_1.z.array(exports.WhatsAppStatusSchema).optional(),
});
exports.WhatsAppChangeSchema = zod_1.z.object({
    value: exports.WhatsAppChangeValueSchema,
    field: zod_1.z.string().optional(),
});
exports.WhatsAppEntrySchema = zod_1.z.object({
    id: zod_1.z.string(),
    changes: zod_1.z.array(exports.WhatsAppChangeSchema),
});
exports.WhatsAppWebhookSchema = zod_1.z.object({
    object: zod_1.z.string(),
    entry: zod_1.z.array(exports.WhatsAppEntrySchema).min(1),
});
