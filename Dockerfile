FROM node:20-slim
RUN apt-get update && apt-get install -y curl && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
RUN npm run build

# Verify dist exists
RUN ls -la dist/ && ls -la dist/public/ 

# Verify critical modules load
RUN node -e "require('express'); console.log('express OK')" && \
    node -e "require('pg'); console.log('pg OK')" && \
    node -e "require('bcryptjs'); console.log('bcryptjs OK')" && \
    node -e "require('helmet'); console.log('helmet OK')" && \
    node -e "require('dotenv'); console.log('dotenv OK')" && \
    node -e "require('zod'); console.log('zod OK')" && \
    node -e "require('googleapis'); console.log('googleapis OK')" && \
    node -e "require('xmlrpc'); console.log('xmlrpc OK')"

EXPOSE 8080
CMD ["node", "--trace-warnings", "--trace-uncaught", "dist/index.js"]