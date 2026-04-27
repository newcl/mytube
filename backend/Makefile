.PHONY: build test run lint clean

build:
	go build -o bin/mytube-server ./cmd/server

test:
	go test ./...

run:
	go run ./cmd/server

lint:
	go vet ./...

# Cross-compile for Linux amd64 (for VPS deploy)
build-linux:
	GOOS=linux GOARCH=amd64 go build -o bin/mytube-server-linux-amd64 ./cmd/server

clean:
	rm -rf bin/
