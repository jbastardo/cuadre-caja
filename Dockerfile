FROM node:20-slim
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
RUN npm run build:client

EXPOSE 8080
CMD ["sh", "-c", "echo '=== CONTAINER START ===' && echo 'Node:' $(node --version) && echo 'CWD:' $(pwd) && echo 'PORT:' $PORT && echo 'DATABASE_URL set:' $([ -n \"$DATABASE_URL\" ] && echo 'yes' || echo 'no') && echo 'NODE_ENV:' $NODE_ENV && echo 'Files:' && ls -la dist/public/ 2>/dev/null || echo 'No dist/public' && echo '=== Starting tsx ===' && NODE_OPTIONS='--no-warnings' npx tsx server/index.ts"]