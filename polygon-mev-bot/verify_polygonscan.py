#!/usr/bin/env python3
import requests
import time
import sys
import os

# Load API key from environment
API_KEY = os.getenv('POLYGONSCAN_API_KEY', '63KMZIKWY9YCEKDY113Z23A543R6PR1GPZ')
CONTRACT_ADDRESS = "0x0CD75B9605ad928a47616a6a1549FC856c07dbB7"
COMPILER_VERSION = "v0.8.20+commit.a1b79de6"
CONSTRUCTOR_ARGS = "000000000000000000000000ba12222222228d8ba445958a75a0704d566bf2c8"

print("🔍 Python Verification Script")
print(f"Contract: {CONTRACT_ADDRESS}")
print(f"API Key: {API_KEY[:10]}...")
print()

# Read source code
with open('contracts/MEVExecutor_flattened.sol', 'r') as f:
    source_code = f.read()

print("📤 Submitting to PolygonScan API...")

# Submit verification
data = {
    'apikey': API_KEY,
    'module': 'contract',
    'action': 'verifysourcecode',
    'contractaddress': CONTRACT_ADDRESS,
    'sourceCode': source_code,
    'codeformat': 'solidity-single-file',
    'contractname': 'MEVExecutor',
    'compilerversion': COMPILER_VERSION,
    'optimizationUsed': '1',
    'runs': '200',
    'constructorArguements': CONSTRUCTOR_ARGS,
    'evmversion': 'default',
    'licenseType': '3'
}

try:
    response = requests.post('https://api.polygonscan.com/api', data=data, timeout=30)
    result = response.json()
    print(f"Response: {result}")
    print()
    
    if result.get('status') == '1':
        guid = result.get('result')
        print(f"✅ Submitted! GUID: {guid}")
        print("⏳ Checking status...\n")
        
        # Check status
        for i in range(15):
            time.sleep(10)
            check_url = f"https://api.polygonscan.com/api?module=contract&action=checkverifystatus&guid={guid}&apikey={API_KEY}"
            check_response = requests.get(check_url, timeout=10)
            check_result = check_response.json()
            print(f"Attempt {i+1}: {check_result}")
            
            if check_result.get('status') == '1':
                print("\n✅✅✅ VERIFIED SUCCESSFULLY! ✅✅✅")
                print(f"View at: https://polygonscan.com/address/{CONTRACT_ADDRESS}#code")
                sys.exit(0)
            elif 'fail' in str(check_result).lower():
                print(f"\n❌ Verification failed: {check_result}")
                sys.exit(1)
        
        print("\n⏳ Still pending. Check manually.")
        sys.exit(0)
    else:
        print(f"❌ Submission failed: {result}")
        sys.exit(1)
except Exception as e:
    print(f"❌ Error: {e}")
    sys.exit(1)
