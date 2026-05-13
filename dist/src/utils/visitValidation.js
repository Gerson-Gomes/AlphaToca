"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.availabilityQuerySchema = exports.listVisitsQuerySchema = exports.updateVisitSchema = exports.createVisitSchema = void 0;
const zod_1 = require("zod");
const client_1 = require("@prisma/client");
const visits_1 = require("../config/visits");
const scheduledAtField = zod_1.z.coerce.date({
    errorMap: () => ({ message: 'scheduledAt must be a valid ISO-8601 datetime' }),
});
const durationMinutesField = zod_1.z
    .number()
    .int()
    .min(visits_1.MIN_VISIT_DURATION_MINUTES, `durationMinutes must be at least ${visits_1.MIN_VISIT_DURATION_MINUTES}`)
    .max(visits_1.MAX_VISIT_DURATION_MINUTES, `durationMinutes must be at most ${visits_1.MAX_VISIT_DURATION_MINUTES}`);
exports.createVisitSchema = zod_1.z.object({
    propertyId: zod_1.z.string().min(1, { message: 'propertyId is required' }),
    tenantId: zod_1.z.string().min(1, { message: 'tenantId is required' }),
    rentalProcessId: zod_1.z.string().optional(),
    scheduledAt: scheduledAtField,
    durationMinutes: durationMinutesField.optional().default(visits_1.DEFAULT_VISIT_DURATION_MINUTES),
    source: zod_1.z.nativeEnum(client_1.VisitSource).optional().default(client_1.VisitSource.MANUAL),
    notes: zod_1.z.string().max(2000).optional(),
});
exports.updateVisitSchema = zod_1.z
    .object({
    scheduledAt: scheduledAtField.optional(),
    durationMinutes: durationMinutesField.optional(),
    status: zod_1.z.nativeEnum(client_1.VisitStatus).optional(),
    notes: zod_1.z.string().max(2000).optional().nullable(),
})
    .refine((data) => Object.keys(data).length > 0, {
    message: 'At least one field must be provided for update',
});
exports.listVisitsQuerySchema = zod_1.z.object({
    propertyId: zod_1.z.string().optional(),
    tenantId: zod_1.z.string().optional(),
    landlordId: zod_1.z.string().optional(),
    status: zod_1.z.nativeEnum(client_1.VisitStatus).optional(),
    from: zod_1.z.coerce.date().optional(),
    to: zod_1.z.coerce.date().optional(),
});
exports.availabilityQuerySchema = zod_1.z.object({
    propertyId: zod_1.z.string().min(1, { message: 'propertyId is required' }),
    from: zod_1.z.coerce.date(),
    to: zod_1.z.coerce.date(),
    slotMinutes: zod_1.z.coerce
        .number()
        .int()
        .min(visits_1.MIN_VISIT_DURATION_MINUTES)
        .max(visits_1.MAX_VISIT_DURATION_MINUTES)
        .optional()
        .default(visits_1.DEFAULT_VISIT_DURATION_MINUTES),
});
