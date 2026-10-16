FROM node:22-alpine
WORKDIR /app
COPY package*.json ./
RUN npm install --omit=dev
COPY server ./server
COPY src ./src
RUN mkdir -p dist && printf '<!doctype html><html><body><h1>Today Money Sense API</h1></body></html>' > dist/index.html
ENV NODE_ENV=production
EXPOSE 10000
CMD ["npm","start"]
