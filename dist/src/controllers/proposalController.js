"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.proposalController = void 0;
const proposalService_1 = require("../services/proposalService");
const proposalValidation_1 = require("../utils/proposalValidation");
function handleProposalError(err, res, next) {
    if (err instanceof proposalService_1.ProposalError) {
        res.status(err.httpStatus).json({
            status: err.httpStatus,
            code: err.code,
            messages: [{ message: err.message }],
        });
        return true;
    }
    next(err);
    return false;
}
exports.proposalController = {
    async create(req, res, next) {
        try {
            const input = proposalValidation_1.createProposalSchema.parse(req.body);
            const proposal = await (0, proposalService_1.createProposal)(input);
            return res.status(201).json(proposal);
        }
        catch (err) {
            if (err instanceof proposalService_1.ProposalError) {
                return handleProposalError(err, res, next);
            }
            next(err);
        }
    },
    async list(req, res, next) {
        try {
            const query = proposalValidation_1.listProposalsQuerySchema.parse(req.query);
            const proposals = await (0, proposalService_1.listProposals)(query);
            return res.status(200).json(proposals);
        }
        catch (err) {
            next(err);
        }
    },
    async getById(req, res, next) {
        try {
            const proposal = await (0, proposalService_1.getProposalById)(req.params.id);
            if (!proposal) {
                return res.status(404).json({
                    status: 404,
                    code: 'NOT_FOUND',
                    messages: [{ message: 'Proposal not found' }],
                });
            }
            return res.status(200).json(proposal);
        }
        catch (err) {
            next(err);
        }
    },
    async updateStatus(req, res, next) {
        try {
            const input = proposalValidation_1.updateProposalStatusSchema.parse(req.body);
            const proposal = await (0, proposalService_1.updateProposalStatus)(req.params.id, input.status);
            if (!proposal) {
                return res.status(404).json({
                    status: 404,
                    code: 'NOT_FOUND',
                    messages: [{ message: 'Proposal not found' }],
                });
            }
            return res.status(200).json(proposal);
        }
        catch (err) {
            next(err);
        }
    }
};
