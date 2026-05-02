FROM node:20-alpine
RUN apk add --no-cache curl
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
RUN npm run build

# Verify all critical modules load at build time
RUN node -e "require('express'); console.log('express OK')" && \
    node -e "require('bcryptjs'); console.log('bcryptjs OK')" && \
    node -e "require('pg'); console.log('pg OK')" && \
    node -e "require('googleapis'); console.log('googleapis OK')" && \
    node -e "require('xmlrpc'); console.log('xmlrpc OK')" && \
    node -e "require('helmet'); console.log('helmet OK')" && \
    node -e "require('zod'); console.log('zod OK')"

EXPOSE 8080
CMD ["sh", "-c", "echo '=== Starting Node.js ===' && node --trace-uncaught dist/index.js 2>&1"]