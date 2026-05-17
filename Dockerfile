# syntax=docker/dockerfile:1

FROM node:22-bookworm AS frontend
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci
COPY index.html vite.config.ts tsconfig*.json ./
COPY src ./src
COPY public ./public
RUN npm run build

FROM rust:1.85-bookworm AS rust
WORKDIR /app
COPY src-tauri/Cargo.toml src-tauri/Cargo.lock src-tauri/build.rs ./src-tauri/
COPY src-tauri/src ./src-tauri/src
RUN mkdir -p src-tauri/src/bin
WORKDIR /app/src-tauri
RUN cargo build --release --bin easyapply-server --features server

FROM debian:bookworm-slim AS runtime
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=rust /app/src-tauri/target/release/easyapply-server /app/easyapply-server
COPY --from=frontend /app/dist /app/dist
ENV PORT=8787
ENV EASYAPPLY_STATIC_DIR=/app/dist
ENV EASYAPPLY_DATA_DIR=/data
EXPOSE 8787
CMD ["/app/easyapply-server"]
