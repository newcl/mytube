# Build stage
FROM node:18-alpine as builder

# Print the build arg for debugging
ARG VITE_BACKEND_URL
ENV VITE_BACKEND_URL=${VITE_BACKEND_URL}

RUN echo "Building with VITE_BACKEND_URL=${VITE_BACKEND_URL}"

WORKDIR /app

# Copy package files first for better caching
COPY package*.json ./

# Install dependencies with npm ci (faster and more reliable)
RUN npm ci

# Copy source code
COPY . .

# Build the app
RUN npm run build

# Production stage
FROM nginx:alpine

# Copy built assets from builder stage
COPY --from=builder /app/dist /usr/share/nginx/html

# Copy nginx configuration
COPY nginx.conf /etc/nginx/conf.d/default.conf

# Expose port
EXPOSE 80

# Start nginx
CMD ["nginx", "-g", "daemon off;"] 