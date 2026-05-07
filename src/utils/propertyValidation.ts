import { z } from 'zod';
import { ModerationStatus, PropertyStatus, PropertyType, Prisma } from '@prisma/client';

const priceField = z.coerce.number()
  .positive({ message: "Price must be a positive number" })
  .transform((val) => new Prisma.Decimal(val));

// Multer populates req.body with strings for every non-file field, so
// `z.coerce.boolean()` is unsafe — it treats any non-empty string as truthy,
// turning "false" into true. Map the two multipart strings explicitly and
// pass actual booleans (JSON clients) through untouched.
const multipartBoolean = z.preprocess((val) => {
  if (val === 'true') return true;
  if (val === 'false') return false;
  return val;
}, z.boolean());

const optionalMoneyField = z.coerce.number()
  .nonnegative({ message: "Must be a non-negative number" })
  .transform((val) => new Prisma.Decimal(val))
  .optional();

export const createPropertySchema = z.object({
  landlordId: z.string().uuid({ message: "Invalid landlord ID format" }),
  title: z.string().min(3).max(255),
  description: z.string().min(10),
  price: priceField,
  status: z.nativeEnum(PropertyStatus).optional().default(PropertyStatus.AVAILABLE),
  address: z.string().min(5),
  city: z.string().optional(),
  state: z.string().length(2).toUpperCase().optional(),
  zipCode: z.string().optional(),

  type: z.nativeEnum(PropertyType).optional(),
  bedrooms: z.coerce.number().int().nonnegative().optional(),
  bathrooms: z.coerce.number().int().nonnegative().optional(),
  parkingSpots: z.coerce.number().int().nonnegative().optional(),
  area: z.coerce.number().nonnegative().optional(),
  latitude: z.coerce.number().optional(),
  longitude: z.coerce.number().optional(),
  views: z.coerce.number().int().nonnegative().optional(),
  condoFee: optionalMoneyField,
  propertyTax: optionalMoneyField,

  isFurnished: multipartBoolean.optional(),
  petsAllowed: multipartBoolean.optional(),
  nearSubway: multipartBoolean.optional(),
  isFeatured: multipartBoolean.optional(),
});

export const updatePropertySchema = z.object({
  title: z.string().min(3).max(255).optional(),
  description: z.string().min(10).optional(),
  price: priceField.optional(),
  status: z.nativeEnum(PropertyStatus).optional(),
  address: z.string().min(5).optional(),
  city: z.string().optional(),
  state: z.string().length(2).toUpperCase().optional(),
  zipCode: z.string().optional(),
});

// Somente APPROVED ou REJECTED são decisões válidas — PENDING é default no insert
// e não faz sentido como alvo de moderação (reverteria o status para "não avaliado").
export const moderatePropertySchema = z
  .object({
    decision: z.enum([ModerationStatus.APPROVED, ModerationStatus.REJECTED]),
    reason: z.string().trim().min(1).max(500).optional(),
  })
  .refine((val) => val.decision !== ModerationStatus.REJECTED || !!val.reason, {
    message: 'reason is required when decision is REJECTED',
    path: ['reason'],
  });

export type CreatePropertyInput = z.infer<typeof createPropertySchema>;
export type UpdatePropertyInput = z.infer<typeof updatePropertySchema>;
export type ModeratePropertyInput = z.infer<typeof moderatePropertySchema>;