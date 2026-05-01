FROM node:20-alpine

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install ALL dependencies (including devDependencies for build)
RUN npm install --include=dev

# Copy source code
COPY . .

# Build the project
RUN npm run build

# Verify build output exists
RUN ls -la dist/server/ || (echo "BUILD FAILED: dist/server/ not found" && exit 1)

# Expose the port
EXPOSE 3000

# Start the server
CMD ["node", "dist/server/index.js"]
