FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json* ./
COPY apps/web/package.json apps/web/
COPY packages/shared/package.json packages/shared/
RUN npm install --workspace=@pista-aberta/web --include-workspace-root=false || npm install
COPY packages/shared ./packages/shared
COPY apps/web ./apps/web
WORKDIR /app/apps/web
# Baleiro = same-origin (gateway VPS). Local: http://localhost:3001
ARG VITE_API_URL=
ARG VITE_PA_DEMO=0
ARG VITE_PA_SINGLE_MUNI=
ARG VITE_REPO_URL=
ENV VITE_API_URL=$VITE_API_URL
ENV VITE_PA_DEMO=$VITE_PA_DEMO
ENV VITE_PA_SINGLE_MUNI=$VITE_PA_SINGLE_MUNI
ENV VITE_REPO_URL=$VITE_REPO_URL
RUN npm run build

FROM nginx:1.27.5-alpine
COPY --from=build /app/apps/web/dist /usr/share/nginx/html
COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
