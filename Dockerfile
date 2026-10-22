FROM node:22-alpine
WORKDIR /app
COPY server.js zip.js ./
COPY public ./public
COPY decks ./decks
RUN mkdir -p /data/uploads && chown -R node:node /data
ENV NODE_ENV=production PORT=3000 UPLOADS_DIR=/data/uploads
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://127.0.0.1:3000/saude || exit 1
CMD ["node", "server.js"]
