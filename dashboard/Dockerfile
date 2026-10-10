FROM node:25-alpine AS build
WORKDIR /app
ARG VITE_API_BASE_URL=http://127.0.0.1:8847
ENV VITE_API_BASE_URL=$VITE_API_BASE_URL
COPY package.json package-lock.json* ./
RUN npm install
COPY . .
RUN npm run build

FROM node:25-alpine
WORKDIR /app
RUN npm install -g serve
COPY --from=build /app/dist ./dist
EXPOSE 3847
CMD ["serve", "-s", "dist", "-l", "3847"]
