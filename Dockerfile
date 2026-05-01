FROM node:20-alpine

WORKDIR /app

# Copy package files first for caching
COPY package*.json ./
RUN npm install

# Copy source code
COPY . .

# Build the project (client + server)
RUN npm run build

# Expose the port
EXPOSE 3000

# Start the server
CMD ["node", "dist/server/index.js"]
