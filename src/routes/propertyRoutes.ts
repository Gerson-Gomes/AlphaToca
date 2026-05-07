import { Router } from 'express';
import { propertyController } from '../controllers/propertyController';
import { rentalPaymentController } from '../controllers/rentalPaymentController';
import {
  authSyncMiddleware,
  checkJwt,
  requireRole,
} from '../middlewares/authMiddleware';
import {
  conditionalPropertyPhotoUploadHandler,
  propertyPhotoUploadHandler,
} from '../middlewares/uploadMiddleware';

const router = Router();

const adminAuthStack = [checkJwt, authSyncMiddleware, requireRole('ADMIN')];
const authStack = [checkJwt, authSyncMiddleware];

/**
 * @swagger
 * /properties:
 *   post:
 *     summary: Criar uma nova propriedade (com upload opcional de fotos)
 *     description: |
 *       Aceita dois formatos de request:
 *       - `application/json` — cria a propriedade sem fotos (`images: []` na resposta).
 *       - `multipart/form-data` — cria a propriedade e envia até 20 fotos (JPEG ou PNG, 10MB cada) no campo `photos`.
 *         A primeira foto enviada é automaticamente marcada como capa (`isCover=true`).
 *     tags: [Propriedades]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [landlordId, title, description, price, address]
 *             properties:
 *               landlordId:
 *                 type: string
 *                 format: uuid
 *               title:
 *                 type: string
 *               description:
 *                 type: string
 *               price:
 *                 type: number
 *               address:
 *                 type: string
 *                 minLength: 5
 *                 example: Rua das Flores, 123, São Paulo - SP
 *               type:
 *                 type: string
 *                 enum: [APARTMENT, HOUSE, STUDIO, CONDO_HOUSE]
 *               bedrooms:
 *                 type: integer
 *                 example: 2
 *               bathrooms:
 *                 type: integer
 *                 example: 1
 *               parkingSpots:
 *                 type: integer
 *                 example: 1
 *               area:
 *                 type: number
 *                 example: 65.5
 *               isFurnished:
 *                 type: boolean
 *                 example: false
 *               petsAllowed:
 *                 type: boolean
 *                 example: true
 *               latitude:
 *                 type: number
 *                 example: -23.5489
 *               longitude:
 *                 type: number
 *                 example: -46.6388
 *               nearSubway:
 *                 type: boolean
 *                 example: false
 *               isFeatured:
 *                 type: boolean
 *                 example: false
 *               views:
 *                 type: integer
 *                 example: 150
 *               condoFee:
 *                 type: number
 *                 example: 500.00
 *               propertyTax:
 *                 type: number
 *                 example: 150.00
 *               status:
 *                 type: string
 *                 enum: [AVAILABLE, NEGOTIATING, RENTED]
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             required: [landlordId, title, description, price, address]
 *             properties:
 *               landlordId:
 *                 type: string
 *                 format: uuid
 *               title:
 *                 type: string
 *               description:
 *                 type: string
 *               price:
 *                 type: number
 *               address:
 *                 type: string
 *                 minLength: 5
 *                 example: Rua das Flores, 123, São Paulo - SP
 *               type:
 *                 type: string
 *                 enum: [APARTMENT, HOUSE, STUDIO, CONDO_HOUSE]
 *               bedrooms:
 *                 type: integer
 *                 example: 2
 *               bathrooms:
 *                 type: integer
 *                 example: 1
 *               parkingSpots:
 *                 type: integer
 *                 example: 1
 *               area:
 *                 type: number
 *                 example: 65.5
 *               isFurnished:
 *                 type: boolean
 *                 example: false
 *               petsAllowed:
 *                 type: boolean
 *                 example: true
 *               latitude:
 *                 type: number
 *                 example: -23.5489
 *               longitude:
 *                 type: number
 *                 example: -46.6388
 *               nearSubway:
 *                 type: boolean
 *                 example: false
 *               isFeatured:
 *                 type: boolean
 *                 example: false
 *               views:
 *                 type: integer
 *                 example: 150
 *               condoFee:
 *                 type: number
 *                 example: 500.00
 *               propertyTax:
 *                 type: number
 *                 example: 150.00
 *               status:
 *                 type: string
 *                 enum: [AVAILABLE, NEGOTIATING, RENTED]
 *               photos:
 *                 type: array
 *                 maxItems: 20
 *                 description: |
 *                   Arquivos de imagem (JPEG ou PNG). Máximo 20 arquivos, 10MB cada.
 *                   A primeira foto enviada será marcada como capa (`isCover=true`).
 *                 items:
 *                   type: string
 *                   format: binary
 *     responses:
 *       201:
 *         description: Propriedade criada com sucesso. Quando enviada via multipart/form-data, `images` contém o array de fotos persistidas (com `isCover=true` na primeira). Quando enviada via application/json sem fotos, `images` é `[]`.
 *         content:
 *           application/json:
 *             schema:
 *               allOf:
 *                 - $ref: '#/components/schemas/Property'
 *                 - type: object
 *                   properties:
 *                     images:
 *                       type: array
 *                       items:
 *                         $ref: '#/components/schemas/PropertyImage'
 *       400:
 *         description: |
 *           Erro de validação ou de upload. O corpo usa o formato padrão `ErrorResponse` (`{ status, code, messages }`). Códigos possíveis:
 *           - `VALIDATION_ERROR` — campos do formulário inválidos (Zod).
 *           - `FILE_TOO_LARGE` — algum arquivo excede 10MB.
 *           - `TOO_MANY_FILES` — mais de 20 fotos enviadas.
 *           - `INVALID_FILE_TYPE` — tipo MIME não é image/jpeg nem image/png.
 *           - `UNEXPECTED_FILE_FIELD` — campo de arquivo diferente de `photos`.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *             examples:
 *               validation:
 *                 summary: Campos inválidos
 *                 value: { status: 400, code: 'VALIDATION_ERROR', messages: [{ path: 'price', message: 'Expected number, received string' }] }
 *               fileTooLarge:
 *                 summary: Arquivo maior que 10MB
 *                 value: { status: 400, code: 'FILE_TOO_LARGE', messages: [{ message: 'Arquivo excede 10MB' }] }
 *               tooManyFiles:
 *                 summary: Mais de 20 fotos
 *                 value: { status: 400, code: 'TOO_MANY_FILES', messages: [{ message: 'Máximo de 20 fotos por propriedade' }] }
 *               invalidFileType:
 *                 summary: Tipo de arquivo não suportado
 *                 value: { status: 400, code: 'INVALID_FILE_TYPE', messages: [{ message: 'Apenas JPEG ou PNG são aceitos' }] }
 *       500:
 *         description: Erro interno do servidor
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
router.post('/properties', propertyPhotoUploadHandler, propertyController.create);

router.get('/properties', propertyController.list);

/**
 * @swagger
 * /properties/search:
 *   get:
 *     summary: Busca avançada de propriedades com filtros e paginação
 *     tags: [Propriedades]
 *     parameters:
 *       - in: query
 *         name: type
 *         schema:
 *           type: string
 *           enum: [APARTMENT, HOUSE, STUDIO, CONDO_HOUSE]
 *       - in: query
 *         name: minPrice
 *         schema:
 *           type: number
 *       - in: query
 *         name: maxPrice
 *         schema:
 *           type: number
 *       - in: query
 *         name: minBedrooms
 *         schema:
 *           type: integer
 *       - in: query
 *         name: minBathrooms
 *         schema:
 *           type: integer
 *       - in: query
 *         name: minParkingSpots
 *         schema:
 *           type: integer
 *       - in: query
 *         name: minArea
 *         schema:
 *           type: number
 *       - in: query
 *         name: maxArea
 *         schema:
 *           type: number
 *       - in: query
 *         name: isFurnished
 *         schema:
 *           type: boolean
 *       - in: query
 *         name: petsAllowed
 *         schema:
 *           type: boolean
 *       - in: query
 *         name: nearSubway
 *         schema:
 *           type: boolean
 *       - in: query
 *         name: landlordId
 *         description: Filtra imóveis por locador (UUID). Exibe todos os status do proprietário.
 *         schema:
 *           type: string
 *           format: uuid
 *       - in: query
 *         name: tenantId
 *         description: Filtra imóveis nos quais o inquilino tem visita agendada (UUID).
 *         schema:
 *           type: string
 *           format: uuid
 *       - in: query
 *         name: orderBy
 *         schema:
 *           type: string
 *           enum: [createdAt, views, priceAsc, priceDesc, isFeatured, nearest]
 *       - in: query
 *         name: lat
 *         description: Latitude do usuário para busca por proximidade
 *         schema:
 *           type: number
 *       - in: query
 *         name: lng
 *         description: Longitude do usuário para busca por proximidade
 *         schema:
 *           type: number
 *       - in: query
 *         name: radius
 *         description: Raio de busca em quilômetros
 *         schema:
 *           type: number
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           default: 1
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 10
 *     responses:
 *       200:
 *         description: Resultados da busca
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 data:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/Property'
 *                 meta:
 *                   type: object
 *                   properties:
 *                     total:
 *                       type: integer
 *                     page:
 *                       type: integer
 *                     limit:
 *                       type: integer
 *                     totalPages:
 *                       type: integer
 *       500:
 *         description: Erro interno do servidor
 */
router.get('/properties/search', propertyController.search);

/**
 * @swagger
 * /properties/{id}/moderation:
 *   put:
 *     summary: Aprovar ou rejeitar um anúncio (somente ADMIN)
 *     tags: [Propriedades, Admin]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [decision]
 *             properties:
 *               decision:
 *                 type: string
 *                 enum: [APPROVED, REJECTED]
 *               reason:
 *                 type: string
 *                 description: Obrigatório quando decision=REJECTED
 *     responses:
 *       200:
 *         description: Status de moderação atualizado
 *       400:
 *         description: Payload inválido
 *       401:
 *         description: Token ausente ou inválido
 *       403:
 *         description: Usuário sem role ADMIN
 *       404:
 *         description: Propriedade não encontrada
 */
router.put('/properties/:id/moderation', ...adminAuthStack, propertyController.moderate);

/**
 * @swagger
 * /properties/{id}/payments/current:
 *   get:
 *     summary: Status do aluguel do mês corrente
 *     description: |
 *       Retorna o status do pagamento de aluguel para o mês corrente (YYYY-MM
 *       calculado no servidor — o cliente nunca informa período). Apenas o
 *       locador dono do imóvel pode ler — outros usuários autenticados recebem
 *       403; anônimos recebem 401.
 *
 *       Quando ainda não há linha em `rental_payments` para (propertyId, period),
 *       a resposta usa a MESMA forma do caminho "linha existe" com
 *       `status=AWAITING` e `updatedAt/updatedBy=null` — sem persistir nada.
 *       A gravação só acontece via `PUT /payments/current` (US-010, upsert).
 *     tags: [Propriedades, Pagamentos]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     responses:
 *       200:
 *         description: Status do aluguel do mês corrente (linha existente ou default AWAITING).
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               required: [period, status, amount, updatedAt, updatedBy]
 *               properties:
 *                 period:
 *                   type: string
 *                   pattern: '^\d{4}-(0[1-9]|1[0-2])$'
 *                   example: '2026-05'
 *                 status:
 *                   type: string
 *                   enum: [AWAITING, PAID, LATE]
 *                 amount:
 *                   type: number
 *                   format: float
 *                   nullable: true
 *                   description: |
 *                     Valor do aluguel em BRL, snapshot do Contract.monthlyRent
 *                     ACTIVE no momento da gravação. `null` quando não há contrato
 *                     ativo no write OU quando a linha pré-existia ao backfill
 *                     best-effort (LL-003).
 *                 updatedAt:
 *                   type: string
 *                   format: date-time
 *                   nullable: true
 *                 updatedBy:
 *                   type: string
 *                   format: uuid
 *                   nullable: true
 *       401:
 *         description: Token ausente ou inválido
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       403:
 *         description: Usuário autenticado não é o dono do imóvel
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       404:
 *         description: Propriedade não encontrada
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
router.get(
  '/properties/:id/payments/current',
  ...authStack,
  rentalPaymentController.getCurrent,
);

/**
 * @swagger
 * /properties/{id}/payments/current:
 *   put:
 *     summary: Atualiza o status do aluguel do mês corrente
 *     description: |
 *       Upsert do status do aluguel para o imóvel indicado no mês corrente
 *       (YYYY-MM calculado no servidor — o cliente NUNCA informa período,
 *       para bloquear edições retroativas via API). Apenas o locador dono
 *       do imóvel pode gravar — outros usuários autenticados recebem 403;
 *       anônimos recebem 401.
 *
 *       O campo `updatedBy` é gravado a partir do `req.localUser.id` (JWT →
 *       authSyncMiddleware); `updatedAt` é gerenciado pelo Prisma. A resposta
 *       tem a MESMA forma de `GET /payments/current`, para reaproveitar o
 *       renderer no frontend.
 *     tags: [Propriedades, Pagamentos]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [status]
 *             properties:
 *               status:
 *                 type: string
 *                 enum: [AWAITING, PAID, LATE]
 *                 description: |
 *                   Novo status do aluguel. Valores fora do enum retornam 400
 *                   `VALIDATION_ERROR`. `period` NÃO é aceito no body — o
 *                   servidor sempre usa o mês corrente.
 *     responses:
 *       200:
 *         description: Status atualizado; resposta na mesma forma do GET.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               required: [period, status, amount, updatedAt, updatedBy]
 *               properties:
 *                 period:
 *                   type: string
 *                   pattern: '^\d{4}-(0[1-9]|1[0-2])$'
 *                   example: '2026-05'
 *                 status:
 *                   type: string
 *                   enum: [AWAITING, PAID, LATE]
 *                 amount:
 *                   type: number
 *                   format: float
 *                   nullable: true
 *                   description: |
 *                     Valor do aluguel em BRL, snapshot do Contract.monthlyRent
 *                     ACTIVE no momento da gravação. `null` quando não há contrato
 *                     ativo no write OU quando a linha pré-existia ao backfill
 *                     best-effort (LL-003).
 *                 updatedAt:
 *                   type: string
 *                   format: date-time
 *                   nullable: true
 *                 updatedBy:
 *                   type: string
 *                   format: uuid
 *                   nullable: true
 *       400:
 *         description: Body inválido (status fora do enum, JSON malformado, etc.)
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       401:
 *         description: Token ausente ou inválido
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       403:
 *         description: Usuário autenticado não é o dono do imóvel
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       404:
 *         description: Propriedade não encontrada
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
router.put(
  '/properties/:id/payments/current',
  ...authStack,
  rentalPaymentController.updateCurrent,
);

/**
 * @swagger
 * /properties/{id}:
 *   get:
 *     summary: Recuperar uma propriedade pelo ID
 *     tags: [Propriedades]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     responses:
 *       200:
 *         description: Propriedade encontrada
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Property'
 *       404:
 *         description: Propriedade não encontrada
 *       500:
 *         description: Erro interno do servidor
 */
router.get('/properties/:id', propertyController.getById);

/**
 * @swagger
 * /properties/{id}:
 *   put:
 *     summary: Atualizar uma propriedade (JSON ou multipart/form-data com fotos)
 *     description: |
 *       Aceita dois formatos de request:
 *       - `application/json` — atualiza apenas campos escalares; fotos existentes ficam intactas.
 *       - `multipart/form-data` — atualiza campos escalares e envia novas fotos no campo `photos`
 *         (JPEG ou PNG, máximo 10MB por arquivo, até 20 arquivos por request).
 *
 *       Apenas o locador dono do imóvel pode atualizar — qualquer outro usuário recebe 403 FORBIDDEN.
 *       A primeira foto nova só é marcada como capa (`isCover=true`) se o imóvel ainda não tiver capa;
 *       caso contrário, todas as novas fotos são salvas com `isCover=false` (nenhuma substituição silenciosa).
 *
 *       Para remover fotos existentes no mesmo request, envie `photosToRemove` (campo repetido no
 *       multipart) com a URL exata de cada foto a remover (ex. `/uploads/<id>/<file>.jpg`). URLs que
 *       não pertencem ao imóvel sendo editado retornam 400 `VALIDATION_ERROR` (nunca 404, para não
 *       vazar existência de fotos de outros imóveis). Se a capa for removida, a foto existente mais
 *       antiga é promovida automaticamente (`isCover=true`) na mesma transação.
 *     tags: [Propriedades]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/Property'
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             properties:
 *               title:
 *                 type: string
 *               description:
 *                 type: string
 *               price:
 *                 type: number
 *               address:
 *                 type: string
 *               city:
 *                 type: string
 *               state:
 *                 type: string
 *               zipCode:
 *                 type: string
 *               status:
 *                 type: string
 *                 enum: [AVAILABLE, NEGOTIATING, RENTED]
 *               photos:
 *                 type: array
 *                 maxItems: 20
 *                 description: |
 *                   Arquivos de imagem (JPEG ou PNG). Máximo 20 arquivos, 10MB cada.
 *                   A primeira foto nova será marcada como capa apenas se o imóvel ainda
 *                   não tiver uma capa — nunca substitui a capa existente silenciosamente.
 *                 items:
 *                   type: string
 *                   format: binary
 *               photosToRemove:
 *                 type: array
 *                 description: |
 *                   URLs de fotos existentes a remover (campo repetido no multipart). Cada URL deve
 *                   pertencer AO IMÓVEL sendo editado — URLs de outras propriedades retornam 400
 *                   `VALIDATION_ERROR`. Processado antes da inserção de novas fotos; se a capa for
 *                   removida, a foto existente mais antiga é promovida a capa automaticamente.
 *                 items:
 *                   type: string
 *                   format: uri
 *     responses:
 *       200:
 *         description: |
 *           Propriedade atualizada com sucesso. Quando enviada via multipart com fotos, `images`
 *           contém a lista completa atualizada (existentes + novas).
 *         content:
 *           application/json:
 *             schema:
 *               allOf:
 *                 - $ref: '#/components/schemas/Property'
 *                 - type: object
 *                   properties:
 *                     images:
 *                       type: array
 *                       items:
 *                         $ref: '#/components/schemas/PropertyImage'
 *       400:
 *         description: |
 *           Erro de validação ou de upload. O corpo usa o formato padrão `ErrorResponse`.
 *           Códigos possíveis: `VALIDATION_ERROR`, `FILE_TOO_LARGE`, `TOO_MANY_FILES`,
 *           `INVALID_FILE_TYPE`, `UNEXPECTED_FILE_FIELD`.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       401:
 *         description: Token ausente ou inválido
 *       403:
 *         description: Usuário autenticado não é o dono do imóvel
 *       404:
 *         description: Propriedade não encontrada
 *       500:
 *         description: Erro interno do servidor
 */
router.put(
  '/properties/:id',
  ...authStack,
  conditionalPropertyPhotoUploadHandler,
  propertyController.update,
);

/**
 * @swagger
 * /properties/{id}:
 *   delete:
 *     summary: Deletar uma propriedade
 *     tags: [Propriedades]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     responses:
 *       204:
 *         description: Propriedade deletada com sucesso
 *       404:
 *         description: Propriedade não encontrada
 *       500:
 *         description: Erro interno do servidor
 */
router.delete('/properties/:id', propertyController.delete);

export default router;
