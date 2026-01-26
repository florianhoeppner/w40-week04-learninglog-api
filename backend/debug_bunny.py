"""
Debug script to test Bunny.net API connection and credentials.
Run this to diagnose upload issues.

Usage:
    python debug_bunny.py
"""

import os
import sys
import requests
from dotenv import load_dotenv

# Load environment variables
load_dotenv()

def test_bunny_connection():
    """Test Bunny.net API connection and report detailed diagnostics."""

    print("=" * 60)
    print("Bunny.net Connection Diagnostics")
    print("=" * 60)
    print()

    # Get configuration
    storage_zone = os.getenv("BUNNY_STORAGE_ZONE")
    api_key = os.getenv("BUNNY_API_KEY")
    region = os.getenv("BUNNY_STORAGE_REGION", "de")
    cdn_hostname = os.getenv("BUNNY_CDN_HOSTNAME")

    # Check configuration
    print("📋 Configuration Check:")
    print(f"  BUNNY_STORAGE_ZONE: {storage_zone or '❌ NOT SET'}")
    print(f"  BUNNY_API_KEY: {'✅ SET (' + api_key[:8] + '...' + api_key[-4:] + ')' if api_key else '❌ NOT SET'}")
    print(f"  BUNNY_STORAGE_REGION: {region}")
    print(f"  BUNNY_CDN_HOSTNAME: {cdn_hostname or '❌ NOT SET'}")
    print()

    if not all([storage_zone, api_key, cdn_hostname]):
        print("❌ Missing required configuration. Set the following environment variables:")
        if not storage_zone:
            print("   - BUNNY_STORAGE_ZONE")
        if not api_key:
            print("   - BUNNY_API_KEY")
        if not cdn_hostname:
            print("   - BUNNY_CDN_HOSTNAME")
        sys.exit(1)

    # Build URLs
    storage_url = f"https://{region}.storage.bunnycdn.com/{storage_zone}"
    cdn_url = f"https://{cdn_hostname}"

    print("🔗 API Endpoints:")
    print(f"  Storage API: {storage_url}")
    print(f"  CDN URL: {cdn_url}")
    print()

    # Test 1: List files in storage zone (to verify credentials)
    print("🧪 Test 1: Listing files in storage zone...")
    try:
        response = requests.get(
            f"{storage_url}/",
            headers={"AccessKey": api_key},
            timeout=10
        )

        print(f"  Status Code: {response.status_code}")

        if response.status_code == 200:
            print("  ✅ SUCCESS - API key is valid and storage zone is accessible")
            files = response.json()
            print(f"  Found {len(files)} items in root directory")
        elif response.status_code == 401:
            print("  ❌ UNAUTHORIZED - API key is invalid")
            print(f"  Response: {response.text}")
        elif response.status_code == 404:
            print("  ❌ NOT FOUND - Storage zone doesn't exist or wrong region")
            print(f"  Response: {response.text}")
        else:
            print(f"  ❌ ERROR - Unexpected status code")
            print(f"  Response: {response.text}")
    except requests.exceptions.RequestException as e:
        print(f"  ❌ CONNECTION ERROR: {str(e)}")
    print()

    # Test 2: Try to upload a test file
    print("🧪 Test 2: Uploading test file...")
    test_content = b"This is a test file for Bunny.net diagnostics"
    test_filename = "test_diagnostics.txt"

    try:
        response = requests.put(
            f"{storage_url}/{test_filename}",
            data=test_content,
            headers={
                "AccessKey": api_key,
                "Content-Type": "application/octet-stream"
            },
            timeout=30
        )

        print(f"  Status Code: {response.status_code}")

        if response.status_code in [200, 201]:
            print("  ✅ SUCCESS - File uploaded successfully")
            print(f"  CDN URL: {cdn_url}/{test_filename}")

            # Clean up test file
            print()
            print("🧹 Cleaning up test file...")
            delete_response = requests.delete(
                f"{storage_url}/{test_filename}",
                headers={"AccessKey": api_key},
                timeout=10
            )
            if delete_response.status_code in [200, 404]:
                print("  ✅ Test file deleted")
            else:
                print(f"  ⚠️  Failed to delete test file (status {delete_response.status_code})")
        elif response.status_code == 401:
            print("  ❌ UNAUTHORIZED - API key doesn't have write permissions")
            print(f"  Response: {response.text}")
        elif response.status_code == 403:
            print("  ❌ FORBIDDEN - API key doesn't have write permissions")
            print(f"  Response: {response.text}")
        else:
            print(f"  ❌ ERROR - Upload failed")
            print(f"  Full Response: {response.text}")
            print(f"  Headers: {dict(response.headers)}")
    except requests.exceptions.RequestException as e:
        print(f"  ❌ CONNECTION ERROR: {str(e)}")
    print()

    # Summary
    print("=" * 60)
    print("📝 Diagnosis Complete")
    print("=" * 60)
    print()
    print("Common Issues:")
    print("  1. Invalid API key - Check Bunny.net dashboard for correct Storage API key")
    print("  2. Wrong region - Verify storage zone region (de, ny, la, sg, syd)")
    print("  3. Storage zone doesn't exist - Create it in Bunny.net dashboard")
    print("  4. API key permissions - Ensure key has Read & Write permissions")
    print("  5. Network/firewall blocking Bunny.net API")
    print()
    print("Next Steps:")
    print("  - If unauthorized (401/403): Get new API key from Bunny.net dashboard")
    print("  - If not found (404): Check storage zone name and region")
    print("  - If connection error: Check network/firewall settings")
    print()

if __name__ == "__main__":
    test_bunny_connection()
