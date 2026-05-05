import { Router } from 'express';
import { favoriteController } from '../controllers/favoriteController';

const router = Router();

/**
 * @swagger
 * /favorites:
 *   post:
 *     summary: Adiciona um imóvel aos favoritos do usuário
 *     tags: [Favoritos]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [propertyId]
 *             properties:
 *               propertyId: { type: 'string', format: 'uuid' }
 *     responses:
 *       201:
 *         description: Favorito adicionado
 */
router.post('/favorites', favoriteController.add);

/**
 * @swagger
 * /favorites:
 *   get:
 *     summary: Lista todos os imóveis favoritos do usuário logado
 *     tags: [Favoritos]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Lista de favoritos
 */
router.get('/favorites', favoriteController.list);

/**
 * @swagger
 * /favorites/{propertyId}:
 *   delete:
 *     summary: Remove um imóvel dos favoritos
 *     tags: [Favoritos]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: propertyId
 *         required: true
 *         schema: { type: 'string', format: 'uuid' }
 *     responses:
 *       204:
 *         description: Favorito removido
 */
router.delete('/favorites/:propertyId', favoriteController.remove);

/**
 * @swagger
 * /favorites/{propertyId}/check:
 *   get:
 *     summary: Verifica se um imóvel específico está nos favoritos do usuário
 *     tags: [Favoritos]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: propertyId
 *         required: true
 *         schema: { type: 'string', format: 'uuid' }
 *     responses:
 *       200:
 *         description: Status do favorito
 */
router.get('/favorites/:propertyId/check', favoriteController.check);

export default router;
