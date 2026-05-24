FROM node:20-alpine AS builder
WORKDIR /app
ARG VITE_API_URL
ARG VITE_INGEST_API_KEY
ENV VITE_API_URL=${VITE_API_URL}
ENV VITE_INGEST_API_KEY=${VITE_INGEST_API_KEY}
COPY package*.json ./
RUN npm ci --legacy-peer-deps
COPY . .
RUN npm run build

FROM nginx:alpine
COPY --from=builder /app/dist /usr/share/nginx/html
# Copy custom nginx configuration if needed to handle client-side routing
RUN echo 'server { \
    listen 80; \
    location / { \
        root /usr/share/nginx/html; \
        index index.html index.htm; \
        try_files $uri $uri/ /index.html; \
    } \
}' > /etc/nginx/conf.d/default.conf

EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
