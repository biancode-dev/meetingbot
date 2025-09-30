# MeetingBot Service Dockerfile
# Based on the official bot structure for proper Playwright support

# Use the official Playwright Docker image as the base stage
FROM mcr.microsoft.com/playwright:v1.52.0-jammy AS base

# Install XVFB dependencies
RUN apt-get update && apt-get install -y \
    xvfb \
    ffmpeg \
    x11-utils \
    pulseaudio \
    x11-xserver-utils \
    fluxbox \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Set the working directory inside the container
WORKDIR /app

# Install pnpm globally
RUN npm install -g pnpm

# Copy dependency files
COPY package.json ./
RUN npm install --only=production

# Copy bots directory
COPY bots ./bots

# Install Playwright dependencies
RUN cd bots && CI=true pnpm install --no-frozen-lockfile

# Install Playwright browsers
RUN cd bots && pnpm dlx playwright@1.52.0 install-deps
RUN cd bots && pnpm dlx playwright@1.52.0 install --with-deps

# Ensure the Playwright cache directory has the correct permissions
RUN mkdir -p /root/ms-playwright && chmod -R 777 /root/ms-playwright

# ======================================================
# Runtime stage
FROM mcr.microsoft.com/playwright:v1.52.0-jammy AS runtime

# Set the working directory inside the container
WORKDIR /app

# Install runtime dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    xvfb \
    pulseaudio \
    pulseaudio-utils \
    xserver-xephyr \
    x11-xserver-utils \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Install pnpm globally
RUN npm install -g pnpm

# Copy node_modules and package.json from the base stage
COPY --from=base /app/node_modules /app/node_modules
COPY --from=base /app/package.json /app/package.json
COPY --from=base /app/bots /app/bots
COPY --from=base /root/ms-playwright /root/ms-playwright

# Copy working files into the container
COPY . .

# Make entrypoint executable
RUN chmod +x ./entrypoint.sh

# Create non-root user
RUN useradd -ms /bin/bash meetingbot && chown -R meetingbot:meetingbot /app
RUN chown -R meetingbot:meetingbot /root/ms-playwright

# Expose display port
ENV DISPLAY=:99

# Switch to meetingbot user
USER meetingbot

# Expose port for health check
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
  CMD curl -f http://localhost:3000/health || exit 1

# Start the service using entrypoint
CMD ["./entrypoint.sh"]