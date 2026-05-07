import { Request, Response, NextFunction } from 'express';
import { propertyService } from '../services/propertyService';
import { rentalPaymentService } from '../services/rentalPaymentService';
import {
  listPaymentsParamsSchema,
  listPaymentsQuerySchema,
  updateCurrentPaymentSchema,
} from '../utils/rentalPaymentValidation';

export const rentalPaymentController = {
  /**
   * GET /api/properties/:id/payments/current
   *
   * Owner-only: 404 quando o imóvel não existe, 403 quando o usuário autenticado
   * não é o locador. A ordem 404→403 é a mesma usada em PUT /properties/:id
   * (US-006) — evita diferenciar 404 de 403 para ids inventados.
   *
   * Nunca retorna 404 por "não há pagamento registrado": o contrato com o UI é
   * responder AWAITING + updatedAt/updatedBy null quando a linha não existe
   * ainda (tratado em rentalPaymentService.getCurrent).
   */
  async getCurrent(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = req.params;
      const localUser = req.localUser;
      if (!localUser) {
        return res.status(401).json({
          status: 401,
          code: 'UNAUTHORIZED',
          messages: [{ message: 'Authentication required.' }],
        });
      }

      const property = await propertyService.getPropertyById(id);
      if (!property) {
        return res.status(404).json({
          status: 404,
          code: 'NOT_FOUND',
          messages: [{ message: 'Property not found' }],
        });
      }
      if (property.landlordId !== localUser.id) {
        return res.status(403).json({
          status: 403,
          code: 'FORBIDDEN',
          messages: [{ message: 'Only the property owner can read rental payment status.' }],
        });
      }

      const payment = await rentalPaymentService.getCurrent(id);
      return res.status(200).json(payment);
    } catch (error) {
      next(error);
    }
  },

  /**
   * PUT /api/properties/:id/payments/current
   *
   * Upsert do status do aluguel do mês corrente. Apenas o locador dono do
   * imóvel pode gravar — não-donos recebem 403, anônimos 401, imóvel
   * inexistente 404 (mesma ordem 404→403 usada em GET para não vazar
   * existência de imóveis a terceiros).
   *
   * O período NÃO é aceito do body nem de query — o servidor recomputa o
   * `YYYY-MM` corrente em UTC. Isso bloqueia edições retroativas via API
   * (reviewer exige histórico auditável, não "rebobinar meses passados").
   * O `updatedBy` vem do `req.localUser.id` (JWT → authSyncMiddleware).
   */
  async updateCurrent(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = req.params;
      const localUser = req.localUser;
      if (!localUser) {
        return res.status(401).json({
          status: 401,
          code: 'UNAUTHORIZED',
          messages: [{ message: 'Authentication required.' }],
        });
      }

      const property = await propertyService.getPropertyById(id);
      if (!property) {
        return res.status(404).json({
          status: 404,
          code: 'NOT_FOUND',
          messages: [{ message: 'Property not found' }],
        });
      }
      if (property.landlordId !== localUser.id) {
        return res.status(403).json({
          status: 403,
          code: 'FORBIDDEN',
          messages: [{ message: 'Only the property owner can update rental payment status.' }],
        });
      }

      const { status } = updateCurrentPaymentSchema.parse(req.body);
      const payment = await rentalPaymentService.upsertCurrent(id, status, localUser.id);
      return res.status(200).json(payment);
    } catch (error) {
      next(error);
    }
  },

  /**
   * GET /api/properties/:propertyId/payments?tenantId=<uuid>
   *
   * Histórico multi-mês de pagamentos para o par (propertyId, tenantId). O
   * service restringe os meses àqueles dentro da janela de algum contrato do
   * inquilino com o imóvel — pagamentos registrados durante inquilinos
   * anteriores não aparecem.
   *
   * Guards (ordem load-bearing):
   *   401 — sem auth
   *   400 — params/query inválidos (UUIDs)
   *   404 — imóvel inexistente (antes do 403 pra não criar oráculo de existência)
   *   403 — imóvel existe mas o caller !== landlordId
   *   200 — lista (possivelmente vazia) em period DESC
   */
  async listByTenant(req: Request, res: Response, next: NextFunction) {
    try {
      const localUser = req.localUser;
      if (!localUser) {
        return res.status(401).json({
          status: 401,
          code: 'UNAUTHORIZED',
          messages: [{ message: 'Authentication required.' }],
        });
      }

      const { propertyId } = listPaymentsParamsSchema.parse(req.params);
      const { tenantId } = listPaymentsQuerySchema.parse(req.query);

      const property = await propertyService.getPropertyById(propertyId);
      if (!property) {
        return res.status(404).json({
          status: 404,
          code: 'NOT_FOUND',
          messages: [{ message: 'Property not found' }],
        });
      }
      if (property.landlordId !== localUser.id) {
        return res.status(403).json({
          status: 403,
          code: 'FORBIDDEN',
          messages: [{ message: 'Only the property owner can read rental payment history.' }],
        });
      }

      const payments = await rentalPaymentService.listByTenant(propertyId, tenantId);
      return res.status(200).json(payments);
    } catch (error) {
      next(error);
    }
  },
};
