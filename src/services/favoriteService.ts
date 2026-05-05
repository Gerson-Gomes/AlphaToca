import prisma from '../config/db';

export async function addFavorite(userId: string, propertyId: string) {
  return prisma.favorite.upsert({
    where: {
      favorites_user_property_key: {
        userId,
        propertyId
      }
    },
    update: {}, // Do nothing if already exists
    create: {
      userId,
      propertyId
    },
    include: {
      property: true
    }
  });
}

export async function removeFavorite(userId: string, propertyId: string) {
  return prisma.favorite.delete({
    where: {
      favorites_user_property_key: {
        userId,
        propertyId
      }
    }
  });
}

export async function listUserFavorites(userId: string) {
  return prisma.favorite.findMany({
    where: { userId },
    include: {
      property: {
        include: {
          images: {
            where: { isCover: true },
            take: 1
          }
        }
      }
    },
    orderBy: { createdAt: 'desc' }
  });
}

export async function isPropertyFavorited(userId: string, propertyId: string) {
  const favorite = await prisma.favorite.findUnique({
    where: {
      favorites_user_property_key: {
        userId,
        propertyId
      }
    }
  });
  return !!favorite;
}
