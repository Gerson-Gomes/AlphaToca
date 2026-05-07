import prisma from '../config/db';
import { ModerationStatus, Property, PropertyImage, PropertyStatus, PropertyType, Prisma } from '@prisma/client';
import { CreatePropertyInput, UpdatePropertyInput } from '../utils/propertyValidation';
import { PropertySearchInput } from '../utils/searchValidation';
import { pushNotificationService } from './pushNotificationService';
import { cleanupPropertyImages, savePropertyImages } from './propertyImageStorageService';
import { logger } from '../config/logger';

// Erros de negócio do propertyService. O controlador faz `err instanceof
// PropertyError` e mapeia para { status, code, messages } — mesma forma usada
// por ContractError/VisitError/ProposalError.
export class PropertyError extends Error {
  constructor(
    public httpStatus: number,
    public code: string,
    message: string,
  ) {
    super(message);
    this.name = 'PropertyError';
  }
}

// Re-exportado para compatibilidade com código anterior que importe diretamente deste módulo
export type PropertySearchParams = PropertySearchInput;

export type PropertyWithImages = Property & { images: PropertyImage[] };

// LL-017 estende o shape do currentTenant com os campos de verificação de
// identidade — o chip "selo verificado" no card do inquilino depende deles.
// `identityVerifiedAt` é exposto como ISO-8601 (string) no JSON da API.
export type CurrentTenant =
  | {
      id: string;
      name: string;
      isIdentityVerified: boolean;
      identityVerifiedAt: string | null;
    }
  | null;
export type PropertyWithCurrentTenant = Property & {
  images?: PropertyImage[];
  currentTenant: CurrentTenant;
};

// Seleção reutilizada nas queries que expõem currentTenant: somente o contrato
// ACTIVE mais recente e, dele, { id, name, isIdentityVerified, identityVerifiedAt }
// do tenant. Evita vazar PII extra na resposta e garante que `include` produza
// no máximo 1 linha de contrato por property (mesmo se dois ACTIVE coexistirem
// por um bug transitório).
const CURRENT_TENANT_CONTRACT_SELECT = {
  where: { status: 'ACTIVE' as const },
  select: {
    tenant: {
      select: {
        id: true,
        name: true,
        isIdentityVerified: true,
        identityVerifiedAt: true,
      },
    },
  },
  take: 1,
  orderBy: { createdAt: 'desc' as const },
};

type TenantRow = {
  id: string;
  name: string;
  isIdentityVerified: boolean;
  identityVerifiedAt: Date | null;
};

function mapTenant(tenant: TenantRow | null): CurrentTenant {
  if (!tenant) return null;
  return {
    id: tenant.id,
    name: tenant.name,
    isIdentityVerified: tenant.isIdentityVerified,
    identityVerifiedAt: tenant.identityVerifiedAt ? tenant.identityVerifiedAt.toISOString() : null,
  };
}

function extractCurrentTenant(
  contracts: Array<{ tenant: TenantRow | null }> | undefined,
): CurrentTenant {
  if (!contracts || contracts.length === 0) return null;
  return mapTenant(contracts[0].tenant);
}

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

      // Busca única de contratos ACTIVE para todos os property ids da página —
      // mantém o contrato de "no N+1": 1 query extra, constante independente
      // do tamanho da página.
      const propertyIds = properties.map((p: any) => p.id);
      const currentTenantByPropertyId = new Map<string, CurrentTenant>();
      if (propertyIds.length > 0) {
        const activeContracts = await prisma.contract.findMany({
          where: { status: 'ACTIVE', propertyId: { in: propertyIds } },
          select: {
            propertyId: true,
            createdAt: true,
            tenant: {
              select: {
                id: true,
                name: true,
                isIdentityVerified: true,
                identityVerifiedAt: true,
              },
            },
          },
          orderBy: { createdAt: 'desc' },
        });
        for (const contract of activeContracts) {
          if (!currentTenantByPropertyId.has(contract.propertyId)) {
            currentTenantByPropertyId.set(contract.propertyId, mapTenant(contract.tenant));
          }
        }
      }

      const data = properties.map((p: any) => ({
        ...p,
        currentTenant: currentTenantByPropertyId.get(p.id) ?? null,
      }));

      return {
        data,
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
          take: 1,
        },
        // Single JOIN pulls the ACTIVE contract + tenant name in the same query
        // as the properties themselves (Prisma batches relation loads into 1 extra
        // query regardless of page size — no N+1).
        contracts: CURRENT_TENANT_CONTRACT_SELECT,
      },
    });

    const data = properties.map(({ contracts, ...rest }) => ({
      ...rest,
      currentTenant: extractCurrentTenant(contracts),
    }));

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

  async getPropertyById(id: string): Promise<PropertyWithCurrentTenant | null> {
    const property = await prisma.property.findUnique({
      where: { id },
      include: {
        images: true,
        contracts: CURRENT_TENANT_CONTRACT_SELECT,
      },
    });
    if (!property) return null;
    const { contracts, ...rest } = property;
    return { ...rest, currentTenant: extractCurrentTenant(contracts) };
  },

  async updateProperty(
    id: string,
    data: UpdatePropertyInput,
    files?: Express.Multer.File[],
  ): Promise<PropertyWithImages | null> {
    const exists = await prisma.property.findUnique({
      where: { id },
      include: { images: true },
    });
    if (!exists) return null;

    // Zod mistura photosToRemove com os campos escalares — separamos aqui para
    // não passar chaves inválidas ao prisma.property.update. Dedup de URLs
    // repetidas no mesmo request evita excluir duas vezes ou tentar promover
    // uma capa já removida.
    const { photosToRemove: rawPhotosToRemove, ...scalarData } = data;
    const photosToRemove = rawPhotosToRemove
      ? Array.from(new Set(rawPhotosToRemove))
      : [];
    const hasFiles = !!files && files.length > 0;
    const hasRemovals = photosToRemove.length > 0;

    // Regra: URLs em photosToRemove precisam pertencer AO IMÓVEL sendo editado.
    // 400 (não 404) para não vazar existência de fotos de outros proprietários.
    if (hasRemovals) {
      const existingUrls = new Set(exists.images.map((img) => img.url));
      const invalidUrls = photosToRemove.filter((url) => !existingUrls.has(url));
      if (invalidUrls.length > 0) {
        throw new PropertyError(
          400,
          'VALIDATION_ERROR',
          'One or more photo URLs do not belong to this property',
        );
      }
    }

    // Caminho rápido: PUT JSON tradicional sem fotos novas e sem remoções.
    if (!hasFiles && !hasRemovals) {
      return prisma.property.update({
        where: { id },
        data: scalarData,
        include: { images: true },
      });
    }

    // Computa o estado pós-remoção para decidir capa. Se a capa foi removida e
    // sobraram imagens existentes, a mais antiga é promovida na mesma tx. Se
    // sobraram imagens mas nenhuma era capa (caso improvável pós-POST), a
    // ordenação por createdAt também promove a mais antiga — mantém o invariante
    // "toda foto-set com pelo menos 1 imagem tem uma capa".
    const removedSet = new Set(photosToRemove);
    const remainingExisting = exists.images.filter((img) => !removedSet.has(img.url));
    const removedCoverImage = exists.images.find(
      (img) => img.isCover && removedSet.has(img.url),
    );
    const promoteOldestRemaining =
      !!removedCoverImage && remainingExisting.length > 0;
    const imageToPromote = promoteOldestRemaining
      ? [...remainingExisting].sort(
          (a, b) => a.createdAt.getTime() - b.createdAt.getTime(),
        )[0]
      : null;

    // hasCoverAfterRemoval: usado para decidir se a primeira foto nova vira capa.
    // - Capa existia e NÃO foi removida → já tem capa.
    // - Capa foi removida mas há imagem para promover → terá capa após a tx.
    // - Nenhum dos dois → primeira foto nova (se houver) vira capa.
    const hasCoverAfterRemoval =
      (exists.images.some((img) => img.isCover) && !removedCoverImage) ||
      promoteOldestRemaining;

    let savedUrls: string[] = [];

    try {
      const updated = await prisma.$transaction(async (tx) => {
        // 1. Remoção no banco (antes do update escalar para manter a ordem
        //    documentada no PRD: validate → tx { delete → update → insert }).
        if (hasRemovals) {
          await tx.propertyImage.deleteMany({
            where: { propertyId: id, url: { in: photosToRemove } },
          });

          if (imageToPromote) {
            await tx.propertyImage.update({
              where: { id: imageToPromote.id },
              data: { isCover: true },
            });
          }
        }

        // 2. Update escalar.
        await tx.property.update({
          where: { id },
          data: scalarData,
        });

        // 3. Inserção de novas fotos (fluxo já coberto pelo US-006).
        if (hasFiles) {
          const saved = await savePropertyImages(id, files!);
          savedUrls = saved.map((s) => s.url);

          await tx.propertyImage.createMany({
            data: saved.map((s, idx) => ({
              propertyId: id,
              url: s.url,
              isCover: !hasCoverAfterRemoval && idx === 0,
            })),
          });
        }

        return tx.property.findUniqueOrThrow({
          where: { id },
          include: { images: true },
        });
      });

      // 4. Só depois do commit apagamos os arquivos em storage — falhas aqui
      //    NÃO desfazem o commit (a PRD pede log-only). Usa cleanupPropertyImages
      //    que tolera ENOENT e não lança em rmdir parcial.
      if (hasRemovals) {
        await cleanupPropertyImages(id, photosToRemove).catch((cleanupErr) => {
          logger.warn(
            { err: cleanupErr, propertyId: id, removedCount: photosToRemove.length },
            '[propertyService] Storage cleanup after photosToRemove failed; DB state is authoritative',
          );
        });
      }

      return updated;
    } catch (error) {
      if (savedUrls.length > 0) {
        await cleanupPropertyImages(id, savedUrls).catch((cleanupErr) => {
          logger.error(
            { err: cleanupErr, propertyId: id },
            '[propertyService] Failed to cleanup uploaded images after updateProperty rollback',
          );
        });
      }
      throw error;
    }
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
