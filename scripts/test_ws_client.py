#!/usr/bin/env python3
"""Simple WebSocket test client for LarderLedger.

Usage: python scripts/test_ws_client.py --house 1
"""
import argparse
import asyncio
import json
import websockets


async def run(house_id: int, uri: str):
    ws_url = uri.rstrip('/') + f"/ws/houses/{house_id}"
    async with websockets.connect(ws_url) as ws:
        print(f"Connected to {ws_url}")

        async def receiver():
            try:
                async for msg in ws:
                    print("RECV:", msg)
            except Exception as e:
                print("Receiver error:", e)

        async def sender():
            # send a test event
            test = {"type": "client.test", "msg": "hello from test client"}
            await ws.send(json.dumps(test))
            await asyncio.sleep(1)

        await asyncio.gather(receiver(), sender())


def main():
    p = argparse.ArgumentParser()
    p.add_argument('--house', type=int, default=1)
    p.add_argument('--uri', type=str, default='ws://127.0.0.1:8000')
    args = p.parse_args()
    asyncio.run(run(args.house, args.uri))


if __name__ == '__main__':
    main()

