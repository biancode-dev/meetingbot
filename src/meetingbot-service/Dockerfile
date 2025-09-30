# MeetingBot Service Dockerfile
# This service consumes SQS messages and executes meeting recordings

FROM node:18-alpine

# Install system dependencies
RUN apk add --no-cache \
    curl \
    && rm -rf /var/cache/apk/*

# Set working directory
WORKDIR /app

# Install Node.js dependencies
COPY package.json ./
RUN npm install --only=production

# Copy application code
COPY . .

# Copy bots infrastructure
COPY bots ./bots

# Install pnpm and bots dependencies
RUN npm install -g pnpm
RUN cd bots && CI=true pnpm install --no-frozen-lockfile

# Create non-root user
RUN addgroup -g 1001 -S meetingbot && \
    adduser -S meetingbot -u 1001

# Change ownership
RUN chown -R meetingbot:meetingbot /app
USER meetingbot

# Expose health check port
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
  CMD curl -f http://localhost:3000/health || exit 1

# Start the service
CMD ["node", "index.js"]
