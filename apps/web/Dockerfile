# ============================================================
# E-Boses Web — Dockerfile
# ============================================================

# Development stage
FROM node:20-alpine AS development

WORKDIR /app

COPY package.json ./
RUN npm install

COPY . .

EXPOSE 5173

CMD ["npm", "run", "dev", "--", "--host", "0.0.0.0"]


# ============================================================
# Build stage
# ============================================================

FROM node:20-alpine AS build

WORKDIR /app

COPY package.json ./
RUN npm ci --only=production

COPY . .
RUN npm run build


# ============================================================
# Production (nginx to serve static files)
# ============================================================

FROM nginx:alpine AS production

COPY --from=build /app/dist /usr/share/nginx/html

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
