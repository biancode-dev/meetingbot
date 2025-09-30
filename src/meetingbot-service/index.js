#!/usr/bin/env node
/**
 * MeetingBot Service - SQS Consumer
 * 
 * This service consumes messages from SQS queue and executes meeting recordings
 * using the existing bot infrastructure.
 */

const { SQSClient, ReceiveMessageCommand, DeleteMessageCommand, SendMessageCommand } = require('@aws-sdk/client-sqs');
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
const { spawn } = require('child_process');
const { promises: fs } = require('fs');
const http = require('http');
const { randomUUID } = require('crypto');

// Configuration
const AWS_REGION = process.env.AWS_REGION || 'us-east-1';
const SQS_QUEUE_URL = process.env.SQS_QUEUE_URL;
const COMPLETION_QUEUE_URL = process.env.COMPLETION_QUEUE_URL;
const S3_BUCKET_NAME = process.env.S3_BUCKET_NAME;
const MAX_CONCURRENT_RECORDINGS = parseInt(process.env.MAX_CONCURRENT_RECORDINGS || '5');

// AWS Clients
const sqsClient = new SQSClient({ region: AWS_REGION });
const s3Client = new S3Client({ region: AWS_REGION });

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
      }
    }, 1000); // Check every second
  }

  async processNextMessage() {
    try {
      const command = new ReceiveMessageCommand({
        QueueUrl: SQS_QUEUE_URL,
        MaxNumberOfMessages: 1,
        WaitTimeSeconds: 0, // Non-blocking
        MessageAttributeNames: ['All'],
        VisibilityTimeoutSeconds: 300 // 5 minutes
      });

      const response = await sqsClient.send(command);
      const messages = response.Messages || [];

      if (messages.length === 0) {
        return; // No messages to process
      }

      const message = messages[0];
      await this.processMessage(message);

    } catch (error) {
      console.error('❌ Error receiving message:', error);
    }
  }

  async processMessage(message) {
    const receiptHandle = message.ReceiptHandle;
    let jobData;

    try {
      // Parse message body
      jobData = JSON.parse(message.Body);
      console.log(`📨 Processing job: ${jobData.job_id} (${jobData.platform})`);

      // Validate job data
      if (!this.validateJobData(jobData)) {
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

      // Send completion message
      await this.sendCompletionMessage(jobData, result);

      // Delete processed message
      await this.deleteMessage(receiptHandle);

      console.log(`✅ Job completed: ${jobData.job_id}`);

    } catch (error) {
      console.error(`❌ Error processing job ${jobData?.job_id}:`, error);
      
      // Send failure completion message
      if (jobData) {
        await this.sendCompletionMessage(jobData, {
          success: false,
          error: error.message || 'Unknown error'
        });
      }

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
    const supportedPlatforms = ['google_meet', 'zoom', 'teams'];
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
        userEmail: `${jobData.user_id}@talksy.io`, // Generate email from user_id
        meetingTitle: jobData.meeting_title,
        meetingInfo: {
          platform: botPlatform,
          meetingUrl: jobData.meeting_info.meeting_url,
          meetingId: jobData.meeting_info.meeting_id,
          meetingPassword: jobData.meeting_info.password
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
    return new Promise((resolve) => {
      console.log(`🤖 Executando bot real para ${botConfig.platform}: ${botConfig.meetingInfo.meetingUrl}`);
      
      const botProcess = spawn('npx', ['tsx', 'src/index.ts'], {
        cwd: '/app/bots',
        env: {
          ...process.env,
          BOT_DATA: JSON.stringify(botConfig),
          AWS_BUCKET_NAME: S3_BUCKET_NAME,
          AWS_REGION: AWS_REGION,
          NODE_ENV: 'production'
        }
      });

      let output = '';
      let errorOutput = '';

      botProcess.stdout.on('data', (data) => {
        output += data.toString();
        console.log(`Bot ${botConfig.job_id}: ${data.toString().trim()}`);
      });

      botProcess.stderr.on('data', (data) => {
        errorOutput += data.toString();
        console.error(`Bot ${botConfig.job_id} error: ${data.toString().trim()}`);
      });

      botProcess.on('close', (code) => {
        if (code === 0) {
          // Extract duration and file size from output
          const durationMatch = output.match(/duration[:\s]+(\d+)/i);
          const fileSizeMatch = output.match(/file[_\s]*size[:\s]+(\d+)/i);
          
          resolve({
            success: true,
            duration: durationMatch ? parseInt(durationMatch[1]) : 0,
            fileSize: fileSizeMatch ? parseInt(fileSizeMatch[1]) : 0,
            recordingPath: '/tmp/recording.mp4' // Default path
          });
        } else {
          resolve({
            success: false,
            error: `Bot process exited with code ${code}: ${errorOutput}`
          });
        }
      });

      botProcess.on('error', (error) => {
        resolve({
          success: false,
          error: `Failed to start bot process: ${error.message}`
        });
      });

      // Timeout after 2 hours
      setTimeout(() => {
        botProcess.kill('SIGTERM');
        resolve({
          success: false,
          error: 'Bot execution timeout (2 hours)'
        });
      }, 2 * 60 * 60 * 1000);
    });
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
      platform: jobData.platform,
      meeting_title: jobData.meeting_title,
      status: result.success ? 'completed' : 'failed',
      s3_path: result.s3Path,
      duration_seconds: result.duration,
      file_size_bytes: result.fileSize,
      error: result.error,
      completed_at: new Date().toISOString(),
      metadata: {
        bot_version: '1.0.0',
        recording_quality: jobData.recording_settings?.quality || '1080p'
      }
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
