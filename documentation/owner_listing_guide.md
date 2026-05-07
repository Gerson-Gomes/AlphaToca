# Guia do Proprietário — I-Moveis

**Descrição:** Guia completo para proprietários anunciarem e gerenciarem imóveis na plataforma I-Moveis, incluindo cadastro, moderação, repasses, taxas e suporte.

---

## 1. Criar Conta de Proprietário

### Como se cadastrar como proprietário
Você pode se cadastrar de duas formas:

**Pelo WhatsApp (mais rápido):**
- Envie "oi" para nosso número no WhatsApp
- O assistente virtual vai pedir seu e-mail
- Digite seu e-mail e o cadastro será feito na hora
- Você receberá um link no e-mail para definir sua senha
- Depois, acesse o app e altere seu perfil para proprietário

**Pelo aplicativo ou site:**
Ao criar sua conta no I-Moveis, marque a opção "Sou proprietário" (isOwner). Isso define automaticamente seu perfil como LANDLORD no sistema, dando acesso às funcionalidades de gestão de imóveis.

Você precisará fornecer:
- Nome completo
- E-mail
- Senha
- Número de telefone (WhatsApp)

### Documentação necessária do proprietário
Antes de anunciar seu primeiro imóvel, a plataforma solicita:
- **Matrícula do Imóvel:** Certidão de Inteiro Teor atualizada (validade de 30 dias) para verificação de propriedade e ônus
- **IPTU:** Cópia do carnê do ano vigente
- **Contas de Consumo:** Comprovantes de quitação de luz e água para possibilitar transferência de titularidade na locação

---

## 2. Cadastrar um Imóvel

### Informações obrigatórias
- **Título:** 3 a 255 caracteres, atraente e descritivo
- **Descrição:** Mínimo 10 caracteres, detalhando as características do imóvel
- **Preço do aluguel:** Valor mensal em reais (Decimal com 2 casas)
- **Endereço:** Mínimo 5 caracteres
- **Cidade** e **Estado** (UF com 2 letras, ex: SP, RJ)
- **CEP**

### Características do imóvel
- **Tipo:** Apartamento, Casa, Studio ou Casa em Condomínio
- **Quartos:** Número de quartos (padrão: 0)
- **Banheiros:** Número de banheiros (padrão: 0)
- **Vagas de garagem:** Número de vagas (padrão: 0)
- **Área:** Metragem em m² (padrão: 0)
- **Mobiliado:** Sim ou não (padrão: não)
- **Aceita pets:** Sim ou não (padrão: não)
- **Próximo ao metrô:** Sim ou não (padrão: não)

### Valores adicionais
- **Taxa de condomínio:** Valor mensal em reais
- **IPTU:** Valor do imposto

### Localização precisa
Para aparecer nas buscas por proximidade, informe:
- **Latitude e longitude:** Coordenadas exatas do imóvel

### Fotos
- Adicione fotos de qualidade do imóvel
- Defina uma imagem de capa (isCover) que será a principal nas buscas
- Você pode adicionar legendas às fotos

### Moderação
Após o cadastro, o imóvel entra em moderação com status **PENDENTE**. A equipe I-Moveis revisa o anúncio e pode:
- **Aprovar (APPROVED):** O imóvel fica visível nas buscas públicas
- **Rejeitar (REJECTED):** O imóvel é recusado com um motivo específico (até 500 caracteres)

Você recebe uma notificação push com o resultado da moderação (PROPERTY_APPROVED ou PROPERTY_REJECTED). Apenas imóveis com status AVAILABLE e moderação APPROVED aparecem nas buscas para inquilinos.

---

## 3. Gerenciar Imóveis

### Status do imóvel
Você pode alterar o status do seu imóvel a qualquer momento:
- **Disponível (AVAILABLE):** Imóvel disponível para locação e visível nas buscas
- **Em Negociação (NEGOTIATING):** Há uma proposta sendo analisada
- **Alugado (RENTED):** Imóvel já alugado

### Visualizações
O sistema conta quantas vezes cada imóvel foi visualizado (campo `views`). Imóveis com mais visualizações aparecem melhor posicionados nas buscas.

### Atualizar informações
Você pode editar as informações do imóvel a qualquer momento: preço, descrição, status, fotos, características. Sempre que alterar informações relevantes, a moderação pode ser reavaliada.

### Excluir imóvel
Você pode excluir um imóvel da plataforma. As imagens associadas são removidas automaticamente.

---

## 4. Visitas

### Como funcionam as visitas
Quando um inquilino se interessa pelo seu imóvel, ele agenda uma visita pelo aplicativo. Você recebe uma notificação push (VISIT_SCHEDULED) com a data, horário e duração da visita.

### Regras de agendamento
- A duração padrão da visita é de 45 minutos (mínimo 15, máximo 180)
- O sistema evita automaticamente conflitos de horário (você não terá duas visitas sobrepostas)
- Visitas consecutivas (uma termina quando outra começa) são permitidas

### Lembretes
Você recebe lembretes automáticos por push notification:
- 24 horas antes da visita
- 2 horas antes da visita

### Gerenciar visitas
Você pode visualizar todas as visitas dos seus imóveis, filtrar por imóvel, inquilino, status ou data. Os status são:
- **Agendada (SCHEDULED):** Visita confirmada
- **Concluída (COMPLETED):** Visita realizada
- **Cancelada (CANCELLED):** Visita cancelada
- **Não compareceu (NO_SHOW):** Inquilino não compareceu

Se precisar cancelar uma visita, você pode fazê-lo. O cancelamento notifica automaticamente o inquilino.

---

## 5. Propostas e Negociação

### Como funciona uma proposta
Um inquilino interessado pode fazer uma proposta que pode:
- Aceitar o valor anunciado
- Propor um novo valor (contraproposta)
- Solicitar mudanças no imóvel (pintura, retirada de mobília)

Você, como proprietário, analisa a proposta e pode aceitar, recusar ou negociar.

### Taxa de Reserva
Para garantir exclusividade durante a análise de crédito, o inquilino pode pagar uma taxa de reserva de **10% do valor do aluguel**. Essa taxa:
- É devolvida se o proprietário desistir
- É devolvida se o inquilino for reprovado sem culpa
- Não é devolvida se o inquilino desistir

---

## 6. Repasses e Financeiro

### Como você recebe o aluguel
Os repasses são feitos todo dia **12 de cada mês** (ou próximo dia útil). O valor é transferido diretamente para sua conta.

### Taxas da plataforma

#### Taxa de Corretagem (Brokerage Fee)
- Valor: **100% de um mês de aluguel**
- Cobrada no primeiro mês do contrato ou parcelada em até 10 vezes
- É o pagamento pelo serviço de intermediação e captação do inquilino

#### Taxa de Administração (Administration Fee)
- Valor: **até 9,3% do valor do aluguel** a partir do segundo mês
- Tarifa mínima: **R$ 160**
- Cobre o gerenciamento contínuo da locação

### Despesas Iniciais (Reembolso)
No primeiro mês da locação, o proprietário deve quitar:
- Cota do condomínio do primeiro mês
- Parcela do IPTU que vencer no período

Esses valores são integralmente reembolsados no **primeiro repasse** (dia 12 do mês seguinte). A partir do segundo mês, o inquilino assume o condomínio diretamente com a administradora.

### Modelo de Receita da Plataforma
A monetização principal do I-Moveis é uma **comissão de 10% sobre o valor total do aluguel durante o primeiro ano de contrato**. Não há cobrança de taxas ocultas ou mensalidades fixas para listar imóveis.

---

## 7. Contrato e Documentação

### Documentos do inquilino que a plataforma coleta
Para sua segurança, o I-Moveis coleta e verifica:
- **Identificação:** RG e CPF (ou CNH) originais, e documentos do cônjuge se casado
- **Estado Civil:** Certidão de Nascimento ou Casamento
- **Comprovante de Residência:** Conta de consumo atualizada (últimos 60 dias)
- **Comprovante de Renda:** A renda líquida familiar deve ser superior a 3 vezes o valor do pacote de locação
  - CLT: 3 últimos holerites e Carteira de Trabalho
  - Autônomos: 3 últimos extratos bancários ou Declaração de IRPF
  - Aposentados: Extrato trimestral do INSS

### Garantia Locatícia
A plataforma **não exige fiador**. A garantia é calculada conforme o perfil de crédito do inquilino (fiança garantida), podendo ser paga à vista via PIX ou em até 12x sem juros no cartão de crédito.

---

## 8. Proteções e Seguros

### Proteção contra Inadimplência
Se o inquilino não pagar, **a plataforma cobre e repassa para você no dia 12** os valores de:
- Aluguel
- IPTU
- Taxa condominial ordinária
- Multa rescisória

### Proteção contra Danos
A plataforma garante até **R$ 50.000,00** de indenização por danos ao imóvel causados pelo inquilino ao fim do contrato, não cobertos pelo Seguro Incêndio.

### Seguro Incêndio
A contratação de um Seguro Incêndio é **obrigatória por lei** e condição essencial para que a locação seja administrada pela plataforma.

---

## 9. Vistorias e Manutenção

### Prazos de vistoria
- **Vistoria de entrada:** Até o início do contrato
- **Vistoria de saída:** Em até 3 dias úteis após o encerramento
- **Contestação da vistoria de entrada:** 15 dias corridos
- **Contestação da vistoria de saída:** 5 dias corridos

### Danos e depreciação
Se o inquilino danificar móveis ou eletrodomésticos:
- **Eletrodomésticos com mais de 5 anos:** Dedução de 80% do valor
- **Móveis com mais de 8 anos:** Dedução de 60% do valor

### Reparos de sua responsabilidade
Problemas estruturais e vícios ocultos são de responsabilidade do proprietário. Prazos de resposta:
- **Comum:** 5 dias corridos
- **Urgente** (impossibilita uso de item essencial): 3 dias corridos
- **Emergencial** (risco à segurança): 2 horas para resposta e 24 horas para iniciar o conserto

Se você não cumprir os prazos, o inquilino pode executar o reparo e solicitar reembolso.

---

## 10. Rescisão de Contrato

### Multa por saída antecipada
Se o inquilino sair antes de completar 12 meses (em contratos de 30 meses):
- Multa de **3 meses de aluguel**
- Calculada proporcionalmente aos dias restantes para completar 1 ano

### Isenção de multa
A multa não é cobrada quando:
- O inquilino sai após cumprir os 12 meses iniciais, respeitando aviso prévio de 30 dias
- O inquilino é transferido de cidade por exigência do empregador (CLT ou servidor público), mediante documentação formal

### Devolução do depósito caução
Ao final do contrato, o depósito caução (1 mês de aluguel) é devolvido ao inquilino em até 30 dias após a desocupação, com dedução de eventuais danos ou pendências.

---

## 11. Atendimento e Suporte

### Canais
- **WhatsApp:** Chatbot 24h + atendimento humano quando necessário
- **Notificações push:** Alertas em tempo real sobre visitas, moderação e contratos
- **Equipe de suporte:** Para questões complexas de negociação, litígios ou exceções contratuais

### Dashboard do proprietário
Pelo aplicativo, você tem acesso a:
- Lista de todos os seus imóveis e status
- Visitas agendadas e histórico
- Processos de locação ativos
- Histórico de repasses (via integração futura)
