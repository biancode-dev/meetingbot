# SQS Queues for MeetingBot Service
# This file creates the SQS FIFO queues for the new secure architecture

# Main job queue for meeting recordings
resource "aws_sqs_queue" "meetingbot_jobs" {
  name                        = "talksy-meetingbot-jobs.fifo"
  fifo_queue                  = true
  content_based_deduplication = true
  
  # Visibility timeout: 5 minutes (time for bot to process)
  visibility_timeout_seconds = 300
  
  # Message retention: 14 days
  message_retention_seconds = 1209600
  
  # Dead letter queue configuration
  redrive_policy = jsonencode({
    deadLetterTargetArn = aws_sqs_queue.meetingbot_dlq.arn
    maxReceiveCount     = 3
  })
  
  tags = {
    Name        = "talksy-meetingbot-jobs"
    Environment = var.environment
    Service     = "meetingbot"
  }
}

# Dead letter queue for failed jobs
resource "aws_sqs_queue" "meetingbot_dlq" {
  name                        = "talksy-meetingbot-dlq.fifo"
  fifo_queue                  = true
  content_based_deduplication = true
  
  # Message retention: 14 days
  message_retention_seconds = 1209600
  
  tags = {
    Name        = "talksy-meetingbot-dlq"
    Environment = var.environment
    Service     = "meetingbot"
  }
}

# Completion queue for recording results
resource "aws_sqs_queue" "recording_completed" {
  name                        = "talksy-recording-completed.fifo"
  fifo_queue                  = true
  content_based_deduplication = true
  
  # Visibility timeout: 30 seconds
  visibility_timeout_seconds = 30
  
  # Message retention: 7 days
  message_retention_seconds = 604800
  
  tags = {
    Name        = "talksy-recording-completed"
    Environment = var.environment
    Service     = "meetingbot"
  }
}

# IAM Role for MeetingBot Service
resource "aws_iam_role" "meetingbot_service_role" {
  name = "${local.name}-meetingbot-service-role"
  
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Action = "sts:AssumeRole"
        Effect = "Allow"
        Principal = {
          Service = "ecs-tasks.amazonaws.com"
        }
      }
    ]
  })
  
  tags = {
    Name        = "${local.name}-meetingbot-service-role"
    Environment = var.environment
    Service     = "meetingbot"
  }
}

# IAM Policy for MeetingBot Service
resource "aws_iam_role_policy" "meetingbot_service_policy" {
  name = "${local.name}-meetingbot-service-policy"
  role = aws_iam_role.meetingbot_service_role.id
  
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "sqs:ReceiveMessage",
          "sqs:DeleteMessage",
          "sqs:SendMessage",
          "sqs:GetQueueAttributes"
        ]
        Resource = [
          aws_sqs_queue.meetingbot_jobs.arn,
          aws_sqs_queue.meetingbot_dlq.arn,
          aws_sqs_queue.recording_completed.arn
        ]
      },
      {
        Effect = "Allow"
        Action = [
          "s3:PutObject",
          "s3:PutObjectAcl",
          "s3:GetObject"
        ]
        Resource = [
          "${aws_s3_bucket.this.arn}/processed/*",
          "${aws_s3_bucket.this.arn}/recordings/*"
        ]
      },
      {
        Effect = "Allow"
        Action = [
          "kms:Decrypt",
          "kms:GenerateDataKey"
        ]
        Resource = "*"
      },
      {
        Effect = "Allow"
        Action = [
          "logs:CreateLogGroup",
          "logs:CreateLogStream",
          "logs:PutLogEvents"
        ]
        Resource = "arn:aws:logs:${var.aws_region}:*:*"
      }
    ]
  })
}

# CloudWatch Log Group for MeetingBot Service
resource "aws_cloudwatch_log_group" "meetingbot_service" {
  name              = "/ecs/${local.name}-meetingbot-service"
  retention_in_days = 7
  
  tags = {
    Name        = "${local.name}-meetingbot-service-logs"
    Environment = var.environment
    Service     = "meetingbot"
  }
}

# ECS Task Definition for MeetingBot Service
resource "aws_ecs_task_definition" "meetingbot_service" {
  family                   = "${local.name}-meetingbot-service"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = 2048  # 2 vCPUs (optimized)
  memory                   = 4096  # 4 GB (optimized)
  execution_role_arn       = aws_iam_role.ecs_task_execution_role.arn
  task_role_arn            = aws_iam_role.meetingbot_service_role.arn
  
  container_definitions = jsonencode([
    {
      name      = "meetingbot-service"
      image     = "lincolnbiancard/meetingbot-service:latest"
      essential = true
      
      environment = [
        {
          name  = "AWS_REGION"
          value = var.aws_region
        },
        {
          name  = "SQS_QUEUE_URL"
          value = aws_sqs_queue.meetingbot_jobs.url
        },
        {
          name  = "COMPLETION_QUEUE_URL"
          value = aws_sqs_queue.recording_completed.url
        },
        {
          name  = "S3_BUCKET_NAME"
          value = aws_s3_bucket.this.bucket
        },
        {
          name  = "NODE_ENV"
          value = "production"
        },
        {
          name  = "MAX_CONCURRENT_RECORDINGS"
          value = "5"
        }
      ]
      
      logConfiguration = {
        logDriver = "awslogs"
        options = {
          "awslogs-group"         = aws_cloudwatch_log_group.meetingbot_service.name
          "awslogs-region"        = var.aws_region
          "awslogs-stream-prefix" = "meetingbot-service"
        }
      }
      
      # Health check
      healthCheck = {
        command = ["CMD-SHELL", "curl -f http://localhost:3000/health || exit 1"]
        interval = 30
        timeout = 5
        retries = 3
        startPeriod = 60
      }
    }
  ])
  
  tags = {
    Name        = "${local.name}-meetingbot-service"
    Environment = var.environment
    Service     = "meetingbot"
  }
}

# ECS Service for MeetingBot Service
resource "aws_ecs_service" "meetingbot_service" {
  name            = "${local.name}-meetingbot-service"
  cluster         = aws_ecs_cluster.main.id
  task_definition = aws_ecs_task_definition.meetingbot_service.arn
  desired_count   = 2  # Run 2 instances for high availability
  
  launch_type = "FARGATE"
  
  network_configuration {
    subnets          = var.private_subnet_ids
    security_groups  = [aws_security_group.ecs_tasks.id]
    assign_public_ip = false
  }
  
  # Auto scaling configuration
  enable_execute_command = true
  
  tags = {
    Name        = "${local.name}-meetingbot-service"
    Environment = var.environment
    Service     = "meetingbot"
  }
}

# Auto Scaling Target for MeetingBot Service
resource "aws_appautoscaling_target" "meetingbot_service" {
  max_capacity       = 10
  min_capacity       = 2
  resource_id        = "service/${aws_ecs_cluster.main.name}/${aws_ecs_service.meetingbot_service.name}"
  scalable_dimension = "ecs:service:DesiredCount"
  service_namespace  = "ecs"
}

# Auto Scaling Policy - Scale up
resource "aws_appautoscaling_policy" "meetingbot_service_scale_up" {
  name               = "${local.name}-meetingbot-service-scale-up"
  policy_type        = "TargetTrackingScaling"
  resource_id        = aws_appautoscaling_target.meetingbot_service.resource_id
  scalable_dimension = aws_appautoscaling_target.meetingbot_service.scalable_dimension
  service_namespace  = aws_appautoscaling_target.meetingbot_service.service_namespace
  
  target_tracking_scaling_policy_configuration {
    target_value = 70.0
    
    predefined_metric_specification {
      predefined_metric_type = "ECSServiceAverageCPUUtilization"
    }
    
    scale_in_cooldown  = 300
    scale_out_cooldown = 300
  }
}

# CloudWatch Alarms for monitoring
resource "aws_cloudwatch_metric_alarm" "meetingbot_queue_depth" {
  alarm_name          = "${local.name}-meetingbot-queue-depth"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods = "2"
  metric_name         = "ApproximateNumberOfVisibleMessages"
  namespace           = "AWS/SQS"
  period              = "300"
  statistic           = "Average"
  threshold           = "10"
  alarm_description   = "This metric monitors meetingbot queue depth"
  
  dimensions = {
    QueueName = aws_sqs_queue.meetingbot_jobs.name
  }
  
  alarm_actions = [
    aws_sns_topic.alerts.arn
  ]
}

resource "aws_cloudwatch_metric_alarm" "meetingbot_dlq_messages" {
  alarm_name          = "${local.name}-meetingbot-dlq-messages"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods = "1"
  metric_name         = "ApproximateNumberOfVisibleMessages"
  namespace           = "AWS/SQS"
  period              = "300"
  statistic           = "Average"
  threshold           = "0"
  alarm_description   = "This metric monitors meetingbot DLQ messages"
  
  dimensions = {
    QueueName = aws_sqs_queue.meetingbot_dlq.name
  }
  
  alarm_actions = [
    aws_sns_topic.alerts.arn
  ]
}

# SNS Topic for alerts
resource "aws_sns_topic" "alerts" {
  name = "${local.name}-meetingbot-alerts"
  
  tags = {
    Name        = "${local.name}-meetingbot-alerts"
    Environment = var.environment
    Service     = "meetingbot"
  }
}

# Outputs
output "meetingbot_jobs_queue_url" {
  description = "URL of the MeetingBot jobs queue"
  value       = aws_sqs_queue.meetingbot_jobs.url
}

output "meetingbot_jobs_queue_arn" {
  description = "ARN of the MeetingBot jobs queue"
  value       = aws_sqs_queue.meetingbot_jobs.arn
}

output "recording_completed_queue_url" {
  description = "URL of the recording completed queue"
  value       = aws_sqs_queue.recording_completed.url
}

output "recording_completed_queue_arn" {
  description = "ARN of the recording completed queue"
  value       = aws_sqs_queue.recording_completed.arn
}

output "meetingbot_service_role_arn" {
  description = "ARN of the MeetingBot service IAM role"
  value       = aws_iam_role.meetingbot_service_role.arn
}
