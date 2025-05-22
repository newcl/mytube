from fastapi import FastAPI
from app.api.routes import router
from fastapi.middleware.cors import CORSMiddleware


app = FastAPI()

origins = [
    "http://localhost:5173",  # Vite dev server
    # Add your production domain here later
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,            # Specific origins allowed
    allow_credentials=True,
    allow_methods=["*"],              # Allow all HTTP methods (GET, POST, etc.)
    allow_headers=["*"],              # Allow all headers
)


app.include_router(router)