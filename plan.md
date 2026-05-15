# AlphaToca Backend - Plano de Tarefas

Abaixo estão as tarefas pendentes necessárias para concluir o projeto backend AlphaToca, com base na definição do produto, stack tecnológica atual e base de código existente. Estas tarefas seguem as diretrizes no `conductor/workflow.md` e podem ser facilmente transformadas em cards do Jira.

## Fase 1: Fundação de Webhooks e Jobs em Segundo Plano
- [ ] Tarefa 1.1: Implementar validação de schema com Zod para os payloads dos incoming Webhooks do WhatsApp no `webhookController.ts`.
- [ ] Tarefa 1.2: Configurar conexão com o Redis e estruturar uma Fila do BullMQ para lidar com as mensagens recebidas do WhatsApp.
- [ ] Tarefa 1.3: Refatorar o `webhookController.ts` para enviar as mensagens válidas recebidas para a Fila do BullMQ e retornar um 200 OK imediato.
- [ ] Tarefa 1.4: Implementar o esqueleto do Worker do BullMQ no `workers/whatsappWorker.ts` para processar os jobs da fila.
- [ ] Tarefa 1.5: Escrever testes unitários para a validação do webhook e agendamento dos jobs na fila.

## Fase 2: Serviço de Envio de Mensagens (WhatsApp Outbound)
- [ ] Tarefa 2.1: Implementar o serviço de integração com a Cloud API do WhatsApp para enviar mensagens de texto (outbound).
- [ ] Tarefa 2.2: Implementar tratativa de erros para envios de mensagens (ex: rate limits ou números inválidos).
- [ ] Tarefa 2.3: Integrar o serviço de envio de mensagens no `whatsappWorker.ts` para permitir que o bot responda ou faça eco.
- [ ] Tarefa 2.4: Escrever testes unitários ou mocks para o serviço do WhatsApp.

## Fase 3: Gerenciamento do Estado da Conversa (Banco de Dados)
- [ ] Tarefa 3.1: Implementar funções de repositório para criar/buscar `User`s pelo `phoneNumber` (número de telefone).
- [ ] Tarefa 3.2: Implementar lógica para criar ou retomar a `ChatSession` ativa de um determinado `tenantId`.
- [ ] Tarefa 3.3: Salvar mensagens recebidas do WhatsApp no modelo `Message` associado à `ChatSession` atual do usuário.
- [ ] Tarefa 3.4: Salvar respostas do bot no modelo `Message`.
- [ ] Tarefa 3.5: Escrever testes unitários para as operações de repositório de ChatSession e Message.

## Fase 4: Sistema RAG e Base de Conhecimento (LangChain + pgvector)
- [ ] Tarefa 4.1: Escrever um script de seeder para popular `KnowledgeDocument` com FAQs/diretrizes base e gerar embeddings usando o LangChain.
- [ ] Tarefa 4.2: Implementar um retriever de VectorStore do LangChain usando Prisma e `pgvector` para encontrar `KnowledgeDocument`s semelhantes.
- [ ] Tarefa 4.3: Criar um Conversational Retrieval Chain no LangChain que combine o histórico de chat (do modelo `Message`) e o contexto recuperado (RAG).
- [ ] Tarefa 4.4: Integrar a resposta do LangChain diretamente ao `whatsappWorker.ts` para gerar e enviar a resposta IA para o usuário.

## Fase 5: Qualificação de Leads e Extração de Insights
- [ ] Tarefa 5.1: Configurar a estruturação e parse do output (structured output) no LangChain para extrair intenções e chaves essenciais dos usuários (ex: orçamento de locação, bairro desejado).
- [ ] Tarefa 5.2: Implementar lógica de criação ou atualização de um `RentalProcess` (processo de locação) com base na intenção do usuário.
- [ ] Tarefa 5.3: Salvar as informações extraídas em `AiExtractedInsight` atrelado ao `RentalProcess` do usuário.
- [ ] Tarefa 5.4: Implementar lógica de transição de estado: se o usuário estiver qualificado ou solicitar atendimento humano, alterar o `ChatStatus` para `WAITING_HUMAN`.

## Fase 6: Documentação e Polimento Final
- [ ] Tarefa 6.1: Adicionar a documentação no padrão Swagger/OpenAPI para as atuais `propertyRoutes` e `userRoutes`.
- [ ] Tarefa 6.2: Garantir que todas as funções públicas e controllers contenham comentários JSDoc aplicáveis.
- [ ] Tarefa 6.3: Executar ferramentas de lint, formatação e verificação de coverage visando bater a meta de >80% de cobertura.
- [ ] Tarefa 6.4: Adicionar o passo a passo de verificação manual na documentação do projeto, conforme diretrizes da aplicação.
