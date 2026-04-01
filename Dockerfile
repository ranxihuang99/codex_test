FROM node:20-alpine

WORKDIR /app
COPY . .

ENV NODE_ENV=production

EXPOSE 8788
CMD ["node", "server.js"]
