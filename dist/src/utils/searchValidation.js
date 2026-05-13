"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.propertySearchSchema = void 0;
const zod_1 = require("zod");
const client_1 = require("@prisma/client");
// LL-020: usa `z.nativeEnum` para acompanhar automaticamente qualquer extens\u00e3o
// do enum `PropertyType` no schema (LL-019 adicionou KITNET, PENTHOUSE, LAND,
// COMMERCIAL). Manter um allowlist manual divergia do Prisma client e faria o
// filtro rejeitar valores v\u00e1lidos do UI.
const PropertyTypeSchema = zod_1.z.nativeEnum(client_1.PropertyType);
// Helper para converter texto da URL em número
const stringToNumber = zod_1.z.string().optional().transform((val) => {
    if (!val)
        return undefined;
    const num = Number(val);
    return isNaN(num) ? undefined : num;
});
// Helper para converter texto da URL ("true"/"false") em Booleano verdadeiro/falso
const stringToBoolean = zod_1.z.string().optional().transform((val) => {
    if (val === 'true')
        return true;
    if (val === 'false')
        return false;
    return undefined;
});
exports.propertySearchSchema = zod_1.z.object({
    type: PropertyTypeSchema.optional(),
    minPrice: stringToNumber,
    maxPrice: stringToNumber,
    minBedrooms: stringToNumber,
    minBathrooms: stringToNumber,
    minParkingSpots: stringToNumber,
    minArea: stringToNumber,
    maxArea: stringToNumber,
    isFurnished: stringToBoolean,
    petsAllowed: stringToBoolean,
    nearSubway: stringToBoolean,
    isFeatured: stringToBoolean,
    hasWifi: stringToBoolean,
    hasPool: stringToBoolean,
    city: zod_1.z.string().optional(),
    state: zod_1.z.string().length(2).toUpperCase().optional(),
    landlordId: zod_1.z.string().optional().transform(val => (val && val.trim() !== '' ? val : undefined)).pipe(zod_1.z.string().uuid().optional()),
    tenantId: zod_1.z.string().optional().transform(val => (val && val.trim() !== '' ? val : undefined)).pipe(zod_1.z.string().uuid().optional()),
    lat: stringToNumber,
    lng: stringToNumber,
    radius: stringToNumber,
    orderBy: zod_1.z.enum(['createdAt', 'views', 'priceAsc', 'priceDesc', 'isFeatured', 'nearest']).optional().default('isFeatured'),
    page: zod_1.z.string().optional().default('1').transform((val) => Math.max(1, Number(val))),
    limit: zod_1.z.string().optional().default('10').transform((val) => Math.min(100, Math.max(1, Number(val)))),
});
