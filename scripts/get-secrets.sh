#!/bin/bash
# Script para recuperar secrets do AWS Secrets Manager

set -e

AWS_REGION=${AWS_REGION:-us-east-1}

echo "🔐 Recuperando secrets do AWS Secrets Manager..."
echo ""

echo "=== Credenciais (meetingbot-dev/credentials) ==="
aws secretsmanager get-secret-value \
  --secret-id meetingbot-dev/credentials \
  --region $AWS_REGION \
  --query 'SecretString' \
  --output text | jq .

echo ""
echo "=== Configurações (meetingbot-dev/config) ==="
aws secretsmanager get-secret-value \
  --secret-id meetingbot-dev/config \
  --region $AWS_REGION \
  --query 'SecretString' \
  --output text | jq .

echo ""
echo "✅ Secrets recuperados com sucesso!"
