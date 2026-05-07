# Visit.source — Origem do agendamento (MANUAL vs AI)

Referência técnica para o item §6.1 de `BACKEND_PENDENCIAS_LANDLORD.md`
e o item 8 de `BACKEND_HANDOFF.md`. Mantido alinhado com a
implementação em `prisma/schema.prisma` e `src/utils/visitValidation.ts`.

## Enum

```prisma
enum VisitSource {
  MANUAL
  AI
}
```

Representado no Postgres como `"VisitSource" AS ENUM ('MANUAL', 'AI')`
(ver migração `20260508030000_add_visit_source`).

## Coluna

```prisma
model Visit {
  ...
  source VisitSource @default(MANUAL)
  ...
}
```

SQL:

```sql
ALTER TABLE "visits"
  ADD COLUMN "source" "VisitSource" NOT NULL DEFAULT 'MANUAL';
```

## Semântica

| Valor   | Significado                                                                 |
| ------- | --------------------------------------------------------------------------- |
| MANUAL  | Agendada manualmente por um humano (landlord ou tenant no app).             |
| AI      | Agendada por um agente de IA interno (reservado — sem writer ainda).        |

- Todos os clientes humanos gravam `MANUAL`. O body do `POST /api/visits`
  aceita `source` como opcional; quando omitido, default é `MANUAL`.
- `AI` é reservado para um futuro fluxo interno — hoje o
  `leadExtractionService` detecta `schedule_visit` como intent em
  conversas WhatsApp mas **não** cria rows `visits`. Quando o fluxo
  automatizado existir, ele deverá gravar `source=AI` explicitamente.

## Backfill

Registros existentes recebem `MANUAL` via `DEFAULT` da coluna — toda
visita pré-LL-018 foi criada manualmente pelo cliente humano. Nenhum
`UPDATE` adicional é necessário.

## Superfície API

- **`POST /api/visits`** — body aceita `source?: 'MANUAL' | 'AI'` (Zod
  `z.nativeEnum(VisitSource)`). Default `MANUAL` na ausência do campo.
- **`GET /api/visits`** e **`GET /api/visits/:id`** — retornam o campo
  `source` em cada row. Calendário do landlord pode distinguir dots
  via esse campo (`MANUAL` vs `AI`).
- **`PATCH /api/visits/:id`** — não aceita mudança de `source`
  (decisão de design: source é imutável após criação).

## Observação para o frontend

O `app/lib/features/visits` já tem infra para renderizar dots
distintos por source. Com o backend agora emitindo `source`, o heurístico
de fallback pode ser removido.
