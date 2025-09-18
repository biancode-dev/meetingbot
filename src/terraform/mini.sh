#!/usr/bin/env bash
set -euo pipefail

PROFILE="${PROFILE:-meetingbot}"
REGION="${REGION:-us-east-1}"
CLUSTER="${CLUSTER:-meetingbot-dev}"
SERVICE="${SERVICE:-meetingbot-dev-server}"
# Se você souber o nome exato do CP, defina: CP_NAME="meetingbot-dev-ec2"
CP_NAME="${CP_NAME:-}"

echo "===> Fixando ECS Capacity Provider (PROFILE=$PROFILE REGION=$REGION)"

# 1) Service: zera e apaga (pra não referenciar CP)
if aws ecs describe-services \
    --cluster "$CLUSTER" --services "$SERVICE" \
    --profile "$PROFILE" --region "$REGION" \
    --query 'services[0].status' --output text 2>/dev/null | grep -vq 'None'; then
  aws ecs update-service --cluster "$CLUSTER" --service "$SERVICE" \
    --desired-count 0 --profile "$PROFILE" --region "$REGION" || true
  aws ecs delete-service --cluster "$CLUSTER" --service "$SERVICE" \
    --force --profile "$PROFILE" --region "$REGION" || true
fi

# 2) Cluster: remove providers e estratégia padrão
aws ecs update-cluster \
  --cluster "$CLUSTER" \
  --capacity-providers '[]' \
  --default-capacity-provider-strategy '[]' \
  --profile "$PROFILE" --region "$REGION" 2>/dev/null || true

# 3) Deletar o(s) Capacity Provider(s)
if [[ -n "$CP_NAME" ]]; then
  # deletar o nome informado
  aws ecs delete-capacity-provider \
    --capacity-provider "$CP_NAME" \
    --profile "$PROFILE" --region "$REGION" || true
else
  # auto-descobrir CPs relacionados ao projeto e deletar
  for CP in $(aws ecs describe-capacity-providers \
        --profile "$PROFILE" --region "$REGION" \
        --query "capacityProviders[?contains(name, 'meetingbot-dev')].name" \
        --output text 2>/dev/null || true); do
    [[ -n "$CP" ]] && aws ecs delete-capacity-provider \
      --capacity-provider "$CP" \
      --profile "$PROFILE" --region "$REGION" || true
  done
fi

echo "===> Pronto. Agora rode: terraform apply"
