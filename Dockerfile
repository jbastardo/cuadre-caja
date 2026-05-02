FROM node:20-alpine
RUN apk add --no-cache curl
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
RUN npm run build
EXPOSE 8080
CMD ["sh", "-c", "echo '=== STARTING NODE ===' && node dist/index.js 2>&1"]