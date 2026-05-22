FROM node:22-alpine

# Install dependencies for building if needed (like python/make/g++ for some npm packages)
RUN apk add --no-cache python3 make g++

WORKDIR /app

# Copy package files first for better caching
COPY backend/package*.json ./backend/

# Install dependencies
RUN cd backend && npm install --production

# Copy the rest of the backend code
COPY backend/ ./backend/

# Set environment variables
ENV NODE_ENV=production
ENV PORT=3001

# Expose the port
EXPOSE 3001

# Start the application
CMD ["node", "backend/index.js"]
