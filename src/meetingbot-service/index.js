#!/usr/bin/env node
/**
 * MeetingBot Service - SQS Consumer
 * 
 * This service consumes messages from SQS queue and executes meeting recordings
 * using the existing bot infrastructure.
 */

const { SQSClient, ReceiveMessageCommand, DeleteMessageCommand, SendMessageCommand, GetQueueAttributesCommand } = require('@aws-sdk/client-sqs');
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
const { ECSClient, RunTaskCommand } = require('@aws-sdk/client-ecs');
const { spawn } = require('child_process');
const { promises: fs } = require('fs');
const http = require('http');
const { randomUUID } = require('crypto');

// Configuration
const AWS_REGION = process.env.AWS_REGION || 'us-east-1';
const SQS_QUEUE_URL = process.env.MEETINGBOT_JOBS_QUEUE_URL;
const COMPLETION_QUEUE_URL = process.env.RECORDING_COMPLETED_QUEUE_URL;
const S3_BUCKET_NAME = process.env.S3_BUCKET_NAME;
const MAX_CONCURRENT_RECORDINGS = parseInt(process.env.MAX_CONCURRENT_RECORDINGS || '5');

// ECS Configuration
const ECS_CLUSTER_NAME = process.env.ECS_CLUSTER_NAME || 'meetingbot-dev';
const ECS_TASK_DEFINITION_MEET = process.env.ECS_TASK_DEFINITION_MEET || 'meetingbot-dev-meet-bot-local:3';
const ECS_TASK_DEFINITION_TEAMS = process.env.ECS_TASK_DEFINITION_TEAMS || 'meetingbot-dev-teams:latest';
const ECS_TASK_DEFINITION_ZOOM = process.env.ECS_TASK_DEFINITION_ZOOM || 'meetingbot-dev-zoom:latest';
const ECS_SUBNETS = process.env.ECS_SUBNETS ? process.env.ECS_SUBNETS.split(',') : ['subnet-12345678'];
const ECS_SECURITY_GROUPS = process.env.ECS_SECURITY_GROUPS ? process.env.ECS_SECURITY_GROUPS.split(',') : ['sg-12345678'];

// AWS Clients
const sqsClient = new SQSClient({ region: AWS_REGION });
const s3Client = new S3Client({ region: AWS_REGION });
const ecsClient = new ECSClient({ region: AWS_REGION });

// Active recordings tracking
const activeRecordings = new Map();

class MeetingBotService {
  constructor() {
    this.isRunning = false;
    this.processingInterval = null;
  }

  async start() {
    console.log('🚀 Starting MeetingBot Service...');
    console.log(`📊 Configuration:`);
    console.log(`   - AWS Region: ${AWS_REGION}`);
    console.log(`   - SQS Queue: ${SQS_QUEUE_URL}`);
    console.log(`   - Completion Queue: ${COMPLETION_QUEUE_URL}`);
    console.log(`   - S3 Bucket: ${S3_BUCKET_NAME}`);
    console.log(`   - Max Concurrent: ${MAX_CONCURRENT_RECORDINGS}`);
    
    this.isRunning = true;
    
    // Start processing loop
    this.startProcessingLoop();
    
    // Start health check endpoint
    this.startHealthCheck();
    
    // Handle graceful shutdown
    process.on('SIGINT', () => this.shutdown());
    process.on('SIGTERM', () => this.shutdown());
  }

  startProcessingLoop() {
    this.processingInterval = setInterval(async () => {
      if (activeRecordings.size >= MAX_CONCURRENT_RECORDINGS) {
        console.log(`⏳ Max concurrent recordings reached (${MAX_CONCURRENT_RECORDINGS}), skipping...`);
        return;
      }

      try {
        await this.processNextMessage();
    } catch (error) {
      console.error('❌ Error in processing loop:', error);
      console.error('❌ Error details:', error.message);
      console.error('❌ Error stack:', error.stack);
    }
    }, 1000); // Check every second
  }

  async processNextMessage() {
    try {
      console.log(`🔍 Checking for messages in queue: ${SQS_QUEUE_URL}`);
      console.log(`🔍 AWS Region: ${AWS_REGION}`);
      console.log(`🔍 SQS Client configured: ${!!sqsClient}`);
      
      // Test SQS access first
      console.log(`🔍 Testing SQS access...`);
      try {
        const testCommand = new GetQueueAttributesCommand({
          QueueUrl: SQS_QUEUE_URL,
          AttributeNames: ['All']
        });
        const testResponse = await sqsClient.send(testCommand);
        console.log(`🔍 SQS Access test successful:`, JSON.stringify(testResponse.Attributes, null, 2));
      } catch (testError) {
        console.error(`❌ SQS Access test failed:`, testError);
        return;
      }
      
      const command = new ReceiveMessageCommand({
        QueueUrl: SQS_QUEUE_URL,
        MaxNumberOfMessages: 1,
        WaitTimeSeconds: 5, // Long polling - wait up to 5 seconds for messages
        MessageAttributeNames: ['All'],
        VisibilityTimeoutSeconds: 300 // 5 minutes
      });

      console.log(`🔍 Sending SQS command...`);
      const response = await sqsClient.send(command);
      console.log(`🔍 SQS Response received:`, JSON.stringify(response, null, 2));
      
      const messages = response.Messages || [];
      
      console.log(`📨 Found ${messages.length} messages in queue`);
      console.log(`📨 Messages:`, JSON.stringify(messages, null, 2));
      
      if (messages.length === 0) {
        return; // No messages to process
      }

      const message = messages[0];
      console.log(`📨 Processing message:`, JSON.stringify(message, null, 2));
      console.log(`📨 **CHAMANDO processMessage...**`);
      await this.processMessage(message);
      console.log(`📨 **processMessage CONCLUÍDO**`);

    } catch (error) {
      console.error('❌ Error receiving message:', error);
      console.error('❌ Error details:', error.message);
      console.error('❌ Error stack:', error.stack);
    }
  }

  async processMessage(message) {
    console.log(`📨 **INICIANDO PROCESSAMENTO DE MENSAGEM:**`);
    console.log(`📨 Message:`, JSON.stringify(message, null, 2));
    
    const receiptHandle = message.ReceiptHandle;
    console.log(`📨 Receipt Handle:`, receiptHandle);
    
    let jobData;

    try {
      // Parse message body
      jobData = JSON.parse(message.Body);
      console.log(`📨 Job Data:`, JSON.stringify(jobData, null, 2));
      console.log(`📨 Processing job: ${jobData.job_id} (${jobData.platform})`);

      // Validate job data
      console.log(`📨 Validating job data...`);
      const validationResult = this.validateJobData(jobData);
      console.log(`📨 Validation result:`, validationResult);
      
      if (!validationResult) {
        console.error(`❌ Invalid job data for ${jobData.job_id}`);
        await this.deleteMessage(receiptHandle);
        return;
      }

      // Check if we can process this job
      if (activeRecordings.size >= MAX_CONCURRENT_RECORDINGS) {
        console.log(`⏳ Queue full, message will be reprocessed later`);
        return; // Don't delete message, let it be reprocessed
      }

      // Execute recording
      const result = await this.executeRecording(jobData);

      // Note: Bot will send completion message via SQS after recording is done
      // No need to send completion here as bot has the real data

      // Delete processed message
      await this.deleteMessage(receiptHandle);

      console.log(`✅ Job completed: ${jobData.job_id}`);

    } catch (error) {
      console.error(`❌ Error processing job ${jobData?.job_id}:`, error);
      
      // Note: Bot will handle failure completion via SQS if it gets that far
      // For ECS task failures, we rely on the bot's error handling

      // Delete message to prevent infinite retry
      await this.deleteMessage(receiptHandle);
    }
  }

  validateJobData(jobData) {
    const requiredFields = [
      'job_id', 'tenant_id', 'user_id', 'platform',
      'meeting_info', 'meeting_title'
    ];

    for (const field of requiredFields) {
      if (!jobData[field]) {
        console.error(`❌ Missing required field: ${field}`);
        return false;
      }
    }

    // Validate meeting_info
    const meetingInfo = jobData.meeting_info;
    if (!meetingInfo.meeting_url || !meetingInfo.platform) {
      console.error('❌ Invalid meeting_info');
      return false;
    }

    // Validate platform
    const supportedPlatforms = ['google', 'google_meet', 'zoom', 'teams'];
    if (!supportedPlatforms.includes(jobData.platform)) {
      console.error(`❌ Unsupported platform: ${jobData.platform}`);
      return false;
    }

    return true;
  }

  async executeRecording(jobData) {
    const jobId = jobData.job_id;
    const platform = jobData.platform;

    try {
      console.log(`🎬 Starting recording: ${jobId} (${platform})`);

      // Register active recording
      activeRecordings.set(jobId, {
        startTime: new Date(),
        status: 'processing',
        platform
      });

      // Convert platform name to bot platform
      const botPlatform = this.convertPlatformName(platform);
      
      // Create bot configuration
      const botConfig = {
        id: parseInt(jobId.split('-').pop() || '0'),
        userId: jobData.user_id,
        userEmail: jobData.user_email || `${jobData.user_id}@talksy.io`, // Use real email or generate from user_id
        platform: platform, // Add platform to botConfig
        meetingTitle: jobData.meeting_title,
        meetingInfo: {
          platform: botPlatform,
          meetingUrl: jobData.meeting_info.meeting_url,
          meetingId: jobData.meeting_info.meeting_id,
          meetingPassword: jobData.meeting_info.password,
          tenantId: jobData.tenant_id, // Pass tenant_id for S3 organization
          messageId: jobId // Pass job_id as messageId for S3 key
        },
        startTime: new Date(jobData.startTime || Date.now()),
        endTime: new Date(jobData.endTime || Date.now() + 2 * 60 * 60 * 1000),
        botDisplayName: jobData.bot_display_name || 'Talksy Bot',
        heartbeatInterval: 5000,
        automaticLeave: {
          waitingRoomTimeout: 300000, // 5 minutes
          noOneJoinedTimeout: 300000, // 5 minutes
          everyoneLeftTimeout: 300000, // 5 minutes
          inactivityTimeout: 300000, // 5 minutes
        }
      };

      // Update status
      const recording = activeRecordings.get(jobId);
      if (recording) {
        recording.status = 'recording';
      }

      // Execute bot using existing infrastructure
      const result = await this.runBot(botConfig);

      if (result.success) {
        // Upload to S3 with new structure
        const s3Path = await this.uploadToS3(jobData, result.recordingPath);
        
        // Update status
        if (recording) {
          recording.status = 'completed';
        }

        return {
          success: true,
          duration: result.duration,
          fileSize: result.fileSize,
          s3Path
        };
      } else {
        throw new Error(result.error || 'Bot execution failed');
      }

    } catch (error) {
      console.error(`❌ Recording failed for ${jobId}:`, error);
      
      // Update status
      const recording = activeRecordings.get(jobId);
      if (recording) {
        recording.status = 'failed';
      }

      return {
        success: false,
        error: error.message || 'Unknown error'
      };
    } finally {
      // Clean up active recording after 5 minutes
      setTimeout(() => {
        activeRecordings.delete(jobId);
      }, 5 * 60 * 1000);
    }
  }

  convertPlatformName(platform) {
    switch (platform) {
      case 'google':
      case 'google_meet':
        return 'google';
      case 'teams':
        return 'teams';
      case 'zoom':
        return 'zoom';
      default:
        throw new Error(`Unsupported platform: ${platform}`);
    }
  }

  async runBot(botConfig) {
    try {
      console.log(`🚀 Subindo task ECS para ${botConfig.platform}: ${botConfig.meetingInfo.meetingUrl}`);
      console.log(`🚀 ECS_TASK_DEFINITION_MEET: ${ECS_TASK_DEFINITION_MEET}`);
      console.log(`🚀 ECS_TASK_DEFINITION_TEAMS: ${ECS_TASK_DEFINITION_TEAMS}`);
      console.log(`🚀 ECS_TASK_DEFINITION_ZOOM: ${ECS_TASK_DEFINITION_ZOOM}`);
      
      // Select appropriate task definition based on platform
      const taskDefinition = this.selectBotTaskDefinition(botConfig.platform);
      console.log(`🚀 Task Definition selecionada: ${taskDefinition}`);
      
      const input = {
        cluster: ECS_CLUSTER_NAME,
        taskDefinition: taskDefinition,
        launchType: "FARGATE",
        networkConfiguration: {
          awsvpcConfiguration: {
            subnets: ECS_SUBNETS,
            securityGroups: ECS_SECURITY_GROUPS,
            assignPublicIp: "ENABLED",
          },
        },
        overrides: {
          containerOverrides: [
            {
              name: "bot",
              environment: [
                {
                  name: "BOT_DATA",
                  value: JSON.stringify(botConfig),
                },
                {
                  name: "AWS_BUCKET_NAME",
                  value: S3_BUCKET_NAME,
                },
                {
                  name: "AWS_REGION",
                  value: AWS_REGION,
                },
                {
                  name: "NODE_ENV",
                  value: "production", // Bot runs in production mode
                },
                {
                  name: "COMPLETION_QUEUE_URL",
                  value: COMPLETION_QUEUE_URL,
                },
                {
                  name: "AWS_ACCESS_KEY_ID",
                  value: process.env.AWS_ACCESS_KEY_ID,
                },
                {
                  name: "AWS_SECRET_ACCESS_KEY",
                  value: process.env.AWS_SECRET_ACCESS_KEY,
                },
              ],
            },
          ],
        },
      };

      console.log(`🚀 ECS Input:`, JSON.stringify(input, null, 2));
      console.log(`🚀 ECS Client configured: ${!!ecsClient}`);
      
      let response;
      try {
        const command = new RunTaskCommand(input);
        response = await ecsClient.send(command);
        
        console.log(`✅ ECS Task started:`, JSON.stringify(response, null, 2));
        console.log(`✅ Task ECS iniciada: ${response.tasks?.[0]?.taskArn}`);
      } catch (ecsError) {
        console.error(`❌ ECS Task failed:`, ecsError);
        throw ecsError;
      }
      
      // For now, return success - the bot will handle S3 upload and completion message
      // In a real implementation, we'd monitor the task status
      return {
        success: true,
        taskArn: response.tasks?.[0]?.taskArn,
        duration: 0, // Will be updated by the bot
        fileSize: 0  // Will be updated by the bot
      };
      
    } catch (error) {
      console.error(`❌ Failed to start ECS task:`, error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  selectBotTaskDefinition(platform) {
    console.log(`🔍 selectBotTaskDefinition called with platform: "${platform}"`);
    console.log(`🔍 platform?.toLowerCase(): "${platform?.toLowerCase()}"`);
    
    switch (platform?.toLowerCase()) {
      case "google":
      case "google_meet":
        console.log(`🔍 Selected ECS_TASK_DEFINITION_MEET: ${ECS_TASK_DEFINITION_MEET}`);
        return ECS_TASK_DEFINITION_MEET;
      case "teams":
        console.log(`🔍 Selected ECS_TASK_DEFINITION_TEAMS: ${ECS_TASK_DEFINITION_TEAMS}`);
        return ECS_TASK_DEFINITION_TEAMS;
      case "zoom":
        console.log(`🔍 Selected ECS_TASK_DEFINITION_ZOOM: ${ECS_TASK_DEFINITION_ZOOM}`);
        return ECS_TASK_DEFINITION_ZOOM;
      default:
        console.log(`🔍 Platform "${platform}" not matched in switch statement`);
        throw new Error(`Unsupported platform: ${platform}`);
    }
  }

  async uploadToS3(jobData, localPath) {
    try {
      const tenantId = jobData.tenant_id;
      const recordingId = jobData.job_id;
      const platform = jobData.platform;
      
      // New S3 structure: processed/{tenant_id}/{platform}/{recording_id}/recording.mp4
      const s3Key = `processed/${tenantId}/${platform}/${recordingId}/recording.mp4`;
      
      const fileContent = await fs.readFile(localPath);
      
      const command = new PutObjectCommand({
        Bucket: S3_BUCKET_NAME,
        Key: s3Key,
        Body: fileContent,
        ContentType: 'video/mp4',
        Metadata: {
          'recording-id': recordingId,
          'tenant-id': tenantId,
          'platform': platform,
          'meeting-title': jobData.meeting_title,
          'user-id': jobData.user_id
        }
      });

      await s3Client.send(command);
      
      console.log(`📤 Upload completed: s3://${S3_BUCKET_NAME}/${s3Key}`);
      
      // Clean up local file
      try {
        await fs.unlink(localPath);
      } catch (error) {
        console.warn('⚠️ Could not delete local file:', error);
      }
      
      return s3Key;
      
    } catch (error) {
      console.error('❌ Upload failed:', error);
      throw error;
    }
  }

  async sendCompletionMessage(jobData, result) {
    const completionMessage = {
      recording_id: jobData.job_id,
      tenant_id: jobData.tenant_id,
      user_id: jobData.user_id,
      s3_key_master: result.s3Path || `incoming/${jobData.job_id}/raw.mp4`, // Following specification
      duration_sec: result.duration || 0,
      size_bytes: result.fileSize || 0,
      tracks: ["audio", "video"],
      platform: jobData.platform,
      meeting_title: jobData.meeting_title,
      meeting_url: jobData.meeting_info.meeting_url,
      status: result.success ? 'completed' : 'failed',
      error: result.error,
      completed_at: new Date().toISOString()
    };

    try {
      const command = new SendMessageCommand({
        QueueUrl: COMPLETION_QUEUE_URL,
        MessageBody: JSON.stringify(completionMessage),
        MessageAttributes: {
          tenant_id: {
            DataType: 'String',
            StringValue: jobData.tenant_id
          },
          recording_id: {
            DataType: 'String',
            StringValue: jobData.job_id
          },
          status: {
            DataType: 'String',
            StringValue: completionMessage.status
          }
        },
        MessageDeduplicationId: `completed-${jobData.job_id}`,
        MessageGroupId: jobData.tenant_id
      });

      await sqsClient.send(command);
      console.log(`✅ Completion message sent: ${jobData.job_id}`);

    } catch (error) {
      console.error('❌ Failed to send completion message:', error);
    }
  }

  async deleteMessage(receiptHandle) {
    try {
      const command = new DeleteMessageCommand({
        QueueUrl: SQS_QUEUE_URL,
        ReceiptHandle: receiptHandle
      });

      await sqsClient.send(command);
      console.log('🗑️ Message deleted from queue');

    } catch (error) {
      console.error('❌ Failed to delete message:', error);
    }
  }

  startHealthCheck() {
    const server = http.createServer((req, res) => {
      if (req.url === '/health') {
        const health = {
          status: 'healthy',
          timestamp: new Date().toISOString(),
          active_recordings: activeRecordings.size,
          max_concurrent: MAX_CONCURRENT_RECORDINGS,
          uptime: process.uptime()
        };
        
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(health));
      } else {
        res.writeHead(404);
        res.end('Not Found');
      }
    });

    server.listen(3000, () => {
      console.log('🏥 Health check server running on port 3000');
    });
  }

  async shutdown() {
    console.log('🛑 Shutting down MeetingBot Service...');
    
    this.isRunning = false;
    
    if (this.processingInterval) {
      clearInterval(this.processingInterval);
    }
    
    // Wait for active recordings to complete (with timeout)
    const maxWaitTime = 5 * 60 * 1000; // 5 minutes
    const startTime = Date.now();
    
    while (activeRecordings.size > 0 && (Date.now() - startTime) < maxWaitTime) {
      console.log(`⏳ Waiting for ${activeRecordings.size} recordings to complete...`);
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    
    if (activeRecordings.size > 0) {
      console.log(`⚠️ ${activeRecordings.size} recordings still active, forcing shutdown`);
    }
    
    console.log('✅ MeetingBot Service shutdown complete');
    process.exit(0);
  }
}

// Start the service
const service = new MeetingBotService();
service.start().catch(error => {
  console.error('❌ Failed to start MeetingBot Service:', error);
  process.exit(1);
});
