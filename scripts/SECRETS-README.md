# 🔐 AWS Secrets Manager - MeetingBot

Este diretório contém scripts para gerenciar secrets do MeetingBot armazenados no AWS Secrets Manager.

## 📦 Secrets Armazenados

### 1. **meetingbot-dev/credentials**
Credenciais sensíveis:
- `DATABASE_URL` - URL de conexão PostgreSQL
- `AUTH_SECRET` - Chave secreta para autenticação
- `AUTH_GITHUB_ID` - GitHub OAuth App Client ID
- `AUTH_GITHUB_SECRET` - GitHub OAuth App Client Secret
- `GITHUB_TOKEN` - Token de acesso GitHub
- `AWS_ACCESS_KEY_ID` - AWS Access Key
- `AWS_SECRET_ACCESS_KEY` - AWS Secret Access Key

### 2. **meetingbot-dev/config**
Configurações do ambiente:
- `AWS_BUCKET_NAME` - Nome do bucket S3
- `AWS_REGION` - Região AWS
- `ECS_CLUSTER_NAME` - Nome do cluster ECS
- `ECS_TASK_DEFINITION_MEET` - Task definition do bot Google Meet
- `ECS_TASK_DEFINITION_TEAMS` - Task definition do bot Teams
- `ECS_TASK_DEFINITION_ZOOM` - Task definition do bot Zoom
- `ECS_SUBNETS` - Subnets para ECS
- `ECS_SECURITY_GROUPS` - Security groups para ECS
- `MEETINGBOT_JOBS_QUEUE_URL` - URL da fila de jobs
- `RECORDING_COMPLETED_QUEUE_URL` - URL da fila de completion
- `AUTH_URL` - URL base da aplicação

## 🛠️ Scripts Disponíveis

### `get-secrets.sh`
Recupera e exibe todos os secrets em formato JSON:
```bash
./scripts/get-secrets.sh
```

### `load-secrets-to-env.sh`
Carrega os secrets como variáveis de ambiente no shell atual:
```bash
source scripts/load-secrets-to-env.sh
```

## 📝 Como Usar

### Visualizar secrets:
```bash
cd /home/lincoln/workspace/biancode/meetingbot
./scripts/get-secrets.sh
```

### Carregar no ambiente local:
```bash
cd /home/lincoln/workspace/biancode/meetingbot
source scripts/load-secrets-to-env.sh
# Agora você pode usar as variáveis
echo $DATABASE_URL
```

### Atualizar secrets:
```bash
# Editar o arquivo temporário
cat > /tmp/new-secrets.json << EOF
{
  "DATABASE_URL": "nova_url...",
  "AUTH_SECRET": "novo_secret..."
}
EOF

# Atualizar no Secrets Manager
aws secretsmanager update-secret \
  --secret-id meetingbot-dev/credentials \
  --secret-string file:///tmp/new-secrets.json \
  --region us-east-1
```

## 🔑 Acessar via CLI

### Recuperar um secret específico:
```bash
aws secretsmanager get-secret-value \
  --secret-id meetingbot-dev/credentials \
  --region us-east-1 \
  --query 'SecretString' \
  --output text | jq -r '.DATABASE_URL'
```

### Listar todos os secrets:
```bash
aws secretsmanager list-secrets \
  --region us-east-1 \
  --filters Key=name,Values=meetingbot-dev/
```

## 🚨 Segurança

- ⚠️ **NUNCA** faça commit dos arquivos `secrets.json` ou `config.json`
- ⚠️ Esses arquivos já estão no `.gitignore`
- ⚠️ Use sempre o AWS Secrets Manager em produção
- ⚠️ Rotacione as credenciais periodicamente

## 🔄 Rotação de Secrets

Para rotacionar secrets automaticamente:
```bash
aws secretsmanager rotate-secret \
  --secret-id meetingbot-dev/credentials \
  --region us-east-1
```

## 📚 Documentação

- [AWS Secrets Manager](https://docs.aws.amazon.com/secretsmanager/)
- [Best Practices](https://docs.aws.amazon.com/secretsmanager/latest/userguide/best-practices.html)

