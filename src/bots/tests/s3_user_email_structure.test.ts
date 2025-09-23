import { uploadRecordingToS3, createS3Client } from "../src/s3";
import { Bot } from "../src/bot";
import { BotConfig } from "../src/types";
import { jest } from '@jest/globals';

// Mock the S3 client
jest.mock('@aws-sdk/client-s3', () => ({
  S3Client: jest.fn().mockImplementation(() => ({
    send: jest.fn().mockResolvedValue({}),
  })),
  PutObjectCommand: jest.fn().mockImplementation((params) => params),
}));

// Mock fs
jest.mock('fs', () => ({
  readFileSync: jest.fn().mockReturnValue(Buffer.from('mock video content')),
  promises: {
    unlink: jest.fn().mockResolvedValue(undefined),
  },
}));

// Mock crypto
jest.mock('crypto', () => ({
  randomUUID: jest.fn().mockReturnValue('test-uuid-123'),
}));

describe('S3 Upload with User Email Structure', () => {
  it('should create folder structure with sanitized user email', async () => {
    const mockBotConfig: BotConfig = {
      id: 1,
      userId: 'user-123',
      userEmail: 'test.user@example.com',
      meetingInfo: {
        platform: 'google',
        meetingUrl: 'https://meet.google.com/test',
      },
      meetingTitle: 'Test Meeting',
      startTime: new Date(),
      endTime: new Date(),
      botDisplayName: 'Test Bot',
      heartbeatInterval: 5000,
      automaticLeave: {
        waitingRoomTimeout: 300000,
        noOneJoinedTimeout: 300000,
        everyoneLeftTimeout: 300000,
        inactivityTimeout: 300000,
      },
    };

    // Create a mock bot
    const mockBot = {
      getRecordingPath: jest.fn().mockReturnValue('/tmp/recording.mp4'),
      getContentType: jest.fn().mockReturnValue('video/mp4'),
      settings: mockBotConfig,
    } as unknown as Bot;

    const mockS3Client = createS3Client('us-east-1', 'test-key', 'test-secret');

    // Call the upload function
    const result = await uploadRecordingToS3(mockS3Client!, mockBot);

    // Verify the result contains the sanitized email folder structure
    expect(result).toBe('recordings/test_user_example_com/test-uuid-123-google-recording.mp4');
  });

  it('should handle special characters in email', async () => {
    const mockBotConfig: BotConfig = {
      id: 1,
      userId: 'user-123',
      userEmail: 'user+tag@domain-name.co.uk',
      meetingInfo: {
        platform: 'teams',
        meetingUrl: 'https://teams.microsoft.com/test',
      },
      meetingTitle: 'Test Meeting',
      startTime: new Date(),
      endTime: new Date(),
      botDisplayName: 'Test Bot',
      heartbeatInterval: 5000,
      automaticLeave: {
        waitingRoomTimeout: 300000,
        noOneJoinedTimeout: 300000,
        everyoneLeftTimeout: 300000,
        inactivityTimeout: 300000,
      },
    };

    const mockBot = {
      getRecordingPath: jest.fn().mockReturnValue('/tmp/recording.webm'),
      getContentType: jest.fn().mockReturnValue('video/webm'),
      settings: mockBotConfig,
    } as unknown as Bot;

    const mockS3Client = createS3Client('us-east-1', 'test-key', 'test-secret');

    const result = await uploadRecordingToS3(mockS3Client!, mockBot);

    // Verify special characters are sanitized
    expect(result).toBe('recordings/usertag_domain-name_co_uk/test-uuid-123-teams-recording.webm');
  });
});
