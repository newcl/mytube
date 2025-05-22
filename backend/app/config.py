import os

TMP_DIR = os.getenv("MYTUBE_TMP_DIR", "/tmp/yt-streams")

# Ensure tmp_dir exists
os.makedirs(TMP_DIR, exist_ok=True)