from database import SessionLocal
from models import Video

def clear_all_videos():
    db = SessionLocal()
    try:
        # Delete all videos
        db.query(Video).delete()
        db.commit()
        print("All videos have been deleted from the database.")
    except Exception as e:
        print(f"Error deleting videos: {str(e)}")
        db.rollback()
    finally:
        db.close()

if __name__ == "__main__":
    clear_all_videos() 