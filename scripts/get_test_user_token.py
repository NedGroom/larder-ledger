#!/usr/bin/env python3
"""
get_test_user_token.py
----------------------
Signs in a Supabase test user, prints their JWT access token,
and automatically updates TEST_USER_ACCESS_TOKEN in .env.local.
Usage:
    python scripts/get_test_user_token.py --email <email> --password <password>
"""

import argparse
import json
import os
import re
import urllib.request
import urllib.error

SUPABASE_URL = "https://uqadardaukfbrewbuhgk.supabase.co"
SUPABASE_ANON_KEY = (
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9"
    ".eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVxYWRhcmRhdWtmYnJld2J1aGdrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzc4MTUzMjMsImV4cCI6MjA5MzM5MTMyM30"
    ".OcWsWJx7gQM3Bnx5nLEGTfYuzRkCs-dsSQZvbvWw9yc"
)

# Path to .env.local relative to repo root
ENV_FILE = os.path.join(os.path.dirname(__file__), "..", ".env.local")


def sign_in(email: str, password: str) -> dict:
    url = f"{SUPABASE_URL}/auth/v1/token?grant_type=password"
    payload = json.dumps({"email": email, "password": password}).encode()
    req = urllib.request.Request(
        url,
        data=payload,
        headers={
            "Content-Type": "application/json",
            "apikey": SUPABASE_ANON_KEY,
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(req) as resp:
            return json.loads(resp.read())
    except urllib.error.HTTPError as e:
        body = e.read().decode()
        raise SystemExit(f"Sign-in failed ({e.code}): {body}")


def update_env_file(key: str, value: str, env_path: str) -> None:
    """Replace or append a key=value line in an env file."""
    env_path = os.path.abspath(env_path)
    if not os.path.exists(env_path):
        print(f"  (env file not found at {env_path}, skipping write)")
        return

    with open(env_path, "r") as f:
        content = f.read()

    pattern = re.compile(rf"^{re.escape(key)}=.*$", re.MULTILINE)
    new_line = f"{key}={value}"

    if pattern.search(content):
        updated = pattern.sub(new_line, content)
    else:
        updated = content.rstrip("\n") + f"\n{new_line}\n"

    with open(env_path, "w") as f:
        f.write(updated)

    print(f"  ✓ {key} updated in {os.path.relpath(env_path)}")


def main():
    parser = argparse.ArgumentParser(description="Get Supabase JWT for a test user")
    parser.add_argument("--email", required=True, help="Test user email")
    parser.add_argument("--password", required=True, help="Test user password")
    args = parser.parse_args()

    data = sign_in(args.email, args.password)

    access_token = data.get("access_token")
    refresh_token = data.get("refresh_token")
    expires_in = data.get("expires_in")
    user = data.get("user", {})

    print("\n=== Supabase Test User Tokens ===")
    print(f"User ID    : {user.get('id')}")
    print(f"Email      : {user.get('email')}")
    print(f"Expires in : {expires_in}s (~1 hour)")
    print(f"\nAccess token:\n{access_token}")
    print(f"\nRefresh token:\n{refresh_token}")

    print("\nWriting to .env.local...")
    update_env_file("TEST_USER_ACCESS_TOKEN", access_token, ENV_FILE)
    update_env_file("TEST_USER_ID", user.get("id", ""), ENV_FILE)

    print("\nDone. Re-run this script when the token expires.")


if __name__ == "__main__":
    main()

