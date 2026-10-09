FROM node:22-alpine

WORKDIR /app

ENV DATABASE_URL=postgresql://build:build@localhost:5432/build
ENV WHATSAPP_AUTH_DIR=/data/wa-session

RUN mkdir -p /data/wa-session

COPY package*.json ./

RUN npm install

COPY . .

RUN npx prisma generate

RUN npm run build

EXPOSE 3000

CMD ["npm", "start"]