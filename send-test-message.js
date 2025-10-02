#!/usr/bin/env node
/**
 * Script para enviar mensagem de teste para a fila SQS
 */

const { SQSClient, SendMessageCommand } = require('@aws-sdk/client-sqs');
const fs = require('fs');
const path = require('path');

// Carregar variáveis de ambiente
require('dotenv').config({ path: './test-local.env' });

const AWS_REGION = process.env.AWS_REGION || 'us-east-1';
const QUEUE_URL = process.env.MEETINGBOT_JOBS_QUEUE_URL;

if (!QUEUE_URL) {
  console.error('❌ MEETINGBOT_JOBS_QUEUE_URL não configurada');
  process.exit(1);
}

const sqsClient = new SQSClient({ 
  region: AWS_REGION,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  }
});

async function sendTestMessage() {
  try {
    // Ler mensagem de teste
    const messagePath = path.join(__dirname, 'test-message.json');
    const messageData = JSON.parse(fs.readFileSync(messagePath, 'utf8'));
    
    console.log('📨 Enviando mensagem de teste para a fila...');
    console.log('📨 Dados:', JSON.stringify(messageData, null, 2));
    
    const command = new SendMessageCommand({
      QueueUrl: QUEUE_URL,
      MessageBody: JSON.stringify(messageData),
      MessageAttributes: {
        tenant_id: {
          DataType: 'String',
          StringValue: messageData.tenant_id
        },
        platform: {
          DataType: 'String',
          StringValue: messageData.platform
        }
      },
      MessageDeduplicationId: messageData.job_id,
      MessageGroupId: messageData.tenant_id
    });

    const response = await sqsClient.send(command);
    
    console.log('✅ Mensagem enviada com sucesso!');
    console.log('✅ MessageId:', response.MessageId);
    console.log('✅ MD5OfBody:', response.MD5OfBody);
    
  } catch (error) {
    console.error('❌ Erro ao enviar mensagem:', error);
    process.exit(1);
  }
}

sendTestMessage();
