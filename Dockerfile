FROM node:22-alpine
RUN apk add --no-cache ffmpeg intel-media-driver libva
WORKDIR /app
COPY package.json .
RUN npm install --production
COPY server.mjs .
CMD ["node", "server.mjs"]
