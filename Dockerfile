FROM node:20-alpine
RUN apk add --no-cache curl
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
RUN npm run build

# Debug: verify Node.js works and list files
RUN node -e "console.log('NODE_VERSION:', process.version)" && \
    ls -la dist/ && \
    node -e "require('express'); console.log('express OK')" && \
    node -e "require('bcryptjs'); console.log('bcryptjs OK')" && \
    node -e "require('pg'); console.log('pg OK')" && \
    node -e "require('dotenv/config'); console.log('dotenv OK')" && \
    node -e "require('helmet'); console.log('helmet OK')"

EXPOSE 8080
CMD ["node", "dist/index.js"]