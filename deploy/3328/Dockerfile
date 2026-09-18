# 3328 前后端分离：一个镜像同时装 Go 后端与前端静态产物。
#
# 后端静态编译（CGO_ENABLED=0）+ scratch 运行，镜像 ~25MB，
# 这样在 RK3318（arm64，1~2GB 内存）上才跑得动。
# 前端由 Go 用 WEB_DIR 托管，省掉一层 nginx。

# ---------- 阶段 1：构建前端 ----------
FROM node:22-alpine AS web
WORKDIR /web
COPY web/package.json ./
RUN npm install --no-audit --no-fund
COPY web/ ./
RUN npm run build

# ---------- 阶段 2：构建后端 ----------
FROM golang:1.26-alpine AS server
WORKDIR /src

# 交叉编译目标由 buildx 传入（amd64 / arm64）
ARG TARGETARCH
ARG TARGETOS=linux

COPY server/go.mod server/go.sum* ./
RUN go mod download

COPY server/ ./
RUN CGO_ENABLED=0 GOOS=${TARGETOS} GOARCH=${TARGETARCH} \
    go build -trimpath -ldflags="-s -w" -o /out/douyin-server ./cmd/server

# ---------- 阶段 3：运行 ----------
FROM scratch
COPY --from=server /etc/ssl/certs/ca-certificates.crt /etc/ssl/certs/ca-certificates.crt
COPY --from=server /out/douyin-server /douyin-server
COPY --from=web /web/dist /web/dist

EXPOSE 8080

ENV DY_ADDR=:8080 \
    DY_WEB_DIR=/web/dist \
    DY_LOG_LEVEL=info \
    DY_AUTO_MIGRATE=true

ENTRYPOINT ["/douyin-server"]
