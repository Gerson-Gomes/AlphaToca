#!/bin/bash

# ================================================
# Kafka Setup Script
# ================================================
# Uso: bash scripts/setup-kafka.sh
# Inicia Docker containers Kafka + cria tópicos

set -e

echo "================================================"
echo "🚀 Kafka Setup Script"
echo "================================================"

# Cores para output
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# ================================================
# Passo 1: Verificar Docker
# ================================================
echo -e "\n${BLUE}[1/4]${NC} Verificando Docker..."

if ! command -v docker &> /dev/null; then
    echo -e "${YELLOW}❌ Docker não está instalado${NC}"
    echo "Instale Docker: https://docs.docker.com/install/"
    exit 1
fi

if ! command -v docker-compose &> /dev/null; then
    echo -e "${YELLOW}❌ Docker Compose não está instalado${NC}"
    echo "Instale Docker Compose: https://docs.docker.com/compose/install/"
    exit 1
fi

echo -e "${GREEN}✓ Docker instalado${NC}"

# ================================================
# Passo 2: Iniciar containers
# ================================================
echo -e "\n${BLUE}[2/4]${NC} Iniciando containers Kafka..."

if docker-compose -f docker-compose-kafka.yaml ps | grep -q "kafka"; then
    echo -e "${YELLOW}⚠ Kafka já está rodando${NC}"
else
    echo "Iniciando Docker Compose..."
    docker-compose -f docker-compose-kafka.yaml up -d

    echo "Aguardando Kafka inicializar..."
    sleep 10

    # Verificar se está rodando
    if docker-compose -f docker-compose-kafka.yaml ps | grep -q "kafka.*Up"; then
        echo -e "${GREEN}✓ Kafka iniciado${NC}"
    else
        echo -e "${YELLOW}❌ Kafka falhou ao iniciar${NC}"
        docker-compose -f docker-compose-kafka.yaml logs kafka
        exit 1
    fi
fi

# ================================================
# Passo 3: Criar tópicos
# ================================================
echo -e "\n${BLUE}[3/4]${NC} Criando tópicos Kafka..."

KAFKA_CONTAINER=$(docker-compose -f docker-compose-kafka.yaml ps -q kafka)

if [ -z "$KAFKA_CONTAINER" ]; then
    echo -e "${YELLOW}❌ Container Kafka não encontrado${NC}"
    exit 1
fi

# Criar tópico whatsapp-messages
echo "Criando tópico: whatsapp-messages (3 partitions)..."
docker exec "$KAFKA_CONTAINER" kafka-topics.sh \
    --bootstrap-server localhost:9092 \
    --create \
    --topic whatsapp-messages \
    --partitions 3 \
    --replication-factor 1 \
    --if-not-exists 2>/dev/null || true

# Criar tópico visit-reminders
echo "Criando tópico: visit-reminders (1 partition)..."
docker exec "$KAFKA_CONTAINER" kafka-topics.sh \
    --bootstrap-server localhost:9092 \
    --create \
    --topic visit-reminders \
    --partitions 1 \
    --replication-factor 1 \
    --if-not-exists 2>/dev/null || true

echo -e "${GREEN}✓ Tópicos criados${NC}"

# ================================================
# Passo 4: Listar tópicos
# ================================================
echo -e "\n${BLUE}[4/4]${NC} Verificando tópicos..."

echo -e "\n${YELLOW}Tópicos criados:${NC}"
docker exec "$KAFKA_CONTAINER" kafka-topics.sh \
    --bootstrap-server localhost:9092 \
    --list | grep -E "^(whatsapp|visit)" || true

# ================================================
# Conclusão
# ================================================
echo -e "\n${GREEN}════════════════════════════════════════════${NC}"
echo -e "${GREEN}✓ Kafka Setup Completo!${NC}"
echo -e "${GREEN}════════════════════════════════════════════${NC}"

echo -e "\n${BLUE}Informações úteis:${NC}"
echo "  📊 Kafka UI: http://localhost:8080"
echo "  🔗 Bootstrap Servers: localhost:9092"
echo "  📝 Tópicos:"
echo "     - whatsapp-messages (3 partitions)"
echo "     - visit-reminders (1 partition)"

echo -e "\n${BLUE}Próximos passos:${NC}"
echo "  1. npm install kafkajs"
echo "  2. npm run build"
echo "  3. npm run dev"

echo -e "\n${BLUE}Para parar Kafka:${NC}"
echo "  docker-compose -f docker-compose-kafka.yaml down"

echo -e "\n${BLUE}Para ver logs:${NC}"
echo "  docker-compose -f docker-compose-kafka.yaml logs -f kafka"
