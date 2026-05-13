"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.visitController = void 0;
const client_1 = require("@prisma/client");
const visitService_1 = require("../services/visitService");
const visitValidation_1 = require("../utils/visitValidation");
// US-012 / Open Question #6: the `ai-agent` scope on the JWT hasn't been
// defined yet. Until it exists, every human caller must be treated as
// lacking it — so source=AI submitted via the public POST /api/visits body
// is downgraded to MANUAL on the server. When the scope lands, replace this
// with a real claim check (e.g., req.localUser.scopes?.includes('ai-agent')).
function callerHasAiAgentScope(_req) {
    return false;
}
function handleVisitError(err, res, next) {
    if (err instanceof visitService_1.VisitError) {
        res.status(err.httpStatus).json({
            status: err.httpStatus,
            code: err.code,
            messages: [{ message: err.code }],
            ...(err.details ? { details: err.details } : {}),
        });
        return true;
    }
    next(err);
    return false;
}
exports.visitController = {
    async create(req, res, next) {
        try {
            const input = visitValidation_1.createVisitSchema.parse(req.body);
            const effectiveSource = callerHasAiAgentScope(req)
                ? input.source
                : client_1.VisitSource.MANUAL;
            const visit = await (0, visitService_1.createVisit)({ ...input, source: effectiveSource });
            return res.status(201).json(visit);
        }
        catch (err) {
            if (err instanceof visitService_1.VisitError) {
                return handleVisitError(err, res, next);
            }
            next(err);
        }
    },
    async list(req, res, next) {
        try {
            const query = visitValidation_1.listVisitsQuerySchema.parse(req.query);
            const visits = await (0, visitService_1.listVisits)(query);
            return res.status(200).json(visits);
        }
        catch (err) {
            next(err);
        }
    },
    async getById(req, res, next) {
        try {
            const visit = await (0, visitService_1.getVisitById)(req.params.id);
            if (!visit) {
                return res.status(404).json({
                    status: 404,
                    code: 'NOT_FOUND',
                    messages: [{ message: 'Visit not found' }],
                });
            }
            return res.status(200).json(visit);
        }
        catch (err) {
            next(err);
        }
    },
    async update(req, res, next) {
        try {
            const input = visitValidation_1.updateVisitSchema.parse(req.body);
            const visit = await (0, visitService_1.updateVisit)(req.params.id, input);
            if (!visit) {
                return res.status(404).json({
                    status: 404,
                    code: 'NOT_FOUND',
                    messages: [{ message: 'Visit not found' }],
                });
            }
            return res.status(200).json(visit);
        }
        catch (err) {
            if (err instanceof visitService_1.VisitError) {
                return handleVisitError(err, res, next);
            }
            next(err);
        }
    },
    async cancel(req, res, next) {
        try {
            const ok = await (0, visitService_1.cancelVisit)(req.params.id);
            if (!ok) {
                return res.status(404).json({
                    status: 404,
                    code: 'NOT_FOUND',
                    messages: [{ message: 'Visit not found' }],
                });
            }
            return res.status(204).send();
        }
        catch (err) {
            next(err);
        }
    },
    async availability(req, res, next) {
        try {
            const query = visitValidation_1.availabilityQuerySchema.parse(req.query);
            const slots = await (0, visitService_1.listAvailableSlots)(query);
            return res.status(200).json(slots);
        }
        catch (err) {
            if (err instanceof visitService_1.VisitError) {
                return handleVisitError(err, res, next);
            }
            next(err);
        }
    },
};
