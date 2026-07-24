.PHONY: build build-macos-native test run lint clean

build:
	go build -o bin/mytube-server ./cmd/server

build-macos-native:
	bash ../scripts/build-native-macos.sh

test:
	go test ./...

run:
	go run ./cmd/server

lint:
	go vet ./...

# Cross-compile for Linux amd64 (for VPS deploy)
build-linux:
	GOOS=linux GOARCH=amd64 go build -o bin/mytube-server-linux-amd64 ./cmd/server

build-linux-arm64:
	CGO_ENABLED=0 GOOS=linux GOARCH=arm64 go build -o bin/mytube-server-linux-arm64 ./cmd/server

clean:
	rm -rf bin/
