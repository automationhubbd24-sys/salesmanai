# Stage 1: Build the React frontend
FROM node:22-alpine AS build
WORKDIR /app
COPY package*.json ./
# Using npm install instead of ci to be more resilient to lockfile mismatches
RUN npm install
COPY . .
RUN npm run build

# Stage 2: Serve the frontend with Caddy
FROM caddy:2-alpine
COPY --from=build /app/dist /usr/share/caddy
EXPOSE 80
CMD ["caddy", "file-server", "--root", "/usr/share/caddy", "--listen", ":80"]
