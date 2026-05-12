# Stage 1: Build the React frontend
FROM node:22-alpine AS frontend-build
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
RUN npm run build

# Stage 2: Setup the Backend and serve the frontend
FROM node:22-alpine
WORKDIR /app

# Install build dependencies for native modules
RUN apk add --no-cache python3 make g++

# Copy backend package files
COPY backend/package*.json ./backend/

# Install backend dependencies
RUN cd backend && npm install --production

# Copy built frontend from Stage 1
COPY --from=frontend-build /app/dist ./dist

# Copy backend source code
COPY backend/ ./backend/

# Set environment variables
ENV NODE_ENV=production
ENV PORT=3001

# Expose the backend port
EXPOSE 3001

# Start the backend server (which also serves the frontend dist)
CMD ["node", "backend/index.js"]
