# 📁 Estrutura S3 - Exemplo Real

## 🎯 **Gravação Atual Salva**

### **Path Completo:**
```
s3://talksy-videos-dev-0c18ea10/users/test-user-456@talksy.io/recordings/914b427e-75e9-42f8-8b9b-bbf2c7ca338e-google-recording.mp4
```

### **Decomposição:**
```
Bucket:   talksy-videos-dev-0c18ea10
Prefix:   users/test-user-456@talksy.io/recordings/
UUID:     914b427e-75e9-42f8-8b9b-bbf2c7ca338e
Platform: google
Ext:      mp4
```

### **Metadados:**
- **Tamanho**: 374.0 KiB (382,947 bytes)
- **Content-Type**: `video/mp4`
- **Encryption**: `aws:kms` ✅
- **Last Modified**: `2025-10-03T01:09:56Z`

---

## 🔍 **Como Backend Deve Buscar**

### **Opção 1: Por User ID (via Banco de Dados)**
```sql
SELECT s3_key, meeting_title, completed_at
FROM recordings
WHERE user_id = 'test-user-456'
  AND status = 'completed'
ORDER BY completed_at DESC;
```

**Resultado:**
```json
[
  {
    "s3_key": "users/test-user-456@talksy.io/recordings/914b427e-75e9-42f8-8b9b-bbf2c7ca338e-google-recording.mp4",
    "meeting_title": "Teste AWS Completo - Credenciais OK",
    "completed_at": "2025-10-03T01:09:56Z"
  }
]
```

### **Opção 2: Diretamente do S3**
```javascript
const userEmail = 'test-user-456@talksy.io';
const prefix = `users/${userEmail}/recordings/`;

const recordings = await s3Client.send(new ListObjectsV2Command({
  Bucket: 'talksy-videos-dev-0c18ea10',
  Prefix: prefix
}));

// recordings.Contents = [
//   {
//     Key: 'users/test-user-456@talksy.io/recordings/914b427e-75e9-42f8-8b9b-bbf2c7ca338e-google-recording.mp4',
//     Size: 382947,
//     LastModified: '2025-10-03T01:09:56.000Z'
//   }
// ]
```

---

## 🔐 **Gerar URL Segura para Frontend**

### **Backend gera URL temporária:**
```javascript
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { GetObjectCommand } from '@aws-sdk/client-s3';

async function getVideoUrl(recordingId, userId) {
  // 1. Buscar gravação do banco
  const recording = await db.recording.findUnique({
    where: { id: recordingId }
  });
  
  // 2. Verificar permissão
  if (recording.user_id !== userId) {
    throw new Error('Forbidden');
  }
  
  // 3. Gerar URL assinada
  const command = new GetObjectCommand({
    Bucket: 'talksy-videos-dev-0c18ea10',
    Key: recording.s3_key
  });
  
  const url = await getSignedUrl(s3Client, command, {
    expiresIn: 7200 // 2 horas
  });
  
  return url;
}
```

### **Frontend consome URL:**
```html
<!-- HTML5 Video Player -->
<video controls width="800">
  <source src="{URL_ASSINADA_DO_BACKEND}" type="video/mp4">
  Seu navegador não suporta vídeo HTML5.
</video>

<!-- Ou React -->
<VideoPlayer src={signedUrl} />
```

---

## 📨 **Completion Message Real**

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

### **O Backend Recebe Isso Via:**
**Fila SQS**: `talksy-recording-completed.fifo`

---

## 🛠️ **Implementação Recomendada**

### **1. Worker SQS (Background Process)**
```typescript
// workers/recording-completion.ts
import { SQSClient, ReceiveMessageCommand, DeleteMessageCommand } from '@aws-sdk/client-sqs';

const QUEUE_URL = 'https://sqs.us-east-1.amazonaws.com/228692667167/talksy-recording-completed.fifo';

export async function startRecordingCompletionWorker() {
  console.log('🚀 Starting Recording Completion Worker...');
  
  while (true) {
    try {
      const messages = await receiveMessages();
      
      for (const message of messages) {
        await processMessage(message);
      }
    } catch (error) {
      console.error('Worker error:', error);
      await sleep(5000);
    }
  }
}

async function receiveMessages() {
  const response = await sqsClient.send(new ReceiveMessageCommand({
    QueueUrl: QUEUE_URL,
    MaxNumberOfMessages: 10,
    WaitTimeSeconds: 20,
    MessageAttributeNames: ['All']
  }));
  
  return response.Messages || [];
}

async function processMessage(message) {
  const data = JSON.parse(message.Body);
  
  console.log(`📨 Processing: ${data.recording_id}`);
  
  // Salvar no banco
  await db.recording.create({
    data: {
      id: data.recording_id,
      userId: data.user_id,
      tenantId: data.tenant_id,
      s3Key: data.s3_key_master,
      platform: data.platform,
      meetingTitle: data.meeting_title,
      meetingUrl: data.meeting_url,
      status: data.status,
      completedAt: new Date(data.completed_at)
    }
  });
  
  // Notificar usuário
  await notifyUser(data.user_id, data);
  
  // Deletar da fila
  await sqsClient.send(new DeleteMessageCommand({
    QueueUrl: QUEUE_URL,
    ReceiptHandle: message.ReceiptHandle
  }));
  
  console.log(`✅ Processed: ${data.recording_id}`);
}
```

### **2. API Endpoints**
```typescript
// routes/recordings.ts
import express from 'express';

const router = express.Router();

// GET /api/recordings
router.get('/', authenticate, async (req, res) => {
  const recordings = await db.recording.findMany({
    where: { 
      userId: req.user.id,
      status: 'completed'
    },
    orderBy: { completedAt: 'desc' },
    take: 50
  });
  
  // Gerar URLs assinadas
  const withUrls = await Promise.all(
    recordings.map(async (rec) => ({
      id: rec.id,
      title: rec.meetingTitle,
      platform: rec.platform,
      completedAt: rec.completedAt,
      url: await generatePresignedUrl(rec.s3Key)
    }))
  );
  
  res.json({ recordings: withUrls });
});

// GET /api/recordings/:id
router.get('/:id', authenticate, async (req, res) => {
  const recording = await db.recording.findUnique({
    where: { id: req.params.id }
  });
  
  if (!recording || recording.userId !== req.user.id) {
    return res.status(404).json({ error: 'Not found' });
  }
  
  const signedUrl = await generatePresignedUrl(recording.s3Key);
  
  res.json({
    ...recording,
    url: signedUrl
  });
});
```

---

## 📊 **Exemplo de Resposta da API**

### **GET /api/recordings**
```json
{
  "recordings": [
    {
      "id": "test-job-azy-odsf-qfe-1759453673",
      "title": "Teste AWS Completo - Credenciais OK",
      "platform": "google_meet",
      "completedAt": "2025-10-03T01:09:56.000Z",
      "url": "https://talksy-videos-dev-0c18ea10.s3.us-east-1.amazonaws.com/users/test-user-456%40talksy.io/recordings/914b427e-75e9-42f8-8b9b-bbf2c7ca338e-google-recording.mp4?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Credential=...&X-Amz-Expires=7200&..."
    }
  ],
  "pagination": {
    "page": 1,
    "pageSize": 20,
    "total": 1,
    "totalPages": 1
  }
}
```

---

## 🎨 **Frontend React Exemplo**

```tsx
import React, { useEffect, useState } from 'react';

function RecordingsList() {
  const [recordings, setRecordings] = useState([]);
  
  useEffect(() => {
    fetchRecordings();
  }, []);
  
  async function fetchRecordings() {
    const response = await fetch('/api/recordings', {
      headers: {
        'Authorization': `Bearer ${token}`
      }
    });
    
    const data = await response.json();
    setRecordings(data.recordings);
  }
  
  return (
    <div>
      <h1>Minhas Gravações</h1>
      {recordings.map(rec => (
        <div key={rec.id}>
          <h3>{rec.title}</h3>
          <p>Plataforma: {rec.platform}</p>
          <p>Data: {new Date(rec.completedAt).toLocaleString()}</p>
          <video controls src={rec.url} width="600" />
        </div>
      ))}
    </div>
  );
}
```

---

## ✅ **Resumo Rápido**

### **Estrutura:**
```
users/{email}/recordings/{uuid}-{platform}-recording.mp4
```

### **Backend Consome:**
1. ✅ Polling na fila SQS `talksy-recording-completed.fifo`
2. ✅ Salva metadados no PostgreSQL
3. ✅ Gera presigned URLs para frontend
4. ✅ Notifica usuário

### **Segurança:**
- ✅ Criptografia KMS
- ✅ URLs temporárias
- ✅ Validação de permissões
- ✅ Isolamento por usuário

---

**🚀 Sistema pronto para integração com qualquer backend!**

