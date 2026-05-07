# Guia do Aplicativo I-Moveis

**Descrição:** Guia completo de uso do aplicativo I-Moveis para inquilinos e proprietários, cobrindo todas as funcionalidades disponíveis.

---

## 1. Criar Conta e Login

### Como criar uma conta
Para usar o I-Moveis, você precisa criar uma conta. O cadastro pode ser feito pelo aplicativo ou pelo site, fornecendo:
- Nome completo
- E-mail
- Senha (escolha uma senha segura)
- Número de telefone (WhatsApp) — no formato DDD + número, ex: 11987654321

### Tipos de conta
- **Inquilino (TENANT):** Para quem quer alugar um imóvel. É o tipo padrão ao se cadastrar.
- **Proprietário (LANDLORD):** Para quem quer anunciar e gerenciar imóveis. Ao cadastrar, marque a opção "Sou proprietário".
- **Administrador (ADMIN):** Acesso restrito à equipe interna do I-Moveis.

### Login
O login é feito com e-mail e senha. Também é possível entrar com Google (integração com Firebase Auth).

---

## 2. Buscar Imóveis

### Busca básica
Na tela inicial do aplicativo, você pode navegar pelos imóveis disponíveis. Os filtros básicos incluem:
- **Cidade:** Selecione a cidade desejada
- **Estado:** UF com 2 letras (ex: SP, RJ, MG)
- **Preço máximo:** Valor máximo do aluguel que você está disposto a pagar
- **Tipo de imóvel:** Apartamento, Casa, Studio ou Casa em Condomínio
- **Quartos:** Número de quartos
- **Banheiros:** Número de banheiros
- **Vagas de garagem:** Número de vagas
- **Área:** Metragem mínima do imóvel
- **Mobiliado:** Imóveis mobiliados ou não
- **Aceita pets:** Imóveis que permitem animais de estimação
- **Próximo ao metrô:** Imóveis próximos a estações de metrô

### Busca por localização
O aplicativo permite buscar imóveis próximos a uma localização específica usando coordenadas (latitude e longitude). Basta permitir o acesso à sua localização e definir um raio de busca em km. Os resultados são ordenados por distância.

### Ordenação dos resultados
Você pode ordenar os imóveis por:
- **Destaque (isFeatured):** Padrão — imóveis em destaque primeiro
- **Mais recentes (createdAt):** Imóveis recém-cadastrados
- **Mais visualizados (views):** Imóveis mais populares
- **Menor preço (priceAsc):** Do mais barato ao mais caro
- **Maior preço (priceDesc):** Do mais caro ao mais barato
- **Mais próximos (nearest):** Ordenado por distância (requer localização)

### Paginação
Os resultados são paginados. Você pode navegar entre as páginas e escolher quantos imóveis ver por página (até 100 por página).

### Detalhes do imóvel
Ao clicar em um imóvel, você vê:
- Fotos (com imagem de capa destacada)
- Título e descrição completa
- Preço do aluguel
- Endereço, cidade e estado
- Características: quartos, banheiros, vagas, área, mobiliado, aceita pets
- Taxa de condomínio e IPTU
- Status do imóvel (disponível, em negociação ou alugado)

### Busca pelo WhatsApp
Você também pode buscar imóveis diretamente pelo WhatsApp. Envie uma mensagem para o chatbot do I-Moveis informando a cidade, estado e valor máximo. Exemplo: "Quero alugar um apartamento em São Paulo, SP, até R$ 2.500". O chatbot retorna um link com os imóveis que atendem aos seus critérios.

---

## 3. Visitas

### Agendar uma visita
Quando encontrar um imóvel que te interessa, você pode agendar uma visita. A visita é gratuita e sem compromisso. Para agendar:
- Selecione o imóvel desejado
- Escolha uma data e horário disponível
- A duração padrão da visita é de 45 minutos (mínimo 15, máximo 180 minutos)
- Você pode adicionar observações (até 2000 caracteres)

### Disponibilidade de horários
O sistema verifica automaticamente a disponibilidade do imóvel e do proprietário, evitando conflitos de agenda. Você pode consultar os horários livres antes de agendar.

### Lembretes
Você recebe lembretes automáticos da visita:
- 24 horas antes da visita
- 2 horas antes da visita

Os lembretes são enviados por push notification no aplicativo.

### Regras da visita
- Chegue no horário (atrasos acima de 15 minutos podem cancelar a visita)
- Leve documento de identidade (RG ou CNH)
- Não leve animais sem autorização prévia
- Menores de 18 anos devem estar acompanhados do responsável legal
- Em caso de chuva forte, você pode reagendar com 2 horas de antecedência

### Gerenciar visitas
Você pode visualizar todas as suas visitas agendadas, filtrar por imóvel, status ou período. Os status possíveis são:
- **Agendada (SCHEDULED):** Visita confirmada
- **Concluída (COMPLETED):** Visita realizada
- **Cancelada (CANCELLED):** Visita cancelada
- **Não compareceu (NO_SHOW):** Inquilino não compareceu

Você pode cancelar ou reagendar uma visita a qualquer momento. O cancelamento notifica automaticamente o proprietário.

---

## 4. Processo de Locação

Após gostar de um imóvel, você inicia o processo de locação. As etapas são:

1. **Triagem (TRIAGE):** Fase inicial onde o I-Moveis coleta suas preferências e necessidades.
2. **Visita Agendada (VISIT_SCHEDULED):** Você agendou e realizou a visita.
3. **Análise de Contrato (CONTRACT_ANALYSIS):** Seus documentos estão sendo analisados e o contrato está em elaboração.
4. **Processo Encerrado (CLOSED):** Contrato assinado ou processo finalizado.

A cada mudança de etapa, você recebe uma notificação push.

---

## 5. Documentos

Durante o processo de locação, você precisará enviar documentos. Os tipos de documentos são:
- **Documento de Identidade (IDENTITY):** RG, CPF ou CNH
- **Comprovante de Renda (INCOME_PROOF):** Holerites, extratos bancários ou declaração de IR
- **Contrato (CONTRACT):** Contrato de locação assinado

Quando um documento é solicitado ou rejeitado, você recebe uma notificação push.

---

## 6. Notificações

### Tipos de notificação
O aplicativo envia push notifications para:
- Visita agendada (VISIT_SCHEDULED)
- Visita cancelada (VISIT_CANCELLED)
- Lembrete de visita (VISIT_REMINDER)
- Visita concluída (VISIT_COMPLETED)
- Mudança de etapa do processo de locação (RENTAL_STAGE_CHANGED)
- Processo encerrado (RENTAL_CLOSED)
- Documento solicitado (DOCUMENT_REQUESTED)
- Documento rejeitado (DOCUMENT_REJECTED)
- Imóvel aprovado na plataforma (PROPERTY_APPROVED)
- Imóvel rejeitado na plataforma (PROPERTY_REJECTED)
- Comunicados gerais (BROADCAST)

### Gerenciar notificações
- Ícone de notificações mostra a contagem de não lidas
- Lista das últimas 50 notificações
- Marcar uma notificação como lida individualmente
- Marcar todas como lidas de uma vez
- Ativar/desativar notificações push pelo FCM Token

---

## 7. Perfil do Usuário

No perfil você pode:
- Ver seus dados (nome, e-mail, telefone, função)
- Atualizar número de telefone
- Gerenciar o token FCM para notificações push
- Ver seu histórico de processos de locação

---

## 8. Funcionalidades Exclusivas para Proprietários

### Cadastrar imóvel
Proprietários podem cadastrar imóveis fornecendo:
- Título (3 a 255 caracteres)
- Descrição (mínimo 10 caracteres)
- Preço do aluguel
- Endereço completo (mínimo 5 caracteres)
- Cidade e estado (UF com 2 letras)
- CEP
- Tipo de imóvel (Apartamento, Casa, Studio, Casa em Condomínio)
- Características: quartos, banheiros, vagas, área, mobiliado, aceita pets
- Próximo ao metrô
- Coordenadas de latitude/longitude
- Fotos do imóvel (com imagem de capa)

### Status do imóvel
- **Disponível (AVAILABLE):** Imóvel disponível para locação
- **Em Negociação (NEGOTIATING):** Há uma proposta em andamento
- **Alugado (RENTED):** Imóvel já alugado

### Moderação
Todo imóvel novo passa por moderação da equipe I-Moveis antes de ficar visível nas buscas:
- **Pendente (PENDING):** Aguardando revisão
- **Aprovado (APPROVED):** Visível nas buscas públicas
- **Rejeitado (REJECTED):** Recusado (com motivo informado)

O proprietário recebe notificação push quando o imóvel é aprovado ou rejeitado.

---

## 9. Atendimento pelo WhatsApp

Além do aplicativo, você pode usar o chatbot do I-Moveis no WhatsApp para:
- Buscar imóveis por cidade e preço
- Tirar dúvidas sobre o processo de locação
- Agendar visitas
- Receber suporte

O chatbot funciona 24 horas por dia e, quando necessário, transfere o atendimento para um agente humano.
