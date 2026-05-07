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
            isIdentityVerified: {
              type: 'boolean',
              default: false,
              description:
                'LL-017 — flag do "selo verificado" de identidade. Read-only pela API neste epic (sem endpoint PATCH); writable via Prisma Studio/seed enquanto o setter admin está fora de escopo.',
            },
            identityVerifiedAt: {
              type: 'string',
              format: 'date-time',
              nullable: true,
              description: 'Instante em que `isIdentityVerified` foi setado para true. `null` quando ainda não verificado.',
            },
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
            status: {
              type: 'string',
              enum: ['AVAILABLE', 'NEGOTIATING', 'RENTED'],
              default: 'AVAILABLE',
              description:
                'Pode ser alterado como efeito colateral de endpoints do ciclo de locação: criar um Contract (POST /contracts) muda para RENTED; terminar um Contract (PATCH /contracts/{id}/status para TERMINATED/COMPLETED) volta para AVAILABLE; encerrar um RentalProcess em negociação (PATCH /rental-process/{id}/status para CLOSED) também libera para AVAILABLE. Todas as mutações ocorrem na mesma transação da mudança de status do processo/contrato.',
            },
            address: { type: 'string', minLength: 5, example: 'Rua das Flores, 123, São Paulo - SP' },
            type: { type: 'string', enum: ['APARTMENT', 'HOUSE', 'STUDIO', 'CONDO_HOUSE', 'KITNET', 'PENTHOUSE', 'LAND', 'COMMERCIAL'], default: 'APARTMENT' },
            bedrooms: { type: 'integer', minimum: 0, example: 2 },
            bathrooms: { type: 'integer', minimum: 0, example: 1 },
            parkingSpots: { type: 'integer', minimum: 0, example: 1 },
            area: { type: 'number', minimum: 0, example: 65.5 },
            isFurnished: { type: 'boolean', default: false },
            petsAllowed: { type: 'boolean', default: false },
            hasWifi: { type: 'boolean', default: false, description: 'LL-021 — Wi-Fi incluso no imóvel.' },
            hasPool: { type: 'boolean', default: false, description: 'LL-021 — Imóvel possui piscina.' },
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
            currentTenant: {
              type: 'object',
              nullable: true,
              description: 'Inquilino do contrato ACTIVE atualmente vinculado ao imóvel. `null` quando não há contrato ACTIVE.',
              required: ['id', 'name', 'isIdentityVerified', 'identityVerifiedAt'],
              properties: {
                id: { type: 'string', format: 'uuid' },
                name: { type: 'string', example: 'Maria Silva' },
                isIdentityVerified: { type: 'boolean', default: false, description: 'LL-017 — selo verificado.' },
                identityVerifiedAt: { type: 'string', format: 'date-time', nullable: true },
              },
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
          required: ['id', 'propertyId', 'tenantId', 'landlordId', 'startDate', 'endDate', 'monthlyRent', 'dueDay', 'status'],
          description:
            'Contrato de locação. Fonte de verdade do "ciclo ativo" (status=ACTIVE ⇒ Property.status=RENTED). O campo `pdfUrl` (antigo `contractUrl`) armazena o PDF atualmente anexado — vazio enquanto não há documento; `signedAt` marca o upload do PDF assinado via PUT /api/contracts/:id/signed-document (US-016).',
          properties: {
            id: { type: 'string', format: 'uuid' },
            propertyId: { type: 'string', format: 'uuid' },
            tenantId: { type: 'string', format: 'uuid' },
            landlordId: { type: 'string', format: 'uuid' },
            startDate: { type: 'string', format: 'date-time' },
            endDate: { type: 'string', format: 'date-time' },
            monthlyRent: { type: 'number', example: 2500.00 },
            dueDay: { type: 'integer', minimum: 1, maximum: 31 },
            status: { type: 'string', enum: ['ACTIVE', 'TERMINATED', 'COMPLETED'], default: 'ACTIVE' },
            pdfUrl: {
              type: 'string',
              format: 'uri',
              nullable: true,
              description: 'URL do PDF do contrato (quando disponível). Pode ser um path relativo de storage ou uma URL absoluta — clientes devem tratar ambos. `null` enquanto não há documento anexado.',
            },
            signedAt: {
              type: 'string',
              format: 'date-time',
              nullable: true,
              description: 'Instante do upload do PDF assinado. `null` enquanto o landlord ainda não concluiu o ciclo digital.',
            },
            createdAt: { type: 'string', format: 'date-time' },
            updatedAt: { type: 'string', format: 'date-time' },
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
        RentalPayment: {
          type: 'object',
          required: ['propertyId', 'period', 'status'],
          description:
            'Registro mensal do status do aluguel de um imóvel, indexado por (propertyId, period). Usado pelos endpoints GET/PUT /api/properties/{id}/payments/current. Quando ainda não há linha para o mês corrente, a API responde com o default AWAITING sem persistir — a gravação ocorre apenas via PUT (upsert).',
          properties: {
            id: { type: 'string', format: 'uuid' },
            propertyId: { type: 'string', format: 'uuid' },
            period: {
              type: 'string',
              pattern: '^\\d{4}-(0[1-9]|1[0-2])$',
              example: '2026-05',
              description: 'Mês de referência no formato YYYY-MM (servidor define, não vem do cliente).',
            },
            status: {
              type: 'string',
              enum: ['AWAITING', 'PAID', 'LATE'],
              default: 'AWAITING',
            },
            updatedAt: { type: 'string', format: 'date-time', nullable: true },
            updatedBy: { type: 'string', format: 'uuid', nullable: true, description: 'id do usuário (landlord) que atualizou o status; null quando ainda não há registro gravado.' },
          },
        },
        Conversation: {
          type: 'object',
          required: ['id', 'propertyId', 'landlordId', 'tenantId', 'messages', 'createdAt'],
          description:
            'Thread de chat canônica entre um (landlord, tenant) em torno de um Property. O `id` é a referência estável usada pelo frontend (substitui os ids sintéticos antigos `property-<pid>-tenant-<tid>`). Resolvida via GET /api/conversations/resolve (US-012), que faz upsert na chave composta (propertyId, landlordId, tenantId). `messages` é sempre `[]` neste PRD — mensagens de chat estão fora do escopo (futura tabela dedicada).',
          properties: {
            id: { type: 'string', format: 'uuid' },
            propertyId: { type: 'string', format: 'uuid' },
            landlordId: { type: 'string', format: 'uuid' },
            tenantId: { type: 'string', format: 'uuid' },
            messages: {
              type: 'array',
              description: 'Placeholder — sempre vazio enquanto o histórico de mensagens não for persistido nesta tabela.',
              items: { type: 'object' },
              example: [],
            },
            createdAt: { type: 'string', format: 'date-time' },
          },
        },
        SupportTicket: {
          type: 'object',
          required: ['id', 'code', 'title', 'description', 'userId', 'userName', 'userRole', 'status', 'createdAt', 'updatedAt'],
          description:
            'Ticket de suporte aberto por um usuário final (tenant/landlord) ou por um admin. `code` é o protocolo humano SUP-AAMMDD-XXXX gerado no POST (US-018). `userRole` captura o role no momento da abertura — mesmo que o role do usuário mude depois, o valor aqui preserva o contexto. `resolution` é preenchido pelo admin quando o status transiciona para RESOLVED via PUT /api/admin/support/tickets/{id} (US-020).',
          properties: {
            id: { type: 'string', format: 'uuid' },
            code: {
              type: 'string',
              pattern: '^SUP-\\d{6}-[A-Z0-9]{4}$',
              example: 'SUP-260507-A3F2',
              description: 'Protocolo humano no formato SUP-AAMMDD-XXXX (AAMMDD = data do servidor, XXXX = 4 chars base36 upper).',
            },
            title: { type: 'string', minLength: 1, maxLength: 120, example: 'App trava ao enviar foto' },
            description: { type: 'string', minLength: 1, maxLength: 4000 },
            userId: { type: 'string', format: 'uuid' },
            userName: { type: 'string', example: 'Maria Silva' },
            userRole: { type: 'string', enum: ['TENANT', 'LANDLORD', 'ADMIN'] },
            status: { type: 'string', enum: ['OPEN', 'RESOLVED'], default: 'OPEN' },
            resolution: { type: 'string', nullable: true, maxLength: 4000 },
            assignedToId: { type: 'string', format: 'uuid', nullable: true },
            createdAt: { type: 'string', format: 'date-time' },
            updatedAt: { type: 'string', format: 'date-time' },
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

