# 🧪 Teste Local do MeetingBot Service

Este guia explica como executar um teste local do MeetingBot Service usando a reunião do Google Meet.

## 📋 Pré-requisitos

1. **Credenciais AWS configuradas** com permissões para:
   - SQS (ler/escrever nas filas)
   - S3 (upload de arquivos)
   - ECS (executar tasks)

2. **Node.js 18+** instalado

3. **Dependências instaladas**:
   ```bash
   cd src/meetingbot-service && npm install
   npm install dotenv
   ```

## 🔧 Configuração

### 1. Configurar Credenciais AWS

Edite o arquivo `test-local.env` com suas credenciais AWS:

```bash
AWS_ACCESS_KEY_ID=sua_access_key_aqui
AWS_SECRET_ACCESS_KEY=sua_secret_key_aqui
```

### 2. Verificar URLs das Filas

As URLs das filas SQS já estão configuradas para o ambiente de desenvolvimento:
- **Fila de Jobs**: `talksy-meetingbot-jobs.fifo`
- **Fila de Completion**: `talksy-recording-completed.fifo`

## 🚀 Executando o Teste

### Opção 1: Script Automatizado (Recomendado)

```bash
./run-local-test.sh
```

Este script irá:
1. Verificar as credenciais AWS
2. Enviar uma mensagem de teste para a fila SQS
3. Iniciar o MeetingBot Service para processar a mensagem

### Opção 2: Execução Manual

1. **Enviar mensagem de teste**:
   ```bash
   node send-test-message.js
   ```

2. **Executar MeetingBot Service**:
   ```bash
   cd src/meetingbot-service
   node index.js
   ```

## 📊 Monitoramento

### Logs do MeetingBot Service

O serviço irá mostrar logs detalhados:
- ✅ Recebimento de mensagens da fila
- 🚀 Início de tasks ECS
- 📤 Upload para S3
- ✅ Envio de completion

### Health Check

O serviço expõe um endpoint de health check na porta 3000:
```bash
curl http://localhost:3000/health
```

### Verificar Fila de Completion

Após a execução, verifique se a mensagem de completion foi enviada para a fila `talksy-recording-completed.fifo`.

## 🎯 Reunião de Teste

**URL**: https://meet.google.com/arm-dtcw-xxc

**Dados da Mensagem de Teste**:
- **Job ID**: `test-job-12345-abc-def-ghi`
- **Tenant ID**: `test-tenant-123`
- **User ID**: `test-user-456`
- **Platform**: `google_meet`
- **Meeting ID**: `arm-dtcw-xxc`

## 🔍 Troubleshooting

### Erro de Credenciais AWS
```
❌ Credenciais AWS não configuradas!
```
**Solução**: Configure as variáveis `AWS_ACCESS_KEY_ID` e `AWS_SECRET_ACCESS_KEY` no arquivo `test-local.env`.

### Erro de Permissões SQS
```
❌ SQS Access test failed
```
**Solução**: Verifique se suas credenciais AWS têm permissão para acessar as filas SQS.

### Erro de Task ECS
```
❌ ECS Task failed
```
**Solução**: Verifique se as configurações ECS estão corretas e se o cluster existe.

## 📝 Estrutura dos Arquivos

```
meetingbot/
├── test-local.env              # Configurações de teste
├── test-message.json           # Mensagem de teste
├── send-test-message.js        # Script para enviar mensagem
├── run-local-test.sh           # Script automatizado
└── README-TESTE-LOCAL.md       # Este arquivo
```

## 🎉 Resultado Esperado

Após a execução bem-sucedida:

1. ✅ Mensagem enviada para a fila SQS
2. ✅ MeetingBot Service processa a mensagem
3. ✅ Task ECS é iniciada (bot entra na reunião)
4. ✅ Bot grava a reunião
5. ✅ Upload para S3 é realizado
6. ✅ Mensagem de completion é enviada para a fila

O bot deve aparecer na reunião do Google Meet como "Talksy Test Bot" e começar a gravar automaticamente.
