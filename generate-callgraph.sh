#!/bin/bash

# MicroQL Call Graph Generator
# Generates a function call graph using code2flow
# Supports Arch/Manjaro Linux

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${GREEN}MicroQL Call Graph Generator${NC}"

# Check if we're on Arch/Manjaro
if ! command -v pacman &> /dev/null; then
    echo -e "${RED}Error: This script only supports Arch/Manjaro Linux${NC}"
    exit 1
fi

# Check if Python is installed
if ! command -v python &> /dev/null && ! command -v python3 &> /dev/null; then
    echo -e "${YELLOW}Python not found. Installing python...${NC}"
    sudo pacman -S --noconfirm python
fi

# Check if pipx is installed (preferred for Python apps on modern Arch)
if ! command -v pipx &> /dev/null; then
    echo -e "${YELLOW}pipx not found. Installing python-pipx...${NC}"
    sudo pacman -S --noconfirm python-pipx
fi

# Check if code2flow is installed
if ! command -v code2flow &> /dev/null; then
    echo -e "${YELLOW}code2flow not found. Installing code2flow with pipx...${NC}"
    pipx install code2flow
    
    # Ensure pipx bin directory is in PATH
    if [[ ":$PATH:" != *":$HOME/.local/bin:"* ]]; then
        export PATH="$HOME/.local/bin:$PATH"
        echo -e "${YELLOW}Added ~/.local/bin to PATH for this session${NC}"
        echo -e "${YELLOW}You may want to add 'export PATH=\"\$HOME/.local/bin:\$PATH\"' to your shell config${NC}"
    fi
fi

# Verify code2flow is now available
if ! command -v code2flow &> /dev/null; then
    echo -e "${RED}Error: code2flow installation failed or not found in PATH${NC}"
    echo -e "${YELLOW}Try running: export PATH=\"\$HOME/.local/bin:\$PATH\"${NC}"
    exit 1
fi

# Check if Node.js and npm are installed (required for acorn)
if ! command -v node &> /dev/null; then
    echo -e "${YELLOW}Node.js not found. Installing nodejs and npm...${NC}"
    sudo pacman -S --noconfirm nodejs npm
fi

# Check if acorn is installed (required by code2flow for JavaScript parsing)
if ! command -v acorn &> /dev/null; then
    echo -e "${YELLOW}acorn not found. Installing acorn globally...${NC}"
    npm install -g acorn
fi

echo -e "${GREEN}Generating call graph...${NC}"

# Generate the call graph
# Target the main MicroQL files for a cleaner diagram
code2flow \
    --language js \
    --output callgraph.png \
    --source-type module \
    --skip-parse-errors \
    query.js util.js processParameters.js executionContext.js retrieve.js

if [ -f "callgraph.png" ]; then
    echo -e "${GREEN}✓ Call graph generated successfully: callgraph.png${NC}"
else
    echo -e "${RED}✗ Failed to generate call graph${NC}"
    exit 1
fi