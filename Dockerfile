FROM node:18-alpine

WORKDIR /usr/src/app

COPY package*.json ./

RUN npm install

COPY . .

EXPOSE 3000

CMD ["node", "main.js", "-H", "0.0.0.0", "-p", "3000", "-c", "cache"]