#!/bin/bash

echo "╔════════════════════════════════════════════════════════════╗"
echo "║                                                            ║"
echo "║          MEV BOT AI AGENT - QUICK START SCRIPT            ║"
echo "║                                                            ║"
echo "╚════════════════════════════════════════════════════════════╝"
echo ""

cd eliza-agent-ai

# Check for OpenAI API key
if grep -q "PLACEHOLDER_GET_FROM_USER" .env || ! grep -q "OPENAI_API_KEY=" .env; then
    echo "⚠️  OpenAI API key not configured!"
    echo ""
    echo "Please set your OpenAI API key:"
    echo "1. Get key from: https://platform.openai.com/api-keys"
    echo "2. Run: echo 'OPENAI_API_KEY=sk-your-key' >> eliza-agent-ai/.env"
    echo ""
    exit 1
fi

echo "📦 Installing dependencies..."
npm install --silent

if [ $? -ne 0 ]; then
    echo "❌ Installation failed"
    exit 1
fi

echo ""
echo "✅ Dependencies installed"
echo ""
echo "🧪 Running health checks..."
echo ""

npm test

if [ $? -ne 0 ]; then
    echo ""
    echo "❌ Health checks failed - fix errors before continuing"
    exit 1
fi

echo ""
echo "═══════════════════════════════════════════════════════════════════"
echo ""
echo "✅ All checks passed! Ready to start agent."
echo ""
echo "Starting agent in 3 seconds..."
echo ""
echo "═══════════════════════════════════════════════════════════════════"
echo ""

sleep 3

npm start
