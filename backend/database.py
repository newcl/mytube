from sqlalchemy import create_engine
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker
import os
from dotenv import load_dotenv

load_dotenv()

# Database configuration
def get_database_url():
    # First try DATABASE_URL
    if database_url := os.getenv("DATABASE_URL"):
        return database_url
    
    # Then try individual POSTGRES_ variables
    postgres_user = os.getenv("POSTGRES_USER", "mytube")
    postgres_password = os.getenv("POSTGRES_PASSWORD", "123456")
    postgres_host = os.getenv("POSTGRES_HOST", "localhost")
    postgres_db = os.getenv("POSTGRES_DB", "mytube")
    
    return f"postgresql://{postgres_user}:{postgres_password}@{postgres_host}/{postgres_db}"

DATABASE_URL = get_database_url()
engine = create_engine(DATABASE_URL)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

Base = declarative_base()

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close() 