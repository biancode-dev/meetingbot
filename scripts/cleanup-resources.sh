#!/bin/bash
# Script para limpar recursos AWS não utilizados

set -e

AWS_REGION=${AWS_REGION:-us-east-1}
CLUSTER_NAME="meetingbot-dev"

echo "🧹 Iniciando limpeza de recursos AWS..."
echo "⚠️  Este script vai deletar recursos não utilizados"
echo ""

# Função para confirmar ação
confirm() {
    read -p "$1 (y/n): " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        echo "Pulando..."
        return 1
    fi
    return 0
}

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "1. BUCKETS S3"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "Buckets a deletar:"
echo "  - meetingbot-dev-44989554-bot-data"
echo "  - meetingbot-dev-52866384-bot-data"
echo "  - talksy-meetingbot"
echo ""

if confirm "Deletar buckets antigos?"; then
    for bucket in meetingbot-dev-44989554-bot-data meetingbot-dev-52866384-bot-data talksy-meetingbot; do
        echo "Verificando $bucket..."
        # Verificar se está vazio
        OBJECTS=$(aws s3 ls s3://$bucket --recursive --region $AWS_REGION 2>/dev/null | wc -l || echo "0")
        if [ "$OBJECTS" -gt "0" ]; then
            echo "⚠️  Bucket $bucket contém $OBJECTS objetos!"
            if confirm "  Deletar objetos e bucket?"; then
                aws s3 rb s3://$bucket --force --region $AWS_REGION 2>/dev/null && echo "✅ $bucket deletado" || echo "❌ Erro ao deletar $bucket"
            fi
        else
            aws s3 rb s3://$bucket --region $AWS_REGION 2>/dev/null && echo "✅ $bucket deletado" || echo "❌ Erro ou bucket já deletado"
        fi
    done
fi

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "2. FILAS SQS"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "Filas a deletar:"
echo "  - talksy-meetingbot-jobs-test-standard"
echo "  - talksy-meetingbot-jobs-test.fifo"
echo "  - talksy-meetingbot-jobs-dlq.fifo"
echo ""

if confirm "Deletar filas de teste?"; then
    QUEUES=(
        "talksy-meetingbot-jobs-test-standard"
        "talksy-meetingbot-jobs-test.fifo"
        "talksy-meetingbot-jobs-dlq.fifo"
    )
    for queue in "${QUEUES[@]}"; do
        QUEUE_URL="https://sqs.${AWS_REGION}.amazonaws.com/228692667167/${queue}"
        aws sqs delete-queue --queue-url $QUEUE_URL --region $AWS_REGION 2>/dev/null && echo "✅ $queue deletada" || echo "❌ Erro ou fila já deletada"
    done
fi

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "3. SERVIÇOS ECS ANTIGOS"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "Serviços a deletar:"
echo "  - meetingbot-dev-meetingbot-service"
echo "  - meetingbot-dev-server"
echo ""

if confirm "Deletar serviços ECS antigos?"; then
    SERVICES=(
        "meetingbot-dev-meetingbot-service"
        "meetingbot-dev-server"
    )
    for service in "${SERVICES[@]}"; do
        # Garantir que está com desired count 0
        aws ecs update-service \
            --cluster $CLUSTER_NAME \
            --service $service \
            --desired-count 0 \
            --region $AWS_REGION > /dev/null 2>&1
        
        sleep 5
        
        # Deletar serviço
        aws ecs delete-service \
            --cluster $CLUSTER_NAME \
            --service $service \
            --region $AWS_REGION > /dev/null 2>&1 && echo "✅ $service deletado" || echo "❌ Erro ao deletar $service"
    done
fi

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "4. TARGET GROUPS ANTIGOS"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "Target groups a deletar:"
echo "  - meetingbot-dev-server-instance"
echo ""

if confirm "Deletar target group antigo?"; then
    TG_ARN="arn:aws:elasticloadbalancing:${AWS_REGION}:228692667167:targetgroup/meetingbot-dev-server-instance/e14c12ff844e1369"
    aws elbv2 delete-target-group \
        --target-group-arn $TG_ARN \
        --region $AWS_REGION 2>/dev/null && echo "✅ Target group deletado" || echo "❌ Erro ou já deletado"
fi

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "5. BANCO RDS DE PRODUÇÃO"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "⚠️  Banco: meetingbot-prod (db.t4g.micro)"
echo "⚠️  Custo estimado: ~$15-20/mês"
echo ""
echo "Opções:"
echo "  1) Deletar com snapshot final"
echo "  2) Deletar sem snapshot"
echo "  3) Manter"
echo ""

if confirm "Deletar banco meetingbot-prod?"; then
    if confirm "  Criar snapshot final antes de deletar?"; then
        echo "Criando snapshot final..."
        aws rds delete-db-instance \
            --db-instance-identifier meetingbot-prod \
            --final-db-snapshot-identifier meetingbot-prod-final-snapshot-$(date +%Y%m%d) \
            --region $AWS_REGION && echo "✅ Banco deletado com snapshot" || echo "❌ Erro ao deletar"
    else
        aws rds delete-db-instance \
            --db-instance-identifier meetingbot-prod \
            --skip-final-snapshot \
            --region $AWS_REGION && echo "✅ Banco deletado sem snapshot" || echo "❌ Erro ao deletar"
    fi
else
    echo "ℹ️  Banco mantido"
fi

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "6. LOAD BALANCER DE PRODUÇÃO"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "⚠️  Load Balancer: meetingbot-prod-alb"
echo "⚠️  Custo estimado: ~$16/mês"
echo ""

if confirm "Deletar load balancer de produção?"; then
    LB_ARN=$(aws elbv2 describe-load-balancers \
        --names meetingbot-prod-alb \
        --region $AWS_REGION \
        --query 'LoadBalancers[0].LoadBalancerArn' \
        --output text 2>/dev/null)
    
    if [ ! -z "$LB_ARN" ]; then
        aws elbv2 delete-load-balancer \
            --load-balancer-arn $LB_ARN \
            --region $AWS_REGION && echo "✅ Load balancer deletado" || echo "❌ Erro ao deletar"
    fi
else
    echo "ℹ️  Load balancer mantido"
fi

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "✅ LIMPEZA CONCLUÍDA!"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "📊 Recursos mantidos:"
echo "  ✅ talksy-videos-dev-0c18ea10 (S3)"
echo "  ✅ talksy-meetingbot-jobs.fifo (SQS)"
echo "  ✅ talksy-recording-completed.fifo (SQS)"
echo "  ✅ meetingbot-dev (RDS)"
echo "  ✅ meetingbot-dev-alb (ALB)"
echo "  ✅ meetingbot-dev (ECS Cluster)"
echo ""
echo "💰 Economia estimada: $32-37/mês"

