import { Request, Response, NextFunction } from 'express';
import {
  createProposal,
  listProposals,
  getProposalById,
  updateProposalStatus,
  ProposalError
} from '../services/proposalService';
import {
  createProposalSchema,
  updateProposalStatusSchema,
  listProposalsQuerySchema
} from '../utils/proposalValidation';

function handleProposalError(err: unknown, res: Response, next: NextFunction): boolean {
  if (err instanceof ProposalError) {
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

export const proposalController = {
  async create(req: Request, res: Response, next: NextFunction) {
    try {
      const input = createProposalSchema.parse(req.body);
      const proposal = await createProposal(input);
      return res.status(201).json(proposal);
    } catch (err) {
      if (err instanceof ProposalError) {
        return handleProposalError(err, res, next);
      }
      next(err);
    }
  },

  async list(req: Request, res: Response, next: NextFunction) {
    try {
      const query = listProposalsQuerySchema.parse(req.query);
      const proposals = await listProposals(query);
      return res.status(200).json(proposals);
    } catch (err) {
      next(err);
    }
  },

  async getById(req: Request, res: Response, next: NextFunction) {
    try {
      const proposal = await getProposalById(req.params.id);
      if (!proposal) {
        return res.status(404).json({
          status: 404,
          code: 'NOT_FOUND',
          messages: [{ message: 'Proposal not found' }],
        });
      }
      return res.status(200).json(proposal);
    } catch (err) {
      next(err);
    }
  },

  async updateStatus(req: Request, res: Response, next: NextFunction) {
    try {
      const input = updateProposalStatusSchema.parse(req.body);
      const proposal = await updateProposalStatus(req.params.id, input.status);
      if (!proposal) {
        return res.status(404).json({
          status: 404,
          code: 'NOT_FOUND',
          messages: [{ message: 'Proposal not found' }],
        });
      }
      return res.status(200).json(proposal);
    } catch (err) {
      next(err);
    }
  }
};
