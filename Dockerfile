FROM node:22-bookworm-slim

ENV NODE_ENV=production
ENV PORT=8000
ENV DB_FILE=/app/data/umkm.db
ENV APP_UID=1000
ENV APP_GID=1000

WORKDIR /app

COPY package.json ./
RUN npm install --omit=dev

COPY server.js entrypoint.js index.html app.js ./

RUN mkdir -p /app/data

VOLUME ["/app/data"]
EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "entrypoint.js"]
