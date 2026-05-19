# syntax=docker/dockerfile:1

FROM golang:1.26-alpine AS build

WORKDIR /src

COPY services/ledger-service/go.mod services/ledger-service/go.sum ./
RUN go mod download

COPY services/ledger-service/cmd cmd
COPY services/ledger-service/internal internal

RUN CGO_ENABLED=0 GOOS=linux go build \
  -trimpath \
  -ldflags='-s -w' \
  -o /out/ledger-service \
  ./cmd/ledger-service

FROM gcr.io/distroless/static-debian12:nonroot

WORKDIR /
COPY --from=build /out/ledger-service /ledger-service

ENV PORT=3001
USER nonroot:nonroot
EXPOSE 3001

ENTRYPOINT ["/ledger-service"]
