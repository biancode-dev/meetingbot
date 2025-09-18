#!/usr/bin/env bash
set -euo pipefail

PROFILE="${PROFILE:-meetingbot}"
REGION="${REGION:-us-east-1}"

say() { echo "===> $*"; }

say "Using PROFILE=$PROFILE REGION=$REGION"

# ---------- ALB & LISTENERS ----------
say "Deletando ALB & listeners (se existirem)..."
ALB_NAME="meetingbot-dev-alb"
ALB_ARN=$(aws elbv2 describe-load-balancers \
  --names "$ALB_NAME" \
  --profile "$PROFILE" --region "$REGION" \
  --query 'LoadBalancers[0].LoadBalancerArn' --output text 2>/dev/null || true)

if [[ -n "${ALB_ARN}" && "${ALB_ARN}" != "None" ]]; then
  for L in $(aws elbv2 describe-listeners \
        --load-balancer-arn "$ALB_ARN" \
        --profile "$PROFILE" --region "$REGION" \
        --query 'Listeners[].ListenerArn' --output text 2>/dev/null || true); do
    [[ -n "$L" ]] && aws elbv2 delete-listener --listener-arn "$L" --profile "$PROFILE" --region "$REGION" || true
  done
  aws elbv2 delete-load-balancer --load-balancer-arn "$ALB_ARN" --profile "$PROFILE" --region "$REGION" || true
  # fallback de polling (algumas versões não têm wait)
  for i in {1..30}; do
    sleep 5
    CUR=$(aws elbv2 describe-load-balancers --profile "$PROFILE" --region "$REGION" \
          --query "LoadBalancers[?LoadBalancerArn=='$ALB_ARN'] | length(@)" --output text 2>/dev/null || echo 0)
    [[ "$CUR" == "0" ]] && break
  done
else
  say "(ALB não encontrado)"
fi

# ---------- TARGET GROUP ----------
say "Deletando Target Group (se existir)..."
TG_NAME="meetingbot-dev-server-instance"
TG_ARN=$(aws elbv2 describe-target-groups \
  --names "$TG_NAME" \
  --profile "$PROFILE" --region "$REGION" \
  --query 'TargetGroups[0].TargetGroupArn' --output text 2>/dev/null || true)
[[ -n "${TG_ARN}" && "${TG_ARN}" != "None" ]] && \
  aws elbv2 delete-target-group --target-group-arn "$TG_ARN" --profile "$PROFILE" --region "$REGION" || say "(Target Group não encontrado)"

# ---------- ECS SERVICE, CAPACITY PROVIDER & CLUSTER ----------
say "Limpando ECS (service, capacity provider e cluster)..."
CLUSTER="meetingbot-dev"
SERVICE="meetingbot-dev-server"

# Service -> desired-count 0 e deletar
SVC_EXISTS=$(aws ecs describe-services \
  --cluster "$CLUSTER" --services "$SERVICE" \
  --profile "$PROFILE" --region "$REGION" \
  --query 'services[0].status' --output text 2>/dev/null || true)

if [[ "$SVC_EXISTS" != "None" && "$SVC_EXISTS" != "MISSING" && -n "$SVC_EXISTS" ]]; then
  aws ecs update-service --cluster "$CLUSTER" --service "$SERVICE" \
    --desired-count 0 --profile "$PROFILE" --region "$REGION" || true
  aws ecs delete-service --cluster "$CLUSTER" --service "$SERVICE" \
    --force --profile "$PROFILE" --region "$REGION" || true
  # polling até sumir
  for i in {1..30}; do
    sleep 4
    X=$(aws ecs describe-services --cluster "$CLUSTER" --services "$SERVICE" \
         --profile "$PROFILE" --region "$REGION" \
         --query 'failures[0].reason' --output text 2>/dev/null || echo "")
    [[ "$X" == "MISSING" || "$X" == "SERVICE_NOT_FOUND" ]] && break
  done
else
  say "(ECS service não encontrado)"
fi

# Remover providers e estratégia padrão do cluster
aws ecs update-cluster \
  --cluster "$CLUSTER" \
  --capacity-providers '[]' \
  --default-capacity-provider-strategy '[]' \
  --profile "$PROFILE" --region "$REGION" 2>/dev/null || true

# Deletar capacity providers que contenham 'meetingbot-dev' no nome
for CP in $(aws ecs describe-capacity-providers \
      --profile "$PROFILE" --region "$REGION" \
      --query "capacityProviders[?contains(name, 'meetingbot-dev')].name" \
      --output text 2>/dev/null || true); do
  [[ -n "$CP" ]] && aws ecs delete-capacity-provider \
      --capacity-provider "$CP" \
      --profile "$PROFILE" --region "$REGION" || true
done

# Tentar apagar o cluster (ignora erro se ainda tiver pendências)
aws ecs delete-cluster --cluster "$CLUSTER" \
  --profile "$PROFILE" --region "$REGION" 2>/dev/null || say "(Cluster ainda não está vazio ou já não existe)"

# ---------- ASG & LAUNCH TEMPLATE ----------
say "Deletando Auto Scaling Group e Launch Templates (se existirem)..."
ASG="meetingbot-dev-ecs-instances"
ASG_EXISTS=$(aws autoscaling describe-auto-scaling-groups \
  --auto-scaling-group-names "$ASG" \
  --profile "$PROFILE" --region "$REGION" \
  --query 'AutoScalingGroups[0].AutoScalingGroupName' --output text 2>/dev/null || true)

if [[ "$ASG_EXISTS" == "$ASG" ]]; then
  aws autoscaling update-auto-scaling-group \
    --auto-scaling-group-name "$ASG" \
    --min-size 0 --max-size 0 --desired-capacity 0 \
    --profile "$PROFILE" --region "$REGION" || true

  # termina instâncias do ASG
  for IID in $(aws autoscaling describe-auto-scaling-groups \
      --auto-scaling-group-names "$ASG" \
      --profile "$PROFILE" --region "$REGION" \
      --query 'AutoScalingGroups[0].Instances[].InstanceId' --output text 2>/dev/null); do
    [[ -n "$IID" ]] && aws ec2 terminate-instances --instance-ids "$IID" --profile "$PROFILE" --region "$REGION" || true
  done

  # apagar o ASG (force)
  aws autoscaling delete-auto-scaling-group \
    --auto-scaling-group-name "$ASG" --force-delete \
    --profile "$PROFILE" --region "$REGION" || true

  # polling até sumir
  for i in {1..30}; do
    sleep 5
    EXISTS=$(aws autoscaling describe-auto-scaling-groups \
      --auto-scaling-group-names "$ASG" \
      --profile "$PROFILE" --region "$REGION" \
      --query 'length(AutoScalingGroups)' --output text 2>/dev/null || echo 0)
    [[ "$EXISTS" == "0" ]] && break
  done
else
  say "(ASG não encontrado)"
fi

# Launch Templates do ASG
for LT in $(aws ec2 describe-launch-templates \
    --filters "Name=launch-template-name,Values=meetingbot-dev-ecs-instance-*" \
    --query 'LaunchTemplates[].LaunchTemplateName' --output text \
    --profile "$PROFILE" --region "$REGION" 2>/dev/null); do
  [[ -n "$LT" ]] && aws ec2 delete-launch-template --launch-template-name "$LT" --profile "$PROFILE" --region "$REGION" || true
done

# ---------- RDS INSTANCE & SUBNET GROUP ----------
say "Deletando RDS instance (se existir) e depois o DB Subnet Group..."
DB_ID="meetingbot-dev"
DB_EXISTS=$(aws rds describe-db-instances --db-instance-identifier "$DB_ID" \
  --profile "$PROFILE" --region "$REGION" \
  --query 'DBInstances[0].DBInstanceIdentifier' --output text 2>/dev/null || true)

if [[ "$DB_EXISTS" == "$DB_ID" ]]; then
  aws rds delete-db-instance \
    --db-instance-identifier "$DB_ID" \
    --skip-final-snapshot \
    --delete-automated-backups \
    --profile "$PROFILE" --region "$REGION" || true

  # polling até sumir
  for i in {1..60}; do
    sleep 10
    STATE=$(aws rds describe-db-instances --db-instance-identifier "$DB_ID" \
      --profile "$PROFILE" --region "$REGION" \
      --query 'DBInstances[0].DBInstanceStatus' --output text 2>/dev/null || echo "gone")
    [[ "$STATE" == "gone" ]] && break
    echo "    aguardando RDS apagar... estado: $STATE"
  done
else
  say "(RDS instance não encontrada)"
fi

DB_SNG="meetingbot-dev-db-subnet-group"
aws rds delete-db-subnet-group \
  --db-subnet-group-name "$DB_SNG" \
  --profile "$PROFILE" --region "$REGION" 2>/dev/null || say "($DB_SNG não existe)"

# ---------- CLOUDWATCH LOG GROUP ----------
say "Deletando CloudWatch Log Group (se existir)..."
LOG_GROUP="/ecs/meetingbot-dev/server"
aws logs delete-log-group --log-group-name "$LOG_GROUP" \
  --profile "$PROFILE" --region "$REGION" 2>/dev/null || say "($LOG_GROUP não existe)"

# ---------- IAM INSTANCE PROFILE ----------
say "Deletando IAM Instance Profile (se existir)..."
IP_NAME="meetingbot-dev-ecs-instance-profile"
IP_EXISTS=$(aws iam get-instance-profile --instance-profile-name "$IP_NAME" \
  --profile "$PROFILE" \
  --query 'InstanceProfile.InstanceProfileName' --output text 2>/dev/null || true)
if [[ "$IP_EXISTS" == "$IP_NAME" ]]; then
  aws iam remove-role-from-instance-profile \
    --instance-profile-name "$IP_NAME" \
    --role-name "meetingbot-dev-ecs-instance-role" \
    --profile "$PROFILE" 2>/dev/null || true
  aws iam delete-instance-profile --instance-profile-name "$IP_NAME" --profile "$PROFILE" || true
else
  say "(Instance Profile não encontrado)"
fi

# ---------- IAM ROLES ----------
say "Deletando IAM Roles e policies (se existirem)..."
ROLES=("meetingbot-dev-ecs-instance-role" "meetingbot-dev-ecs-execution-role" "meetingbot-dev-server-role" "meetingbot-dev-bot-role")
for ROLE in "${ROLES[@]}"; do
  RNAME=$(aws iam get-role --role-name "$ROLE" --profile "$PROFILE" \
          --query 'Role.RoleName' --output text 2>/dev/null || true)
  if [[ "$RNAME" == "$ROLE" ]]; then
    echo "    -> limpando $ROLE"

    for P in $(aws iam list-attached-role-policies --role-name "$ROLE" \
              --profile "$PROFILE" --query 'AttachedPolicies[].PolicyArn' --output text 2>/dev/null || true); do
      [[ -n "$P" ]] && aws iam detach-role-policy --role-name "$ROLE" --policy-arn "$P" --profile "$PROFILE" || true
    done

    for IP in $(aws iam list-role-policies --role-name "$ROLE" \
              --profile "$PROFILE" --query 'PolicyNames[]' --output text 2>/dev/null || true); do
      [[ -n "$IP" ]] && aws iam delete-role-policy --role-name "$ROLE" --policy-name "$IP" --profile "$PROFILE" || true
    done

    aws iam delete-role --role-name "$ROLE" --profile "$PROFILE" || true
  else
    say "($ROLE não existe)"
  fi
done

say "Limpeza de sobras concluída. Agora rode: terraform apply"
