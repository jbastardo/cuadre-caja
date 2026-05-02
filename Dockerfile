FROM node:20-alpine

# Install curl for Railway health checks
RUN apk add --no-cache curl

WORKDIR /app

# Copy package files first for better caching
COPY package*.json ./

# Install dependencies (including dev for build)
RUN npm install --include=dev

# Copy source code
COPY . .

# Build the project
RUN npm run build

# Verify build output exists
RUN ls -la dist/ || (echo "BUILD FAILED: dist/ not found" && exit 1)

# Expose port (Railway sets PORT env var)
EXPOSE 8080

# Start the application
CMD ["node", "dist/index.js"]
