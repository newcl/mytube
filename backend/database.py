from sqlalchemy import create_engine
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker
import configparser
import os
from dotenv import load_dotenv

load_dotenv()

# Database configuration
config = configparser.ConfigParser()
config.read('alembic.ini')
DATABASE_URL = config['alembic']['sqlalchemy.url']
engine = create_engine(DATABASE_URL)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

Base = declarative_base()

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close() 