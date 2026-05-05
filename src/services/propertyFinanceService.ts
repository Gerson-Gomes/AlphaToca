import prisma from '../config/db';
import { Prisma } from '@prisma/client';

export async function addExpense(data: {
  propertyId: string;
  type: string;
  amount: number;
  dueDate: string;
  year: number;
  month: number;
  isPaid?: boolean;
}) {
  return prisma.propertyExpense.create({
    data: {
      ...data,
      dueDate: new Date(data.dueDate),
      amount: new Prisma.Decimal(data.amount),
    }
  });
}

export async function addMaintenance(data: {
  propertyId: string;
  title: string;
  description?: string;
  cost?: number;
  date: string;
  status?: string;
}) {
  return prisma.maintenanceLog.create({
    data: {
      ...data,
      date: new Date(data.date),
      cost: data.cost ? new Prisma.Decimal(data.cost) : null,
    }
  });
}

export async function getPropertyDossier(propertyId: string) {
  const property = await prisma.property.findUnique({
    where: { id: propertyId },
    include: {
      expenses: { orderBy: { dueDate: 'desc' }, take: 20 },
      maintenanceLogs: { orderBy: { date: 'desc' }, take: 20 },
      contracts: { 
        where: { status: 'ACTIVE' },
        include: { tenant: { select: { id: true, name: true } } }
      }
    }
  });
  return property;
}

export async function getLandlordFinancialSummary(landlordId: string, year: number) {
  // 1. Busca todos os imóveis do proprietário
  const properties = await prisma.property.findMany({
    where: { landlordId },
    include: {
      contracts: { 
        where: { 
          status: 'ACTIVE',
          startDate: { lte: new Date(`${year}-12-31`) },
          OR: [
            { endDate: { gte: new Date(`${year}-01-01`) } },
            { endDate: { equals: undefined } } // Se não tiver fim, assume ativo
          ]
        } 
      },
      expenses: { where: { year } },
    }
  });

  // 2. Inicializa dados mensais
  const monthlyData = Array.from({ length: 12 }, (_, i) => ({
    month: i + 1,
    revenue: 0,
    expenses: 0,
    net: 0
  }));

  properties.forEach(p => {
    // Soma receita (simplificada para o demo/MVP)
    p.contracts.forEach(c => {
      const startMonth = c.startDate.getFullYear() === year ? c.startDate.getMonth() : 0;
      const endMonth = (c.endDate && c.endDate.getFullYear() === year) ? c.endDate.getMonth() : 11;
      
      for (let m = startMonth; m <= endMonth; m++) {
        monthlyData[m].revenue += Number(c.monthlyRent);
      }
    });

    // Soma despesas registradas no banco
    p.expenses.forEach(e => {
      if (e.month >= 1 && e.month <= 12) {
        monthlyData[e.month - 1].expenses += Number(e.amount);
      }
    });
  });

  monthlyData.forEach(d => {
    d.net = d.revenue - d.expenses;
  });

  return monthlyData;
}
