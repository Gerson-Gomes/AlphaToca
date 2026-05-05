import { Request, Response, NextFunction } from 'express';
import {
  createContract,
  getContractById,
  listLandlordTenants,
  listTenantContracts,
  updatePaymentStatus,
  ContractError
} from '../services/contractService';
import {
  createContractSchema,
  updateContractStatusSchema,
  updatePaymentStatusSchema
} from '../utils/contractValidation';

function handleContractError(err: unknown, res: Response, next: NextFunction): boolean {
  if (err instanceof ContractError) {
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

export const contractController = {
  async create(req: Request, res: Response, next: NextFunction) {
    try {
      const input = createContractSchema.parse(req.body);
      const contract = await createContract(input);
      return res.status(201).json(contract);
    } catch (err) {
      if (err instanceof ContractError) {
        return handleContractError(err, res, next);
      }
      next(err);
    }
  },

  async getById(req: Request, res: Response, next: NextFunction) {
    try {
      const contract = await getContractById(req.params.id);
      if (!contract) {
        return res.status(404).json({
          status: 404,
          code: 'NOT_FOUND',
          messages: [{ message: 'Contract not found' }],
        });
      }
      return res.status(200).json(contract);
    } catch (err) {
      next(err);
    }
  },

  async listTenants(req: Request, res: Response, next: NextFunction) {
    try {
      const landlordId = req.query.landlordId as string;
      if (!landlordId) {
        return res.status(400).json({ status: 400, code: 'MISSING_PARAM', messages: [{ message: 'landlordId is required' }] });
      }
      const tenants = await listLandlordTenants(landlordId);
      return res.status(200).json(tenants);
    } catch (err) {
      next(err);
    }
  },

  async listByTenant(req: Request, res: Response, next: NextFunction) {
    try {
      const tenantId = req.params.tenantId;
      const contracts = await listTenantContracts(tenantId);
      return res.status(200).json(contracts);
    } catch (err) {
      next(err);
    }
  },

  async updatePayment(req: Request, res: Response, next: NextFunction) {
    try {
      const input = updatePaymentStatusSchema.parse(req.body);
      const payment = await updatePaymentStatus(req.params.paymentId, input.status, input.paidDate);
      return res.status(200).json(payment);
    } catch (err) {
      next(err);
    }
  }
};
