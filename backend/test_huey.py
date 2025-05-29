from huey_config import huey
import time

@huey.task()
def test_task():
    print("Test task is running!")
    time.sleep(1)
    return "Task completed!"

if __name__ == "__main__":
    # Test the task
    result = test_task()
    print("Task scheduled:", result) 