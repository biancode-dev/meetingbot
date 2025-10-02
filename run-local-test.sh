#!/bin/bash

# Script para executar teste local do MeetingBot Service

echo "🚀 Iniciando teste local do MeetingBot Service..."
echo "📋 Reunião de teste: https://meet.google.com/arm-dtcw-xxc"
echo ""

# Verificar se as credenciais AWS estão configuradas
if [ -z "$AWS_ACCESS_KEY_ID" ] || [ -z "$AWS_SECRET_ACCESS_KEY" ]; then
    echo "❌ Credenciais AWS não configuradas!"
    echo "   Configure as variáveis AWS_ACCESS_KEY_ID e AWS_SECRET_ACCESS_KEY"
    echo "   ou edite o arquivo test-local.env"
    exit 1
fi

# Carregar variáveis de ambiente
export $(cat test-local.env | grep -v '^#' | xargs)

echo "🔧 Configurações:"
echo "   - AWS Region: $AWS_REGION"
echo "   - SQS Queue: $MEETINGBOT_JOBS_QUEUE_URL"
echo "   - S3 Bucket: $S3_BUCKET_NAME"
echo "   - ECS Cluster: $ECS_CLUSTER_NAME"
echo ""

# Enviar mensagem de teste
echo "📨 Enviando mensagem de teste para a fila..."
node send-test-message.js

if [ $? -eq 0 ]; then
    echo ""
    echo "✅ Mensagem enviada com sucesso!"
    echo "🔄 Iniciando MeetingBot Service para processar a mensagem..."
    echo ""
    
    # Executar MeetingBot Service
    cd src/meetingbot-service
    node index.js
else
    echo "❌ Falha ao enviar mensagem de teste"
    exit 1
fi
