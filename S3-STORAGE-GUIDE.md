# 📁 Guia de Armazenamento S3 - MeetingBot

## 🎯 **Visão Geral**

O MeetingBot salva todas as gravações de reuniões no Amazon S3 usando uma estrutura organizada por usuário, facilitando a listagem, busca e gestão de permissões.

---

## 📂 **Estrutura de Diretórios S3**

### **Bucket Principal**
```
talksy-videos-dev-0c18ea10
```

### **Estrutura de Pastas**

```
talksy-videos-dev-0c18ea10/
├── users/
│   ├── {email_sanitizado}/
│   │   └── recordings/
│   │       ├── {uuid}-{platform}-recording.mp4
│   │       ├── {uuid}-{platform}-recording.mp4
│   │       └── ...
│   ├── outro-usuario@exemplo.com/
│   │   └── recordings/
│   │       └── ...
│   └── ...
└── recordings/ (estrutura legada - fallback)
    └── {uuid}-{platform}-recording.mp4
```

---

## 🔑 **Formato do Path**

### **Estrutura Nova (Organizada por Usuário)**
```
users/{email_sanitizado}/recordings/{uuid}-{platform}-recording.{ext}
```

#### **Componentes:**
- **`{email_sanitizado}`**: Email do usuário com caracteres especiais substituídos por `_`
  - Regex: `/[^a-zA-Z0-9@._-]/g` → `_`
  - Exemplo: `test-user-456@talksy.io` → `test-user-456@talksy.io`
  - Exemplo: `user+tag@gmail.com` → `user_tag@gmail.com`

- **`{uuid}`**: UUID v4 único gerado no momento do upload
  - Exemplo: `914b427e-75e9-42f8-8b9b-bbf2c7ca338e`

- **`{platform}`**: Plataforma da reunião
  - Valores: `google`, `teams`, `zoom`

- **`{ext}`**: Extensão do arquivo
  - Padrão: `mp4` (vídeo)
  - Alternativa: `webm` (dependendo do formato)

#### **Exemplo Completo:**
```
users/test-user-456@talksy.io/recordings/914b427e-75e9-42f8-8b9b-bbf2c7ca338e-google-recording.mp4
```

### **Estrutura Legada (Fallback)**
Usada apenas quando `userEmail` não está disponível:
```
recordings/{uuid}-{platform}-recording.{ext}
```

---

## 🔐 **Segurança e Criptografia**

### **Encryption**
- **Tipo**: AWS KMS (Server-Side Encryption)
- **Header**: `ServerSideEncryption: 'aws:kms'`
- **Obrigatório**: Sim (requerido pela bucket policy)

### **Bucket Policy**
O bucket **bloqueia** uploads que não usem criptografia KMS:
```json
{
  "Sid": "DenyNonKMSEncryption",
  "Effect": "Deny",
  "Principal": "*",
  "Action": "s3:PutObject",
  "Resource": "arn:aws:s3:::talksy-videos-dev-0c18ea10/*",
  "Condition": {
    "StringNotEquals": {
      "s3:x-amz-server-side-encryption": "aws:kms"
    }
  }
}
```

### **Acesso**
- **IAM**: Requer permissões `s3:GetObject` e `s3:PutObject`
- **KMS**: Requer permissões de decrypt/encrypt na chave KMS do bucket

---

## 📨 **Completion Message (SQS)**

Quando o bot completa a gravação, envia uma mensagem para a fila:
**`talksy-recording-completed.fifo`**

### **Formato da Mensagem:**
```json
{
  "recording_id": "test-job-azy-odsf-qfe-1759453673",
  "tenant_id": "test-tenant-123",
  "user_id": "test-user-456",
  "s3_key_master": "users/test-user-456@talksy.io/recordings/914b427e-75e9-42f8-8b9b-bbf2c7ca338e-google-recording.mp4",
  "duration_sec": 0,
  "size_bytes": 0,
  "tracks": ["audio", "video"],
  "platform": "google_meet",
  "meeting_title": "Teste AWS Completo - Credenciais OK",
  "meeting_url": "https://meet.google.com/azy-odsf-qfe",
  "status": "completed",
  "error": null,
  "completed_at": "2025-10-03T01:09:02.123Z"
}
```

### **Message Attributes:**
```json
{
  "tenant_id": { "DataType": "String", "StringValue": "test-tenant-123" },
  "recording_id": { "DataType": "String", "StringValue": "test-job-..." },
  "status": { "DataType": "String", "StringValue": "completed" }
}
```

---

## 🔧 **Como o Backend Deve Consumir**

### **1. Consumir Fila SQS**

```javascript
import { SQSClient, ReceiveMessageCommand, DeleteMessageCommand } from '@aws-sdk/client-sqs';

const sqsClient = new SQSClient({ region: 'us-east-1' });

async function processCompletionMessages() {
  const command = new ReceiveMessageCommand({
    QueueUrl: 'https://sqs.us-east-1.amazonaws.com/228692667167/talksy-recording-completed.fifo',
    MaxNumberOfMessages: 10,
    WaitTimeSeconds: 20, // Long polling
    MessageAttributeNames: ['All']
  });

  const response = await sqsClient.send(command);
  
  for (const message of response.Messages || []) {
    const data = JSON.parse(message.Body);
    
    // Processar gravação
    await processRecording(data);
    
    // Deletar mensagem da fila
    await sqsClient.send(new DeleteMessageCommand({
      QueueUrl: '...',
      ReceiptHandle: message.ReceiptHandle
    }));
  }
}
```

### **2. Fazer Download do S3**

```javascript
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

const s3Client = new S3Client({ region: 'us-east-1' });

async function getRecordingUrl(s3Key) {
  // Opção 1: URL assinada (temporária, segura)
  const command = new GetObjectCommand({
    Bucket: 'talksy-videos-dev-0c18ea10',
    Key: s3Key
  });
  
  const signedUrl = await getSignedUrl(s3Client, command, {
    expiresIn: 3600 // 1 hora
  });
  
  return signedUrl;
}

// Opção 2: Download direto
async function downloadRecording(s3Key, localPath) {
  const command = new GetObjectCommand({
    Bucket: 'talksy-videos-dev-0c18ea10',
    Key: s3Key
  });
  
  const response = await s3Client.send(command);
  const stream = response.Body;
  
  // Salvar em arquivo ou processar stream
  const writeStream = fs.createWriteStream(localPath);
  stream.pipe(writeStream);
}
```

### **3. Listar Gravações por Usuário**

```javascript
import { S3Client, ListObjectsV2Command } from '@aws-sdk/client-s3';

const s3Client = new S3Client({ region: 'us-east-1' });

async function listUserRecordings(userEmail) {
  // Sanitizar email (mesmo processo do bot)
  const sanitizedEmail = userEmail.replace(/[^a-zA-Z0-9@._-]/g, '_');
  const prefix = `users/${sanitizedEmail}/recordings/`;
  
  const command = new ListObjectsV2Command({
    Bucket: 'talksy-videos-dev-0c18ea10',
    Prefix: prefix,
    MaxKeys: 1000
  });
  
  const response = await s3Client.send(command);
  
  const recordings = (response.Contents || []).map(obj => ({
    key: obj.Key,
    size: obj.Size,
    lastModified: obj.LastModified,
    // Extrair informações do nome do arquivo
    uuid: obj.Key.split('/').pop().split('-')[0],
    platform: obj.Key.includes('-google-') ? 'google' : 
              obj.Key.includes('-teams-') ? 'teams' : 
              obj.Key.includes('-zoom-') ? 'zoom' : 'unknown',
    filename: obj.Key.split('/').pop()
  }));
  
  return recordings;
}
```

### **4. Exemplo Completo: Processar Completion**

```javascript
async function processRecording(completionData) {
  const {
    recording_id,
    user_id,
    s3_key_master,
    platform,
    meeting_title,
    meeting_url,
    status,
    completed_at,
    tenant_id
  } = completionData;
  
  if (status !== 'completed') {
    console.error(`Recording ${recording_id} failed`);
    return;
  }
  
  // 1. Salvar metadados no banco de dados
  await db.recordings.create({
    id: recording_id,
    userId: user_id,
    tenantId: tenant_id,
    s3Key: s3_key_master,
    platform,
    meetingTitle: meeting_title,
    meetingUrl: meeting_url,
    completedAt: new Date(completed_at),
    status: 'completed'
  });
  
  // 2. Gerar URL assinada para o usuário acessar
  const signedUrl = await getRecordingUrl(s3_key_master);
  
  // 3. Enviar notificação ao usuário
  await sendNotification(user_id, {
    title: 'Gravação Pronta',
    message: `Sua gravação "${meeting_title}" está disponível`,
    url: signedUrl
  });
  
  // 4. (Opcional) Processar vídeo (transcrição, etc)
  await queueVideoProcessing(recording_id, s3_key_master);
}
```

---

## 🔍 **Consultas Úteis**

### **Listar todas as gravações de um usuário (AWS CLI)**
```bash
aws s3 ls s3://talksy-videos-dev-0c18ea10/users/usuario@exemplo.com/recordings/ \
  --recursive \
  --human-readable \
  --region us-east-1
```

### **Download de uma gravação específica**
```bash
aws s3 cp \
  s3://talksy-videos-dev-0c18ea10/users/usuario@exemplo.com/recordings/uuid-google-recording.mp4 \
  ./local-file.mp4 \
  --region us-east-1
```

### **Gerar URL assinada (CLI)**
```bash
aws s3 presign \
  s3://talksy-videos-dev-0c18ea10/users/usuario@exemplo.com/recordings/uuid-google-recording.mp4 \
  --expires-in 3600 \
  --region us-east-1
```

### **Contar gravações por usuário**
```bash
aws s3 ls s3://talksy-videos-dev-0c18ea10/users/usuario@exemplo.com/recordings/ \
  --recursive \
  --region us-east-1 | wc -l
```

### **Calcular tamanho total de gravações de um usuário**
```bash
aws s3 ls s3://talksy-videos-dev-0c18ea10/users/usuario@exemplo.com/recordings/ \
  --recursive \
  --region us-east-1 \
  --summarize | grep "Total Size"
```

---

## 🛡️ **Políticas de Acesso Recomendadas**

### **Backend IAM Policy (Leitura)**
```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "s3:GetObject",
        "s3:ListBucket"
      ],
      "Resource": [
        "arn:aws:s3:::talksy-videos-dev-0c18ea10",
        "arn:aws:s3:::talksy-videos-dev-0c18ea10/*"
      ]
    },
    {
      "Effect": "Allow",
      "Action": [
        "kms:Decrypt"
      ],
      "Resource": "*"
    }
  ]
}
```

### **Acesso Restrito por Usuário**
Para implementar acesso isolado por usuário:
```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": ["s3:GetObject", "s3:ListBucket"],
      "Resource": [
        "arn:aws:s3:::talksy-videos-dev-0c18ea10",
        "arn:aws:s3:::talksy-videos-dev-0c18ea10/users/${aws:username}/*"
      ]
    }
  ]
}
```

---

## 📊 **Estrutura da Completion Message**

### **Campos Principais:**

| Campo | Tipo | Descrição | Exemplo |
|-------|------|-----------|---------|
| `recording_id` | string | ID único da gravação (job_id) | `test-job-azy-odsf-qfe-1759453673` |
| `tenant_id` | string | ID do tenant/organização | `test-tenant-123` |
| `user_id` | string | ID do usuário | `test-user-456` |
| `s3_key_master` | string | Path completo no S3 | `users/test-user-456@talksy.io/recordings/...` |
| `duration_sec` | number | Duração em segundos (TODO) | `0` |
| `size_bytes` | number | Tamanho em bytes (TODO) | `0` |
| `tracks` | array | Tipos de mídia | `["audio", "video"]` |
| `platform` | string | Plataforma | `google_meet`, `teams`, `zoom` |
| `meeting_title` | string | Título da reunião | `Teste AWS Completo` |
| `meeting_url` | string | URL da reunião | `https://meet.google.com/...` |
| `status` | string | Status final | `completed` ou `failed` |
| `error` | string\|null | Mensagem de erro (se falhou) | `null` |
| `completed_at` | string | Timestamp ISO 8601 | `2025-10-03T01:09:02.123Z` |

---

## 💡 **Boas Práticas para o Backend**

### **1. Consumir Fila com Long Polling**
```javascript
// ✅ BOM: Long polling (reduz custos)
const params = {
  QueueUrl: COMPLETION_QUEUE_URL,
  WaitTimeSeconds: 20, // Long polling
  MaxNumberOfMessages: 10
};

// ❌ RUIM: Short polling (aumenta custos)
const params = {
  QueueUrl: COMPLETION_QUEUE_URL,
  WaitTimeSeconds: 0 // Evitar!
};
```

### **2. Deletar Mensagens Após Processar**
```javascript
// Sempre deletar mensagem após processar com sucesso
await sqsClient.send(new DeleteMessageCommand({
  QueueUrl: COMPLETION_QUEUE_URL,
  ReceiptHandle: message.ReceiptHandle
}));
```

### **3. Usar Presigned URLs**
```javascript
// ✅ Gerar URL temporária (segura)
const signedUrl = await getSignedUrl(s3Client, getCommand, {
  expiresIn: 3600 // 1 hora
});

// ❌ Não expor credenciais AWS ao frontend
```

### **4. Implementar Retry Logic**
```javascript
// Para processar mensagens que falharam
const MAX_RETRIES = 3;

async function processWithRetry(message) {
  for (let i = 0; i < MAX_RETRIES; i++) {
    try {
      await processRecording(message);
      return true;
    } catch (error) {
      console.error(`Attempt ${i+1} failed:`, error);
      if (i === MAX_RETRIES - 1) throw error;
      await sleep(1000 * Math.pow(2, i)); // Exponential backoff
    }
  }
}
```

### **5. Validar S3 Key**
```javascript
function validateS3Key(s3Key) {
  // Verificar se segue o padrão esperado
  const pattern = /^users\/[^\/]+\/recordings\/[a-f0-9-]+-(?:google|teams|zoom)-recording\.(mp4|webm)$/;
  return pattern.test(s3Key);
}
```

---

## 📈 **Queries do Banco de Dados**

### **Schema Recomendado:**
```sql
CREATE TABLE recordings (
  id VARCHAR(255) PRIMARY KEY, -- recording_id
  user_id VARCHAR(255) NOT NULL,
  tenant_id VARCHAR(255) NOT NULL,
  s3_key TEXT NOT NULL,
  platform VARCHAR(50) NOT NULL,
  meeting_title TEXT,
  meeting_url TEXT,
  duration_sec INTEGER DEFAULT 0,
  size_bytes BIGINT DEFAULT 0,
  status VARCHAR(50) NOT NULL, -- 'completed', 'failed', 'processing'
  error TEXT,
  completed_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  
  INDEX idx_user_id (user_id),
  INDEX idx_tenant_id (tenant_id),
  INDEX idx_completed_at (completed_at),
  INDEX idx_status (status)
);
```

### **Queries Úteis:**

#### **Listar gravações de um usuário:**
```sql
SELECT 
  id,
  meeting_title,
  platform,
  s3_key,
  completed_at,
  duration_sec
FROM recordings
WHERE user_id = 'test-user-456'
  AND status = 'completed'
ORDER BY completed_at DESC
LIMIT 50;
```

#### **Estatísticas por usuário:**
```sql
SELECT 
  user_id,
  COUNT(*) as total_recordings,
  SUM(size_bytes) as total_size_bytes,
  SUM(duration_sec) as total_duration_sec,
  MIN(completed_at) as first_recording,
  MAX(completed_at) as last_recording
FROM recordings
WHERE status = 'completed'
GROUP BY user_id;
```

#### **Gravações recentes (últimas 24h):**
```sql
SELECT *
FROM recordings
WHERE completed_at >= NOW() - INTERVAL '24 hours'
  AND status = 'completed'
ORDER BY completed_at DESC;
```

---

## 🎨 **API REST Exemplo**

### **GET /api/recordings**
Lista gravações do usuário autenticado:
```javascript
app.get('/api/recordings', authenticate, async (req, res) => {
  const userId = req.user.id;
  const userEmail = req.user.email;
  
  // Buscar do banco
  const recordings = await db.recordings.findMany({
    where: { user_id: userId, status: 'completed' },
    orderBy: { completed_at: 'desc' },
    take: 50
  });
  
  // Gerar URLs assinadas
  const recordingsWithUrls = await Promise.all(
    recordings.map(async (rec) => ({
      ...rec,
      url: await getRecordingUrl(rec.s3_key),
      thumbnail: await getThumbnailUrl(rec.s3_key) // Se gerar thumbnails
    }))
  );
  
  res.json(recordingsWithUrls);
});
```

### **GET /api/recordings/:id**
Obter uma gravação específica:
```javascript
app.get('/api/recordings/:id', authenticate, async (req, res) => {
  const recording = await db.recordings.findUnique({
    where: { id: req.params.id }
  });
  
  // Verificar se usuário tem acesso
  if (recording.user_id !== req.user.id) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  
  const signedUrl = await getRecordingUrl(recording.s3_key);
  
  res.json({
    ...recording,
    url: signedUrl
  });
});
```

### **DELETE /api/recordings/:id**
Deletar gravação:
```javascript
app.delete('/api/recordings/:id', authenticate, async (req, res) => {
  const recording = await db.recordings.findUnique({
    where: { id: req.params.id }
  });
  
  if (recording.user_id !== req.user.id) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  
  // Deletar do S3
  await s3Client.send(new DeleteObjectCommand({
    Bucket: 'talksy-videos-dev-0c18ea10',
    Key: recording.s3_key
  }));
  
  // Deletar do banco
  await db.recordings.delete({
    where: { id: req.params.id }
  });
  
  res.json({ success: true });
});
```

---

## 🔄 **Lifecycle e Archiving**

### **S3 Lifecycle Policy (Recomendado)**
Para economizar custos, mover gravações antigas para storage classes mais baratas:

```json
{
  "Rules": [
    {
      "Id": "ArchiveOldRecordings",
      "Status": "Enabled",
      "Prefix": "users/",
      "Transitions": [
        {
          "Days": 30,
          "StorageClass": "STANDARD_IA"
        },
        {
          "Days": 90,
          "StorageClass": "GLACIER"
        }
      ]
    }
  ]
}
```

**Economia potencial**: 40-60% dos custos de storage após 30 dias

---

## 🚨 **Troubleshooting**

### **Problema: Gravação não encontrada no S3**
```javascript
// Verificar se arquivo existe
const command = new HeadObjectCommand({
  Bucket: 'talksy-videos-dev-0c18ea10',
  Key: s3_key
});

try {
  await s3Client.send(command);
  console.log('Arquivo existe');
} catch (error) {
  if (error.name === 'NotFound') {
    console.error('Arquivo não encontrado no S3');
  }
}
```

### **Problema: Erro de permissão KMS**
```bash
# Verificar permissões KMS
aws kms describe-key \
  --key-id alias/aws/s3 \
  --region us-east-1

# Garantir que o usuário IAM tem permissão kms:Decrypt
```

### **Problema: Path incorreto**
```javascript
// Sempre sanitizar email antes de buscar
function getUserS3Prefix(email) {
  const sanitized = email.replace(/[^a-zA-Z0-9@._-]/g, '_');
  return `users/${sanitized}/recordings/`;
}
```

---

## 📦 **Metadados Adicionais (Futuro)**

### **Speaker Timeframes**
O bot captura quando cada participante fala:
```json
{
  "speakerTimeframes": [
    {
      "speakerName": "Lincoln Matos",
      "start": 1759453772408,
      "end": 1759453782001
    }
  ]
}
```

Isso pode ser usado para:
- Gerar transcrições com timestamps
- Criar highlights automáticos
- Análise de participação

---

## 🎯 **Resumo Rápido**

✅ **Path S3**: `users/{email}/recordings/{uuid}-{platform}-recording.mp4`  
✅ **Criptografia**: KMS obrigatória  
✅ **Notificação**: SQS `talksy-recording-completed.fifo`  
✅ **Acesso**: Presigned URLs (temporárias)  
✅ **Organização**: Por usuário (fácil busca e permissões)  

**📚 Para mais detalhes, veja o código em `src/meetingbot-service/bots/src/s3.ts`**

