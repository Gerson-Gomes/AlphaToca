import prisma from '../config/db';
import { ModerationStatus, Property, PropertyImage, PropertyStatus, PropertyType, Prisma } from '@prisma/client';
import { CreatePropertyInput, UpdatePropertyInput } from '../utils/propertyValidation';
import { PropertySearchInput } from '../utils/searchValidation';
import { pushNotificationService } from './pushNotificationService';
import { cleanupPropertyImages, savePropertyImages } from './propertyImageStorageService';
import { logger } from '../config/logger';

// Re-exportado para compatibilidade com código anterior que importe diretamente deste módulo
export type PropertySearchParams = PropertySearchInput;

export type PropertyWithImages = Property & { images: PropertyImage[] };



export const propertyService = {
  async createProperty(
    data: CreatePropertyInput,
    files?: Express.Multer.File[],
  ): Promise<PropertyWithImages> {
    if (!files || files.length === 0) {
      return prisma.property.create({
        data,
        include: { images: true },
      });
    }

    let createdPropertyId: string | undefined;
    let savedUrls: string[] = [];

    try {
      return await prisma.$transaction(async (tx) => {
        const property = await tx.property.create({ data });
        createdPropertyId = property.id;

        const saved = await savePropertyImages(property.id, files);
        savedUrls = saved.map((s) => s.url);

        await tx.propertyImage.createMany({
          data: saved.map((s) => ({
            propertyId: property.id,
            url: s.url,
            isCover: s.isCover,
          })),
        });

        return tx.property.findUniqueOrThrow({
          where: { id: property.id },
          include: { images: true },
        });
      });
    } catch (error) {
      if (createdPropertyId && savedUrls.length > 0) {
        await cleanupPropertyImages(createdPropertyId, savedUrls).catch((cleanupErr) => {
          logger.error(
            { err: cleanupErr, propertyId: createdPropertyId },
            '[propertyService] Failed to cleanup uploaded images after transaction rollback',
          );
        });
      }
      throw error;
    }
  },

  async listProperties(): Promise<Property[]> {
    return prisma.property.findMany({
      orderBy: { id: 'asc' },
    });
  },

  async searchProperties(params: PropertySearchInput) {
    const {
      type,
      minPrice,
      maxPrice,
      minBedrooms,
      minBathrooms,
      minParkingSpots,
      minArea,
      maxArea,
      isFurnished,
      petsAllowed,
      nearSubway,
      isFeatured,
      city,
      state,
      landlordId,
      tenantId,
      lat,
      lng,
      radius,
      orderBy = 'isFeatured',
      page = 1,
      limit = 10,
    } = params;

    const skip = (page - 1) * limit;

    // Quando landlordId é informado, mostramos todos os status (dono vê seus imóveis).
    // Nas buscas públicas sem filtro de proprietário, restringe a AVAILABLE.
    const where: Prisma.PropertyWhereInput = {
      ...(landlordId ? { landlordId } : { status: PropertyStatus.AVAILABLE,moderationStatus: ModerationStatus.APPROVED  }),
      ...(type && { type }),

      ...((minPrice || maxPrice) && {
        price: {
          ...(minPrice && { gte: minPrice }),
          ...(maxPrice && { lte: maxPrice }),
        },
      }),

      ...(minBedrooms && { bedrooms: { gte: minBedrooms } }),
      ...(minBathrooms && { bathrooms: { gte: minBathrooms } }),
      ...(minParkingSpots && { parkingSpots: { gte: minParkingSpots } }),

      ...((minArea || maxArea) && {
        area: {
          ...(minArea && { gte: minArea }),
          ...(maxArea && { lte: maxArea }),
        },
      }),

      ...(isFurnished !== undefined && { isFurnished }),
      ...(petsAllowed !== undefined && { petsAllowed }),
      ...(nearSubway !== undefined && { nearSubway }),
      ...(isFeatured !== undefined && { isFeatured }),
      ...(city && { city: { contains: city, mode: 'insensitive' } }),
      ...(state && { state: { equals: state, mode: 'insensitive' } }),
      // Filtros de proprietário/inquilino (§1 BACKEND_GAPS)
      // tenantId é aplicado via visitas (filtragem no join) — ver nota abaixo
      ...(tenantId && {
        visits: {
          some: { tenantId }
        }
      }),
    };

    let sort: Prisma.PropertyOrderByWithRelationInput = { isFeatured: 'desc' };
    if (orderBy === 'createdAt') sort = { createdAt: 'desc' };
    else if (orderBy === 'views') sort = { views: 'desc' };
    else if (orderBy === 'priceAsc') sort = { price: 'asc' };
    else if (orderBy === 'priceDesc') sort = { price: 'desc' };


    const hasLocation = lat !== undefined && lng !== undefined;


    const finalOrderBy = (orderBy === 'nearest' && !hasLocation) ? 'isFeatured' : orderBy;

    if (hasLocation || finalOrderBy === 'nearest') {
      const radiusFilter = radius ? Prisma.sql`AND (6371 * acos(cos(radians(${lat})) * cos(radians(latitude)) * cos(radians(longitude) - radians(${lng})) + sin(radians(${lat})) * sin(radians(latitude)))) <= ${radius}` : Prisma.empty;

      const cityFilter = city ? Prisma.sql`AND city ILIKE ${`%${city}%`}` : Prisma.empty;
      const stateFilter = state ? Prisma.sql`AND state ILIKE ${state}` : Prisma.empty;

      // Filtros de proprietário/inquilino no caminho raw SQL
      const landlordFilter = landlordId ? Prisma.sql`AND landlord_id = ${landlordId}::uuid` : Prisma.empty;
      const statusFilter = landlordId ? Prisma.empty : Prisma.sql`AND status = 'AVAILABLE' AND moderation_status = 'APPROVED'`;
      const tenantFilter = tenantId
        ? Prisma.sql`AND id IN (SELECT property_id FROM visits WHERE tenant_id = ${tenantId}::uuid)`
        : Prisma.empty;

      const distanceSql = hasLocation
        ? Prisma.sql`(6371 * acos(cos(radians(${lat})) * cos(radians(latitude)) * cos(radians(longitude) - radians(${lng})) + sin(radians(${lat})) * sin(radians(latitude))))`
        : Prisma.sql`0`;

      const orderBySql = finalOrderBy === 'nearest'
        ? Prisma.sql`distance ASC`
        : finalOrderBy === 'priceAsc' ? Prisma.sql`price ASC`
          : finalOrderBy === 'priceDesc' ? Prisma.sql`price DESC`
            : finalOrderBy === 'views' ? Prisma.sql`views DESC`
              : Prisma.sql`is_featured DESC, created_at DESC`;


      const properties = await prisma.$queryRaw<any[]>`
        SELECT *, ${distanceSql} as distance
        FROM "properties"
        WHERE 1=1
        ${statusFilter}
        ${radiusFilter}
        ${cityFilter}
        ${stateFilter}
        ${landlordFilter}
        ${tenantFilter}
        ORDER BY ${orderBySql}
        LIMIT ${limit} OFFSET ${skip}
      `;

      const totalResult = await prisma.$queryRaw<any[]>`
        SELECT COUNT(*) as count FROM "properties"
        WHERE 1=1
        ${statusFilter}
        ${radiusFilter}
        ${cityFilter}
        ${stateFilter}
        ${landlordFilter}
        ${tenantFilter}
      `;
      const total = Number(totalResult[0].count);

      return {
        data: properties,
        meta: {
          total,
          page,
          limit,
          totalPages: Math.ceil(total / limit),
        },
      };
    }

    // Fetch total and properties sequentially to reduce connection pool pressure
    const total = await prisma.property.count({ where });
    const properties = await prisma.property.findMany({
      where,
      orderBy: [sort, { id: 'asc' }],
      skip,
      take: limit,
      include: {
        images: {
          where: { isCover: true },
          take: 1
        }
      }
    });

    return {
      data: properties,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  },

  async getPropertyById(id: string): Promise<Property | null> {
    return prisma.property.findUnique({
      where: { id },
      include: { images: true }
    });
  },

  async updateProperty(id: string, data: UpdatePropertyInput): Promise<Property | null> {
    const exists = await prisma.property.findUnique({ where: { id } });
    if (!exists) return null;

    return prisma.property.update({
      where: { id },
      data,
    });
  },

  async deleteProperty(id: string): Promise<boolean> {
    try {
      await prisma.property.delete({
        where: { id },
      });
      return true;
    } catch (error) {
      return false;
    }
  },

  async moderateProperty(
    id: string,
    decision: ModerationStatus,
    moderatorId: string,
    reason?: string,
  ): Promise<Property | null> {
    // Busca o imóvel com o locador para notificação
    const property = await prisma.property.findUnique({
      where: { id },
      select: {
        id: true,
        title: true,
        landlord: { select: { id: true, fcmToken: true } },
      },
    });
    if (!property) return null;

    const updated = await prisma.property.update({
      where: { id },
      data: {
        moderationStatus: decision,
        moderationReason: reason ?? null,
        moderatedAt: new Date(),
        moderatedBy: moderatorId,
      },
    });

    // Gatilho: notifica o locador sobre o resultado da moderação
    const landlord = property.landlord;
    const propertyTitle = property.title;

    if (decision === ModerationStatus.APPROVED) {
      pushNotificationService.notify({
        userId: landlord.id,
        fcmToken: landlord.fcmToken,
        type: 'PROPERTY_APPROVED',
        title: 'Imóvel Aprovado!',
        body: `Seu imóvel "${propertyTitle}" foi aprovado e já está visível para os inquilinos.`,
        data: { propertyId: id, type: 'PROPERTY_APPROVED' },
      }).catch((err) =>
        logger.error({ err, propertyId: id }, '[propertyService] Falha ao notificar locador sobre PROPERTY_APPROVED')
      );
    } else if (decision === ModerationStatus.REJECTED) {
      pushNotificationService.notify({
        userId: landlord.id,
        fcmToken: landlord.fcmToken,
        type: 'PROPERTY_REJECTED',
        title: 'Imóvel Precisa de Ajustes',
        body: `Seu imóvel "${propertyTitle}" não foi aprovado. Motivo: ${reason ?? 'Verifique os detalhes no app.'}.`,
        data: { propertyId: id, type: 'PROPERTY_REJECTED' },
      }).catch((err) =>
        logger.error({ err, propertyId: id }, '[propertyService] Falha ao notificar locador sobre PROPERTY_REJECTED')
      );
    }

    return updated;
  },

  async listForModeration(params: { status?: ModerationStatus; page?: number; limit?: number }) {
    const { status = ModerationStatus.PENDING, page = 1, limit = 20 } = params;
    const skip = (page - 1) * limit;

    const where: Prisma.PropertyWhereInput = { moderationStatus: status };

    const total = await prisma.property.count({ where });
    const data = await prisma.property.findMany({
      where,
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      skip,
      take: limit,
      include: {
        landlord: { select: { id: true, name: true, phoneNumber: true } },
        images: { where: { isCover: true }, take: 1 },
      },
    });

    return {
      data,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  },
};
