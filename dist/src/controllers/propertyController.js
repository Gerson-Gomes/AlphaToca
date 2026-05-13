"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.propertyController = void 0;
const zod_1 = require("zod");
const propertyService_1 = require("../services/propertyService");
const profileViewService_1 = require("../services/profileViewService");
const propertyViewService_1 = require("../services/propertyViewService");
const contactClickEventService_1 = require("../services/contactClickEventService");
const analyticsService_1 = require("../services/analyticsService");
const propertyAnalyticsService_1 = require("../services/propertyAnalyticsService");
const propertyValidation_1 = require("../utils/propertyValidation");
const searchValidation_1 = require("../utils/searchValidation");
const analyticsValidation_1 = require("../utils/analyticsValidation");
const contactClickParamsSchema = zod_1.z.object({
    id: zod_1.z.string().uuid(),
});
exports.propertyController = {
    async create(req, res, next) {
        try {
            const validatedData = propertyValidation_1.createPropertySchema.parse(req.body);
            const files = req.files;
            const property = await propertyService_1.propertyService.createProperty(validatedData, files);
            return res.status(201).json(property);
        }
        catch (error) {
            next(error);
        }
    },
    async list(req, res, next) {
        try {
            const properties = await propertyService_1.propertyService.listProperties();
            return res.status(200).json(properties);
        }
        catch (error) {
            next(error);
        }
    },
    async search(req, res, next) {
        try {
            const validatedParams = searchValidation_1.propertySearchSchema.parse(req.query);
            const result = await propertyService_1.propertyService.searchProperties(validatedParams);
            return res.status(200).json(result);
        }
        catch (error) {
            next(error);
        }
    },
    /**
     * GET /api/properties/analytics/monthly?from=YYYY-MM-01&to=YYYY-MM-01
     *
     * Série mensal do landlord para o gráfico "Análise de Performance". Zod
     * valida o formato YYYY-MM-01 + `from ≤ to` + span máximo de 24 meses. Se
     * nenhuma janela for informada (ou qualquer extremo ausente), o default é
     * os últimos 6 meses terminando no mês corrente (UTC, mesmo cálculo de
     * `rentalPaymentService.currentPeriod`).
     *
     * Auth stack (authStack + requireRole(LANDLORD)) é aplicado inline no mount
     * do router — por aqui, `req.localUser` é sempre o locador autenticado.
     */
    async getMonthlyAnalytics(req, res, next) {
        try {
            const localUser = req.localUser;
            if (!localUser) {
                return res.status(401).json({
                    status: 401,
                    code: 'UNAUTHORIZED',
                    messages: [{ message: 'Authentication required.' }],
                });
            }
            const parsed = analyticsValidation_1.monthlyAnalyticsQuerySchema.parse(req.query);
            let from;
            let to;
            if (parsed.from && parsed.to) {
                from = new Date(`${parsed.from}T00:00:00.000Z`);
                to = new Date(`${parsed.to}T00:00:00.000Z`);
            }
            else {
                // Default: últimos 6 meses terminando no mês corrente. O mês corrente
                // é o primeiro dia do mês atual em UTC (alinhado com `currentPeriod`
                // do rentalPaymentService).
                const now = new Date();
                to = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
                from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 5, 1));
            }
            const series = await analyticsService_1.analyticsService.monthlySeries(localUser.id, from, to);
            return res.status(200).json(series);
        }
        catch (error) {
            next(error);
        }
    },
    async getById(req, res, next) {
        try {
            const { id } = req.params;
            const property = await propertyService_1.propertyService.getPropertyById(id);
            if (!property) {
                return res.status(404).json({
                    status: 404,
                    code: 'NOT_FOUND',
                    messages: [{ message: 'Property not found' }]
                });
            }
            // LL-001: o card "Visitas ao perfil" do dashboard do landlord conta
            // aberturas do perfil público nos últimos 30 dias. O frontend marca o
            // request com ?inspectLandlord=true quando o tenant está olhando o
            // locador a partir da ficha do imóvel. Fire-and-forget: nunca bloqueia
            // a resposta da propriedade.
            if (req.query.inspectLandlord === 'true') {
                void profileViewService_1.profileViewService.record(property.landlordId, req.localUser?.id ?? null);
            }
            // LL-006: evento por abertura da ficha para alimentar a série diária do
            // endpoint de analytics por imóvel (LL-008). Também incrementa
            // Property.views (contador agregado all-time preservado — FR-12).
            // Fire-and-forget: nunca bloqueia a resposta.
            void propertyViewService_1.propertyViewService.record(property.id, req.localUser?.id ?? null);
            return res.status(200).json(property);
        }
        catch (error) {
            next(error);
        }
    },
    /**
     * POST /api/properties/:id/contact-click
     *
     * Registra um evento de clique em "Contatar" na ficha do imóvel. PUBLIC
     * (sem authStack) — viewers anônimos (`viewerId=null`) também contam, pois
     * o botão é visível sem login. Zod valida o UUID do path; 404 se o imóvel
     * não existe (antes de inserir, para não criar eventos órfãos).
     *
     * Sem dedup: analytics de cliques conta CADA intenção de contato —
     * diferente de ProfileView/PropertyView, onde múltiplas aberturas de F5
     * em janela curta não devem inflar o bucket.
     */
    async recordContactClick(req, res, next) {
        try {
            const { id } = contactClickParamsSchema.parse(req.params);
            const property = await propertyService_1.propertyService.getPropertyById(id);
            if (!property) {
                return res.status(404).json({
                    status: 404,
                    code: 'NOT_FOUND',
                    messages: [{ message: 'Property not found' }],
                });
            }
            await contactClickEventService_1.contactClickEventService.record(id, req.localUser?.id ?? null);
            return res.status(201).json({});
        }
        catch (error) {
            next(error);
        }
    },
    /**
     * GET /api/properties/:id/analytics?window=30d|90d|1y
     *
     * Analytics por-imóvel para o dashboard do landlord. Default da janela é 30d
     * quando o query param é omitido. Ordem dos guards: 401 (auth ausente) →
     * 404 (imóvel inexistente, ANTES de 403 pra não vazar existência) → 403
     * (autenticado mas não é o dono).
     */
    async getPropertyAnalytics(req, res, next) {
        try {
            const localUser = req.localUser;
            if (!localUser) {
                return res.status(401).json({
                    status: 401,
                    code: 'UNAUTHORIZED',
                    messages: [{ message: 'Authentication required.' }],
                });
            }
            const { id } = analyticsValidation_1.propertyAnalyticsParamsSchema.parse(req.params);
            const { window } = analyticsValidation_1.propertyAnalyticsQuerySchema.parse(req.query);
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
                    messages: [{ message: 'Only the property owner can read analytics.' }],
                });
            }
            const result = await propertyAnalyticsService_1.propertyAnalyticsService.getAnalytics(id, window ?? '30d');
            return res.status(200).json(result);
        }
        catch (error) {
            next(error);
        }
    },
    async update(req, res, next) {
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
            // Ownership guard antes de validar body: evita vazar informação sobre o
            // imóvel (shape de erro) pra callers que não são o dono. 404 se não existe
            // (padrão dos outros handlers), 403 se existe mas não é seu.
            const existing = await propertyService_1.propertyService.getPropertyById(id);
            if (!existing) {
                return res.status(404).json({
                    status: 404,
                    code: 'NOT_FOUND',
                    messages: [{ message: 'Property not found' }],
                });
            }
            if (existing.landlordId !== localUser.id) {
                return res.status(403).json({
                    status: 403,
                    code: 'FORBIDDEN',
                    messages: [{ message: 'Only the property owner can update this property.' }],
                });
            }
            const validatedData = propertyValidation_1.updatePropertySchema.parse(req.body);
            const files = req.files;
            const property = await propertyService_1.propertyService.updateProperty(id, validatedData, files);
            if (!property) {
                return res.status(404).json({
                    status: 404,
                    code: 'NOT_FOUND',
                    messages: [{ message: 'Property not found' }]
                });
            }
            return res.status(200).json(property);
        }
        catch (error) {
            if (error instanceof propertyService_1.PropertyError) {
                return res.status(error.httpStatus).json({
                    status: error.httpStatus,
                    code: error.code,
                    messages: [{ message: error.message }],
                });
            }
            next(error);
        }
    },
    async delete(req, res, next) {
        try {
            const { id } = req.params;
            const success = await propertyService_1.propertyService.deleteProperty(id);
            if (!success) {
                return res.status(404).json({
                    status: 404,
                    code: 'NOT_FOUND',
                    messages: [{ message: 'Property not found' }]
                });
            }
            return res.status(204).send();
        }
        catch (error) {
            next(error);
        }
    },
    async moderate(req, res, next) {
        try {
            const { id } = req.params;
            const moderator = req.localUser;
            if (!moderator) {
                return res.status(401).json({
                    status: 401,
                    code: 'UNAUTHORIZED',
                    messages: [{ message: 'Moderator profile not found on request.' }],
                });
            }
            const { decision, reason } = propertyValidation_1.moderatePropertySchema.parse(req.body);
            const property = await propertyService_1.propertyService.moderateProperty(id, decision, moderator.id, reason);
            if (!property) {
                return res.status(404).json({
                    status: 404,
                    code: 'NOT_FOUND',
                    messages: [{ message: 'Property not found' }],
                });
            }
            return res.status(200).json(property);
        }
        catch (error) {
            next(error);
        }
    },
};
