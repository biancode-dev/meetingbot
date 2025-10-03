# 🔌 Exemplos de Integração Backend - MeetingBot

## 🎯 **Fluxo Completo de Integração**

```
Backend → SQS (Jobs) → MeetingBot Service → Bot → S3 Upload → SQS (Completion) → Backend
```

---

## 1️⃣ **Enviar Bot para Reunião**

### **Node.js/TypeScript**
```typescript
import { SQSClient, SendMessageCommand } from '@aws-sdk/client-sqs';

const sqsClient = new SQSClient({ 
  region: 'us-east-1',
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
  }
});

async function sendBotToMeeting(meetingData) {
  const jobMessage = {
    job_id: `job-${Date.now()}-${Math.random().toString(36)}`,
    tenant_id: meetingData.tenantId,
    user_id: meetingData.userId,
    platform: 'google_meet', // ou 'teams', 'zoom'
    bot_display_name: 'Recording Bot',
    meeting_info: {
      meeting_url: meetingData.meetingUrl,
      platform: 'google_meet',
      meeting_id: extractMeetingId(meetingData.meetingUrl),
      password: meetingData.password || null
    },
    meeting_title: meetingData.title,
    automatic_leave: true,
    recording_settings: {
      quality: '720p',
      audio_only: false,
      transcription: true
    },
    metadata: {
      created_at: new Date().toISOString(),
      scheduled_at: meetingData.scheduledAt || new Date().toISOString(),
      timezone: 'America/Sao_Paulo'
    },
    callback_url: 'https://api.talksy.io/webhooks/recording-completed'
  };

  const command = new SendMessageCommand({
    QueueUrl: 'https://sqs.us-east-1.amazonaws.com/228692667167/talksy-meetingbot-jobs.fifo',
    MessageBody: JSON.stringify(jobMessage),
    MessageGroupId: jobMessage.tenant_id,
    MessageDeduplicationId: jobMessage.job_id
  });

  const result = await sqsClient.send(command);
  
  return {
    jobId: jobMessage.job_id,
    messageId: result.MessageId
  };
}

function extractMeetingId(url) {
  // Google Meet: https://meet.google.com/abc-defg-hij
  const match = url.match(/meet\.google\.com\/([a-z]+-[a-z]+-[a-z]+)/);
  return match ? match[1] : url;
}
```

### **Python**
```python
import boto3
import json
from datetime import datetime
import random
import string

sqs = boto3.client('sqs', region_name='us-east-1')

def send_bot_to_meeting(meeting_data):
    job_id = f"job-{int(datetime.now().timestamp())}-{''.join(random.choices(string.ascii_lowercase, k=6))}"
    
    job_message = {
        'job_id': job_id,
        'tenant_id': meeting_data['tenant_id'],
        'user_id': meeting_data['user_id'],
        'platform': 'google_meet',
        'bot_display_name': 'Recording Bot',
        'meeting_info': {
            'meeting_url': meeting_data['meeting_url'],
            'platform': 'google_meet',
            'meeting_id': extract_meeting_id(meeting_data['meeting_url']),
            'password': meeting_data.get('password')
        },
        'meeting_title': meeting_data['title'],
        'automatic_leave': True,
        'recording_settings': {
            'quality': '720p',
            'audio_only': False,
            'transcription': True
        },
        'metadata': {
            'created_at': datetime.utcnow().isoformat() + 'Z',
            'scheduled_at': meeting_data.get('scheduled_at', datetime.utcnow().isoformat() + 'Z'),
            'timezone': 'America/Sao_Paulo'
        },
        'callback_url': 'https://api.talksy.io/webhooks/recording-completed'
    }
    
    response = sqs.send_message(
        QueueUrl='https://sqs.us-east-1.amazonaws.com/228692667167/talksy-meetingbot-jobs.fifo',
        MessageBody=json.dumps(job_message),
        MessageGroupId=job_message['tenant_id'],
        MessageDeduplicationId=job_message['job_id']
    )
    
    return {
        'job_id': job_id,
        'message_id': response['MessageId']
    }
```

---

## 2️⃣ **Processar Completion Messages**

### **Node.js/TypeScript - Worker Contínuo**
```typescript
import { SQSClient, ReceiveMessageCommand, DeleteMessageCommand } from '@aws-sdk/client-sqs';
import { S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

const sqsClient = new SQSClient({ region: 'us-east-1' });
const s3Client = new S3Client({ region: 'us-east-1' });

async function startCompletionWorker() {
  console.log('🚀 Starting completion worker...');
  
  while (true) {
    try {
      const command = new ReceiveMessageCommand({
        QueueUrl: 'https://sqs.us-east-1.amazonaws.com/228692667167/talksy-recording-completed.fifo',
        MaxNumberOfMessages: 10,
        WaitTimeSeconds: 20, // Long polling
        MessageAttributeNames: ['All'],
        AttributeNames: ['All']
      });

      const response = await sqsClient.send(command);
      
      if (!response.Messages || response.Messages.length === 0) {
        continue; // No messages, continue polling
      }

      // Processar mensagens em paralelo
      await Promise.all(
        response.Messages.map(message => processCompletionMessage(message))
      );

    } catch (error) {
      console.error('Error in completion worker:', error);
      await sleep(5000); // Wait before retry
    }
  }
}

async function processCompletionMessage(message) {
  try {
    const data = JSON.parse(message.Body);
    
    console.log(`📨 Processing recording: ${data.recording_id}`);
    
    if (data.status === 'completed') {
      // 1. Salvar no banco de dados
      await saveRecordingToDatabase(data);
      
      // 2. Gerar URL assinada
      const signedUrl = await generatePresignedUrl(data.s3_key_master);
      
      // 3. Notificar usuário
      await notifyUser(data.user_id, {
        recordingId: data.recording_id,
        title: data.meeting_title,
        url: signedUrl,
        platform: data.platform,
        completedAt: data.completed_at
      });
      
      // 4. (Opcional) Processar vídeo
      await queueVideoProcessing(data);
      
    } else {
      console.error(`Recording failed: ${data.error}`);
      await handleFailedRecording(data);
    }
    
    // Deletar mensagem da fila
    await sqsClient.send(new DeleteMessageCommand({
      QueueUrl: 'https://sqs.us-east-1.amazonaws.com/228692667167/talksy-recording-completed.fifo',
      ReceiptHandle: message.ReceiptHandle
    }));
    
    console.log(`✅ Processed: ${data.recording_id}`);
    
  } catch (error) {
    console.error('Error processing message:', error);
    // Mensagem volta para fila após visibility timeout
  }
}

async function saveRecordingToDatabase(data) {
  return await db.recording.create({
    data: {
      id: data.recording_id,
      userId: data.user_id,
      tenantId: data.tenant_id,
      s3Key: data.s3_key_master,
      platform: data.platform,
      meetingTitle: data.meeting_title,
      meetingUrl: data.meeting_url,
      durationSec: data.duration_sec,
      sizeBytes: data.size_bytes,
      status: data.status,
      completedAt: new Date(data.completed_at)
    }
  });
}

async function generatePresignedUrl(s3Key) {
  const command = new GetObjectCommand({
    Bucket: 'talksy-videos-dev-0c18ea10',
    Key: s3Key
  });
  
  return await getSignedUrl(s3Client, command, {
    expiresIn: 7200 // 2 horas
  });
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
```

---

## 3️⃣ **Listar Gravações por Usuário**

### **Com Paginação e Filtros**
```typescript
interface ListRecordingsParams {
  userId: string;
  page?: number;
  pageSize?: number;
  platform?: 'google' | 'teams' | 'zoom';
  startDate?: Date;
  endDate?: Date;
}

async function listUserRecordings(params: ListRecordingsParams) {
  const {
    userId,
    page = 1,
    pageSize = 20,
    platform,
    startDate,
    endDate
  } = params;

  // Build query
  let query = db.recording.findMany({
    where: {
      user_id: userId,
      status: 'completed',
      ...(platform && { platform }),
      ...(startDate && endDate && {
        completed_at: {
          gte: startDate,
          lte: endDate
        }
      })
    },
    orderBy: { completed_at: 'desc' },
    skip: (page - 1) * pageSize,
    take: pageSize
  });

  const recordings = await query;
  const total = await db.recording.count({
    where: { user_id: userId, status: 'completed' }
  });

  // Gerar URLs assinadas
  const recordingsWithUrls = await Promise.all(
    recordings.map(async (rec) => ({
      id: rec.id,
      title: rec.meeting_title,
      platform: rec.platform,
      completedAt: rec.completed_at,
      duration: rec.duration_sec,
      size: rec.size_bytes,
      url: await generatePresignedUrl(rec.s3_key)
    }))
  );

  return {
    recordings: recordingsWithUrls,
    pagination: {
      page,
      pageSize,
      total,
      totalPages: Math.ceil(total / pageSize)
    }
  };
}
```

---

## 4️⃣ **Webhook Handler (Alternativa ao SQS)**

Se preferir usar webhooks em vez de polling SQS:

```typescript
import express from 'express';
import crypto from 'crypto';

const app = express();

// Middleware para validar assinatura do webhook
function validateWebhookSignature(req, res, next) {
  const signature = req.headers['x-webhook-signature'];
  const secret = process.env.WEBHOOK_SECRET;
  
  const hash = crypto
    .createHmac('sha256', secret)
    .update(JSON.stringify(req.body))
    .digest('hex');
  
  if (hash !== signature) {
    return res.status(401).json({ error: 'Invalid signature' });
  }
  
  next();
}

app.post('/webhooks/recording-completed', 
  express.json(),
  validateWebhookSignature,
  async (req, res) => {
    try {
      const completionData = req.body;
      
      // Processar assincronamente
      processCompletionMessage({ Body: JSON.stringify(completionData) })
        .catch(err => console.error('Error processing webhook:', err));
      
      // Responder imediatamente
      res.json({ received: true });
      
    } catch (error) {
      console.error('Webhook error:', error);
      res.status(500).json({ error: 'Internal error' });
    }
  }
);
```

---

## 5️⃣ **Busca Avançada de Gravações**

### **Busca por Texto (Meeting Title)**
```typescript
async function searchRecordings(userId: string, searchTerm: string) {
  return await db.recording.findMany({
    where: {
      user_id: userId,
      status: 'completed',
      OR: [
        { meeting_title: { contains: searchTerm, mode: 'insensitive' } },
        { meeting_url: { contains: searchTerm } }
      ]
    },
    orderBy: { completed_at: 'desc' },
    take: 50
  });
}
```

### **Busca por Data**
```typescript
async function getRecordingsByDateRange(userId: string, startDate: Date, endDate: Date) {
  return await db.recording.findMany({
    where: {
      user_id: userId,
      status: 'completed',
      completed_at: {
        gte: startDate,
        lte: endDate
      }
    },
    orderBy: { completed_at: 'desc' }
  });
}
```

### **Estatísticas do Usuário**
```typescript
async function getUserRecordingStats(userId: string) {
  const stats = await db.recording.aggregate({
    where: { user_id: userId, status: 'completed' },
    _count: { id: true },
    _sum: { 
      duration_sec: true,
      size_bytes: true 
    }
  });

  return {
    totalRecordings: stats._count.id,
    totalDurationSeconds: stats._sum.duration_sec || 0,
    totalSizeBytes: stats._sum.size_bytes || 0,
    totalSizeMB: Math.round((stats._sum.size_bytes || 0) / 1024 / 1024)
  };
}
```

---

## 6️⃣ **Gerenciamento de Quotas**

### **Verificar Quota do Usuário**
```typescript
async function checkUserQuota(userId: string) {
  const stats = await getUserRecordingStats(userId);
  const user = await db.user.findUnique({ where: { id: userId } });
  
  const quotas = {
    maxRecordings: user.plan === 'pro' ? 1000 : 100,
    maxStorageMB: user.plan === 'pro' ? 50000 : 5000,
    maxDurationHours: user.plan === 'pro' ? 500 : 50
  };

  return {
    used: {
      recordings: stats.totalRecordings,
      storageMB: stats.totalSizeMB,
      durationHours: Math.round(stats.totalDurationSeconds / 3600)
    },
    limits: quotas,
    available: {
      recordings: quotas.maxRecordings - stats.totalRecordings,
      storageMB: quotas.maxStorageMB - stats.totalSizeMB,
      durationHours: quotas.maxDurationHours - Math.round(stats.totalDurationSeconds / 3600)
    },
    percentUsed: {
      recordings: (stats.totalRecordings / quotas.maxRecordings) * 100,
      storage: (stats.totalSizeMB / quotas.maxStorageMB) * 100
    }
  };
}
```

---

## 7️⃣ **Download e Streaming**

### **Download Direto**
```typescript
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { pipeline } from 'stream/promises';
import fs from 'fs';

async function downloadRecording(s3Key: string, localPath: string) {
  const command = new GetObjectCommand({
    Bucket: 'talksy-videos-dev-0c18ea10',
    Key: s3Key
  });

  const response = await s3Client.send(command);
  
  await pipeline(
    response.Body as NodeJS.ReadableStream,
    fs.createWriteStream(localPath)
  );
  
  console.log(`✅ Downloaded to: ${localPath}`);
}
```

### **Streaming para Cliente**
```typescript
import express from 'express';

app.get('/api/recordings/:id/stream', authenticate, async (req, res) => {
  const recording = await db.recording.findUnique({
    where: { id: req.params.id }
  });

  if (recording.user_id !== req.user.id) {
    return res.status(403).json({ error: 'Forbidden' });
  }

  const command = new GetObjectCommand({
    Bucket: 'talksy-videos-dev-0c18ea10',
    Key: recording.s3_key
  });

  const s3Response = await s3Client.send(command);
  
  // Set headers para streaming de vídeo
  res.setHeader('Content-Type', 'video/mp4');
  res.setHeader('Content-Length', s3Response.ContentLength);
  res.setHeader('Accept-Ranges', 'bytes');
  
  // Stream do S3 para cliente
  s3Response.Body.pipe(res);
});
```

---

## 8️⃣ **Gerenciamento de Permissões**

### **Verificar Acesso a Gravação**
```typescript
async function canUserAccessRecording(userId: string, recordingId: string): Promise<boolean> {
  const recording = await db.recording.findUnique({
    where: { id: recordingId },
    include: { 
      user: true,
      sharedWith: true // Se implementar compartilhamento
    }
  });

  if (!recording) return false;
  
  // Dono do arquivo
  if (recording.user_id === userId) return true;
  
  // Compartilhado com o usuário
  if (recording.sharedWith?.some(share => share.user_id === userId)) {
    return true;
  }
  
  // Admin do tenant
  const user = await db.user.findUnique({ where: { id: userId } });
  if (user.role === 'admin' && user.tenant_id === recording.tenant_id) {
    return true;
  }
  
  return false;
}
```

---

## 9️⃣ **Exemplo Completo: API REST**

### **app.ts**
```typescript
import express from 'express';
import { authenticate } from './middleware/auth';
import { recordingsRouter } from './routes/recordings';
import { startCompletionWorker } from './workers/completion-worker';

const app = express();

app.use(express.json());

// Routes
app.use('/api/recordings', authenticate, recordingsRouter);

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

// Start background worker
startCompletionWorker();

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
```

### **routes/recordings.ts**
```typescript
import { Router } from 'express';
import { listUserRecordings, getRecording, deleteRecording } from '../controllers/recordings';

const router = Router();

// GET /api/recordings
router.get('/', async (req, res) => {
  try {
    const result = await listUserRecordings({
      userId: req.user.id,
      page: parseInt(req.query.page as string) || 1,
      pageSize: parseInt(req.query.pageSize as string) || 20,
      platform: req.query.platform as any,
      startDate: req.query.startDate ? new Date(req.query.startDate as string) : undefined,
      endDate: req.query.endDate ? new Date(req.query.endDate as string) : undefined
    });
    
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: 'Failed to list recordings' });
  }
});

// GET /api/recordings/:id
router.get('/:id', async (req, res) => {
  try {
    const recording = await getRecording(req.params.id, req.user.id);
    res.json(recording);
  } catch (error) {
    res.status(404).json({ error: 'Recording not found' });
  }
});

// DELETE /api/recordings/:id
router.delete('/:id', async (req, res) => {
  try {
    await deleteRecording(req.params.id, req.user.id);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Failed to delete recording' });
  }
});

export { router as recordingsRouter };
```

---

## 🔟 **Monitoramento e Logging**

### **CloudWatch Metrics**
```typescript
import { CloudWatch } from '@aws-sdk/client-cloudwatch';

const cloudwatch = new CloudWatch({ region: 'us-east-1' });

async function trackRecordingCompleted(platform: string, success: boolean) {
  await cloudwatch.putMetricData({
    Namespace: 'MeetingBot',
    MetricData: [
      {
        MetricName: 'RecordingsCompleted',
        Value: 1,
        Unit: 'Count',
        Dimensions: [
          { Name: 'Platform', Value: platform },
          { Name: 'Status', Value: success ? 'Success' : 'Failed' }
        ],
        Timestamp: new Date()
      }
    ]
  });
}
```

---

## 📊 **Dashboard Queries**

### **Gravações Recentes (Últimas 24h)**
```sql
SELECT 
  r.id,
  r.meeting_title,
  r.platform,
  r.completed_at,
  r.duration_sec,
  u.email as user_email
FROM recordings r
JOIN users u ON r.user_id = u.id
WHERE r.completed_at >= NOW() - INTERVAL '24 hours'
  AND r.status = 'completed'
ORDER BY r.completed_at DESC
LIMIT 50;
```

### **Top Usuários por Gravações**
```sql
SELECT 
  u.email,
  COUNT(r.id) as total_recordings,
  SUM(r.size_bytes) / 1024 / 1024 as total_mb,
  SUM(r.duration_sec) / 3600 as total_hours
FROM users u
LEFT JOIN recordings r ON u.id = r.user_id
WHERE r.status = 'completed'
GROUP BY u.id, u.email
ORDER BY total_recordings DESC
LIMIT 20;
```

---

## ✅ **Checklist de Integração**

- [ ] Implementar worker SQS para consumir completion messages
- [ ] Criar tabela `recordings` no banco de dados
- [ ] Implementar API REST para listar/buscar gravações
- [ ] Gerar presigned URLs para acesso seguro
- [ ] Implementar verificação de permissões
- [ ] Adicionar sistema de quotas
- [ ] Configurar lifecycle policies no S3
- [ ] Implementar monitoramento e alertas
- [ ] Documentar API para frontend
- [ ] Testes end-to-end

---

## 🚀 **Próximos Passos Recomendados**

1. **Implementar worker de completion** (prioridade alta)
2. **Criar endpoints da API REST**
3. **Adicionar sistema de notificações**
4. **Implementar busca e filtros**
5. **Adicionar analytics e dashboards**

---

**📚 Para mais informações técnicas, veja `S3-STORAGE-GUIDE.md`**

