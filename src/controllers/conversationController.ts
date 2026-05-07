import { Request, Response, NextFunction } from 'express';
import { propertyService } from '../services/propertyService';
import { conversationService } from '../services/conversationService';
import { resolveConversationQuerySchema } from '../utils/conversationValidation';

export const conversationController = {
  /**
   * GET /api/conversations/resolve?propertyId=<uuid>&tenantId=<uuid>
   *
   * Resolve a thread canônica (create-or-get atômico) entre o landlord dono do
   * imóvel e o tenant indicado. O `landlordId` NUNCA vem da query — é derivado
   * do Property.landlordId para impedir que um caller forje uma thread com um
   * landlord diferente do real dono (isso criaria linhas órfãs na tabela
   * conversations e divergência com a UI, que mostra landlordId pelo imóvel).
   *
   * Ordem dos guards:
   *   1. 401 se não autenticado — nunca toca no banco para ids anônimos.
   *   2. 400 se query params inválidos (UUID check via Zod).
   *   3. 404 se o imóvel não existe (antes de checar autorização, para não
   *      vazar existência de imóveis a não-donos).
   *   4. 403 se o caller não é nem o landlord do imóvel nem o tenant da query.
   *   5. 200 com o upsert resultante — mesmo id em chamadas subsequentes com
   *      os mesmos parâmetros (garantia via índice único).
   */
  async resolve(req: Request, res: Response, next: NextFunction) {
    try {
      const localUser = req.localUser;
      if (!localUser) {
        return res.status(401).json({
          status: 401,
          code: 'UNAUTHORIZED',
          messages: [{ message: 'Authentication required.' }],
        });
      }

      const { propertyId, tenantId } = resolveConversationQuerySchema.parse(req.query);

      const property = await propertyService.getPropertyById(propertyId);
      if (!property) {
        return res.status(404).json({
          status: 404,
          code: 'NOT_FOUND',
          messages: [{ message: 'Property not found' }],
        });
      }

      const isLandlord = localUser.id === property.landlordId;
      const isTenant = localUser.id === tenantId;
      if (!isLandlord && !isTenant) {
        return res.status(403).json({
          status: 403,
          code: 'FORBIDDEN',
          messages: [
            {
              message:
                'Only the property owner or the specified tenant can resolve this conversation.',
            },
          ],
        });
      }

      const conversation = await conversationService.resolve(
        propertyId,
        property.landlordId,
        tenantId,
      );
      return res.status(200).json(conversation);
    } catch (error) {
      next(error);
    }
  },
};
