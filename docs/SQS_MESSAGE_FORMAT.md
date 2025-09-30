# 📋 Formato de Mensagem SQS - MeetingBot Service

## 🎯 **Visão Geral**

Este documento especifica o formato exato das mensagens que o **Backend Talksy** deve enviar para a fila SQS `talksy-meetingbot-jobs.fifo` para que o **MeetingBot Service** possa processar as gravações.

## 📨 **Estrutura da Mensagem SQS**

### **URL da Fila**
```
https://sqs.us-east-1.amazonaws.com/228692667167/talksy-meetingbot-jobs.fifo
```

### **Formato JSON Completo**
```json
{
  "job_id": "string",
  "tenant_id": "string", 
  "user_id": "string",
  "platform": "string",
  "bot_display_name": "string",
  "meeting_info": {
    "meeting_url": "string",
    "platform": "string",
    "meeting_id": "string",
    "password": "string"
  },
  "meeting_title": "string",
  "automatic_leave": "boolean",
  "recording_settings": {
    "quality": "string",
    "audio_only": "boolean",
    "transcription": "boolean"
  },
  "metadata": {
    "created_at": "string",
    "scheduled_at": "string",
    "timezone": "string"
  },
  "callback_url": "string"
}
```

---

## 📝 **Descrição Detalhada dos Campos**

### **🔑 Campos Obrigatórios**

#### **`job_id`** *(string, obrigatório)*
- **Descrição**: Identificador único universal para este job de gravação
- **Formato**: UUID v4 (ex: `"550e8400-e29b-41d4-a716-446655440000"`)
- **Uso**: Chave primária para rastreamento e identificação única
- **Exemplo**: `"job-12345-abc-def-ghi"`

#### **`tenant_id`** *(string, obrigatório)*
- **Descrição**: Identificador único da organização/empresa que está solicitando a gravação
- **Uso**: 
  - Isolamento de dados por organização
  - Organização no S3: `processed/{tenant_id}/{platform}/{job_id}/`
  - Billing e cobrança por tenant
- **Exemplo**: `"company-abc-123"` ou `"org-xyz-456"`
- **Como obter**: Do JWT token do usuário ou banco de dados

#### **`user_id`** *(string, obrigatório)*
- **Descrição**: Identificador único do usuário que solicitou a gravação
- **Uso**: Auditoria e rastreamento de quem solicitou
- **Exemplo**: `"user-789-abc-def"`
- **Como obter**: Do JWT token do usuário autenticado

#### **`platform`** *(string, obrigatório)*
- **Descrição**: Plataforma de reunião onde a gravação será executada
- **Valores aceitos**:
  - `"google_meet"` - Google Meet
  - `"zoom"` - Zoom
  - `"teams"` - Microsoft Teams
  - `"webex"` - Cisco Webex
- **Exemplo**: `"google_meet"`

#### **`meeting_info`** *(object, obrigatório)*
- **Descrição**: Informações específicas da reunião
- **Subcampos**:
  - **`meeting_url`** *(string, obrigatório)*: URL completa da reunião
    - Exemplo: `"https://meet.google.com/abc-defg-hij"`
  - **`platform`** *(string, obrigatório)*: Mesmo valor do campo `platform` principal
  - **`meeting_id`** *(string, opcional)*: ID específico da reunião
    - Exemplo: `"abc-defg-hij"`
  - **`password`** *(string, opcional)*: Senha da reunião (se necessário)
    - Exemplo: `"123456"`

#### **`meeting_title`** *(string, obrigatório)*
- **Descrição**: Título/nome da reunião
- **Uso**: Metadados para organização e identificação
- **Exemplo**: `"Reunião de Planejamento Q4"`

---

### **⚙️ Campos de Configuração**

#### **`bot_display_name`** *(string, opcional)*
- **Descrição**: Nome que o bot exibirá na reunião
- **Padrão**: `"Talksy Recording Bot"`
- **Exemplo**: `"Meu Bot de Gravação"`

#### **`automatic_leave`** *(boolean, opcional)*
- **Descrição**: Se o bot deve sair automaticamente da reunião
- **Padrão**: `true`
- **Comportamento**:
  - `true`: Bot sai automaticamente quando a reunião termina
  - `false`: Bot permanece na reunião até ser removido manualmente

#### **`recording_settings`** *(object, opcional)*
- **Descrição**: Configurações específicas da gravação
- **Subcampos**:
  - **`quality`** *(string, opcional)*: Qualidade da gravação
    - **Valores aceitos**: `"480p"`, `"720p"`, `"1080p"`
    - **Padrão**: `"720p"`
    - **Recomendação**: `"720p"` para equilíbrio qualidade/custo
  - **`audio_only`** *(boolean, opcional)*: Gravar apenas áudio
    - **Padrão**: `false`
    - **Uso**: Para reuniões onde apenas áudio é necessário
  - **`transcription`** *(boolean, opcional)*: Gerar transcrição automática
    - **Padrão**: `true`
    - **Uso**: Para análise posterior do conteúdo

---

### **📊 Campos de Metadados**

#### **`metadata`** *(object, opcional)*
- **Descrição**: Informações adicionais sobre o job
- **Subcampos**:
  - **`created_at`** *(string, opcional)*: Timestamp de criação
    - **Formato**: ISO 8601 (ex: `"2025-09-29T15:30:00.000Z"`)
  - **`scheduled_at`** *(string, opcional)*: Timestamp agendado para início
    - **Formato**: ISO 8601 (ex: `"2025-09-29T16:00:00.000Z"`)
  - **`timezone`** *(string, opcional)*: Fuso horário
    - **Exemplo**: `"America/Sao_Paulo"`

#### **`callback_url`** *(string, opcional)*
- **Descrição**: URL para notificações de conclusão
- **Uso**: Webhook para notificar quando a gravação estiver pronta
- **Exemplo**: `"https://api.talksy.io/webhooks/recording-completed"`

---

## 🔄 **Fluxo de Processamento**

### **1. Envio pelo Backend**
```typescript
// Exemplo de implementação no backend
const sqsMessage = {
  job_id: randomUUID(),
  tenant_id: user.tenantId, // Do JWT ou banco de dados
  user_id: user.id,
  platform: "google_meet",
  bot_display_name: "Talksy Bot",
  meeting_info: {
    meeting_url: "https://meet.google.com/abc-defg-hij",
    platform: "google_meet",
    meeting_id: "abc-defg-hij",
    password: null
  },
  meeting_title: "Reunião de Planejamento Q4",
  automatic_leave: true,
  recording_settings: {
    quality: "720p",
    audio_only: false,
    transcription: true
  },
  metadata: {
    created_at: new Date().toISOString(),
    scheduled_at: new Date().toISOString(),
    timezone: "America/Sao_Paulo"
  },
  callback_url: "https://api.talksy.io/webhooks/recording-completed"
};
```

### **2. Processamento pelo MeetingBot Service**
- ✅ Validação dos campos obrigatórios
- ✅ Execução da gravação na plataforma especificada
- ✅ Upload para S3: `processed/{tenant_id}/{platform}/{job_id}/recording.mp4`
- ✅ Envio de notificação para fila de conclusão

### **3. Notificação de Conclusão**
```json
{
  "recording_id": "job_id_original",
  "tenant_id": "tenant_id_original",
  "user_id": "user_id_original",
  "platform": "platform_original",
  "meeting_title": "meeting_title_original",
  "status": "completed" | "failed",
  "s3_path": "processed/tenant_id/platform/job_id/recording.mp4",
  "duration_seconds": 1800,
  "file_size_bytes": 524288000,
  "error": "mensagem_de_erro_se_falhou",
  "completed_at": "2025-09-29T15:30:00.000Z",
  "metadata": {
    "bot_version": "1.0.0",
    "recording_quality": "720p"
  }
}
```

---

## ✅ **Validações Implementadas**

### **Campos Obrigatórios**
- `job_id`, `tenant_id`, `user_id`, `platform`, `meeting_info`, `meeting_title`

### **Validação de Plataforma**
- Aceita apenas: `google_meet`, `zoom`, `teams`, `webex`

### **Validação de Qualidade**
- Aceita apenas: `480p`, `720p`, `1080p`

### **Validação de URL**
- Verifica se `meeting_info.meeting_url` é uma URL válida

---

## 🚨 **Tratamento de Erros**

### **Mensagens Rejeitadas**
- Campos obrigatórios ausentes
- Plataforma não suportada
- URL inválida
- Formato JSON inválido

### **Dead Letter Queue**
- Mensagens que falham 3 vezes vão para `talksy-meetingbot-dlq.fifo`
- Permite análise e reprocessamento manual

---

## 📊 **Exemplos Práticos**

### **Exemplo 1: Google Meet Simples**
```json
{
  "job_id": "550e8400-e29b-41d4-a716-446655440000",
  "tenant_id": "company-abc-123",
  "user_id": "user-xyz-789",
  "platform": "google_meet",
  "meeting_info": {
    "meeting_url": "https://meet.google.com/abc-defg-hij",
    "platform": "google_meet",
    "meeting_id": "abc-defg-hij"
  },
  "meeting_title": "Daily Standup",
  "recording_settings": {
    "quality": "720p"
  }
}
```

### **Exemplo 2: Zoom com Senha**
```json
{
  "job_id": "660f9511-f40c-52e5-b827-557766551111",
  "tenant_id": "company-xyz-456",
  "user_id": "user-abc-123",
  "platform": "zoom",
  "bot_display_name": "Bot da Empresa XYZ",
  "meeting_info": {
    "meeting_url": "https://zoom.us/j/123456789?pwd=abcdef",
    "platform": "zoom",
    "meeting_id": "123456789",
    "password": "abcdef"
  },
  "meeting_title": "Reunião de Vendas",
  "automatic_leave": true,
  "recording_settings": {
    "quality": "1080p",
    "audio_only": false,
    "transcription": true
  },
  "metadata": {
    "created_at": "2025-09-29T15:30:00.000Z",
    "timezone": "America/Sao_Paulo"
  }
}
```

---

## 🔧 **Implementação no Backend**

### **1. Configuração SQS**
```typescript
import { SQSClient, SendMessageCommand } from "@aws-sdk/client-sqs";

const sqsClient = new SQSClient({ region: "us-east-1" });
const QUEUE_URL = "https://sqs.us-east-1.amazonaws.com/228692667167/talksy-meetingbot-jobs.fifo";
```

### **2. Função de Envio**
```typescript
async function sendRecordingJob(jobData: RecordingJobData) {
  const command = new SendMessageCommand({
    QueueUrl: QUEUE_URL,
    MessageBody: JSON.stringify(jobData),
    MessageAttributes: {
      tenant_id: {
        DataType: "String",
        StringValue: jobData.tenant_id
      },
      platform: {
        DataType: "String", 
        StringValue: jobData.platform
      }
    },
    MessageDeduplicationId: jobData.job_id,
    MessageGroupId: jobData.tenant_id
  });

  return await sqsClient.send(command);
}
```

---

## 📞 **Suporte**

Para dúvidas sobre implementação:
- **Documentação completa**: Este arquivo
- **Testes**: Use os exemplos fornecidos
- **Logs**: Verifique CloudWatch para debugging

**🎯 Com esta documentação, o backend pode implementar o envio de mensagens SQS de forma precisa e compatível com o MeetingBot Service!**
