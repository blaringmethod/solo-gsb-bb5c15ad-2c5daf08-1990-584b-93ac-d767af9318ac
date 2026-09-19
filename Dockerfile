FROM node:20-alpine

ENV NODE_ENV=production
WORKDIR /app

# 先拷贝依赖清单，利用镜像层缓存
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY server.js ./
COPY src ./src
COPY public ./public

EXPOSE 3000
CMD ["node", "server.js"]
