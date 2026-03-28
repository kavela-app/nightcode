FROM ubuntu:24.04

# System deps
RUN apt-get update && apt-get install -y \
    curl git openssh-client jq ca-certificates gnupg \
    && rm -rf /var/lib/apt/lists/*

# Node.js 22
RUN curl -fsSL https://deb.nodesource.com/setup_22.x | bash - \
    && apt-get install -y nodejs \
    && rm -rf /var/lib/apt/lists/*

# GitHub CLI
RUN curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg \
    | dd of=/usr/share/keyrings/githubcli-archive-keyring.gpg \
    && echo "deb [signed-by=/usr/share/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" \
    > /etc/apt/sources.list.d/github-cli.list \
    && apt-get update && apt-get install -y gh \
    && rm -rf /var/lib/apt/lists/*

# Claude Code CLI
RUN npm install -g @anthropic-ai/claude-code

# Optional: Playwright for screenshots (adds ~400MB)
ARG INSTALL_PLAYWRIGHT=false
RUN if [ "$INSTALL_PLAYWRIGHT" = "true" ]; then \
      npx playwright install chromium --with-deps; \
    fi

# Create non-root user (Claude CLI refuses --dangerously-skip-permissions as root)
RUN useradd -m -s /bin/bash nightcode \
    && mkdir -p /data /repos /home/nightcode/.claude /home/nightcode/.ssh \
    && chown -R nightcode:nightcode /data /repos /home/nightcode

# App setup
WORKDIR /app

# Install dependencies
COPY package*.json ./
RUN npm ci --omit=dev

# Copy built app
COPY dist/ ./dist/
COPY dashboard/dist/ ./dashboard/dist/

# Make app owned by nightcode user
RUN chown -R nightcode:nightcode /app

# Data and workspace volumes
VOLUME ["/data", "/repos"]

EXPOSE 3777

ENV NODE_ENV=production
ENV NIGHTCODE_DATA_DIR=/data
ENV NIGHTCODE_REPOS_DIR=/repos
ENV HOME=/home/nightcode

USER nightcode

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD curl -f http://localhost:3777/api/health || exit 1

CMD ["node", "dist/index.js"]
