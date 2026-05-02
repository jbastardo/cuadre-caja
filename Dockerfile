FROM node:20-alpine

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm install --include=dev

# Copy source
COPY . .

# Build
RUN npm run build

# Start
CMD ["node", "dist/index.js"]
