#!/bin/bash
set -e

echo "════════════════════════════════════════════════════════"
echo "  Livewire 58K Command Center — Production Deployment"
echo "════════════════════════════════════════════════════════"
echo ""

# Configuration
DEPLOY_DIR="/opt/livewire58k-command-center"
SERVICE_NAME="livewire-cmd-center"
BACKUP_DIR="/opt/backups/livewire-cmd-center"

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# Check if running as root or with sudo
if [ "$EUID" -ne 0 ]; then 
    echo -e "${RED}✗ Please run with sudo${NC}"
    exit 1
fi

echo -e "${YELLOW}→${NC} Creating backup directory..."
mkdir -p "$BACKUP_DIR"

# Backup current deployment if it exists
if [ -d "$DEPLOY_DIR" ]; then
    TIMESTAMP=$(date +%Y%m%d_%H%M%S)
    echo -e "${YELLOW}→${NC} Backing up current deployment..."
    cp -r "$DEPLOY_DIR" "$BACKUP_DIR/backup_$TIMESTAMP"
    echo -e "${GREEN}✓${NC} Backup created: backup_$TIMESTAMP"
fi

echo -e "${YELLOW}→${NC} Creating deployment directory..."
mkdir -p "$DEPLOY_DIR"

echo -e "${YELLOW}→${NC} Copying files..."
rsync -av --exclude='node_modules' \
          --exclude='.git' \
          --exclude='.env' \
          --exclude='*.log' \
          ./ "$DEPLOY_DIR/"

echo -e "${YELLOW}→${NC} Setting up environment..."
if [ ! -f "$DEPLOY_DIR/.env.production" ]; then
    echo -e "${RED}✗ .env.production not found!${NC}"
    echo "  Please create .env.production before deploying."
    exit 1
fi

echo -e "${YELLOW}→${NC} Installing dependencies..."
cd "$DEPLOY_DIR"
npm ci --only=production

echo -e "${YELLOW}→${NC} Setting permissions..."
chown -R www-data:www-data "$DEPLOY_DIR"

echo -e "${YELLOW}→${NC} Installing systemd service..."
cp "$DEPLOY_DIR/livewire-cmd-center.service" "/etc/systemd/system/$SERVICE_NAME.service"
systemctl daemon-reload

echo -e "${YELLOW}→${NC} Restarting service..."
if systemctl is-active --quiet "$SERVICE_NAME"; then
    systemctl restart "$SERVICE_NAME"
    echo -e "${GREEN}✓${NC} Service restarted"
else
    systemctl enable "$SERVICE_NAME"
    systemctl start "$SERVICE_NAME"
    echo -e "${GREEN}✓${NC} Service started and enabled"
fi

echo ""
echo -e "${YELLOW}→${NC} Checking service status..."
sleep 2
systemctl status "$SERVICE_NAME" --no-pager || true

echo ""
echo -e "${GREEN}✓${NC} Deployment complete!"
echo ""
echo "Commands:"
echo "  View logs:    sudo journalctl -u $SERVICE_NAME -f"
echo "  Stop service: sudo systemctl stop $SERVICE_NAME"
echo "  Restart:      sudo systemctl restart $SERVICE_NAME"
echo "  Status:       sudo systemctl status $SERVICE_NAME"
echo ""
echo "Dashboard: http://your-server/cmd/"
echo ""
