FROM node:22-alpine

ENV NODE_ENV=production
WORKDIR /app

RUN mkdir -p /app/public/assets/tools

COPY server.mjs ./server.mjs
COPY api/contact.mjs ./api/contact.mjs
COPY index.html styles.css script.js favicon.svg 1.png 2.png 3.png 4.png ./public/
COPY assets/tools/python.svg assets/tools/playwright.svg assets/tools/pandas.svg assets/tools/http-json.svg assets/tools/excel.svg assets/tools/csv.svg ./public/assets/tools/

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:' + (process.env.PORT || 3000) + '/healthz').then((response) => process.exit(response.ok ? 0 : 1)).catch(() => process.exit(1))"

USER node
CMD ["node", "server.mjs"]
