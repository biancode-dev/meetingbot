import { Bot, createBot } from "./bot";
import dotenv from "dotenv";
import { startHeartbeat, reportEvent } from "./monitoring";
import { EventCode, type BotConfig } from "./types";
import { createS3Client, uploadRecordingToS3 } from "./s3";
import { SQSClient, SendMessageCommand } from '@aws-sdk/client-sqs';

dotenv.config({path: '../test.env'}); // Load test.env for testing
dotenv.config();

export const main = async () => {
  let hasErrorOccurred = false;
  const requiredEnvVars = [
    "BOT_DATA",
    "AWS_BUCKET_NAME",
    "AWS_REGION",
    "NODE_ENV",
    "COMPLETION_QUEUE_URL",
  ] as const;

  // Check all required environment variables are present
  for (const envVar of requiredEnvVars) {
    if (!process.env[envVar]) {
      throw new Error(`Missing required environment variable: ${envVar}`);
    }
  }

  // Parse bot data
  const botData: BotConfig = JSON.parse(process.env.BOT_DATA!);
  console.log("Received bot data:", botData);
  const botId = botData.id;

  // Declare key variable at the top level of the function
  let key: string = "";

  // Initialize S3 client
  const s3Client = createS3Client(process.env.AWS_REGION!, process.env.AWS_ACCESS_KEY_ID, process.env.AWS_SECRET_ACCESS_KEY);
  if (!s3Client) {
    throw new Error("Failed to create S3 client");
  }

  // Initialize SQS client for completion messages
  const sqsClient = new SQSClient({ 
    region: process.env.AWS_REGION!,
    credentials: {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
    }
  });

  // Create the appropriate bot instance based on platform
  const bot = await createBot(botData);

  // Create AbortController for heartbeat
  const heartbeatController = new AbortController();

  // Do not start heartbeat in development
  if (process.env.NODE_ENV !== "development") {
    // Start heartbeat in the background
    console.log("Starting heartbeat");
    const heartbeatInterval = botData.heartbeatInterval ?? 5000; // Default to 5 seconds if not set
    startHeartbeat(botId, heartbeatController.signal, heartbeatInterval);
  }

  // Report READY_TO_DEPLOY event
  await reportEvent(botId, EventCode.READY_TO_DEPLOY);

  try {
    // Run the bot
    await bot.run().catch(async (error) => {

      console.error("Error running bot:", error);
      await reportEvent(botId, EventCode.FATAL, {
        description: (error as Error).message,
      });

      // Check what's on the screen in case of an error
      bot.screenshot();

      // **Ensure** the bot cleans up its resources after a breaking error
      await bot.endLife();
    });

    // Upload recording to S3
    console.log("Start Upload to S3...");
    key = await uploadRecordingToS3(s3Client, bot);


  } catch (error) {
    hasErrorOccurred = true;
    console.error("Error running bot:", error);
    await reportEvent(botId, EventCode.FATAL, {
      description: (error as Error).message,
    });
  }

  // After S3 upload and cleanup, stop the heartbeat
  heartbeatController.abort();
  console.log("Bot execution completed, heartbeat stopped.");

  // Only report DONE if no error occurred
  if (!hasErrorOccurred) {
    // Report final DONE event
    const speakerTimeframes = bot.getSpeakerTimeframes();
    console.debug("Speaker timeframes:", speakerTimeframes);
    await reportEvent(botId, EventCode.DONE, { recording: key, speakerTimeframes });

    // Send completion message to SQS queue
    await sendCompletionMessage(sqsClient, botData, {
      success: true,
      s3Path: key,
      duration: 0, // TODO: Implement getRecordingDuration() method
      fileSize: 0, // TODO: Implement getRecordingSize() method
      speakerTimeframes
    });
  } else {
    // Send failure completion message to SQS queue
    await sendCompletionMessage(sqsClient, botData, {
      success: false,
      error: 'Bot execution failed'
    });
  }

  // Exit with appropriate code
  process.exit(hasErrorOccurred ? 1 : 0);
};

// Function to send completion message to SQS
async function sendCompletionMessage(
  sqsClient: SQSClient, 
  botData: BotConfig, 
  result: {
    success: boolean;
    s3Path?: string;
    duration?: number;
    fileSize?: number;
    speakerTimeframes?: any;
    error?: string;
  }
) {
  try {
    const completionMessage = {
      recording_id: botData.meetingInfo.messageId || `bot-${botData.id}`,
      tenant_id: botData.meetingInfo.tenantId || 'unknown',
      user_id: botData.userId.toString(),
      s3_key_master: result.s3Path || `incoming/${botData.id}/raw.mp4`,
      duration_sec: result.duration || 0,
      size_bytes: result.fileSize || 0,
      tracks: ["audio", "video"],
      platform: botData.platform,
      meeting_title: botData.meetingTitle,
      meeting_url: botData.meetingInfo.meetingUrl,
      status: result.success ? 'completed' : 'failed',
      error: result.error,
      completed_at: new Date().toISOString()
    };

    const command = new SendMessageCommand({
      QueueUrl: process.env.COMPLETION_QUEUE_URL!,
      MessageBody: JSON.stringify(completionMessage),
      MessageAttributes: {
        tenant_id: {
          DataType: 'String',
          StringValue: completionMessage.tenant_id
        },
        recording_id: {
          DataType: 'String',
          StringValue: completionMessage.recording_id
        },
        status: {
          DataType: 'String',
          StringValue: completionMessage.status
        }
      },
      MessageDeduplicationId: `completed-${completionMessage.recording_id}`,
      MessageGroupId: completionMessage.tenant_id
    });

    await sqsClient.send(command);
    console.log(`✅ Completion message sent to SQS: ${completionMessage.recording_id}`);

  } catch (error) {
    console.error('❌ Failed to send completion message to SQS:', error);
  }
}

// Only run automatically if not in a test
if (require.main === module) {
  main();
}
