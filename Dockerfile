FROM node:20-alpine

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install ALL dependencies (including devDependencies for build)
RUN npm install --include=dev

# Copy source code
COPY . .

# Build the project (vite + esbuild)
RUN npm run build

# Verify build output exists
RUN ls -la dist/ || (echo "BUILD FAILED: dist/ not found" && exit 1)

# Expose the port
EXPOSE 3000

# Start the server (esbuild outputs to dist/index.js)
CMD ["node", "dist/index.js"]
