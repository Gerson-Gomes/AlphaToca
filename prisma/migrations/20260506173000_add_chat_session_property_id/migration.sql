-- Adiciona propertyId ao ChatSession para vincular conversas a imóveis
ALTER TABLE "chat_sessions" ADD COLUMN "property_id" TEXT;

-- FK para properties
ALTER TABLE "chat_sessions" ADD CONSTRAINT "chat_sessions_property_id_fkey"
  FOREIGN KEY ("property_id") REFERENCES "properties"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- Índice para buscas por propriedade
CREATE INDEX "chat_sessions_property_id_idx" ON "chat_sessions"("property_id");
