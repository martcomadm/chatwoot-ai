FROM node:24-alpine
WORKDIR /app
COPY package*.json ./
RUN npm install --omit=dev --no-audit --no-fund
COPY src ./src
RUN mkdir -p /app/data-next
ENV NODE_ENV=production
ENV APP_ENV=next
ENV NEXT_DATA_DIR=/app/data-next
EXPOSE 3000
CMD ["npm", "start"]
