#!/bin/bash
# Script para carregar secrets como variáveis de ambiente

set -e

AWS_REGION=${AWS_REGION:-us-east-1}

echo "🔐 Carregando secrets do AWS Secrets Manager..."

# Recuperar credenciais
CREDENTIALS=$(aws secretsmanager get-secret-value \
  --secret-id meetingbot-dev/credentials \
  --region $AWS_REGION \
  --query 'SecretString' \
  --output text)

# Recuperar configurações
CONFIG=$(aws secretsmanager get-secret-value \
  --secret-id meetingbot-dev/config \
  --region $AWS_REGION \
  --query 'SecretString' \
  --output text)

# Exportar como variáveis de ambiente
export DATABASE_URL=$(echo $CREDENTIALS | jq -r '.DATABASE_URL')
export AUTH_SECRET=$(echo $CREDENTIALS | jq -r '.AUTH_SECRET')
export AUTH_GITHUB_ID=$(echo $CREDENTIALS | jq -r '.AUTH_GITHUB_ID')
export AUTH_GITHUB_SECRET=$(echo $CREDENTIALS | jq -r '.AUTH_GITHUB_SECRET')
export GITHUB_TOKEN=$(echo $CREDENTIALS | jq -r '.GITHUB_TOKEN')
export AWS_ACCESS_KEY_ID=$(echo $CREDENTIALS | jq -r '.AWS_ACCESS_KEY_ID')
export AWS_SECRET_ACCESS_KEY=$(echo $CREDENTIALS | jq -r '.AWS_SECRET_ACCESS_KEY')

export AWS_BUCKET_NAME=$(echo $CONFIG | jq -r '.AWS_BUCKET_NAME')
export AWS_REGION=$(echo $CONFIG | jq -r '.AWS_REGION')
export ECS_CLUSTER_NAME=$(echo $CONFIG | jq -r '.ECS_CLUSTER_NAME')
export ECS_TASK_DEFINITION_MEET=$(echo $CONFIG | jq -r '.ECS_TASK_DEFINITION_MEET')
export ECS_TASK_DEFINITION_TEAMS=$(echo $CONFIG | jq -r '.ECS_TASK_DEFINITION_TEAMS')
export ECS_TASK_DEFINITION_ZOOM=$(echo $CONFIG | jq -r '.ECS_TASK_DEFINITION_ZOOM')
export ECS_SUBNETS=$(echo $CONFIG | jq -r '.ECS_SUBNETS')
export ECS_SECURITY_GROUPS=$(echo $CONFIG | jq -r '.ECS_SECURITY_GROUPS')
export MEETINGBOT_JOBS_QUEUE_URL=$(echo $CONFIG | jq -r '.MEETINGBOT_JOBS_QUEUE_URL')
export RECORDING_COMPLETED_QUEUE_URL=$(echo $CONFIG | jq -r '.RECORDING_COMPLETED_QUEUE_URL')
export AUTH_URL=$(echo $CONFIG | jq -r '.AUTH_URL')

echo "✅ Variáveis de ambiente carregadas!"
echo ""
echo "Para usar em seu terminal, execute:"
echo "  source scripts/load-secrets-to-env.sh"
