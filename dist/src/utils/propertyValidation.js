"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.moderatePropertySchema = exports.updatePropertySchema = exports.createPropertySchema = void 0;
const zod_1 = require("zod");
const client_1 = require("@prisma/client");
const priceField = zod_1.z.coerce.number()
    .positive({ message: "Price must be a positive number" })
    .transform((val) => new client_1.Prisma.Decimal(val));
// Multer populates req.body with strings for every non-file field, so
// `z.coerce.boolean()` is unsafe — it treats any non-empty string as truthy,
// turning "false" into true. Map the two multipart strings explicitly and
// pass actual booleans (JSON clients) through untouched.
const multipartBoolean = zod_1.z.preprocess((val) => {
    if (val === 'true')
        return true;
    if (val === 'false')
        return false;
    return val;
}, zod_1.z.boolean());
const optionalMoneyField = zod_1.z.coerce.number()
    .nonnegative({ message: "Must be a non-negative number" })
    .transform((val) => new client_1.Prisma.Decimal(val))
    .optional();
exports.createPropertySchema = zod_1.z.object({
    landlordId: zod_1.z.string().uuid({ message: "Invalid landlord ID format" }),
    title: zod_1.z.string().min(3).max(255),
    description: zod_1.z.string().min(10),
    price: priceField,
    status: zod_1.z.nativeEnum(client_1.PropertyStatus).optional().default(client_1.PropertyStatus.AVAILABLE),
    address: zod_1.z.string().min(5),
    city: zod_1.z.string().optional(),
    state: zod_1.z.string().length(2).toUpperCase().optional(),
    zipCode: zod_1.z.string().optional(),
    type: zod_1.z.nativeEnum(client_1.PropertyType).optional(),
    bedrooms: zod_1.z.coerce.number().int().nonnegative().optional(),
    bathrooms: zod_1.z.coerce.number().int().nonnegative().optional(),
    parkingSpots: zod_1.z.coerce.number().int().nonnegative().optional(),
    area: zod_1.z.coerce.number().nonnegative().optional(),
    latitude: zod_1.z.coerce.number().optional(),
    longitude: zod_1.z.coerce.number().optional(),
    views: zod_1.z.coerce.number().int().nonnegative().optional(),
    condoFee: optionalMoneyField,
    propertyTax: optionalMoneyField,
    isFurnished: multipartBoolean.optional(),
    petsAllowed: multipartBoolean.optional(),
    nearSubway: multipartBoolean.optional(),
    isFeatured: multipartBoolean.optional(),
    hasWifi: multipartBoolean.optional(),
    hasPool: multipartBoolean.optional(),
});
// Multer coleta campos de texto repetidos em um array; um único campo chega como
// string. Normalizamos tudo para string[] antes de validar, para que o
// controlador/serviço trate um formato único. Aceita URLs relativas (ex.
// "/uploads/<propertyId>/<file>.jpg") — a URL absoluta aqui romperia o contrato
// já exposto em PropertyImage.url.
const photosToRemoveField = zod_1.z.preprocess((val) => {
    if (val === undefined || val === null || val === '')
        return undefined;
    if (Array.isArray(val))
        return val;
    return [val];
}, zod_1.z.array(zod_1.z.string().min(1)).optional());
exports.updatePropertySchema = zod_1.z.object({
    title: zod_1.z.string().min(3).max(255).optional(),
    description: zod_1.z.string().min(10).optional(),
    price: priceField.optional(),
    status: zod_1.z.nativeEnum(client_1.PropertyStatus).optional(),
    address: zod_1.z.string().min(5).optional(),
    city: zod_1.z.string().optional(),
    state: zod_1.z.string().length(2).toUpperCase().optional(),
    zipCode: zod_1.z.string().optional(),
    type: zod_1.z.nativeEnum(client_1.PropertyType).optional(),
    hasWifi: multipartBoolean.optional(),
    hasPool: multipartBoolean.optional(),
    photosToRemove: photosToRemoveField,
});
// Somente APPROVED ou REJECTED são decisões válidas — PENDING é default no insert
// e não faz sentido como alvo de moderação (reverteria o status para "não avaliado").
exports.moderatePropertySchema = zod_1.z
    .object({
    decision: zod_1.z.enum([client_1.ModerationStatus.APPROVED, client_1.ModerationStatus.REJECTED]),
    reason: zod_1.z.string().trim().min(1).max(500).optional(),
})
    .refine((val) => val.decision !== client_1.ModerationStatus.REJECTED || !!val.reason, {
    message: 'reason is required when decision is REJECTED',
    path: ['reason'],
});
