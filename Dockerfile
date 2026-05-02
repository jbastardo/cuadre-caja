FROM node:20-slim
RUN apt-get update && apt-get install -y curl && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
RUN npm run build

EXPOSE 8080
CMD ["sh", "-c", "echo '=== CONTAINER START ===' && node -e \"console.log('Node OK, version:', process.version)\" && echo '=== Starting app ===' && node dist/index.js 2>&1"]