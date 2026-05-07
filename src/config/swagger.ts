import swaggerJsdoc from 'swagger-jsdoc';
import swaggerUi from 'swagger-ui-express';
import { Express } from 'express';

const options: swaggerJsdoc.Options = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'AlphaToca API',
      version: '1.0.0',
      description: 'API para gestão imobiliária e integração com IA conversacional',
      contact: {
        name: 'Suporte AlphaToca',
      },
    },
    servers: [
      {
        url: 'https://lab.alphaedtech.org.br/server01',
        description: 'Servidor de Produção (Lab)',
      },
      {
        url: 'http://localhost:3000/api',
        description: 'Servidor de Desenvolvimento',
      },
    ],
    components: {
      schemas: {
        User: {
          type: 'object',
          required: ['name', 'email', 'phoneNumber'],
          properties: {
            id: { type: 'string', format: 'uuid', example: '550e8400-e29b-41d4-a716-446655440000' },
            name: { type: 'string', minLength: 2, example: 'João Silva' },
            email: { type: 'string', format: 'email', example: 'joao.silva@example.com' },
            phoneNumber: {
              type: 'string',
              pattern: '^\\+?[1-9]\\d{1,14}$',
              example: '+5511999999999',
              description: 'Número de telefone no formato E.164'
            },
            role: { type: 'string', enum: ['TENANT', 'LANDLORD', 'ADMIN'], default: 'TENANT' },
            createdAt: { type: 'string', format: 'date-time' },
          },
        },
        PropertyImage: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            propertyId: { type: 'string', format: 'uuid' },
            url: { type: 'string', example: '/uploads/550e8400-e29b-41d4-a716-446655440000/3fa85f64-5717-4562-b3fc-2c963f66afa6.jpg' },
            isCover: { type: 'boolean', default: false },
            caption: { type: 'string', nullable: true, example: 'Sala de Estar' },
            createdAt: { type: 'string', format: 'date-time' },
          },
        },
        Property: {
          type: 'object',
          required: ['landlordId', 'title', 'description', 'price', 'address'],
          properties: {
            id: { type: 'string', format: 'uuid' },
            landlordId: { type: 'string', format: 'uuid' },
            title: { type: 'string', minLength: 3, example: 'Apartamento Decorado Centro' },
            description: { type: 'string', minLength: 10, example: 'Lindo apartamento com 2 quartos e varanda gourmet.' },
            price: { type: 'number', minimum: 0, example: 2500.00 },
            status: { type: 'string', enum: ['AVAILABLE', 'IN_NEGOTIATION', 'RENTED'], default: 'AVAILABLE' },
            address: { type: 'string', minLength: 5, example: 'Rua das Flores, 123, São Paulo - SP' },
            type: { type: 'string', enum: ['APARTMENT', 'HOUSE', 'STUDIO', 'CONDO_HOUSE'], default: 'APARTMENT' },
            bedrooms: { type: 'integer', minimum: 0, example: 2 },
            bathrooms: { type: 'integer', minimum: 0, example: 1 },
            parkingSpots: { type: 'integer', minimum: 0, example: 1 },
            area: { type: 'number', minimum: 0, example: 65.5 },
            isFurnished: { type: 'boolean', default: false },
            petsAllowed: { type: 'boolean', default: false },
            latitude: { type: 'number', example: -23.5489 },
            longitude: { type: 'number', example: -46.6388 },
            nearSubway: { type: 'boolean', default: false },
            isFeatured: { type: 'boolean', default: false },
            views: { type: 'integer', default: 0 },
            condoFee: { type: 'number', example: 500.00 },
            propertyTax: { type: 'number', example: 150.00 },
            createdAt: { type: 'string', format: 'date-time' },
            images: {
              type: 'array',
              description: 'Fotos da propriedade. A primeira foto enviada é marcada como capa (isCover=true).',
              items: { $ref: '#/components/schemas/PropertyImage' },
            },
          },
        },
        WhatsAppPayload: {
          type: 'object',
          properties: {
            object: { type: 'string', example: 'whatsapp_business_account' },
            entry: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  id: { type: 'string' },
                  changes: {
                    type: 'array',
                    items: {
                      type: 'object',
                      properties: {
                        value: {
                          type: 'object',
                          properties: {
                            messaging_product: { type: 'string', example: 'whatsapp' },
                            metadata: { type: 'object' },
                            contacts: { type: 'array', items: { type: 'object' } },
                            messages: { type: 'array', items: { type: 'object' } },
                          }
                        },
                        field: { type: 'string', example: 'messages' }
                      }
                    }
                  }
                }
              }
            }
          }
        },
        Proposal: {
          type: 'object',
          required: ['tenantId', 'propertyId', 'proposedPrice'],
          properties: {
            id: { type: 'string', format: 'uuid' },
            tenantId: { type: 'string', format: 'uuid' },
            propertyId: { type: 'string', format: 'uuid' },
            proposedPrice: { type: 'number', minimum: 0, example: 2400.00 },
            status: { type: 'string', enum: ['PENDING', 'ACCEPTED', 'REJECTED', 'COUNTER_OFFER', 'WITHDRAWN'], default: 'PENDING' },
            message: { type: 'string', example: 'Tenho interesse imediato, gostaria de propor este valor.' },
            createdAt: { type: 'string', format: 'date-time' },
            updatedAt: { type: 'string', format: 'date-time' },
          },
        },
        Contract: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            propertyId: { type: 'string', format: 'uuid' },
            tenantId: { type: 'string', format: 'uuid' },
            landlordId: { type: 'string', format: 'uuid' },
            startDate: { type: 'string', format: 'date-time' },
            endDate: { type: 'string', format: 'date-time' },
            monthlyRent: { type: 'number' },
            dueDay: { type: 'integer' },
            status: { type: 'string', enum: ['ACTIVE', 'TERMINATED', 'COMPLETED'] },
            contractUrl: { type: 'string', format: 'uri' },
          },
        },
        TenantPayment: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            contractId: { type: 'string', format: 'uuid' },
            amount: { type: 'number' },
            dueDate: { type: 'string', format: 'date-time' },
            paidDate: { type: 'string', format: 'date-time', nullable: true },
            status: { type: 'string', enum: ['PENDING', 'PAID', 'OVERDUE', 'CANCELLED'] },
          },
        },
        ErrorResponse: {
          type: 'object',
          properties: {
            status: { type: 'integer', example: 400 },
            code: { type: 'string', example: 'VALIDATION_ERROR' },
            messages: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  path: { type: 'string', example: 'name' },
                  message: { type: 'string', example: 'Name must be at least 2 characters' }
                }
              }
            }
          }
        }
      },
    },
  },
  apis: ['./src/routes/*.ts'],
};

const specs = swaggerJsdoc(options);

export const setupSwagger = (app: Express) => {
  // Montamos em '/docs/' (com a barra final) para evitar que o swagger-ui-express
  // emita um redirect 301 absoluto de '/docs' -> '/docs/' que quebra por trás de
  // um reverse proxy com prefixo (ex: Nginx /server01/).
  // Com a barra final o Express não faz o redirect e o Swagger já carrega direto.
  app.use(
    '/docs',
    swaggerUi.serve,
    swaggerUi.setup(specs, {
      // Força os assets (CSS/JS do Swagger UI) a usarem caminhos relativos,
      // necessário quando a app está servida sob um subpath via proxy.
      customJs: undefined,
      swaggerOptions: {
        persistAuthorization: true,
      },
    }),
  );
  console.log('[swagger]: Documentação disponível em /docs');
};

