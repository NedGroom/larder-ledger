from typing import Dict, List
from fastapi import WebSocket, WebSocketDisconnect


class ConnectionManager:
    def __init__(self):
        # dict: house_id -> list of websockets
        self.active_connections: Dict[int, List[WebSocket]] = {}

    async def connect(self, house_id: int, websocket: WebSocket):
        await websocket.accept()
        self.active_connections.setdefault(house_id, []).append(websocket)

    def disconnect(self, house_id: int, websocket: WebSocket):
        conns = self.active_connections.get(house_id, [])
        if websocket in conns:
            conns.remove(websocket)
        if not conns:
            self.active_connections.pop(house_id, None)

    async def broadcast(self, house_id: int, message: dict):
        conns = list(self.active_connections.get(house_id, []))
        for connection in conns:
            try:
                await connection.send_json(message)
            except Exception:
                # best-effort; ignore send errors here
                pass


manager = ConnectionManager()

