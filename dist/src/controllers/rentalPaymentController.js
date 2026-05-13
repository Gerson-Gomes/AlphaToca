"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.rentalPaymentController = void 0;
const propertyService_1 = require("../services/propertyService");
const rentalPaymentService_1 = require("../services/rentalPaymentService");
const rentalPaymentValidation_1 = require("../utils/rentalPaymentValidation");
exports.rentalPaymentController = {
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
    async getCurrent(req, res, next) {
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
            const property = await propertyService_1.propertyService.getPropertyById(id);
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
            const payment = await rentalPaymentService_1.rentalPaymentService.getCurrent(id);
            return res.status(200).json(payment);
        }
        catch (error) {
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
    async updateCurrent(req, res, next) {
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
            const property = await propertyService_1.propertyService.getPropertyById(id);
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
            const { status } = rentalPaymentValidation_1.updateCurrentPaymentSchema.parse(req.body);
            const payment = await rentalPaymentService_1.rentalPaymentService.upsertCurrent(id, status, localUser.id);
            return res.status(200).json(payment);
        }
        catch (error) {
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
    async listByTenant(req, res, next) {
        try {
            const localUser = req.localUser;
            if (!localUser) {
                return res.status(401).json({
                    status: 401,
                    code: 'UNAUTHORIZED',
                    messages: [{ message: 'Authentication required.' }],
                });
            }
            const { propertyId } = rentalPaymentValidation_1.listPaymentsParamsSchema.parse(req.params);
            const { tenantId } = rentalPaymentValidation_1.listPaymentsQuerySchema.parse(req.query);
            const property = await propertyService_1.propertyService.getPropertyById(propertyId);
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
            const payments = await rentalPaymentService_1.rentalPaymentService.listByTenant(propertyId, tenantId);
            return res.status(200).json(payments);
        }
        catch (error) {
            next(error);
        }
    },
};
