import prisma from '../config/db';
import { RentalPaymentStatus } from '@prisma/client';

// Formato YYYY-MM do servidor. Usado como chave da relação (propertyId, period)
// no modelo RentalPayment. O cliente NUNCA informa período — é sempre o mês
// corrente do servidor, para bloquear edição retroativa via API (US-010).
export function currentPeriod(now: Date = new Date()): string {
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth() + 1;
  return `${year}-${String(month).padStart(2, '0')}`;
}

export type RentalPaymentView = {
  period: string;
  status: RentalPaymentStatus;
  amount: number | null;
  updatedAt: string | null;
  updatedBy: string | null;
};

// Retorna o monthly_rent do contrato ACTIVE para o imóvel, ou `null` quando
// não há contrato ativo no momento. Leitura no write time — histórico de
// mudanças de rent NÃO é preservado (ver PRD §8 Q2 e o header da migration
// 20260507210000_add_rental_payment_amount).
async function getActiveMonthlyRent(propertyId: string): Promise<number | null> {
  const contract = await prisma.contract.findFirst({
    where: { propertyId, status: 'ACTIVE' },
    select: { monthlyRent: true },
    orderBy: { createdAt: 'desc' },
  });
  return contract ? Number(contract.monthlyRent) : null;
}

export const rentalPaymentService = {
  /**
   * Retorna o status do aluguel do mês corrente para o imóvel. Quando não há
   * linha em rental_payments para (propertyId, period), responde com o default
   * AWAITING sem persistir — a PRD/US-009 exige forma idêntica ao caminho "linha
   * existe" para que o UI sempre renderize o dropdown. A gravação só acontece
   * via PUT (US-010, upsert).
   */
  async getCurrent(propertyId: string, now: Date = new Date()): Promise<RentalPaymentView> {
    const period = currentPeriod(now);
    const row = await prisma.rentalPayment.findUnique({
      where: {
        rental_payments_property_period_key: { propertyId, period },
      },
      select: {
        period: true,
        status: true,
        amount: true,
        updatedAt: true,
        updatedBy: true,
      },
    });

    if (!row) {
      return {
        period,
        status: RentalPaymentStatus.AWAITING,
        amount: null,
        updatedAt: null,
        updatedBy: null,
      };
    }

    return {
      period: row.period,
      status: row.status,
      amount: row.amount === null ? null : Number(row.amount),
      updatedAt: row.updatedAt.toISOString(),
      updatedBy: row.updatedBy,
    };
  },

  /**
   * Upsert do status do aluguel para (propertyId, mês corrente). O período é
   * SEMPRE recomputado no servidor — não aceitamos `period` do body/query
   * para bloquear edições retroativas via API (PRD US-010).
   *
   * `updatedBy` é o id do usuário autenticado (locador dono do imóvel). O
   * `updatedAt` é gerenciado pelo Prisma via `@updatedAt` em create/update.
   * `amount` é fotografado a partir do Contract.monthlyRent ACTIVE no momento
   * do write (LL-003); `null` quando não há contrato ativo. Retorna a mesma
   * forma de `getCurrent` para o UI reutilizar o renderer.
   */
  async upsertCurrent(
    propertyId: string,
    status: RentalPaymentStatus,
    updatedBy: string,
    now: Date = new Date(),
  ): Promise<RentalPaymentView> {
    const period = currentPeriod(now);
    const amount = await getActiveMonthlyRent(propertyId);
    const row = await prisma.rentalPayment.upsert({
      where: {
        rental_payments_property_period_key: { propertyId, period },
      },
      create: {
        propertyId,
        period,
        status,
        amount,
        updatedBy,
      },
      update: {
        status,
        amount,
        updatedBy,
      },
      select: {
        period: true,
        status: true,
        amount: true,
        updatedAt: true,
        updatedBy: true,
      },
    });

    return {
      period: row.period,
      status: row.status,
      amount: row.amount === null ? null : Number(row.amount),
      updatedAt: row.updatedAt.toISOString(),
      updatedBy: row.updatedBy,
    };
  },
};
