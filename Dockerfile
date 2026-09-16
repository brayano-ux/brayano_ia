FROM node:22-alpine

WORKDIR /app

ENV DATABASE_URL=postgresql://build:build@localhost:5432/build

COPY apps/backend/package*.json ./

RUN npm ci

COPY apps/backend/ ./

RUN npx prisma generate
RUN npm run build

EXPOSE 3000

CMD ["npm", "start"]
