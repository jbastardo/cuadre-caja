FROM node:20-slim
RUN apt-get update && apt-get install -y curl && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
RUN npm run build

# Write a simple test script
RUN echo 'console.log("=== NODE STARTED ==="); console.log("PORT:", process.env.PORT); process.env.DATABASE_URL ? console.log("DB: set") : console.log("DB: NOT SET");' > /app/test.js

EXPOSE 8080
CMD ["sh", "-c", "echo CONTAINER_START && node /app/test.js && node dist/index.js"]