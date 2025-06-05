from fastapi import Request
from fastapi.responses import RedirectResponse
import re

class TrailingSlashMiddleware:
    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] == "http":
            path = scope["path"]
            # Only process API routes
            if path.startswith("/api/") and path != "/" and path.endswith("/"):
                # Remove trailing slash and redirect
                new_path = path.rstrip("/")
                response = RedirectResponse(url=new_path, status_code=307)
                await response(scope, receive, send)
                return
        
        await self.app(scope, receive, send)
